# Spec: Probe tokens for result ingest (#107)

## Goal
Only known probes can report results. `POST /results` on pulse-api requires a probe token in `Authorization: Bearer <token>`; the token fixes the probe's location. pulse-probe reads its token from the environment and sends it with every result.

## Scope
- `api`: token config, authentication and location binding on `POST /results`, startup validation, tests, README.
- `probe`: `PULSE_PROBE_TOKEN`, startup failure without it, `Authorization` header on `POST /results`, distinct log for a rejection, tests, README.

## Non-goals
- No user accounts, OAuth, external service, TLS, rate limiting or hot reload of tokens.
- No contract change: the token is an HTTP header, not part of the data model. `status` and `notify` stay unchanged.
- Read routes (`GET /checks`, `/incidents`, `/uptime`, `/maintenance`, `/checks/:id/results`) stay public.
- `service.ingest` stays unauthenticated at the unit level.

## Decisions (defaults from the issue review)
- **Token source:** one mechanism, a separate JSON file whose path is in `PULSE_TOKENS_FILE` (default `./tokens.json`), kept out of git. Not `checks.json`, which is shared. Format: `{"tokens": [{"location": "east", "token": "<secret>"}]}`.
- **Several tokens per location are allowed** (at least one entry overall) so a token can be rotated with an overlap. This widens "one per location" in the issue.
- **API without a valid token config** (missing file, no entries, invalid entry) exits at startup with a clear message. Insecure ingest by default is the problem this feature fixes.
- **Load validation:** non-empty location, at most 64 characters after trim; token at least 16 characters; no duplicate token (ambiguous between locations, also within one location). Error messages name the entry index or location, never the token.
- **Status codes:** missing, malformed or unknown token: 401, `WWW-Authenticate: Bearer`, body `{"error":"unauthorized"}`, the same for all cases. Valid token but body `location` differs from the token's location: 403 `{"error":"location does not match token"}`. Nothing is stored in either case.
- **Location binding:** if body `location` is omitted, the result is stored under the token's location (not `default`). If present, it is compared after the same trim as `validateResult`.
- **Order:** method check (405), then authentication, then body read (size limit still applies), JSON parse, validation (400), location check (403), ingest (404 for unknown check). 401 beats 400/404, so unauthenticated callers learn nothing about checks.

## Required behavior
1. `POST /results` without a valid token answers 401 and stores nothing; the response and all logs never contain the submitted or a configured token.
2. `Authorization` parsing is strict: scheme `Bearer` (case-insensitive), one space, non-empty token. Anything else is 401.
3. Token comparison is constant time: SHA-256 both sides, `crypto.timingSafeEqual`, check all configured tokens without early exit.
4. A valid token with a matching or omitted location answers 204 and stores the result under the token's location.
5. A probe without `PULSE_PROBE_TOKEN` (missing or blank after trim) exits non-zero at startup with a clear message that does not print any value.
6. The probe sends `authorization: Bearer <token>` on `POST /results` only, not on `GET /checks`.
7. A 401 or 403 reply to a result post is logged as "token rejected, check PULSE_PROBE_TOKEN and PULSE_LOCATION"; the probe keeps running and drops the result as before.

## Risks
- Deploying the API with tokens before probes have them stops all ingestion. READMEs say: give probes their tokens first (an old API ignores the header), then enable tokens on the API.
- Omitted-location results used to land under `default`; now they land under the token's location. Documented.
- Bearer tokens travel in clear over plain HTTP: README says to run the API behind TLS or on a private network.
- A probe's `PULSE_LOCATION` must equal its token's location (unset means `default`), otherwise every result gets 403.
- Meta `README.md` local-run walkthrough and settings table do not mention tokens. Not changed by this spec; a person should update it after both PRs merge (`PULSE_TOKENS_FILE` for pulse-api, `PULSE_PROBE_TOKEN` for pulse-probe, and a tokens file in the walkthrough).

