# Issue review: #545 api quality audit follow-up

Target: `api` only. Inspected pulse-api `main` at `c00a375`. The audit examined `6e238de`, which this clone doesn't contain. Most line numbers still match. The `docs/operation.md` claim has moved from `:224` to `:235`.

No question blocks the spec. Each finding is confirmed on current `main`:

| # | Finding | State on `c00a375` |
|---|---------|--------------------|
| 1 | Reload apply failure | `src/config-reload.ts:107-108` sets `lastKey` in `load` before reading and applying. `:99-100` logs only `err.name` and counts `invalid`. `onApply` (`src/start.ts`) calls `service.upsertChecks` and then `holder.set`. There is no `config-reload.test.ts`. Reload tests live in `src/config-admin.test.ts` (`config reload rejected`). |
| 2 | Background failure level | `startRetention`, `startLatencyRollup` and `startUptimeRollup` get `log: (line) => logger.info(line)` (`src/start.ts:205`, `:322`, `:331`). Each one uses the same `log` for success and failure lines (`retention.ts:98/100`, `latency-rollup.ts:68-85`, `uptime-rollup.ts:69-86`). `docs/operation.md:208` documents `retention failed` as `(info)`. |
| 3 | Router complexity | `src/server.ts:526` has `eslint-disable-next-line sonarjs/cognitive-complexity` on `handle` (`:527`). This is the only cognitive-complexity disable in `src/`. |
| 4 | Bound tests | `src/server.validation.test.ts:8-13` imports `MAX_ATTEMPTS`, `MAX_CERT_DAYS`, `MAX_FUTURE_SKEW_MS`, `MAX_LATENCY_MS`, `MAX_REASON_LENGTH` and `MAX_RESULT_AGE_MS` from `server.ts`. That test is their only user outside `server.ts`. `MAX_CERT_DAYS` is already pinned with `assert.equal(MAX_CERT_DAYS, 3_000_000)`. |
| 5 | 405 without `Allow` | `server.ts:564` (`/results`), `:605` (all read routes after `/results`), `:269` (`/heartbeat/:id`), `admin-routes.ts:242` (unsupported method on `/admin/{checks,components,maintenance}[/:id]`) and `:269` (defensive, unreachable). `/healthz`, `/readyz`, `/metrics`, `/manual-incidents*`, `/admin/config` and the create/item mismatch on admin already send `Allow`. `docs/operation.md:235` says "like every other API route". `docs/rest-api.md:28` says the header is sent only on the ops paths. |

## Open points (decide in the spec, not blocking)

1. **What the reload remembers.** If `lastKey` were set only after a successful apply, an *invalid* file would be read, parsed and logged again at every poll. That breaks the documented rule "The same bad file is not logged again at every look" (`docs/operation.md:161`). The spec must say which outcomes record the stamp.
2. **Logging repeated apply failures.** With retry on every look (default 5 s, minimum 1 s), a lasting SQLite failure gives one `warn` line per poll. The spec should either accept that (like heartbeat and config poll failures, which log on every run) or log once until the next success. Either way the metric counts every failed attempt.
3. **Metric label.** `CONFIG_RELOAD_RESULTS` is `["ok", "invalid"]`. The new value needs a name, and `docs/operation.md:161` needs to describe it. `pulse_api_config_writes_total` already uses `error` for a failure that isn't the caller's fault. No other repository (deploy, website) refers to `pulse_api_config_reload_total`.
4. **Message with no secrets.** The issue asks for the message and forbids secrets. `upsertChecks` errors come from bun:sqlite, whose messages name constraints and columns, not bound values. A `holder.set` failure is a programming error. The spec should name a rule, for example: use `err.message` only from an `Error`, cut to a fixed length with newlines removed, and a test that the line holds no header value or heartbeat secret from the file.
5. **Read failures.** "cannot read the file" (`config-reload.ts:113`) is also counted `invalid`, and since `lastKey` is set first it isn't retried while the stamp stays the same. The issue covers only the apply step. The spec should state whether read failures stay as they are.
6. **SIGHUP and `adopt`.** `reloadNow` already re-applies regardless of stamp. `adopt` (admin writes) sets `lastKey` after its own apply and needs no change. The spec should keep both.
7. **Splitting the log dependency.** Level is chosen per line, not per runner: success lines (`retention: deleted N results`, rollup backfill/stored lines) stay `info`, and only the `... failed: <message>` lines become `warn`. So the three runners need separate info and warn sinks, not a changed `log` wiring in `start.ts`. The issue names retention and the latency rollup. The uptime rollup has the same defect (`start.ts:331`, `uptime-rollup.ts:86`) and is in scope under "retention and rollup failures". Update `docs/operation.md:208`, plus `:58` and `:67` where they name the line.
8. **Acceptance check for the complexity finding.** This is a lint result, not a `bun test` case. Check: with the disable comment removed, `bun run lint` passes. Equivalently, `bunx eslint --no-inline-config src/server.ts` reports no `sonarjs/cognitive-complexity` error. On current `main` the second command fails at `handle`. The spec may also add a guard test that `src/` has no `sonarjs/cognitive-complexity` disable. That is optional; the lint run is the check.
9. **Exports after the bound-test change.** Once the test uses literals, `MAX_*` in `server.ts` has no other importer. `AGENTS.md` says "Do not export a function only for a test", so the spec should un-export them unless something else needs them. The issue lists reason, attempts and latencyMs. The timestamp bounds (`60000`, 7 days) are also documented (`docs/rest-api.md:43`) and use the same pattern, so they move to literals too.
10. **Exact `Allow` values.**
    - `/results`: `POST`.
    - All GET read routes (`/checks`, `/probe/checks`, `/uptime`, `/latency`, `/components`, `/components/uptime`, `/incidents`, `/locations`, `/maintenance`, `/checks/:id/results`, `/checks/:id/latency`): `GET`.
    - `/heartbeat/:id[/:secret]`: `GET, POST`.
    - Admin list path: `POST`. Admin item path: `PUT, DELETE`. This matches the existing mismatch branch.
    - `HEAD` is not supported anywhere, so `Allow` must not list it.

    The 405 order stays the same: `/results` and `/probe/checks` answer 405 before auth, admin answers after auth, and the heartbeat 405 comes before the secret check, so it reveals nothing about ids. Update `docs/rest-api.md:28`, `docs/operation.md:235` and `docs/troubleshooting.md:113` if needed.
