# Design: Multiple Replicas, High Availability and Disaster Recovery

**Status: design.**

## Goal

hbbs, hbbr and the api-server each run as several pods, for availability and for capacity:

- Losing a pod or draining a node does not take remote access down. Devices on a lost pod are
  reachable again within about 30 s; new sessions keep working throughout.
- Adding pods adds capacity: devices spread over hbbs pods, relayed traffic over hbbr pods.
- Rolling updates do not cut running sessions.
- A second site can take over from a Postgres replica (documented runbook, not automated).

Postgres stays the only shared component; no Redis or message bus is added. Clients need no
changes to their protocol; our clients drop their relay-server setting (see Clients).

## Today

All three servers keep live state in process memory, so each runs one pod.

| Server | In memory | With two pods |
|---|---|---|
| hbbs | Each registered device's open connection (`ws_peers`), the viewer waiting for a reply (`tcp_punch`), device liveness and a never-refreshed cache of device keys (`PeerMap`) | A viewer's request reaches a pod that does not hold the device and is answered OFFLINE; the device's reply reaches a pod that does not hold the waiting viewer and is dropped; a key changed through one pod stays stale on the other |
| hbbr | The first half of each session waiting for its pair (`PEERS`, keyed by session UUID) | The two halves meet only when both land on the same pod |
| api-server | OIDC logins in progress; a write-back cache for the legacy `/api/ab` | A login started on one pod fails at the callback on another; address book writes are invisible to other pods for up to a minute and lost on shutdown |

How a session is set up (all clients use WebSocket through the one public origin):

1. The device keeps one connection to hbbs open (`/ws/id`). This is upstream's client design;
   upstream's open-source hbbs does not accept it (devices register over UDP there), our hbbs does.
2. The viewer opens a connection to hbbs and asks for device X.
3. hbbs checks the viewer's login, mints the audit reference and pushes the request down X's open
   connection, with the relay address and the viewer's address.
4. The device answers on a **new** connection to hbbs, echoing the viewer's address; hbbs passes
   the answer to the waiting viewer.
5. Both sides dial hbbr with the session UUID; hbbr pairs them and copies bytes.

Measured on a test deployment with four real devices:

| Event | Devices reachable again after |
|---|---|
| hbbs pod deleted (SIGTERM) | 6.5 s, all four |
| hbbs pod frozen (stands in for a hung process or a network partition), a second pod available | 31, 77, 93 and 145 s; Kubernetes kept the frozen pod Ready because its probes are TCP connects, which still succeed |

## Design

### Across pods, a session looks like this

```
viewer ──① request for X──► hbbs-1
                             │ looks up X in presence: hbbs-0
                             └──② forward over the internal port──► hbbs-0
                                                                      │
device X ◄══════════ ③ push on X's open connection ═══════════════════┘
   │                  (viewer address = viewer IP : routing token for hbbs-1)
   └──④ answer, echoing the viewer address──► any pod, e.g. hbbs-2
                                               │ token says hbbs-1
viewer ◄──⑤ answer──── hbbs-1 ◄──forward───────┘
   └──⑥ dial wss://<host>/ws/relay/2 ──► hbbr-2 ◄── device dials the same URL
```

### hbbs

**StatefulSet.** Pods have stable names (`hbbs-0`, `hbbs-1`, …) and stable DNS names through a
headless Service, used for presence and for forwarding. Clients still reach any pod through the
normal Service and `/ws/id`.

**Presence in Postgres.** Two `UNLOGGED` tables:

```
hbbs_pod      (pod, addr, epoch, alive_at)        one row per pod, refreshed every 10 s
peer_presence (id, pod, epoch, gen, since)        one row per connected device
```

- A pod starts with a new `epoch` and replaces its own rows. On registration it upserts the
  device's row: the latest registration wins, since it is the device's newest connection. On
  disconnect a pod deletes the row only if it still names this pod, epoch and generation, so a
  late delete from the old pod cannot undo a reconnect elsewhere. On shutdown a pod deletes all
  its rows.
- A lookup ignores rows whose pod has not refreshed `alive_at` within 30 s, or whose epoch is not
  the pod's current one. No per-device leases.
