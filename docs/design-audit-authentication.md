# Design: Audit Records From Their Own Device

**Status: implemented (rustdesk-api, rustdesk-server; unreleased).**

## Goal

The api-server stores an audit record only when it comes from the device it names, and
attributes it to a viewer only when that viewer connected to that device. Devices never
log in, so "authenticated" here means proving ownership of the device ID, not a user login.

## Today

- The controlled device posts its records (`POST /api/audit/conn`, `/file`, `/alarm`,
  [audit-api-spec](https://github.com/crabamole/rustdesk-api/blob/main/docs/audit-api-spec.md)
  §3–§6) with its ID and its machine UUID, and no credentials.
- hbbs registers each device with its ID, machine UUID and public key (`peer` table). The
  api-server already matches heartbeats and system info on that UUID.
- For each connection request hbbs mints an audit reference for the viewer
  (`POST /api/audit/ref`) and forwards it to the device, which echoes it in its records.

## Design

1. **The machine UUID stays between the device and the servers.** The api-server no
   longer stores it in a device's system info and no longer returns it from device lists.
   Existing copies are removed by a migration.
2. **Records must match a registered device.** Connection, file and alarm records are
   stored only when their `(id, uuid)` matches a row in `peer`. Others get the normal empty
   2xx answer and are discarded with a warning in the log (spec §12.1: a 4xx would only make
   devices that are not registered yet retry and log errors). Session-menu notes (§4) keep
   their own check: they apply only to an existing row with the same ID and session.
3. **References are tied to their device.** hbbs sends the target device ID when it mints a
   reference (`POST /api/audit/ref?target=<id>`), and the api-server stores it. A record
   gets the viewer's user from a reference only when the record's device is that target;
   otherwise it is stored without a user.

## Limits

The machine UUID is not a secret against the device itself: local administrators, anyone
who can read the database, and hbbs can see it. This design stops records forged by anyone
who only knows a device ID. Records signed with the device's key (already registered with
hbbs) would stop the rest; that needs a client change and belongs with
[Client Attestation](design-trusted-builds.md).

## Compatibility

Stock and our clients send the same records, so no client change is needed. hbbs and the
api-server must be upgraded together: the api-server refuses a reference request without
a target, which an older hbbs treats as the api-server being unavailable (with
`LOGGED_IN_ONLY=Y` it refuses connections). Release notes and `UPGRADING.md` state the
pairing.

## Tests

- api-server: records with a wrong or missing UUID, or an unknown ID, are answered 2xx and
  not stored; a reference minted for device A attributes A's records and not B's; device
  lists carry no UUID; the migration removes stored copies.
- hbbs: the reference request carries the target ID for punch-hole and relay requests.
- e2e: real sessions are still attributed (existing audit specs); a forged record for a
  registered device is not stored.
