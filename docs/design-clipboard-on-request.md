# Design: Clipboard Text on Request

**Status: Plan B (protocol, X11 provider, viewers) and Plan C (Windows and macOS providers) implemented locally; Wayland not implemented.**

## Goal

The viewer sends clipboard text to the device only when a program on the device reads the
clipboard, as RDP does (delayed rendering). A copy on the viewer sends the format names only,
never the content. Usually that read is a paste, but programs that read the clipboard in the
background (security tools, clipboard managers) can cause it before a paste. The clipboard audit
([design-clipboard-monitoring.md](design-clipboard-monitoring.md)) builds on this: a transfer
then means a program on the device read the clipboard.

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
- `ClipboardRequest { uint32 seq; ClipboardFormat format; }`, device → viewer, when a program on
  the device reads the clipboard.
- `ClipboardReply { uint32 seq; Clipboard clipboard; }`, viewer → device. The `clipboard` is
  empty when `seq` is stale or the format is gone. A new reply message keeps the existing
  `Clipboard` handler, which writes at once, out of this flow.

The device sets `lazy_text_clipboard: true` in PeerInfo `platform_additions` only when its
provider started. Older devices, stock devices, Android devices and Wayland desktops do not
set it.

### Rules

- The viewer sends `ClipboardOffer` to devices with the flag, on each local change and when the
  session starts. It never sends `Clipboard` or `MultiClipboards` text.
- To a device without the flag the viewer sends no text, and the session shows "Paste into this
  device is not available with its version or platform" once.
- The viewer answers a request only when it is for the last offer the viewer sent on that
  connection; any other request gets an empty reply.
- The device ignores `Clipboard` and `MultiClipboards` text from every viewer, stock viewers
  included. Paste works only through offer and request.
- The last offer wins. Requests go to the connection that sent it. When that connection closes,
  the device clears its entry.
- A request waits up to 5 s (2 s on macOS) for the reply; on a timeout the program on the device
  gets empty data.
- `seq` grows with each offer. The viewer answers a request for an older `seq` with an empty
  reply, so a paste never gets content copied after that offer.
- The gates do not change: clipboard on, the connection's clipboard permission, Remote
  connections only.

### Device

New module `src/server/lazy_clipboard/`: `mod.rs` holds the owner connection, `seq`, the pending
requests with their timeout, and the capability flag; one file per platform places the lazy entry
and calls `mod.rs` when a program reads it. `connection.rs` gets thin hooks: offer, reply,
connection closed, ignore eager text. The hub in `mod.rs` runs in `--server`, where text writes
run today. The providers run there too, except on an installed Windows device (see the table).

| Platform | Place the entry | When a program reads it |
|---|---|---|
| Windows | A message-only window on its own thread owns the clipboard: `SetClipboardData(fmt, NULL)` for `CF_UNICODETEXT`, `"Rich Text Format"` and `"HTML Format"`, plus the owner marker with data. place and clear only post a message to that thread. On an installed device `--server` runs as SYSTEM, and Microsoft Defender reads a delayed text entry owned by a SYSTEM process at once, so the user's `--cm` process owns the window: `--server` sends it the offered formats over the existing `_cm` IPC (`LazyClipboard` messages), and the entry goes when that IPC connection ends. A portable copy runs as the user and keeps the window in `--server`. | `WM_RENDERFORMAT`: request, wait, `SetClipboardData` (UTF-16 text, `CF_HTML` header added to the fragment). With `--cm` as the owner, the request goes to `--server` over `_cm`, which asks the viewer and sends the data back. `WM_RENDERALLFORMATS`: render nothing. |
| macOS | A worker thread writes one `NSPasteboardItem`: a data provider for `public.utf8-plain-text`, `public.rtf`, `public.html`, and the owner marker with data. | `provideDataForType` (on the main thread): request, wait up to 2 s, set the data. |
| Linux X11 | Our own `CLIPBOARD` selection owner (`x11rb`); `TARGETS` from the offer | `SelectionRequest` for `UTF8_STRING`, `text/plain;charset=utf-8`, `text/rtf`, `text/html`: request, wait, reply; INCR for large data |

Wayland is not implemented: Wayland devices do not set the flag.

The lazy entry also carries our owner marker (`dyn.com.rustdesk.owner`) at once. RustDesk's
own clipboard readers, such as the device → viewer clipboard service, check the marker before
they read any text format. Otherwise they would read the entry, which sends a request and makes
the transfer eager again.

### Viewer

