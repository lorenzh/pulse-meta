# Spec #562: console first-run setup, local accounts, sign-in

## Goal

A self-hosted owner sets up pulse-console once and then signs in with a local account. Setup
opens only with a one-time code from the container log. It creates the one owner account, saves
the pulse-api URL, and tests the connection to pulse-api: wire version and check count. After
that, the owner signs in with email and password and gets a server-side session. Accounts and
sessions live in SQLite. pulse-deploy gives the console a durable volume and an api token that the
api accepts, so the flow works in Compose.

## Decisions this spec applies

The issue text is older than the owner decisions of 2 November in
[#460](https://github.com/lorenzh/pulse-meta/issues/460) (comment "Console v1: open points
decided"). Where they differ, #460 wins. The issue review (`.factory/work/562/issue-review.md`)
reads it the same way.

| Issue text | Applied rule | Source |
| --- | --- | --- |
| "stores the pulse-api URL and an admin token encrypted on the server" | The URL is stored. The token comes only from `PULSE_CONSOLE_ADMIN_TOKEN_FILE` or `PULSE_CONSOLE_ADMIN_TOKEN`. The browser never enters it, and the console database never holds it, also not encrypted. There is no encryption subsystem in #562. | #460 decision 3, decision 19 ("#562 takes the api token from the token file") |
| "users in SQLite, `DATABASE_URL` for Postgres" | SQLite only, through `bun:sqlite`. `DATABASE_URL` is not read. | #460 decisions 19, 20 ("Postgres … later") |
| "tests the connection (wire version …)" | The wire version is the `x-pulse-contract` response header, checked with contract `checkWireVersion`. | #460 decision 19 |
| "a current KDF" | `Bun.password` with argon2id. | #460 decision 20 |
| "login throttling" | 5 failures in 15 minutes lock that account and that client for 15 minutes. | #460 decision 5 |
| "secure cookies" | `HttpOnly`, `SameSite=Strict`, plus `Secure` and the `__Host-` prefix over HTTPS. A CSRF token on every change. | #460 decision 20 |
| new | `PULSE_CONSOLE_PUBLIC_URL` is the console's public origin. | #460 decision 20 |
| new | Server-rendered HTML forms that work without JavaScript. The CSP is the decided one. | #460 decision 20 |
| new | Sign-in works at 390 px width without horizontal scroll. | #460 decision 15 |

The design boards SH1/SH2 are not in any clone (issue review). This spec defines the function.
The visual details are free within the rules below.

Engineering choices made here (the issue review lists them as open points, none is a hold):

1. **API URL.** `PULSE_API_URL` stays required at start, as today. Before setup it fills in the
   default of the setup form. Setup saves the URL that passed its connection test. After setup
   the saved URL is the one in use. If `PULSE_API_URL` differs from it, the console logs one `warn`
   line at start and still uses the saved URL. So an env change never switches the API of an
   existing owner without notice. #562 has no way to change the saved URL. A later settings item
   adds one. The only reset is to delete the database (see Risks).
2. **Missing token.** The token stays optional at start, as today. Without it the setup page
   shows an operator instruction, and no setup can complete. This keeps every current Compose
   setup starting while console `main` is ahead of pulse-deploy (see Rollout order).
3. **Connection test.** `GET /admin/config` (needs `read` or `checks`) gives the wire header and the
   check count. Then `GET /admin/tokens` (needs `admin`) proves the admin scope. A `404` on the
   second call means an api without the token store, such as the published `0.1.0`. Setup accepts
   that case and says that the scope was not checked. No test mutation is made. The test does not
   use `GET /admin/tokens/self` (#566, not on api `main`).
4. **Loopback mode.** When `PULSE_CONSOLE_PUBLIC_URL` is unset, or is an `http` URL with a loopback
   host, the console runs in loopback mode. It serves app pages only to a loopback `Host`, and it
   checks `Origin` against that `Host`. The stack publishes the console on `127.0.0.1` over plain
   HTTP, so loopback mode is the default there. Any other public URL switches to strict mode:
   `Origin` must equal the public origin.
5. **Throttle.** The console has its own small limiter. kit's `createFailureLimiter` blocks only
   until the end of a fixed window that opened at the first failure. A fifth failure at minute 14
   would then lock for 1 minute, not the decided 15 minutes. kit's `clientKeyOf` gives the client
   key.

## Scope

- console: SQLite store, one-time setup code, setup flow with connection test, owner account,
  password sign-in, login throttling, server-side sessions, sign-out, cookies, origin and CSRF
  checks, pages with a stylesheet and the decided CSP, docs and CI. Also a pin of pulse-contract
  and a newer pulse-kit pin.
- deploy: a durable console database volume and a shared admin token in `full`, `demo`, `dev` and
  in CLI-generated installs. Also `PULSE_CONSOLE_PUBLIC_URL` wiring, an e2e of the setup flow, and
  docs.

## Non-goals

- 2FA (TOTP, recovery codes), passkeys, session list and revoke UI: #563 and later. The setup
  step "Secure the owner account" is added by #563. #562 must not show a 2FA placeholder that
  looks like it enforces anything.
- Team roles, invitations, password reset, owner recovery command, ownership transfer: later
  items. #562 has exactly one account with the role `owner` and no registration route.
- GitHub or OIDC sign-in, SMTP, Postgres, `DATABASE_URL`: later, and not approved now.
- Any api or contract source change. Any console screen that manages checks, tokens, incidents or
  settings. Changing the saved API URL after setup.
- A pulse image release or pin bump. A person cuts the console release, and `bump-images.sh`
  moves the pin later (see Rollout order).

## Required behavior

### console: settings

| Setting | Default | Rule |
| --- | --- | --- |
| `PULSE_API_URL` | none, required | Unchanged rules and texts. Before setup it fills in the default of the setup form. After setup it is not used. A different value logs `warn` `PULSE_API_URL differs from the API URL saved at setup; the saved URL is used`, with no URL in the line. |
| `PULSE_CONSOLE_DB` | `./console.db`; image `/data/console.db` | Path of the SQLite file. Trimmed. Blank counts as unset. |
| `PULSE_CONSOLE_PUBLIC_URL` | unset (loopback mode) | Same URL rules as `PULSE_API_URL` (whitespace or control character, then `http(s)`, host, no credentials, query or fragment), and also no path other than `/`. Error texts follow the `PULSE_API_URL` pattern with this name. |
| `PULSE_CONSOLE_ADMIN_TOKEN`, `_FILE` | unset | Unchanged rules, texts and mutual exclusion. They are still optional. |

The settings order becomes: `PULSE_LOG_LEVEL`, `PULSE_API_URL`, `PULSE_CONSOLE_PORT`,
`PULSE_CONSOLE_HOST`, `PULSE_CONSOLE_PUBLIC_URL`, `PULSE_CONSOLE_DB`, the admin token. Then the
database is opened. A failure exits `2` with one stderr line `pulse-console: <message>`, as
today.

Mode from `PULSE_CONSOLE_PUBLIC_URL`:

- **loopback**: unset, or `http:` with a host of `127.0.0.1`, `localhost` or `[::1]`.
- **strict-https**: `https:`. Cookies get `Secure` and the `__Host-` prefix.
- **strict-http**: `http:` with any other host. The start logs `warn`
  `PULSE_CONSOLE_PUBLIC_URL uses http: session cookies are not marked Secure`.

### console: database

- `bun:sqlite`, WAL journal, `foreign_keys = ON`, `busy_timeout = 5000`. The schema version is
  in `PRAGMA user_version`. Migration 1 creates:
  - `instance(id INTEGER PRIMARY KEY CHECK (id = 1), api_url TEXT NOT NULL, setup_completed_at INTEGER NOT NULL)`.
    A row means "set up".
  - `users(id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL, created_at INTEGER NOT NULL)`,
    plus a unique partial index on `role` `WHERE role = 'owner'`.
  - `sessions(id_digest TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, csrf_token TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL)`.
- A new file is created with mode `0600` before SQLite opens it. An existing file is set to
  `0600`. SQLite gives `-wal` and `-shm` the mode of the database file.
- Start failures exit `2` and never print a value other than the path:
  - `PULSE_CONSOLE_DB=<path>: cannot open (<code>)` for a missing or unwritable directory, or a
    file that is not a database (`SQLITE_NOTADB`, `SQLITE_CORRUPT`, `EACCES`, …).
  - `PULSE_CONSOLE_DB=<path>: schema version <n> is newer than this console (1)`.
- No state of the database reopens setup. An unreadable database is a start failure, never a fresh
  setup.
- Never stored: the api token, a setup code, a setup grant, a plain session id, a password.

### console: setup code and setup grant

- At start, if there is no `instance` row, the console makes a code from 16 bytes of
  `crypto.getRandomValues`. The code is 32 lowercase hex characters, written in 8 groups of 4
  joined by `-`. Only its SHA-256 digest stays in memory.
- The console writes exactly one line to stdout, outside the logger, so that `PULSE_LOG_LEVEL`
  never suppresses it:
  `pulse-console setup code: <code> (open /setup; a restart prints a new code)`.
  The code appears nowhere else: not in another log line, `/metrics`, a response, an error or a
  URL.
- The code stays valid until setup completes or the process ends. A restart before setup makes a
  new code and drops the old code and every grant. A start with an `instance` row prints no code.
- Input normalization: remove ASCII spaces and `-`, then lowercase. The result is hashed and
  compared with `timingSafeEqual`. Empty input answers `422` and is not counted. Any other
  mismatch is a failure (`401`) and counts toward the setup throttle.
- A correct code creates a **setup grant**: 32 random bytes as base64url in the cookie
  `pulse_console_setup`. Memory keeps only its SHA-256 digest, with an expiry of now + 30 min.
  At most one grant is live; a new unlock replaces the old one. The grant ends at completion, at
  a restart, at expiry, or when replaced. A grant is not a session and gives no access outside
  `/setup/owner`.

### console: setup flow and connection test

`/setup/owner` shows one form:

- API URL, with the default described in Settings.
- Owner email and name.
- Password and password confirmation.
- Two submit buttons: `action=test` ("Test connection") and `action=complete` ("Finish setup").

Field rules:

- **API URL**: the `PULSE_API_URL` rules, at most 2048 characters. One trailing `/` is dropped.
  A path prefix is kept. A request URL is `<saved URL>` + `/admin/config`, so
  `http://api:3000/pulse/` is saved as `http://api:3000/pulse` and calls
  `http://api:3000/pulse/admin/config`.
- **Email**: trimmed and lowercased, 3 to 254 characters, no whitespace or control character,
  exactly one `@` with text on both sides.
- **Name**: trimmed, 1 to 100 characters, no control character.
- **Password**: 12 to 128 characters, counted as code points (`[...pw].length`). It is not
  trimmed and has no composition rule. The confirmation must be equal.

Invalid fields re-render with `422` and a message per field. Valid values are kept, except the
two password fields: those are never echoed.

`action=test` runs the connection test and re-renders with the result. It saves nothing.

`action=complete` validates the fields, runs the connection test, then commits in one
`BEGIN IMMEDIATE` transaction:

1. If an `instance` row already exists, answer `409` "Setup is already complete" and change
   nothing.
2. Insert the owner (`role = 'owner'`, argon2id hash).
3. Insert `instance(1, api_url, now)`.

Only after the commit does the console clear the code digest and every grant, and log `info`
`setup complete` with `apiOrigin` and `checks`. The answer is `303` to `/sign-in?setup=done`,
which shows "Setup is complete. Sign in." Any failure keeps the setup open with the grant still
valid: invalid form, failed test, or a failed commit (`500` "Setup could not be saved").

The connection test runs only for a request with a valid grant:

1. If no admin token is configured, it fails with the operator text "The console has no pulse-api
   token. Set PULSE_CONSOLE_ADMIN_TOKEN_FILE and restart the console." No request is sent.
2. Otherwise it calls contract `fetchJson` with:
   - `headers: { authorization: "Bearer <token>" }`;
   - `timeoutMs: 5000` per request;
   - the default 5 MiB body cap;
   - a `fetch` wrapper that sets `redirect: "manual"`.
3. `GET <url>/admin/config` with `validateAdminConfigResponse`, then
   `GET <url>/admin/tokens` with `validateTokensResponse`. The token list is dropped right away.
   It is never rendered, logged or stored.
4. The result on success: `wireVersion` = `WIRE_VERSION` (1), `checkCount` = the length of the
   `checks` array of the validated `/admin/config` body, and `adminScope` = `confirmed` (tokens
   `200`) or `not-checked` (tokens `404`).

A successful test renders exactly
`<p id="connection-result">Connected. Wire version: 1. Checks: <n>.</p>`. With `not-checked` it
adds the sentence "This pulse-api has no token routes, so the admin scope was not checked." A
failed test re-renders with `502` and one fixed text. The text holds no upstream body and no
token. It may hold the URL origin and a status code:

| Case | Text |
| --- | --- |
| network error or DNS | `pulse-api cannot be reached at <origin>.` |
| timeout | `pulse-api did not answer within 5 seconds.` |
| `3xx` on either call | `pulse-api answered with a redirect (<status>); redirects are not followed.` |
| `/admin/config` `404` | `The admin routes of pulse-api are off. Enable its admin token import.` |
| `401` on either call | `pulse-api rejected the console token.` |
| `/admin/config` `403` | `The console token lacks the read or checks scope.` |
| `/admin/tokens` `403` | `The console token lacks the admin scope.` |
| `429` | `pulse-api is throttling the console. Try again in a minute.` |
| other non-2xx | `pulse-api answered <status>.` |
| wire header absent (either `200`) | `pulse-api sent no x-pulse-contract header.` |
| wire mismatch | `pulse-api speaks wire version <value>; this console needs 1.` (value: the trimmed header, at most 16 characters, only `[0-9A-Za-z.-]`, else `an unknown version`) |
| too large, invalid JSON, validation | `pulse-api sent an invalid answer.` |

`fetchJson` reports `wire: "absent"` as success, so the console must check it and fail.

### console: sign-in, throttle, sessions

**Sign-in.** `POST /sign-in` takes `email`, `password`, `csrf` and `next`.

- An empty email or password, or a password longer than 128 code points, answers `422` and is not
  counted.
- Then the throttle check runs (see Throttle).
- Then verification. Email is normalized as in setup. A known email checks the password with
  `Bun.password.verify` against the stored hash. An unknown email runs `Bun.password.verify`
  against a dummy verifier made at start with the same parameters, and always fails.
- Both failures answer `401` with the same page and the same text, "Wrong email or password.",
  and count as one failure.
- **Hash parameters**: `Bun.password.hash(pw, { algorithm: "argon2id", memoryCost: 19456, timeCost: 2 })`.
  The stored value starts with `$argon2id$v=19$m=19456,t=2,p=1$` (checked with Bun 1.4.0).
- Success:
  1. Delete the session row of any session cookie sent with the request.
  2. Delete expired sessions.
  3. Create a session.
  4. Clear the failures of the account key.
  5. Answer `303` to `next`.

**`next`.** It must start with `/`, its second character must not be `/` or `\`, it may hold only
`\x21-\x7e`, and it may have at most 512 characters. Anything else becomes `/`.

**Throttle** (in memory, one module, `now` injected). There are two tables:

- Account key: the normalized submitted email, whether the account exists or not.
- Client key: kit `clientKeyOf(req.socket.remoteAddress)`. `Forwarded`, `X-Forwarded-For` and every
  other header are ignored.

Per key, the table holds the failure times of the last 15 minutes, `lockedUntil`, and `inFlight`:

- **Admit.** An attempt is admitted only if, for both keys, `now >= lockedUntil` and
  `liveFailures + inFlight < 5`. A failure is live when `now - 900000 < t`. If not admitted, the
  answer is `429` with `Retry-After` = `ceil(max remaining lock ms / 1000)`. That is 1 when only
  in-flight attempts fill the budget, and 900 at most. No KDF runs and nothing is counted. The lock
  is not extended.
- **Failure.** The failure is recorded on both keys. When a key reaches 5 live failures,
  `lockedUntil = now + 900000` and its failures are cleared.
- **Success.** Only the account key's failures are cleared.
- **Size.** At most 10,000 keys per table. Entries with no live failure, no live lock and no
  in-flight attempt are dropped first. If the table is still full, the unlocked entry with the
  oldest last failure is evicted. If every entry is locked, the attempt answers `429` with
  `Retry-After: 900`.
- **Restart.** A restart clears all throttle state (documented).

The setup code uses a separate instance with the client key only and the same numbers.

**Sessions.**

- The session id is 32 random bytes as base64url, held only in the cookie. The row key is its
  SHA-256 hex digest. `csrf_token` is 32 random bytes as base64url.
- A request is signed in when the digest of its cookie matches a row and
  `now < last_seen_at + 2592000000` (30 days of no activity). `last_seen_at` is updated when at
  least 60000 ms have passed since the stored value.
- Expired rows are deleted at start and on each successful sign-in. Sessions survive a restart.
- `POST /sign-out` with a valid session and its CSRF token deletes the row, clears the cookie
  (`Max-Age=0`) and answers `303` to `/sign-in`. Without a valid session it answers `303` to
  `/sign-in` and changes nothing.

### console: cookies, origin, CSRF, routing

**Cookies.**

- Names: `pulse_console_session`, `pulse_console_csrf`, `pulse_console_setup`. In strict-https
  mode each gets the `__Host-` prefix.
- Every cookie has `Path=/; HttpOnly; SameSite=Strict`, plus `Secure` in strict-https mode, and
  never a `Domain`.
- `Max-Age`: session 2592000, setup 1800. The CSRF cookie has none (a browser-session cookie).

**Loopback `Host` rule.** In loopback mode, every request outside the ops routes must have a
`Host` of `127.0.0.1`, `localhost` or `[::1]`, with an optional `:port`. Otherwise the answer is
`421` with the text `misdirected request: set PULSE_CONSOLE_PUBLIC_URL to serve this host`. This
also stops DNS rebinding. The ops routes `/healthz`, `/readyz` and `/metrics` keep their current
behavior for every `Host`.

**POST order.** The order is fixed. The first failing step answers:

1. Route and method: `404`, or `405` with `Allow`.
2. Phase: a setup route after setup, or `POST /sign-in` before setup, answers `404`.
3. The loopback `Host` rule: `421`.
4. `Origin`. It must be present, not `null`, and equal the expected origin: `http://<Host>` in
   loopback mode, the public origin in strict modes. Otherwise `403` "Request refused. Reload the
   page and try again."
5. `Content-Type` other than `application/x-www-form-urlencoded`: `415`.
6. Body over 8192 bytes, read with kit `readBody`: `413`.
7. A repeated known field: `400`. Unknown fields are ignored.
8. CSRF token: `403`. The field `csrf` must equal (timing-safe) the session's `csrf_token` for a
   signed-in form (sign-out), else the `pulse_console_csrf` cookie.
9. Grant, for `/setup/owner` only: `403` "Setup is locked. Enter the setup code first." with a
   link to `/setup`.
10. Field presence and format: `422`.
11. Throttle: `429`.
12. Verification: `401`.
13. Connection test: `502`.
14. Commit: `303`, `409` or `500`.

Every form renders the CSRF field exactly as
`<input type="hidden" name="csrf" value="<token>">`. A GET of a page with a form sets the
`pulse_console_csrf` cookie when it is missing.

**Routes** (`HEAD` works wherever `GET` does; raw path match as today):

| Route | Before setup | Set up, signed out | Signed in |
| --- | --- | --- | --- |
| `GET /` | `303` `/setup` | `303` `/sign-in?next=%2F`; if a session cookie was sent but is invalid, the sign-in page shows "Your session has expired." | `200` landing: `Signed in as <name>`, the email, the origin of the saved API URL, and a sign-out form |
| `GET /setup` | `200` code form | `404` | `404` |
| `POST /setup` | grant and `303` `/setup/owner`; `401`; `422`; `429` | `404` | `404` |
| `GET /setup/owner` | valid grant `200`; else `303` `/setup` | `404` | `404` |
| `POST /setup/owner` | see Setup flow | `404` | `404` |
| `GET /sign-in` | `303` `/setup` | `200` form (`?setup=done` adds the notice) | `303` `/` |
| `POST /sign-in` | `404` | see Sign-in | see Sign-in (rotates) |
| `POST /sign-out` | `303` `/sign-in` | `303` `/sign-in` | deletes, `303` `/sign-in` |
| `GET /console.css` | `200` `text/css; charset=utf-8` | same | same |
| ops routes | unchanged | unchanged | unchanged |
| other paths | `404` | `404` | `404` |

**Responses and pages.**

- Every response keeps `cache-control: no-store` on pages, plus `x-content-type-options`,
  `x-frame-options: DENY` and `referrer-policy: no-referrer`.
- The CSP becomes exactly
  `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`.
- No inline script or style, and no external asset. Every value in HTML goes through kit
  `escapeHtml`.
- Pages have labels bound to inputs, `autocomplete` attributes (`username`, `current-password`,
  `new-password`), a visible keyboard focus, and inline error text linked with
  `aria-describedby`.
- The sign-in and setup pages have no horizontal scroll at 390 px width: no fixed width over
  360 px, and `meta viewport` as today.

**Logs and metrics.**

- Log lines never hold a password, an email, the token, a session id, a grant, or the code (the
  code's one line excepted). New lines:
  - `info` `setup complete` with `apiOrigin` and `checks`;
  - `info` `signed in` with `userId`;
  - `warn` `sign-in failed` with `client` (the client key) and `reason` `credentials`|`throttled`;
  - `warn` `setup code refused` with `client` and the same `reason`.
- The start line `pulse-console listening` adds `mode` (`loopback`, `strict-https`,
  `strict-http`) and `isSetUp`.
- New `path` label values: `/setup`, `/setup/owner`, `/sign-in`, `/sign-out`, `/console.css`.
- New counter `pulse_console_auth_attempts_total{kind="sign-in"|"setup-code", result="success"|"failure"|"throttled"}`.

### deploy

- `full` and `dev`:
  - `secrets-init` gets `PULSE_SECRETS_ADMIN: "on"` and `console-secrets:/out/console`.
  - `api` gets `PULSE_API_ADMIN_TOKENS_FILE: /run/pulse/admin-tokens.json`.
  - `console` gets `PULSE_CONSOLE_ADMIN_TOKEN_FILE: /run/pulse/admin-token`,
    `PULSE_CONSOLE_PUBLIC_URL: ${PULSE_CONSOLE_PUBLIC_URL:-}`, the volumes
    `console-secrets:/run/pulse:ro` and `console-data:/data`, and a dependency on `secrets-init`
    `service_completed_successfully`.
  - New top-level volumes `console-data` and `console-secrets`.
- `demo`: the same wiring, with generate mode. `secrets-init.mjs` generate mode with
  `PULSE_SECRETS_ADMIN=on`:
  - It keeps a valid `/out/console/admin-token` (the existing `existingToken` rules plus at least
    32 characters), or else creates 32 random bytes as 64 hex characters.
  - It writes `/out/api/admin-tokens.json` (`{"tokens":[{"name":"admin","token":…}]}`) and
    `/out/console/admin-token`, both `1000:1000`, mode `0400`.
  - Without `/out/console` it fails with
    `secrets-init: PULSE_SECRETS_ADMIN: generate mode needs /out/console`.
  - A rerun keeps the token, so the api's one-time import stays valid.
- `scripts/init-secrets.sh` also creates `<dir>/admin-token` (64 hex characters, mode `0600`, never
  overwritten), independent of `probe-token`. It prints paths only.
- `minimal` is unchanged.
- The CLI (`pulse init`) adds the volume `console-data:/data` and
  `PULSE_CONSOLE_PUBLIC_URL: ${PULSE_CONSOLE_PUBLIC_URL:-}` to the console service. It writes
  `PULSE_CONSOLE_PUBLIC_URL` into `.env` from `urls.console`; the default
  `http://127.0.0.1:<port>` is loopback mode. `volumeKeys` gets `console-data` when the console is
  on. The text of `pulse down --volumes` says
  `(database, notify ledger, console database, runtime secrets)`. Existing tokens and their files
  stay as they are.
- e2e:
  - `compose-e2e.sh` writes the e2e admin token into `$secrets_dir/admin-token` (mode `0600`)
    before `init-secrets.sh`. `compose.e2e.yaml` drops its own `PULSE_API_ADMIN_TOKENS_FILE` and
    the `admin-tokens` config, so the api and the console import the same token.
  - The console checks follow redirects (`curl -fsSL`).
  - A new `e2e/console-setup.sh <compose file>` drives the setup flow against a running stack (see
    Repository: deploy). The `dev` CI job runs it.

## Risks

- **Lost password or broken setup.** #562 has no recovery: the owner reset command is a later
  item. The documented way out is destructive: stop the console, delete the `console-data`
  volume (or the file at `PULSE_CONSOLE_DB` with `-wal` and `-shm`), and start again. That prints
  a new setup code. The docs must say so.
- **Password-only owner.** Until #563 lands, the owner has no second factor. This is the
  foundation, not v1 completion. The console is published on loopback only by default.
- **Throttle reset on restart.** Locks live in memory. Someone who can restart the container
  already controls the host.
- **Many-client spray.** A client that controls many addresses can force up to 5 KDF runs per
  address per 15 minutes. Each run takes about 19 MiB for a short time. The 10,000-key bound
  caps memory. Without a global KDF cap, the CPU can spike under such an attack (documented
  limit).
- **api auth throttle.** Repeated failing tests with a wrong token can trip the api's own limit
  of 10 failures per 60 s, which then answers `429`. The setup page names that case.
- **Old images on new compose.** `full` and `demo` pin console and api `0.1.0`. Both accept the
  new env, and console `0.1.0` ignores the variables it does not know. Verified:
  `src/admin-token.ts@v0.1.0` reads `PULSE_CONSOLE_ADMIN_TOKEN_FILE`, and api `v0.1.0`
  `docs/configuration.md:13` reads `PULSE_API_ADMIN_TOKENS_FILE`. Turning on the admin routes of
  the api in `full` is intended. Writes still answer `503` on the read-only checks mount.
- **Existing `full` installs** need an `admin-token` in `secrets/`. `secrets-init` fails with
  `/in/admin-token is missing; run scripts/init-secrets.sh` until it exists. The README lists
  this upgrade step.
- **Reverse proxies** must keep the `Origin` header and serve the console from the origin in
  `PULSE_CONSOLE_PUBLIC_URL`.

## Acceptance evidence

Each check names where its expected value comes from.

1. console `bun run check` passes in CI (`check` job). The `docker` job passes on both
   architectures, with the new steps listed in Repository: console.
2. Setup without the code is refused (`src/server.setup.test.ts`, real server on port 0, fake api
   on port 0). `POST /setup/owner` without a grant answers `403`. `GET /setup/owner` without a
   grant answers `303` with `Location: /setup`. A wrong code answers `401`. The fake api records 0
   requests and the `users` table has 0 rows. Expected values: the literals here.
3. After setup the code no longer works. `POST /setup` with the original code answers `404`. A
   second server on the same database file prints no line that holds `setup code:`.
   `GET /setup` answers `404`. Expected: literals.
4. A wrong password fails and is throttled (injected clock):
   - 5 wrong passwords answer `401`. The 6th attempt answers `429` with `Retry-After: 900`, also
     with the correct password.
   - At `t5 + 899999` ms the answer is still `429`. At `t5 + 900000` the correct password answers
     `303`.
   - 10 concurrent wrong attempts on a fresh state give exactly 5 × `401` and 5 × `429`.
   - Expected: literals from #460 decision 5 (5, 15 min = 900000 ms).
5. The stored admin token is not readable in the clear. After a completed setup with the sentinel
   token `console-test-sentinel-token-0123456789abcdef`:
   - the bytes of the database file, `-wal` and `-shm` do not contain the sentinel, the password
     sentinel, or the plain session cookie value;
   - `password_hash` starts with `$argon2id$v=19$m=19456,t=2,p=1$`;
   - `sessions.id_digest` equals the SHA-256 hex of the cookie value, computed in the test with
     `node:crypto`, independent of the code under test.
   - Expected: the literal sentinels and the literal prefix.
6. Connection test against fixtures. The fake api serves `x-pulse-contract: 1` and a config with
   3 checks, then one with 0 checks. The page shows `Checks: 3.` and `Checks: 0.` (literals from
   the fixture). Each failure case in the table renders its literal text and saves nothing. A
   `302` to a second fake server leaves that server with 0 requests.
7. Browser check with `agent-browser` against `bun start` (temp `PULSE_CONSOLE_DB`, local fake or
   dev api). The PR lists the commands and results:
   - setup refused without the code;
   - setup completed with the code from stdout, and the connection result seen;
   - sign-out; a wrong password rejected; a correct sign-in;
   - the old code refused after setup;
   - keyboard-only completion of the sign-in form;
   - at a 390 × 844 viewport, `document.documentElement.scrollWidth <= 390` on `/sign-in` and
     `/setup` (literal 390 from #460 decision 15).
   - No live code or password appears in public evidence.
8. Compose (deploy `dev` CI job, console built from `main`): `e2e/console-setup.sh dev/compose.yaml`
   passes. The connection result shows `Checks: <n>.`, where `n` is
   `jq '.checks | length' full/config/api/checks.json`: an independent source, the file that the
   api loads. After `up -d --force-recreate console` the owner still signs in, and `/setup`
   answers `404`.
9. deploy: `lint`, `full` (with `e2e/compose-e2e.sh`), `demo`, `dev`, `cli-render`, `cli-stack`
   and the `check` job are green. `scripts/secrets-init.test.sh` covers generate-mode admin.
   `scripts/check-setup.sh` covers `admin-token`.

## Performance impact

None expected for any key of `bench/budgets.json` in the api repository (`api`, `probe`,
`status`, `notify`, `contract`, `kit`, `config` sections; checked at api
`2d4a6b23d532e66ad30840a778ac21ab465647dc`). The budgets have no console section, and this
change touches no api, probe, status, notify, contract, kit or config code. Startup CPU, load CPU,
idle and peak RSS, test CPU, build CPU, wall-clock startup, p95 latency, requests per second and
image size of those services stay unchanged.

The console's own costs, for the record (not gated):

- each password hash or verify holds about 19 MiB (argon2id `m=19456`) for a short time;
- tests get slower by the real KDF runs;
- the image grows by pulse-contract and zod.

The implementer reports `docker image ls pulse-console:local` before and after, and the test time
of `bun run test` before and after, in the PR. The deploy `full` CI job's `scripts/measure.sh full`
still passes.

## Security impact

Security impact: yes. The change adds authentication, sessions, form parsing at a trust boundary,
credentialed outbound requests, database file writes, new dependencies, Dockerfile and CI
changes.

Checklist items that apply:

- **Secrets in errors, logs and responses.** The api token, passwords, session ids, grants and
  CSRF tokens never appear in logs, metrics, errors or HTML. The setup code appears only in its
  one stdout line. Upstream bodies are never echoed. Tests scan logs, responses and the database
  for sentinels.
- **Auth order and status codes.** The fixed POST order (`404`, `421`, `403` origin, `415`, `413`,
  `400`, `403` CSRF, `403` grant, `422`, `429`, `401`, `502`, `303`/`409`/`500`). Unknown and
  known accounts fail alike. The throttle runs before the KDF.
- **Body and size limits.** Forms are capped at 8192 bytes. The upstream body cap is 5 MiB, with
  a 5000 ms timeout per call. The password is capped at 128 code points. The throttle tables are
  capped at 10,000 keys.
- **Input validation.** API URL, email, name, password, `next`, setup code, `Host`, `Origin` and
  `Content-Type`.
- **SSRF and redirects.** Only a grant holder can trigger a credentialed request. The URL must be
  `http(s)` with no credentials. Redirects are never followed (`redirect: "manual"`). There is no
  generic proxy, and nothing runs the test after setup.
- **Atomic, path-safe writes.** The database file is created with `0600`. Setup is one
  transaction. The path comes only from `PULSE_CONSOLE_DB`.
- **Dependency pins.** pulse-contract and pulse-kit are pinned by full commit SHA. No new
  third-party package (zod comes through contract and is approved).

Not applicable: accessor execution (form fields are read with `URLSearchParams`, no object
access on parsed input).

## Rollout order

1. **console** merges first. Its pin of pulse-contract
   (`7ce23aaf3fa3e038f65ecfed755188b83bde143f`) already exists. Other consumers keep working:
   - deploy `full` and `demo` run the published `0.1.0` console and api, which are not affected.
   - deploy `dev` builds console `main` daily, before the deploy change lands. It passes no token
     and no volume. The console still starts, because the token stays optional and `/data` in the
     image is owned by `bun`. `/readyz` answers `200`, so the `dev` readiness gate stays green.
     The setup page shows the missing-token instruction.
2. **deploy** merges second. It needs console `main` with this feature, because its `dev` job
   runs `e2e/console-setup.sh`. Older images stay compatible: console and api `0.1.0` accept the
   new env (see Risks), and the `full` e2e uses a shared token and follows redirects, which works
   with both the old and the new console.
3. A person later tags a console release and runs `scripts/bump-images.sh`. Only then do `full`,
   `demo` and CLI installs get the setup flow. Nothing in #562 fakes a version or a digest.

## Counterexamples

- **Setup code.**
  - `POST /setup` with an empty code: `422`, not counted.
  - Code `ABCD…` (upper case, correct): accepted.
  - The correct code with one hex digit changed: `401`, counted.
  - The 6th wrong code within 15 minutes from one client: `429`, also with the correct code.
  - After setup, the correct code: `404`.
  - After a restart before setup, the old code: `401`.
- **Grant.**
  - A forged `pulse_console_setup` cookie: `403`.
  - A grant at 30 min + 1 ms: `403`.
  - Grant A after a second unlock created grant B: `403`.
  - Concurrent `action=complete` × 2 with one grant: exactly one `303` and one `409`, and the
    `users` table has 1 row.
- **Connection test.**
  - `x-pulse-contract` absent with `200`: fails (a wrong implementation trusts
    `fetchJson` `ok: true`).
  - Header `2`: fails.
  - `/admin/config` with `"checks": []`: succeeds with `Checks: 0.` (zero is not an error).
  - `/admin/tokens` `404`: succeeds with `not-checked`. `/admin/tokens` `403`: fails.
  - `302` to another origin: fails, and the second origin gets 0 requests.
  - A test with no token configured: no request is sent.
- **API URL.** These answer `422`:
  - `http://user:pw@api:3000`;
  - `http://api:3000/?a=1`;
  - `http://api:3000/#x`;
  - `ftp://api`;
  - `http://api\t:3000` (the URL parser would drop the tab);
  - 2049 characters.

  `http://api:3000/` is saved as `http://api:3000`.
- **Password.** 11 code points: `422`. 12 emoji (12 code points, 48 bytes): accepted. 129 code
  points: `422`. Leading spaces are kept as typed.
- **Sign-in.**
  - An unknown email answers `401` with a page byte-identical to a wrong password (except the
    CSRF token).
  - 5 failures for `owner@example.com` from client A: the correct password from client B answers
    `429` (account lock).
  - 5 failures with 5 different emails from client A: the correct owner password from client A
    answers `429`, and from client B `303` (client lock).
  - Failures with a changing `X-Forwarded-For` from one peer: one client key, so the 6th attempt
    answers `429`.
  - Failures at t = 0, 1, 2, 3 min and t = 15:00.000: the first is no longer live
    (`now - 900000 < t` is false for t = 0). There are 4 live failures, so there is no lock.
- **Throttle lock.** It ends exactly at `lockedUntil`: `429` at `t5 + 899999`, admitted at
  `t5 + 900000`. A blocked attempt does not extend the lock.
- **Sessions.**
  - Idle at `last_seen_at + 2591999999`: valid. At `+ 2592000000`: expired, and `GET /` answers
    `303` with the expired notice.
  - After sign-out, the old cookie: not signed in.
  - The cookie from before a new sign-in: not signed in (rotation).
  - A fabricated cookie value: not signed in.
- **`next`.**
  - `//evil.example`, `/\evil.example`, `https://evil.example`, a value with a space, and 513
    characters all redirect to `/`.
  - `/` redirects to `/`.
- **Origin and Host.**
  - No `Origin`: `403`. `Origin: null`: `403`.
  - Loopback mode with `Host: localhost:8082` and `Origin: http://127.0.0.1:8082`: `403`.
  - Loopback mode with `Host: evil.example:8082`: `421` on `GET /sign-in`, and `200` on
    `GET /healthz`.
  - Strict-https `https://console.example.com` with `Origin: http://console.example.com`: `403`.
- **CSRF.** A form `csrf` that differs from the cookie by one character: `403`, and no state
  changes. A sign-out with the anonymous cookie token instead of the session token: `403`.
- **Body.** A body of 8193 bytes: `413`. `Content-Type: application/json`: `415`. `email`
  repeated: `400`.
- **Database.**
  - `PULSE_CONSOLE_DB` in a missing directory: exit `2` with
    `PULSE_CONSOLE_DB=<path>: cannot open (<code>)`.
  - A file of random bytes: exit `2`, and no setup code is printed.
  - `user_version = 2`: exit `2` with the newer-schema text.
- **Statistics.** The check count is the length of the `checks` array of the one validated
  `GET /admin/config` body in that test. There is no window, sampling or rounding. The throttle
  counts failures with `now - 900000 < t <= now`. No percentile is computed.
- **deploy.**
  - `init-secrets.sh` run twice: `admin-token` is unchanged (same sha256).
  - Demo `up`, `down` (no `-v`), `up`: the console token is unchanged, and the api still accepts
    it.
  - Generate mode with admin on and without `/out/console`: exit 1 with the literal text.

## Contract fields

New names. None exists in the contract or config clones:

```text
$ for n in PULSE_CONSOLE_DB PULSE_CONSOLE_PUBLIC_URL pulse_console_session pulse_console_csrf \
    pulse_console_setup pulse_console_auth_attempts_total console-data '/setup/owner' '"/setup"' \
    '/sign-in' '/sign-out' 'console.css' 'setup code' connection-result; do
    grep -rn --exclude-dir=node_modules --exclude-dir=.git -- "$n" .repos/contract/src .repos/config | wc -l; done
0 (each)
$ grep -rln -- 'PULSE_CONSOLE_DB\|PULSE_CONSOLE_PUBLIC_URL\|console-data\|pulse_console_session' .repos/console .repos/deploy
(no output)
```

- Env: `PULSE_CONSOLE_DB`, `PULSE_CONSOLE_PUBLIC_URL` (the name is from #460 decision 20).
- Console routes: `/setup`, `/setup/owner`, `/sign-in`, `/sign-out`, `/console.css`.
- Cookies: `pulse_console_session`, `pulse_console_csrf`, `pulse_console_setup`, each with an
  optional `__Host-` prefix.
- Metric: `pulse_console_auth_attempts_total`.
- HTML ids that deploy reads: `connection-result`, the hidden field `name="csrf"`.
- Log line prefix: `pulse-console setup code:`.
- deploy volumes: `console-data`. `console-secrets` already exists in CLI output and is new in
  `full`, `demo` and `dev`.

No contract type, validator or route changes. The console uses the existing `WIRE_VERSION`,
`WIRE_VERSION_HEADER`, `checkWireVersion`, `fetchJson`, `validateAdminConfigResponse` and
`validateTokensResponse` from contract `7ce23aaf3fa3e038f65ecfed755188b83bde143f`
(`src/version.ts:5-28`, `src/client.ts:188-231`, exported in `src/index.ts`).

## Repository: console

Files:
- `package.json`, `bun.lock`: add `"@lorenzh/pulse-contract": "github:lorenzh/pulse-contract#7ce23aaf3fa3e038f65ecfed755188b83bde143f"`, and bump `@lorenzh/pulse-kit` to `github:lorenzh/pulse-kit#0f79e934a0b8d0f78e06c8ffe94206f464ff88f9` (kit `main`; adds `clientKeyOf`, and has committed `dist/`).
- `Dockerfile`: `ENV … PULSE_CONSOLE_DB=/data/console.db`, `RUN mkdir /data && chown bun:bun /data` before `USER bun`.
- `.gitignore`: `console.db`, `console.db-*`.
- `.github/workflows/ci.yml`: `docker` job steps (below).
- `src/settings.ts`, `src/settings.test.ts`: `PULSE_CONSOLE_DB`, `PULSE_CONSOLE_PUBLIC_URL`, mode.
- `src/database.ts`, `src/database.test.ts`: open, mode `0600`, pragmas, migration 1, start errors.
- `src/account-store.ts`, `src/account-store.test.ts`: the instance row, the owner, the setup transaction, sessions (create, find, touch, delete, prune).
- `src/setup-code.ts`, `src/setup-code.test.ts`: code, normalization, digest compare, grant.
- `src/connection-test.ts`, `src/connection-test.test.ts`: the two calls and the result or failure text table.
- `src/auth-throttle.ts`, `src/auth-throttle.test.ts`: limiter with lock, in-flight count and bound.
- `src/passwords.ts`, `src/passwords.test.ts`: policy, hash parameters, dummy verifier.
- `src/cookies.ts`, `src/cookies.test.ts`: parse and serialize with mode-dependent names and flags.
- `src/request-guard.ts`, `src/request-guard.test.ts`: the loopback `Host` rule, the `Origin` rule, the CSRF compare, `next`.
- `src/forms.ts`, `src/forms.test.ts`: content type, body limit, repeated fields, field rules.
- `src/pages.ts` (replaces `src/page.ts`, which is deleted), `src/styles.ts`: HTML templates and the stylesheet.
- `src/server.ts`, `src/server.test.ts`: routes, phases, POST order, CSP, `/console.css`.
- `src/server.setup.test.ts`, `src/server.sign-in.test.ts`, `src/server.security.test.ts`: HTTP end-to-end tests.
- `src/metrics.ts`: path labels and the auth counter.
- `src/main.ts`, `src/main.startup.test.ts`: open the database, print the code, warn lines, wiring.
- `README.md`, `docs/configuration.md`, `docs/development.md`, `docs/index.md`, `AGENTS.md`.

Behavior change: yes. It adds setup, accounts, sign-in, sessions, new settings and routes, a
database and a new CSP.

Tool facts, verified:

- Bun `1.4.0` (`package.json:8-10` `engines`, `package.json:31` `packageManager`).
- `bun run check` = lint, typecheck, test (`package.json:18`). Lint is
  `biome check . && pulse-eslint . && pulse-workflows` (`package.json:15`). Biome `2.6.3`
  (`package.json:21`). `biome.json` only extends `@lorenzh/pulse-config/biome.json`. At the pinned
  ref `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`package.json:22`), that file includes `**`
  minus `dist`, `node_modules`, `bun.lock`, `*.html` and `test/fixtures` (lines 8-17). It is
  identical to the config clone at `bc87049`.
- Tests: `bun test` with `coverage = true` and a line threshold of `0.8` (`bunfig.toml:1-4`).
- CI `check` job: `uses: lorenzh/pulse-config/.github/workflows/check.yml@04108fa…` (`ci.yml:18`).
  At that ref the file runs install, `bun run lint`, `bun run typecheck`, `bun run test` (pinned
  `check.yml:25-38`). It is identical to the clone.
- The `docker` job builds and smoke-tests the image (`ci.yml:28-112`).

Behavior: everything in "Required behavior" under console. Implementation notes:

- `main.ts` is the only module that touches `process.env`, the file system, `crypto` randomness,
  `Bun.password` wiring and stdout. Every other module gets `now`, `randomBytes`, `fetch`,
  `hashPassword`/`verifyPassword` and `log` as dependencies. Tests use the real `Bun.password`
  with the reviewed parameters, because built-ins are not mocked.
- `fetch` for the connection test is the global `fetch`, wrapped to force `redirect: "manual"`,
  and passed to contract `fetchJson`.
- Tests use `mkdtemp` database files, fake api servers on `127.0.0.1:0`, and an injected clock.
  There are no real waits.

Checks (all in `bun run check`, coverage stays ≥ 80 %, cognitive complexity ≤ 15):

- Unit tests per module for every rule and counterexample above.
- `src/server.setup.test.ts`: acceptance 2, 3, 5 and 6, concurrent completion, failed commit
  (a store whose transaction throws gives `500`, and setup stays open with the grant valid),
  missing token.
- `src/server.sign-in.test.ts`: acceptance 4, account and client locks, `X-Forwarded-For`
  ignored, rotation, sign-out, idle expiry boundary, sessions surviving a second server on the
  same file, `next`.
- `src/server.security.test.ts`: the POST order (one request per step that fails exactly that
  step), `Origin` and `Host` cases, CSRF cases, body limits, the exact CSP header, the cookie
  attributes in loopback and strict-https mode (literal `Set-Cookie` strings), and no sentinel
  (token, password, session id, code) in any response body, header or `/metrics`.
- `src/main.startup.test.ts` (spawns `bun src/main.ts`):
  - a fresh database prints exactly one `pulse-console setup code:` line, also with
    `PULSE_LOG_LEVEL=error`;
  - a set-up database prints none;
  - `PULSE_CONSOLE_DB` start errors give exit `2` and their literal texts;
  - the `PULSE_API_URL` mismatch `warn` line holds no URL;
  - the database file mode is `0600`.
- CI `docker` job, existing steps kept, with these changes and additions:
  - "Check the page and its headers" uses `curl -fsSL http://127.0.0.1:8082/`, then
    `grep -F 'pulse Console'`, and checks the header `x-frame-options: DENY`.
  - The container runs with `-v console-ci-data:/data`.
  - New step: `docker logs console` holds exactly 1 line that matches
    `pulse-console setup code: [0-9a-f]{4}(-[0-9a-f]{4}){7}`.
  - New step: `docker exec console stat -c '%u %a' /data/console.db` prints `<uid of bun> 600`
    (uid from `docker exec console id -u bun`).
  - New step: `docker exec console sh -c "grep -c -F console-ci-sentinel-token-0123456789ab /data/console.db* || true"`
    prints only `0` counts.
  - The existing sentinel log and page step stays.

Completion evidence:

- The PR lists `bun run check` output.
- The PR lists the `agent-browser` commands and results (acceptance 7).
- The PR shows one `bun start` run: the code line, setup against a local fake api, sign-in. No
  live code or password appears in the PR.
- The PR gives the image size and test time before and after (Performance impact).
- README and `docs/configuration.md` document:
  - the settings, routes, cookies and modes;
  - how to find the setup code;
  - the URL precedence;
  - the required token scopes (`read` or `checks`, plus `admin`);
  - the destructive reset;
  - that `DATABASE_URL` is not read;
  - that 2FA follows in #563;
  - the console database backup note (copy the file while stopped, or `sqlite3 .backup`; remove
    `-wal` and `-shm` on restore).
- `AGENTS.md` no longer says "The console does not depend on it yet". It describes the CSP and
  the stylesheet.

## Repository: deploy

Files:
- `full/compose.yaml`, `dev/compose.yaml`, `demo/compose.yaml`: wiring from "Required behavior / deploy".
- `full/.env.example`, `dev/.env.example`, `demo/.env.example`: `# PULSE_CONSOLE_PUBLIC_URL=`.
- `scripts/secrets-init.mjs`, `scripts/secrets-init.test.sh`: generate-mode admin.
- `scripts/init-secrets.sh`, `scripts/init-secrets.test.sh`: `admin-token`, independent of `probe-token`.
- `scripts/check-setup.sh`, `scripts/check-setup.test.sh`: rule 7 also checks `admin-token` (mode `600`, 64 hex, kept on rerun), with a failing case.
- `e2e/compose.e2e.yaml`, `e2e/compose-e2e.sh`: shared admin token, `curl -fsSL` for the console page.
- `e2e/console-setup.sh` (new).
- `.github/workflows/ci.yml`: `dev` job step `bash e2e/console-setup.sh dev/compose.yaml` after `wait-ready.sh` and before the teardown.
- `cli/render-compose.ts`, `cli/render-compose.test.ts`, `cli/render-files.ts`, `cli/render-files.test.ts`, `cli/lifecycle.ts`, `cli/lifecycle.test.ts`: console volume, public URL env and `.env` entry, `volumeKeys`, down text.
- `README.md`, `full/README.md`, `dev/README.md`, `demo/README.md`, `docs/cli.md`.

Behavior change: yes. Compose setups, secrets scripts, CLI output and CI change.

Tool facts, verified:

- Bun `1.4.0` (`package.json:9`, `package.json:28`).
- `bun run check` = lint, typecheck, test (`package.json:18`). Test is `bun test --coverage cli`
  (`package.json:13`) with a line threshold of `0.8` (`bunfig.toml:2`).
- Biome `2.6.3` (`package.json:21`). `biome.json` extends the shared config and narrows
  `includes` to `cli/**` and root config files, excluding `common`, `demo`, `dev`, `e2e`, `full`,
  `minimal` and `scripts` (`biome.json:3-27`). So Biome does not check the new `.sh` and `.mjs`
  files.
- CI `check` job `uses: lorenzh/pulse-config/.github/workflows/check.yml@04108fa…`
  (`ci.yml:16-17`). It is the same pinned file as for console (install, lint, typecheck, test).
- CI `lint` job runs:
  - shellcheck and `bash -n` on every `*.sh` (`ci.yml:34-37`);
  - `node --check` on every `*.mjs` (`ci.yml:38-39`);
  - `jq empty` on every `*.json` (`ci.yml:41`);
  - `scripts/check-setup.sh` (`ci.yml:51`), `check-setup.test.sh` (`ci.yml:53`),
    `secrets-init.test.sh` (`ci.yml:55`) and `init-secrets.test.sh` (`ci.yml:61`).
- CI `full` runs `bash e2e/compose-e2e.sh` (`ci.yml:120`).
- CI `dev` builds every service from `main` and runs `scripts/wait-ready.sh dev/compose.yaml 900`
  (`ci.yml:222`), then `bash cli/test/stack.sh dev` (`ci.yml:243`).

Behavior: everything in "Required behavior" under deploy. Rules from deploy `AGENTS.md` stay:

- no image pin outside `common/services.yaml`;
- no literal secret;
- only the secrets volume under `/run/pulse`;
- the published ports are unchanged.

`console-data:/data` is a new named volume. Docker copies the `bun`-owned `/data` of the new
image into it on first use. With console `0.1.0` (no `/data` in the image) the volume stays
unused.

`e2e/console-setup.sh <compose file>`:

- It runs with `set -euo pipefail` and prints no token, code or password. It uses a temporary
  cookie jar and sends `Origin: http://127.0.0.1:<published console port>` on every POST.
- The CSRF token comes from `name="csrf" value="…"`.
- The owner password is a random 24-character value made by the script.
- Steps, each with a literal expected status:
  1. Read the last `pulse-console setup code:` line of `docker compose -f <file> logs console`.
  2. `GET /setup`: `200`.
  3. `POST /setup` with a wrong code: `401`.
  4. `POST /setup` with the code: `303`, `Location: /setup/owner`.
  5. `POST /setup/owner` with `action=test` and API URL `http://api:3000`: `200`, and the page
     holds `Checks: <n>.` with `n` from `jq '.checks | length' full/config/api/checks.json` (the
     file that `dev` mounts into the api).
  6. `action=complete`: `303`, `Location: /sign-in?setup=done`.
  7. `POST /setup` with the same code: `404`.
  8. `POST /sign-in` with a wrong password: `401`. With the right one: `303`. Then `GET /`: `200`
     and the page holds `Signed in as`.
  9. `docker compose up -d --force-recreate console`, then wait for `/readyz`. The logs since the
     recreate hold no `setup code:`. `GET /setup` answers `404`. Sign-in answers `303` again.
  10. `docker compose exec -T console sh -c 'grep -c -F -f /run/pulse/admin-token /data/console.db* || true'`
      prints only `0` counts.

Checks:

- Every CI command in "Tool facts" passes.
- `scripts/secrets-init.test.sh` adds cases:
  - generate mode with admin creates both files (`1000:1000`, `400`, the same token);
  - a rerun keeps the token (equal sha256);
  - admin without `/out/console` fails with the literal text;
  - files mode is unchanged.
- `scripts/init-secrets.test.sh` and `check-setup.sh`: `admin-token` is created with `600` and 64
  hex characters, and a second run keeps it (sha256 equal before and after).
- CLI tests:
  - the rendered console service holds `console-data:/data` and
    `PULSE_CONSOLE_PUBLIC_URL: ${PULSE_CONSOLE_PUBLIC_URL:-}`;
  - `volumeKeys` holds `console-data` only when the console is on;
  - `.env` holds `PULSE_CONSOLE_PUBLIC_URL='<url>'`;
  - the down text matches the literal.
- `docker compose -f <setup>/compose.yaml config` succeeds for `full`, `demo` and `dev`.
  `minimal` renders unchanged.
- `e2e/compose-e2e.sh` stays green on the pinned `0.1.0` images with the shared token.

Completion evidence:

- The PR lists the CI jobs `lint`, `check`, `full`, `demo`, `dev` (with `console-setup.sh`),
  `cli-render` and `cli-stack`, all green.
- The PR shows the output of `e2e/console-setup.sh dev/compose.yaml`: the `ok:` lines only.
- The READMEs document:
  - the setup-code lookup (`docker compose -f <setup>/compose.yaml logs console | grep 'setup code'`);
  - the upgrade step for existing `full` installs (`scripts/init-secrets.sh` creates `admin-token`);
  - `PULSE_CONSOLE_PUBLIC_URL` for a TLS reverse proxy;
  - the destructive console reset (`docker volume rm <project>_console-data`);
  - that `full` and `demo` get the setup flow with the next console pin bump.
