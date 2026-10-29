# Release notes

Newest first. The release workflow copies a version's section into its GitHub Release.

Native clients. From 2.0.0 the web client has its own version and notes: [web-client-release-notes.md](web-client-release-notes.md).

## 1.5.0-6

- Device admission: a device shows "pending" or "rejected" in its home-page status line while an administrator has not admitted it. Needs rustdesk-server 1.1.16-7 and rustdesk-api 3.9.0 with the chart's `deviceAdmission` switch on; with the switch off nothing changes.
- **Sessions always use end-to-end encryption.** A viewer (native and web) refuses a device whose key it cannot verify, instead of offering "Continue anyway"; a device refuses a viewer that sends no key. Older viewers that use "Continue anyway" are refused by 1.5.0-6 devices.
- macOS: a device whose `--server` crashes is restarted at once and macOS writes a crash report. Before, it stayed offline until the next login.
- Web client, now close to the native session features: Take screenshot; Copy fingerprint; choosing a monitor shows it; follow the remote cursor and window across monitors; display changes during a session; privacy mode and block user input with the device's replies; virtual displays; choosing the Windows user session to view; Map keyboard mode; the remote cursor shape; the session toolbar and its options reach the device. Recent sessions, Favorites and the session history menu (Delete, Rename, Forget password) work as on native clients.
- Web client: a dropped connection is retried with the Reconnect countdown; the device's connection prompt and the audit name the logged-in user instead of "web"; a link `<web client>/#/<id>` opens a session to that device, and a password in such a link is ignored.
- Not in the web client: file transfer, terminal, camera, TCP tunneling and RDP, Switch Sides, recording, voice call, the codec menu and Translate keyboard mode.
- Works with rustdesk-server 1.1.16-7, rustdesk-api 3.9.0 and Helm chart 0.14.0.

## 1.5.0-5

- The About page shows "cRustDesk v<version> · source · based on RustDesk · AGPL-3.0", with links to this project, to upstream RustDesk and to the licence. The RustDesk website and privacy links, the vendor copyright line and the slogan are removed. Report problems at github.com/crabamole/rustdesk/issues, not to RustDesk.
- "Powered by RustDesk" is hidden (both `custom.txt` files, and the web client).
- The Windows install page links its licence to our `LICENCE`. "Set up your own server" (shown only when no server is set) opens crabamole.github.io.
- Web client: the app name is cRustDesk (the tab title and the top bar showed only "(Preview)").
- File metadata names crabamole: copyright "crabamole contributors, based on RustDesk" in the Windows programs and the macOS app; the MSI support links go to this project; the `.deb` maintainer is crabamole.
- Unchanged: the Linux and macOS help links to RustDesk's documentation.
- Works with rustdesk-server 1.1.16-6, rustdesk-api 3.8.1 and Helm chart 0.13.1.

## 1.5.0-4

- Clipboard text on request: a copy on the viewer sends only the format names to the device. The device fetches the text when a program on it reads the clipboard, usually a paste. Text, RTF and HTML; file copy does not change.
- **Upgrade viewers and devices together.** With an older client on either side, pasting text into the device does not work.
- Limits: Firefox and Safari web viewers cannot paste into a device; Android and iOS viewers cannot paste into devices with this release; desktop and web viewers cannot paste into Android devices or Wayland desktops; images are no longer sent to the device; on a macOS device, input can pause for up to 2 s while a program waits for the viewer's text. A program on the device that reads the clipboard in the background (a security tool, a clipboard manager) fetches the text at once.
- Clipboard audit: the device records each arrival of viewer text at the api-server (format, size, viewer and user; never the text). The console shows it under Audit log, Clipboard. Needs rustdesk-api 3.8.0; with an older api-server the record is dropped and nothing else changes.
- Web client: the "old device" clipboard note now stays visible after the first image; a failed copy into the browser no longer marks that text as offered; the browser clipboard tip shows only after Ctrl/Cmd+V, not when the pointer enters the session.
- Windows: the MSIs and their programs are code-signed by "Open Source Developer Rophy Tsai" (Certum), with a timestamp. The prebuilt display driver keeps its own trust through Microsoft's catalog.
- Works with rustdesk-server 1.1.16-6, rustdesk-api 3.8.0 and Helm chart 0.13.0.

## 1.5.0-3

- With WebSocket on (always in our builds), clients no longer look up or contact public STUN servers at service or app start to find a public IPv6 address. IPv6 hole punching does not run over WebSocket, so nothing used that address.
- The DC variant's `custom.txt` locks LAN discovery off: the device no longer answers LAN discovery broadcasts. The client variant never answered them.
- `cRustDesk --password` applies the "Set Password" dialog's rule: at least 8 characters with a digit, an uppercase and a lowercase letter. A password that breaks it is refused with an error naming the rule, a non-zero exit code and no change. An empty value still removes the password.
- Each release carries an SBOM, `cRustDesk-<version>.cdx.json` (CycloneDX JSON): the locked Rust, Flutter, web-client and vcpkg dependencies of the release commit. It is listed in `SHA256SUMS`, has a build attestation, and is also in the installers image.
- Works with rustdesk-server 1.1.16-6, rustdesk-api 3.7.0 and Helm chart 0.12.0. The device build's LAN discovery lock takes effect only with the 1.5.0-3 installers.

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
