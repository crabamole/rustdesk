# Design: Native Client Login Bound to the App

**Status: design.** Replaces the "public client with PKCE" plan for native logins.

## Goal

A native client's OIDC sign-in hands its token only to the app that started it, without
polling. The api-server stays the one OIDC client of the deployment (confidential, with its
client secret), so the identity provider needs no new registration.

## Today

All clients log in by polling (upstream `src/hbbs_http/account.rs`):

1. The app calls `POST /api/oidc/auth` with `{op, id, uuid, deviceInfo}` and gets
   `{code, url}`; it opens `url` (the identity provider's login page) in the browser.
2. The provider redirects to `/api/oidc/callback`; the api-server exchanges the code at the
   provider's token endpoint with its client secret and checks the ID token (`iss`, `aud`,
   `exp`).
3. The app polls `GET /api/oidc/auth-query?code=…` every second, for up to 3 minutes, and
   receives the bearer token.

Nothing ties the browser sign-in to the app that polls. A sign-in finished in a browser
other than the starting one shows a confirmation page (device, OS, address; Approve / Deny).
The web client and the console are already bound to their browser by a cookie.

## Design

The api-server keeps the provider leg; the app gets a loopback redirect (RFC 8252 §7.3)
and proves with a PKCE verifier (RFC 7636) that it started the login.

```
App                         Browser                  api-server                 IdP
 │ listen 127.0.0.1:<port>                                │                        │
 │ POST /api/oidc/auth {…, loopback, code_challenge} ────▶│ store challenge        │
 │◀──────────────────────────────── {code, url} ──────────│                        │
 │ open url ─────────────────▶│ login ────────────────────┼───────────────────────▶│
 │                            │◀──── redirect /callback ──┼────────────────────────│
 │                            │ GET /callback ───────────▶│ code→tokens (secret,   │
 │                            │                           │ PKCE, state, nonce) ──▶│
 │                            │◀─ 302 http://127.0.0.1:<port>/?result=<one-time> ──│
 │◀── GET /?result=… ─────────│                           │                        │
 │ POST /api/oidc/token {result, code_verifier, id, uuid} ▶│ check, issue token     │
 │◀──────────────────────────────── {access_token, user} ─│                        │
```

### App (our native builds)

- Before calling `/api/oidc/auth`, open a listener on `127.0.0.1` with a port chosen by
  the OS, and create a random `code_verifier` (43–128 characters).
- Send `loopback: "http://127.0.0.1:<port>/"` and `code_challenge`
  (`BASE64URL(SHA256(code_verifier))`, method `S256`) with the existing fields.
- Wait up to 3 minutes for one request carrying `result`; answer it with a short page
  ("Signed in, you can close this window") and close the listener.
- Exchange `result` and `code_verifier` at `POST /api/oidc/token`; the response has the
  same body as today's successful `auth-query`, so the rest of the login code stays.
- The polling path is removed; the app needs an api-server with this flow.

### api-server

- `POST /api/oidc/auth` accepts `loopback` and `code_challenge`. `loopback` must be
  `http://127.0.0.1:<port>/` or `http://[::1]:<port>/`; anything else is refused.
- Toward the provider, every login (native, web, console) sends a random `nonce` and a PKCE
  challenge of its own; the callback requires the matching `state`, sends the verifier with
  the code, and checks the ID token's `nonce` besides `iss`, `aud` and `exp`. The ID token
  comes straight from the token endpoint over TLS, which OIDC Core §3.1.3.7 accepts in place
  of a signature check.
- The callback finishes a login only when it is bound to its starter:
  - **same browser:** the cookie set at `/api/oidc/auth` comes back (web client, console);
    the login then completes for that browser's `auth-query` as today;
  - **loopback:** the login was started with `loopback`; the callback redirects to it with a
    one-time `result` (random, valid 60 seconds, single use).

  Any other login is refused. The confirmation page for logins finished in another browser
  goes away, and so do logins from clients that only poll (stock RustDesk).
- `POST /api/oidc/token` issues the bearer token when `result` is known and unused,
  `SHA256(code_verifier)` matches the stored challenge, and `id` and `uuid` match the ones
  given at `/api/oidc/auth`. Any mismatch burns the result.
- `GET /api/oidc/auth-query` answers only browser logins bound by the cookie.

### Web client and console

Unchanged: they start and finish the login in the same browser, bound by the existing
cookie. They gain the `nonce` and PKCE checks on the provider leg.

## Version compatibility

No backward compatibility (not yet officially released): native clients and the api-server
change together.

| Client | api-server with this flow |
|---|---|
| Our native builds with this flow | loopback flow |
| Our native builds before it, stock RustDesk | login refused (they only poll) |
| Web client, console | cookie-bound, as today |

The release that ships it states the pairing: the client GitHub Release notes and the
chart's `UPGRADING.md` name the minimum client version for the api-server version (and
the reverse), and that older native builds and stock clients can no longer log in.

## Alternatives

- **Public client in the app** (authorization code + PKCE at the provider, the app sends the
  ID token to the api-server): needs a public client registered at each customer's
  identity provider, and the api-server would have to verify tokens handed in by apps
  (JWKS signature, `nonce`). The loopback flow keeps one confidential client and the
  token exchange on the server.
- **Device authorization grant**: also unbound to the starting app; no gain over polling.

## Testing

- api-server unit and integration tests: loopback validation, one-time `result`, verifier
  and `id`/`uuid` checks, expiry, `nonce`/PKCE/`state` on the provider leg (stub provider),
  refusal of logins bound to neither a browser nor a loopback.
- e2e: a native client logs in through the mock provider and receives its token on the
  loopback; a result redeemed without the verifier, or twice, is refused; a polling-only
  login is refused; web client and console logins still work.

## Related

- [native-client-roadmap.md](native-client-roadmap.md), [api-server-roadmap.md](api-server-roadmap.md)
- RFC 8252 (OAuth 2.0 for Native Apps), RFC 7636 (PKCE), OpenID Connect Core 1.0 §3.1.3.7
