# Release notes

Newest first. The release workflow copies a version's section into its GitHub Release.

## 1.4.9-9

- The relay is always the one hbbs hands out: the relay-server setting is gone from our native builds (not read, not shown, not exported; `--config` ignores `relay`), and the web client dials the relay URL hbbs returns. Needed for several hbbr pods.
- Web client: connecting to an unknown ID shows "ID does not exist" instead of nothing.
- **Upgrade together:** hbbs, hbbr, the api-server, the web client, our native clients and the Helm chart of the multi-replica release; see the chart's `UPGRADING.md`.
- The web client needs `wss://` relay URLs when served over https; the chart derives the scheme from `PUBLIC_URL`.

## 1.4.9-8

- Login is bound to the app or page that started it: the native app receives its result on a loopback redirect, the web client on a page of its own origin, each redeemed with a PKCE verifier. No polling.
- Installers carry a GitHub build attestation; check one with `gh attestation verify <file> --repo crabamole/rustdesk`.
- **Requires rustdesk-api 3.4.0 or later (Helm chart 0.8.0 or later).** rustdesk-api 3.4.0 refuses logins from cRustDesk 1.4.9-7 and earlier and from stock RustDesk clients; cRustDesk 1.4.9-8 cannot log in to rustdesk-api 3.3.x or earlier.
