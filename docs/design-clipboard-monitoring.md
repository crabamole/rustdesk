# Design: Clipboard Text Audit

**Status: approved; not implemented.** Client side here; server side in
[crabamole/rustdesk-api](https://github.com/crabamole/rustdesk-api).

## Goal

The audit log shows each time clipboard text from a viewer arrives on a device: when, on which
device, from which viewer and user, which format and how many bytes. It never holds the text.

This builds on [design-clipboard-on-request.md](design-clipboard-on-request.md): the device gets
viewer text only when a program on it reads the clipboard, so one arrival is one record.

## Today

- Upstream RustDesk audits connections (`/api/audit/conn`), files (`/api/audit/file`, clipboard
  files included, with an empty `path`) and alarms (`/api/audit/alarm`). It has no clipboard-text
  event, and RustDesk Pro has no such endpoint.
- Our devices sign their audit calls with their device key; the api-server refuses unsigned
  device calls ([design-signed-device-calls.md](design-signed-device-calls.md)).

## Design

### When the device writes a record

One record per arrival: a program on the device read the clipboard entry, the device requested
the text, and the viewer's reply with non-empty text arrived for that open request. This covers
native and web viewers, because the device writes the record.

No record for:

- a request that times out, an empty reply, or a reply after the connection closed;
- clipboard files: they stay in the file audit, as upstream;
- the device → viewer direction: the device build locks it (one-way clipboard).

A program that reads the clipboard in the background (a security tool, a clipboard manager)
causes an arrival too, so it is recorded: text did enter the device.

### Record

`POST {api-server}/api/audit/clipboard`, signed like the other device calls:

```json
{
  "id": "<device id>", "uuid": "<b64 device uuid>",
  "peer_id": "<viewer id>", "conn_id": 17,
  "type": 1,
  "format": "text",
  "size": 123,
  "info": "{\"ip\":\"203.0.113.5\",\"name\":\"alice-laptop\"}",
  "nonce": "<uuidv4>"
}
```

| Field | Meaning |
|---|---|
| `type` | 1: viewer → device, as `RemoteReceive` in the file audit. Kept so the other direction can be added without a schema change. |
| `format` | `text`, `rtf` or `html`: the format the program asked for |
| `size` | bytes of the text after decompression |
| `info` | JSON string: viewer `ip` and `name`, as in the file audit |

The transport contract is the file audit's: `nonce` deduplication, an empty body when stored,
`{"error": ...}` otherwise, retries with backoff up to 2 minutes.

### Client

- `lazy_clipboard::on_reply` tells the connection when a reply matched an open request and held
  text: the format and the size.
- The connection then calls `post_clipboard_audit`, beside `post_file_audit`, which has the audit
  URL, `conn_id` and the viewer's details. The hook in `connection.rs` stays one line.

### api-server

- Table `audit_clipboard` (new migration): device id and uuid, viewer id, `conn_id`, `type`,
  `format`, `size`, viewer ip and name, the attributed user, unique `nonce`, time.
- `POST /api/audit/clipboard`: signed device call; the viewer's user is attributed through the
  connection, as for file records.
- `GET /api/audits/clipboard`: the console list, same filters and paging as `file`.
- Console: a **Clipboard** tab with Time, Device, Viewer, User, Direction, Format, Size, Address.
- `docs/audit-api-spec.md`: a section for the endpoint, marked as not upstream.

## Version Pairing

Clients 1.5.0-4 and rustdesk-api 3.8.0 (chart 0.13.0). A 1.5.0-4 device with an older api-server
gets 404, retries for 2 minutes and drops the record; nothing else changes. Older devices write no
clipboard records.

## Testing

- api-server: a signed record is stored and listed; the same `nonce` is stored once; an unsigned
  call is refused.
- Client: unit test that a matched reply with text yields format and size, and that an empty,
  stale or late reply yields nothing.
- End to end: a paste of viewer text on the device adds one record with the right format and size;
  a paste of text copied on the device adds none.

## Limits

- The record says that text arrived, not that a person pasted it (background readers).
- The api-server stores what the device reports; the size is the device's figure.
