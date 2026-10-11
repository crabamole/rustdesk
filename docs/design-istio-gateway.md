# Design: Istio Gateway as the Server Ingress

**Status: design.**

## Goal

Clients reach hbbs, hbbr and the api-server through the cluster's Istio ingress gateway, not
through the web client's nginx. The web client's nginx only serves the web client's static files.

- One proxy hop less for every device connection and every relayed session.
- The web client no longer has to grow with the fleet, no longer holds sessions while it drains,
  and no longer restarts when `hbbr.replicas` changes.
- Clients see no change: same host, same paths (`/ws/id`, `/ws/relay/<n>`, `/api/`, `/ui`).

Istio is the only supported ingress. The chart drops its `ingress:` option and the nginx routing.
Other ingress controllers and Gateway API are out of scope.

## Today

```
client ─► (front proxies) ─► Istio gateway ─► web client nginx ─┬─► hbbs        /ws/id
                                                                ├─► hbbr-<n>    /ws/relay/<n>
                                                                ├─► api-server  /api/, /ui
                                                                └─► static files /
```

The web client's nginx (`webclient-configmap.yaml`) does more than serve files:

- Routes `/ws/id`, one `/ws/relay/<n>` location per hbbr pod, `/api/` and `/ui`.
- Resolves the client address (`realIp.trustedProxies`, `realIp.header`) and overwrites
  `X-Real-IP` and `X-Forwarded-For` with it toward hbbs, hbbr and the api-server.
- Drains like hbbr: a stopping pod keeps relaying its sessions for up to its grace period.
- Carries two connections per device and four per session, so its replicas,
  `nginx.workerConnections` and memory grow with the fleet.

hbbs, hbbr and the api-server take `X-Real-IP` first, then `X-Forwarded-For` walked from the right
past `TRUSTED_PROXIES`, and only from a peer in `TRUSTED_PROXIES`. The chart sets no
`TRUSTED_PROXIES`, and an empty list trusts every peer; that is safe only because nginx always
overwrites both headers and the NetworkPolicies let only the web client reach the servers.

## Design

```
client ─► (front proxies) ─► Istio gateway ─┬─► hbbs        /ws/id
                                            ├─► hbbr-<n>    /ws/relay/<n>
                                            ├─► api-server  /api/, /ui
                                            └─► web client  /   (static files)
```

### Routing

The chart renders one `VirtualService` (`networking.istio.io/v1beta1`) for `publicHost`, bound
to a Gateway the platform owns. The chart never creates the Gateway: the listener, TLS
certificate and gateway pods stay with whoever runs the mesh.

| Match | Destination |
|---|---|
| prefix `/ws/id` | `<fullname>-hbbs:21118` |
| exact `/ws/relay/<n>`, for each `n < hbbr.replicas` | `<fullname>-hbbr-<n>:21119` (per-pod Service) |
| prefix `/api/`, prefix `/ui` | `<fullname>-apiserver:21114` |
| prefix `/` | `<fullname>-webclient:80` |

- No route sets a timeout. Istio leaves route timeouts and the stream idle timeout off by
  default (checked on Istio 1.16.7), so open WebSockets are never cut by the gateway.
- Every route removes a client-supplied `X-Real-IP` (`headers.request.remove`), so nothing
  downstream can mistake it for a resolved address.
- `RELAY_URLS` and `RELAY_CHECKS` are unchanged: hbbs still hands out
  `wss://<publicHost>/ws/relay/<n>`, which now reaches hbbr pod `n` straight from the gateway.
- Changing `hbbr.replicas` changes only the VirtualService and hbbs's `RELAY_URLS`.

New values:

| Value | Meaning |
|---|---|
| `istio.gateway` | required; the Gateway to bind to, `<namespace>/<name>` |
| `istio.gatewayPods.namespace` | namespace of the gateway pods (default `istio-system`) |
| `istio.gatewayPods.labels` | their pod labels (default `istio: ingressgateway`) |
| `trustedProxies` | required; CIDRs of the gateway pods and of every proxy in front of the gateway |

