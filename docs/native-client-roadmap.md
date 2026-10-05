# Native Client Build Roadmap

**Updated:** 2026-10-05

Stock RustDesk clients work with our server stack, but some features need a client built from this fork. This roadmap tracks what shipping our own Windows, macOS and Linux builds requires, and the features waiting on it.

## Next

1. Windows code signing: on hold; SignPath asks for a product keyword findable on Google. Revisit when the fork is findable ([Build Pipeline](#build-pipeline))
2. Test gaps ([Testing](#testing))
3. macOS x86_64
4. CI speed
5. Release process

## Build Pipeline

`.github/workflows/windows-build.yml` builds Windows x64, `.github/workflows/linux-build.yml` Linux x86_64 and `.github/workflows/macos-build.yml` macOS arm64, all on manual dispatch.

- [x] Windows x64: two unsigned MSIs per release (`cRustDesk-<ver>-x86_64.msi`, `cRustDesk-client-<ver>-x86_64.msi`). Installs `C:\Program Files\cRustDesk\cRustDesk.exe` with service `cRustDesk`; version info CompanyName `crabamole`, ProductName `cRustDesk`, OriginalFilename `rustdesk.exe`, InternalName `rustdesk`
- [x] Linux x86_64: one `.deb` per variant (`crustdesk-<ver>-x86_64.deb`, `crustdesk-client-<ver>-x86_64.deb`), Ubuntu, X11 only. Package `crustdesk`, `Conflicts: rustdesk, rustdesk-unattended-wayland`; upstream's stock-layout package is renamed by a post-build step
- [x] macOS arm64: signed, notarized, stapled `cRustDesk` app (DC and client variants) shipped as a zip
- [ ] macOS x86_64
- [ ] CI speed: vcpkg cache not effective (12–15 min per run); pinned actions still on Node 20
- [x] `custom.txt` signing key is a required build parameter (`RUSTDESK_CUSTOM_CLIENT_PK`, base64 Ed25519 public key); builds fail without it and never trust RustDesk's key. Sign with `rustdesk-utils signcustom` (rustdesk-server)
- [x] macOS: Apple Developer ID signing and notarization (Gatekeeper)
- [ ] Windows: code-signing certificate (SmartScreen); stays unsigned for now. SignPath (free for open source) asks for a search keyword that finds the product on Google, so revisit when the fork is findable; Certum (about €49/yr) is the alternative. The workflow's signing steps have never run; before first use, keep the certificate password off signtool's command line, delete the PFX afterwards, and sign only our own binaries
- [ ] Release process: versioning, publishing, tracking upstream releases
- [x] Install guide for our packages: [crustdesk-install.md](crustdesk-install.md) (Windows, macOS, Ubuntu; `--config` and pre-seeded config). The stock RustDesk pre-seed guides are kept separately ([Linux](stock-rustdesk-linux-preseed-install.md), [macOS](stock-rustdesk-macos-preseed-install.md))
- [x] No auto-update in custom builds: both `custom.txt` files lock `"allow-auto-update": "N"` (`override-settings`), so they never download stock RustDesk and the toggle shows as locked. With default settings no update-server contact was observed on Windows; the only path was the toggle

### Naming and packaging

- [x] One app name, `cRustDesk`, for both variants; the client-only variant differs only in its signed `custom.txt`. Installing one replaces the other, so a machine never holds both
- [x] Our own prefix instead of upstream's `com.carriez`, set at runtime (`ORG`), following stock's pattern (bundle ID lowercase, folder and labels in the app name's case):

  | | Stock | Ours |
  |---|---|---|
  | Bundle ID | `com.carriez.rustdesk` | `io.github.crabamole.crustdesk` |
  | Config folder | `com.carriez.RustDesk` | `io.github.crabamole.cRustDesk` |
  | launchd labels | `com.carriez.RustDesk_service` / `_server` | `io.github.crabamole.cRustDesk_service` / `_server` |

- [x] Publish a signed, notarized and stapled `.app` (zip) instead of a DMG. Organisations wrap it in their own `.pkg`/`.dmg` (e.g. for Jamf) and add their server config there
- [x] Deep links use `rustdesk://` (upstream derives `<appname>://` from the app name), including the Windows registry keys and the MSI
- [x] `hide-stop-service` in the DC build, so the service can't be stopped from its UI
- [x] Change ID needs a configured server; an unconfigured install would otherwise contact the public server
- [x] Remote printer removed from our Windows builds: the MSIs ship without upstream's prebuilt printer adapter and driver (the closed adapter exits the process when initialised under a renamed app name), and both variants hide the printer settings
- [x] The Linux client `.deb` installs no service

## Deployment Model

Two builds per platform, named `cRustDesk` and differing only in their signed `custom.txt`.

| Build | `custom.txt` source | Installed on |
|---|---|---|
| DC (service) | [`res/custom/rustdesk.json`](../res/custom/rustdesk.json) | managed devices that are controlled (MDM) |
| OA (client) | [`res/custom/client.json`](../res/custom/client.json) | viewer machines (internal app store) |

- Public builds carry no deployment data; organisations package them and supply server config
- OA (client variant) is client-only (`conn-type: outgoing`): it never registers with hbbs, so it cannot be controlled (it sends no heartbeats)
- DC (service variant) works in both directions (it can be controlled and can control); its data-out locks (one-way clipboard, disabled file transfer/printer/recording/tunnel/remote-restart/camera/terminal) live in `res/custom/rustdesk.json`
- No build of this fork has a public-server fallback: without a configured server, an install waits until it gets a server config before it runs its usual background services
- Server addresses and key: a pre-seeded config (verified on macOS in the user and root folders, Windows under the LocalService profile, and Linux for root and the session user) or `cRustDesk --config <string>` after install (upstream's documented method), so one public build serves every deployment
- Machines that ran stock RustDesk against the same server keep an old peer row under their natural ID with the old key; our build then registers under a random ID on every reinstall. Remove stale rows when moving a fleet over
- [ ] Windows distribution through an internal Chocolatey feed
- [x] The console's Viewers list (admin `GET /api/viewers`, separate section on the Devices page) shows view-only machines: machines that log in with the client build and have no device row. Any machine with a device row is a device (devices can also view), including one that once ran stock RustDesk or the DC against the server; it stays out of the list until that stale row is removed (see the stale-row note above). Rows are self-reported at login, not attestation. The client build sends no heartbeats and never registers

### One RustDesk per machine

A machine gets either the DC or the OA build, never both and never next to stock RustDesk: side by side, our two builds share one machine ID, and all RustDesk installs compete for `rustdesk://` links. Enforce it with MDM (allow only our signer and the variant assigned to the machine group); the builds add their own guards.

- [x] Guard against stock RustDesk on every platform: installer guards (Linux `Conflicts:`, Windows MSI launch condition that refuses while stock's service exists) plus a runtime guard: while stock is installed the service stays idle (no registration, no heartbeats, open sessions closed) and resumes within seconds once stock is removed
- [ ] Direct IP access (`direct_server`) is not paused by the runtime guard; our DC build locks direct access off, so only builds that enable it are affected
- [x] Uninstalling stock RustDesk's MSI removes the shared `rustdesk://` handler; the cRustDesk service restores it within about a minute while cRustDesk runs
- [ ] The handler repair is not called at service startup: if the service was down when stock was uninstalled, cRustDesk needs a repair or reinstall to get its links back
- [ ] The Windows client variant has no service, so a later stock install and uninstall leaves `rustdesk://` broken until cRustDesk is repaired or reinstalled

## Testing

The e2e suite (private repo) runs against test machines that rest on the DC build (macOS, Windows, Linux):

- [x] `npm test`: web client per platform, device policy, audit, clipboard, and the macOS custom-build spec (locks, direct IP off, one-way clipboard, refused session types)
- [x] `npm run matrix`: each platform once as client and once as device (macOS → Linux, Windows → macOS, Linux → Windows) with a clean install of the client variant; sessions, refused file transfer, audit, the client never registering, and one-way clipboard with native clients
- [x] Guard checks with the matrix: Linux `Conflicts:` in both install orders, the Windows MSI launch condition, and the runtime guard on macOS and Windows
- [x] Viewer recorded from login, Linux client package has no service, Windows handler self-repair after stock removal, auto-update locked
- [ ] Not covered yet: replacing one variant with the other in place (MSI major upgrade, apt reinstall), the Linux runtime guard, the UI status for "stock RustDesk is installed"

## Features Waiting on Our Builds

### One-Way Clipboard
- [x] Hosts never send their clipboard to viewers; viewers can still paste into hosts. The DC build sets it in its signed `custom.txt`; verified with the web client and with native clients on macOS, Windows and Linux
- `one-way-clipboard-redirection` is a built-in setting: only a signed `custom.txt` (under `override-settings`) or a compile-time default sets it. `RustDesk2.toml` and strategy push are ignored
- Stock clients: turn clipboard off entirely (`enable-clipboard=N`, pushable by policy)
- Design: [design-clipboard-direction.md](design-clipboard-direction.md)

### Locked Settings
- [x] Security settings that local admins cannot change: the DC build locks them in its signed `custom.txt` (`override-settings`), verified on macOS by the e2e suite (same `custom.txt` on every platform)
- Stock clients: file permissions, `chattr +i`, MDM; strategy push re-applies policy options when the policy changes
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
