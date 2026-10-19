# Design: Approved Device Key Change

**Status: designed, not scheduled.**

## Goal

A device ID keeps its registered key. A device gets a new key under the same ID only after:

1. **Stage 1:** an admin resets the key of that ID, or
2. **Stage 2:** the device's owner logs in on the device with the new key.

Without approval the device keeps its ID and waits. It does not take a new random ID.

Signed device calls ([design-signed-device-calls.md](design-signed-device-calls.md)) and
same-user access ([design-same-user-access.md](design-same-user-access.md)) trust the key that
hbbs registered for an ID. This design makes a change of that key a deliberate step.

## Today

- The client creates its key pair once, when the config has none (`Config::get_key_pair`), and
  keeps it. A new key comes only with a lost config: an uninstall that removes the config, a
  deleted or damaged config file, a config import (`Config::set`), or a macOS reinstall.
- With no ID in the config, the client derives the same ID from the MAC address again
  (`Config::get_auto_id`).
- The client sends `RegisterPk` on every new rendezvous connection.
- hbbs (`handle_register_pk`) accepts a new `pk` for a known `id` + `uuid` when the request comes
  from the IP of the last registration. From another IP it answers `UUID_MISMATCH`, and the
  client takes a random ID (`handle_uuid_mismatch`).

## Design

### Stage 1: no re-key without an admin reset

1. **hbbs.** For a known `id` + `uuid` with a stored `pk`, a `RegisterPk` with another `pk` is
   refused with a new result `KEY_CHANGE_REFUSED` (`RegisterPkResponse`), from any IP. Before
   it refuses, hbbs reads the row from the database again; when the stored `pk` is empty, it
   accepts the new key. A `RegisterPk` with the stored `pk` from a new IP is accepted as today
   (the device moved). The `uuid` checks do not change.
2. **Admin reset.** `rustdesk-api peer reset-key <id>` and a console action on the Devices page
   empty `peer.pk`, `peer.owner_session` and `peer.owner_pk`. The next `RegisterPk` for that
   `id` + `uuid` sets the new key. A console row records it (`typ` 2, `iop` 27 Reset Device Key).
3. **Client.** On `KEY_CHANGE_REFUSED` the client keeps its ID, clears `key_confirmed` and
   retries `RegisterPk` every 30 s, like `NOT_DEPLOYED`. The UI shows "This device's key
   changed. Ask your administrator to reset it." The log line is throttled.

### Stage 2: re-key by the owner's login

4. **Device login.** The device login signs the owner proof
   (`"owner-login" 0 code 0 id 0 uuid`) with the device's current key, as today, and also
   sends that public key (`ownerPk`, base64) with `/api/oidc/token`.
5. **api-server.** When `ownerPk` is not the registered `pk`, the api-server checks:
   - the signature is valid for `ownerPk`;
   - the device has a live owner session, and its user is the user of this login;
   - the user is active.

   When all hold, it writes `peer.approved_pk = ownerPk` and makes the new session the owner
   with `owner_pk = ownerPk`. A console row records it (`typ` 2, `iop` 28 Device Key Changed,
   `info`: device ID, user, `via: "owner-login"`). Otherwise the login works and changes
   nothing, as a login without a valid proof does today.
6. **hbbs.** On a `pk` mismatch it also accepts the new key when it equals `peer.approved_pk`,
   and empties `approved_pk` in the same update.
7. **Client.** While refused, the UI also offers "Log in to keep this ID". After the login the
   next `RegisterPk` (within 30 s) is accepted.

Only the interactive device login counts. A bearer token alone never approves a key.

## Changes

| Repo | Stage | Change |
|---|---|---|
| hbb_common | 1 | `KEY_CHANGE_REFUSED = 9` in `RegisterPkResponse.Result`; bump the submodule in rustdesk and rustdesk-server |
| rustdesk-server | 1 | `handle_register_pk`: refuse another `pk` for a known device unless the stored `pk` is empty |
| rustdesk-server | 2 | also accept `pk` = `approved_pk`, empty it on use |
| rustdesk-api | 1 | CLI `peer reset-key`; console action; `iop` 27 |
| rustdesk-api | 2 | migration `peer.approved_pk`; the owner check in `/api/oidc/token`; `iop` 28 |
| rustdesk | 1 | `KEY_CHANGE_REFUSED` handling and UI text in a new function, thin hook in `handle_resp` |
| rustdesk | 2 | `ownerPk` in the device login; "Log in to keep this ID" |
| rustdesk-charts | 1 | `UPGRADING.md`: reinstalled devices need a key reset |

New state: one nullable column, `peer.approved_pk` (stage 2). hbbs and the api-server already
share the `peer` table; there is no new call between them.

## Regression Surface

- **hbbs registration:** only the branch "known `id` + `uuid`, other `pk`" changes. New devices,
  re-registrations with the same key and the `uuid` checks do not change.
- **Client:** one new result code. The other codes keep their handling.
- **Device login (stage 2):** one more field. A login with the registered key works as today.

## Version Pairing

No backward compatibility. Stock clients and older builds do not know `KEY_CHANGE_REFUSED`:
after a lost config they log "unknown RegisterPkResponse" and stay unregistered until an admin
resets the key. Release notes and `UPGRADING.md` state the pairing.

## Limits

- A device without a live owner session (unattended devices, owners who logged out or whose
  session expired) needs the admin reset.
- After a reset, the next registration for that `id` + `uuid` wins. An admin resets the key while
  the device is being set up again.
- Cloned machines with the same config and machine UID share one key; this design cannot tell
  them apart.
- A device that lost its config and is not reset keeps waiting under its old ID. The console
  shows the ID as offline until the reset.

## Testing

- rustdesk-server: another `pk` for a known device → `KEY_CHANGE_REFUSED` from the same and from
  another IP; same `pk` from a new IP → OK; after the stored `pk` is emptied → OK; (stage 2) `pk`
  = `approved_pk` → OK and `approved_pk` emptied.
- rustdesk-api: `peer reset-key` empties the key and the owner and writes the console row;
  (stage 2) the owner's login with a new key sets `approved_pk`; another user, no owner session,
  a disabled user or a bad signature set nothing.
- rustdesk: on `KEY_CHANGE_REFUSED` the ID does not change.
- e2e: remove the VM client's config and restart it → the ID stays and the device is refused;
  `peer reset-key` → the device registers under the same ID; (stage 2) the owner logs in on the
  device instead → it registers under the same ID with same-user access.

## Not Included

- An approval of one specific new key by the admin (needs the key fingerprint shown on the
  device).
- Re-key approval by members of the owner's group.