- Writes happen on connect and disconnect only: about 2/s on average for 5000 devices, a burst of
  a few thousand when a pod restarts. Device heartbeats to the api-server already write about
  330/s for the same fleet.
- `UNLOGGED`: no write-ahead log, not replicated, emptied by a database crash or failover. When a
  pod's refresh finds its own `hbbs_pod` row missing, it writes all its devices again.
- The api-server can read presence: the console shows which devices are online, and online status
  no longer depends on heartbeats.

**Forwarding between pods.** A new internal port (cluster-only) carries the existing protobuf
`RendezvousMessage` over the existing framed stream, so no new dependency. Two calls:

- *Deliver to device X*: the holding pod pushes the request (punch hole or relay request) to X and
  answers delivered or not here. hbbs-1 calls it where it answers OFFLINE today.
- *Deliver to waiting viewer*: the pod that receives the device's answer passes it to the pod named
  in the routing token.

Only session setup is forwarded: one request and one answer of a few hundred bytes each. Session
data flows between the clients and hbbr and never passes through hbbs.

Calls carry a token derived from the server keypair all pods already share; a NetworkPolicy lets
only hbbs pods reach the port.

**Routing token in the viewer's port.** hbbs sends the device the viewer's address and the device
echoes it back in its answer. Behind the proxy the port is always 0 today. hbbs keeps the real IP
and sets the port to a token: the pod ordinal (5 bits, up to 32 pods) and a per-pod counter
(11 bits). The pod that receives the answer reads the ordinal and forwards. The device uses only the
IP (IP whitelist, audit and alarm records, 2FA message, login-failure limits), so those keep
working. This also fixes a bug that exists with one pod: waiting viewers are filed by address, so
two viewers behind one NAT overwrite each other.

**Detecting dead pods.**

- hbbs tells devices a shorter keep-alive in its registration reply (`RegisterPkResponse.keep_alive`,
  20 s): a device notices a silent pod in about 30 s instead of 90 s. Upstream clients honour it.
- A small HTTP port with two checks. `/livez` is answered through the main event loop; liveness
  uses it to restart a hung pod. `/readyz` also checks the database; while the database is down the
  pod leaves the Service but is not restarted, and its open device connections stay.
- On SIGTERM, hbbs fails readiness first, then closes device connections so they move at once.

**Other changes.**

- Device keys and UUIDs are read from Postgres when needed, not cached forever.
- First registration of a new device is an upsert, so two pods racing do not fail.
- Registration answers SERVER_ERROR when its database write failed (today it answers OK).
- Online status over WebSocket is answered (missing today; clients ask on `/ws/id`), from presence.
- Per-IP registration limits stay per pod, so the effective limit is N times the setting. Documented.

### hbbr

**StatefulSet, one URL per pod.** hbbs hands out `wss://<host>/ws/relay/<n>`; nginx routes each path
to one pod through a per-pod Service (selector `statefulset.kubernetes.io/pod-name`). Both halves of
a session dial the same URL, so they meet on the same pod, with no extra hop. A plain `/ws/relay`
stays routed to the hbbr Service for clients that dial it.

- hbbs keeps two lists: the public URLs it hands out and the per-pod Service addresses it
  health-checks. It picks a healthy pod at random.
- Native clients (ours and stock) dial a full `ws(s)://` relay address unchanged.
- hbbs health-checks each pod's `/readyz` instead of a TCP connect. The per-pod Services publish
  pods that are not ready (`publishNotReadyAddresses`), so a URL handed out just before a pod
  started draining still reaches it.
- On SIGTERM, hbbr fails `/readyz` (hbbs stops handing out its URL within 3 s) and keeps relaying
  until its sessions end or the grace period runs out, so rolling updates no longer cut sessions. A lost pod cuts its sessions;
  viewers reconnect on their own (after 1 s, doubling) through hbbs and get a healthy pod.
- Bandwidth limits stay per pod and are documented as such.

### Clients

The relay address is always chosen by hbbs:

- **Native (cRustDesk):** remove the relay-server setting (`relay-server` option, the `relay` key of
  `--config`, the settings field). A device would otherwise dial its own relay address instead of
  the pod hbbs chose, and the two halves would meet on the same pod only one time in N.
