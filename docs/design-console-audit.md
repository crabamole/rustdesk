# Design: Disconnect and Console Action Log

**Status: implemented** (api-server roadmap, Phase 2 Audit Logging).

## Goal

1. An admin ends an active connection from the console's audit page.
2. Every admin change to users, groups, address books and the device policy, every disconnect,
   and every admin command of the CLI (promote, demote, policy re-push) leaves a row in the console log.

Both are api-server work only. hbbs, hbbr and the clients do not change: stock RustDesk and our
builds already close a connection when the heartbeat answer names it.

## Today

- A device sends `POST /api/heartbeat` with `id`, `uuid` and `conns` (its live connection ids):
  every 3 seconds while it has connections, every 15 seconds without. The client closes each
  connection listed in the answer's `disconnect` ("Closed manually by web console"). The
  api-server never sends `disconnect`.
- Each connection has one `audit_conn` row. The `info` JSON holds the device `uuid` and
  `conn_id`. The heartbeat already ends open rows whose `conn_id` the device no longer lists.
- The `audit_console` table and `GET /api/audits/console` exist, but nothing writes rows.

## Disconnect

**API.** `POST /api/audits/conn/<guid>/disconnect`, admins only. Answers:

| Answer | When |
|---|---|
| 200 | The request is stored. A repeat request also answers 200 and keeps the first time. |
| 404 | No row has that guid. |
| 409 | The row has already ended. |

**Storage.** A migration adds `audit_conn.disconnect_at timestamptz`. The request sets it.

**Delivery.** In the heartbeat handler, after the existing step that ends rows the device no
longer lists, one query selects the `conn_id` of the device's rows (`id` + `uuid`) where all hold:

- the row is open;
- `disconnect_at` is set;
- `conn_id` is in the heartbeat's `conns`.

The query runs only when `conns` is not empty. `HeartbeatResponse` gets `disconnect: [conn_id]`,
left out when empty.

The answer repeats on each heartbeat until the row ends, so a lost heartbeat answer does no harm,
and the device ignores ids it does not know. The row ends through the device's `close` record or
through the existing heartbeat check.

**Console.** On the Connections tab, an active row has a **Disconnect** button with a confirm step.
Until the row ends, it shows "Disconnecting…". The connection list gets the field
`disconnect_requested` (bool).

**Device offline.** The mark stays. The row ends when the device's next heartbeat no longer lists
the connection.

## Console Action Log

**When a row is written.** After an admin change succeeds, the handler calls one helper,
`log_console(operator, typ, iop, info)`. `typ` and `iop` are Pro's codes
(audit-api-spec.md §9.4); codes 23 and up and `typ` 4 are ours.

| Area | Action | `typ` | `iop` |
|---|---|---|---|
| Group | `POST /api/group` | 0 | 1 Add Group |
| Group | `PUT /api/group` | 0 | 10 Update Group |
| Group | `DELETE /api/group/<guid>` | 0 | 4 Delete Groups |
| User | `POST /api/user` | 1 | 2 Add User |
| User | `DELETE /api/user` | 1 | 13 Delete User |
| User | `POST /api/enable-users` | 1 | 6 Enable Users / 7 Disable Users |
| User | `PUT /api/user` (any caller) | 1 | 11 Update User |
| User | CLI `admin promote` / `admin demote` | 1 | 23 Promote Admin / 24 Demote Admin |
| Device | Disconnect | 2 | 5 Disconnect Device |
| Address book | `POST /api/ab/shared/add` | 3 | 15 Add Address Book |
| Address book | `DELETE /api/ab/shared` | 3 | 16 Delete Address Book |
| Address book | `PUT /api/ab/shared/update/profile` | 3 | 17 Change Address Book Name |
| Address book | `POST /api/ab/rule` / `DELETE /api/ab/rule` | 3 | 20 Add / 21 Delete AB Permission |
| Policy | `PUT /api/strategies/<guid>` | 4 | 25 Update Policy |
| Policy | `POST /api/strategies/<guid>/repush` | 4 | 26 Re-push Policy |
| Policy | CLI `policy repush` | 4 | 26 Re-push Policy |

Not logged:

- `PUT /api/oidc/settings`, which changes nothing.
- Users' own address-book entries, which are user actions, not admin actions.

**Row content.** `operator` is the user's guid. `info` holds the target and the new values, for
example `{"email":"alice@example.org","admin":true}` or
`{"options":{"enable-clipboard":"N"}}`. A disconnect row holds the device ID, `conn_id`, viewer and
viewer user. Rows never contain secrets or tokens. Old values are not stored.

**CLI.** A migration makes `audit_console.operator` nullable. The CLI writes rows with no operator
and `info.via = "cli"`. The console shows the operator as "CLI".

**Write failure.** If the row cannot be written, the change still succeeds and the server logs an
error, as for the other audit writes.

**Reading.** `GET /api/audits/console` returns rows newest first, with Pro's paging (`current`,
`pageSize`, `created_at`). `operator` is a LIKE pattern on the user name. Fields: `guid`, `typ`,
`iop`, `operator` (name, or "CLI"), `info` (object), `created_at`.

**Console.** The audit page gets a **Console** tab with the columns Time, Operator, Area, Action
and Details, and a filter by operator.

## Changes

| Where | Change |
|---|---|
| Migration | `audit_conn.disconnect_at`; `audit_console.operator` nullable |
| `src/lib.rs` | Disconnect endpoint; `disconnect` in the heartbeat answer; `log_console` calls in the admin handlers; the console log list |
| `libs/state` | Mark, delivery query, console row write and list |
| `src/cli.rs` | Rows for promote and demote |
| `webconsole` | Disconnect button; Console tab; code labels |
| `docs/audit-api-spec.md` | §9 console log and our codes; §10 disconnect endpoint; §14 status |

## Regression Surface

- **Heartbeat:** one more query, only when the heartbeat lists connections. Without connections,
  the heartbeat works as before.
- **Admin handlers and CLI:** one INSERT after a successful change. Their answers do not change.
- **`audit_conn`:** a new nullable column that existing writes do not touch.

## Testing

**State:**

- A marked connection is returned on a heartbeat from its own device when it is in `conns`.
- It is not returned for another device's id or uuid, when it is not in `conns`, or after the
  row ends.
- Console rows have the right codes and `info`, and no secret fields.
- The CLI writes a row with no operator.

**Integration:**

- The disconnect endpoint answers 403 for a non-admin, 404 for an unknown guid and 409 for an
  ended row.
- One test per area checks that a change writes its row and that a failed change writes none.

**e2e:**

- A web-client session to a test device; the admin clicks Disconnect; the session closes within
  15 seconds; the row ends and a console row appears.
- An admin enables a user in the console, and the Console tab shows the row.

## Not Included

- **Retention:** a separate design.
- **Roles:** Pro's `audits.edit` and `audits.view`. Only admins disconnect and read the console log.
- **Disconnect from other pages,** such as Devices.