## Acceptance evidence
With the API configured with `east` → token A and `west` → token B, and a check `c1`:
1. No `Authorization` → 401, nothing stored.
2. `Bearer wrong`, malformed header, empty token → 401, nothing stored, no token in response or logs.
3. Token A with `location: "west"` → 403, nothing stored.
4. Token A with `location: "east"` or no location → 204, stored as `east`.
5. All read routes work without a token.
6. API with missing, empty or invalid tokens file exits at startup without printing token values.
7. Probe without `PULSE_PROBE_TOKEN` exits at startup; with it, every result post carries the header and gets 204.
8. The README rotation walk-through works: add the new token, restart the API, switch the probe, remove the old token, restart.
9. `npm run check` passes in `api` and `probe`.

## Repository: api

Files: new `src/tokens.ts` (pure parse and validate of the tokens file content, and `authenticate(tokens, header)` returning the location or `undefined`; the file read stays in `main.ts` or a small loader like `config.ts`), `src/server.ts`, `src/main.ts`, new `src/tokens.test.ts`, updates to `src/server.test.ts`, `src/degraded.test.ts`, `src/service.maintenance.test.ts`, `src/uptime.test.ts` and any other test that posts through the server, `tokens.example.json` (obvious placeholder values, such as `replace-with-openssl-rand-hex-32`, which must not pass as a real token in docs), `.gitignore` entry for `tokens.json`, `README.md`.

Behavior:
- `createApiServer(service, { tokens })` takes the parsed tokens as a dependency. `main.ts` reads `PULSE_TOKENS_FILE`, validates it and exits with a clear message on failure; it logs the number of tokens and locations, never values.
- Implement the decisions and required behavior 1 to 4 above. Reuse the existing `HttpError` and `ErrorResponse` path; add the `WWW-Authenticate` header on 401.
- Existing tests: update fixtures only (pass a token and send the header, or use a shared test helper); assertions are not weakened.
- New tests, through HTTP on `127.0.0.1` port `0`: missing token, wrong token, malformed header and empty token, token for another location (403), valid token with matching location and with omitted location (stored under the token's location), unauthenticated read routes, 401 beating 400 and 404, no token in response or captured logs, stored nothing on rejection (results list empty, state unchanged). Unit tests for token file validation (empty, short, duplicate token, bad location, no entries) and for strict header parsing.
- README: settings table row for `PULSE_TOKENS_FILE`, file format, creating a token (`openssl rand -hex 32`), rotation steps (add new token, restart, switch the probe, remove old token, restart; restart needed because tokens load at startup), 401 and 403 semantics, location rule, rollout order, TLS note.

Completion evidence: `npm run check` passes (coverage and complexity limits intact); the new tests above exist and pass.

## Repository: probe

Files: `src/client.ts`, `src/main.ts`, new small module for reading the token if useful (for example `src/token.ts` with a pure `parseToken(env)` like `location.ts`) and its test, `src/client.test.ts`, `README.md`.

Behavior:
- `main.ts` reads `PULSE_PROBE_TOKEN`, trims it, and exits non-zero with a clear message (naming the variable only) if it is missing or empty, before any network call.
- `postResult` takes the token as a dependency and sends `authorization: Bearer <token>` with `content-type`. `fetchChecks` sends no `Authorization`.
- On HTTP 401 or 403 from `POST /results`, log "token rejected, check PULSE_PROBE_TOKEN and PULSE_LOCATION" instead of the generic message; do not exit, and never log the token.
- Tests: header present on result posts with the configured token, absent on `GET /checks`, rejection log distinct and free of the token, parsing of missing, blank and valid token values.
- README: `PULSE_PROBE_TOKEN` in the settings table, how to create it (`openssl rand -hex 32`) and where the API owner enters it, startup failure without it, location must match the token's location, rotation from the probe side (switch the variable after the API knows the new token, restart the probe).

Completion evidence: `npm run check` passes; tests for header, startup failure parsing and rejection log pass.
