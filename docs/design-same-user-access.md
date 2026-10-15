# Design: Same-User Access Without a Password

**Status: designed, not scheduled** (roadmap Phase 3).

## Goal

A logged-in user connects to a device where the same user is logged in to cRustDesk, without
typing the device's password. Other viewers, and devices with no logged-in user, keep the
password or click-to-accept as today.

"Logged in" means a cRustDesk login through the IdP on that device, not the OS login: the IdP
vouches for both sides. Unattended devices where nobody logs in never get this access.

## Today

- hbbs checks the viewer's login token (`admit_viewer` in rustdesk-server) by asking the
  api-server (`POST /api/audit/ref`), and forwards the returned `conn_audit_ref` to the
  device in `ControlledContext` (`PunchHole`, `RequestRelay`).
- The device validates the password itself (`src/server/connection.rs`). It does not know
  who the viewer is.
- A login on the device sends its `id` and `uuid` (`POST /api/oidc/token`) and creates a
  session that lasts 30 days; logout deletes it. The `peer` table has a `user` column, but
  nothing fills it.

## Design

1. **Device owner.** A device login proves it comes from the device: `POST /api/oidc/auth`
   returns a challenge, the device signs it with its own key (the key registered with hbbs),
   and `/api/oidc/token` carries the signature. The api-server checks it against the device's
   registered key, and only then records the session as the device's owner session
   (`peer.owner_session`) together with the key that signed it (`peer.owner_pk`). A login without a valid signature still works but sets no owner.
   One owner per device; the last login wins. Logout or expiry deletes
   the session, so the owner is gone at once. No separate lifetime.
2. **Decision in the api-server.** The `/api/audit/ref` answer carries `same_user: true` when
   all hold:
   - `SAME_USER_ACCESS=Y` on the api-server (chart `apiserver.sameUserAccess`, off by default);
   - the target device has a current owner session;
   - that session's user is the viewer's user, and the user is active.
3. **hbbs** copies the flag and the owner key into `ControlledContext` (`same_user`,
   `owner_pk`), beside `conn_audit_ref`. It decides nothing.
4. **Device.** The device honours `same_user` only when its link to hbbs is `wss://` with a
   verified certificate and `owner_pk` is its own public key; otherwise it ignores the flag and
   logs why. A key change (reinstall) therefore ends the ownership. When it honours it, the
   device admits the viewer as for a correct
   password: no password, no Accept dialog, in every approve mode. 2FA (if set), the locked
   settings and the session notice stay. Without the flag nothing changes; stock clients
   ignore the field.
5. **Audit.** The connection record states that the session was admitted as same user.

There is no `custom.txt` key: the deployment switch is the opt-in, and the device trusts its
server's flag.

## Changes

| Repo | Change |
|------|--------|
| hbb_common | `bool same_user = 2; bytes owner_pk = 3;` in `ControlledContext` (`rendezvous.proto`); bump the submodule in rustdesk and rustdesk-server |
| rustdesk-api | Migration `peer.owner_session`, `peer.owner_pk`; a challenge in `/api/oidc/auth`; owner set at device login only with a valid device signature; `same_user` and `owner_pk` in the `/api/audit/ref` answer; admission field in the audit record |
| rustdesk-server | `check_viewer_token` reads `same_user` and `owner_pk`; `controlled_context()` sets them |
| rustdesk | Login: an IPC request asks the server process to sign the challenge (the private key never leaves it), the signature goes with `/api/oidc/token`. `connection.rs`: a new branch before the approve-mode check, doing what the recent-session branch does (logon response, then `try_start_cm` as authorized); the check in a new function, which also requires a verified `wss://` link to hbbs and `owner_pk` equal to the device's key |
| rustdesk-charts | `apiserver.sameUserAccess: false` sets `SAME_USER_ACCESS` |

## Failure Behaviour

- api-server down or slow: `admit_viewer` already refuses (`LOGGED_IN_ONLY`) or sends no ref.
  No flag, so the password applies.
- Mixed versions: if any of api-server, hbbs or the DC build is older, no flag arrives and the
  password applies. Release notes state the version pairing.

## Trust

The device stops being the only judge of access: anyone who controls hbbs or the api-server,
or holds a user's login token, can open that user's own devices. This matches SSO-style remote
desktop and is why the feature is per deployment and off by default. The feature needs
`wss://` with a valid certificate between devices and hbbs.

## Testing

- api-server: owner set at login, cleared at logout and expiry; `same_user` only for the
  owner, not when the switch is off, for another user or for a disabled user.
- rustdesk-server: the flag is copied.
- api-server: no owner for a missing or wrong device signature.
- rustdesk: unit test of the new check, including the flag ignored on `ws://` and on a link
  whose certificate was not verified, and for an `owner_pk` that is not the device's key.
- e2e: a device login without a signature gives no same-user access; a user logs in on a test device; the same user's browser connects without a password;
  another user still gets the prompt; after logout the password is needed again.

## Not Included

- Members of the owner's group (needs Control Role Enforcement).
- A device-side check of its own login state: the api-server is the authority, and on Windows
  the login token lives in the user's app, not in the service that checks the password.
- A viewer ID check against `LoginRequest.my_id`: the viewer sets it, and the web client always
  sends `web`.

## Depends On

- [Login Bound to Its Starter](design-oidc-login.md) (done): device logins carry `id` and `uuid`.
- Client attestation strengthens it: only our builds should honour `same_user`.
