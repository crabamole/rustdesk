# RustDesk Web Client

OSS-compatible web client for [RustDesk](https://rustdesk.com) remote desktop, built from the official Flutter web source with patches for hbbs/hbbr (non-Pro) servers.

## Quick Start

Behind a reverse proxy with path-based routing (recommended):

```bash
docker run -d -p 8080:80 \
  -e RUSTDESK_KEY=your-public-key \
  ghcr.io/crabamole/rustdesk/web-client
```

The web client defaults to the same-origin WebSocket path `/ws/id`, with `ws://` or `wss://` selected automatically based on the page protocol. No host configuration needed. For relayed sessions it dials the relay URL hbbs hands out (hbbs `RELAY_URLS`, e.g. `wss://rustdesk.example.com/ws/relay/0`); it has no relay setting of its own.

For split-domain deployments (hbbs on a different host):

```bash
# Plain WebSocket (development)
docker run -d -p 8080:80 \
  -e RUSTDESK_HOST=ws://hbbs.example.com:21118 \
  -e RUSTDESK_KEY=your-public-key \
  ghcr.io/crabamole/rustdesk/web-client

# Secure WebSocket via TLS-terminating proxy
docker run -d -p 8080:80 \
  -e RUSTDESK_HOST=wss://rustdesk.example.com/ws/id \
  -e RUSTDESK_KEY=your-public-key \
  ghcr.io/crabamole/rustdesk/web-client
```

Then open http://localhost:8080 in a browser.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RUSTDESK_KEY` | **Yes** | | Server public key |
| `RUSTDESK_HOST` | No | `/ws/id` | Rendezvous server (hbbs). Path (e.g. `/ws/id`) or full URI (e.g. `ws://host:21118`) |
| `RUSTDESK_API` | No | the page origin | API server base URL (login, address book, audit), e.g. `https://api.example.com` |

When `RUSTDESK_HOST` is a path (starts with `/`), the WebSocket scheme is derived from the page: `wss://` on HTTPS, `ws://` on HTTP. Full URIs are used as-is.

## config.json

At start, the image writes the variables above to `/config.json` next to `index.html`. The web
client reads it once when the page loads. To serve the static files without this image, write the
file yourself:

```json
{
  "host": "/ws/id",
  "key": "your-public-key",
  "api": "https://api.example.com"
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `host` | `/ws/id` | As `RUSTDESK_HOST` |
| `key` | empty | As `RUSTDESK_KEY`. It must be the public key of hbbs: hbbs refuses a wrong key ("Key mismatch"), and the web client checks the device's signed key with it |
| `api` | the page origin | As `RUSTDESK_API` |

A missing or unreadable file gives the defaults. An empty field also keeps its default. The page
must be reloaded to read a changed file.

## Reverse Proxy Setup

```
                       +--> /            web client (static files, config.json)
browser --> proxy -----+--> /ws/id       hbbs   (rendezvous, WebSocket)
          (TLS, 443)   +--> /ws/relay/n  hbbr n (relay, WebSocket)
                       +--> /api/, /ui   API server (login, address book, audit)
```

The proxy must route WebSocket connections to hbbs, and each relay URL hbbs hands out to its hbbr:

| Path | Backend | Protocol |
|------|---------|----------|
| `/ws/id` | hbbs:21118 | WebSocket |
| `/ws/relay/<n>` | hbbr pod `<n>`:21119 | WebSocket |
| `/api/`, `/ui` | api-server:21114 | HTTP |
| `/` | web-client:80 | HTTP |

The [Helm chart](https://github.com/crabamole/rustdesk-charts) renders this as an Istio
VirtualService bound to your Gateway. Example for one hbbr pod:

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: rustdesk
spec:
  gateways: [istio-ingress/public]
  hosts: [rustdesk.example.com]
  http:
    - match: [{ uri: { prefix: /ws/id } }]
      route: [{ destination: { host: hbbs, port: { number: 21118 } } }]
    - match: [{ uri: { exact: /ws/relay/0 } }]
      route: [{ destination: { host: hbbr-0, port: { number: 21119 } } }]
    - match: [{ uri: { prefix: /api/ } }, { uri: { prefix: /ui } }]
      route: [{ destination: { host: api-server, port: { number: 21114 } } }]
    - match: [{ uri: { prefix: / } }]
      route: [{ destination: { host: web-client, port: { number: 80 } } }]
```

Istio sets no route timeout, so open WebSockets stay up.

## Source

Built from [crabamole/rustdesk](https://github.com/crabamole/rustdesk) using [`docker/web-client/Dockerfile`](https://github.com/crabamole/rustdesk/blob/master/docker/web-client/Dockerfile).
