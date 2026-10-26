# Design: End-to-End Encryption Required

**Status: implemented (not released yet).**

## Background

A viewer encrypts a session with a key that only the device can open. Before it does, it checks
the device's identity twice:

1. hbbs's answer carries the device's public key, signed with the server key. The viewer checks
   that signature with the server key it is configured with.
2. On the relay, the device sends its identity signed with that device key. The viewer checks it.

Upstream continues without end-to-end encryption when either check fails. The native viewer
asks "Continue anyway?" (since upstream 1.5.0), the web client continues silently, and the device
accepts a viewer that sends no key.

## Behaviour

Our builds and the web client never run a session without end-to-end encryption.

- **Viewer** (native builds, web client): when a check fails, the connection ends with the
  message "Insecure connection: Could not verify end-to-end encryption, so the connection was
  refused. The server or the network may not be trusted. Contact your administrator." It is not
  retried. Upstream's "Continue anyway?" dialog is removed.
- **Device** (our builds): a viewer that answers the device's signed identity without a key, or
  with any other message, is refused before login.
- Direct IP access (`<ip>[:port]` as the ID) keeps upstream's behaviour on the viewer: there is no
  server to vouch for the device. Our DC build turns incoming direct access off, and its device
  side refuses a viewer without a key on every transport.
- WebRTC already refused an unverified channel upstream; unchanged.

## Requirements on a deployment

- The viewer must be configured with the server key: `key` in the web client's `config.json`, and
  the Key in the native client's server settings (or `--config`). hbbs already refuses a viewer
  whose key does not match.
- A device whose key changed (reinstall) is refused by hbbs until an administrator resets it
  ([design-device-key-change.md](design-device-key-change.md)); after the reset hbbs hands out the
  new key and sessions are encrypted again. Upstream's self-repair of a stale key, which relied on
  the unencrypted fallback, is not needed and no longer happens.

## Compatibility

- Stock viewers that fall back to no encryption cannot connect to our devices.
- Our viewers cannot connect to devices that do not sign their identity (very old stock clients).
