# RustDesk OSS Web Client Roadmap

**Updated:** 2026-10-26

Upstream RustDesk removed the open-source web client in favor of a closed-source Pro offering. This roadmap tracks our effort to revive and maintain the web client against the OSS rendezvous server (hbbs/hbbr).

## Next

The web client is the way to view without an install (no portable native build is planned), so these come first:

1. Recent sessions always empty ([Phase 2](#phase-2-connection-reliability), [#31](https://github.com/crabamole/rustdesk/issues/31))
2. Clearer messages for connection failures, if the retry countdown is not enough ([Phase 2](#phase-2-connection-reliability))

## Architecture Overview

```
Flutter Dart UI (93% shared with desktop/mobile)
       |
   web/bridge.dart (JS interop, 118 methods stubbed)
       |
   JS bridge: globals.js (setByName/getByName dispatch)
       |
   connection.ts (WebSocket + protobuf to hbbs/hbbr)
```

The web client shares ~68K lines of Dart with native clients. The web-specific layer is ~4K lines of Dart + ~1.6K lines of TypeScript/JavaScript. The JS layer reimplements the connection protocol over WebSocket; it does not compile Rust to wasm.

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
- [x] Named cRustDesk; the powered-by link is hidden (1.5.0-5)

### Phase 1: Testing Infrastructure

Establish test coverage as a foundation for opinionated development.

- [x] **JS unit tests (vitest)**: vitest in `flutter/web/js/` — 8 suites (url, globals, connection, websock, codec, common, lang, ui), ~80% line coverage. Original priority targets:
  - `getrUriFromRs()` / `getDefaultUri()` — URI construction logic
  - `jsonfyForDart()` — payload serialization
  - `getByName`/`setByName` option handlers — defaults, read/write, server config blocking
  - `loadConfig()` — config.json parsing and fallback behavior
- [ ] **Flutter widget tests**: Extend existing `server_settings_dialog_test.dart` for `readOnly` parameter. Add tests for web-specific UI behavior (read-only server settings, close-only dialog).
- [x] **CI gating**: `web-docker.yml` runs `yarn test` (vitest) before building the web image; Flutter tests do not run in CI
- [x] **E2E smoke test**: end-to-end tests `webclient-linux` / `webclient-mac` log in via OIDC, connect to real Linux and macOS peers through hbbs/hbbr, and verify the remote desktop screenshot

### Phase 2: Connection Reliability

- [ ] Improve error handling for connection failures (clear user-facing messages)
- [x] A silent relay ends the session: after 12 s without a message (`Websock.next()` timeout) the web client shows "Reconnect" and reconnects through another relay; verified with a frozen hbbr pod (e2e `ha/hbbr-freeze.spec.ts`, back within about 17 s)
- [x] A dropped connection is retried as in the native client: a WebSocket that closes, times out or cannot connect shows Reconnect with a countdown (1, 2, 4, 8 s …); a device that is briefly offline after a drop is retried for 30 s; refusals (not logged in, not admitted, key mismatch, unknown ID) are not retried. Verified with a killed hbbr process and the browser offline for 15 s (e2e `webclient-reconnect`)
- [ ] Recent sessions always empty: `load_recent_peers` is never answered ([#31](https://github.com/crabamole/rustdesk/issues/31))
- [ ] Audit the 118 `UnimplementedError` stubs in `web/bridge.dart` — categorize as: needed, not-applicable-to-web, or deferred

### Phase 3: Features

- [x] **WSS support**: `url.ts` resolves `/ws/id` to `wss://` on HTTPS pages (same-origin, behind a TLS-terminating reverse proxy); covered by `url.test.ts` and used in production over HTTPS
- [x] **Clipboard support**: text in both directions; respects the host's clipboard permission. Viewer → device is on request (1.5.0-4): when the pointer enters the remote view and before Ctrl/Cmd+V, the web client reads the browser clipboard and offers only its formats; the device asks for the text when an app on it reads the clipboard, and audits it ([design-clipboard-on-request.md](design-clipboard-on-request.md)). Reading needs the user's clipboard permission (Chromium); Firefox and Safari refuse reads without a user gesture
- [ ] **Mobile browser**: Responsive layout and touch input handling
- [x] **Login without polling**: redeem a one-time result from a same-origin callback page with a PKCE verifier ([design-oidc-login.md](design-oidc-login.md))
- [x] **Viewer identity**: the login request names the logged-in user (`my_name`, as the native client sends it), so the device's connection prompt and the audit row's viewer name show the user instead of `web`; `my_id` stays `web` (a browser has no RustDesk ID)

### Phase 4: Operations

- [x] CI/CD pipeline: pushes to master build the Docker image; a version bump in `flutter/web/js/package.json` publishes it; the release workflow tags `<version>` for all clients (`web-client-<version>` before 1.4.9-7)
- [x] Helm chart: `oci://ghcr.io/crabamole/charts/rustdesk` with the webclient deployment; nginx serves the static files and the chart's Istio VirtualService routes `/ws/id`, `/ws/relay/<n>` and `/api/` to the servers
- [x] Health check endpoint or readiness probe (liveness/readiness probes in the Helm chart's webclient Deployment)
- [x] Deployment: the Helm chart README covers the web client
- [ ] Documentation: config.json reference, architecture diagram

## Non-Goals

- **Rust-to-wasm compilation**: The JS protocol reimplementation works. Porting to wasm would be a rewrite, not an incremental improvement.
- **Feature parity with native clients**: The web client is for quick remote access, not a full replacement. Features like screen recording, file manager, multi-monitor are out of scope.
- **File transfer**: not planned; our DC build turns file transfer off on devices (data-out lock).
- **Auto-connect via URL parameters** (`?id=…&pw=…`): dropped until there is a secure design; a password in the URL ends up in browser history, proxy logs and the Referer header.
- **Upstream merge**: This fork diverges intentionally from upstream's closed-source direction. We track upstream Dart/Flutter changes but own the web-specific layer.

## Community Forks

Reviewed for feature inspiration (none have strong traction):

| Fork | Stars | Status | Notable Features |
|------|-------|--------|-----------------|
| MonsieurBiche/rustdesk-web-client | 20 | Stale (Oct 2024) | WSS, auto-connect URL params, mobile fixes |
| pmietlicki/docker-rustdesk-web-client | 27 | Active | Docker packaging |
| linkzy/rustdesk-custom-web-client | 3 | New (2026) | Self-hosted relay focus |

## Key Files

| File | Purpose |
|------|---------|
| `flutter/web/js/src/connection.ts` | WebSocket connection to hbbs/hbbr |
| `flutter/web/js/src/globals.js` | JS bridge (setByName/getByName dispatch) |
| `flutter/lib/web/bridge.dart` | Dart-side bridge (118 stubs) |
| `flutter/lib/models/web_model.dart` | Web platform FFI |
| `flutter/lib/mobile/widgets/dialog.dart` | Server settings dialog (read-only on web) |
| `flutter/web/config.json` | Server config (host/key) |
| `docker/web-client/Dockerfile` | Web client image: browser codecs, Flutter web build, nginx |
