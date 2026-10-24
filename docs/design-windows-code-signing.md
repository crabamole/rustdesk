# Design: Windows Code Signing

**Status: implemented in windows-build.yml; first signed test run passed (2026-10-24).**

## Goal

Every Windows release file we build carries an Authenticode signature from our code-signing
certificate, with a timestamp. A person approves each release by entering a one-time code from
a phone; no stored secret can sign on its own.

Scope: the release run (`release.yml` on master after a version bump). A manual run of
`windows-build.yml` signs only with `sign: true` on a branch the `codesign` environments
allow (master). macOS signing does not change.

## Today

- `windows-build.yml` builds on a GitHub-hosted Windows runner and packages two variants
  (`dist/dc`, `dist/client`), then builds one MSI per variant.
- Signing steps exist but never ran: they expect a PFX file in a repository secret.
- The release notes say the MSIs are not signed. SmartScreen warns on first run.
- Of the 17 PE files in an MSI, only the virtual display driver (`usbmmidd_v2`, prebuilt) has a
  signature, and only a test signature. Windows trusts the driver through its catalog
  (`usbmmidd.cat`), which Microsoft signs.

## The certificate

- Certum Open Source Code Signing in the Cloud, RSA 4096, valid 2026-10-22 to 2027-10-22.
- Subject: `CN=Open Source Developer Rophy Tsai, O=Open Source Developer, L=Taipei, C=TW`.
  Windows shows the CN as the publisher.
- SHA-1 thumbprint `6C7C687E56E18B5FDB47EF52BCAEE74751CFBA79`. Signing selects the certificate by
  this thumbprint, never by `/a`.
- The private key stays in Certum's cloud HSM. Certum's SimplySign Desktop connects to it after a
  login with the account e-mail and a one-time code from the SimplySign mobile app. One login
  lasts about 2 hours.
- Timestamps come from `http://time.certum.pl` (RFC 3161), so signatures stay valid after the
  certificate expires.

## Design

### Signing machine

A Windows Server instance that only signs. It never builds and is meant to run only the signing
jobs.

- A local user without admin rights logs on automatically at boot. SimplySign Desktop and the
  GitHub Actions runner run in that user's desktop session, because SimplySign exposes the
  certificate only there.
- The runner is registered to this repository only, with the label `codesign`.
- The machine is stopped between releases. The release run starts it and stops it.
- No inbound network ports. An operator reaches it through the cloud provider's management
  channel.

### Human step: the unlock

The person who releases reads a code from the SimplySign mobile app and runs
`sign-unlock <code>` on their own machine. The command sends the code to the signing machine
through the cloud provider's management channel; a task in the signing user's session writes it
into the SimplySign Desktop login window and makes a test signature. When it works, the task
marks the session ready; `sign-files` waits for that mark. The certificate shows in the store also
before the login, so its presence is not a check.

- The code never passes through GitHub, so it is not in any public log.
- No TOTP seed is stored anywhere. Without a new code from the phone, the signing machine
  cannot sign.
- A code works once and expires within seconds.

### Release run

`release.yml` passes `sign: true` to `windows-build.yml` only for a push to master that
releases a new version. With `sign: false` the jobs below marked *sign only* are skipped and
the MSIs are built from unsigned files, as today. A manual dispatch can set `sign` too; the environments limit it to master.

| Job | Runs on | Does |
|---|---|---|
| `start-signer` (sign only) | GitHub-hosted | Waits for the release owner's approval (environment `codesign-approve`; GitHub e-mails the reviewer). Then starts the signing machine (cloud role limited to start and stop that one machine, no stored cloud key). |
| `build` | GitHub-hosted | Builds and packages both variants as today; uploads `dist/` unsigned. |
| `sign-files` (sign only) | `codesign` runner | Waits up to 60 minutes for the unlock. Signs every unsigned `.exe` and `.dll` in `dist/`; keeps files that are already signed. Verifies each. Uploads `dist/` signed. |
| `msi-signed` (sign only) | GitHub-hosted | Builds and checks the MSIs from the signed `dist/`. Without signing, `build` builds the MSIs. |
| `sign-msi` (sign only) | `codesign` runner | Signs and verifies both MSIs. |
| `stop-signer` (sign only, always runs) | GitHub-hosted | Stops the signing machine, which also ends the SimplySign session. |

The approval is the notification: the release owner gets GitHub's "review pending" e-mail,
approves, then runs `sign-unlock` once the machine is up. The signing jobs run in the GitHub
environment `codesign`, which only master may use and which needs no further approval. They do
not check out code: they work only on the downloaded artifacts with the `signtool` installed on
the machine.

Each signature: `signtool sign /sha1 <thumbprint> /fd sha256 /tr http://time.certum.pl /td sha256`,
then `signtool verify /pa`, and a check that the signer is our certificate.

The `publish` job attests the signed files, as it attests the unsigned ones today.

### Files we sign

All PE files in the MSIs that are not signed yet: `cRustDesk.exe`, `librustdesk.dll`,
`WindowInjection.dll`, `dylib_virtual_display.dll`, the Flutter plugin DLLs and
`flutter_windows.dll`, then the two MSIs. All of them come out of our build, except
`flutter_windows.dll`, which the build downloads from RustDesk's engine release. We sign it too,
because Windows application control policies need every loaded binary signed. Files that already
have a signature (the display driver) keep it; the verify step skips the driver.

### Fail cases

- No unlock within 60 minutes: `sign-files` fails, nothing is published, the machine stops.
- The SimplySign login fails (wrong or expired code): `sign-unlock` reports it; run it again with
  a new code while `sign-files` still waits.
- The machine does not start: `start-signer` fails and the signing jobs are skipped. If the
  machine starts but its runner does not come online, `sign-files` waits in the queue until GitHub
  cancels it (24 hours). The machine stops itself 3 hours after any boot, so a missed stop costs at
  most 3 hours.

## Not done

- No signing for pull-request runs, or for manual runs outside the branches the `codesign` environments allow.
- `flutter_windows.dll` still comes prebuilt from RustDesk's engine release (a mutable release asset, not pinned). Building the engine ourselves is future work.
- No portable single-file Windows build; it waits for this design.
- macOS signing and notarization are unchanged.

## Operations

The signing machine's setup (infrastructure code, unlock scripts, secrets and hardening) is
not kept in this repository.
