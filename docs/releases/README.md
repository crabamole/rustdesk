# Native client releases

One file per release: `<version>.md`, named after `version` in `Cargo.toml`. The release workflow
copies it, without its `#` title, into the GitHub Release `<version>` and fails when it is missing.
End it with the "Works with …" line (rustdesk-server, rustdesk-api, Helm chart).

The server, the api-server and the web client ship in the Helm chart; their notes are in the
chart's `releases/` folder (crabamole/rustdesk-charts).
