# Design: Clipboard Activity Monitoring

**Status: not implemented.** The clipboard audit endpoint and client calls below are
still to be built, on [crabamole/rustdesk-api](https://github.com/crabamole/rustdesk-api).

## Problem

RustDesk has file transfer auditing (`post_file_audit()` → `{api-server}/api/audit/file`)
but no text clipboard auditing. The OSS server (hbbs/hbbr) has no API server — the
api-server is a separate HTTP service, provided commercially by RustDesk Pro.

## Goal

Log all clipboard transfers (text and file, both directions) for compliance and security
monitoring, independent of clipboard direction policy.

## Background: The API Server

The `api-server` is a separate HTTP service, distinct from hbbs/hbbr. It provides
the management plane for RustDesk deployments:

| Category | Endpoints | Features |
|----------|-----------|----------|
| **Audit** | `/api/audit/conn`, `/api/audit/file`, `/api/audit/alarm` | Connection, file transfer, and security event logging |
| **Heartbeat** | `/api/heartbeat`, `/api/sysinfo` | Device inventory, online status, remote config push |
| **Auth** | `/api/login-options`, `/api/oidc/auth` | OIDC/SSO login |
| **Device** | `/api/devices/cli`, `/api/devices/deploy` | Device provisioning |
| **Recording** | `/api/record` | Session recording upload |
| **Address Book** | (various) | Shared device lists, groups, tags |

The heartbeat response can **push config** to devices (`strategy.config_options`),
providing an alternative to `RustDesk2.toml` preseed for remote configuration management.

Configured via `api-server` option in `RustDesk2.toml`, or auto-derived from hbbs
address (port - 2, e.g. 21116 → 21114).

## Community API Server Implementations

Several open-source projects implement the RustDesk api-server contract:

| Project | Stars | Forks | Language | Last Updated | Features |
|---------|-------|-------|----------|-------------|----------|
| [lejianwen/rustdesk-api](https://github.com/lejianwen/rustdesk-api) | 3,104 | 732 | Go | 2025-09 | Most complete: web admin UI, OIDC, audit, address book |
| [lantongxue/rustdesk-api-server-pro](https://github.com/lantongxue/rustdesk-api-server-pro) | 351 | 89 | Go | 2026-04 | All client APIs, web UI |
| [sctg-development/sctgdesk-api-server](https://github.com/sctg-development/sctgdesk-api-server) | 141 | 38 | TypeScript | 2025-12 | Swagger docs at `/api/doc`, OAuth2 |

**None implement `/api/audit/clipboard`** — that is our custom addition.

## Decision: build on crabamole/rustdesk-api

Implement the endpoint in [crabamole/rustdesk-api](https://github.com/crabamole/rustdesk-api),
our fork of sctgdesk-api-server, which is already deployed by the chart and has the
connection, file and alarm audit endpoints to extend.

**Do not use lejianwen/rustdesk-api**, as a base or as a source of code: its licensing
does not fit this AGPL-3.0 project (it distributes RustDesk-derived code under another
license). Its documentation may be read for ideas; its code must not be copied.

## Scope

### 1. API Server (crabamole/rustdesk-api)

Add `/api/audit/clipboard` endpoint next to the existing audit endpoints. Store alongside
connection and file audit events in the same PostgreSQL database.

### 2. Client-Side: Text Clipboard Audit Calls (crabamole/rustdesk)

Add `post_clipboard_audit()` mirroring the existing `post_file_audit()` pattern.

#### Existing File Audit (for reference)

`src/server/connection.rs:1530-1565` — `post_file_audit()`:
- POST to `{api-server}/api/audit/file`
- Payload: device ID, peer ID, connection ID, file path, type, nonce
- Retries with backoff (10s, 30s) up to 120s deadline
- Nonce for server-side deduplication

#### Insertion Points for Text Clipboard

**Inbound (client→server):**
- `src/server/connection.rs:3237` — `Clipboard(cb)` message received
- `src/server/connection.rs:3265` — `MultiClipboards(_mcb)` message received

**Outbound (server→client):**
- `src/server/clipboard_service.rs:89` — clipboard message sent to subscribers

#### Proposed `post_clipboard_audit()`

```rust
fn post_clipboard_audit(peer_id: &str, conn_id: i32, direction: &str, content_length: usize) {
    // mirrors post_file_audit() pattern
    // POST to {api-server}/api/audit/clipboard
}
```

Payload:

```json
{
  "id": "<device_id>",
  "uuid": "<device_uuid>",
  "peer_id": "<remote_peer_id>",
  "conn_id": 123,
  "direction": "inbound",
  "content_length": 1024,
  "blocked": false,
  "nonce": "<uuid-v4>",
  "timestamp": "2026-09-10T12:00:00Z"
}
```

**Content is NOT sent** — only metadata. Data is e2e encrypted and the audit server
should not see plaintext clipboard content.

~30 lines in `src/server/connection.rs` + `src/server/clipboard_service.rs`.

## Architecture

```
RustDesk Client (controlled device)
  │
  │ POST /api/audit/clipboard  (text clipboard events)
  │ POST /api/audit/file       (file transfer events)
  │ POST /api/audit/conn       (connection events)
  │ POST /api/heartbeat        (device status, every 15s)
  │ POST /api/sysinfo          (device inventory)
  │
  ▼
web client nginx (rustdesk.example.com:443)
  │
  ├── /ws/id       → hbbs:21118
  ├── /ws/relay/<n> → hbbr pod <n>:21119
  ├── /api/, /ui   → rustdesk-api:21114
  └── /            → web client
  │
  ▼
rustdesk-api (crabamole/rustdesk-api)
  │
  ├── Audit: connections, files, alarms, + clipboard (to add)
  ├── Device management: heartbeat, sysinfo, address book
  ├── Auth: OIDC login
  └── Web console (/ui)
```

## Deployment

No new component: the chart already deploys rustdesk-api and routes `/api/` to it.

Client configuration in `RustDesk2.toml`:

```toml
[options]
api-server = 'https://rustdesk.example.com'
```

Same domain as hbbs/hbbr/web client — the web client's nginx routes `/api/` to the api-server.

## Repos

| Repo | Purpose |
|------|---------|
| `crabamole/rustdesk` | Add `post_clipboard_audit()` calls (~30 lines) |
| `crabamole/rustdesk-api` | Add `/api/audit/clipboard` endpoint |

## Additional Value from API Server

Beyond clipboard monitoring, deploying the api-server enables:

- **Remote config push** — heartbeat response can set normal device options such as
  `enable-clipboard`; built-in settings like `one-way-clipboard-redirection` still need
  `custom.txt` (see design-config-enforcement.md)
- **Device inventory** — sysinfo gives visibility into all deployed devices
- **Connection audit** — already built-in, no client patch needed
- **Address book** — shared device lists for users
- **OIDC login** — SSO integration with corporate identity provider

## Open Questions

- Retention policy for audit logs?
- Do we need the web admin UI exposed externally, or internal only?

## Related

- [design-clipboard-direction.md](design-clipboard-direction.md) — clipboard direction control
- [design-config-enforcement.md](design-config-enforcement.md) — protecting settings
- [design-trusted-builds.md](design-trusted-builds.md) — custom builds and attestation
