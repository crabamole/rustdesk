# RustDesk macOS Pre-Seed Installation

Automated installation of RustDesk on macOS with pre-configured settings, so the client registers to a custom rendezvous server on first launch.

## Prerequisites

- RustDesk `.dmg` installer (e.g. `rustdesk-1.4.9-aarch64.dmg`)
- Admin access on the target machine
- macOS permissions granted: Local Network, Screen Recording, Accessibility

## Config Template

Create `RustDesk2.toml` with your server settings:

```toml
rendezvous_server = ''
nat_type = 0
serial = 0
unlock_pin = ''
trusted_devices = ''

[options]
custom-rendezvous-server = 'your-server.example.com'
api-server = 'https://your-server.example.com'
key = '<your-public-key>'
allow-websocket = 'Y'
disable-udp = 'Y'
direct-server = 'Y'
enable-udp-punch = 'N'
enable-lan-discovery = 'N'
verification-method = 'use-permanent-password'
```

### Option reference

| Option | Purpose |
|---|---|
| `custom-rendezvous-server` | Your hbbs server address |
| `api-server` | Set to `https://...` to trigger WSS (not plain WS) |
| `key` | Server public key (from hbbs keypair) |
| `allow-websocket` | Register via WebSocket instead of UDP — required when hbbs is behind a reverse proxy |
| `disable-udp` | Node-side, disables ALL UDP traffic |
| `direct-server` | Enable direct TCP connections to this node |
| `enable-udp-punch` | Disable UDP hole punching |
| `enable-lan-discovery` | Disable LAN peer discovery |
| `verification-method` | `use-permanent-password` for unattended access |

## Config Path

Unlike Linux, macOS only needs one config path — the logged-in user's:

```
~/Library/Preferences/com.carriez.RustDesk/RustDesk2.toml
```

No root config is needed. The `--server` process runs as the logged-in user and reads config directly from this path before any IPC sync attempt.

## Install Steps

### 1. Pre-stage config

```bash
mkdir -p ~/Library/Preferences/com.carriez.RustDesk
cp RustDesk2.toml ~/Library/Preferences/com.carriez.RustDesk/RustDesk2.toml
```

### 2. Install from DMG

```bash
hdiutil attach rustdesk-1.4.9-aarch64.dmg -nobrowse -quiet
sudo cp -R /Volumes/rustdesk-1.4.9/RustDesk.app /Applications/
hdiutil detach /Volumes/rustdesk-1.4.9 -quiet
```

### 3. Launch

```bash
open /Applications/RustDesk.app
```

### 4. Install service (manual step)

Click **"Install"** in the RustDesk UI when prompted. This sets up two launchd services:

| Service | Plist | Purpose |
|---|---|---|
| Root daemon | `/Library/LaunchDaemons/com.carriez.RustDesk_service.plist` | Background service |
| User agent | `/Library/LaunchAgents/com.carriez.RustDesk_server.plist` | `--server` for screen capture and input |

This step **cannot be fully automated** — macOS requires a privilege prompt via osascript to install system daemons. The launchd plist files can be placed manually with sudo, but the user agent only loads in an active GUI session (Aqua), not via SSH.

## Install Script

```bash
#!/usr/bin/env bash
set -euo pipefail

INSTALLER="${1:?Usage: $0 <rustdesk.dmg> <config.toml>}"
CONFIG="${2:?Usage: $0 <rustdesk.dmg> <config.toml>}"

if [ ! -f "$INSTALLER" ]; then
  echo "Error: installer not found: $INSTALLER" >&2
  exit 1
fi

if [ ! -f "$CONFIG" ]; then
  echo "Error: config not found: $CONFIG" >&2
  exit 1
fi

# Pre-stage config
mkdir -p ~/Library/Preferences/com.carriez.RustDesk
cp "$CONFIG" ~/Library/Preferences/com.carriez.RustDesk/RustDesk2.toml
echo "Config staged: ~/Library/Preferences/com.carriez.RustDesk/RustDesk2.toml"

# Mount and install
VOLUME=$(hdiutil attach "$INSTALLER" -nobrowse -quiet 2>&1 | grep '/Volumes/' | awk '{print $3}')
if [ -z "$VOLUME" ]; then
  # Fallback: find the mounted volume
  VOLUME=$(ls -d /Volumes/rustdesk-* 2>/dev/null | head -1)
fi

if [ -z "$VOLUME" ]; then
  echo "Error: could not mount DMG" >&2
  exit 1
fi

sudo cp -R "$VOLUME/RustDesk.app" /Applications/
hdiutil detach "$VOLUME" -quiet
echo "App installed: /Applications/RustDesk.app"

# Launch
open /Applications/RustDesk.app
echo ""
echo "RustDesk launched."
echo ">>> Click 'Install' in the RustDesk window to set up the background service. <<<"
```

