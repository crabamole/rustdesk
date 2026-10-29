# Web client release notes

Newest first. The web client CI copies a version's section into the GitHub Release `web-client-<version>`.

The web client has its own version. Up to 1.5.0-6 it shared one version with the native clients; see [release-notes.md](release-notes.md) for those releases.

## 2.0.0

UI from RustDesk 1.5.0.

- **The web client decodes video with WebCodecs and needs Chrome or Edge 94, Safari 16.4 or Firefox 130 or later**; an older browser shows a message instead of connecting. Besides VP9 it decodes H264 and H265 when the browser does, so a device with a hardware encoder can send those. The ogv.js decoder is removed.
- The frame rate no longer depends on the network round trip. The device no longer waits for the browser to acknowledge each frame, as with native viewers; over a path with a 0.5 s round trip a moving screen went from 1-2 to about 20 frames per second.
- Connection failures show the native client's texts. A WebSocket error showed "[object Event]".
- The About page shows the web client's own version.
- Works with cRustDesk 1.5.0-6 devices, rustdesk-server 1.1.16-7, rustdesk-api 3.9.0 and Helm chart 0.14.1.
