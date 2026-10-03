# Design: Leveraging hbbs to Enforce Trusted Custom Builds

## Problem

On machines where users have admin privileges, they can:
1. Edit `RustDesk2.toml` to disable security settings
2. Replace the custom RustDesk binary with a stock upstream build

File-level and application-level enforcement can be bypassed by a local admin.

## Goal

Ensure that only trusted (corporate-built) RustDesk binaries can register as servers
on the corporate hbbs, using network-level enforcement.

## Prerequisites

- All RustDesk traffic routed through corporate hbbs/hbbr (e.g. WSS on port 443)
- All other RustDesk ports blocked at the network level
- Corporate hbbs is our fork (crabamole/rustdesk-server)

## Design: Shared Secret Attestation

### How It Works

```
  Custom Build                          hbbs (forked)
  ┌──────────┐                         ┌──────────┐
  │          │── RegisterPk ──────────►│          │
  │ embedded │   { id, pk, uuid,       │ checks   │
  │ token    │     attestation_token } │ token    │
  │          │◄── RegisterPkResponse ──│          │
  │          │   { result: OK }        │          │
  └──────────┘                         └──────────┘

  Stock Build                           hbbs (forked)
  ┌──────────┐                         ┌──────────┐
  │          │── RegisterPk ──────────►│          │
  │ no token │   { id, pk, uuid }      │ checks   │
  │          │◄── RegisterPkResponse ──│ token    │
  │          │   { result: REJECTED }  │          │
  └──────────┘                         └──────────┘
```

### Enforcement Chain

1. Network firewall blocks all direct RustDesk traffic
2. Only WSS through corporate proxy reaches hbbs/hbbr
3. hbbs requires attestation token during `RegisterPk`
4. Stock builds lack the token → rejected
5. Only custom builds with the embedded token can register as servers

### What Attestation Does NOT Cover

- Client connections (outgoing) — intentionally not blocked, stock clients are fine
- A determined admin reverse-engineering the token from the binary
- Non-RustDesk exfiltration methods (USB, email, cloud upload)

## Changes Required

### 1. Protobuf (libs/hbb_common)

Add field to `RegisterPk` in `libs/hbb_common/protos/rendezvous.proto`:

```protobuf
message RegisterPk {
    string id = 1;
    bytes uuid = 2;
    bytes pk = 3;
    string old_id = 4;
    // ... existing fields ...
    string attestation_token = 7;
}
```

Backwards-compatible: stock clients send empty string, ignored when attestation is off.

### 2. hbbs (rustdesk-server fork)

File: `src/rendezvous_server.rs`, TCP/WS `RegisterPk` handler (~line 636)

```rust
// After existing checks (id length, IP rate limiting)
if let Some(expected_token) = std::env::var("ATTESTATION_TOKEN").ok() {
    if !expected_token.is_empty() && msg.attestation_token != expected_token {
        log::warn!("Attestation failed for peer {} from {}", msg.id, addr);
        send_response(RegisterPkResponse {
            result: RegisterPkResponse_Result::NOT_AUTHORIZED,
            ..Default::default()
        });
        return;
    }
}
```

~15 lines. When `ATTESTATION_TOKEN` env var is unset or empty, check is skipped.

### 3. Custom Client Build (rustdesk fork)

File: `src/rendezvous_mediator.rs`, `register_pk()` function (~line 748)

```rust
let mut msg = RegisterPk {
    id: self_id.clone(),
    uuid: uuid.into(),
    pk: pk.into(),
    // ... existing fields ...
    attestation_token: get_attestation_token(),
    ..Default::default()
};
```

`get_attestation_token()` returns:
1. `RUSTDESK_ATTESTATION_TOKEN` env var (for testing/override)
2. Fallback: compiled-in constant

~10 lines.

### 4. Helm Chart (rustdesk-charts)

Add to `values.yaml`:

```yaml
hbbs:
  env:
    ATTESTATION_TOKEN: ""  # empty = attestation disabled
```

Set in deployment values:

```yaml
hbbs:
  env:
    ATTESTATION_TOKEN: "<shared-secret>"
```

~3 lines.

## Token Management

| Concern | Approach |
|---------|----------|
| Token generation | `openssl rand -hex 32` |
| Token in build | Compile-time constant or env var |
| Token in hbbs | `ATTESTATION_TOKEN` env var via Helm |
| Token rotation | Update hbbs env var + rebuild client binary |
| Token per group | Not in v1 — single token for all servers |

## Scope Summary

| Repo | Files Changed | Lines |
|------|--------------|-------|
| `libs/hbb_common` | `protos/rendezvous.proto` | ~1 |
| `crabamole/rustdesk-server` | `src/rendezvous_server.rs` | ~15 |
| `crabamole/rustdesk` | `src/rendezvous_mediator.rs`, `src/config.rs` | ~20 |
| `crabamole/rustdesk-charts` | `charts/values.yaml` | ~3 |

Total: ~40 lines of code across 4 repos.

## Build Pipeline

```
rustdesk fork
  ├── GitHub Actions
  │   ├── Linux: .deb + .AppImage (unsigned, $0)
  │   └── macOS: .dmg (codesigned + notarized, $99/yr)
  └── Secrets
      ├── ATTESTATION_TOKEN (shared secret)
      └── APPLE_DEVELOPER_CERT (macOS signing)
```

Windows builds run in `.github/workflows/windows-build.yml` (see [native-client-roadmap.md](native-client-roadmap.md)).

## Rollout

1. Add protobuf field (backwards compatible, no behavior change)
2. Patch hbbs with attestation check (disabled by default)
3. Build custom client with embedded token
4. Test on dev cluster with attestation enabled
5. Deploy to corporate: set `ATTESTATION_TOKEN` in Helm values
6. Distribute custom builds to server devices

## Related

- [design-clipboard-direction.md](design-clipboard-direction.md) — one-way clipboard
- [design-config-enforcement.md](design-config-enforcement.md) — protecting settings from user modification
