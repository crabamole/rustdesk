# Native Client Build Roadmap

**Updated:** 2026-10-01

Stock RustDesk clients work with our server stack, but some features need a client built from this fork. This roadmap tracks what shipping our own Windows, macOS and Linux builds requires, and the features waiting on it.

## Build Pipeline

The native-client workflows were archived in `.github/workflows-archive/` (only the web client image is built); `flutter-build.yml` there is the starting point.

- [ ] CI builds for Linux (`.deb`), Windows and macOS from this fork
- [x] `custom.txt` signing key is a required build parameter (`RUSTDESK_CUSTOM_CLIENT_PK`, base64 Ed25519 public key); builds fail without it and never trust RustDesk's key. Sign with `rustdesk-utils signcustom` (rustdesk-server)
- [ ] macOS: Apple Developer ID signing and notarization (Gatekeeper)
- [ ] Windows: code-signing certificate (SmartScreen)
- [ ] Release process: versioning, publishing, tracking upstream releases
- [ ] Pre-seed guides updated for our packages (`linux-preseed-install.md`, `macos-preseed-install.md`)

Linux needs no signing, so a Linux-only build is the cheapest way to prove the features below.

## Features Waiting on Our Builds

### One-Way Clipboard
- [ ] Hosts never send their clipboard to viewers; viewers can still paste into hosts
- `one-way-clipboard-redirection` is a built-in setting: only a signed `custom.txt` (under `override-settings`) or a compile-time default sets it. `RustDesk2.toml` and strategy push are ignored
- **Today:** turn clipboard off entirely (`enable-clipboard=N`, pushable by policy)
- Design: [design-clipboard-direction.md](design-clipboard-direction.md)

### Locked Settings
- [ ] Security settings that local admins cannot change
- Needs our `custom.txt` signing key (`override-settings`) or compile-time defaults
- **Today:** file permissions, `chattr +i`, MDM; strategy push re-applies policy options when the policy changes
- Design: [design-config-enforcement.md](design-config-enforcement.md)

### Client Attestation
- [ ] hbbs accepts device registrations only from our builds
- Needs a token in our builds and a check in hbbs (rustdesk-server)
- **Today:** none
- Design: [design-trusted-builds.md](design-trusted-builds.md)

### Native Login with PKCE
- [ ] Native clients log in with the authorization code flow, PKCE and a loopback redirect (RFC 8252)
- [ ] api-server fully validates the ID token; chart setting to turn off the polling login flow
- **Today:** polling login with a confirmation page for logins from native clients
- Tracked in [api-server-roadmap.md](api-server-roadmap.md) (Phase 2)

### WebSocket Port for Hostnames ([#30](https://github.com/crabamole/rustdesk/issues/30))
- [ ] Keep a non-default port when the rendezvous server is a hostname (`check_ws()` in `hbb_common`)
- **Today:** serve WebSocket on port 80 (ws) or 443 (wss)

### Clipboard Audit
- [ ] Hosts report clipboard transfers to the api-server
- About 30 lines in `src/server/connection.rs` and `src/server/clipboard_service.rs`
- **Today:** connection audit only (works with stock clients)
- Design: [design-clipboard-monitoring.md](design-clipboard-monitoring.md)

### OIDC-Only Login Form
- [ ] Hide the username/password fields; the api-server accepts OIDC logins only, so password logins from stock clients always fail
- **Today:** users pick the OIDC button

### ScreenCaptureKit on macOS ([#26](https://github.com/crabamole/rustdesk/issues/26))
- [ ] ScreenCaptureKit video backend behind the `screencapturekit` feature, parked on branch `feat/screencapturekit`
- [ ] Re-check whether it is still needed: stock 1.4.9 captured fine on macOS 15 in later tests

## Not Blocked on Our Builds

- **Control Role Enforcement**: stock 1.4.9 already accepts a `ControlPermissions` bitmask from hbbs (`PunchHole`, `RequestRelay`, `FetchLocalAddr`) and enforces it per connection, except on Android. Server-side work only; see [api-server-roadmap.md](api-server-roadmap.md) (Phase 3). Not yet tested end to end.
