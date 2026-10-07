# Release notes

Newest first. The release workflow copies a version's section into its GitHub Release.

## 1.4.9-8

- Login is bound to the app or page that started it: the native app receives its result on a loopback redirect, the web client on a page of its own origin, each redeemed with a PKCE verifier. No polling.
- Installers carry a GitHub build attestation; check one with `gh attestation verify <file> --repo crabamole/rustdesk`.
- **Requires rustdesk-api 3.4.0 or later (Helm chart 0.8.0 or later).** rustdesk-api 3.4.0 refuses logins from cRustDesk 1.4.9-7 and earlier and from stock RustDesk clients; cRustDesk 1.4.9-8 cannot log in to rustdesk-api 3.3.x or earlier.