### Usage

```bash
bash install-rustdesk.sh rustdesk-1.4.9-aarch64.dmg RustDesk2.toml
```

## Verification

```bash
# Check config was picked up (after launching the app)
grep custom-rendezvous-server ~/Library/Preferences/com.carriez.RustDesk/RustDesk2.toml

# Check logs for correct server connection
grep "start rendezvous mediator" ~/Library/Logs/RustDesk/RustDesk_rCURRENT.log
grep "start tcp" ~/Library/Logs/RustDesk/RustDesk_rCURRENT.log
```

Expected output:
```
start rendezvous mediator of your-server.example.com
start tcp: wss://your-server.example.com/ws/id
```

After clicking "Install", the `--server` log moves to:
```
~/Library/Logs/RustDesk/server/RustDesk_rCURRENT.log
```

## Uninstall

```bash
sudo launchctl unload /Library/LaunchDaemons/com.carriez.RustDesk_service.plist 2>/dev/null
launchctl unload /Library/LaunchAgents/com.carriez.RustDesk_server.plist 2>/dev/null
sudo rm -f /Library/LaunchDaemons/com.carriez.RustDesk_service.plist
sudo rm -f /Library/LaunchAgents/com.carriez.RustDesk_server.plist
pkill -f RustDesk
sudo rm -rf /Applications/RustDesk.app
rm -rf ~/Library/Preferences/com.carriez.RustDesk
rm -rf ~/Library/Logs/RustDesk
```

Launchd services **must** be unloaded before removing the app — deleting the `.app` alone leaves the daemon running with stale config.

## Platform Notes

- **Only user config path needed** — unlike Linux, no root or display-user duplication required
- **Service install requires GUI interaction** — the "Install" button triggers an osascript privilege prompt that cannot be bypassed via SSH
- **macOS permissions** — Local Network permission is critical; without it, WebSocket connections fail instantly with "No route to host" (not a timeout). Screen Recording and Accessibility are needed for remote control.
- **IPC sync to root** — the `--server` process attempts IPC sync with the root `service` daemon, but this is not required for config to work. The user config is read directly on process startup.

## To Be Investigated

- **`api-server` side effects** — Setting `api-server = 'https://...'` triggers WSS protocol selection (checked in `websocket.rs:391`), but it also causes the client to send periodic `/api/heartbeat` and `/api/switch-grant` requests to that URL. Document the side effects or find a cleaner way to trigger WSS.
- **Root service config divergence** — The root service creates its own `RustDesk.toml` at `/var/root/Library/Preferences/com.carriez.RustDesk/` with empty password/salt. The user process reads password from the user's `RustDesk.toml`. Investigate whether "initial config sync from root failed" can cause the root service to overwrite the user config on a successful sync.
- **Password pre-staging** — The install script pre-stages `RustDesk2.toml` but not `RustDesk.toml`. The permanent password lives in `RustDesk.toml` and is hashed on first load (plain text → `00` + base64(SHA256)). Server-side password push is not possible without custom client builds — the strategy push mechanism (`config_options`) only covers `[options]` fields, not the password. Add a post-install step to pre-stage `RustDesk.toml` with a plain text password, or use `RustDesk --password <pw>` after install (requires working IPC service).
- **TCC permission automation** — Screen Recording and Accessibility can be pre-granted via `sqlite3` on `/Library/Application Support/com.apple.TCC/TCC.db` (e.g. `INSERT INTO access ... VALUES ('kTCCServiceScreenCapture', 'com.carriez.rustdesk', 0, 2, ...)`). Document this for enterprise deployment or add to the install script.
- **`--server` LaunchAgent vs GUI process** — When RustDesk is launched via `open`, the GUI process handles server functionality. The `--server` LaunchAgent (`com.carriez.RustDesk_server`) may not be running. Clarify which process handles incoming connections in each scenario.
