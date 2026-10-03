# RustDesk API Server Roadmap

Corporate deployment features for [crabamole/rustdesk-api](https://github.com/crabamole/rustdesk-api).

**Base:** sctgdesk-api-server (AGPL-3.0)  
**Updated:** 2026-10-03

## Architecture Context

- rustdesk-api (Rust/Rocket) and hbbs run as separate deployments (separate pods in the Helm chart) sharing one PostgreSQL database; hbbs reads/writes only the `peer` table
- The api-server owns the schema (sqlx migrations); hbbs never runs DDL and waits at startup until the schema exists
- hbbs calls the api-server over HTTP (`API_SERVER`, the apiserver Service) to validate tokens when `LOGGED_IN_ONLY=Y`
- Both crabamole/rustdesk and crabamole/rustdesk-server use the same `hbb_common` submodule (from `rustdesk/hbb_common`); protos are in sync
- lejianwen/rustdesk-api was evaluated and rejected (AGPL violation, DMCA history)

## Phase 1: Foundation

Core infrastructure that unblocks everything else.

### Postgres Support
- [x] rustdesk-server (hbbs): Postgres only via required `DB_URL=postgres://...`; native `PgPool`; never creates tables, waits for the api-server schema with backoff before opening ports
- [x] rustdesk-api: Postgres only via required `DATABASE_URL=postgres://...`; native `PgPool`; schema delivered as sqlx migrations (`0001_initial`); connect + migrate retried with backoff
- [x] SQLite removed from both servers (code, schema files, dependencies)
- [x] Helm chart 0.3.0: bundled single-instance PostgreSQL (default) or external via `database.url` / `database.existingSecret`; hbbs and api-server in separate pods with startup probes; hbbs PVC removed
- [x] Tests run against a real Postgres (testcontainers, one reused container per repo)

### Persistent Sessions
- [x] Move token store from in-memory `RwLock<HashMap<Token, AccessTokenInfo>>` to the `session` table
- [x] Tokens survive restart and can be shared across replicas (OIDC logins in progress are still in memory; see Multi-Replica)
- [x] Expired sessions are purged at login; deleting a user removes their sessions

### Proto Update
- [x] Both repos use the same `hbb_common` submodule — protos already match
- **Note:** Upstream `hbb_common` has newer commits (WebRTC, ICE, security fixes) — bump submodule when a feature needs them

### Fix Known Auth Bugs
- [x] JWT `aud` must be string (not array) — fixed with custom `deserialize_aud`
- [x] Inverted `disable` field logic — fixed: `(!disable) as u32` now maps correctly
- [x] Hardcoded Rocket `secret_key` — no private cookies used, plain cookies + JWT only; not a security issue
- [x] OIDC users are created active (`OAUTH2_CREATE_USER=1`, the chart default); set `0` to require activation by an admin
- [x] Swallowed errors in token validation — logged at `debug` level, returns Unauthorized
- [x] Non-admin could promote self to admin via `PUT /api/user` — privileged fields now ignored for non-admins
- [x] Malformed Bearer token caused 500 — now 401
- [x] Found by e2e hardening and fixed: `GET /api/groups` 404 on legacy schema, `/api/software/version/server` panic, `/api/sysinfo` panic / false success, Linux peer count, user-delete count, tag color overflow on Postgres, shared address book rule decoded as 0

### OIDC-Only Login
- [x] No passwords: password login, the password column and bcrypt are gone; the built-in `admin` account is removed on upgrade
- [x] Admins are promoted only by the operator: `rustdesk-api admin promote|demote <email>` (via `kubectl exec`)
- [x] Accounts keyed on the OIDC `sub` claim; `name` and `email` are display fields
- [x] Provider file validated at startup and by `rustdesk-api oidc check`; generic `Oauth2` provider needs `issuer`
- [x] ID token `iss`, `aud` and `exp` checked
- [x] Logins bound to the browser that started them; logins from native clients show an approval page; pending logins expire after 3 minutes
- [x] Web console loads nothing from the internet; `/api/doc` removed (`rustdesk-api openapi` prints the spec)

## Phase 2: Auth & Observability

Make authentication fast and auditable.

### JWT Token Verification
- [ ] Replace per-connection HTTP roundtrip to `/api/currentUser` with local JWT verification at hbbs
- [ ] API server issues signed JWTs at login; hbbs verifies using public key
- [ ] Eliminates hbbs's HTTP call to the api-server per connection
- **Depends on:** Persistent Sessions
- **Trade-off:** hbbs can no longer see a revoked session until its JWT expires; keep JWT lifetimes short

### Audit Logging
Spec: [rustdesk-api/docs/audit-api-spec.md](https://github.com/crabamole/rustdesk-api/blob/main/docs/audit-api-spec.md)
- [x] Connection lifecycle (`new`, `authorized`, `close`) recorded as one row per connection, with nonce-based deduplication
- [x] Client address resolved through trusted proxies (see Trusted Client Address)
- [ ] Session notes (spec §4, §8)
- [ ] Authentication on `GET /api/audit/conn/active`
- [ ] Error replies for `POST /api/audit/file` and `/alarm` per the spec
- [ ] Viewer **user** attribution: hbbs sends `ControlledContext` (spec §11)
- [ ] Admin read API `GET /api/audits/{kind}` and a console page

### Trusted Client Address
- [x] The chart's nginx resolves the client address from trusted proxies (`realIp.trustedProxies`, `realIp.header`) and overwrites `X-Real-IP` / `X-Forwarded-For` toward hbbs, hbbr and the api-server
- [x] hbbs, hbbr and the api-server honour forwarded headers only from `TRUSTED_PROXIES`
- [x] hbbs registration rate limits configurable (`IP_BLOCK_PER_MINUTE`, `IP_BLOCK_IDS_PER_DAY`); hbbr checks its blocklist against the resolved address

### Native Client Login with PKCE
- [ ] Native clients use the authorization code flow with PKCE and a loopback redirect (RFC 8252); the api-server fully validates the ID token (signature via JWKS, `nonce`)
- [ ] Chart setting to turn off the polling login flow
- **Depends on:** shipping our own native client builds ([native-client-roadmap.md](native-client-roadmap.md))

## Phase 3: Policy & Control

Enforce organizational policies on client behavior during remote sessions.

### Client Config Endpoint
- [ ] `GET /api/client-config` (no login) returns the client settings this deployment expects (rendezvous server, relay, api-server, key), so users and support can check a `RustDesk2.toml` against it

### Strategy Push
- [x] Heartbeat response delivers `StrategyOptions.config_options` (one global policy, Pro send-on-change semantics, re-push)
- [x] Controls: the client's Permissions settings (allow-list in the api-server)
- [ ] Named policies assigned to devices, users and device groups

### Control Role Enforcement
- [ ] hbbs decides permission policy per connection (based on user/group)
- [ ] Sends `ControlPermissions` bitmask to client
- Stock clients already enforce the bitmask (clipboard, file transfer, keyboard, terminal, camera, privacy mode, block input), so this is server-side work only; not yet tested end to end
- [ ] Design doc complete
- **Depends on:** Strategy Push

## Phase 4: DLP & Compliance

Data loss prevention controls for regulated environments.

### Clipboard Direction Control
- [ ] Enforce clipboard copy direction per deployment (signed `custom.txt`) — disable copy-from-remote, copy-to-remote, or both
- [x] Design doc exists (`docs/design-clipboard-direction.md`)
- **Depends on:** our own native client builds ([native-client-roadmap.md](native-client-roadmap.md)) — RustDesk's `one-way-clipboard-redirection` is a built-in setting that strategy options and `RustDesk2.toml` cannot set

### Client Attestation
- [ ] Verify connecting clients are corporate-managed builds
- [ ] hbbs validates client identity before allowing connections
- [x] Design doc exists (`docs/design-trusted-builds.md`)
- **Depends on:** our own native client builds ([native-client-roadmap.md](native-client-roadmap.md))

### Device Admission
- [ ] Only devices whose hostname is on an admin-managed list can be controlled; others act as viewers at most
- [ ] Each admitted hostname bound to one device (ID + key) on first use
- [ ] Design doc under review (`docs/design-device-admission.md`); works with stock clients, layers on Client Attestation where clients are unmanaged

## Multi-Replica

- [ ] Run more than one pod of hbbs, hbbr and the api-server
- [ ] hbbs: route connection requests to the pod holding the target device's connection
- [ ] hbbr: pair both halves of a relayed session across pods
- [ ] api-server: move OIDC logins in progress to Postgres; drop or invalidate the address book cache
- [ ] PodDisruptionBudgets once replicas > 1

## Already Working

- [x] **Login Enforcement** — `LOGGED_IN_ONLY=Y` rejects unauthenticated connections at punch hole (verified with Playwright)
- [x] **WebSocket Mode** — single-port on 443 via `/ws/id` and `/ws/relay`, was Pro-only, our fork enables it
- [x] **Web Client** — Flutter web client restored from OSS, deployed via Helm with nginx; loads nothing from the internet
- [x] **Helm Chart & K8s** — separate deployments for hbbs, hbbr, webclient, api-server, plus bundled PostgreSQL StatefulSet; published to `oci://ghcr.io/crabamole/charts/rustdesk`
- [x] **E2E Regression Suite** — rustdesk-e2e (Vitest + Playwright): API, OIDC, web client to Linux/Mac peers, extraCACerts, shared database and database-restart resilience, with server coverage collection
- [x] **OIDC Authentication** — generic OIDC (`Oauth2` provider: Entra ID, Okta, Keycloak, Google, ...), plus Dex and GitHub; auto-create users on first login
- [x] **Extra CA Certs** — `extraCACerts` Helm value mounts corporate CA bundle, apiserver uses `rustls-tls-native-roots` + `SSL_CERT_FILE` for OIDC token exchange
- [x] **Chart Hardening** — non-root pods, ingress-only NetworkPolicies, no ServiceAccount token, required keypair and relay address checked at install, optional Ingress
