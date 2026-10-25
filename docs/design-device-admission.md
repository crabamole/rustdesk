# Design: Device Admission

**Status: design.**

## Problem

Any device that registers with hbbs can be controlled. A corporate deployment wants only the
machines it approved to accept remote sessions, and every other device to act as a viewer at
most, without customizing the native client further.

## Goal

- A server switch `DEVICE_ADMISSION`, off by default. Off: every device can be controlled, as today.
- On: a new device is **pending** until an administrator approves it. Only **approved** devices can
  be controlled. Pending and rejected devices can still connect to other devices as viewers.
- Phase 2: administrators define rules that approve matching pending devices automatically.
- Stock clients need no change.

## Device States

| State | Can be controlled | Set by |
|---|---|---|
| pending | no | new device while the switch is on; key change of an approved device; administrator reset |
| approved | yes | administrator; a rule (phase 2); every device registered while the switch is off |
| rejected | no | administrator |

Approval is bound to the device's ID and its key at that time (`admitted_pk`). When hbbs records
a different key for the ID ([design-device-key-change.md](design-device-key-change.md)), the device
is pending again. A rejected device stays rejected until an administrator changes it; rules never
approve it.

Devices that register while the switch is off are approved. The migration marks every existing
device approved. Turning the switch on therefore affects only devices that register after it.

## Why Enforcement Is at Connect Time

Registration stays open. The administrator needs the device's hostname, OS, user and owner to
decide, and the api-server receives these only from a registered device: system info for an
unknown ID is dropped (`ID_NOT_FOUND`). A registered device that is not approved does no harm,
because hbbs refuses every connection to it.

Both requests that set up a connection to a device go through `admit_viewer(token, target)` in
hbbs: `PunchHoleRequest` and `RequestRelay` forwarding. It checks the viewer's login and the
target ID only, not whether the viewer is registered, so pending devices keep working as viewers.

## Design

### 1. Data (api-server owns the schema)

New columns on `peer`:

- `admission` smallint: 0 pending, 1 approved, 2 rejected. Migration default for existing rows: 1.
- `admitted_pk` bytea: the key the approval applies to. Migration: copy `pk`.
- `admitted_at`, `admitted_by` (user, or `rule:<name>` in phase 2).

The key-change column `approved_pk` is a separate feature and is not reused.

### 2. Registration (hbbs)

hbbs reads `DEVICE_ADMISSION` (Y/N). When it creates a `peer` row, it sets `admission` to pending
when the switch is on and to approved (with `admitted_pk = pk`) when it is off. When it records a
new key for an existing ID, it sets the device to pending if it was approved.

### 3. Enforcement (hbbs)

In `admit_viewer`, when the switch is on and the target is not approved with its current key,
hbbs refuses with `PunchHoleResponse.other_failure`:
"The connection is not allowed. This device is not approved for remote control."

This also applies when the viewer is not logged in, where hbbs does not call the api-server
today. hbbs reads the admission state from Postgres and caches it per device for a few seconds,
so an approval takes effect within that time on every hbbs pod. A database error refuses the
connection (fail closed) when the switch is on.

hbbr needs no change: it relays only sessions that hbbs allowed.

### 4. Administration (api-server)

- Console: a "Pending devices" list with ID, hostname, OS, user, owner, source IP of the last
  system info upload and first-seen time; approve, reject and reset to pending. The device list
  shows the state of every device.
- CLI: `rustdesk-api device approve|reject|reset <id>` and `device list --state pending`.
- API: the same actions for administrators only.
- Each decision is written to the console log with the administrator and the device ID.

### 5. Automatic approval rules (phase 2)

Rules are kept in a new table `admission_rule` (`name`, `kind`, `pattern`, `enabled`). A pending
device that matches an enabled rule is approved, with `admitted_by = rule:<name>`.

| Kind | Matches | Checked when |
|---|---|---|
| `subnet` | source IP of the device's system info upload (trusted client IP) in a CIDR | system info upload |
| `hostname` | reported hostname, exact or `*` glob, case-insensitive | system info upload |
| `owner-group` | the device owner (OIDC login on the device) is in a group | owner login |

The api-server checks the rules at these events, so hbbs keeps only the enforcement. The console
shows that hostnames are reported by the device itself and are trustworthy only on managed
machines or with client attestation ([design-trusted-builds.md](design-trusted-builds.md)).

## Interplay

- **Login enforcement:** `LOGGED_IN_ONLY` decides who may connect; admission decides to what.
  Both apply.
- **Same-user access:** applies only to approved devices.
- **Control roles:** per-user permissions (`ControlPermissions`) are decided after admission.
- **Client attestation:** a later layer that limits registration to our builds; admission does
  not depend on it.
- **Charts:** one value sets `DEVICE_ADMISSION` on hbbs and the api-server.

## Out of Scope

- Telling the device that it is pending. Stock clients cannot show it; our builds may add it later.
- Alarm records for refused connections.

## Testing

- hbbs: switch off keeps today's behaviour; a pending, rejected or key-changed device is refused
  for logged-in and anonymous viewers; an approved device is allowed; a pending device can still
  connect out as a viewer.
- api-server: migration marks existing devices approved; approve, reject and reset through CLI and
  API; non-administrators are refused; phase 2 rules approve on the right events and never approve
  a rejected device.
- e2e: with the switch on, a new device is refused until it is approved in the console, then a
  session opens.
