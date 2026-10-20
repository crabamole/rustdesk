# Design: Clipboard Text on Request

**Status: designed, not implemented.**

## Goal

Viewer → device clipboard text moves only when an app on the device reads the clipboard, as
RDP does (delayed rendering). A copy on the viewer sends the format names only, never the
content. The clipboard audit ([design-clipboard-monitoring.md](design-clipboard-monitoring.md))
builds on this: a transfer then means a paste on the device.

Scope: plain text, RTF and HTML, viewer → device. File copy and the device → viewer direction do
not change.

## Today

- The native viewer runs one clipboard listener (`src/client.rs`, `try_start_clipboard`). On
  each local change it reads the content and pushes `MultiClipboards` to every open session,
  pasted or not. It also syncs the content when a session starts.
- The web client sends the browser clipboard when the pointer enters the session view and before
  it forwards Ctrl/Cmd+V.
- The device writes what arrives at once (`connection.rs` → `clipboard::update_clipboard` →
  arboard, in `--server`).
- File copy is already on request (`Cliprdr` messages). It is file-only on every platform and
  stays as it is.

## Design

### Protocol

New messages in `message.proto`, in the `Message` union:

- `ClipboardOffer { uint32 seq; repeated ClipboardFormat formats; }`, viewer → device. Format
  names only: `Text`, `Rtf`, `Html`.
- `ClipboardRequest { uint32 seq; ClipboardFormat format; }`, device → viewer, when an app on the
  device reads the clipboard.
- `ClipboardReply { uint32 seq; Clipboard clipboard; }`, viewer → device. The `clipboard` is
  empty when `seq` is stale or the format is gone. A new reply message keeps the existing
  `Clipboard` handler, which writes at once, out of this flow.

The device sets `lazy_text_clipboard: true` in PeerInfo `platform_additions` only when its
provider started. Older devices, stock devices and Wayland desktops without the portal
clipboard do not set it.

### Rules

- The viewer sends `ClipboardOffer` to devices with the flag, on each local change and when the
  session starts. It never sends `Clipboard` or `MultiClipboards` text.
- To a device without the flag the viewer sends no text, and the session shows "Paste into this
  device needs a newer version" once.
- The device ignores `Clipboard` and `MultiClipboards` text from every viewer, stock viewers
  included. Paste works only through offer and request.
- The last offer wins. Requests go to the connection that sent it. When that connection closes,
  the device clears its entry.
- A request waits up to 5 s for the reply; on a timeout the app on the device gets empty data.
- `seq` grows with each offer. The viewer answers a request for an older `seq` with an empty
  reply, so a paste never gets content copied after that offer.
- The gates do not change: clipboard on, the connection's clipboard permission, Remote
  connections only.

### Device

New module `src/server/lazy_clipboard/`: `mod.rs` holds the owner connection, `seq`, the pending
requests with their timeout, and the capability flag; one file per platform places the lazy entry
and calls `mod.rs` when an app reads it. `connection.rs` gets thin hooks: offer, reply,
connection closed, ignore eager text. All providers run in `--server`, where text writes run
today.

| Platform | Place the entry | When an app reads it |
|---|---|---|
| Windows | A hidden window takes clipboard ownership and calls `SetClipboardData(fmt, NULL)` for CF_UNICODETEXT, "Rich Text Format" and "HTML Format" | `WM_RENDERFORMAT`: request, wait, `SetClipboardData`. `WM_RENDERALLFORMATS`: render nothing. `WM_DESTROYCLIPBOARD`: drop the state |
| macOS | `NSPasteboardItem` with `setDataProvider_forTypes` for `public.utf8-plain-text`, `public.rtf`, `public.html` (as the file code does) | `provideDataForType`: request, wait, set the data |
| Linux X11 | Our own `CLIPBOARD` selection owner (`x11rb`); `TARGETS` from the offer | `SelectionRequest` for `UTF8_STRING`, `text/plain;charset=utf-8`, `text/rtf`, `text/html`: request, wait, reply; INCR for large data |
| Linux Wayland | `RequestClipboard` on our `RemoteDesktop` portal session before `Start`; `SetSelection(mime types)` on an offer | `SelectionTransfer(mime, serial)`: request, wait, `SelectionWrite(serial)`, write the fd, `SelectionWriteDone` |

