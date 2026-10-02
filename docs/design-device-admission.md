# Design: Device Admission by Hostname

## Problem

Any device that registers with hbbs can be controlled. A corporate deployment wants only its
managed machines to accept remote sessions, and everything else to act as a viewer at most,
without customizing the native client further.

## Goal

An administrator keeps a list of hostnames (exact names or wildcards such as `CORP-WS-*`).
hbbs lets a viewer connect to a device only when the device's hostname is on the list.
Stock clients need no change.

## Trust Model

Admission decides *which* devices may be controlled. It relies on the hostname the device
reports about itself, so it is only as trustworthy as the client reporting it:

| Setting | Hostname can be believed because |
|---|---|
| Managed devices, users without admin rights, network that only reaches our hbbs | users cannot rename machines or run other RustDesk servers |
| Unmanaged clients present | only with client attestation ([design-trusted-builds.md](design-trusted-builds.md)), which proves the report comes from our build |

Admission is a layer on top of attestation, not a replacement. It is useful on managed networks
before attestation exists. Binding on first admission (below) keeps a second device from taking
over an admitted hostname, but does not prove the first report was true.

## Where the Hostname Comes From

hbbs never sees hostnames. Devices send system info (`cpu`, `memory`, `os`, `hostname`,
`username`) to the api-server, which stores it in `peer.info` of the row hbbs created when the
device registered (`update_systeminfo`). A device that never registered has no row, and its
system info is dropped (`ID_NOT_FOUND`).

Registration therefore stays open: refusing it would also prevent the hostname from ever being
recorded. Enforcement happens when a viewer asks to connect.

## Design

### 1. Admission list (api-server)

- New table `device_admission`: `pattern` (exact hostname or glob with `*`), `note`, `created_at`.
- Matching is case-insensitive; `*` matches any run of characters.
- Managed with the `rustdesk-api` CLI (`device admit|revoke|list`) and a web console page.
- An empty list means admission is off and every device can be controlled, as today.

### 2. Binding on first admission

- New table `device_binding`: `hostname` (normalized), `peer_id`, `pk`, `bound_at`.
- The first time an admitted hostname is used in a connection, it is bound to that device's
  RustDesk ID and public key.
- Later, a different device reporting the same hostname is refused.
- An administrator can release a binding (CLI and console), e.g. after reinstalling a machine,
  which gives it a new ID.

### 3. Enforcement (hbbs)

hbbs checks the target device in both places that set up a connection to it:

- `handle_punch_hole_request` (`PunchHoleRequest`), next to the existing `LOGGED_IN_ONLY` checks;
- `RequestRelay` forwarding.

Check, when the admission list is not empty:

1. Look up the target's hostname in `peer.info`. Unknown hostname (no system info yet): refuse.
2. Match it against the list. No match: refuse.
3. Check the binding: unbound, bind it to this device; bound to another device, refuse.

A refusal answers the viewer like the login checks do (`PunchHoleResponse.other_failure`), e.g.
"The connection is not allowed. This device is not admitted for remote control."

### 4. hbbs data access

hbbs already shares Postgres with the api-server and reads and writes the `peer` table. It reads
`device_admission` and writes `device_binding` directly, caching the list for a few seconds.
The api-server owns the schema (migrations), as for every other table.

### 5. System info per device

`update_systeminfo` updates every `peer` row with the reporting machine's UUID. A machine with a
stale second ID therefore keeps refreshing that row too. It must update only the row of the
reporting device's ID, so a hostname belongs to exactly one device.

### 6. hbbr

No change: hbbr relays only sessions that hbbs has already allowed.

## Interplay

- **Client-only devices:** every device not on the list can still register and act as a viewer,
  but cannot be controlled. No `conn-type: outgoing` build is needed for that.
- **Login enforcement:** `LOGGED_IN_ONLY` decides who may connect; admission decides to what.
  Both apply.
- **Control roles:** per-user permissions (`ControlPermissions`) are decided after admission.
- **Audit:** refused connections are worth recording as alarms (later).

## Open Questions

1. Should a refused connection also be visible to administrators (alarm record, console list of
   "registered but not admitted" devices)?
2. Do bindings expire when a device has been offline for a long time?
3. Should the list also accept RustDesk IDs, for devices whose hostname cannot be managed?

## Testing

- hbbs: unit tests for matching (exact, wildcard, case), refusal with an unknown hostname,
  binding and refusal of a second device; integration test against Postgres.
- api-server: CLI and API tests for the list and bindings; `update_systeminfo` updates only the
  reporting device's row.
- e2e: with the list set to the Linux VM's hostname only, the web client connects to the Linux
  VM and is refused for the Mac and Windows machines.
