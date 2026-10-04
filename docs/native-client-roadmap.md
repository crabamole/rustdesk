# Native Client Build Roadmap

**Updated:** 2026-10-04

Stock RustDesk clients work with our server stack, but some features need a client built from this fork. This roadmap tracks what shipping our own Windows, macOS and Linux builds requires, and the features waiting on it.

## Build Pipeline

`.github/workflows/windows-build.yml` builds Windows x64 on manual dispatch; the other archived workflows in `.github/workflows-archive/` are the starting point for Linux and macOS.

- [x] Windows x64: unsigned MSI, verified on a Windows 10 VM (install, device ID kept, web client session, our `custom.txt` applied, one signed with another key ignored)
- [ ] Linux `.deb`
- [x] macOS arm64: signed, notarized, stapled `cRustDesk` app (DC and client variants) shipped as a zip, manual workflow `.github/workflows/macos-build.yml`
- [ ] macOS x86_64
- [ ] CI speed: vcpkg cache not effective (12–15 min per run); pinned actions still on Node 20
- [x] `custom.txt` signing key is a required build parameter (`RUSTDESK_CUSTOM_CLIENT_PK`, base64 Ed25519 public key); builds fail without it and never trust RustDesk's key. Sign with `rustdesk-utils signcustom` (rustdesk-server)
- [x] macOS: Apple Developer ID signing and notarization (Gatekeeper)
- [ ] Windows: code-signing certificate (SmartScreen); deferred, candidates Certum (about €49/yr) or SignPath (free for open source)
- [ ] Release process: versioning, publishing, tracking upstream releases
- [ ] Pre-seed guides updated for our packages (`linux-preseed-install.md`, `macos-preseed-install.md`)
- [ ] Windows: once a custom build is configured and auto-update is on, the updater still queries the update server for new versions

Linux needs no signing, so a Linux-only build is the cheapest way to prove the features below.

### macOS naming and packaging (done, 2026-10-04)

