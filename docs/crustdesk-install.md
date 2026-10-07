# cRustDesk Install Guide

Installing the cRustDesk builds of this fork (Windows, macOS, Ubuntu). Upstream RustDesk clients are not covered here; see the stock guides: [Linux](stock-rustdesk-linux-preseed-install.md), [macOS](stock-rustdesk-macos-preseed-install.md).

## Variants

| Variant | Artifact prefix | Use on | Built from |
|---|---|---|---|
| DC (device) | `cRustDesk-` / `crustdesk-` | machines that are controlled | [`res/custom/rustdesk.json`](../res/custom/rustdesk.json) |
| Client (OA) | `cRustDesk-client-` / `crustdesk-client-` | viewer machines (outgoing only) | [`res/custom/client.json`](../res/custom/client.json) |

Both are the same app, `cRustDesk`, differing in their signed `custom.txt`. A machine holds one RustDesk: installing one variant replaces the other, and the installers refuse to install next to stock RustDesk (Linux `Conflicts: rustdesk, rustdesk-unattended-wayland`; Windows MSI: "RustDesk is installed. Uninstall it first."). While stock RustDesk is present, the cRustDesk service stays idle.

Our builds never fall back to RustDesk's public server: without server config they wait.

## Artifacts

Attached to each [GitHub Release](https://github.com/crabamole/rustdesk/releases) with a `SHA256SUMS` file. `<ver>` is the release version, e.g. `1.4.9-7` (upstream RustDesk version and our build number), shared with the web-client image:

| Platform | Files |
|---|---|
| Windows x64 | `cRustDesk-<ver>-x86_64.msi`, `cRustDesk-client-<ver>-x86_64.msi` (unsigned) |
| macOS arm64 | `cRustDesk-<ver>-aarch64.zip`, `cRustDesk-client-<ver>-aarch64.zip` (signed, notarized app inside) |
| Ubuntu x86_64 (X11) | `crustdesk-<ver>-x86_64.deb`, `crustdesk-client-<ver>-x86_64.deb` |

Each installer from 1.4.9-8 on carries a GitHub build attestation: it proves the file was built by this repo's release workflow from the tagged commit. Check a download with the [GitHub CLI](https://cli.github.com/):

```bash
gh attestation verify cRustDesk-<ver>-x86_64.msi --repo crabamole/rustdesk
```

## Server config

Two ways; use either on every platform.

### A. `--config <string>` after install

Run as administrator/root:

| Platform | Command |
|---|---|
| Windows | `"C:\Program Files\cRustDesk\cRustDesk.exe" --config <string>` |
| Linux | `sudo crustdesk --config <string>` |
| macOS | `sudo /Applications/cRustDesk.app/Contents/MacOS/cRustDesk --config <string>` |

`<string>` is the JSON `{"host":"<your-server>","relay":"<relay or empty>","api":"https://<your-server>","key":"<server-public-key>"}`, base64-encoded URL-safe without padding, then reversed character by character. Our builds hide the network settings, so take the string from a stock client's "Export Server Config" (Settings, Network), or build it yourself in the format above. The command sets `custom-rendezvous-server`, `relay-server`, `api-server` and `key`.

`--config` and the service-profile paths in B configure the DC service only. The client variant runs no service; see [Client variant](#client-variant).

### B. Pre-seeded config file (staged before install)

Not documented upstream; verified with our builds. Create `cRustDesk2.toml`:

```toml
[options]
custom-rendezvous-server = '<your-server>'
api-server = 'https://<your-server>'
key = '<server-public-key>'
# relay-server = '<your-relay>'   # only if used
```

Put it in place before installing:

| Platform | Locations |
|---|---|
| Windows | `C:\Windows\ServiceProfiles\LocalService\AppData\Roaming\cRustDesk\config\cRustDesk2.toml` |
| Linux | `/root/.config/crustdesk/cRustDesk2.toml` and `~/.config/crustdesk/cRustDesk2.toml` of every session user, owned by that user |
| macOS | `/var/root/Library/Preferences/io.github.crabamole.cRustDesk/cRustDesk2.toml` and the user's `~/Library/Preferences/io.github.crabamole.cRustDesk/cRustDesk2.toml`, the latter owned by that user |

Per-user files must be owned by that user (Linux and macOS: `chown <user>`, mode `0600`).

### Custom port

Our builds also work when the server is reached on a port other than 443/80 (stock clients drop it): give the same port `P` everywhere — `custom-rendezvous-server = '<your-server>:P'`, `api-server = 'http(s)://<your-server>:P'`, and on the server `hbbs.relayAddress` (or hbbs's `-r`) `<your-server>:P`.

### Client variant

The client variant runs no service, so `--config` (which only writes the calling process's config when no service answers, and needs admin/root) and the service-profile paths above do not reach it. Pre-seed each user's own `cRustDesk2.toml`, owned by that user:

| Platform | Location |
|---|---|
| Windows | `%APPDATA%\cRustDesk\config\cRustDesk2.toml` |
| Linux | `~/.config/crustdesk/cRustDesk2.toml` |
| macOS | `~/Library/Preferences/io.github.crabamole.cRustDesk/cRustDesk2.toml` |

## Windows

```powershell
msiexec /i cRustDesk-<ver>-x86_64.msi /qn
```

Installs `C:\Program Files\cRustDesk\cRustDesk.exe` and, for the DC variant, the service `cRustDesk` (the client MSI installs no service). Check: `Get-Service cRustDesk`.

Uninstalling stock RustDesk's MSI removes the `rustdesk://` link handler that cRustDesk shares. The DC's service restores it within about a minute, or when the service next starts. The client variant has no service; repair it with the MSI it was installed from:

```powershell
msiexec /f cRustDesk-client-<ver>-x86_64.msi /qn
```

Uninstall: Apps & Features, or `msiexec /x <product-code-or-msi>`.

## macOS

1. Unzip, move `cRustDesk.app` to `/Applications`.
2. Grant Screen Recording and Accessibility (bundle ID `io.github.crabamole.crustdesk`); fleets use an MDM PPPC profile.
3. DC only: launch the app once to install the service as upstream does, or install it from the app. The client variant installs no service.

Uninstall: remove the app, the launchd plists `/Library/LaunchDaemons/io.github.crabamole.cRustDesk_service.plist` and `/Library/LaunchAgents/io.github.crabamole.cRustDesk_server.plist` (unload them first), and the preference folders listed above.

## Ubuntu

```bash
sudo apt install ./crustdesk-<ver>-x86_64.deb
```

Binary `/usr/bin/crustdesk`. The DC package runs the systemd service `crustdesk` (`systemctl is-active crustdesk`); the client package installs no service.

Uninstall: `sudo apt purge crustdesk`.

## Verify

As administrator/root, `--get-id` prints the device ID (same command prefix as in [Server config](#a---config-string-after-install)). A DC device then appears in the console's device list. Client builds never register or send heartbeats. The console's Viewers list shows view-only machines: machines that log in with the client build and have no device row. Any machine with a device row is a device (devices can also view), including one that once ran stock RustDesk or the DC against the server; it stays out of the Viewers list until that stale row is removed (see [Moving from stock RustDesk](#moving-from-stock-rustdesk)). Viewer rows are self-reported at login, not attestation.

## Moving from stock RustDesk

Machines that ran stock RustDesk against the same server keep an old peer row under their natural ID with the old key; our build then registers under a random ID. Remove the stale rows when moving a fleet.
