# RustDesk Linux Pre-Seed Installation

Automated installation of RustDesk on Linux with pre-configured settings, so the client registers to a custom rendezvous server on first boot with no manual configuration.

## Prerequisites

- RustDesk `.deb` installer (e.g. `rustdesk-1.4.9-x86_64.deb`)
- Root access on the target machine
- A running graphical display manager (LightDM, GDM, or SDDM)

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

## Why Config Must Be in Two Paths

RustDesk runs as two processes on Linux:

| Process | User | Config Path |
|---|---|---|
| `rustdesk --service` | root | `/root/.config/rustdesk/` |
| `rustdesk --server` | display user (e.g. `lightdm`) | `/var/lib/lightdm/.config/rustdesk/` |

The `--server` process loads its config from the display user's home directory **before** IPC sync from root runs. If the display user has no config file, it starts with defaults (connecting to `rs-ny.rustdesk.com`), then pushes those defaults back to root — overwriting any root-only pre-staged config within seconds.

**Both paths must have the config file before installation.**

## Display User Detection

The display user depends on the display manager:

| Display Manager | System User | Home Directory |
|---|---|---|
| LightDM | `lightdm` | `/var/lib/lightdm/` |
| GDM | `gdm` or `gdm3` | `/var/lib/gdm3/` or `/var/lib/gdm/` |
| SDDM | `sddm` | `/var/lib/sddm/` |

Detection methods (all work before RustDesk is installed):

```bash
# Method 1: Check default display manager
cat /etc/X11/default-display-manager
# Returns e.g. /usr/sbin/lightdm

# Method 2: Check which DM service is active
for dm in lightdm gdm gdm3 sddm; do
  systemctl is-active "$dm" --quiet && echo "$dm"
done

# Method 3: Check which DM user exists
for user in lightdm gdm gdm3 sddm; do
  getent passwd "$user" >/dev/null 2>&1 && echo "$user"
done
```

## Install Script

```bash
#!/usr/bin/env bash
set -euo pipefail

INSTALLER="${1:?Usage: $0 <rustdesk.deb> <config.toml>}"
CONFIG="${2:?Usage: $0 <rustdesk.deb> <config.toml>}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Error: must run as root" >&2
  exit 1
fi

if [ ! -f "$INSTALLER" ]; then
  echo "Error: installer not found: $INSTALLER" >&2
  exit 1
fi

if [ ! -f "$CONFIG" ]; then
  echo "Error: config not found: $CONFIG" >&2
  exit 1
fi

# Detect display user
detect_display_user() {
  local dm_path dm_name
  dm_path=$(cat /etc/X11/default-display-manager 2>/dev/null || true)
  dm_name=$(basename "$dm_path" 2>/dev/null || true)

  case "$dm_name" in
    lightdm) echo "lightdm" ;;
    gdm|gdm3)
      # gdm3 on Debian/Ubuntu, gdm on Fedora/RHEL
      getent passwd gdm3 >/dev/null 2>&1 && echo "gdm3" || echo "gdm"
      ;;
    sddm) echo "sddm" ;;
    *)
      # Fallback: check which user exists
      for user in lightdm gdm gdm3 sddm; do
        if getent passwd "$user" >/dev/null 2>&1; then
          echo "$user"
          return
        fi
      done
      echo "Error: could not detect display user" >&2
      return 1
      ;;
  esac
}

DISPLAY_USER=$(detect_display_user)
DISPLAY_HOME=$(getent passwd "$DISPLAY_USER" | cut -d: -f6)

echo "Display user: $DISPLAY_USER (home: $DISPLAY_HOME)"

# Pre-stage config in both paths
for dir in "/root/.config/rustdesk" "$DISPLAY_HOME/.config/rustdesk"; do
  mkdir -p "$dir"
  cp "$CONFIG" "$dir/RustDesk2.toml"
done
chown -R "$DISPLAY_USER:$(id -gn "$DISPLAY_USER")" "$DISPLAY_HOME/.config/rustdesk"

echo "Config staged in:"
echo "  /root/.config/rustdesk/RustDesk2.toml"
echo "  $DISPLAY_HOME/.config/rustdesk/RustDesk2.toml"

# Install
dpkg -i "$INSTALLER" || apt-get install -f -y

# Verify
sleep 5
if ps -eo user,args | grep -q "[r]ustdesk --server"; then
  echo "RustDesk service running."
  SERVER=$(grep 'custom-rendezvous-server' /root/.config/rustdesk/RustDesk2.toml | head -1)
  echo "Config check: $SERVER"
else
  echo "Warning: RustDesk service not running yet."
fi
```

### Usage

```bash
sudo bash install-rustdesk.sh rustdesk-1.4.9-x86_64.deb RustDesk2.toml
```

## Verification

After installation, confirm the config survived:

```bash
# Check both configs still have custom server
sudo grep custom-rendezvous-server /root/.config/rustdesk/RustDesk2.toml
sudo cat /var/lib/lightdm/.config/rustdesk/RustDesk2.toml | grep custom-rendezvous-server

# Check --server is connecting to your server (not rs-ny.rustdesk.com)
sudo cat /var/lib/lightdm/.local/share/logs/RustDesk/server/rustdesk_rCURRENT.log \
  | grep "start rendezvous mediator"

# Check hbbs registration
sudo cat /var/lib/lightdm/.local/share/logs/RustDesk/server/rustdesk_rCURRENT.log \
  | grep "start tcp"
```

Expected output:
```
start rendezvous mediator of your-server.example.com
start tcp: wss://your-server.example.com/ws/id
```

## Uninstall

```bash
sudo systemctl stop rustdesk.service
sudo dpkg --purge rustdesk
sudo rm -rf /root/.config/rustdesk
sudo rm -rf /var/lib/lightdm/.config/rustdesk  # adjust for your display user
```

## To Be Investigated

- **`api-server` side effects** — Setting `api-server = 'https://...'` triggers WSS protocol selection (checked in `websocket.rs:391`), but it also causes the client to send periodic `/api/heartbeat` and `/api/switch-grant` requests to that URL. Document the side effects or find a cleaner way to trigger WSS.
- **Password pre-staging** — The install script pre-stages `RustDesk2.toml` but not `RustDesk.toml`. The permanent password lives in `RustDesk.toml` and is hashed on first load (plain text → `00` + base64(SHA256)). Server-side password push is not possible without custom client builds — the strategy push mechanism (`config_options`) only covers `[options]` fields, not the password. Add a post-install step to pre-stage `RustDesk.toml` with a plain text password, or use `RustDesk --password <pw>` after install (requires working IPC service).