Removed values: `ingress`, `realIp`, `webclient.nginx`.

### Client addresses

hbbs, hbbr and the api-server resolve the client address from `X-Forwarded-For` only:

1. If the TCP peer is not in `TRUSTED_PROXIES`, the peer is the client.
2. Otherwise walk `X-Forwarded-For` from the right, skipping addresses in `TRUSTED_PROXIES`; the
   first other address is the client.
3. The walk stops at an entry that is not an address; if every address walked is trusted, the
   leftmost of them is the client. With no header, the peer is the client.

`X-Real-IP` is no longer read. The gateway's Envoy appends the address it received the connection
from to `X-Forwarded-For`, so with the gateway pods in `TRUSTED_PROXIES` the client is the last
address Envoy added, or, behind a load balancer or CDN that also appends, the first address left
of the trusted ones.

The chart passes `trustedProxies` to all three servers as `TRUSTED_PROXIES` and refuses to
install without it. The servers keep refusing to start on an invalid entry; an empty list no
longer means "trust every peer" but "trust no peer", so a server without the setting records
the gateway's address rather than a forged one.

### Network policies

| Component | Accepts |
|---|---|
| hbbs `ws` | gateway pods |
| hbbs `internal` | hbbs pods |
| hbbr `ws` | gateway pods |
| hbbr `health` | hbbs pods |
| api-server | gateway pods, hbbs |
| web client | gateway pods |
| Postgres | hbbs, api-server |

Gateway pods are selected by `istio.gatewayPods` (namespace and labels).

### Web client

The web client's Deployment keeps only the image's own static-file nginx config. It loses the
preStop connection hold, the 1800 s grace period, the restart on `hbbr.replicas` changes and the
`workerConnections` sizing; a stopping pod needs only the default grace period.

### Draining and sizing

hbbs and hbbr drain as before; the gateway's Envoy is the proxy in front of them. The gateway
carries one connection per device and two per session (one per side); sizing it is the platform's
job, and the README states those numbers. The gateway's own restarts drop every connection through
the stopping gateway pod after its drain (Istio default 5 s); devices reconnect as they do after
an hbbs pod stops.

### Service mesh

hbbs, hbbr, the api-server, the web client and Postgres run without sidecars
(`sidecar.istio.io/inject: "false"`, set by the chart). The gateway sends plain traffic to them:
Istio's automatic mTLS picks plaintext for destinations without a sidecar. A `DestinationRule`
forcing `ISTIO_MUTUAL` for these hosts would break this; the README says so.

## Tests

- Helm unit tests: the VirtualService (per-pod relay routes, header removal, no timeouts,
  required `istio.gateway`), `TRUSTED_PROXIES` on all three servers, the NetworkPolicies, the
  slimmed web client, and that `ingress`/`realIp` no longer render anything.
- rustdesk-server and rustdesk-api: address resolution from `X-Forwarded-For` past trusted hops,
  `X-Real-IP` ignored even from a trusted peer, an empty `TRUSTED_PROXIES` trusting no peer.
- e2e on the test cluster (Istio 1.16.7):
  - The chart's VirtualService replaces the hand-written one.
  - `client-ip` spec: the address recorded for a client behind the gateway, and forged
    `X-Real-IP` / `X-Forwarded-For` values ignored.
  - HA probers connect through the in-cluster gateway Service instead of the web client Service
    and send their synthetic address in `X-Forwarded-For`.
  - The web client rolling-restart scenario checks only that the static files stay served.
  - Full `npm test`, the HA suite (including the 5000-device scale run) and the native-client
    matrix.

## Upgrading

No backward compatibility (see UPGRADING.md):

- Istio is required. Set `istio.gateway`, `istio.gatewayPods` and `trustedProxies`; remove any
  hand-written route that sends everything to the web client.
- `ingress`, `realIp` and `webclient.nginx` are gone.
- rustdesk-server and rustdesk-api must be upgraded with the chart: older servers prefer
  `X-Real-IP`, which the gateway no longer guarantees.
- Clients need no change.
