# Design: Device Admission

**Status: phases 1 and 2 (webhook) implemented (not released yet).**

## Problem

Any device that registers with hbbs can be controlled. A corporate deployment wants only the
machines it admitted to accept remote sessions, and every other device to act as a viewer at
most, without customizing the native client further.

## Goal

- A server switch `DEVICE_ADMISSION`, off by default. Off: every device can be controlled, as today.
- On: a new device is **pending** until an administrator admits it. Only **admitted** devices can
  be controlled. Pending and rejected devices can still connect to other devices as viewers.
- Phase 2: an admission webhook. The api-server asks a service the deployment owns, such as an
  asset inventory, to admit or reject pending devices. The decision logic stays outside RustDesk.
- Stock clients keep working. Our builds also show the device's state on the device.

## Device States

| State | Can be controlled | Set by |
|---|---|---|
| pending | no | new device while the switch is on; administrator |
| admitted | yes | administrator; the webhook (phase 2); every device registered while the switch is off |
| rejected | no | administrator |

The state belongs to the `peer` row, so it applies to the ID and the key hbbs accepted for it.
A key change keeps the state: hbbs accepts a new key for a known ID only after an administrator
key reset or an owner login ([design-device-key-change.md](design-device-key-change.md)), and
both confirm it is the same device. A reinstall therefore keeps the admission. A rejected device
stays rejected until an administrator changes it; the webhook never changes it.

Devices that register while the switch is off are admitted. The migration marks every existing
device admitted. Turning the switch on therefore affects only devices that register after it.

## Why Enforcement Is at Connect Time

Registration stays open. The administrator needs the device's hostname, OS, user and owner to
decide, and the api-server receives these only from a registered device: system info for an
unknown ID is dropped (`ID_NOT_FOUND`). A registered device that is not admitted does no harm,
because hbbs refuses every connection to it.

Both requests that set up a connection to a device go through `admit_viewer(token, target)` in
hbbs: `PunchHoleRequest` and `RequestRelay` forwarding. It checks the viewer's login and the
target ID only, not whether the viewer is registered, so pending devices keep working as viewers.

## Design

### 1. Data (api-server owns the schema)

New columns on `peer`:

- `admission` smallint: 0 pending, 1 admitted, 2 rejected. Migration default for existing rows: 1.
- `admission_at`, `admission_by` (user, `cli`, or `webhook` in phase 2): the last decision.

The key-change column `approved_pk` belongs to another feature (the owner confirmed a new key)
and is not reused.

### 2. Registration (hbbs)

hbbs reads `DEVICE_ADMISSION` (Y/N). When it creates a `peer` row, it sets `admission` to pending
when the switch is on and to admitted when it is off. Key changes leave `admission` unchanged.

### 3. Enforcement (hbbs)

Right after `admit_viewer`, in both connect paths, when the switch is on and the target is not admitted, hbbs refuses with `PunchHoleResponse.other_failure`:
"The connection is not allowed. This device is not admitted for remote control."

hbbs runs the login check first, as today, and then the admission check.
hbbs reads the admission state from Postgres and caches it per device for a few seconds,
so a decision takes effect within that time on every hbbs pod. A database error refuses the
connection (fail closed) when the switch is on.

hbbr needs no change: it relays only sessions that hbbs allowed.

### 4. Administration (api-server)

- Console: the Devices page gets an Admission column, a filter for pending devices and Admit / Reject / Pending buttons; the list shows ID, hostname, OS, user, IP and last online. The device list shows the state of every device.
- CLI: `rustdesk-api peer admit|reject|pending <id>`.
- API: the same actions for administrators only. (`POST /api/peers/<id>/admission`, body `{"admission": "admitted"}`)
- Each decision is written to the console log with the administrator and the device ID.

### 5. Admission webhook (phase 2)

Decision logic such as subnet checks, hostname lists or an asset inventory stays outside RustDesk.
The api-server asks a webhook that the deployment owns. hbbs and the clients do not change.

**Configuration.** `deviceAdmission.webhook.url` in the chart values; empty turns the webhook off.
The api-server signs requests with an Ed25519 keypair from a Secret (`deviceAdmission.webhook.keySecret`),
created once with `rustdesk-api admission keygen`. The chart checks that the Secret exists and that its
keys match. `rustdesk-api admission pubkey` and the console show the public key for the receiver. This
keypair is used for nothing else: not the hbbs keypair, not the custom client signing key.

**When the api-server calls it.** Only for pending devices, after:

- a system info upload (the client uploads on every start and when its info changes);
- an owner login on the device;
- the console button "Ask webhook" or `rustdesk-api peer admission-check <id>`.

The call runs in the background; the device's request does not wait for it. There are no automatic
retries: a failed call leaves the device pending until its next event or an administrator asks again.

