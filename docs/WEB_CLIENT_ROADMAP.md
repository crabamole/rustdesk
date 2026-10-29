# RustDesk OSS Web Client Roadmap

**Updated:** 2026-10-29

Upstream RustDesk removed the open-source web client in favor of a closed-source Pro offering. This roadmap tracks our effort to revive and maintain the web client against the OSS rendezvous server (hbbs/hbbr).

## Next

The web client is the way to view without an install (no portable native build is planned). No item is planned now.

## Architecture Overview

```
Flutter Dart UI (93% shared with desktop/mobile)
       |
   web/bridge.dart (JS interop, 115 methods stubbed)
       |
   JS bridge: globals.js (setByName/getByName dispatch)
       |
   connection.ts (WebSocket + protobuf to hbbs/hbbr)
```

The web client shares ~68K lines of Dart with native clients. The web-specific layer is ~4K lines of Dart + ~2.5K lines of TypeScript/JavaScript. The JS layer reimplements the connection protocol over WebSocket; it does not compile Rust to wasm.

## Status

### Done

- [x] Restore web client JS source from git history
- [x] Load server config (host/key) from `config.json` instead of localStorage; the relay comes from hbbs
- [x] Skip public server latency test and `refreshCurrentUser` for OSS server
- [x] Fix JS bridge: option handlers (`option:local`, `option:user:default`), `jsonfyForDart` double-encoding
- [x] Remove Firebase analytics
- [x] Fix JS build for modern Node.js/TypeScript
- [x] Make server settings UI read-only on web
- [x] UI language follows the browser (or `?lang=<code>`), English as fallback; the web settings have no language choice
- [x] Add a Dockerfile for containerized builds
- [x] Remove untested wss:// support (restored later, tested; see WSS support in Phase 3)
- [x] Loads nothing from the internet: CanvasKit and fonts come from the web client itself
- [x] Never falls back to public servers; shows when no server is configured
- [x] Dials only the relay URL hbbs hands out (no relay setting)
- [x] Log in first: the login button replaces the ID field until the user logs in (1.5.0-1)
- [x] Named cRustDesk; the powered-by link is hidden (1.5.0-5); the page and browser tab are titled cRustDesk, without "(Preview)"
- [x] Never runs a session without end-to-end encryption: a failed key check ends the connection instead of continuing unencrypted ([design-e2ee-required.md](design-e2ee-required.md))
- [x] Decodes video with WebCodecs where the browser has it: VP9, plus H264 and H265 when the browser decodes them, so devices with a hardware encoder send those. A device without one sends VP9. Needs a browser with WebCodecs (Chrome or Edge 94, Safari 16.4, Firefox 130 or later); an older browser shows a message instead of connecting. No codec menu: the device picks the codec, as it does for native viewers on Auto

### Phase 1: Testing Infrastructure

Establish test coverage as a foundation for opinionated development.

- [x] **JS unit tests (vitest)**: vitest in `flutter/web/js/` — 8 suites (url, globals, connection, websock, common, lang, ui, pkce), ~82% line coverage. Original priority targets:
  - `getrUriFromRs()` / `getDefaultUri()` — URI construction logic
  - `jsonfyForDart()` — payload serialization
  - `getByName`/`setByName` option handlers — defaults, read/write, server config blocking
  - `loadConfig()` — config.json parsing and fallback behavior
- [x] **CI gating**: `web-docker.yml` runs `yarn test` (vitest) before building the web image; Flutter tests do not run in CI
- [x] **E2E smoke test**: end-to-end tests `webclient-linux` / `webclient-mac` log in via OIDC, connect to real Linux and macOS peers through hbbs/hbbr, and verify the remote desktop screenshot

### Phase 2: Connection Reliability

