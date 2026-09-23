# RustDesk API Server Roadmap

Corporate deployment features for the sctgdesk-api-server fork.

**Base:** sctgdesk-api-server (AGPL-3.0)  
**Updated:** 2026-09-23

## Architecture Context

- sctgdesk-api-server is a Rust/Rocket library crate embedded in the hbbs binary — same pattern as hbbs/hbbr sharing one codebase, different entrypoints
- hbbs and API share a SQLite file — both read/write the `peer` table. Postgres removes this constraint and allows separate deployments.
- Both rophy/rustdesk and sctgdesk-server use the same `hbb_common` submodule (from `rustdesk/hbb_common`); protos are in sync
- lejianwen/rustdesk-api was evaluated and rejected (AGPL violation, DMCA history)

## Phase 1: Foundation

Core infrastructure that unblocks everything else.

### Postgres Support
- [x] sctgdesk-server (hbbs): supports Postgres via `DB_URL=postgres://...`
- [x] sctgdesk-api-server: supports Postgres via `DATABASE_URL=postgres://...` (sqlx with `postgres` feature, dedicated schema)
- [x] Helm chart supports `databaseUrl` / `databaseUrlSecretName` for both

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
- [x] **Helm Chart & K8s** — separate deployments for hbbs, hbbr, webclient, apiserver sidecar; published to `oci://ghcr.io/rophy/charts/rustdesk`
- [x] **OIDC Authentication** — GitHub and Dex providers, auto-create users on first login
- [x] **Extra CA Certs** — `extraCACerts` Helm value mounts corporate CA bundle, apiserver uses `rustls-tls-native-roots` + `SSL_CERT_FILE` for OIDC token exchange
