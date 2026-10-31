# Spec #520: Console: repository scaffold, page and ops routes

Decision record: #460 (self-hosted first, fifth container of the Compose stack, talks only to the pulse-api admin API, public repository `lorenzh/pulse-console`, MIT). Issue review: `.factory/work/520/issue-review.md`.

Clones read for this spec (`.repos/<target>`, `HEAD`): console (only `README.md`, `LICENSE`), status `3f80bda`, api `6e238de`, probe `85720d3`, kit `6a06ec2` (`main`; the services pin `fa79ba8`, read through `gh api … ?ref=fa79ba8cd93949fc0cf87f7b41bdaf261dbe4dc6`), config `01a57a7` (`main`; the services pin `51e95b0`, read through `gh api … ?ref=51e95b0eb463b27a196a33b428607bd92443e4f0`).

## Goal

pulse-console becomes a working repository with the same toolchain, CI, container build and conventions as the other pulse services. It serves one page "pulse Console" and pulse-kit's ops routes, reads and validates its settings, and runs as the fifth service of the Compose stack in pulse-api. Later Console features (#460) land on this tested base.

## Scope

- `console`: the whole repository scaffold (package, configs, CI, Dockerfile, docs), the HTTP server, the settings reader, tests.
- `api`: the `console` service in `compose.yaml`, `.env.example`, the CI `docker` job, `scripts/compose-e2e.sh`, and the docs that list the stack.
- `meta`: done in this spec PR. `README.md` (repositories table, Compose section, Bun section, settings table, health table), `docs/architecture.md`, `docs/approved-packages.md` (`@types/bun` and `oven/bun` rows). They describe the stack as it is once the console and api children are merged, as earlier specs did.

## Non-goals

- No login, no users, no admin API calls, no check editing, no client JavaScript. Those are later items of #460.
- No hosted or multi-tenant parts.
- No `/readyz` dependency on the api. A later item that calls the api decides that.
- No pulse-contract dependency: the console reads no API shape yet.
- No image registry and no release job. The images of the other services are not pushed either; Compose builds them from `main` of their repositories.
- No `_FILE` secret reader in pulse-kit. probe has its own (`src/token.ts`); the console gets the same shape locally. Moving both into kit is a separate kit item.
- No console phase in `bench/` of pulse-api. Its numbers are reported in the PR only (see Performance impact).
- No change to the demo profile of `compose.yaml`.
- Repository settings of `lorenzh/pulse-console` (default branch `main`, branch protection, required checks `check / check` and `docker`) are for a person, outside Factory. The console PR lists them in its description.

## Decisions (open points of the issue review)

