# RustDesk API Server Roadmap

Corporate deployment features for the sctgdesk-api-server fork.

**Base:** sctgdesk-api-server (AGPL-3.0)  
**Updated:** 2026-09-24

## Architecture Context

- sctgdesk-api-server (Rust/Rocket) and hbbs run as separate deployments (separate pods in the Helm chart) sharing one PostgreSQL database; hbbs reads/writes only the `peer` table
- The api-server owns the schema (sqlx migrations); hbbs never runs DDL and waits at startup until the schema exists
- hbbs calls the api-server over HTTP (`API_SERVER`, the apiserver Service) to validate tokens when `LOGGED_IN_ONLY=Y`
- Both rophy/rustdesk and sctgdesk-server use the same `hbb_common` submodule (from `rustdesk/hbb_common`); protos are in sync
- lejianwen/rustdesk-api was evaluated and rejected (AGPL violation, DMCA history)

## Phase 1: Foundation

Core infrastructure that unblocks everything else.

### Postgres Support
- [x] sctgdesk-server (hbbs): Postgres only via required `DB_URL=postgres://...`; native `PgPool`; never creates tables, waits for the api-server schema with backoff before opening ports
- [x] sctgdesk-api-server: Postgres only via required `DATABASE_URL=postgres://...`; native `PgPool`; schema delivered as sqlx migrations (`0001_initial`); connect + migrate retried with backoff
- [x] SQLite removed from both servers (code, schema files, dependencies)
- [x] Helm chart 0.3.0: bundled single-instance PostgreSQL (default) or external via `database.url` / `database.existingSecret`; hbbs and api-server in separate pods with startup probes; hbbs PVC removed
- [x] Tests run against a real Postgres (testcontainers, one reused container per repo)

### Persistent Sessions
- [x] Move token store from in-memory `RwLock<HashMap<Token, AccessTokenInfo>>` to the `session` table
- [x] Tokens survive restart and can be shared across replicas

### Proto Update
- [x] Both repos use the same `hbb_common` submodule — protos already match
- **Note:** Upstream `hbb_common` has newer commits (WebRTC, ICE, security fixes) — bump submodule when a feature needs them

### Fix Known Auth Bugs
- [x] JWT `aud` must be string (not array) — fixed with custom `deserialize_aud`
- [x] Inverted `disable` field logic — fixed: `(!disable) as u32` now maps correctly
- [x] Hardcoded Rocket `secret_key` — no private cookies used, plain cookies + JWT only; not a security issue
- [x] OIDC users created with `status=0` (inactive) by default — mitigated via `OAUTH2_CREATE_USER=1`
- [x] Swallowed errors in token validation — logged at `debug` level, returns Unauthorized
- [x] Non-admin could promote self to admin via `PUT /api/user` — privileged fields now ignored for non-admins
- [x] Malformed Bearer token caused 500 — now 401
- [x] Found by e2e hardening and fixed: `GET /api/groups` 404 on legacy schema, `/api/software/version/server` panic, `/api/sysinfo` panic / false success, Linux peer count, user-delete count, tag color overflow on Postgres, shared address book rule decoded as 0

## Phase 2: Auth & Observability

Make authentication fast and auditable.

### JWT Token Verification
- [ ] Replace per-connection HTTP roundtrip to `/api/currentUser` with local JWT verification at hbbs
- [ ] API server issues signed JWTs at login; hbbs verifies using public key
- [ ] Eliminates the localhost HTTP coupling
- **Depends on:** Persistent Sessions

### Audit Logging
- [x] Implement write path for existing `audit_conn`, `audit_file`, `audit_alarm` tables
- [x] Add route handlers: `POST /api/audit/conn`, `/file`, `/alarm` + `GET /api/audit/conn/active`
- [x] Client audit payloads now persisted with nonce-based deduplication
- **Note:** DB tables and indexes already exist in schema

## Phase 3: Policy & Control

Enforce organizational policies on client behavior during remote sessions.

### Strategy Push
- [ ] Heartbeat response delivers `StrategyOptions.config_options` to enforce client settings
- [ ] Controls: `enable-file-transfer`, `enable-clipboard`, `access-mode`, `enable-keyboard`, etc.
- [ ] sctgdesk has the endpoint but returns empty config
### Control Role Enforcement
- [ ] hbbs decides permission policy per connection (based on user/group)
- [ ] Sends `ControlPermissions` bitmask to client
- [ ] Client enforces: clipboard, file transfer, keyboard, terminal, camera, privacy mode, block input
- [ ] Design doc complete
- **Depends on:** Strategy Push

## Phase 4: DLP & Compliance

Data loss prevention controls for regulated environments.

### Clipboard Direction Control
- [ ] Enforce clipboard copy direction per policy — disable copy-from-remote, copy-to-remote, or both
- [ ] Controlled via strategy options
- [ ] Design doc exists
- **Depends on:** Control Role Enforcement, Strategy Push

### Client Attestation
- [ ] Verify connecting clients are corporate-managed builds
- [ ] hbbs validates client identity before allowing connections
- [ ] Design doc exists

## Already Working

- [x] **Login Enforcement** — `LOGGED_IN_ONLY=Y` rejects unauthenticated connections at punch hole (verified with Playwright)
- [x] **WebSocket Mode** — single-port on 443 via `/ws/id` and `/ws/relay`, was Pro-only, our fork enables it
- [x] **Web Client** — Flutter web client restored from OSS, deployed via Helm with nginx
- [x] **Helm Chart & K8s** — separate deployments for hbbs, hbbr, webclient, api-server, plus bundled PostgreSQL StatefulSet; published to `oci://ghcr.io/crabamole/charts/rustdesk`
- [x] **E2E Regression Suite** — rustdesk-e2e (Vitest + Playwright): API, OIDC, web client to Linux/Mac peers, extraCACerts, shared database and database-restart resilience, with server coverage collection
- [x] **OIDC Authentication** — GitHub and Dex providers, auto-create users on first login
- [x] **Extra CA Certs** — `extraCACerts` Helm value mounts corporate CA bundle, apiserver uses `rustls-tls-native-roots` + `SSL_CERT_FILE` for OIDC token exchange