The lazy entry also carries our owner marker (`dyn.com.rustdesk.owner`) at once. RustDesk's
own clipboard readers, such as the device → viewer clipboard service, check the marker before
they read any text format. Otherwise they would read the entry, which sends a request and makes
the transfer eager again.

### Viewer

- **Native** (Flutter desktop on Windows, macOS, Linux): the listener reads only the format list
  on a change and sends offers. A new function answers `ClipboardRequest`: it checks `seq`, reads
  the one format at that moment in `spawn_blocking`, and sends `ClipboardReply`. The text push and
  the text sync at session start go.
- **Web** (`flutter/web/js/src/connection.ts`): the page cannot watch the clipboard, so it offers
  `Text` and `Html` without reading, when the pointer enters the session view and before it
  forwards Ctrl/Cmd+V. On a request it calls `navigator.clipboard.read()` or `readText()`. When the
  browser refuses (Firefox and Safari without a user gesture) it sends an empty reply and shows
  "This browser does not allow paste into the remote device" once. No fallback. The current
  send goes.
- **Android, iOS**: not changed. Devices with the flag ignore their eager text.

## Errors

- Timeout, or the connection closes during a request: the app gets empty data; the device logs a
  throttled warning.
- Stale `seq`: empty reply.
- The provider does not start: no flag, no text to that device; the device logs why once.

## Limits

- A clipboard manager on the device (GNOME, possibly Windows clipboard history) reads the entry
  at once, so the transfer is eager there. The audit counts these reads.
- Firefox and Safari web viewers cannot paste into the device.
- Android and iOS viewers cannot paste into devices with the flag.
- Wayland desktops whose portal has no clipboard interface get no text.
- Images are no longer sent to the device.
- A paste after the viewer disconnected gets nothing.
- The note about a device without the flag shows on every connection to it, also on a reconnect.
- Text that came into the viewer from another device (sync between sessions, or text on the
  viewer's clipboard that RustDesk wrote) is not offered to a device with the flag.

## Open Risks (prototype first)

1. Windows: `--server` runs as SYSTEM in the user's session. Eager writes work from it; delayed
   rendering from a SYSTEM-owned window is not verified. If it fails, the Windows provider moves
   to `--cm` (user) and takes requests over IPC, as file copy does.
2. macOS: the provider callback runs on the main thread of `--server` and blocks up to 5 s. Check
   what else runs on that thread; the file provider is the reference.
3. Wayland: the portal clipboard on a GNOME Wayland VM.

## Regression Surface

- `client.rs`: the viewer's text push and the text sync at session start.
- `connection.rs`: the text handlers ignore eager text.
- RustDesk's own clipboard readers: the owner-marker check comes first.
- `libs/scrap/src/wayland/remote_desktop_portal.rs`: `RequestClipboard`.
- Web client: the clipboard send.

File copy, the device → viewer direction and one-way clipboard do not change.

## Version Pairing

Clients only (next release); no server change. Viewers and devices upgrade together: with an older
client on either side, text paste does not work. The release notes and `UPGRADING.md` say so.

## Testing

- Rust unit: offer state, `seq` and the owner connection; timeout and empty reply; stale `seq`;
  the entry cleared when the connection closes; eager text ignored; the owner-marker check.
- Web unit: offer on pointer enter and on Ctrl/Cmd+V; reply on request; empty reply and the note
  when the read fails.
- e2e: web Chromium (clipboard permission) → Ubuntu VM (X11): after a copy the device log shows no
  request; `xclip -o` on the VM returns the text and the request appears only then; a later copy
  gives the new text. Firefox → VM: paste gives nothing, the note shows. Native matrix (macOS →
  Linux, Windows → macOS, Linux → Windows): paste on each device gets the text; the one-way
  clipboard checks stay.

## Next

Clipboard audit: the device writes one record per answered request (format, size, viewer
connection, time; never the content), from the reply handler in `lazy_clipboard/mod.rs`.