- [x] One app name, `cRustDesk`, for both variants; the client-only variant differs only in its signed `custom.txt`. Installing one replaces the other, so a machine never holds both
- [x] Our own prefix instead of upstream's `com.carriez`, set at runtime (`ORG`), following stock's pattern (bundle ID lowercase, folder and labels in the app name's case):

  | | Stock | Ours |
  |---|---|---|
  | Bundle ID | `com.carriez.rustdesk` | `io.github.crabamole.crustdesk` |
  | Config folder | `com.carriez.RustDesk` | `io.github.crabamole.cRustDesk` |
  | launchd labels | `com.carriez.RustDesk_service` / `_server` | `io.github.crabamole.cRustDesk_service` / `_server` |

- [x] Publish a signed, notarized and stapled `.app` (zip) instead of a DMG. Organisations wrap it in their own `.pkg`/`.dmg` (e.g. for Jamf) and add their server config there
- [x] Deep links use `rustdesk://` (upstream derives `<appname>://` from the app name), including the Windows registry keys for the URL protocol
- [x] `hide-stop-service` in the DC build, so the service can't be stopped from its UI
- [x] Change ID needs a configured server; an unconfigured install would otherwise contact the public server
- [x] Pre-seeded config verified on macOS: config staged in the user and root folders before install, registers without `--option` steps
- [ ] Windows MSI's `rustdesk://` registration (`res/msi/Package/Components/Regs.wxs` still registers the lowercase app name), deferred to the Windows/Linux build plan

## Deployment Model

Two builds per platform, named `cRustDesk` (bundle ID `io.github.crabamole.crustdesk` on macOS) and differing only in their signed `custom.txt`.

| Build | `custom.txt` source | Installed on |
|---|---|---|
| DC (service) | [`res/custom/rustdesk.json`](../res/custom/rustdesk.json) | managed devices that are controlled (MDM) |
| OA (client) | [`res/custom/client.json`](../res/custom/client.json) | viewer machines (internal app store) |

- One RustDesk per machine: a machine gets either the DC or the OA build, never both and never next to stock RustDesk. Side by side, our two builds share one machine ID, and all RustDesk installs compete for `rustdesk://` links. Enforce it with MDM (allow only our signer and the variant assigned to the machine group)
- Public builds carry no deployment data; organisations package them and supply server config (pre-seeded config or `--config`)
- OA (client variant) is client-only (`conn-type: outgoing`): it never registers with hbbs or sends a heartbeat, so it cannot be controlled.
- DC (service variant) works in both directions (it can be controlled and can control); its data-out locks (one-way clipboard, disabled file transfer/printer/recording/tunnel/remote-restart/camera/terminal) live in `res/custom/rustdesk.json`.
- No build of this fork has a public-server fallback: without a configured server, an install just waits — `rustdesk --config <string>` is required before it runs its usual background services.
- macOS: two signed, notarized, stapled `cRustDesk` app bundles (arm64), shipped as a zip; Windows: two MSIs planned (`preprocess.py --custom --conn-type --app-name`)
- Server addresses and key: `rustdesk --config <string>` after install, so one public build serves every deployment
- [ ] Windows distribution through an internal Chocolatey feed
- [ ] Keep system info sync in the outgoing-only build: `start_all()` exits before it, so viewer machines never report a hostname and are missing from the device list

## Testing

- [x] macOS: e2e spec for the custom builds (locks, direct IP off, one-way clipboard, audit, refused session types, outgoing-only client) against the DC install, with stock RustDesk kept as a test-only exception on the MacBook
- [ ] Windows and Linux builds of both variants: Windows as signed MSIs (CompanyName `crabamole`, `OriginalFilename`/`InternalName` unchanged as `rustdesk.exe`/`rustdesk`); Linux as a `.deb` (Ubuntu, x86_64, X11 only) renamed to `crustdesk`
- [ ] Install/uninstall scripts per platform, with pre-seeded config
- [ ] Guard against stock RustDesk on every platform: installer guards (Linux `Conflicts:`, Windows MSI launch condition) plus a blocking runtime check that reuses the "no configured server" path while stock is present
- [ ] Test machines move from stock RustDesk to `cRustDesk`, resting in the DC variant as devices; `npm test` runs the existing specs (web client, policy, audit, clipboard) against that resting device instead of hard-coded stock peer IDs
- [ ] Combinatorial e2e runs as a separate, longer command: each platform once as client and once as device, with a clean uninstall between runs:

  | Client | Device |
  |---|---|
  | macOS | Linux |
  | Windows | macOS |
  | Linux | Windows |

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
- Design: [design-trusted-builds.md](design-trusted-builds.md); device admission ([design-device-admission.md](design-device-admission.md)) layers on top of it and needs no client change

### Viewer Identity in Audit Records
- [ ] The viewer reports its hostname and local addresses; the host includes them in its `authorized` audit record
- Device-reported values: trustworthy only on managed devices running attested builds
- **Today:** the server-side address (resolved through trusted proxies), the viewer's name (`display-name`, logged-in user or OS user) and, for logged-in viewers, their account (via hbbs's audit reference, stock clients)

### Native Login with PKCE
- [ ] Native clients log in with the authorization code flow, PKCE and a loopback redirect (RFC 8252)
- [ ] api-server fully validates the ID token; chart setting to turn off the polling login flow
- **Today:** polling login with a confirmation page for logins from native clients
- Tracked in [api-server-roadmap.md](api-server-roadmap.md) (Phase 2)

### WebSocket Port for Hostnames ([#30](https://github.com/crabamole/rustdesk/issues/30))
- [ ] Keep a non-default port when the rendezvous server is a hostname (`check_ws()` in `hbb_common`)
- [ ] Do not treat a relay address `<host>:443` as the rendezvous server: `check_ws()` classifies by port, so the relay connection goes to `/ws/id`. Same function, one fix covers both
- **Today:** serve WebSocket on port 80 (ws) or 443 (wss); configure the rendezvous server as a hostname without port and leave the relay server blank

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