11. **Router split.** "No route changes behavior" covers status order, error messages, headers and the `route` label in the request metric. The existing route tests are the safety net and must stay unchanged.
12. **Concurrent work.** pulse-api PR #68 (meta #526) is open and changes `docs/operation.md`, `docs/rest-api.md` and `src/service.ts`. It doesn't touch `server.ts`, `config-reload.ts`, `start.ts` or the runners. A docs merge conflict is possible but doesn't block.

## Assumptions

- Single target `api`. No contract, probe, status or deploy change. `/heartbeat` and `/results` keep their wire behavior apart from the added header.
- The reload records the stamp after a successful apply and after a content or read rejection (unchanged). A failed apply doesn't record the stamp or the revision, so the next poll retries the same bytes.
- New metric value `pulse_api_config_reload_total{result="error"}` for a failed apply. `invalid` keeps meaning invalid or unreadable file.
- The apply-failure line is `config reload failed: <path>: cannot apply the configuration: <message>` at `warn`, logged on each failed attempt. The message is the error message, one line, length-capped, never a value from the file. The spec may pick the exact wording.
- Retention, latency rollup and uptime rollup failure lines become `warn`. Their success lines stay `info`.
- The `MAX_*` validation constants in `server.ts` become module-private.

## Derived acceptance check

On pulse-api, with these tests added, every one fails on `c00a375` and passes after the change:

1. **Reload retry.** A reloader whose `onApply` throws once on a changed file logs one `warn` line with the error message and counts `result="error"`, not `invalid`. On the next `poll()`, with the stamp unchanged, it applies the file, counts `ok` and changes `revision()`.
2. **Warn on failure.** With a retention service whose delete throws (and likewise for the latency and uptime rollups), the failure line goes to the warn sink. A logger at `PULSE_LOG_LEVEL=warn` still prints `retention failed: ...`.
3. **Router complexity.** The disable comment at `server.ts:526` is gone and `bun run lint` passes. `eslint --no-inline-config src/server.ts` reports no cognitive-complexity error.
4. **Literal bounds.** `server.validation.test.ts` uses literals `1000`, `100`, `86400000`, `60000`, `604800000` and `3000000`. Raising any `MAX_*` in `server.ts` makes a test fail.
5. **`Allow` on every 405.** One HTTP test sends a wrong method to every route family above and asserts status 405, body `{"error":"method not allowed"}` and the expected `Allow` value.

Also: all existing tests pass without edits (except the bound-test file in item 4). `docs/operation.md` and `docs/rest-api.md` match the new behavior. CI `check`, `compose-e2e` and `bench-selftest` are green, and the bench stays within `bench/budgets.json`.
