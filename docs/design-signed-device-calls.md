# Design: Signed Device Calls

**Status: implemented locally, not released.**

## Goal

The api-server accepts a device's own calls (heartbeat, sysinfo, connection, file and alarm audit
records) only from the device itself. Today these calls carry the device `id` and `uuid` and no
credential, so the api-server cannot tell the device from any other program that knows both.

## Today

| Call | Sent by | Checked today |
|---|---|---|
| `POST /api/heartbeat` | `hbbs_http/sync.rs` | nothing |
| `POST /api/sysinfo` | `hbbs_http/sync.rs` | `id` + `uuid` match a peer |
| `POST /api/audit/conn`, `/file`, `/alarm` | `server/connection.rs` (`post_audit_async`) | `id` + `uuid` match a registered peer |

All of them run in the device's server process, which holds the key pair registered with hbbs
(`peer.pk`). Same-user access already signs the owner login with that key.

## Design

1. **Header.** Each of these calls carries `X-Device-Signature: <ts>.<sig>`:
   - `ts`: Unix time in seconds;
   - `sig`: base64 Ed25519 signature with the device key over
     `"device-call" 0 ts 0 path 0 sha256(body)`, where `path` is the request path
     (`/api/heartbeat`) and `sha256(body)` is the lowercase hex digest of the exact body bytes.

   The body already names the device (`id`, `uuid`), so the signature covers them. The path binds
   the signature to one endpoint. Each retry signs again with a new `ts`.
2. **Check.** The api-server reads the raw body, looks up `peer.pk` for the body's `id` + `uuid`,
   and accepts the call only when the signature is valid for that key and `ts` is within 300 s of
   its clock. Otherwise it answers 401 and does nothing.
3. **No unsigned path.** Unsigned calls are refused. Stock RustDesk clients on devices therefore
   get no heartbeat answers (no policy, no disconnect) and their audit records are not stored.
   Viewers are not affected: these calls come only from the controlled side. Release notes and
   `UPGRADING.md` state the version pairing (no backward compatibility).

Nothing is stored for the check: no nonce table, no new column.

## Limits

- The key is the one hbbs registered for the ID. Whoever can replace that registration (see the
  same-user access design) can also sign.
- A device whose clock is more than 5 minutes off has its calls refused; the device logs the
  401 (throttled).
- A signed call can be replayed within its 300 s window by someone who already sees the TLS traffic.
  Audit records keep their nonce deduplication.

## Changes

| Repo | Change |
|---|---|
| rustdesk | `src/device_call.rs`: message and header; one-line hooks in `hbbs_http/sync.rs` and `post_audit_async` |
| rustdesk-api | `SignedDevice<T>` data guard on the five endpoints; `device_call` verify function |
| rustdesk-e2e | test signer for direct device calls; registered test keys |

## Regression Surface

- **Device calls:** one header per call. The body and the endpoints do not change.
- **api-server:** the five handlers take their body through the guard; their logic does not change.
- **Stock clients as devices:** lose heartbeat answers and audit (see 3).

## Testing

- api-server: a call is accepted with a valid signature and refused when the signature is missing,
  from another key, for another path or body, or with `ts` 301 s off.
- e2e: a forged heartbeat and a forged `close` record no longer end a live session row; Disconnect
  still closes the session; devices still report audits.
