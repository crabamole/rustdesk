# crabamole/rustdesk

The client side of [crabamole](https://github.com/crabamole), which turns
[RustDesk](https://github.com/rustdesk/rustdesk) into a Guacamole-style remote desktop:
in the browser, behind your own single sign-on, through one HTTPS host.

This repo builds:

- **the web client**, which upstream removed from the open-source builds; and
- **cRustDesk**, native clients for Windows, macOS and Linux that sign in with your
  identity provider and reach the server over WebSocket on port 443, with no UDP and
  no public servers.

It is a fork of [rustdesk/rustdesk](https://github.com/rustdesk/rustdesk) and follows
upstream releases; the [release notes](docs/release-notes.md) name the upstream version
each release is built on.

> [!Caution]
> **Misuse disclaimer:** this project does not condone or support any unethical or
> illegal use of this software. Misuse, such as unauthorized access, control or invasion
> of privacy, is strictly against our guidelines. The authors are not responsible for
> any misuse of the application.

## The crabamole stack

| Repository | What it is |
|------------|------------|
| [rustdesk-charts](https://github.com/crabamole/rustdesk-charts) | **Start here.** Helm chart that deploys the server side. |
| **rustdesk** (this repo) | Web client and cRustDesk native clients. |
| [rustdesk-server](https://github.com/crabamole/rustdesk-server) | hbbs and hbbr with WebSocket registration and PostgreSQL. |
| [rustdesk-api](https://github.com/crabamole/rustdesk-api) | API server and web console: OIDC login, users, groups, address books. |
| [hbb_common](https://github.com/crabamole/hbb_common) | Library shared by the clients and the server (`libs/hbb_common`). |

## What it adds to RustDesk

- **Web client.** Connect to any device from a browser. It ships everything it loads,
  so it also runs on air-gapped networks.
- **Log in first.** Until the user signs in, a login button takes the place of the ID
  field; one click opens your identity provider.
- **One app, two variants.** Each platform gets one app, `cRustDesk`, in two variants
  that differ only in their signed `custom.txt`:
  - **DC**: installed on managed devices; it can be controlled, and data leaving the
    device is locked down (one-way clipboard, no file transfer).
  - **client**: installed on viewer machines; it connects out only and never registers
    as a device.
- **Locked to your server.** No public-server fallback, no auto-update, no WebRTC. Settings
  that would weaken the deployment are locked.
- **One RustDesk per machine.** The installers and the running service refuse to work
  next to stock RustDesk.

## Downloads

Each [release](https://github.com/crabamole/rustdesk/releases) has, for both variants:

| Platform | File |
|----------|------|
| Windows x64 | `.msi` |
| macOS (Apple Silicon) | signed and notarized `.app` in a `.zip` |
| Linux x86_64 (Ubuntu, X11) | `.deb` |

- Check a download against `SHA256SUMS`, or verify its build attestation:
  `gh attestation verify <file> --repo crabamole/rustdesk`
- The same files are published as an image, `ghcr.io/crabamole/rustdesk/installers:<version>`,
  for networks that pull only from a registry.
- The web client is the image `ghcr.io/crabamole/rustdesk/web-client`; the Helm chart
  deploys it.

The builds carry no server address. Give them yours as the
[deployment guide](docs/crustdesk-deployment.md) describes.

## Building

CI is the reference build; each workflow lists the exact toolchain and steps:

| Workflow | Builds |
|----------|--------|
| [`windows-build.yml`](.github/workflows/windows-build.yml) | Windows MSIs |
| [`macos-build.yml`](.github/workflows/macos-build.yml) | macOS app |
| [`linux-build.yml`](.github/workflows/linux-build.yml) | Linux `.deb` |
| [`web-docker.yml`](.github/workflows/web-docker.yml) | web-client image |
| [`release.yml`](.github/workflows/release.yml) | all of the above, then the GitHub release |

Native builds need `RUSTDESK_CUSTOM_CLIENT_PK`, the base64 Ed25519 public key that signs
`custom.txt`; a build never trusts upstream's key.

## Credits and license

Built on [RustDesk](https://github.com/rustdesk/rustdesk) by the RustDesk authors and
contributors. Like upstream, this fork is licensed under the
[AGPL-3.0](LICENCE).
