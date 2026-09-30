# Design: Server Clipboard Direction Control

## Problem

In a corporate deployment, data exfiltration via clipboard is a risk. Users connecting
to a server can copy text from the server's clipboard to their local machine.

## Goal

One-way clipboard: users can paste INTO servers (client→server), but cannot copy OUT
(server→client).

## Existing Feature

RustDesk already has `one-way-clipboard-redirection` as a builtin option.

`src/server/connection.rs:2247-2251`:

```rust
fn can_sub_clipboard_service(&self) -> bool {
    self.clipboard_enabled()
        && self.peer_keyboard_enabled()
        && crate::get_builtin_option(keys::OPTION_ONE_WAY_CLIPBOARD_REDIRECTION) != "Y"
}
```

It is a built-in setting (`KEYS_BUILDIN_SETTINGS`): `get_builtin_option()` reads only
`BUILTIN_SETTINGS`, which is filled only from a signed `custom.txt` (`src/common.rs:2180`).

When set to `"Y"`:
- Server does NOT subscribe to its local clipboard service
- Server never sends clipboard data to the client
- Inbound clipboard (client→server) is unaffected

## How to Enable

### Not possible: RustDesk2.toml or strategy push

`one-way-clipboard-redirection = 'Y'` under `[options]` in `RustDesk2.toml` is ignored, and so is
the same key in a strategy push (both write normal options, not `BUILTIN_SETTINGS`).
Verified 2026-10-01 on a stock 1.4.9 Linux host: with the option set, text copied on the host
still reached the web client.

### Option B: custom.txt (requires custom build)

Put the key under `override-settings` (or `default-settings`) in `custom.txt`. Top-level keys
go to `HARD_SETTINGS`, which this check does not read:

```json
{
  "override-settings": {
    "one-way-clipboard-redirection": "Y"
  }
}
```

Requires replacing the `custom.txt` signing key in the binary (see design-trusted-builds.md).

### Option C: Hardcode in source (requires custom build)

Set in `BUILTIN_SETTINGS` at compile time. User cannot override.

Requires building the desktop app from our fork.

## Recommendation

Every working option needs our own native build (see design-trusted-builds.md). Option B
keeps the setting out of the binary, so it can differ per deployment; Option C is simpler.

## Verification

Test by connecting to a server with the setting enabled:
1. Copy text on the server's desktop
2. Attempt to paste on the client → should NOT paste server's text
3. Copy text on the client, paste on the server → should work

## Related

- [design-config-enforcement.md](design-config-enforcement.md) — preventing users from modifying settings
- [design-trusted-builds.md](design-trusted-builds.md) — custom builds with enforced settings