- **Native** (Flutter desktop on Windows, macOS, Linux): the listener reads only the format list
  on a change and sends offers. A new function answers `ClipboardRequest`: it checks `seq`, reads
  the one format at that moment in `spawn_blocking`, and sends `ClipboardReply`. The text push and
  the text sync at session start go.
- **Web** (`flutter/web/js/src/connection.ts`): the page cannot watch the clipboard. When the
  pointer enters the session view and before it forwards Ctrl/Cmd+V, it reads the browser
  clipboard locally (`navigator.clipboard.read()`, or `readText()`; 300 ms limit) and offers only
  when the text is not empty and differs from the last text it offered or the device sent. The
  offer lists `Text`, and `Html` only when the clipboard holds HTML. Ctrl/Cmd+V waits for this
  read, then goes to the device. Nothing is sent with the offer. On a request it reads the one
  format again. When the browser refuses a read (Firefox and Safari without a user gesture) it
  offers nothing or sends an empty reply, and shows "This browser does not allow paste into the
  remote device" once per connection. To a device without the flag it shows the note above once
  per connection. No fallback. The current send goes.
- **Android, iOS**: not changed. Devices with the flag ignore their eager text.

## Errors

- Timeout, or the connection closes during a request: the program gets empty data; the device logs a
  throttled warning.
- Stale `seq`: empty reply.
- The provider does not start: no flag, no text to that device; the device logs why once. On an
  installed Windows device the flag is set even when the user's session process is missing or its
  provider fails; then a paste gets nothing, and the failure is logged once a minute in that
  process's log.

## Limits

- A program on the device that reads the clipboard in the background (a security tool, a
  clipboard manager such as GNOME's or possibly Windows clipboard history) reads the entry at
  once, so the transfer is eager there. The audit counts these reads.
- Firefox and Safari web viewers cannot paste into the device.
- Android and iOS viewers cannot paste into devices with the flag.
- Desktop and web viewers cannot paste into Android devices or Wayland desktops (they do not
  set the flag).
- On a macOS device, remote input and the tray menu pause while a program waits for the viewer's
  text: for the network round trip, up to 2 s when the viewer does not answer.
- Images are no longer sent to the device.
- A paste after the viewer disconnected gets nothing.
- On an installed Windows device, paste at the logon screen gets no text until a user signs in (the
  clipboard entry lives in the user's session process).
- The note about a device without the flag shows on every connection to it, also on a reconnect.
- Text that came into the viewer from another device (sync between sessions, or text on the
  viewer's clipboard that RustDesk wrote) is not offered or sent to any device.

## Prototype Results

1. Windows: delayed rendering from the SYSTEM --server window works; the reader blocks until the
   data is set. But Microsoft Defender reads a SYSTEM-owned delayed text entry at once, and does
   not read the same entry owned by a user process, so the installed device places it from
   `--cm`.
2. macOS: the data provider runs on the main thread of --server and blocks it; accepted with a
   2 s limit.
3. Wayland: not prototyped; out of scope.

## Regression Surface

- `client.rs`: the viewer's text push and the text sync at session start.
- `connection.rs`: the text handlers ignore eager text.
- RustDesk's own clipboard readers: the owner-marker check comes first.
- Web client: the clipboard send.

File copy, the device → viewer direction and one-way clipboard do not change.

## Version Pairing

Clients only (next release); no server change. Viewers and devices upgrade together: with an older
client on either side, text paste does not work. The release notes and `UPGRADING.md` say so.

## Testing

- Rust unit: offer state, `seq` and the owner connection; timeout and empty reply; stale `seq`;
  the entry cleared when the connection closes; eager text ignored; the owner-marker check; the
  `--server` → `--cm` messages and their replies matched by id.
- Web unit: offer on pointer enter and on Ctrl/Cmd+V only for new text, `Html` only when present,
  the key after the offer; reply on request; no offer, empty reply and the note when the read
  fails; the note for a device without the flag.
- e2e: web Chromium (clipboard permission) → Ubuntu VM (X11): after a copy the device log shows no
  request; `xclip -o` on the VM returns the text and the request appears only then; a later copy
  gives the new text. Firefox → VM: paste gives nothing, the note shows. Native matrix (macOS →
  Linux, Windows → macOS, Linux → Windows): after the viewer's copy the device logs no request
  for 5 s; the device's read returns the text and only then logs a request; the one-way
  clipboard checks stay.

## Next

Clipboard audit: the device writes one record per answered request (format, size, viewer
connection, time; never the content), from the reply handler in `lazy_clipboard/mod.rs`.
