# Design: Same-User Access Without a Password

**Status: future (roadmap Phase 3).** Not scheduled.

## Goal

A logged-in user connects to a device where the same user is logged in, without typing
the device's password. Other viewers, and devices with no logged-in user, keep the
password or click-to-accept as today.

## Today

- hbbs checks the viewer's login token (`admit_viewer` in rustdesk-server) and forwards an
  opaque `conn_audit_ref` to the device in `ControlledContext` (`PunchHole`,
  `RequestRelay`).
- The device validates the password itself (`validate_password` in
  `src/server/connection.rs`). It does not know who the viewer is.
- A login on the device sends its `id` and `uuid` to the api-server
  (`POST /api/oidc/token`). The `peer` table has a `user` column, but nothing fills it.

## Design

1. **Device owner.** A login on the device records the user as the owner of that
   `(id, uuid)` in `peer.user`; logout clears it. One owner per device.
2. **Server decision.** When the deployment enables the feature, hbbs asks the api-server
   (with the viewer token it already checks) whether the viewer's user owns the target
   device. If so, it sets `same_user = true` and the viewer's ID in `ControlledContext`.
3. **Device decision.** Our build skips the password only if all hold:
   - `same-user-access` is `Y` in `custom.txt` (locked, off by default);
   - `ControlledContext.same_user` is set and its viewer ID equals `LoginRequest.my_id`;
   - the device itself is still logged in as a user.

   Otherwise it falls back to the normal password check. Stock clients ignore the
   unknown field and ask for the password.
4. **Audit.** The connection record states how the session was admitted (password,
   click-to-accept, same user).

## Trust

The device stops being the only judge of access: anyone who controls hbbs or the
api-server, or holds a user's login token, can open that user's own devices. This matches
SSO-style remote desktop and is why the feature is per deployment and opt-in on both sides
(server setting and `custom.txt`). The threat analysis lives in the private e2e repo.

## Open Questions

- On Windows the connection runs in the service while the login token belongs to the
  user's app. How does the service learn that the device is still logged in?
- Should 2FA and the session-recording or permission rules still apply? (Proposed: yes,
  only the password step is skipped.)
- Owner vs. group: allow members of the owner's device group too, or only the owner?
- Token lifetime: the device's login must expire or be revocable from the console.

## Depends On

- [Login Bound to Its Starter](design-oidc-login.md) (done): device logins carry `id` and `uuid`.
- Control Role Enforcement: same per-connection decision path in hbbs.
- Client attestation strengthens it: only our builds should honour `same_user`.