1. **Order.** api's `compose.yaml` builds `https://github.com/lorenzh/pulse-console.git#main`. Until the console PR is merged, that build fails, and so do api's `compose-e2e` job and any `docker compose build`. So `api` depends on `console` in `targets.json`.
2. **Port setting.** The console listens on `PULSE_CONSOLE_PORT`, as the issue asks, not on a generic `PORT` (api and status use `PORT`). The same name is the Compose host-port variable in `.env`, like `PULSE_STATUS_PORT`. Compose interpolation does not pass `.env` values into a container (no `env_file`), so in Compose the container always listens on the image default and the host port is mapped to it. Both meanings are documented (console `docs/configuration.md`, api `docs/configuration.md`).
3. **Default port: `8082`.** Not used anywhere in the clones (`grep -rln 8082 .repos` finds nothing). Taken ports that must not be used: 3000, 3001, 8080, 8081, 8090 (api CI status override), 8000 (e2e target), 9100 (probe and notify health).
4. **Listen address.** A new setting `PULSE_CONSOLE_HOST`, default `127.0.0.1` for `bun start`; the image sets `ENV PULSE_CONSOLE_HOST=0.0.0.0`. This follows probe and notify (`PULSE_HEALTH_HOST` default `127.0.0.1`, image `0.0.0.0`, probe `Dockerfile:10`). An admin UI should not listen on every interface by default on a developer machine.
5. **Compose binds the host port to loopback**: `"127.0.0.1:${PULSE_CONSOLE_PORT:-8082}:8082"`, like the api (`compose.yaml:25`), not on all interfaces like status. A later item that adds login may revisit this.
6. **Admin token: optional, validated only.** `PULSE_CONSOLE_ADMIN_TOKEN` xor `PULSE_CONSOLE_ADMIN_TOKEN_FILE`, modelled on probe's `src/token.ts`. Both unset is allowed in this item, because the regular Compose stack has no admin tokens (`PULSE_API_ADMIN_TOKENS_FILE` is unset there) and requiring one would force admin tokens onto it. When set, the rules of the api's token schema apply (api `src/tokens.ts:6,8,29-30`): at least 16 characters after trim, printable ASCII (`\x20-\x7e`), one line, not starting with `replace-with-`. The value never appears in a log line, an error, `/metrics` or the page. The item that adds API calls makes it required.
7. **`PULSE_API_URL` is required.** Missing or blank stops the start (stricter than status, which falls back to `http://localhost:3000`, status `src/settings.ts:110`). It is read with kit's `readUrl` (pinned kit `src/settings.ts:82-103`): `http:` or `https:`, a host, no credentials, no query or fragment. Compose sets `PULSE_API_URL: http://api:3000`.
8. **`/readyz`**: `200 ok` once listening and not shutting down; `503 shutting down` after `SIGTERM`/`SIGINT`. `/healthz` is always `200 ok`. Both via kit's `handleOps` on the main port, as status does (status `src/server.ts:618-633`), with `allowHead: true`. No second port.
9. **UI approach for v1: server-rendered HTML, no client bundle, no new package.** One static page from a template string in `src/page.ts`. Reasons: there is nothing interactive yet; the strictest CSP holds without a build step (no script, no style, no font); no new dependency needs approval; the image stays small. preact is approved for pulse-website only and the fontsource fonts for pulse-status only (`docs/approved-packages.md:13` and `:11`), so a client framework or the pulse fonts would need an `approved-packages.md` change by the owner first. A later item with forms decides whether it needs a same-origin script or stylesheet and widens the CSP then.
10. **Pins**: the same as the services today. pulse-config `51e95b0eb463b27a196a33b428607bd92443e4f0` (dev dependency and `uses:` of `check.yml`), pulse-kit `fa79ba8cd93949fc0cf87f7b41bdaf261dbe4dc6` (it already exports `handleOps`, `runService`, `createRegistry`, `createLogger`, `readLogLevel`, `readPort`, `readString`, `readUrl`, `StartupError`, `escapeHtml`; pinned kit `src/index.ts:1-39`). kit `main` (`6a06ec2`) is not needed.
11. **Runtime dependencies: only `@lorenzh/pulse-kit`.** No zod: kit's readers cover every setting. No contract.
12. **CI `docker` job runs the container**, so the acceptance check "non-root, `/readyz` 200, page 200 with 'pulse Console', bad `PULSE_API_URL` exits 2, no token in logs" stays checked on every PR.

## Required behavior

### Settings (console, `src/settings.ts`, read once at start)

