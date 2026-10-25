# Native Client Build Roadmap

**Updated:** 2026-10-25

Stock RustDesk clients work with our server stack, but some features need a client built from this fork. This roadmap tracks what shipping our own Windows, macOS and Linux builds requires, and the features waiting on it.

## Next

1. Same-user access: test on Windows and macOS ([Same-User Access](#same-user-access))
2. CI speed
3. Tracking upstream releases: 1.5.1 is on upstream master, not released yet ([Build Pipeline](#build-pipeline))

## Build Pipeline

`.github/workflows/windows-build.yml` builds Windows x64, `.github/workflows/linux-build.yml` Linux x86_64 and `.github/workflows/macos-build.yml` macOS arm64, on manual dispatch and from `.github/workflows/release.yml`.

- [x] Windows x64: two signed MSIs per release (`cRustDesk-<ver>-x86_64.msi`, `cRustDesk-client-<ver>-x86_64.msi`). Installs `C:\Program Files\cRustDesk\cRustDesk.exe` with service `cRustDesk`; version info CompanyName `crabamole`, ProductName `cRustDesk`, OriginalFilename `rustdesk.exe`, InternalName `rustdesk`
- [x] Linux x86_64: one `.deb` per variant (`crustdesk-<ver>-x86_64.deb`, `crustdesk-client-<ver>-x86_64.deb`), Ubuntu, X11 only. Package `crustdesk`, `Conflicts: rustdesk, rustdesk-unattended-wayland`; upstream's stock-layout package is renamed by a post-build step
- [x] macOS arm64: signed, notarized, stapled `cRustDesk` app (DC and client variants) shipped as a zip
- macOS x86_64 (Intel): not supported; arm64 only
- [ ] CI speed: vcpkg cache not effective (12–15 min per run); pinned actions still on Node 20
- [ ] Linux build base: Rust builds in an Ubuntu 18.04 container (as upstream) while vcpkg builds the codecs on the Ubuntu 22.04 runner; since 1.5.0 the codecs need glibc 2.28 (`fcntl64`), so the package no longer runs on 18.04 anyway and the tests skip `hwcodec` to link. Decide with the supported-distro list whether to build everything on 22.04 (glibc 2.35, Ubuntu 22.04+ / Debian 12+)
- [x] `custom.txt` signing key is a required build parameter (`RUSTDESK_CUSTOM_CLIENT_PK`, base64 Ed25519 public key); builds fail without it and never trust RustDesk's key. Sign with `rustdesk-utils signcustom` (rustdesk-server)
- [x] macOS: Apple Developer ID signing and notarization (Gatekeeper)
- [x] Windows: code signing with a Certum cloud certificate; each release is approved in GitHub and unlocked with a phone code ([design](design-windows-code-signing.md)). A portable client-only Windows build is next.
- [x] Release process: a version bump in `flutter/web/js/package.json` (`<upstream>-<n>`) releases every client under one tag (`release.yml`): the web-client image plus a GitHub Release with the six installers and `SHA256SUMS`. From 1.4.9-8 each installer carries a GitHub build attestation (`gh attestation verify <file> --repo crabamole/rustdesk`). From 1.4.9-9 the installers are also published as an image, `ghcr.io/crabamole/rustdesk/installers:<version>`, for networks that pull from a registry only
- [ ] Tracking upstream releases
- [x] Merge upstream 1.5.0 (clients 1.5.0-1): handshake hardening (Kx v1) and security fixes; our `hbb_common` fork merges upstream too. `custom.txt` locks its new WebRTC transport and clipboard sync between sessions off
- [x] Install guide for our packages: [crustdesk-deployment.md](crustdesk-deployment.md) (Windows, macOS, Ubuntu; `--config` and pre-seeded config). The stock RustDesk pre-seed guides are kept separately ([Linux](stock-rustdesk-linux-preseed-install.md), [macOS](stock-rustdesk-macos-preseed-install.md))
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
- [x] The service also checks the handler when it starts, so a handler removed while the service was down comes back
- The Windows client variant has no service: after a stock install and uninstall, an MSI repair (`msiexec /f`) restores `rustdesk://` (by design; see [crustdesk-deployment.md](crustdesk-deployment.md#windows-rustdesk-links))

## Testing

The e2e suite (private repo) runs against test machines that rest on the DC build (macOS, Windows, Linux):

- [x] `npm test`: web client per platform, device policy, audit, clipboard, and the macOS custom-build spec (locks, direct IP off, one-way clipboard, refused session types)
- [x] `npm run matrix`: each platform once as client and once as device (macOS → Linux, Windows → macOS, Linux → Windows) with a clean install of the client variant; sessions, refused file transfer, audit, the client never registering, and one-way clipboard with native clients
- [x] Guard checks with the matrix: Linux `Conflicts:` in both install orders, the Windows MSI launch condition, and the runtime guard on macOS and Windows
- [x] Viewer recorded from login, Linux client package has no service, Windows handler self-repair after stock removal and at service startup, auto-update locked
- Not tested, outside the supported setup (one RustDesk per machine, enforced by MDM): replacing one variant with the other in place (MSI major upgrade, apt reinstall), the Linux runtime guard, the UI status for "stock RustDesk is installed"

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
- [x] Connection audit rows name the viewer machine: hostname, OS and login address, copied from the latest native OIDC login of the same user on that viewer ID. Server-side only (api-server, after 3.3.0), no client change; the session's own address (`ip`) stays
- Viewers only connect logged in (`LOGGED_IN_ONLY=Y`), so the login carries the machine; web viewers have no machine, only their address
- Self-reported at login: trustworthy only on managed devices running attested builds (see Client Attestation)
- Not planned: viewer-reported local addresses or MAC addresses (NAT and randomized MACs make them weak; the hostname matches the inventory)

### Login Bound to Its Starter
- [x] Every OIDC login (our native builds, web client, admin console) returns a one-time result to its starter (loopback for native, same-origin page for browsers), redeemed with a PKCE verifier; no polling. The api-server stays the confidential OIDC client (no new registration at the identity provider)
- [x] Release notes state the client / web client / api-server version pairing (GitHub Release, chart `UPGRADING.md`); no backward compatibility, so older native builds and stock clients can no longer log in
- Shipped in clients 1.4.9-8 with rustdesk-api 3.4.0 (chart 0.8.0); verified by e2e and a manual cRustDesk login on macOS
- Design: [design-oidc-login.md](design-oidc-login.md); tracked in [api-server-roadmap.md](api-server-roadmap.md) (Phase 2)

### WebSocket Port for Hostnames ([#30](https://github.com/crabamole/rustdesk/issues/30))
- [x] Keep a non-default port when the rendezvous server is a hostname: when `custom-rendezvous-server` and `api-server` name the same host and port, the WebSocket URLs keep that port (`check_ws()` in our `hbb_common` copy, [crabamole/hbb_common](https://github.com/crabamole/hbb_common))
- Stock clients: serve WebSocket on port 80 (ws) or 443 (wss), configure the rendezvous server as a hostname without port and leave the relay server blank

### Relay Chosen by hbbs
- [x] Our builds have no relay-server setting: the `relay-server` option is gone, `--config` ignores `relay`, the server settings dialog has no relay field and exports none. A device dials the relay URL hbbs hands out (`wss://<host>/ws/relay/<n>`) exactly as given, so both halves of a session meet on the same hbbr pod; without one the connection fails
- [x] The web client dials the relay URL hbbs returns; it has no relay setting or fallback
- Stock clients: leave the relay server blank; with one set they fail with "Unknown relay server" unless it is exactly a handed-out URL
- Shipped in clients 1.4.9-9 with rustdesk-server 1.1.16-4 (chart 0.9.0); verified by e2e with native clients on macOS, Windows and Linux
- Design: [design-multi-replica.md](design-multi-replica.md)

### Clipboard Audit
- [x] Hosts report clipboard arrivals to the api-server (formats and sizes, no content), clients 1.5.0-4 with rustdesk-api 3.8.0
- [x] Text on request: a copy on the viewer sends format names only; the device requests the content when an app on it reads the clipboard (native viewers and the web client; text, RTF, HTML). Design: [design-clipboard-on-request.md](design-clipboard-on-request.md). X11, Windows and macOS devices; no Wayland provider.
- Why first: the native viewer pushes every clipboard change to all open sessions, pasted or not (RDP transfers on paste); an audit of that push would not show what was pasted. With the DC's one-way clipboard only viewer → device traffic exists
- **Today:** connection, file and clipboard text audit
- Design: [design-clipboard-monitoring.md](design-clipboard-monitoring.md) (text arrivals, on top of clipboard on request)

### OIDC-Only Login Form
- [x] The login dialog shows only the OIDC button (web client and native builds, 1.4.9-7); the api-server accepts OIDC logins only
- Stock clients still show the password fields; password logins from them always fail

### Same-User Access
- [x] A viewer opens a device without its password when the same user is logged in on the device with OIDC (api-server switch `SAME_USER_ACCESS`, off by default)
- [x] Our builds sign the device login with the device key (the request goes to the server process over IPC, so the private key stays there) and accept the flag only on a verified `wss` rendezvous link with a `wss` relay, when the owner key is their own key
- [x] Audit: such sessions have `primary_auth` 5 (same user)
- Stock clients never get same-user access; they keep asking for the password
- Status: released (clients 1.5.0-2, rustdesk-server 1.1.16-6, rustdesk-api 3.7.0), off by default. Verified by e2e and on Linux; Windows and macOS not tested yet
- Design: [design-same-user-access.md](design-same-user-access.md); tracked in [api-server-roadmap.md](api-server-roadmap.md) (Phase 3)

### ScreenCaptureKit on macOS ([#26](https://github.com/crabamole/rustdesk/issues/26))
- [ ] ScreenCaptureKit video backend behind the `screencapturekit` feature, parked on branch `feat/screencapturekit`
- [ ] Re-check whether it is still needed: stock 1.4.9 captured fine on macOS 15 in later tests

## Not Blocked on Our Builds

- **Control Role Enforcement**: stock 1.4.9 already accepts a `ControlPermissions` bitmask from hbbs (`PunchHole`, `RequestRelay`, `FetchLocalAddr`) and enforces it per connection, except on Android. Server-side work only; see [api-server-roadmap.md](api-server-roadmap.md) (Phase 3). Not yet tested end to end.
