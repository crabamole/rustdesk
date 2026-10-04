# Stock RustDesk client pre-seed install guide (Linux)

This guide applies to upstream RustDesk, not to cRustDesk. For our builds see [crustdesk-install.md](crustdesk-install.md).

Automated installation of RustDesk on Linux with pre-configured settings, so the client registers to a custom rendezvous server on first boot with no manual configuration.

> **If the pre-seed is incomplete, the device registers with RustDesk's public server** (`rs-ny.rustdesk.com`) and overwrites your pre-staged config within a second. Follow [Where the Config Must Be](#where-the-config-must-be) and check the result with [Verification](#verification).

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

`RustDesk2.toml` holds the `[options]`. Do not copy a `RustDesk.toml` between machines: it holds the device's ID and key pair, so every copy would be the same device.

### Option reference

| Option | Purpose |
|---|---|
| `custom-rendezvous-server` | Your hbbs server address |
| `api-server` | Your API server; the client logs in, sends heartbeats and receives the device policy through it. An `https://` URL also makes WebSocket connections use WSS |
| `key` | Server public key (from hbbs keypair) |
| `allow-websocket` | Register via WebSocket instead of UDP — required when hbbs is behind a reverse proxy |
| `disable-udp` | Node-side, disables ALL UDP traffic |
| `direct-server` | Enable direct IP access to this node |
| `enable-udp-punch` | Disable UDP hole punching |
| `enable-lan-discovery` | Disable LAN peer discovery |
| `verification-method` | `use-permanent-password` for unattended access |

## Where the Config Must Be

RustDesk runs as two processes on Linux, each with its own config:

| Process | Runs as | Config path |
|---|---|---|
| `rustdesk --service` | root | `/root/.config/rustdesk/` |
| `rustdesk --server` | the logged-in desktop user, or the display manager's user (e.g. `lightdm`) at the login screen | that user's `~/.config/rustdesk/` |

On first install, root has no device ID yet, so `--server` does not copy root's config. If its own user has no config file, it starts with defaults, registers with `rs-ny.rustdesk.com`, and pushes those defaults back to root, overwriting the pre-staged config.

**Before installing, put the config in:**

- `/root/.config/rustdesk/`
- the display manager user's home (used at the login screen)
- the home of every user logged in to a desktop at that moment (auto-login counts)

Users who log in later need nothing: once the device has an ID, their `--server` copies root's config on start.

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

Logged-in users: `loginctl list-sessions --no-legend` (third column).

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

stage_for_user() {
  local user="$1" home
  home=$(getent passwd "$user" | cut -d: -f6)
  [ -n "$home" ] || return 0
  mkdir -p "$home/.config/rustdesk"
  cp "$CONFIG" "$home/.config/rustdesk/RustDesk2.toml"
  chown -R "$user:$(id -gn "$user")" "$home/.config/rustdesk"
  echo "  $home/.config/rustdesk/RustDesk2.toml"
}

DISPLAY_USER=$(detect_display_user)
echo "Display user: $DISPLAY_USER"

echo "Config staged in:"
mkdir -p /root/.config/rustdesk
cp "$CONFIG" /root/.config/rustdesk/RustDesk2.toml
echo "  /root/.config/rustdesk/RustDesk2.toml"
stage_for_user "$DISPLAY_USER"
# Users logged in now run --server as themselves as soon as the service starts.
for user in $(loginctl list-sessions --no-legend | awk '{print $3}' | sort -u); do
  [ "$user" = root ] || [ "$user" = "$DISPLAY_USER" ] || stage_for_user "$user"
done

# Install
dpkg -i "$INSTALLER" || apt-get install -f -y

# Verify
sleep 10
# Skip the root `sudo ... -u <user> rustdesk --server` wrapper.
SERVER_USER=$(ps -eo user,args | awk '$2 ~ /rustdesk$/ && $3 == "--server" {print $1}' | head -1 || true)
if [ -z "$SERVER_USER" ]; then
  echo "Warning: RustDesk server process not running yet."
  exit 0
fi
SERVER_HOME=$(getent passwd "$SERVER_USER" | cut -d: -f6)
echo "--server runs as $SERVER_USER; it connected to:"
grep -h "start rendezvous mediator" "$SERVER_HOME"/.local/share/logs/RustDesk/server/*.log 2>/dev/null | tail -1 || true
echo "Check that this names your server, not rs-ny.rustdesk.com."

```

### Usage

```bash
sudo bash install-rustdesk.sh rustdesk-1.4.9-x86_64.deb RustDesk2.toml
```

### Permanent password

For unattended access, set the password after installing (as root):

```bash
sudo rustdesk --password '<password>'
```

It prints `Done!` and is stored per device, hashed, in `RustDesk.toml`.

## Verification

After installation, confirm every copy kept your server:

```bash
sudo grep -H custom-rendezvous-server /root/.config/rustdesk/RustDesk2.toml \
  /var/lib/*/.config/rustdesk/RustDesk2.toml /home/*/.config/rustdesk/RustDesk2.toml

# Who runs --server, and which server it connected to
ps -eo user,args | grep "[r]ustdesk --server"
sudo grep -h "start rendezvous mediator\|start tcp" \
  /home/*/.local/share/logs/RustDesk/server/*.log \
  /var/lib/*/.local/share/logs/RustDesk/server/*.log 2>/dev/null | tail -2
```

Expected output of the last command:
```
start rendezvous mediator of your-server.example.com
start tcp: wss://your-server.example.com/ws/id
```

If it shows `rs-ny.rustdesk.com`, a copy was missing: [uninstall](#uninstall) and install again with the config in every place listed above.

## Uninstall

`dpkg --purge` removes only root's config. Each user's config (including the device ID in `RustDesk.toml`), logs and autostart entry remain, and a reinstall picks them up. Run this as a script file, not as a `bash -c '...'` one-liner: stopping the service runs `pkill -f "rustdesk --"`, which also kills a shell whose command line contains that text.

```bash
#!/bin/bash
systemctl stop rustdesk
dpkg --purge rustdesk
pkill -f "rustdesk --" || true
for h in /root /home/* /var/lib/lightdm /var/lib/gdm3 /var/lib/gdm /var/lib/sddm; do
  [ -d "$h" ] || continue
  rm -rf "$h/.config/rustdesk" "$h/.local/share/logs/RustDesk"
  find "$h/.config/autostart" -maxdepth 1 -iname 'rustdesk*.desktop' -delete 2>/dev/null
done
```

Session recordings, if any, stay in each user's `~/Videos/RustDesk`. Removing `RustDesk.toml` gives the device a new ID on reinstall; back up `/root/.config/rustdesk/RustDesk.toml` first to keep it.
