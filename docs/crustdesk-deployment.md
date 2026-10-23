# cRustDesk Deployment Guide

Rolling out the server and the cRustDesk clients (Windows, macOS, Ubuntu) for an organisation, in the
order to do things in; [Reference](#4-reference) at the end covers uninstalling and other single tasks.
Server details live in the [chart README](https://github.com/crabamole/rustdesk-charts#readme).
Upstream RustDesk clients are not covered; see the stock guides:
[Linux](stock-rustdesk-linux-preseed-install.md), [macOS](stock-rustdesk-macos-preseed-install.md).

Placeholders:

| Placeholder | Meaning |
|---|---|
| `<host>` | The public host users and devices reach, e.g. `rustdesk.example.com` (add `:<port>` if not 443) |
| `<server-public-key>` | hbbs's public key (step 1.1) |
| `<ver>` | Client release, e.g. `1.4.9-9` |
| `<chart-ver>` | Chart release, e.g. `0.10.0` |
| `<registry>` | Your registry mirror, if you do not pull from `ghcr.io` |

## 0. What to pull

| Artifact | Purpose |
|---|---|
| `oci://ghcr.io/crabamole/charts/rustdesk:<chart-ver>` | Helm chart |
| `ghcr.io/crabamole/rustdesk-server`, `ghcr.io/crabamole/rustdesk-api`, `ghcr.io/crabamole/rustdesk/web-client` | Server images; the chart's [Images](https://github.com/crabamole/rustdesk-charts#images) section lists the tags of each chart release |
| `docker.io/library/postgres` | Only with the bundled database |
| `ghcr.io/crabamole/rustdesk/installers:<ver>` | The client installers and `SHA256SUMS` (not deployed by the chart) |

Each chart release states the client release it was tested with (`UPGRADING.md`); deploy that `<ver>`.
With a mirror, set `global.imageRegistry: <registry>` in the chart values.

## 1. Server

### 1.1 Keypair

Generate the hbbs keypair once and store it as the Secret `rustdesk-keypair`
([Generate keypair](https://github.com/crabamole/rustdesk-charts#generate-keypair)). Back it up: every
device trusts this key, and losing it means reconfiguring every device. Its public key is
`<server-public-key>`.

### 1.2 Identity provider

Register an OIDC client at your IdP with the redirect URI `https://<host>/api/oidc/callback`, write
`oauth2.toml` and store it as a Secret ([OIDC provider](https://github.com/crabamole/rustdesk-charts#oidc-provider)).
Limit who may log in through the IdP's user or group assignment for that client.

### 1.3 Values and install

```yaml
publicHost: "<host>"
istio:
  gateway: <gateway-namespace>/<gateway-name>
trustedProxies:          # the gateway pods, plus any proxy in front that sets X-Forwarded-For
  - <gateway-pod-cidr>
oidcMock:
  enabled: false
hbbs:
  oauth2:
    existingSecret: <oidc-secret>
# Production: an external database instead of the bundled one.
# postgresql:
#   enabled: false
# database:
#   existingSecret: <database-url-secret>
```

```bash
helm install rustdesk oci://ghcr.io/crabamole/charts/rustdesk --version <chart-ver> -n rustdesk -f values.yaml
```

Before choosing `trustedProxies`, check which address the gateway sees for a client
([Client addresses behind proxies](https://github.com/crabamole/rustdesk-charts#client-addresses-behind-proxies)).

### 1.4 Check and make the first admin

1. Open `https://<host>/ui` and sign in through the IdP.
2. Promote yourself ([Login and admins](https://github.com/crabamole/rustdesk-charts#login-and-admins)):
   `kubectl exec -n rustdesk deploy/rustdesk-apiserver -- /app/rustdesk-api admin promote <your-email>`.
3. Review the device policy on the console's Policy page; devices receive it with their heartbeats.

## 2. Clients

### 2.1 Get the installers

From the registry:

```bash
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/out" ghcr.io/crabamole/rustdesk/installers:<ver> cp -r /installers /out
(cd installers && sha256sum -c SHA256SUMS)
```

The same files are attached to each [GitHub Release](https://github.com/crabamole/rustdesk/releases).
From 1.4.9-8 on each carries a GitHub build attestation, proving it was built by this repo's release
workflow from the tagged commit:

```bash
gh attestation verify cRustDesk-<ver>-x86_64.msi --repo crabamole/rustdesk
```

From 1.5.0-3 on, `cRustDesk-<ver>.cdx.json` next to the installers is the release's SBOM
(CycloneDX JSON): the locked dependencies of the release commit.

Pick a variant per machine:

| Machine | Variant | Windows x64 (signed MSI) | Ubuntu x86_64, X11 | macOS arm64 (signed, notarized) |
|---|---|---|---|---|
| Controlled (and may control others) | DC | `cRustDesk-<ver>-x86_64.msi` | `crustdesk-<ver>-x86_64.deb` | `cRustDesk-<ver>-aarch64.zip` |
| Only connects to others | Client | `cRustDesk-client-<ver>-x86_64.msi` | `crustdesk-client-<ver>-x86_64.deb` | `cRustDesk-client-<ver>-aarch64.zip` |

Both are the same app, `cRustDesk`, differing in their signed `custom.txt`
([`res/custom/rustdesk.json`](../res/custom/rustdesk.json), [`res/custom/client.json`](../res/custom/client.json)).
A machine holds one: installing one variant replaces the other, and the installers refuse to install next
to stock RustDesk (Linux `Conflicts: rustdesk, rustdesk-unattended-wayland`; Windows MSI: "RustDesk is
installed. Uninstall it first."). While stock RustDesk is present, the cRustDesk service stays idle.

### 2.2 The config file

Every machine needs the server settings in `cRustDesk2.toml`:

```toml
[options]
custom-rendezvous-server = '<host>'
api-server = 'https://<host>'
key = '<server-public-key>'
```

`custom-rendezvous-server` carries no port unless the server is on a port other than 443; then all
three of `custom-rendezvous-server`, `api-server` and the chart's `publicHost` carry that port.

Compared with a stock RustDesk pre-seed:

| | Stock RustDesk | cRustDesk |
|---|---|---|
| File name | `RustDesk2.toml` | `cRustDesk2.toml` |
| Folders | `rustdesk` / `RustDesk` / `com.carriez.RustDesk` | `crustdesk` / `cRustDesk` / `io.github.crabamole.cRustDesk` (table in 2.3) |
| `allow-websocket = 'Y'` | Required | Not needed: always on in our builds |
| `direct-server` | Set by you | Locked off on the DC variant |
| `disable-udp`, `enable-udp-punch = 'N'` | Recommended for zero UDP | Not needed: with WebSocket the device registers over TCP, and hole punching is off for any server but rustdesk.com |
| `enable-lan-discovery = 'N'` | Recommended | Not needed: locked off on the DC variant (from 1.5.0-3; set it by hand on older releases); the client variant does not answer LAN discovery |
| `relay-server` | Leave empty | Ignored: hbbs names the relay for every session |
| Server settings in the app | Visible and editable | Hidden and locked; this file or `--config` is the only way |
| Without server settings | Falls back to RustDesk's public servers | Waits ("Server not configured"); never contacts rustdesk.com |

Never copy `cRustDesk.toml` (without the `2`) between machines: it holds the device's ID and keypair, so
every copy would be the same device.

### 2.3 Where the file goes

Stage it before installing, owned by the account it belongs to, mode `0600` on Linux and macOS:

| Platform | DC variant | Client variant |
|---|---|---|
| Windows | `C:\Windows\ServiceProfiles\LocalService\AppData\Roaming\cRustDesk\config\cRustDesk2.toml` | `%APPDATA%\cRustDesk\config\cRustDesk2.toml` of each user |
| Linux | `/root/.config/crustdesk/`, plus `~/.config/crustdesk/` of each desktop user and of the login-screen user (`/var/lib/lightdm`, `/var/lib/gdm3`, …) | `~/.config/crustdesk/` of each user |
| macOS | `/var/root/Library/Preferences/io.github.crabamole.cRustDesk/`, plus `~/Library/Preferences/io.github.crabamole.cRustDesk/` of the user | `~/Library/Preferences/io.github.crabamole.cRustDesk/` of each user |

The client variant runs no service, so only the user's own file reaches it: stage it with a logon script
(Windows), `/etc/skel` plus existing homes (Linux), or a per-user MDM profile or script (macOS).

### 2.4 Alternative for the DC variant: `--config`

After installing, as administrator/root, `--config <string>` writes the same three settings to the service:

| Platform | Command |
|---|---|
| Windows | `"C:\Program Files\cRustDesk\cRustDesk.exe" --config <string>` |
| Linux | `sudo crustdesk --config <string>` |
| macOS | `sudo /Applications/cRustDesk.app/Contents/MacOS/cRustDesk --config <string>` |

`<string>` is the JSON `{"host","api","key"}`, URL-safe base64 without padding, reversed (a stock client's
"Export Server Config" gives the same format; its `relay` value is ignored):

```bash
printf '%s' '{"host":"<host>","api":"https://<host>","key":"<server-public-key>"}' \
  | base64 -w0 | tr '+/' '-_' | tr -d '=' | rev
```

`--config` splits its argument at `--`: if the result contains `--`, add a space after a comma in the
JSON and encode again. `--config` does not reach the client variant, which runs no service.

### 2.5 Install

**Windows** (as administrator):

```powershell
$dir = 'C:\Windows\ServiceProfiles\LocalService\AppData\Roaming\cRustDesk\config'
New-Item -ItemType Directory -Force $dir | Out-Null
Copy-Item cRustDesk2.toml "$dir\cRustDesk2.toml"
msiexec /i cRustDesk-<ver>-x86_64.msi /qn
Get-Service cRustDesk
```

It installs `C:\Program Files\cRustDesk\cRustDesk.exe` and, for the DC variant, the service `cRustDesk`;
the client MSI installs no service. The MSIs and their programs are signed by Open Source Developer Rophy Tsai (Certum), so allow-lists can trust that publisher.

**Linux** (as root; DC variant):

```bash
#!/bin/bash
set -euo pipefail
deb=${1:?usage: $0 <crustdesk.deb> <cRustDesk2.toml>}
conf=${2:?usage: $0 <crustdesk.deb> <cRustDesk2.toml>}
seed() {  # seed <home> <owner>
  install -d -m 0700 -o "$2" -g "$(id -gn "$2")" "$1/.config" "$1/.config/crustdesk"
  install -m 0600 -o "$2" -g "$(id -gn "$2")" "$conf" "$1/.config/crustdesk/cRustDesk2.toml"
}
seed /root root
for user in lightdm gdm3 gdm sddm; do
  home=$(getent passwd "$user" | cut -d: -f6) && [ -d "$home" ] && seed "$home" "$user"
done
for home in /home/*; do
  [ -d "$home" ] && seed "$home" "$(stat -c %U "$home")"
done
apt-get install -y "./${deb#./}"
systemctl is-active crustdesk
```

The binary is `/usr/bin/crustdesk`; the DC package runs the systemd service `crustdesk`. For the client
variant (no service), seed only the users' homes (and `/etc/skel/.config/crustdesk/` for new users).

**macOS**:

1. Stage the files in 2.3, unzip, move `cRustDesk.app` to `/Applications`.
2. Grant Screen Recording and Accessibility to the bundle ID `io.github.crabamole.crustdesk`; for a fleet,
   push an MDM PPPC profile.
3. DC only: launch the app once to install its service, or install it from the app. The client variant
   installs no service.

### 2.6 Unattended access (DC variant)

Set a permanent password after installing, as administrator/root: `cRustDesk --password '<password>'`
(Linux: `crustdesk`). It prints `Done!`. The password follows the "Set Password" dialog's rule: at least
8 characters with a digit, an uppercase and a lowercase letter. A password that breaks it is refused with
a non-zero exit code. The argument is visible in the process list while it runs; set it from a script,
not an interactive shell history.

### 2.7 Verify

- DC: `cRustDesk --get-id` (as administrator/root) prints the ID, and the device appears on the console's
  Devices page.
- Client: open the app, choose "Continue with <op>" (the IdP button), sign in, connect to a device ID.
  Logging in is required: the server refuses connections from clients that are not logged in.
- The console's Viewers list shows machines that log in with the client variant and have no device row
  (self-reported at login). Client builds never register or send heartbeats. A machine with a device row
  is listed as a device, including one that once ran stock RustDesk or the DC against this server (see
  [Moving from stock RustDesk](#moving-from-stock-rustdesk)).

## 3. Upgrades

- Server: follow the chart's `UPGRADING.md` for each chart release; it names the matching client release.
- Clients: the release notes of each client release say how to upgrade from the previous one.

## 4. Reference

### Uninstall

| Platform | How |
|---|---|
| Windows | Apps & Features, or `msiexec /x <product-code-or-msi>` |
| Ubuntu | `sudo apt purge crustdesk` (or `crustdesk-client`) |
| macOS | Unload and remove `/Library/LaunchDaemons/io.github.crabamole.cRustDesk_service.plist` and `/Library/LaunchAgents/io.github.crabamole.cRustDesk_server.plist`, remove the app and the preference folders in 2.3 |

### Windows `rustdesk://` links

Uninstalling stock RustDesk's MSI removes the `rustdesk://` link handler that cRustDesk shares. The DC's
service restores it within about a minute, or when it next starts. The client variant has no service;
repair it with the MSI it was installed from:

```powershell
msiexec /f cRustDesk-client-<ver>-x86_64.msi /qn
```

### Moving from stock RustDesk

Machines that ran stock RustDesk against the same server keep an old device row under their natural ID
with the old key; cRustDesk then registers under a random ID. Remove the stale rows when moving a fleet.
