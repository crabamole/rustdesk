# Design: Login Audit

**Status: proposed (roadmap Phase 2, Audit Logging).**

## Goal

Admins see every OIDC sign-in, successful or not: who, from which client and machine, from
which address, and how it ended. Today a login leaves only a server log line and, for native
clients, the latest login per machine in `viewer_device`.

## Today

All three clients use one flow ([design-oidc-login.md](design-oidc-login.md)):

1. `POST /api/oidc/auth` starts a login with `returnTo`, a PKCE challenge and self-reported
   device info (`id`, `uuid`, `deviceInfo.name/os/type`). The server keeps it in memory
   (`OidcState`) with the starter's address.
2. The IdP redirects to `GET /api/oidc/callback?code&state`; the server exchanges the code
   and hands a one-time result to `returnTo`.
3. `POST /api/oidc/token` redeems the result with the PKCE verifier and issues the session.

## Design

### What is recorded

One row per login that reaches the callback, written when its outcome is known:

| Outcome | When |
|---|---|
| `ok` | Session issued at `POST /api/oidc/token` |
| `idp_denied` | The IdP sent the user back with `error` (e.g. cancelled, no consent) |
| `idp_error` | Code exchange or ID token check failed (`iss`, `aud`, `exp`, transport) |
| `inactive` | The account exists but is not activated (`OAUTH2_CREATE_USER=0`) |
| `refused` | The result was redeemed late, with a wrong verifier, or by another client |

Not recorded: logins abandoned before the callback, and callbacks or redeems that name no
known login (nothing to attribute them to; they stay as log lines).

### Fields

| Field | Source |
|---|---|
| `created_at` | Outcome time |
| `outcome` | Table above |
| `detail` | Short reason for failures (e.g. the IdP's `error` code), bounded |
| `client` | `native`, `web` or `console`, from the server-checked `returnTo` (loopback, `/oidc-callback.html`, `/ui/login`), not from `deviceInfo.type` |
| `user` | The account, when the IdP identified one; cleared if the user is deleted |
| `user_name` | Name at login time, kept after the user is deleted |
| `rustdesk_id`, `hostname`, `os` | Self-reported at `POST /api/oidc/auth` (bounded like `viewer_device`) |
| `ip` | The starter's address, resolved through trusted proxies |

Self-reported fields are labelled as such in the console.

### Storage

Migration `0009`: table `audit_login` with the fields above, indexed on `created_at`.
Retention follows the other audit tables once log retention exists.

### Callback change

`GET /api/oidc/callback?error&state` (no `code`) records `idp_denied` and sends the browser
back to `returnTo` with `error=login_failed`, as a failed exchange does today. Without it the
IdP's error redirect matches no route.

### Read API and console

- `GET /api/audits/login?current&pageSize&created_at&user&outcome`: admin only, newest
  first, same paging and `created_at` rules as `/api/audits/{conn,file,alarm}`; `user` is an
  SQL LIKE pattern on `user_name`.
- Console audit page gains a **Logins** tab: time, user, outcome, client, ID, hostname,
  OS, address; filters for user and outcome.

## Tests

- Integration (rustdesk-api): one test per outcome, the `client` mapping, the read API's
  filters and admin check, deleted user keeps `user_name`.
- e2e (rustdesk-e2e): a mock-OIDC login from the web client and the console each add an
  `ok` row; a wrong verifier adds `refused`; the Logins tab shows them.

## Open Questions

- Record logouts and session expiry too, as a session timeline per user?
- Raise an alarm on repeated failures for one user or address?
