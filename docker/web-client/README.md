# RustDesk Web Client

OSS-compatible web client for [RustDesk](https://rustdesk.com) remote desktop, built from the official Flutter web source with patches for hbbs/hbbr (non-Pro) servers.

## Quick Start

Behind a reverse proxy with path-based routing (recommended):

```bash
docker run -d -p 8080:80 \
  -e RUSTDESK_KEY=your-public-key \
  ghcr.io/crabamole/rustdesk/web-client
```

The web client defaults to same-origin WebSocket paths `/ws/id` and `/ws/relay`, with `ws://` or `wss://` selected automatically based on the page protocol. No host configuration needed.

For split-domain deployments (hbbs/hbbr on a different host):

```bash
# Plain WebSocket (development)
docker run -d -p 8080:80 \
  -e RUSTDESK_HOST=ws://hbbs.example.com:21118 \
  -e RUSTDESK_RELAY=ws://hbbr.example.com:21119 \
  -e RUSTDESK_KEY=your-public-key \
  ghcr.io/crabamole/rustdesk/web-client

# Secure WebSocket via TLS-terminating proxy
docker run -d -p 8080:80 \
  -e RUSTDESK_HOST=wss://rustdesk.example.com/ws/id \
  -e RUSTDESK_RELAY=wss://rustdesk.example.com/ws/relay \
  -e RUSTDESK_KEY=your-public-key \
  ghcr.io/crabamole/rustdesk/web-client
```

Then open http://localhost:8080 in a browser.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RUSTDESK_KEY` | **Yes** | | Server public key |
| `RUSTDESK_HOST` | No | `/ws/id` | Rendezvous server (hbbs). Path (e.g. `/ws/id`) or full URI (e.g. `ws://host:21118`) |
| `RUSTDESK_RELAY` | No | `/ws/relay` | Relay server (hbbr). Path (e.g. `/ws/relay`) or full URI (e.g. `ws://host:21119`) |

When `RUSTDESK_HOST` or `RUSTDESK_RELAY` is a path (starts with `/`), the WebSocket scheme is derived from the page: `wss://` on HTTPS, `ws://` on HTTP. Full URIs are used as-is.

## Reverse Proxy Setup

The proxy must route WebSocket connections to hbbs/hbbr:

| Path | Backend | Protocol |
|------|---------|----------|
| `/ws/id` | hbbs:21118 | WebSocket |
| `/ws/relay` | hbbr:21119 | WebSocket |
| `/` | web-client:80 | HTTP |

The proxy should terminate TLS and support WebSocket upgrade. Example with nginx:

```nginx
location /ws/id {
    proxy_pass http://hbbs:21118;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
}

location /ws/relay {
    proxy_pass http://hbbr:21119;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
}
```

## Source

Built from [rophy/rustdesk](https://github.com/rophy/rustdesk) using [`docker/web-client/Dockerfile`](https://github.com/rophy/rustdesk/blob/master/docker/web-client/Dockerfile).