| Setting | Default | Rule | Error text (exit 2, one line on stderr, prefix `pulse-console: ` from `runService`) |
| --- | --- | --- | --- |
| `PULSE_API_URL` | none, required | kit `readUrl` defaults | missing or blank: `PULSE_API_URL must be set`; invalid: `PULSE_API_URL: must be an http(s) URL without credentials, query or fragment` (kit's text, pinned kit `src/settings.ts:72-79,101`) |
| `PULSE_CONSOLE_PORT` | `8082` | kit `readPort` (0 to 65535) | `PULSE_CONSOLE_PORT: must be an integer from 0 to 65535` |
| `PULSE_CONSOLE_HOST` | `127.0.0.1` | kit `readString` (blank means default) | bind failure: `PULSE_CONSOLE_HOST/PULSE_CONSOLE_PORT: cannot listen on <host>:<port> (<code>)`; the code only, never the raw error |
| `PULSE_CONSOLE_ADMIN_TOKEN` | unset | Decision 6 | both set: `set only one of PULSE_CONSOLE_ADMIN_TOKEN and PULSE_CONSOLE_ADMIN_TOKEN_FILE`; too short: `PULSE_CONSOLE_ADMIN_TOKEN must hold at least 16 characters`; non-printable or more than one line: `PULSE_CONSOLE_ADMIN_TOKEN must hold printable ASCII`; placeholder: `PULSE_CONSOLE_ADMIN_TOKEN still has the example placeholder` |
| `PULSE_CONSOLE_ADMIN_TOKEN_FILE` | unset | path to a file with the token; content trimmed, then the same rules | `PULSE_CONSOLE_ADMIN_TOKEN_FILE=<path>: cannot read (<code>)`, `…: file is empty`, `…: must hold one line`, `…: must hold printable ASCII`, `…: must hold at least 16 characters`, `…: still has the example placeholder` (path shown, content never, as in probe `src/token.ts:41-48`) |
| `PULSE_LOG_LEVEL` | `info` | kit `readLogLevel` | kit's text |

- The settings are read inside the `start` passed to kit's `runService`, so a `StartupError` gives exit code 2 and the single line `pulse-console: <message>` (pinned kit `src/run-service.ts:86-88`). `PULSE_LOG_LEVEL` is read before, as in status `src/main.ts:8-15`, with the same exit 2 and prefix.
- The order of checks: `PULSE_LOG_LEVEL`, `PULSE_API_URL`, `PULSE_CONSOLE_PORT`, `PULSE_CONSOLE_HOST`, admin token. The first failure stops the start.
- `readSettings(env, readFile)` is pure: `readFile` is passed in (as probe `readProbeToken(env, readFile)`); only `main.ts` passes `node:fs` `readFileSync`.
- The start log line: `pulse-console listening` with fields `host`, `port`, `apiUrl` (the origin only, `new URL(apiUrl).origin`, as status `src/main.ts:50`) and `hasAdminToken` (`true`/`false`). No other setting value is logged.

### HTTP server (console, `src/server.ts`)

- `node:http` server, like status. Every response, ops routes, `404` and `405` included, carries:
  - `content-security-policy: default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
  - `x-content-type-options: nosniff`
  - `x-frame-options: DENY`
  - `referrer-policy: no-referrer`
  This is status's header set (status `src/server.ts:636-639`) with a CSP that is stricter than status's: the page loads no script, style, font or image.
- Methods other than `GET` and `HEAD` answer `405` with `allow: GET, HEAD` and an empty body, on every path (status `src/server.ts:641-643`).
- `GET /` (query string ignored): `200`, `content-type: text/html; charset=utf-8`, `cache-control: no-store`. The body is a valid HTML5 document: `<!doctype html>`, `<html lang="en">`, `<meta charset="utf-8">`, `<meta name="viewport" content="width=device-width, initial-scale=1">`, `<title>pulse Console</title>`, `<h1>pulse Console</h1>`, and one paragraph that says the Console is set up and has nothing to manage yet. No setting value (API URL, token, host) is in the page. `HEAD /` answers the same status and headers without a body.
- `/healthz`, `/readyz`, `/metrics` through kit `handleOps` with `allowHead: true` (Decision 8). The wrong-method case is caught by the server's own `405` first, so all paths answer the same way.
- Any other path: `404`, `content-type: text/plain; charset=utf-8`, body `not found\n`. `/index.html` is `404` (one URL per page).
- `/metrics` (kit `createRegistry`) holds at least:
  - `pulse_up` gauge: `1` when ready, `0` while shutting down (the same name as status `src/metrics.ts:25`).
  - `pulse_console_http_requests_total` counter with labels `path` and `code`. `path` is one of `/`, `/healthz`, `/readyz`, `/metrics`, `other`, so an unknown URL never makes a new series. `code` is the numeric status as a string.
- Shutdown: on `SIGTERM`/`SIGINT` `runService` calls `stop`: readiness turns `503`, the server stops accepting, idle connections are closed, and it exits `0`. Open requests get 5000 ms (`SHUTDOWN_TIMEOUT_MS`, as status `src/main.ts:4`).

### Repository layout and toolchain (console)

Laid out like status. Every tool fact is cited in the console section below.

## Performance impact

The change cannot move any metric of api `bench/budgets.json` (`api`, `probe`, `status`, `notify`, `contract`, `kit`, `config` keys): the bench stack is its own file (`bench/compose.bench.yaml`, `bench/run.ts:30`) and does not read `compose.yaml`; the console is not a bench service; api source and tests do not change, so `test_cpu_s` of api stays as it is. **None expected** for the budget keys.

The console is a new service, so its numbers are reported in the console PR, with no budget:

- **Image size**: `docker image inspect pulse-console:local --format '{{.Size}}'`, in MB (10^6 bytes, as `image_mb` in the bench). Expected below status's `image_mb` budget of 124 MB (`bench/budgets.json`, `status.image_mb`), because the console has no contract, zod or fonts.
- **Idle RSS**: start the container with `PULSE_API_URL=http://api.invalid:3000`, wait 30 s without requests, then `docker exec <c> sh -c 'grep VmRSS /proc/1/status'` (or `/proc/<bun pid>/status` when PID 1 is not bun), in MiB. Expected below status's `idle_rss_mib` budget of 82 MiB.
- **Start time**: wall-clock from `docker run -d` to the first `200` of `GET /readyz`, polled every 50 ms with `curl`; median of 5 runs, each with a fresh container; report all 5 values and the median (the 3rd of the 5 sorted values).

The api PR adds one service to the Compose stack: `compose-e2e` builds one more image from GitHub and runs about 8 more `curl` calls. The PR reports the job duration before (last green `main` run) and after.

## Security impact

Security impact: yes
A new network-facing service with a Dockerfile, CI, dependencies and a secret setting (the admin token).

Checklist items that apply:

- **Secrets in errors, logs and responses.** The admin token value and the token file content never appear in a log line, a `StartupError` message, `/metrics`, the page or a response header. The token file error names the path and the `E…` code only (probe `src/token.ts:38-41`). `PULSE_API_URL` is never echoed: the error text is fixed, and the start log carries only the origin.
- **Input validation.** Every setting is validated at start with a named rule (table above). Hostile inputs for the security state: `PULSE_API_URL=http://user:pass@api:3000` (refused, the password not in the message), `javascript:alert(1)`, `file:///etc/passwd`, `http://`, a value with a newline; an admin token with `\r\n`, a NUL byte, `replace-with-a-random-token`, 15 characters; a token file that is a directory, missing, empty, two lines; both token settings set.
- **Auth order and status codes.** No auth exists yet. The fixed answers are `200` for `/` and the ops paths, `405` for other methods on every path, `404` for every other path. Request paths like `/%2e%2e/`, `//healthz`, `/healthz/`, `/metrics?x` must not reach a file read (there is none) and must answer `404` except `/metrics?x` (ops, `200`, kit strips the query, pinned kit `src/ops-server.ts:57`).
- **Body and size limits.** The server reads no request body. A `POST /` with a 10 MB body answers `405` without buffering it.
- **Security headers** on every response (list above), including `404`, `405` and ops routes.
- **Dependency pins.** Only `@lorenzh/pulse-kit` at a full SHA at runtime; dev dependencies at the exact versions of `docs/approved-packages.md`; `bun.lock` committed; `bun install --ignore-scripts` in the image. Base image pinned by digest. Actions pinned by SHA.
- **Container.** Runs as `USER bun` (non-root); the CI `docker` job checks `id -u` is not `0`. No test files or dev packages in the image.
- **Network exposure.** Compose publishes the console on host loopback only (Decision 5). The image listens on `0.0.0.0` inside the container only because of `ENV PULSE_CONSOLE_HOST=0.0.0.0`; `bun start` defaults to `127.0.0.1`.

Not applicable: SSRF and redirects (no outbound request yet), accessor execution (no JSON from outside), file writes (none).

## Rollout order

1. **console** first. Merging it changes nothing for anyone else: no existing service or library depends on it, and api's `compose.yaml` on `main` does not reference it yet. Older consumers: none.
2. **api** second (depends on console). Its `compose.yaml` builds pulse-console from `main`, which now exists and passes its own `docker` job. probe, status and notify keep their pins of contract `9fe5e80…`/kit `fa79ba8…`/config `51e95b0…`; the console uses the same kit and config pins, so no consumer runs on a new library version. The api itself does not change at run time: the console makes no API call.
3. **meta** (this spec PR) is merged before both, because merging it approves the spec. Its docs describe the stack after steps 1 and 2. Between the spec merge and the api merge, the meta README already lists the console in the Compose stack while `docker compose up` does not start it yet; that window is the same as in earlier specs that changed the stack.

A deployment that pulls a new pulse-api `compose.yaml` and runs `docker compose up -d --build` gets the console added; a deployment that keeps an older `compose.yaml` keeps its four services and works as before.

## Counterexamples

Settings (each must stop the start with exit code 2 and the exact line, and must not print the value):

- `PULSE_API_URL` unset → `pulse-console: PULSE_API_URL must be set`. A wrong implementation falls back to `http://localhost:3000` like status and starts.
- `PULSE_API_URL="   "` → the same `must be set` line (blank counts as unset, kit `readString`). A wrong one parses `"   "` and reports "not a valid URL", or starts.
- `PULSE_API_URL=not-a-url-secret` → `pulse-console: PULSE_API_URL: must be an http(s) URL without credentials, query or fragment`; the output must not contain `not-a-url-secret`.
- `PULSE_API_URL=ftp://api:3000` → refused (scheme). `PULSE_API_URL=http://u:hunter2-secret@api:3000` → refused, the output does not contain `hunter2-secret`. `PULSE_API_URL=http://api:3000/?x=1` → refused (query).
- `PULSE_API_URL=http://api:3000/` → accepted, stored as `http://api:3000` (kit strips one trailing slash).
- `PULSE_CONSOLE_PORT=65536`, `=-1`, `=80a`, `=8082.0` → refused. `PULSE_CONSOLE_PORT=0` → accepted (any free port, used by the tests). `PULSE_CONSOLE_PORT=` → default `8082`.
- Both `PULSE_CONSOLE_ADMIN_TOKEN=abcdefghijklmnop0123` and `PULSE_CONSOLE_ADMIN_TOKEN_FILE=/tmp/t` → refused with `set only one of …`, before the file is read (a test passes a `readFile` that throws if called).
- `PULSE_CONSOLE_ADMIN_TOKEN=exactly-16-chars` (16 characters) → accepted; `exactly-15-char` (15) → refused. Length is counted after trim.
- `PULSE_CONSOLE_ADMIN_TOKEN=replace-with-a-random-token` → refused with the placeholder line, which does not contain the value.
- Token file `"abcdefghijklmnop0123\n"` → accepted (trimmed). Token file `"abcdefghijklmnop0123\nsecond-line"` → `must hold one line`; neither line is in the output.
- Neither token setting set → the start succeeds and logs `hasAdminToken: false`.

HTTP:

- `POST /` → `405`, `allow: GET, HEAD`, with all four security headers. A wrong implementation lets kit answer `405` on `/readyz` without the headers, or answers `200` for `POST /`.
- `DELETE /readyz` → `405` with `allow: GET, HEAD` (the server's check runs before `handleOps`).
- `HEAD /readyz` → `200`, empty body.
- `GET /nope` → `404` `not found\n` with the security headers; `/metrics` then shows the request under `path="other",code="404"`, and `GET /nope2` adds to the same series (no `path="/nope2"` series).
- `GET /?x=<script>` → `200`, the body is byte-identical to `GET /` (the query never reaches the page).
- `GET /index.html` → `404`.
- After `SIGTERM`, a `/readyz` that is still served answers `503` and `pulse_up` is `0`; the process exits `0` within 5000 ms.

Statistics: the only statistic is the start time in the PR (median of 5 values, defined in Performance impact). `pulse_console_http_requests_total` is a plain counter, incremented once per finished response.

## Contract fields

New names, all outside pulse-contract (no wire shape changes):

| Name | Kind | Search (all 0 matches) |
| --- | --- | --- |
| `PULSE_CONSOLE_PORT` | env setting and Compose variable | `grep -rn 'PULSE_CONSOLE_PORT' .repos/contract/src` → 0; `grep -rn --exclude-dir=node_modules 'PULSE_CONSOLE_PORT' .repos/config` → 0; `.repos/kit/src` → 0; api `compose.yaml compose.e2e.yaml .env.example scripts src` → 0 |
| `PULSE_CONSOLE_HOST` | env setting | same four searches → 0 |
| `PULSE_CONSOLE_ADMIN_TOKEN`, `PULSE_CONSOLE_ADMIN_TOKEN_FILE` | env settings | `grep -rn 'PULSE_CONSOLE_ADMIN_TOKEN'` in the same four places → 0 |
| `pulse_console_http_requests_total` | metric | `grep -rn 'pulse_console_'` in the same four places → 0 |
| `console` | Compose service | `grep -n '^  console:' .repos/api/compose.yaml .repos/api/compose.e2e.yaml` → 0 |
| `pulse-console:local` | Compose image tag | `grep -rn 'pulse-console:local'` in the same four places → 0 |
| port `8082` | default port | `grep -rln 8082 .repos` → 0 |

Existing names reused with the same meaning: `PULSE_API_URL` (probe, status, notify), `PULSE_LOG_LEVEL` (kit), `pulse_up` (status), `/healthz`, `/readyz`, `/metrics` (kit).

## Repository: console

Files:
- `package.json` (new)
- `bun.lock` (new, generated by `bun install`)
- `biome.json` (new)
- `eslint.config.js` (new)
- `tsconfig.json` (new)
- `lefthook.yml` (new)
- `bunfig.toml` (new)
- `.gitignore` (new)
- `.dockerignore` (new)
- `Dockerfile` (new)
- `.github/workflows/ci.yml` (new)
- `AGENTS.md` (new)
- `CLAUDE.md` (new)
- `README.md` (changed)
- `docs/index.md` (new)
- `docs/configuration.md` (new)
- `docs/development.md` (new)
- `src/main.ts` (new)
- `src/settings.ts` (new)
- `src/admin-token.ts` (new)
- `src/server.ts` (new)
- `src/page.ts` (new)
- `src/metrics.ts` (new)
- `src/settings.test.ts` (new)
- `src/admin-token.test.ts` (new)
- `src/server.test.ts` (new)
- `src/main.startup.test.ts` (new)

Behavior change: yes. A new service, its tooling, CI and container; the repository holds only `README.md` and `LICENSE` today.

### Toolchain (copy from status, with these differences)

Each fact is read in status at `3f80bda` and, where status points to pulse-config, in pulse-config at the pinned `51e95b0` (read with `gh api`). The pinned `check.yml`, `biome.json`, `lefthook.yml`, `tsconfig.base.json` and `eslint.config.js` are byte-identical to the config clone at `01a57a7`; only config's own `package.json` differs (its `@types/node` and `typescript7` ranges), which a consumer does not read.

- `package.json`: like status `package.json:1-39`: `"type": "module"`, `"private": true`, `"license": "MIT"`, `"engines": { "bun": "1.4.0" }` (status `:8-10`), `"packageManager": "bun@1.4.0"` (status `:38`). Scripts like status `:11-20` without `check:a11y` and without the `-p e2e` typecheck: `start` = `bun src/main.ts`, `typecheck` = `bun node_modules/typescript7/bin/tsc --noEmit`, `test` = `bun test`, `lint` = `biome check . && pulse-eslint .`, `format` = `biome check --write .`, `prepare` = `lefthook install || true`, `check` = `bun run lint && bun run typecheck && bun run test`. `pulse-eslint` is the bin of pulse-config (pinned config `package.json:11-13`).
- Dev dependencies, exact pins as status `:21-30` without playwright and axe: `@biomejs/biome` `2.6.3`, `@lorenzh/pulse-config` `github:lorenzh/pulse-config#51e95b0eb463b27a196a33b428607bd92443e4f0`, `@types/bun` `1.4.0`, `@types/node` `26.6.6`, `lefthook` `2.2.2`, `typescript7` `npm:typescript@7.0.2`. All are in `docs/approved-packages.md` (lines 18 and 32-35).
- Dependencies: only `@lorenzh/pulse-kit` `github:lorenzh/pulse-kit#fa79ba8cd93949fc0cf87f7b41bdaf261dbe4dc6` (status `:35`).
- `biome.json`: `{ "extends": ["@lorenzh/pulse-config/biome.json"] }` (status `biome.json:1-3`). The pinned config `biome.json:8-17` includes `**` and ignores `dist`, `node_modules`, `bun.lock`, `*.html` and `test/fixtures`, with VCS ignore on (`:3-7`). The page is a TypeScript template string, so Biome lints it.
- `eslint.config.js`: status `eslint.config.js:1-4` verbatim (ignores `.repos/**`, spreads the base).
- `tsconfig.json`: extends `@lorenzh/pulse-config/tsconfig.base.json` (status `tsconfig.json:2`), `include: ["src"]`.
- `lefthook.yml`: extends `node_modules/@lorenzh/pulse-config/lefthook.yml` (status `lefthook.yml:1-2`); the pinned config `lefthook.yml:1-8` runs Biome and pulse-eslint on staged files.
- `bunfig.toml`: status `bunfig.toml:1-4` verbatim: `coverage = true`, `coverageThreshold = { lines = 0.8, functions = 0 }`, the same ignore patterns.
- `.gitignore`: `node_modules/` (status `.gitignore:1`). `.dockerignore`: status's list (`.dockerignore:1-20`).
- `.github/workflows/ci.yml`: like status `ci.yml:1-42` (the `check` and `docker` jobs), without the `a11y` job (`ci.yml:44-61`). `check` job: `uses: lorenzh/pulse-config/.github/workflows/check.yml@51e95b0eb463b27a196a33b428607bd92443e4f0` (status `ci.yml:17`). The pinned `check.yml:19-38` runs checkout, setup-bun with `bun-version: 1.4.0`, `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck`, `bun run test` (coverage comes from `bunfig.toml`); its `build` input stays off (`check.yml:6-9`, default `false`). It requires no bench, so the console has no `bench/` and no `bench-selftest` job. `docker` job: see below.
- `AGENTS.md`: adapted from status `AGENTS.md` (same sections and rules; project line says console; no a11y and e2e sections unless they apply). `CLAUDE.md`: status `CLAUDE.md` verbatim (imports `@AGENTS.md`).

### Dockerfile

Like status `Dockerfile:1-18`:

- Both stages `FROM oven/bun:1.4.0-alpine@sha256:07235578f79ef8c6f97d94aee7938e76f5cdba5f21ae5dbfdd3d3d38058437eb` (status `:1,7`).
- Build stage: `apk add --no-cache git` (the `github:` dependency), `COPY package.json bun.lock ./`, `bun install --frozen-lockfile --production --ignore-scripts` (status `:2-5`).
- Runtime stage: `ENV NODE_ENV=production PULSE_CONSOLE_HOST=0.0.0.0`, copy `node_modules`, `package.json`, `src`; no `public/` (there is none). `USER bun`, `EXPOSE 8082`.
- `HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["bun", "-e", "fetch('http://127.0.0.1:' + (process.env.PULSE_CONSOLE_PORT || 8082) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]` (status `:16-17` with the console's port setting).
- `CMD ["bun", "src/main.ts"]`.

### CI `docker` job

Steps, with `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1` and `persist-credentials: false` (status `ci.yml:24-26`):

1. `docker build --tag pulse-console:local .`
2. No test files in the image (status `ci.yml:29-36`), and these dev-only paths absent: `/app/node_modules/@biomejs`, `/app/node_modules/lefthook`, `/app/node_modules/typescript7`, `/app/bunfig.toml`.
3. Run: `docker run -d --name console -p 127.0.0.1:8082:8082 -e PULSE_API_URL=http://api.invalid:3000 -e PULSE_CONSOLE_ADMIN_TOKEN=console-ci-sentinel-token-0123 pulse-console:local`. Poll `http://127.0.0.1:8082/readyz` until it answers `200` (at most 30 s, else fail and print `docker logs console`).
4. Non-root: `docker exec console id -u` is not `0`.
5. `curl -fsS http://127.0.0.1:8082/` contains the literal `pulse Console`; `curl -sI http://127.0.0.1:8082/` contains `x-frame-options: DENY` (case-insensitive).
6. `docker logs console 2>&1` and the page body do not contain the literal `console-ci-sentinel-token-0123`.
7. `docker stop -t 10 console`, then `docker inspect -f '{{.State.ExitCode}}' console` is `0`.
8. Bad setting: `docker run --rm pulse-console:local` (no `PULSE_API_URL`) exits with code `2` and its stderr contains `PULSE_API_URL must be set`.

The expected values are literals in the job (status codes, exit codes, `pulse Console`, the sentinel), not read from the image.

### Tests (TDD; write them first and keep the red output)

- `src/main.startup.test.ts` spawns `bun src/main.ts` like status `src/main.startup.test.ts:15` with `PULSE_CONSOLE_PORT=0`:
  - no `PULSE_API_URL` → exit `2`, stderr is exactly one line `pulse-console: PULSE_API_URL must be set`;
  - `PULSE_API_URL=not-a-url-secret` → exit `2`, one line with kit's text, stderr does not contain `not-a-url-secret`;
  - `PULSE_API_URL=http://api.invalid:3000` and `PULSE_CONSOLE_ADMIN_TOKEN=<16+ char sentinel>` → the process listens, logs `pulse-console listening`, the log does not contain the sentinel; `SIGTERM` → exit `0`.
  On the empty repository this file fails (there is no `src/main.ts`): the PR shows that red run and the green run.
- `src/settings.test.ts` and `src/admin-token.test.ts`: every counterexample of the settings list above, with a fake `readFile`.
- `src/server.test.ts`: a server on `127.0.0.1` port `0`, closed after each test: `GET /` (status, content type, `cache-control: no-store`, `<title>pulse Console</title>`, `<h1>pulse Console</h1>`, `lang="en"`), `HEAD /`, the four headers on `/`, `/readyz`, a `404` and a `405`; `405` with `allow`; `/healthz`, `/readyz` before and after shutdown starts; `/metrics` contains `pulse_up 1` and `pulse_console_http_requests_total{path="other",code="404"}` after a `GET /nope`; the query does not change the page.
- Coverage at least 80 % lines (`bunfig.toml`).

### Docs

- `README.md`: replace the one line with what works now (one page, ops routes; management comes in later items of #460), run locally (`bun install --frozen-lockfile`, `PULSE_API_URL=http://localhost:3000 bun start`, open <http://127.0.0.1:8082>), run with Docker, a short settings table that links `docs/configuration.md`, the licence.
- `docs/index.md`: like status `docs/index.md`, listing the pages.
- `docs/configuration.md`: every setting of the table above with default, rule and the exact error text; that `PULSE_CONSOLE_PORT` is also the Compose host-port variable in pulse-api and that the container port stays `8082` there; that the admin token is optional now, how `_FILE` works, and that the value is never logged; the image defaults (`PULSE_CONSOLE_HOST=0.0.0.0`); the ops routes and their answers; the security headers.
- `docs/development.md`: commands (the `AGENTS.md` table), layout, tests, CI jobs (`check`, `docker` and what each step proves).

### Completion evidence (in the PR)

- `bun install --frozen-lockfile && bun run lint && bun run typecheck && bun run test` output, all passing; CI `check` and `docker` green.
- The red output of `src/main.startup.test.ts` before `src/main.ts` existed, and the green output after.
- Image size, idle RSS and start time measured as in Performance impact.
- The list of repository settings for a person (Non-goals).

## Repository: api

Files:
- `compose.yaml`
- `.env.example`
- `.github/workflows/ci.yml`
- `scripts/compose-e2e.sh`
- `README.md`
- `docs/install.md`
- `docs/configuration.md`
- `docs/development.md`

Behavior change: yes. The Compose stack gets a fifth service, and CI and the e2e script check it.

Tool facts used here, from api at `6e238de`: the `docker` job runs `cp .env.example .env && docker compose config --quiet` and a status port override with `grep 'published: "8090"'` (`.github/workflows/ci.yml:39,44-46`); `compose-e2e` runs `bash scripts/compose-e2e.sh` (`ci.yml:55`); the script needs `docker curl jq openssl` (`scripts/compose-e2e.sh:279`).

### `compose.yaml`

Add after `notify` (before the demo profile comment, `compose.yaml:68`):

```yaml
  console:
    build: https://github.com/lorenzh/pulse-console.git#main
    image: pulse-console:local
    environment:
      PULSE_API_URL: http://api:3000
    ports:
      # Admin UI: loopback only, like the api.
      - "127.0.0.1:${PULSE_CONSOLE_PORT:-8082}:8082"
    healthcheck:
      interval: 5s
    depends_on:
      api:
        condition: service_healthy
```

No admin token is set (Decision 6). Not in the demo profile. `compose.e2e.yaml` does not change.

### `.env.example`

Add `# PULSE_CONSOLE_PORT=8082` under the host-port lines (`.env.example:6-8`).

### CI `docker` job

Add a step "Console port override": `PULSE_CONSOLE_PORT=8092 docker compose config --format json | jq -e '.services.console.ports[0].published == "8092" and .services.console.ports[0].host_ip == "127.0.0.1" and .services.console.ports[0].target == 8082'`. The expected values are literals.

### `scripts/compose-e2e.sh`

- `console_port=$(env_value PULSE_CONSOLE_PORT 8082)` next to `status_port` (`:298`).
- Expected regular services (`:301`): `"api console notify probe status"`; expected demo list (`:305`): `"api console demo-api demo-init demo-probe-a demo-probe-b demo-status demo-targets demo-tls notify probe status"`; the ok line (`:308`) names api, console, notify, probe and status. Both stay hard-coded (comment `:304`).
- Add `console` to every per-service loop: running (`:320`), healthy (`:332`), healthy after up (`:654`), clean stop (`:660` and `:661`), so it must exit `0` on `docker stop`.
- After the api `/readyz` wait (`:335`): `wait_for "$T_UP" "GET /readyz on the console answers ok" console_readyz_ok`, where `console_readyz_ok` checks `curl -fsS --max-time 5 http://127.0.0.1:${console_port}/readyz` is `ok`; then check that `GET /` on the console contains `pulse Console` and its headers carry `x-frame-options: DENY`.

### Docs

- `README.md:32` and `docs/install.md:33`: the stack is api, one probe, status, notify and console; the probe, status, notify and console images build from `main` of their repositories; the console is on <http://127.0.0.1:8082> (loopback only) and has nothing to manage yet.
- `docs/configuration.md` Compose variables (`:257-266`): a row `PULSE_CONSOLE_PORT` | `8082` | Host port of the console. Bound to 127.0.0.1. Update the sentence about the commented port lines (three lines now).
- `docs/development.md:60-61`: the `docker` job also checks the console port override; `compose-e2e` proves that the five services start, become healthy, stay up and exit `0` on `docker stop`, that the console's `/readyz` answers `ok` and its page holds "pulse Console"; it builds probe, status, notify and console from `main`.

### Completion evidence (in the PR)

- CI `docker` and `compose-e2e` green, with the console steps in the log (`ok: console is healthy`, the console `/readyz` line).
- The `compose-e2e` job duration of the last green `main` run and of the PR run.
- A red run of the changed list check: before the `compose.yaml` change, the new expected list fails with `the regular stack has the services: api notify probe status`.

## Meta changes (this spec PR, no child issue)

Files:
- `README.md`
- `docs/architecture.md`
- `docs/approved-packages.md`

Behavior change: no. Docs only.

- `README.md`: the console row of the repositories table (what works, depends on pulse-kit and pulse-config (dev)); the Compose section (five services, the console URL on loopback, `PULSE_CONSOLE_PORT`, health line); the Bun section (optional console start); the settings intro and table (console rows, `PULSE_API_URL` required); the Compose variables line; the health table (console row).
- `docs/architecture.md`: five services; the console row; pulse-kit "used by" adds console; the Bun/Docker paragraph says five services.
- `docs/approved-packages.md`: `@types/bun` row adds console; `oven/bun` row adds console.

## Acceptance evidence

1. pulse-console PR: `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck`, `bun run test` pass locally and in CI (`check` job via the shared `check.yml@51e95b0…`).
2. pulse-console PR: the `docker` job is green; its steps assert the literals `id -u` ≠ `0`, `/readyz` `200`, page `200` with `pulse Console`, `x-frame-options: DENY`, exit code `0` on `docker stop`, exit code `2` with `PULSE_API_URL must be set`, and the sentinel token absent from logs and page.
3. pulse-console PR: the red output of `src/main.startup.test.ts` on the repository without `src/main.ts` (the missing and invalid `PULSE_API_URL` tests fail), then the green output.
4. pulse-api PR (after the console merge): `compose-e2e` green, with the hard-coded list `api console notify probe status` and the console `/readyz` and page checks; `docker` green with the console port override (`8092`, `127.0.0.1`, target `8082`, literals).
5. pulse-console PR: image size, idle RSS, start time (median of 5) reported.
6. The meta README, `docs/architecture.md` and `docs/approved-packages.md` (this PR), the api docs and the console docs list the Console as the fifth service.
