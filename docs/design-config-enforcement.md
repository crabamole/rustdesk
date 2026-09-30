# Design: Preventing Users from Modifying Server Config

## Problem

Server settings like `enable-clipboard` are stored in `RustDesk2.toml`.
Users with admin or file access can edit this file and disable security controls.
Built-in settings such as `one-way-clipboard-redirection` cannot be set there at all; they come
only from a signed `custom.txt` or the source (see design-clipboard-direction.md).

## Goal

Enforce server configuration so that users cannot override security-critical settings,
even with admin privileges.

## RustDesk Config Hierarchy

RustDesk has three tiers of settings, loaded from `custom.txt`:

| Tier | Constant | User can override? | User can see? |
|------|----------|-------------------|---------------|
| Hard settings | `HARD_SETTINGS` | No | No |
| Override settings | `OVERWRITE_SETTINGS` | No | Yes |
| Default settings | `DEFAULT_SETTINGS` | Yes | Yes |

`custom.txt` is a JSON blob, **signed with ed25519**, and verified against a public key
hardcoded at `src/common.rs:2238`.

## The Signing Problem

The `custom.txt` verification key is RustDesk's own key. Without their private key,
we cannot create a valid `custom.txt` for stock upstream builds.

### Options

| Approach | Custom build? | Enforcement | Effort |
|----------|--------------|-------------|--------|
| RustDesk2.toml only | No | User can edit | Zero |
| File permissions (chmod) | No | Root can still edit | Low |
| Replace signing key in source | Yes | Full — signed custom.txt | Medium |
| Hardcode in BUILTIN_SETTINGS | Yes | Full — compiled in | Medium |
| Attestation at hbbs | Yes (both sides) | Full — network enforced | High |

### Option 1: File Permissions (no custom build)

```bash
# Set config as root, remove write permission
sudo chmod 444 /root/.config/rustdesk/RustDesk2.toml
sudo chattr +i /root/.config/rustdesk/RustDesk2.toml  # immutable flag (Linux)
```

- Works on Linux/macOS where RustDesk runs as a system service
- A user with sudo/root can undo this
- Cheapest option — no code changes

### Option 2: Replace custom.txt Signing Key (custom build)

1. Generate ed25519 keypair: `sodiumoxide::crypto::sign::gen_keypair()`
2. Replace public key at `src/common.rs:2238`
3. Build the desktop app from our fork
4. Sign `custom.txt` with our private key
5. Ship signed `custom.txt` alongside the binary

`custom.txt` content:

```json
{
  "override-settings": {
    "one-way-clipboard-redirection": "Y",
    "allow-websocket": "Y",
    "disable-udp": "Y",
    "custom-rendezvous-server": "rustdesk.example.com",
    "key": "<server-public-key>"
  }
}
```

Override settings are visible but locked. Top-level keys become hard settings
(`HARD_SETTINGS`), which RustDesk reads only for a few keys such as `password` and
`conn-type`; other options placed there have no effect.

### Option 3: Hardcode in Source (custom build)

Populate `BUILTIN_SETTINGS` directly in the Rust source at compile time.
Functionally identical to Option 2 but without the `custom.txt` file.

Simpler to implement but requires rebuilding to change any setting.

## Recommendation

- **Secured machines** (Mac, no admin): Option 1 (file permissions) is sufficient for normal
  options; built-in settings need Option 2 or 3
- **Admin-access machines**: Option 2 (custom.txt signing) provides the strongest
  enforcement within the application. Combine with hbbs attestation
  (see design-trusted-builds.md) to prevent binary replacement.

## Platform Notes

### macOS
- Config: `~/Library/Preferences/com.carriez.RustDesk/RustDesk2.toml`
- MDM can enforce file policies and prevent modification
- Gatekeeper blocks unsigned custom builds (Apple Developer cert needed, $99/yr)

### Linux
- Config: `/root/.config/rustdesk/RustDesk2.toml` (service) or `~/.config/rustdesk/` (user)
- `chattr +i` prevents modification even by root (requires `chattr -i` to undo)
- No code signing needed for .deb or .AppImage

### Windows
- Config: `%APPDATA%\RustDesk\config\RustDesk2.toml`
- GPO can restrict file access
- Custom builds trigger SmartScreen warnings without code signing cert ($280-580/yr)

## Related

- [design-clipboard-direction.md](design-clipboard-direction.md) — the setting being protected
- [design-trusted-builds.md](design-trusted-builds.md) — custom builds and hbbs attestation
