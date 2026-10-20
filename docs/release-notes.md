# Release notes

Newest first. The release workflow copies a version's section into its GitHub Release.

## 1.5.0-3 (unreleased)

- With WebSocket on (always in our builds), clients no longer look up or contact public STUN servers at service or app start to find a public IPv6 address. IPv6 hole punching does not run over WebSocket, so nothing used that address.
- The DC variant's `custom.txt` locks LAN discovery off: the device no longer answers LAN discovery broadcasts. The client variant never answered them.

## 1.5.0-2

- Devices sign their calls to the api-server (heartbeat, system info, connection, file and alarm records) with the key they registered with hbbs. An api-server that checks the signature accepts these calls only from the device itself.
- A device keeps its ID when hbbs refuses a changed key (for example after its configuration was lost). The status line says so and offers "Log in to keep this ID": the device's owner logs in on it to approve the new key, or an administrator resets the key.
- Same-user access: when the api-server allows it, the user who logged in on a device connects to it without its password.
- Web client: the settings page no longer shows the language card, which failed to render, and the ID help no longer lists forms the web client ignores.
- Works with the current servers (rustdesk-server 1.1.16-5, rustdesk-api 3.6.0, Helm chart 0.11.0); there the new device features have no effect. They need the next server release, whose notes state the pairing.

## 1.5.0-1

- Based on upstream RustDesk 1.5.0: handshake hardening and security fixes, plus capture and input fixes. Our `hbb_common` fork merges upstream's matching changes.
- Log in first: while logged out, a login button takes the place of the remote ID field, and connecting asks for the login first. With one identity provider, the button starts the sign-in at once. A line at the bottom shows who is logged in.
- Both `custom.txt` files lock two new upstream options off: WebRTC peer-to-peer connections and clipboard sync between sessions.
- Linux: headless mode (starting a desktop session for a logged-out machine) is gone upstream; the packages no longer ship its PAM and Xorg files.
- Web client: the login button shows the provider name without braces, and the login progress reads as on the native app.
- Works with the current servers (rustdesk-server 1.1.16-5, rustdesk-api 3.6.0, Helm chart 0.11.0) and next to 1.4.9-9 clients; nothing on the server side needs upgrading.

## 1.4.9-9

- The relay is always the one hbbs hands out: the relay-server setting is gone from our native builds (not read, not shown, not exported; `--config` ignores `relay`), and the web client dials the relay URL hbbs returns. Clients dial it as given, only as a `ws(s)://` URL, and fail without one; they no longer fall back to the rendezvous host, a default port or `/ws/relay`. Needed for several hbbr pods.
- The web-client image drops `RUSTDESK_RELAY` and the `relay` key of `config.json`.
- Server settings: the dialog is titled "Server".
- Web client: connecting to an unknown ID shows "ID does not exist" instead of nothing.
- **Upgrade together:** hbbs, hbbr, the api-server, the web client, our native clients and the Helm chart of the multi-replica release; see the chart's `UPGRADING.md`.
- The web client needs `wss://` relay URLs when served over https; the chart derives the scheme from `PUBLIC_URL`.

## 1.4.9-8

- Login is bound to the app or page that started it: the native app receives its result on a loopback redirect, the web client on a page of its own origin, each redeemed with a PKCE verifier. No polling.
- Installers carry a GitHub build attestation; check one with `gh attestation verify <file> --repo crabamole/rustdesk`.
- **Requires rustdesk-api 3.4.0 or later (Helm chart 0.8.0 or later).** rustdesk-api 3.4.0 refuses logins from cRustDesk 1.4.9-7 and earlier and from stock RustDesk clients; cRustDesk 1.4.9-8 cannot log in to rustdesk-api 3.3.x or earlier.
