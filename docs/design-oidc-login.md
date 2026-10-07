# Design: OIDC Login Bound to Its Starter

**Status: design.** Covers our native builds, the web client and the admin console.
Replaces the "public client with PKCE" plan for native logins.

## Goal

Every OIDC sign-in hands its token only to the app or page that started it. No client
polls: `GET /api/oidc/auth-query` is removed. The api-server stays the one OIDC client of
the deployment (confidential, with its client secret), so the identity provider needs no
new registration.

## Today

| Client | Start | Token |
|---|---|---|
| Native (upstream `src/hbbs_http/account.rs`) | `POST /api/oidc/auth`, opens the provider URL in the browser | polls `GET /api/oidc/auth-query` every second, up to 3 minutes |
| Web client (`flutter/web/js/src/globals.js`) | same, provider login in a popup | polls `auth-query` |
| Admin console (`webconsole/src/views/LoginPage.vue`) | same with `redirectUri` `/ui/login`, whole page goes to the provider | one `auth-query` after the redirect back |

The api-server's callback exchanges the provider code with its client secret and checks the
ID token (`iss`, `aud`, `exp`). Browser logins are bound by a cookie set at
`/api/oidc/auth`; a sign-in finished in another browser shows a confirmation page (device,
OS, address; Approve / Deny).

## Design

One flow for every client. The api-server keeps the provider leg; the starter receives a
one-time `result` on a redirect it controls and proves with a PKCE verifier (RFC 7636) that
it started the login.

| Client | Redirect target (`returnTo`) | Verifier kept in |
|---|---|---|
| Native | its loopback `http://127.0.0.1:<port>/` (RFC 8252 §7.3) | app memory |
| Web client | a callback page of the web client, same origin | the starting tab's memory |
| Admin console | `/ui/login`, same origin | `sessionStorage` |

```
Starter                     Browser                  api-server                 IdP
 │ POST /api/oidc/auth {op, id, uuid, deviceInfo, returnTo, codeChallenge} ─▶│
 │◀──────────────────────────────── {code, url} ──────────│                        │
 │ open url ─────────────────▶│ login ────────────────────┼───────────────────────▶│
 │                            │◀──── redirect /callback ──┼────────────────────────│
 │                            │ GET /callback ───────────▶│ code→tokens (secret,   │
 │                            │                           │ PKCE, state, nonce) ──▶│
 │                            │◀──── 302 <returnTo>?result=<one-time> ────────────│
 │◀── result (loopback request, or callback page → starting page) ─│              │
 │ POST /api/oidc/token {result, codeVerifier, id, uuid} ▶│ check, issue token     │
 │◀──────────────────────────────── {access_token, user} ─│                        │
```

### api-server

- `POST /api/oidc/auth` requires `returnTo` and `codeChallenge` (method `S256`).
  `returnTo` is either `http://127.0.0.1:<port>/` or `http://[::1]:<port>/` (native), or a
  URL on the server's own origin (web client, console; today's `redirectUri` rule).
  Anything else is refused.
- Toward the provider, every login sends a random `nonce` and a PKCE challenge of its own;
  the callback requires the matching `state`, sends the verifier with the code, and checks
  the ID token's `nonce` besides `iss`, `aud` and `exp`. The ID token comes straight from the
  token endpoint over TLS, which OIDC Core §3.1.3.7 accepts in place of a signature check.
- The callback redirects to `returnTo` with a one-time `result` (random, valid 60 seconds, single use) and the login `code`, so a starter with several logins can match it; on failure it redirects with `error=login_failed` and the login `code`.
- `POST /api/oidc/token` issues the bearer token when `result` is known and unused,
  `BASE64URL(SHA256(codeVerifier))` matches the stored challenge, and `id` and `uuid` match
  the ones given at `/api/oidc/auth`. Any mismatch burns the result. The response has the
  body of today's successful `auth-query`.
- Removed: `GET /api/oidc/auth-query`, the confirmation page (`/api/oidc/confirm`) and the
  login cookie; the verifier binds the login to its starter instead.

### Native (our builds, `src/hbbs_http/account.rs`)

- Before calling `/api/oidc/auth`, open a listener on `127.0.0.1` with a port chosen by the
  OS and create a random `codeVerifier` (43–128 characters).
- Wait up to 3 minutes for one request carrying `result`; answer it with a short page
  ("Signed in, you can close this window") and close the listener.
- Redeem `result` at `POST /api/oidc/token`; the rest of the login code stays.
- The polling code is removed.

### Web client (`flutter/web/js/src/globals.js`)

- Keep the verifier in the starting tab's memory, start the login with `returnTo` set to a small
  callback page served by the web client, and open the provider URL in a popup as today.
- The callback page passes `result` and `code` to the starting tab over a `BroadcastChannel` (same origin only; identity providers may cut `window.opener`) and closes; the starting page redeems it.
- The polling code is removed.

### Admin console (`webconsole/src/views/LoginPage.vue`)

- Keep the verifier in `sessionStorage`; `returnTo` is `/ui/login`.
- On return, `/ui/login?result=…` redeems `result` with the verifier and removes it from
  the address bar.

## Version compatibility

No backward compatibility (not yet officially released): the api-server, our native
builds, the web client and the console change together.

| Client | api-server with this flow |
|---|---|
| Our native builds with this flow, the web client and console shipped with it | log in |
| Our native builds before it, stock RustDesk | login refused (they only poll) |
| An older web client image | login refused |

The release that ships it states the pairing: the client GitHub Release notes and the
chart's `UPGRADING.md` name the minimum client and web-client version for the api-server
version (and the reverse), and that older native builds and stock clients can no longer
log in. The chart bumps all images together.

## Alternatives

- **Public client in the app** (authorization code + PKCE at the provider, the app sends the
  ID token to the api-server): needs a public client registered at each customer's
  identity provider, and the api-server would have to verify tokens handed in by apps
  (JWKS signature, `nonce`). This design keeps one confidential client and the token
  exchange on the server.
- **Device authorization grant**: not bound to the starter either; no gain over polling.
- **Keep polling for browsers, bound by the cookie**: works, but keeps two flows and the
  polling endpoint.

## Testing

- api-server unit and integration tests: `returnTo` validation (loopback, own origin, others
  refused), one-time `result`, verifier and `id`/`uuid` checks, expiry, `nonce`/PKCE/`state`
  on the provider leg (stub provider); `auth-query` and `/api/oidc/confirm` are gone.
- Web client and console unit tests: verifier storage, the callback page's origin check,
  redeeming the result.
- e2e: native, web client and console logins through the mock provider; a result redeemed
  without the verifier, with another verifier, or twice, is refused; a polling client is
  refused.

## Related

- [native-client-roadmap.md](native-client-roadmap.md), [api-server-roadmap.md](api-server-roadmap.md), [WEB_CLIENT_ROADMAP.md](WEB_CLIENT_ROADMAP.md)
- RFC 8252 (OAuth 2.0 for Native Apps), RFC 7636 (PKCE), OpenID Connect Core 1.0 §3.1.3.7