- [x] Connection failures show the native client's texts. A browser gets no detail for a failed WebSocket, so where native shows an operating system or library error the web client shows a fixed text ("Failed to connect to rendezvous server", "Reset by the peer")
- [x] A silent relay ends the session: after 12 s without a message (`Websock.next()` timeout) the web client shows "Reconnect" and reconnects through another relay; verified with a frozen hbbr pod (e2e `ha/hbbr-freeze.spec.ts`, back within about 17 s)
- [x] A dropped connection is retried as in the native client: a WebSocket that closes, times out or cannot connect shows Reconnect with a countdown (1, 2, 4, 8 s …); a device that is briefly offline after a drop is retried for 30 s; refusals (not logged in, not admitted, key mismatch, unknown ID) are not retried. Verified with a killed hbbr process and the browser offline for 15 s (e2e `webclient-reconnect`)
- [x] Recent sessions list the devices this browser connected to, newest first, from `localStorage['peers']` ([#31](https://github.com/crabamole/rustdesk/issues/31))
- [x] Session history works as on native clients: Delete, Rename, Forget password and Favorites on a stored session, without an open connection; logging out keeps the history, as native does
- [x] Session toolbar and actions work as on native clients (2026-10-26): Display and Keyboard toggles reach the device (show remote cursor, mute, disable clipboard, lock after session end, view mode, show my cursor, …) and stay set; scale and scroll style, image quality (also custom quality and FPS), resolution; text chat; Close ends the connection at once; Note reaches the connection's audit; Remember password; saved OS password; Settings defaults for view style and image quality. Before, the bridge used names the JS side never handled and most of these were silent no-ops
- [x] Map keyboard mode, as native: the peer platform's own key codes (tables from rdev), Caps/Num Lock, Ctrl/Cmd+V offers the clipboard first; verified on Linux, macOS and Windows devices
- [x] Keys typed into a session dialog stay in the dialog (they also went to the remote device)
- [x] Main page: online status of device cards, address book and group cache
- [x] The remote cursor shape is the local mouse cursor
- [x] More native session features (2026-10-27): Take screenshot (Save as downloads the PNG, Copy puts the image on the clipboard); Copy fingerprint (the device key); choosing a monitor shows it (the request carried the wrong display number, and the new display's first frame was lost while the decoder reloaded); follow remote cursor and window across monitors; display changes during a session; privacy mode and block user input with the device's replies; virtual displays (RustDesk and Amyuni drivers); choosing the Windows user session to view; the block input and privacy mode permissions hide what the device denies. A link `<web client>/#/<id>` opens a session to that device; a password in the link is ignored
- [x] Session options are readable as soon as the session starts (Flutter read them before the connection loaded them)
- [x] Frame rate does not depend on the network round trip: the device no longer waits for the browser to acknowledge each frame (as native). Before, a path with a 0.5 s round trip gave 1-2 fps. A browser that falls behind by 120 frames drops them and starts again at a new key frame, as native
- [x] Audit the 115 `UnimplementedError` stubs in `web/bridge.dart` (2026-10-29): no web screen, toolbar item or web event reaches 114 of them. The one left is `sessionSendPointer`, a two-finger pinch on the remote image with a touch screen; pinch is not supported on web (see Non-Goals). The stubs stay: the shared Dart code calls them

### Phase 3: Features

- [x] **WSS support**: `url.ts` resolves `/ws/id` to `wss://` on HTTPS pages (same-origin, behind a TLS-terminating reverse proxy); covered by `url.test.ts` and used in production over HTTPS
- [x] **Clipboard support**: text in both directions; respects the host's clipboard permission. Viewer → device is on request (1.5.0-4): when the pointer enters the remote view and before Ctrl/Cmd+V, the web client reads the browser clipboard and offers only its formats; the device asks for the text when an app on it reads the clipboard, and audits it ([design-clipboard-on-request.md](design-clipboard-on-request.md)). Reading needs the user's clipboard permission (Chromium); Firefox and Safari refuse reads without a user gesture
- [x] **Login without polling**: redeem a one-time result from a same-origin callback page with a PKCE verifier ([design-oidc-login.md](design-oidc-login.md))
- [x] **Viewer identity**: the login request names the logged-in user (`my_name`, as the native client sends it), so the device's connection prompt and the audit row's viewer name show the user instead of `web`; `my_id` stays `web` (a browser has no RustDesk ID)

### Phase 4: Operations

- [x] CI/CD pipeline: pushes to master build the Docker image; a version bump in `flutter/web/js/package.json` publishes it; the release workflow tags `<version>` for all clients (`web-client-<version>` before 1.4.9-7)
- [x] Helm chart: `oci://ghcr.io/crabamole/charts/rustdesk` with the webclient deployment; nginx serves the static files and the chart's Istio VirtualService routes `/ws/id`, `/ws/relay/<n>` and `/api/` to the servers
- [x] Health check endpoint or readiness probe (liveness/readiness probes in the Helm chart's webclient Deployment)
- [x] Deployment: the Helm chart README covers the web client
- [x] Documentation: config.json reference and a deployment diagram in [docker/web-client/README.md](../docker/web-client/README.md)

## Non-Goals

- **Rust-to-wasm compilation**: The JS protocol reimplementation works. Porting to wasm would be a rewrite, not an incremental improvement.
- **Feature parity with native clients**: The web client is for quick remote access, not a full replacement. Features like screen recording and the file manager are out of scope.
- **File transfer**: not planned; our DC build turns file transfer off on devices (data-out lock).
- **Auto-connect via URL parameters** (`?id=…&pw=…`): dropped until there is a secure design; a password in the URL ends up in browser history, proxy logs and the Referer header.
- **Codec menu and 4:4:4**: the codec menu stays native-only.
- **AV1**: the web client decodes VP9, H264 and H265 only.
- **Translate keyboard mode**: the web client offers Map mode only.
- **Restart remote device**: not supported; our builds turn remote restart off on devices, so the device denies it and the menu item stays hidden.
- **Pinch on the remote image**: not supported; a two-finger pinch on a touch screen reaches the `sessionSendPointer` stub.
- **Mobile browser**: no responsive layout or touch input; the supported viewers are Windows, macOS and Linux desktops.
- **2FA**: not supported yet on any client; the web client follows when the native clients get it.
- **Other native-only features**: terminal, camera, TCP tunneling and RDP, Switch Sides, direct IP and LAN discovery, WebRTC peer-to-peer (the web client always uses the relay), screen recording, voice call, Android navigation buttons and gestures.
- **Upstream merge**: This fork diverges intentionally from upstream's closed-source direction. We track upstream Dart/Flutter changes but own the web-specific layer.

## Key Files

| File | Purpose |
|------|---------|
| `flutter/web/js/src/connection.ts` | WebSocket connection to hbbs/hbbr |
| `flutter/web/js/src/webcodecs.ts` | Video decoding (WebCodecs) |
| `flutter/web/js/src/globals.js` | JS bridge (setByName/getByName dispatch) |
| `flutter/lib/web/bridge.dart` | Dart-side bridge (115 stubs) |
| `flutter/lib/models/web_model.dart` | Web platform FFI |
| `flutter/lib/mobile/widgets/dialog.dart` | Server settings dialog (read-only on web) |
| `flutter/web/config.json` | Server config (host/key) |
| `docker/web-client/Dockerfile` | Web client image: Opus audio decoder, Flutter web build, nginx |