**Request.** `POST <url>` with a JSON body:

| Field | Value |
|---|---|
| `id` | the device ID |
| `hostname`, `os`, `username` | from the device's system info (reported by the device) |
| `ip` | the address hbbs saw when the device registered |
| `owner` | `{name, email, group}` of the device's owner, or `null` |
| `first_seen` | when the device first registered (`peer.created_at`) |

Header `X-Admission-Signature: t=<unix seconds>,ed25519=<base64 signature of "<t>.<body>">`. The
receiver verifies the signature with the public key and refuses a request whose `t` is more than
5 minutes old. During a key rotation the receiver accepts both public keys for a short time.

**Response.** `200` with `{"decision": "admit" | "reject" | "pending", "reason": "<text>"}`. A timeout
(10 s), another status or an invalid body is an error and changes nothing. The api-server checks the
receiver's certificate; the chart's `extraCACerts` adds a company CA.

**Applying the answer.** The api-server changes the state only while the device is still pending, so
a decision by an administrator always stands. A decision is stored with `admission_by = webhook` and
written to the console log with the reason. Every call stores its time and its result (the decision,
or an error such as `timeout` or `HTTP 500`) on the device (new columns `admission_webhook_at`, `admission_webhook_result`), so the console can
show when the webhook last answered and what.

**Console.** The Devices page shows the last webhook result, an "Ask webhook" button for pending
devices, and the public key.

### 6. Client support (our builds)

Without it, a pending device shows "Ready" and its user cannot tell why nobody can connect. Our
desktop builds show the state on the device.

- **Source:** the device heartbeat (`/api/heartbeat`, every 15 s, sent with or without a login).
  When the switch is on, the api-server adds `"admission": "pending" | "admitted" | "rejected"` to
  the response. When the switch is off the field is absent and the client shows what it shows
  today. Stock clients ignore the field: they read only the keys they know
  (`disconnect`, `modified_at`, `strategy`).
- **Client state:** `hbbs_http/sync.rs` keeps the last value in memory, next to the existing
  key-change flag (`rendezvous_mediator.rs`), and the status that the UI reads over IPC carries it.
  A missing heartbeat answer keeps the last value; a restart starts with none.
- **Desktop UI:** the status line on the home page (`OnlineStatusWidget`) uses the existing
  `SvcStatus` pattern of `keyChangeRefused`:

  | State | Status text | Tip |
  |---|---|---|
  | pending | "Waiting for remote control approval" | `admission_pending_tip`: "Other devices cannot connect to this device until an administrator allows it. You can still connect to other devices." |
  | rejected | "Remote control not allowed" | `admission_rejected_tip`: "An administrator does not allow other devices to connect to this device. You can still connect to other devices." |

  The UI gets the state as `OnlineStatus` values -5 (pending) and -6 (rejected), like -4 for a refused key change; they apply only while the device is registered (online state 1).

  The ID stays visible, so the user can give it to the administrator. Outgoing connections work as
  before.
- **Viewer:** the refusal text from hbbs gets a lang entry, so our builds show it translated.
- Stock clients: the viewer sees the English refusal text; the device shows "Ready".

## Interplay

- **Login enforcement:** `LOGGED_IN_ONLY` decides who may connect; admission decides to what.
  Both apply.
- **Same-user access:** applies only to admitted devices.
- **Control roles:** per-user permissions (`ControlPermissions`) are decided after admission.
- **Client attestation:** a later layer that limits registration to our builds; admission does
  not depend on it.
- **Charts:** one value sets `DEVICE_ADMISSION` on hbbs and the api-server.

## Out of Scope

- The device state on mobile builds.
- Alarm records for refused connections.

## Known Limits

- Direct IP access (the device's own direct-server option) does not go through hbbs, so admission does not apply to it. Our DC builds lock direct access off.
- An admit or reject takes effect within about 5 s. hbbs caches the state per device.
- If hbbs keeps a device in memory but could not write its row (database up, insert failed), the check finds no row and does not refuse. A database outage still refuses.

## Testing

- hbbs: switch off keeps today's behaviour; a pending or rejected device is refused for logged-in
  and anonymous viewers; an admitted device is allowed, also after an accepted key change; a pending device can still
  connect out as a viewer.
- api-server: migration marks existing devices admitted; admit, reject and pending through CLI and
  API; non-administrators are refused; phase 2: the webhook is called on the right events with a valid signature,
  its decision applies only to pending devices, and errors change nothing.
- client: the heartbeat field sets the status line for pending, rejected and admitted, and a
  missing field shows "Ready".
- e2e: with the switch on, a new device is refused until it is admitted in the console, then a
  session opens.
