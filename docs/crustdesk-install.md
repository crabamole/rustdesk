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

Built by the manual GitHub Actions workflows (`windows-build.yml`, `macos-build.yml`, `linux-build.yml`):

| Platform | Files |
|---|---|
| Windows x64 | `cRustDesk-<ver>-x86_64.msi`, `cRustDesk-client-<ver>-x86_64.msi` (unsigned) |
| macOS arm64 | `cRustDesk-<ver>-aarch64.zip`, `cRustDesk-client-<ver>-aarch64.zip` (signed, notarized app inside) |
| Ubuntu x86_64 (X11) | `crustdesk-<ver>-x86_64.deb`, `crustdesk-client-<ver>-x86_64.deb` |

## Server config

Two ways; use either on every platform.

### A. `--config <string>` after install

Run as administrator/root:

| Platform | Command |
|---|---|
| Windows | `"C:\Program Files\cRustDesk\cRustDesk.exe" --config <string>` |
| Linux | `sudo crustdesk --config <string>` |
| macOS | `sudo /Applications/cRustDesk.app/Contents/MacOS/cRustDesk --config <string>` |

`<string>` is the JSON `{"host":"<your-server>","relay":"<relay or empty>","api":"https://<your-server>","key":"<server-public-key>"}`, base64-encoded URL-safe without padding, then reversed character by character. The easiest source is a configured client: Settings, Network, copy icon next to "Export Server Config". The command sets `custom-rendezvous-server`, `relay-server`, `api-server` and `key`.

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
| macOS | `/var/root/Library/Preferences/io.github.crabamole.cRustDesk/cRustDesk2.toml` and the user's `~/Library/Preferences/io.github.crabamole.cRustDesk/cRustDesk2.toml` |

## Windows

```powershell
msiexec /i cRustDesk-<ver>-x86_64.msi /qn
```

Installs `C:\Program Files\cRustDesk\cRustDesk.exe` and, for the DC variant, the service `cRustDesk` (the client MSI installs no service). Check: `Get-Service cRustDesk`.

If stock RustDesk's MSI is uninstalled while cRustDesk runs, the cRustDesk service restores the `rustdesk://` link handler within about a minute. If the service was down at that time, repair or reinstall cRustDesk.

Uninstall: Apps & Features, or `msiexec /x <product-code-or-msi>`.

## macOS

1. Unzip, move `cRustDesk.app` to `/Applications`.
2. Grant Screen Recording and Accessibility (bundle ID `io.github.crabamole.crustdesk`); fleets use an MDM PPPC profile.
3. Launch the app once to install the service as upstream does, or install it from the app.

Uninstall: remove the app, the launchd plists `io.github.crabamole.cRustDesk_service` and `io.github.crabamole.cRustDesk_server`, and the preference folders listed above.

## Ubuntu

```bash
sudo apt install ./crustdesk-<ver>-x86_64.deb
```

Binary `/usr/bin/crustdesk`. The DC package runs the systemd service `crustdesk` (`systemctl is-active crustdesk`); the client package installs no service.

Uninstall: `sudo apt purge crustdesk`.

## Verify

As administrator/root, `--get-id` prints the device ID (same command prefix as in [Server config](#a---config-string-after-install)). A DC device then appears in the console's device list. Client builds report heartbeat and system info while the app runs, so they also appear in the list, but they never register or accept connections.

## Moving from stock RustDesk

Machines that ran stock RustDesk against the same server keep an old peer row under their natural ID with the old key; our build then registers under a random ID. Remove the stale rows when moving a fleet.