- **Web client:** dial the relay address hbbs returns, not the fixed `/ws/relay`.

### api-server

- OIDC logins in progress move to Postgres; the provider is rebuilt from its type. The callback's
  single use and the redeem become conditional updates.
- The legacy `/api/ab` cache becomes write-through (also fixes a write that was never saved).
- Unique index on the audit nonce; the fallback insert of a connection row becomes an upsert.
- `/livez` (process) and `/readyz` (database), as for hbbs.

### Chart

- `replicas` for hbbs, hbbr and the api-server; hbbs and hbbr as StatefulSets with headless
  Services, hbbr with per-pod Services; `hbbs.relayAddress` replaced by URLs generated from the
  public host and `hbbr.replicas`.
- nginx: one `/ws/relay/<n>` location per hbbr pod, rendered from `hbbr.replicas`.
- `/livez` and `/readyz` probes; PodDisruptionBudgets (max one unavailable) when replicas > 1; pods spread
  across nodes; `terminationGracePeriodSeconds` for hbbr and the web client long enough to drain
  (default 30 min).
- NetworkPolicy: hbbs pods reach each other's internal port.

### Rolling updates

StatefulSets replace one pod at a time, highest ordinal first, and wait for the new pod to be
ready before the next.

| Component | During its update |
|---|---|
| hbbs | The pod leaves the Service, deletes its presence rows and closes its device connections. Devices reconnect at once through the Service to the other pods; requests for them answer OFFLINE for those few seconds. A viewer whose session setup was in flight on that pod sees an error and retries. Running sessions are not affected. |
| hbbr | The pod stops getting new sessions and drains: running sessions continue until they end or the grace period expires, then viewers reconnect (after 1 s) to another pod. The replacement starts only after the old pod has exited, so updating every pod takes up to replicas × the grace period, with one pod less capacity meanwhile. Default grace: 30 min, configurable. |
| api-server | No state of its own. A preStop pause lets the Service drop the pod before it stops; a login in progress finishes on another pod. |
| Web client (nginx) | It proxies every WebSocket, including relayed sessions, so it drains like hbbr: nginx stops gracefully (`SIGQUIT`, the image's stop signal) and keeps upgraded connections until they close or the grace period expires. Same 30 min default. Its pods also restart when `hbbr.replicas` changes, because the nginx config lists one location per hbbr pod. |

After a rolling update of hbbs the last pod replaced holds few devices, since devices stay where
they reconnected. Rebalancing is future work (see Future Work).

## Disaster recovery

Durable state is Postgres, the keypair Secret and the OIDC provider file. Presence is rebuilt by
reconnecting devices.

A standby site needs:

- a Postgres replica (managed replication), the same keypair Secret and OIDC provider file;
- the same public hostname, with the IdP redirect URI on it;
- the chart installed with the replica's URL, scaled to zero or running against a read-only
  database until failover.

Failover: promote the replica, scale the standby up, point DNS at it. Devices reconnect when their
connections drop and register with the new site; viewers log in again only if their sessions were
not yet replicated. The runbook lives in the chart README and is not verified yet.

## Compatibility

No protocol change. Stock clients are already unsupported (they lack our OIDC login flow); one
with a relay-server set would pair only one time in N. Our clients
lose the relay-server setting; the web client dials the address hbbs returns. hbbs, hbbr, the
api-server, the web client and the chart are upgraded together; release notes and `UPGRADING.md`
state the pairing.

## Tests

- hbbs unit and integration: presence upsert and generation rules, stale-pod filtering, re-assert
  after an emptied table, routing-token encoding, forwarding both ways, OFFLINE only when no live
  pod holds the device.
- api-server: OIDC login across two state instances on one database; nonce uniqueness.
- e2e with two pods each: sessions from every client type to devices on either hbbs pod, a pod
  deleted and a pod frozen mid-test (devices reachable again within 30 s), an hbbr rolling update
  during a session (session survives), a web client rolling update during a session (survives),
  login across api-server pods. e2e helpers that pick the
  first pod (logs, coverage, port-forward) handle several.

## Future Work

- Rebalance devices across hbbs pods after a rolling update: a pod well above the average device
  count (from presence) closes a few connections a minute; or a maximum connection age.
