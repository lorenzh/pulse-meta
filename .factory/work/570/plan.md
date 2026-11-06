# Spec #570: status and notify settings editable from the console

Issue: [#570](https://github.com/lorenzh/pulse-meta/issues/570). Issue review:
`.factory/work/570/issue-review.md`.

## Goal

The console edits the status page settings and the notify channels. The edits are stored in the
pulse-api database. The status and notify services poll them over HTTP and apply them without a
restart. A value set in the service's own file or environment wins and is shown read-only, with
its origin. Channel secrets stay env or file references and are resolved only by notify. An Owner
can also resend a failed notify delivery from the console: notify takes the resend from the api
and sends it in the running process.

## Sources and decisions this spec applies

- Issue #570 and its comments. The comments are Factory run notes. The issue review needs no owner
  decision. The plan-review of the first spec asked for eight corrections; this version makes all
  of them:
  1. the status browser poller keeps validating results after `latencyMs` is withheld
     (Decision 9, status section);
  2. write semantics per route, with reports outside the configuration revisions (Decision 16,
     R2);
  3. a resend state machine with idempotent result acknowledgements, recovery after a lost answer,
     and admission when the queue is full (Decision 14);
  4. aggregate size limits for channels and reports, with boundary tests (Decision 12, R1);
  5. an executable A/B measurement with the remote loops on, and the contract budgets
     (Performance impact, api section);
  6. complete wire shapes, `NotifyServiceState` included, and a search for every new name
     (R1, Contract fields);
  7. pin-specific tool citations in every section, and the explicit deploy CI wiring;
  8. file lists that mark every new file, with notify's tests in `test/`.
- #460, decision 7, and its amendment of 2 November (sections 2, 13, 19, 20), as quoted in the
  issue review. It is the authority on these points:
  - the console never writes service files;
  - settings live in the pulse-api database;
  - service file and environment values win and are shown read-only with their origin;
  - notify precedence is by whole channel id, and a shadowed database copy is kept and shown;
  - secrets are env or file references, never values typed into the console.
- #255 and `.factory/work/255/plan.md`: the history of the offline `failed` CLI. The current
  notify code is the authority for behavior.
- Shared findings: `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/570` answered
  `HTTP 404` in this run, so there are no findings yet. That is normal for a feature with no
  children.
- Clone heads read for this spec:

  | Target | Head |
  | --- | --- |
  | api | `4b3e9b1` |
  | status | `8b6d431` |
  | notify | `c79f0b7` |
  | console | `fc2c166` |
  | contract | `ebf6bbc` (version `2.3.0`) |
  | deploy | `e754d46` |
  | kit | `536133f` |
  | config | `bc87049` |

- Pinned shared config, read with `gh api "repos/lorenzh/pulse-config/contents/<path>?ref=<sha>"`
  in this run:
  - `.github/workflows/check.yml` and `biome.json` at `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`
    (api, status, notify, console, deploy) and at `51e95b0eb463b27a196a33b428607bd92443e4f0`
    (contract). Both files are byte-identical to the config clone at `bc87049` (`diff -q`).
  - `check.yml` at both pins: install `bun install --frozen-lockfile` (`:25-26`), `bun run lint`
    (`:27-28`), `bun run typecheck` (`:29-30`), `bun run build` and `git diff --exit-code -- dist`
    only with the input `build: true` (`:31-36`), `bun run test` (`:37-38`). Bun `1.4.0`
    (`:22-24`).
  - `biome.json` at both pins: `vcs.useIgnoreFile: true` (`:3-7`); `files.includes` is `**`
    without `**/dist`, `**/node_modules`, `**/bun.lock`, `**/*.html` and `**/test/fixtures`
    (`:8-18`); formatter line width 100 (`:23`); `noNonNullAssertion` and `noExplicitAny` are
    errors (`:45-50`), with `noNonNullAssertion` off in `**/*.test.ts` and `**/test/**`
    (`:53-63`).
  - kit `src/settings.ts` at the status and notify pin `236df214f9df8658f2992dd6f7c100952c07102b`
    is identical to the kit clone: `readString` trims and returns `undefined` for an empty value
    (`:26-29`).

### Current behavior (verified in the clones)

**api**
- Schema and migrations:
  - The schema is at version 8 (`src/migrations.ts:5-175`; step 8 is `maintenance_definitions`,
    `:163-174`).
  - The steps are append-only (`:1-4`), and `src/db.ts:115-155` applies them on open.
    `src/db.migrations.test.ts:400-410` pins step 8.
- Database checks:
  - They live in `check_definitions` with a `config_state` row (step 6, `migrations.ts:123-141`).
  - File checks win, and a database check with a file id goes to `shadowed`
    (`src/effective-checks.ts:25-52`).
  - The admin revision is `sha256-` over `<file revision>\n<generation>`
    (`src/config-reload.ts:52-58`). The ETag is that revision in quotes
    (`src/admin-routes.ts:107-109`).
  - `If-Match` must be one quoted revision: `400` when it is malformed (`admin-routes.ts:111-120`),
    `428` when it is missing (`:243`), `412` when it is stale.
  - A create of an id the file owns, or a PUT of a shadowed id, is `409` (`src/check-write.ts:176-204`).
  - One transaction holds the edit, the generation bump and the audit row (`check-write.ts:218-247`),
    under the shared promise lock (`src/write-lock.ts:1-16`).
- Admin routes:
  - They match `ADMIN_PATH = /^\/admin\/(config|checks|components|maintenance)(?:\/([^/]+))?$/`
    (`admin-routes.ts:63`). Metric labels come from `ADMIN_ROUTE` in `src/server.ts:205` and
    `routeOf` (`server.ts:224-249`).
  - The body limit is `ADMIN_MAX_BODY_BYTES` (1 MiB, contract `src/admin.ts:24`). No content-type
    check exists.
  - Error bodies are `{"error": string}`. Auth answers `401` with `www-authenticate: Bearer`,
    `403 forbidden`, and `429` with `retry-after` after 10 failures per client in 60 s
    (`src/admin-auth-throttle.ts:11-16`).
  - The status order is contract `ADMIN_STATUS_ORDER` (`src/admin.ts:30-46`): `404` feature off,
    `401`, `403`, `413`, `400`, `428`, `503`, `412`, `422`, `409`, `404` unknown id.
- Permissions (`src/token-scopes.ts:4-32`):
  - `config-write` needs `admin`+`checks`; `token-admin` and `audit-read` need `admin` alone.
  - `canGrant` counts `probe` as `checks` (`:38-40`).
  - A probe token on an admin route gets `403` (`src/admin-auth-failures.ts:19-36`).
- Tokens: the admin tokens file `PULSE_API_ADMIN_TOKENS_FILE` (`src/start.ts:162-166`,
  `src/admin-tokens.ts:8-37`, tokens of at least 32 characters) and the probe tokens file
  `PULSE_TOKENS_FILE` (`start.ts:156-158`). Other tokens are created with `POST /admin/tokens`
  (`src/token-routes.ts:240-254`).
- Audit: an entry's action prefix must equal its target kind (contract `src/audit.ts:6-108`).
- Backup copies the whole database with `VACUUM INTO` (`src/backup.ts:128`), so new tables are
  included.
- Callers: status and notify call only public reads, with no token. `PULSE_API_TOKEN` exists in
  no repository (`grep -rn PULSE_API_TOKEN status/src notify/src probe/src`: none). The probe sends
  `Bearer` to `/probe/checks` and `/results` (probe `src/client.ts:297-310`, `:401-403`).
- Bench (`bench/`):
  - `budgets.json` has gating budgets for api, probe, status, notify, contract (`test_cpu_s` 9.0
    with floor 2, `build_cpu_s` 6.4), kit and config.
  - Ref resolution (`bench/refs.ts:48-71`): the api takes `--a`/`--b`. Every other repository takes
    its newest `v*` tag on A and `main` on B, or, with `--others-ref`, that one ref on both sides
    (`:60-62`). No option sets one repository's B side alone, so `--others-ref <status branch>`
    cannot compare a status branch against status `main`.
  - `bench/compose.bench.yaml`: the api gets only `PULSE_CHECKS_FILE` and `PULSE_TOKENS_FILE`
    (no admin tokens file). Status gets only `PULSE_API_URL`. Notify gets `PULSE_NOTIFY_CONFIG`
    with `bench/fixtures/notify.json`, one `file` channel. No service token exists, so a remote
    settings loop would stay off on both sides.
  - The seed of each side is made by that side's own `src/db.ts`, so a normal run never opens an
    older schema. `bun bench/cold-read.ts --api <B> --seed-with <A>` starts B on a file of A's
    schema: the first start after an upgrade (`bench/README.md:54`).
  - Options of `bench/run.ts`: `--a`, `--b`, `--rounds`, `--others-ref`, `--out` (`run.ts:61-83`).
    `bench:selftest` runs eight `bench/selftest/check-*.ts` scripts (`package.json:18`); CI runs it
    and `docker compose -f bench/compose.bench.yaml config --quiet` (`.github/workflows/ci.yml:20-33`).

**contract**
- Scopes: `TOKEN_SCOPES = ["read","checks","incidents","admin","probe"]` (`src/tokens.ts:5`), a
  strict `z.enum` (`:30-32`). `probe` must be alone (`:51-58`, message `probe must be the only
  scope` at `:57`).
- `tokenMetadataSchema` is a `strictObject` whose scopes are that enum (`:93-127`). A token with an
  unknown scope therefore fails the whole `tokensResponseSchema` (`:131-134`).
- Admin views: `source` is `"file" | "database"` (`src/admin.ts:68-71`), and a sibling `shadowed`
  array holds shadowed entries (`:360-376`).
- `resultSchema` requires `latencyMs` (`src/schema.ts:500-521`, the field at `:509`).
  `latencyObjectiveMs` is optional (`:284`), and `slo` is optional on checks and components
  (`:627`, `:831`).
- `requestJson` is at `src/client.ts:331`, and `DEFAULT_MAX_BODY_BYTES` is 5 MiB (`:7`).
  `WIRE_VERSION = 1` (`src/version.ts:5`).
- Tests live in `test/` (`ls test`: `smoke.test.ts`, `tokens.test.ts`, `audit.test.ts`,
  `types.fixture.ts`, …). `test/smoke.test.ts` checks the runtime export list (`:51-206`) and the
  `dist` freshness of listed modules (`:25-38`).

**status**
- Settings:
  - Every setting is env-only and read once (`src/settings.ts:60-78`): `PULSE_STATUS_NAME`,
    `PULSE_STATUS_LOGO`, `PULSE_STATUS_THEME` (file path), `PULSE_STATUS_HIDE_DETAILS`
    (default `true`) and `PULSE_STATUS_SHOW_CHECKS` (default `false`).
  - Booleans get their default at once, so "set" is not recorded.
- Theme:
  - 20 colour keys, 2 font keys and 3 radius keys (`src/theme-config.ts:6-29`).
  - Colours match `^#(rgb|rrggbb|rrggbbaa)$`; radii match `^\d+(\.\d+)?(px|rem|em)$`; fonts are at
    most 200 safe characters. The name is 1..60 characters (`:40-54`, `:155-160`).
  - Defaults are in `public/theme-default.json`.
- Fixed at start:
  - The theme is loaded once (`src/server.ts:689`), and `/theme.css` is memoized for good
    (`:317-328`).
  - The CSP (`img-src` plus the logo origin) is built once (`:693`).
  - The logo is an https URL or a local file served at `/logo` (`:145-161`).
- Caches:
  - Answer cache key: `"<isHidden><hasChecks>:<path>"` (`src/answer-cache.ts:29-31`).
  - ETag: `etagFor` over the same two flags and the body (`src/http-cache.ts:13-16`).
- Public filter:
  - Result objects keep `RESULT_FIELDS`, `latencyMs` included, because the contract validator
    needs them (`src/api-filter.ts:93-112`).
  - `latencyObjectiveMs`, `slo` and the `/api/latency` days always pass (`api-filter.ts:68-102`,
    `:150`).
  - `showChecks=false` with components empties `/api/checks`, `/api/uptime` and `/api/latency`
    (`src/hidden-checks.ts:117-124`).
- Browser and SSR poller (`src/poller.ts`, served as `/poller.js` by `tsModules`,
  `src/server.ts:177-185`; also run by SSR, `src/ssr.ts:77-94`):
  - `validServedChecks` validates `/api/checks` with `validateChecksResponse` on a copy that
    `withPlaceholders` and `fillLocations` fill. `fillLocations` adds `checkId`, `statusCode`,
    `attempts` and `location` to each result, not `latencyMs` (`poller.ts:104-136`). A result
    without `latencyMs` therefore fails the refresh.
  - `/components/latency` passes when every item has 90 valid days; `[]` passes
    (`poller.ts:146-157`).
- Render: `renderLatency` prints `newest.result.latencyMs` and the objective
  (`src/render.ts:162-176`).
- Components: groups appear in order of their first component (`src/components-view.ts:53-61`).
- Browser: `public/client.js` reads `data-show-checks` once (`:30-32`).
- No latency, SLO or order setting exists.

**notify**
- Config file:
  - `PULSE_NOTIFY_CONFIG` is required (`src/config.ts:397-400`), and the file needs at least one
    channel (`:281-288`).
  - Secrets (`<x>Env`/`<x>File`, exactly one) are resolved once at start (`:65-93`;
    `src/index.ts:167-170`). Nothing reloads.
  - `PULSE_NOTIFY_API_MAX_BYTES` defaults to the contract's 5 MiB (`config.ts:435`,
    `src/api.ts:65`). Retries: 12 attempts, 1000 ms to 60000 ms (`src/delivery.ts:6-8`;
    `PULSE_NOTIFY_RETRY_*`, `config.ts:403-428`).
- Channel types (`src/channel-schema.ts:44-128`):
  - webhook: a literal `url` (http or https), with an optional `secretEnv`/`secretFile`.
  - file: `path`.
  - slack and teams: `urlEnv`/`urlFile`, `statusUrl`, `hideReason`.
  - email: `smtp{host,port,tls,username,passwordEnv|passwordFile,clientName}`, `from`, `to`,
    `subjectPrefix`, `statusUrl`, `hideReason`.
  - Routing: `checks`, `excludeChecks`, `components`, `excludeComponents`, `alerts`,
    `sendIncidents`, `remindEverySeconds`.
  - Ids have no pattern or length rule (`config.ts:264-266`).
- Notifier: the channel list is built once and is `readonly` (`src/notifier.ts:216-250`). A new
  channel is seeded quietly (`:584-664`). Pending entries are enqueued only in `start()` (`:322`).
- Ledger:
  - SQLite format 4 (`src/ledger.ts:31`), migrated from 3 (`:34`). Any other version is refused
    (`:670-690`), so an older notify refuses a newer file.
  - `Ledger.resend` returns `resent`, `not-failed` or `no-payload`. It moves only a failed entry
    with a payload to pending and does not enqueue it (`:960-988`).
- Failed CLI: `failed list|resend` exits `2` while the service holds the lock (`index.ts:349-378`).
- API calls carry no token (`src/api.ts:153`).
- Tests live in `test/`, with the fake API in `test/support.ts` (`AGENTS.md:108`; `ls test`:
  `config.test.ts`, `index.test.ts`, `ledger.test.ts`, `ledger.v4.test.ts`, `notifier.test.ts`,
  `routing-change.test.ts`, `failed-cli.test.ts`, `webhook.test.ts`, `metrics.test.ts`, …).

**console**
- Permissions: `settings.edit` is `owner` and unused (`src/permissions.ts:50`; `docs/team.md:22`).
- Navigation:
  - It has nine `NavId`s (`src/navigation.ts:3-12`); `navigation.test.ts:11-80` pins them.
  - `navIcon` switches over every id (`src/icons.ts:31-32`).
- Writes:
  - They use `requestJson` with `Bearer` and a quoted `if-match`, a 5000 ms timeout and no retry
    (`src/check-write.ts:141-220`).
  - The outcome comes from the metadata alone (`src/check-outcome.ts:12-44`).
  - A `412` keeps the input (`src/check-routes.ts:307-345`).
- Form handling:
  - Order: Origin, content-type, size, repeated fields, CSRF (`src/http-context.ts:166-208`).
  - Form tokens are bound to session and action path, and a replay gives `409`
    (`src/form-tokens.ts:100-110`; `src/server.ts:981-999`).
- People log:
  - `PeopleAction` has no `CHECK` constraint (`src/people-log.ts:4-24`).
  - Target kinds are an exhaustive union (`:34-90`).
- Tokens:
  - The token list is validated strictly (`src/token-read.ts:53-101`).
  - Presets are `read`, `checks`, `incidents` and `full` (`src/token-view.ts:7-12`).
  - `missingScope` maps `probe` to `checks` (`:98-107`).

**deploy**
- No status or notify token exists. `scripts/secrets-init.mjs` writes probe tokens, one admin
  token and the console token.
- `full/compose.yaml:66` and `dev/compose.yaml:69` set `PULSE_STATUS_SHOW_CHECKS: "true"`.
- notify mounts `full/config/notify.json`, which holds one `file` channel. The e2e overlay
  `e2e/compose.e2e.yaml` replaces it with `e2e/notify.json` (three `file` channels).
- CI (`.github/workflows/ci.yml`):
  - `lint` (`:19-67`) runs shellcheck and `bash -n` on every tracked `*.sh` (`:34-37`),
    `node --check` on every `*.mjs` (`:38-39`), `jq empty` on every `*.json` (`:40-41`), and then
    an explicit list of test scripts (`:42-67`). A new `e2e/*.test.sh` runs only when a step is
    added to that list.
  - `full` runs `bash e2e/compose-e2e.sh` on the published images (`:124-126`).
  - `e2e-dev` builds every service from `main` and runs `E2E_SETUP=dev bash e2e/compose-e2e.sh |
    tee e2e-dev.log`, then greps `ok: manual incident privacy` and `ok: console probe locations`
    (`:302-306`).
- `e2e/compose-e2e.sh` runs optional scenarios as steps: the console probe step prints `skip:` on
  published images and calls `e2e/console-probes.sh run` in the dev setup (`:1097-1120`).

## Decisions

These decisions settle the open points of the issue review and the plan-review corrections.

1. **One spec, six repository sections.** contract → api, status, notify, console (in parallel)
   → deploy. Each of api, status, notify and console implements its own side of the HTTP
   interface this spec defines.
2. **Precedence.**
   - Status, per field: environment > status settings file > database > built-in default. An env
     variable counts as set when it is present and non-empty after trim (kit `readString`,
     `settings.ts:26-29`). An env value equal to the default still locks the field.
   - Notify, per whole channel id: a file channel wins and a same-id database channel is shadowed.
     No field is ever merged across the two sources.
3. **Storage and revisions in the api.** New tables in migration step 9:
   - `status_settings`: one row holding the settings JSON.
   - `notify_channels`: id, definition JSON, created and updated times.
   - `service_reports`: one row per service (`status`, `notify`), holding the last report and its
     receive time.
   - `resend_commands`: id, request id, channel id, key, state, created, updated and claimed
     times.
   - `runtime_state`: one row with `status_generation` and `notify_generation`, both starting at 0.

   Each configuration resource has its own revision: `sha256-` + hex SHA-256 of
   `status\n<status_generation>` or `notify\n<notify_generation>`. Only the configuration writes of
   Decision 16 bump a generation. Reports, resend commands, claims and results never do. The
   check/config revision does not change, so check and maintenance writes and these writes never
   make each other stale.
4. **Access.**
   - Console routes `/admin/status/*` and `/admin/notify/*` need the `admin` scope alone. The new
     permission `runtime-admin` follows `token-admin`, so the console token works unchanged.
   - Service routes `/service/status/*` need a token whose only scope is `status`, and
     `/service/notify/*` one whose only scope is `notify`. Both new scopes are sole scopes like
     `probe`, with no location. `canGrant` counts `status` and `notify` as `admin`.
   - A `status` or `notify` token on any `/admin/*` route is `403`. An admin token on `/service/*`
     is `403`. A `status` token on `/service/notify/*` and a `notify` token on `/service/status/*`
     are `403`.
   - Console screens need Owner (`settings.edit`), including the failed list and resend.
5. **Feedback path.** Each service reports what it applied:
   - `PUT /service/<svc>/report` after every apply attempt, and at least every 60 s.
   - The api keeps the last report with its receive time (`receivedAt`, api clock).
   - A report received more than 180 000 ms ago, or none, is `stale` or `never`. The console then
     shows the origin as unknown, and every field stays editable as a database value. The console
     never treats a stale report as "no overrides": the page says that overrides cannot be shown.
6. **Polling.**
   - Status and notify read their settings or channels every 15 s, with `If-None-Match` and
     `304`.
   - Notify reads resend commands every 5 s.
   - The request timeout is 5000 ms. Status and notify read every `/service/*` answer with a
     limit of 1 048 576 bytes (`ADMIN_MAX_BODY_BYTES`), independent of
     `PULSE_NOTIFY_API_MAX_BYTES`.
   - A valid answer becomes active atomically when the poll that read it finishes. A malformed,
     oversized or wire-mismatched answer, or an api outage, keeps the last good snapshot. The
     report then names the rejection, and polling goes on.
7. **Status local file.** A new optional `PULSE_STATUS_SETTINGS_FILE` holds a JSON document of the
   same `StatusSettings` shape as the database.
   - A key that is present is file-origin. An absent key is not set.
   - The existing `PULSE_STATUS_THEME` file keeps working: its present tokens are file-origin.
     When both the theme file and a `theme` key in the settings file are set, start fails with
     exit `2`.
   - Status re-reads the settings file and the theme file at each settings poll. A changed, valid
     file applies live. An invalid or unreadable file keeps the last good values and is reported
     as rejected. The env stays fixed for the life of the process.
8. **Status live apply.**
   - One effective snapshot carries name, logo, theme CSS, CSP, order and the four flags. It has a
     `fingerprint`: the first 16 hex characters of the SHA-256 of its canonical JSON.
   - The fingerprint joins the answer cache key and the `etagFor` input, replacing the two-flag
     prefix.
   - `/theme.css` and the CSP come from the current snapshot.
   - The page carries `data-settings="<fingerprint>"`. The browser poller reads
     `GET /page-settings.json` (`{"fingerprint": "<16 hex>"}`, `cache-control: no-store`) on each
     poll cycle and reloads the page once when the value differs.
   - A raw answer whose read began under an older fingerprint is not stored under the new one.
     Filtering always uses the snapshot current at write time.
9. **Status fields and their effect.**
   - `name`: string 1..60 characters (`STATUS_NAME_MAX`, today's `NAME_MAX`).
   - `logoUrl`: a database or file value is an `https:` URL of at most 2048 characters, without
     userinfo. A local logo file is only possible through `PULSE_STATUS_LOGO`, as today.
   - `theme`: `{light?, dark?, "font-sans"?, "font-mono"?, "radius-sm"?, "radius-md"?,
     "radius-pill"?}`. The keys and value rules are those of `src/theme-config.ts:6-54`. They are
     merged per token, so a partial file theme leaves the other database tokens in force.
   - `componentOrder`: 0..500 unique non-empty ids (`STATUS_COMPONENT_ORDER_MAX`), each at most
     200 characters.
     - Status orders components by their position in the list; unlisted components follow in
       upstream order. Groups then appear in order of their first component.
     - At save time the api refuses an id that is not a current component (`422`). Status ignores
       an id that was removed later.
     - The order never changes `/components` of the api.
   - `showChecks` (default `false`) and `hideDetails` (default `true`) keep today's meaning.
   - `showLatency` (default `true`). With `false`:
     - no latency label, latency chart or daily latency values in SSR or the browser;
     - `/api/latency` and `/api/components/latency` answer `[]`;
     - `latencyObjectiveMs` is removed from `/api/checks` items, and `latencyMs` from the result
       objects of `/api/checks` locations;
     - the poller (`src/poller.ts`) adds `latencyMs: 0` to the validated copy of each result, as
       it already does for `checkId`, `statusCode`, `attempts` and `location`
       (`poller.ts:128-136`). The returned checks keep no placeholder, so `renderLatency` prints
       nothing for a result without `latencyMs`. A browser refresh with populated results
       therefore succeeds.
   - `showSlos` (default `true`). With `false`, the SLO block is not rendered and `slo` is removed
     from check and component items of public answers. `slo` is optional in the contract
     (`schema.ts:627`, `:831`), so no placeholder is needed.
10. **Status startup.**
    - Without `PULSE_STATUS_API_TOKEN` or `PULSE_STATUS_API_TOKEN_FILE`, status behaves as today,
      with env and the local file only. Both set: exit `2`. A token file that is unreadable or
      empty after trim: exit `2`. Neither message holds the token.
    - With a token, the public routes answer `503` `{"error":"settings not loaded"}` until the
      first settings read gives `200`, `304` or `404`. A `404` means an older api without the
      route, and the database layer is then empty.
    - The data comes from the same api, so nothing public is served from a guessed snapshot.
11. **Notify modes.**
    - With `PULSE_NOTIFY_API_TOKEN` or `PULSE_NOTIFY_API_TOKEN_FILE` set, `PULSE_NOTIFY_CONFIG` is
      optional, and a file with `"channels": []` is valid. That is the database-only mode. The
      token rules of Decision 10 apply (both set, unreadable or empty file: exit `2`).
    - Without a token, notify behaves exactly as today: the file is required and needs at least
      one channel.
    - Notify re-reads the channel file every 15 s by comparing a SHA-256 of its bytes. A changed,
      valid file reconciles. An invalid file keeps the last good set and is reported.
12. **Database channel shape and limits.** Types `webhook`, `slack`, `teams` and `email`. A
    database channel of type `file` is refused.
    - The routing fields are the existing ones and keep their existing rules.
    - Secrets are references only:
      - `urlEnv`/`urlFile`, required for webhook, slack and teams. Webhook gains them in notify for
        both sources; a file webhook keeps its literal `url` too, and needs exactly one of `url`,
        `urlEnv`, `urlFile`.
      - `secretEnv`/`secretFile` for webhook.
      - `smtp.passwordEnv`/`smtp.passwordFile` for email.
    - An env reference matches `^PULSE_NOTIFY_SECRET_[A-Z0-9_]{1,64}$`. A file reference is a
      basename matching `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`. Notify resolves it only inside
      `PULSE_NOTIFY_SECRET_DIR`, and without that variable file references of database channels
      are refused.
    - The contract rejects these keys as unknown fields: literal `url`, `password` and `secret`.
    - Id: `^[a-z0-9][a-z0-9_-]{0,63}$`.
    - Per channel: every list has at most 200 entries and every string at most 200 characters;
      references and `statusUrl` follow their own rules above.
    - Aggregate: at most 100 database channels (`NOTIFY_CHANNEL_MAX`), and the sum over all of
      them of the UTF-8 byte length of `JSON.stringify(definition)` is at most 262 144
      (`NOTIFY_CHANNELS_MAX_BYTES`). The api refuses a create or replace that would exceed either
      limit with `422`. With 100 × about 80 bytes for `createdAt`, `updatedAt` and separators, the
      largest `GET /service/notify/channels` answer stays below 280 000 bytes, under the 1 048 576
      limit of Decision 6. (Without this limit, 30 webhooks with one 200 × 200-character list each
      would reach 1 220 399 bytes, as the plan-review computed.)
13. **Notify reconcile.**
    - The effective set is the file channels plus the database channels whose id is not in the
      file. Each database channel is resolved on its own. A channel whose secret is missing,
      empty or unreadable is not installed: its last good version stays installed if one exists,
      and the problem is reported.
    - Per id:
      - Unchanged (same canonical definition and same digest of the resolved secrets): kept.
      - Changed: the old worker takes no new job, its in-flight send finishes or times out, and
        the new worker gets the waiting and pending keys. Pending events go to the new
        destination; old and new worker never hold the same key.
      - Removed: the worker stops. Its pending entries stay pending in the ledger and are enqueued
        again if the id returns.
      - Added: today's `hasChannel` seeding applies, so a re-added id is not seeded again and its
        recorded keys stay deduplicated.
      - Routing widened: today's quiet seeding of routing changes applies (`notifier.ts:729-799`).
      - Type changed: recipient progress is kept but used only by email.
    - Metric series per channel are created when a channel is installed.
    - The last applied database channel definitions (references only) are kept in the ledger
      (format 5). A cold start with the api down therefore still runs them.
14. **Resend.**
    - **States.** Open: `queued`, `claimed`, `admitted`. Finished: `delivered`, `failed`, `dropped`,
      `not-failed`, `no-payload`, `channel-unavailable`. Admission outcomes: `admitted`,
      `not-failed`, `no-payload`, `channel-unavailable`. Final outcomes: `delivered`, `failed`,
      `dropped`.
    - **Create** (`POST /admin/notify/resends`, body `{channelId, key, requestId}`; `requestId`
      matches `^[A-Za-z0-9_-]{16,64}$` and the console creates it when it renders the button).
      The api checks in this order, in one transaction under the write lock:
      1. a command with this `requestId` exists: same `channelId` and `key` → `200` with it;
         different → `409` `requestId was used for another delivery`;
      2. an open command for the same `(channelId, key)` exists → `200` with it;
      3. the notify report is `stale` or `never` → `503` `pulse-notify has not reported recently`;
      4. the report's `failed` list holds no entry with this `(channelId, key)` → `409` `not a
         failed delivery`;
      5. capacity: the table holds 1000 commands (`RESEND_COMMAND_MAX`) or more → the oldest
         finished commands (by `updatedAt`) are deleted until 999 remain. When no finished command
         can be deleted, the answer is `503` `too many open resend commands` with
         `retry-after: 60`;
      6. a new `queued` command with an api-made id (24 random base64url characters) → `202`, and
         one audit row `notify-resend.create`.
    - **Claim** (`POST /service/notify/resends/claim`). One transaction: every `claimed` command
      with `claimedAt` at least 60 000 ms ago (`RESEND_CLAIM_TIMEOUT_MS`) goes back to `queued`;
      then up to 20 (`RESEND_CLAIM_MAX`) `queued` commands, oldest `createdAt` first, become
      `claimed` with `claimedAt = now`. `admitted` commands are never claimed or requeued.
    - **Result** (`POST /service/notify/resends/:id/result`, body `{state}` with any notify state:
      an admission or final outcome). With the stored state `T` and the posted state `S`:
      - `S` = `T`: `204`, no change (a repeated acknowledgement);
      - `T` is `queued` or `claimed`, and `S` is any admission or final outcome: `204`, `S` is
        stored. This accepts a replay after the api requeued the command and a final outcome whose
        admission answer was lost;
      - `T` = `admitted` and `S` is a final outcome: `204`, `S` is stored;
      - `T` is a final outcome and `S` = `admitted`: `204`, no change (a late acknowledgement of
        an earlier stage);
      - any other pair: `409` `result <S> does not follow <T>`. For example `delivered` after
        `failed`, `not-failed` after `admitted`, or `admitted` after `no-payload`;
      - unknown id: `404`; a body that is not a `ResendResultInput`: `422`.
    - **Notify side.** A ledger table (format 5) keeps one row per handled command: `id`,
      `channelId`, `key`, `state` (the newest known outcome), `postedState` (the newest state the
      api answered `204` to, or null) and `updatedAt`.
      - A claimed command whose id has a row is never executed again: notify posts the row's
        `state`.
      - Otherwise notify checks that the channel is installed (else `channel-unavailable`), then
        runs `Ledger.resend` and inserts the row with the outcome in **one SQLite transaction**.
        After the commit, a `resent` entry (outcome `admitted`) is enqueued in the running worker.
        A crash after the commit loses nothing: `start()` enqueues pending entries
        (`notifier.ts:322`).
      - When an admitted key reaches a terminal ledger status (delivered, failed, dropped), the
        same transaction that writes that status sets `state` of every `admitted` row of that
        `(channelId, key)`.
      - Every command poll posts, oldest first and at most 20, each row whose `postedState` ≠
        `state`. `204` sets `postedState = state`. `404` and `409` also set it, with one log line
        naming the command id and both states, so a refused result is not posted forever. A
        timeout, network error or `5xx` leaves the row for the next poll.
      - The existing ledger prune deletes a row whose `postedState` = `state`, whose `state` is
        finished, and whose `updatedAt` is more than 7 days old. No other rule deletes a row.
    - **Retention in the api.** The existing retention pass deletes every command whose
      `createdAt` is more than 7 days old, in any state. Notify then gets `404` for a late result
      and stops posting it.
    - Notify's report carries the failed list (Decision 12 limits in R1). It never carries a
      payload or destination.
    - The delivery guarantee stays at least once. The webhook `idempotency-key` and the email
      Message-ID come from the unchanged event key.
15. **Audit and People log.**
    - New contract audit actions:
      - `status-settings.replace`;
      - `notify-channel.create`, `notify-channel.replace`, `notify-channel.delete`;
      - `notify-resend.create`.
    - New target kinds: `status-settings`, `notify-channel`, `notify-resend`.
    - New console People actions with the same names, plus targets `status-settings`,
      `notify-channel{id}` and `notify-resend{channelId}`.
    - No value, reference name or key of a setting enters an audit row. The target id is the
      channel id, or the command id for a resend.
16. **Write semantics per route.** Only configuration writes use revisions and audit rows.

    | Route | `If-Match` | Generation bump | Audit row | Repeat safety |
    | --- | --- | --- | --- | --- |
    | `PUT /admin/status/settings` | required, status revision | `status_generation` + 1 | `status-settings.replace` | `412` on a stale revision |
    | `POST /admin/notify/channels` | required, notify revision | `notify_generation` + 1 | `notify-channel.create` | `409` on an existing id |
    | `PUT /admin/notify/channels/:id` | required, notify revision | `notify_generation` + 1 | `notify-channel.replace` | `412` |
    | `DELETE /admin/notify/channels/:id` | required, notify revision | `notify_generation` + 1 | `notify-channel.delete` | `412`; then `404` |
    | `POST /admin/notify/resends` | ignored | none | `notify-resend.create`, only on `202` | `requestId` (Decision 14) |
    | `PUT /service/status/report` | ignored | none | none | whole replace, last write wins |
    | `PUT /service/notify/report` | ignored | none | none | whole replace, last write wins |
    | `POST /service/notify/resends/claim` | ignored | none | none | requeue and claim in one transaction |
    | `POST /service/notify/resends/:id/result` | ignored | none | none | the acknowledgement rules of Decision 14 |

    - Every write of this table runs in one SQLite transaction under the existing write lock
      (`src/write-lock.ts`).
    - The configuration writes commit the record, the generation bump and the audit row together.
    - A report is validated whole before it replaces the stored one. `receivedAt` is the api
      clock.
    - Service routes write one info log line without values: route, service, and for results the
      command id and state.
    - Admin GET views carry the configuration revision as `etag`, for the next `If-Match`. They
      answer `cache-control: no-store` and never `304`, because their `service` part changes
      without a revision change. Service GETs answer `304` on a matching `If-None-Match`, because
      their bodies depend only on the generation.

## Scope

- contract: schemas and validators for the new shapes, two new scopes, new audit actions and
  kinds, new constants.
- api: storage, admin routes, service routes, reports, the resend queue, audit; the bench option
  and service-token fixtures for the A/B measurement.
- status: the new settings, the local settings file, token, poll, live apply, report, the poller
  placeholder.
- notify: token, database-only mode, live reload and reconcile, webhook references, secret
  restrictions, live resend, ledger format 5, report.
- console:
  - Status page screen;
  - Notifications screen: channel list, editor, delete, failed list, resend;
  - token presets for the two service tokens;
  - People log, navigation, docs.
- deploy: a test-only overlay, receiver and E2E scenario that run only against images with the
  feature, plus docs for operators.

## Non-goals

- Component CRUD or a change of api component order or membership.
- Upload of a logo, theme or font. Arbitrary CSS.
- A delivery history dashboard, bulk resend or a test notification button.
- New transports, subscriber mail (#573), new warning kinds (#571).
- Multiple instances of status or notify. One of each per stack is assumed, and reports are
  per service, not per instance.
- Writing a service file or environment from the console or api.
- Exactly-once delivery.
- Moving the failed CLI to the api. It stays offline and keeps exit `2` while notify runs.
- Routing details of file channels in the console. A file channel shows id, type, reference names
  and origin only.
- A change of `full/compose.yaml` or `dev/compose.yaml` defaults. Operators add the tokens with a
  documented override.

## Required behavior

### R1 Contract shapes

All objects are `strictObject`. "Absent" means not set; `null` is not accepted for a setting.
`Revision` is the existing admin revision string (`sha256-<64 hex>`). Times are epoch ms integers.

- **`StatusSettings`**:
  - fields: `name?`, `logoUrl?`, `theme?: StatusTheme`, `componentOrder?`, `showChecks?`,
    `showLatency?`, `showSlos?`, `hideDetails?`, with the rules of Decision 9;
  - `StatusTheme`: `light?` and `dark?`, objects of the 20 colour keys, each optional, plus the
    five font and radius keys;
  - the colour, font and radius keys move into the contract as exported constants
    (`STATUS_COLOR_KEYS`, `STATUS_FONT_KEYS`, `STATUS_RADIUS_KEYS`), so status and contract
    share one list. Their values are the keys of status `src/theme-config.ts:6-29`, in that order.
- **`ServiceStatusSettings`** (answer of `GET /service/status/settings`): `{revision: Revision,
  settings: StatusSettings}`.
- **`StatusServiceReport`**:
  - `{at, startedAt, appliedRevision: Revision|null, rejected: {source: "database"|"file",
    reason}|null, locked: StatusLockedField[]}`;
  - `StatusLockedField`: `{field, source: "env"|"file", via, value?}`;
  - `field` is a dotted path: `name`, `logoUrl`, `theme.light.bg`, `theme.font-sans`,
    `componentOrder`, `showChecks`, …; at most 60 entries;
  - `via` is the env variable name or `"settings file"` / `"theme file"`;
  - `value` is the local value, except for a local logo file path, which is left out;
  - `reason` is at most 300 characters.
- **`StatusServiceState`**: `{state: "fresh"|"stale"|"never", receivedAt: number|null, report:
  StatusServiceReport|null}`. `never` has `receivedAt: null` and `report: null`.
- **Admin status view** `AdminStatusSettingsView`: `{revision, settings: StatusSettings, service:
  StatusServiceState}`.
- **`NotifyChannelDefinition`**: a discriminated union on `type` (`webhook|slack|teams|email`)
  with `id`, the routing fields, and the type fields of Decision 12.
  - **`NotifyChannelRecord`**: a definition plus `createdAt` and `updatedAt`.
- **`ServiceNotifyChannels`** (answer of `GET /service/notify/channels`): `{revision, channels:
  NotifyChannelRecord[]}`, all database channels, shadowed ones included, in creation order.
- **`NotifyFileChannelView`**: `{source: "file", id (1..200 characters), type:
  "webhook"|"file"|"slack"|"teams"|"email", refs: string[] (0..6, each 1..200 characters)}`.
  `refs` are the reference names (`SLACK_OPS`, `hook.txt`), never values. A file channel id longer
  than 200 characters is cut to 199 characters plus `…`; such an id cannot collide with a database
  id (at most 64 characters).
- **`NotifyChannelView`**: `NotifyFileChannelView | (NotifyChannelRecord & {source: "database"})`.
- **`NotifyRejectedChannel`**: `{channelId: string|null (1..200), reason (1..300)}`.
- **`NotifyFailedDelivery`**: `{channelId (1..200), key (1..300), event: "opened"|"resolved"|
  "reminder"|"manual"|"warning", failedAt, hasPayload: boolean}`. A failed entry of a channel id
  longer than 200 characters is left out of the list and counted in `failedTotal`.
- **`NotifyServiceReport`**: `{at, startedAt, appliedRevision: Revision|null, fileChannels:
  NotifyFileChannelView[] (0..200, file order), fileChannelsTotal (integer ≥ fileChannels.length),
  shadowedIds: string[] (0..100, database id pattern), rejected: NotifyRejectedChannel[] (0..100),
  failed: NotifyFailedDelivery[] (0..200, newest first), failedTotal (integer ≥ failed.length)}`.
  - `shadowedIds` are the database channel ids that notify shadowed at its last apply, computed
    from all file ids, not only the 200 reported.
- **`NotifyServiceState`**: `{state: "fresh"|"stale"|"never", receivedAt: number|null, report:
  NotifyServiceReport|null}`, with the same rules as `StatusServiceState`.
- **Admin notify view** `AdminNotifyChannelsView`: `{revision, channels: NotifyChannelView[],
  shadowed: NotifyChannelView[], service: NotifyServiceState}`.
  - `channels` holds the reported file channels, then the unshadowed database channels in
    creation order.
  - `shadowed` holds the database channels whose id is in the last report's `shadowedIds` (a stale
    report included).
- **`AdminNotifyFailedView`**: `{service: NotifyServiceState, failed: NotifyFailedDelivery[],
  failedTotal}`; `failed` is `[]` and `failedTotal` 0 with no report.
- **Resend**:
  - `ResendRequest`: `{channelId (1..200), key (1..300), requestId}`.
  - `ResendCommandState`: the ten states of Decision 14, exported as `RESEND_COMMAND_STATES`.
  - `ResendCommand`: `{id, channelId, key, requestId, state: ResendCommandState, createdAt,
    updatedAt}`.
  - `ResendClaimResponse`: `{commands: ResendCommand[] (0..20)}`.
  - `ResendResultInput`: `{state}` with an admission or a final outcome; `queued` and `claimed`
    are refused.
- **Report size.** A service never sends a report whose JSON is over 524 288 bytes
  (`SERVICE_REPORT_MAX_BYTES`). Notify leaves out entries from the end of `failed`, then of
  `fileChannels`, until it fits; the totals stay. Status leaves out the `value` of the
  `componentOrder` lock, then of the other locks. With the counts above, a report of plain ASCII
  values stays below 450 000 bytes, so the trimming applies only to escaped characters. The
  largest admin notify view is then under 262 144 + 524 288 + 20 000 bytes, below the api's 1 MiB.
- **Tokens**: `TOKEN_SCOPES` gains `status` and `notify`, in that order after `probe`. The rule
  "probe must be the only scope" becomes "probe, status and notify must each be the only scope",
  with the message `"<scope> must be the only scope"`. A location is allowed only for `probe`.
- **Audit**: the actions and kinds of Decision 15.

### R2 Api routes

All new routes answer `405` with `Allow` for other methods. Bodies are JSON within 1 MiB (`413`
beyond). Decision 16 says which routes need `If-Match`: there it is `428` when missing, `400` when
malformed, `412` `the settings changed: reload them and retry` when stale, and the success answer
carries the new `etag`.

| Method and path | Token | Answer |
| --- | --- | --- |
| `GET /admin/status/settings` | `admin` | `200` `AdminStatusSettingsView`, `etag` |
| `PUT /admin/status/settings` | `admin` | body `StatusSettings`; `200` view; `422` invalid or unknown component id |
| `GET /admin/notify/channels` | `admin` | `200` `AdminNotifyChannelsView`, `etag` |
| `POST /admin/notify/channels` | `admin` | `201` and `location`; `409` id exists in the database or in the last report's `fileChannels` ids; `422` invalid, over 100 channels or over 262 144 bytes in total |
| `PUT /admin/notify/channels/:id` | `admin` | `200`; `400` body id ≠ path id; `409` shadowed (only delete allowed); `422` invalid or over 262 144 bytes; `404` unknown |
| `DELETE /admin/notify/channels/:id` | `admin` | `204`; works on a shadowed copy; `404` unknown |
| `GET /admin/notify/failed` | `admin` | `200` `AdminNotifyFailedView` |
| `POST /admin/notify/resends` | `admin` | Decision 14: `202`; `200` for a repeat or an open command; `409`; `503` |
| `GET /admin/notify/resends/:id` | `admin` | `200` `ResendCommand`; `404` |
| `GET /service/status/settings` | `status` | `200` `ServiceStatusSettings` with `etag`; `304` on a matching `If-None-Match` |
| `PUT /service/status/report` | `status` | body `StatusServiceReport`; `204`; `422` invalid |
| `GET /service/notify/channels` | `notify` | `200` `ServiceNotifyChannels` with `etag`; `304` |
| `PUT /service/notify/report` | `notify` | body `NotifyServiceReport`; `204`; `422` invalid |
| `POST /service/notify/resends/claim` | `notify` | `200` `ResendClaimResponse` |
| `POST /service/notify/resends/:id/result` | `notify` | `204`; `409`; `404`; `422` (Decision 14) |

- A PUT of an id that exists only as a file channel is `404`, because the api stores no file
  channel; the console offers no edit for it.
- Auth order is the existing one: throttle, then `401`, `403`, `413`, `400`, `428`, `503`, `412`,
  `422`, `409`, `404` (contract `ADMIN_STATUS_ORDER`, `admin.ts:30-46`). The resend create
  follows the step order of Decision 14 after `422`.
- The `/service/*` routes use the same throttle as `/admin/*`.
- Metric labels:
  - `/admin/status/settings`, `/admin/notify/channels`, `/admin/notify/channels/:id`,
    `/admin/notify/failed`, `/admin/notify/resends`, `/admin/notify/resends/:id`;
  - `/service/status/settings`, `/service/status/report`, `/service/notify/channels`,
    `/service/notify/report`, `/service/notify/resends/claim`,
    `/service/notify/resends/:id/result`.

### R3 Console screens

- **Status page** at `/status-page`. Its nav entry `status-page` is labelled "Status page" with
  role Owner.
  - The form has name, logo URL, the 25 theme tokens (light and dark colour tables, two fonts,
    three radii), the four switches, and component order.
  - Component order is a list with "Move up" and "Move down" buttons and a "Reset order" control.
    Each button posts the form; no drag and no script are needed.
  - A boolean is a three-way select: "Not set (default: …)", "On", "Off". Every other field has
    an empty choice that means "not set".
  - A field in `report.locked` is shown read-only with "Set by `<via>` on pulse-status".
  - Banners:
    - a stale or missing report: "pulse-status has not reported; overrides are unknown";
    - `rejected`: the reason;
    - `appliedRevision` ≠ `revision`: "Saved, not yet applied".
- **Notifications** at `/notifications`. Its nav entry `notifications` is labelled
  "Notifications" with role Owner.
  - Pages:
    - `/notifications`: list. File channels are read-only with id, type, reference names and
      "From the notify channel file". When `fileChannelsTotal` > the listed count, the page says
      how many more exist. Shadowed database copies are marked "Shadowed by the channel file" and
      allow only Delete.
    - `/notifications/new`;
    - `/notifications/edit?id=`;
    - `/notifications/delete?id=`;
    - `/notifications/failed`: up to 200 rows, newest first, with channel, key, event, failure
      time, and a Resend button only when `hasPayload`;
    - `/notifications/resend?id=<command id>`: the command state, read on each load.
  - The editor:
    - shows the type-specific fields;
    - offers only reference names: an env name in a text field with the `PULSE_NOTIFY_SECRET_`
      prefix shown, or a file name with "a file in PULSE_NOTIFY_SECRET_DIR on pulse-notify";
    - never shows a field for a secret value;
    - has a "zero channels" first-use state.
- **Shared rules for both screens**:
  - The routes take `requiredRole` from `routeRole("settings.edit")`. A denied direct POST or GET
    is `403`.
  - Writes follow the check write pattern: the outcome comes from metadata, the input is kept on
    `412`, form tokens are used.
  - Token rejected, old api (`404` on `/admin/status/settings`), offline service (stale report),
    apply-rejected, `422` over a channel limit, and `503` on resend each have a state.

## Risks

- **An older console fails on a token with a new scope.** Its strict token validator rejects the
  whole token list once a `status` or `notify` token exists (contract `tokens.ts:93-134`; console
  `src/token-read.ts:53-101`). Mitigation: the console section moves to the new contract, and the
  rollout says to create service tokens only after that console runs. Deploy creates them only in
  its E2E stack.
- **A remote edit sends a notify secret to an attacker destination.** Mitigation: the reference
  prefix and the secret directory are notify-local rules the api cannot widen (Decision 12), and
  database `file` channels are refused.
- **A visibility change serves an old permissive answer.** Mitigation: the fingerprint in the
  cache key and the ETag, and the in-flight rule (Decision 8).
- **Withheld latency breaks the browser refresh.** Mitigation: the poller placeholder of
  Decision 9 and its test with populated results.
- **A worker swap sends twice or floods old events.** Mitigation: the reconcile rules
  (Decision 13), and seeding by ledger channel id.
- **One click resends twice.** Mitigation: the command row and `Ledger.resend` in one notify
  transaction, `Ledger.resend` admitting only failed entries, and the API idempotency on
  `requestId`.
- **A result is posted forever.** Mitigation: `404` and `409` end the posting (Decision 14).
- **Notify test CPU.** notify's `test_cpu_s` budget is 3.4 s with a B median of about 3.1 s
  (`bench/README.md:122`). New notify tests must use fake timers and reuse servers; see
  Performance impact.
- **Full/dev `PULSE_STATUS_SHOW_CHECKS=true` locks show checks.** This is intended and documented;
  the E2E checks an unlocked field as well.

## Performance impact

Metrics of api `bench/budgets.json` that the change can move, with direction and size:

- **api** (`api` section):
  - `startup_cpu_ms` (gating, 325): + under 5 ms on a normal start (five more tables exist in the
    seed). The first start after the upgrade runs migration step 9 on an existing file: + under
    10 ms, measured with `cold-read.ts --seed-with` (below), reported, not gating.
  - `startup_wall_ms` (reported): the same.
  - `idle_rss_mib` (gating, 88): + under 1 MiB.
  - `load_cpu_s` (gating, 28.1): + under 0.1 s. In the 60 s window, B with the loops on gets
    about 4 status settings reads, 4 notify channel reads, 12 claims and 2 to 4 reports: about 22
    small requests next to the about 2 600 of the load.
  - `peak_rss_mib`, `p95_*`, `rps`, `cold_*`, `eod_*`: none expected; the read paths do not change.
  - `test_cpu_s` (gating, 5.6, floor 1.6): + up to 0.5 s for the new suites.
  - `image_mb` (reported): none; no new package.
- **status** (`status` section):
  - `startup_cpu_ms` (gating, 377) and `startup_wall_ms`: + under 10 ms with a token (first
    settings read before `/readyz`).
  - `load_cpu_s` (gating, 0.5): + under 0.05 s for 4 settings polls, the file re-reads and 1 to 2
    reports per minute.
  - `idle_rss_mib` (gating, 82) and `peak_rss_mib` (85): + under 1 MiB for the snapshot and CSS.
  - `test_cpu_s` (gating, 3.4, no floor): + up to 0.6 s.
  - `image_mb`: none.
- **notify** (`notify` section):
  - `startup_cpu_ms` (gating, 455): + under 20 ms for the format-5 tables on a fresh ledger.
  - `load_cpu_s` (gating, 0.5): + under 0.05 s for 4 channel polls, 12 claims and reports per
    minute.
  - `idle_rss_mib` and `peak_rss_mib` (86): + under 1 MiB.
  - `test_cpu_s` (gating, 3.4, floor 1.5): target + under 0.25 s, because B is already about
    3.1 s. When the A/B shows `FAIL budget`, the notify PR says so with the table, and the owner
    decides on a budget change in an api PR (`bench/README.md:98-100`).
  - `image_mb`: none.
- **contract** (`contract` section): `test_cpu_s` (gating, 9.0, floor 2): + up to 0.5 s;
  `build_cpu_s` (gating, 6.4): + up to 0.3 s for three new modules.
- **kit, config, probe**: none; they do not change.
- **console, deploy**: not in `bench/budgets.json`; none expected beyond the new pages.

How the implementers measure (all runs from a checkout of the api that has the harness change of
the api section: the api branch before it merges, `main` after):

- The api section adds `--b-ref <repo>=<ref>` (repeatable, any repository but the api) to
  `bench/run.ts` and `bench/refs.ts`: it sets only that repository's B side, and every other rule
  stays.
- The api section gives the bench stack an admin tokens file and creates a `status` and a
  `notify` token after the api is ready, plus one status settings document and five database
  webhook channels. A side whose api refuses the new scopes runs without tokens and logs
  `service tokens: not available on <side>`. So side A (old code) has the loops off and side B
  (new code) has them on.
- Commands, with full SHAs:
  - api: `bun bench/run.ts --a <api main> --b <api branch>`;
  - status: `bun bench/run.ts --a <api main> --b <api with the feature> --b-ref status=<status branch>`;
  - notify: `bun bench/run.ts --a <api main> --b <api with the feature> --b-ref notify=<notify branch>`;
  - contract: `bun bench/run.ts --a <api main> --b <api main> --b-ref contract=<contract branch>`
    (only the contract rows matter);
  - migration on upgrade: `bun bench/cold-read.ts --api <api branch worktree> --seed-with <api
    main worktree>`.
  - A local run may use `--rounds 1`; the PR says so and pastes the table.
- Shared finding: the first child that runs a measurement records the api ref that has the
  harness option and the command it used. The others read it before they measure.

## Security impact

Security impact: yes
New admin and service routes and token scopes, contract parsers at a trust boundary, remote config into notify, ledger writes and CI steps.

Checklist items that apply:

- **Secrets in errors, logs and responses.**
  - Only reference names cross the services. A resolved secret, destination URL or payload never
    enters an api or console row, response, audit row, log or metric.
  - Status and notify send `Bearer` only to `/service/*`; the token never enters a log, report or
    error.
  - Tests use sentinel secret values and assert they are absent everywhere.
- **Auth order and status codes.** As in R2. Sole scopes `status` and `notify`. `403` for a
  service token on `/admin/*`, for an admin token on `/service/*`, and for one service's token on
  the other service's routes. Console Owner-only, checked on every route and again just before the
  write (`writeGuardProblem`).
- **Body and size limits.**
  - Every new api route: 1 MiB. Channels: 100 and 262 144 bytes in total. Reports: 524 288 bytes
    on the sending side, 1 MiB at the api.
  - The console forms: `MAX_FORM_BYTES` 8192 for resend and delete, and 65536 for the status and
    channel forms.
  - Service answers: 1 048 576 bytes in status and notify.
- **Input validation.** Contract validators at the api edge and again in status and notify. Ref
  patterns, secret directory basename rules, and no database `file` channel.
- **SSRF and redirects.**
  - Notify keeps today's transport rules: Slack and Teams https, or http on loopback; SMTP TLS
    rules. Webhook destinations come only from notify's own env or secret directory.
  - Status `logoUrl` is https only and goes into CSP `img-src` as its origin only.
  - Service calls use `redirect: "manual"`, as today.
- **Atomic, path-safe writes.** Notify reads a secret file only inside the secret directory,
  rejecting `..`, `/` and symlinks that leave it (`realpath` check). Ledger writes stay SQLite
  transactions. No service file is ever written.
- **Dependency pins.** Contract pin updates in api, status, notify and console. No new runtime
  package.
- **CI.** deploy adds one `lint` step and one `e2e-dev` grep; no new action or permission.

## Rollout order

1. **contract `2.4.0`.** Additive: new modules and validators, two new scopes, new audit values.
   - Older consumers stay on their pins: api `c4a2eb5`, status and notify `9ab7e24`, console
     `66818a24`. Nothing changes for them until they move.
2. **api, status, notify, console** in any order, each with the contract pin `2.4.0`.
   - api: older status and notify send no token and call no `/service/*` route, so they keep
     working on public reads. The older console (contract `66818a24`) works until someone creates
     a `status` or `notify` token. Then its Tokens and Probes lists show "pulse-api sent an
     invalid answer." The api README and the release note say: update the console before creating
     service tokens.
   - status and notify without a token behave as today. With a token against an api without the
     routes, the settings read gets `404`: status runs on env and file, and notify on its file.
     Both log once that the api has no runtime settings.
   - The console against an older api: `/status-page` and `/notifications` show the "old api"
     state.
   - A format-5 notify ledger is refused by an older notify (`ledger.ts:670-690`). The notify docs
     say a downgrade is not supported.
3. **deploy** after the four services are on `main`. It adds a test-only overlay, receiver and
   scenario. `full` and `dev` defaults do not change, so older images run as before. The E2E
   scenario detects the feature through `GET /admin/notify/channels` (`404` prints `skip`) and runs
   only in the dev setup.

## Counterexamples

- **Precedence:**
  - `PULSE_STATUS_SHOW_CHECKS=false` (equal to the default) and the database `showChecks: true`:
    the effective value is `false`, and the report locks `showChecks` with `via`
    `PULSE_STATUS_SHOW_CHECKS`. A wrong implementation that compares with the default shows
    checks.
  - `PULSE_STATUS_SHOW_CHECKS=""`: not set, so the database value applies.
  - Theme file sets only `light.accent=#112233`, and the database sets `light.accent=#445566` and
    `light.bg=#ffffff`: the CSS has `--accent:#112233` and `--bg:#ffffff`.
- **Reset:** the database has `name: "Acme"`, and a PUT without `name` gives `"pulse status"` (the
  default) on the next poll. A settings file with `name: "Local"` is then removed: the retained
  database value shows again; with no database value, the default.
- **Notify whole channel:** file channel `ops` (slack, `urlEnv: SLACK_OPS`) and database `ops`
  (webhook, `urlEnv: PULSE_NOTIFY_SECRET_HOOK`, `checks: ["api*"]`). The effective `ops` is the
  slack channel with the file routing. The webhook URL is never used, and the database copy is
  listed under `shadowed` because the report's `shadowedIds` holds `ops`.
- **Create collisions:** `POST` of id `ops` while the report lists file `ops`: `409`. `POST` of
  `Ops` (upper case): `422` id pattern. `POST` of the 101st channel: `422`.
- **Aggregate size:** database channels whose definitions sum to exactly 262 144 bytes: the last
  create is `201`. One more byte (a 1-character longer string): `422`. Thirty webhooks with one
  200 × 200-character `checks` list each (about 41 000 bytes per write): the 7th create is `422`,
  so `GET /service/notify/channels` never exceeds 1 048 576 bytes.
- **Report size:** a notify report with 200 file channels of 200-character ids made of `"`
  (escaped to 2 bytes each), 6 refs of 200 characters each and 200 failed entries: notify trims
  `failed`, then `fileChannels`, to at most 524 288 bytes, keeps `failedTotal` and
  `fileChannelsTotal`, and the api answers `204`, not `413`.
- **References:**
  - `urlEnv: "PULSE_API_TOKEN"` or `"PULSE_NOTIFY_API_TOKEN"`: `422`, wrong prefix.
  - `urlFile: "../api/token"`, `"a/b"`, `"."`: `422`.
  - `urlFile: "hook"` with `PULSE_NOTIFY_SECRET_DIR` unset on notify: the channel is not
    installed, and the report says `secret files are not enabled`.
  - A symlink `hook -> /etc/passwd` inside the directory: refused.
  - A body with `"url": "https://x"` on a database webhook: `422` `has an unknown field: url`.
  - `type: "file"`: `422`.
- **Revisions and writes:**
  - A `PUT /admin/status/settings` with the status revision after a channel write succeeds,
    because the revisions are separate. A PUT with a revision from before another status save:
    `412`. Without `If-Match`: `428`. With an unquoted value: `400`.
  - 100 notify reports and 100 claims between `GET /admin/notify/channels` and a channel PUT with
    its `etag`: the PUT is `200`, because reports and claims never bump the generation. A wrong
    implementation that bumps on reports answers `412`.
  - `GET /admin/status/settings` twice with an unchanged revision but a new report: both `200`
    with the new `service`; neither is `304`.
- **Component order:** `["a","a"]`: `422` duplicate. `["zzz"]` with no component `zzz`: `422`.
  - Components `[x(g1), y(g2), z(g1)]` with order `["y"]` give the list `y, x, z` and the groups
    `g2:[y]`, then `g1:[x, z]`. Without an order, `g1:[x, z]`, then `g2:[y]`, as today.
- **Visibility:**
  - `showLatency:false`: `/api/latency` is `[]`, `/api/checks[0]` has no `latencyObjectiveMs`
    key, and its `locations[0].result` has no `latencyMs` key. The browser poller still finishes
    the refresh (no "invalid answer" state), the SSR HTML has no `ms · objective` text, and the
    browser shows no latency label. A wrong implementation that drops `latencyMs` without the
    placeholder fails the refresh with `checks[0].locations[0].result.latencyMs`.
  - `showSlos:false`: no `slo` key in `/api/components` items.
  - A switch to `hideDetails:true` between the start of an upstream read and its store: the next
    `/api/checks` has `reason: null`, and its ETag differs from the one before.
- **Resend:**
  - Two `POST /admin/notify/resends` with the same `requestId`: one command, answers `202` then
    `200`, one audit row, one claim, one receiver hit.
  - The same `requestId` with another `key`: `409` `requestId was used for another delivery`.
  - Two different `requestId`s while the first is `queued`, `claimed` or `admitted`: `200` with
    the first command.
  - 1000 commands, all open: the next create is `503` `too many open resend commands` with
    `retry-after: 60`. 1000 commands of which 3 are finished: the 3 oldest finished go, and the
    create is `202`.
  - Lost admission answer: notify executes, stores `admitted`, and its post times out. The api
    requeues after 60 000 ms, notify claims again, finds the row, and posts `admitted`: `204`. No
    second send.
  - Lost final answer: the api holds `admitted`, and notify posts `delivered` until it gets `204`.
    A repeated `delivered` is also `204`.
  - Requeued command, notify already final: the api holds `queued` after the requeue, and notify
    posts `delivered`: `204`, stored as `delivered`.
  - `failed` posted after `delivered`: `409`; notify logs once and stops posting it.
  - A claim exactly 60 000 ms old is requeued; one 59 999 ms old is not.
  - The same key `42:opened` failed in channels `a` and `b`: resend for `a` leaves `b` failed.
  - A key that is `delivered`: notify posts `not-failed`. A legacy entry without payload:
    `no-payload`. A channel no longer installed: `channel-unavailable`.
  - A stale reminder: `admitted`, then `dropped` by the existing stale-reminder rule.
- **Stale report:** the last notify report was received 180 001 ms ago. `GET
  /admin/notify/channels` has `service.state: "stale"`, and the console shows origins as unknown.
  `POST /admin/notify/resends` for a new `(channelId, key)` gives `503`. At exactly 180 000 ms the
  state is still `fresh`.
- **Tokens:** a token with scopes `["status","read"]`: `422` `status must be the only scope`. A
  `notify` token on `GET /service/status/settings`: `403`.
- **Statistics:** the spec adds none. Latency and SLO numbers stay as the api computes them; the
  switches only hide them. The Performance impact numbers are bench medians as
  `bench/README.md:79` defines them (median of the rounds per side), not new statistics.

## Contract fields

Search command, run for this spec on the contract clone (`ebf6bbc`) and the config clone
(`bc87049`), which holds code only in `src/` and `bin/`:

```sh
grep -rn -- '<name>' .repos/contract/src .repos/config/src .repos/config/bin | wc -l
```

Every name below gave **0** hits, except where a count is given:

- Types: `StatusSettings`, `StatusTheme`, `ServiceStatusSettings`, `StatusServiceReport`,
  `StatusLockedField`, `StatusServiceState`, `AdminStatusSettingsView`, `NotifyChannelDefinition`,
  `NotifyChannelRecord`, `ServiceNotifyChannels`, `NotifyFileChannelView`, `NotifyChannelView`,
  `NotifyRejectedChannel`, `NotifyFailedDelivery`, `NotifyServiceReport`, `NotifyServiceState`,
  `AdminNotifyChannelsView`, `AdminNotifyFailedView`, `ResendRequest`, `ResendCommand`,
  `ResendCommandState`, `ResendClaimResponse`, `ResendResultInput`.
- Validators: `validateStatusSettings`, `validateServiceStatusSettings`,
  `validateStatusServiceReport`, `validateAdminStatusSettingsView`,
  `validateNotifyChannelDefinition`, `validateServiceNotifyChannels`,
  `validateNotifyServiceReport`, `validateAdminNotifyChannelsView`, `validateAdminNotifyFailedView`,
  `validateResendRequest`, `validateResendCommand`, `validateResendClaimResponse`,
  `validateResendResultInput`.
- Constants: `STATUS_COLOR_KEYS`, `STATUS_FONT_KEYS`, `STATUS_RADIUS_KEYS`, `STATUS_NAME_MAX`
  (60), `STATUS_COMPONENT_ORDER_MAX` (500), `NOTIFY_SECRET_ENV_PREFIX` (`"PULSE_NOTIFY_SECRET_"`),
  `NOTIFY_CHANNEL_MAX` (100), `NOTIFY_CHANNELS_MAX_BYTES` (262144), `NOTIFY_FAILED_REPORT_MAX`
  (200), `NOTIFY_FILE_CHANNEL_REPORT_MAX` (200), `SERVICE_REPORT_MAX_BYTES` (524288),
  `SERVICE_REPORT_STALE_MS` (180000), `RESEND_CLAIM_MAX` (20), `RESEND_CLAIM_TIMEOUT_MS` (60000),
  `RESEND_COMMAND_MAX` (1000), `RESEND_COMMAND_STATES`.
- Fields: `showLatency`, `showSlos`, `showChecks`, `hideDetails`, `componentOrder`, `logoUrl`,
  `requestId`, `appliedRevision`, `startedAt`, `receivedAt`, `locked`, `via`, `fileChannels`,
  `fileChannelsTotal`, `shadowedIds`, `failedTotal`, `failedAt`, `hasPayload`, `channelId`,
  `urlEnv`, `urlFile`, `secretEnv`, `secretFile`, `passwordEnv`, `passwordFile`.
  - `refs`: 2 hits, both in config tests about git refs (`config/src/release.test.ts:104`,
    `config/src/workflow-policy.test.ts:151`). No contract field.
  - `rejected`: 18 hits, all in comments of contract validators ("unknown keys are rejected",
    for example `validate.ts:266`). No field or export.
- State and kind values: `not-failed`, `no-payload`, `channel-unavailable`, `status-settings`,
  `notify-channel`, `notify-resend`.
  - The values `queued`, `claimed`, `admitted`, `delivered`, `failed`, `dropped` are members of the
    new `RESEND_COMMAND_STATES` only; they become no export of their own.
- Scope values: `"notify"`: 0 hits. `"status"`: 5 hits, all incident status fields
  (`client.ts:366`, `schema.ts:970,1036,1041,1068`), not scopes or kinds. The new scope value
  `status` lives in `TOKEN_SCOPES` only.
- Routes and paths: `/service/`, `/admin/status`, `/admin/notify`, `page-settings`,
  `data-settings`.
- Permission names (api only): `runtime-admin`, `status-service`, `notify-service`.
- Env: `PULSE_STATUS_SETTINGS_FILE`, `PULSE_STATUS_SHOW_LATENCY`, `PULSE_STATUS_SHOW_SLOS`,
  `PULSE_STATUS_API_TOKEN` (also covers `PULSE_STATUS_API_TOKEN_FILE`),
  `PULSE_STATUS_SETTINGS_POLL_MS`, `PULSE_NOTIFY_API_TOKEN` (also covers `_FILE`),
  `PULSE_NOTIFY_SECRET_` (covers `PULSE_NOTIFY_SECRET_DIR`), `PULSE_NOTIFY_CHANNELS_POLL_MS`,
  `PULSE_NOTIFY_COMMAND_POLL_MS`.
- New contract modules: `src/runtime-settings.ts`, `src/notify-channels.ts`, `src/resend.ts`,
  `src/validate-runtime.ts`: none exists (`ls .repos/contract/src`).

The env names were also searched in the status, notify and deploy clones: none exist
(`grep -rln 'PULSE_NOTIFY_SECRET\|PULSE_STATUS_SETTINGS_FILE\|SHOW_LATENCY\|SHOW_SLOS\|PULSE_STATUS_API_TOKEN\|PULSE_NOTIFY_API_TOKEN\|CHANNELS_POLL_MS\|COMMAND_POLL_MS'
.repos/status/src .repos/notify/src .repos/deploy`: no output). The existing `PULSE_NOTIFY_POLL_MS`
(`notify/src/config.ts:401`) stays and is a different name.

New names in one list:

- Token scopes: `status`, `notify`.
- Audit actions and kinds: as in Decision 15.
- Routes: as in R2. Status route: `/page-settings.json`. Page attribute: `data-settings`.
- Contract exports: the types, validators and constants above.
- Env:
  - status: `PULSE_STATUS_SETTINGS_FILE`, `PULSE_STATUS_SHOW_LATENCY`, `PULSE_STATUS_SHOW_SLOS`,
    `PULSE_STATUS_API_TOKEN`, `PULSE_STATUS_API_TOKEN_FILE`, `PULSE_STATUS_SETTINGS_POLL_MS`
    (default 15000, min 1000);
  - notify: `PULSE_NOTIFY_API_TOKEN`, `PULSE_NOTIFY_API_TOKEN_FILE`, `PULSE_NOTIFY_SECRET_DIR`,
    `PULSE_NOTIFY_CHANNELS_POLL_MS` (default 15000, min 1000), `PULSE_NOTIFY_COMMAND_POLL_MS`
    (default 5000, min 1000).
- Console paths:
  - `/status-page`;
  - `/notifications`, `/notifications/new`, `/notifications/edit`, `/notifications/delete`,
    `/notifications/failed`, `/notifications/resend`.
- Console `NavId`s: `status-page`, `notifications`.
- Bench option (api): `--b-ref`.

## Repository: contract

Files:
- `src/runtime-settings.ts` (new: `StatusSettings`, `StatusTheme`, status report, state and view
  schemas, theme key constants, `STATUS_NAME_MAX`, `STATUS_COMPONENT_ORDER_MAX`)
- `src/notify-channels.ts` (new: channel definition and record, file view, channel view, notify
  report, state, failed delivery, rejected channel, failed view, notify constants,
  `SERVICE_REPORT_MAX_BYTES`, `SERVICE_REPORT_STALE_MS`)
- `src/resend.ts` (new: resend request, command, states, claim response, result input, resend
  constants)
- `src/validate-runtime.ts` (new: the validators of "Contract fields")
- `src/tokens.ts` (changed: scopes `status`, `notify`, sole-scope rule)
- `src/audit.ts` (changed: actions, kinds)
- `src/index.ts` (changed: exports)
- `test/runtime-settings.test.ts`, `test/notify-channels.test.ts`, `test/resend.test.ts` (new)
- `test/tokens.test.ts`, `test/audit.test.ts`, `test/smoke.test.ts`, `test/types.fixture.ts`
  (changed)
- `dist/` (changed: rebuilt and committed)
- `package.json` (changed: `version` `2.4.0`), `README.md`, `docs/index.md` (changed)

Behavior change: yes. New shapes and validators, wider scope and audit enums.

Behavior: R1 exactly.
- Validators never throw and return the same object, as the existing ones do.
- Unknown keys give `has an unknown field: <key>`.
- The `componentOrder` duplicate message is `componentOrder[<i>]: must not repeat an id`.
- Database channels refuse `type: "file"` with `type: must be one of "webhook", "slack", "teams",
  "email"`.
- The file view accepts `file` too.
- The channel validators check one definition. The aggregate byte limit is a constant that the
  api applies over all channels; the contract exports it and documents the measure (UTF-8 bytes of
  `JSON.stringify(definition)`).
- `ResendResultInput` refuses `queued` and `claimed`.

Checks (tests in `test/`, as the existing suites):
- Accept and reject the Counterexamples' shapes. The expected values are literals in the tests:
  - duplicate order;
  - `urlEnv: "PULSE_API_TOKEN"`;
  - `urlFile: "../x"`;
  - `url` on a database webhook;
  - `type: "file"` on a definition, accepted on a file view;
  - id `Ops`;
  - a 61-character name;
  - colour `#12`;
  - radius `4pt`;
  - `null` for a setting;
  - `["status","read"]` scopes (`status must be the only scope`);
  - `status` with a location;
  - a report with 201 failed entries, 201 file channels or 101 shadowed ids;
  - a `ResendResultInput` with `queued`;
  - a `NotifyServiceState` with `state: "never"` and a non-null report.
- `tokenMetadataSchema` accepts a `notify` token. Older scope lists stay valid.
- The audit entry `notify-channel.create` with kind `notify-channel` is accepted. The same action
  with kind `check` is rejected.
- `STATUS_COLOR_KEYS` equals a literal list of the 20 keys written out in the test (copied from
  status `src/theme-config.ts:6-29` at `8b6d431`, an independent source).
- `test/smoke.test.ts`:
  - the export list gains exactly the validators and constants listed in "Contract fields" as
    literals;
  - the dist module list gains `runtime-settings`, `notify-channels`, `resend` and
    `validate-runtime`.

Tool facts (contract `ebf6bbc`):
- Bun `1.4.0` (`package.json:7` `packageManager`, `:9` `engines`).
- `check` is `bun run lint && bun run build && bun run typecheck && bun run test`
  (`package.json:28`); `lint` is `biome check . && pulse-eslint .` (`:25`); `build` runs
  `tsc -p tsconfig.build.json` (`:22`); `test` is `bun test` (`:24`).
- Biome `2.6.3` (`package.json:31`). `biome.json:2` extends `@lorenzh/pulse-config/biome.json`;
  the config pin is `51e95b0eb463b27a196a33b428607bd92443e4f0` (`package.json:32`). At that pin,
  Biome checks `**` without `dist`, `node_modules`, `bun.lock`, `*.html` and `test/fixtures`
  (config `biome.json:8-18`), so `src/` and `test/` are linted.
- `bunfig.toml:1-4`: `[test]` coverage on, lines `0.8`, `test/**` and `dist/**` ignored.
- CI: `.github/workflows/ci.yml:16-19` calls `check.yml@51e95b0…` with `build: true`. At that pin
  (identical to the clone) it runs install, lint, typecheck, build, `git diff --exit-code -- dist`
  and test (`check.yml:25-38`).

Completion evidence: `bun run check` output; `git diff --exit-code -- dist` after `bun run
build`; the new tests fail on `ebf6bbc` (missing exports) and pass after; the bench rows for
contract `test_cpu_s` and `build_cpu_s` from the command in Performance impact (a shared finding,
see there).

## Repository: api

Files:
- `src/migrations.ts` (changed: step 9 with `status_settings`, `notify_channels`,
  `service_reports`, `resend_commands`, `runtime_state`)
- `src/runtime-store.ts` (new: SQL of the five tables, generations, revisions, aggregate size)
- `src/status-settings-routes.ts` (new: admin and service status routes, report)
- `src/notify-channel-routes.ts` (new: admin and service channel routes, report, failed view)
- `src/resend-routes.ts` (new: resend create, read, claim, results, requeue)
- `src/token-scopes.ts` (changed: permissions `runtime-admin`, `status-service`,
  `notify-service`; `canGrant` for `status`/`notify`)
- `src/admin-routes.ts`, `src/admin-auth-failures.ts` (changed: dispatch of the new admin
  sections; a service token on `/admin/*` is `403`)
- `src/server.ts` (changed: `/service/*` dispatch before the read paths, `routeOf` labels,
  `ADMIN_ROUTE`)
- `src/retention.ts`, `src/start.ts`, `src/main.ts` (changed: resend command retention, wiring)
- tests, new: `src/runtime-store.test.ts`, `src/server.status-settings.test.ts`,
  `src/server.notify-channels.test.ts`, `src/server.resend.test.ts`,
  `src/server.service-auth.test.ts`
- tests, changed: `src/db.migrations.test.ts` (step 9), `src/token-scopes.test.ts`,
  `src/server.allow.test.ts`, `src/server.scopes.test.ts`, `src/retention.test.ts`,
  `src/backup.test.ts`
- bench, changed: `bench/refs.ts`, `bench/run.ts` (`--b-ref`), `bench/stack.ts` (admin tokens
  file, service tokens, runtime fixture), `bench/fixtures.ts` (admin tokens file),
  `bench/compose.bench.yaml` (api `PULSE_API_ADMIN_TOKENS_FILE`; status
  `PULSE_STATUS_API_TOKEN_FILE: ${BENCH_STATUS_TOKEN_FILE:-}`; notify
  `PULSE_NOTIFY_API_TOKEN_FILE: ${BENCH_NOTIFY_TOKEN_FILE:-}` and
  `PULSE_NOTIFY_SECRET_BENCH`; a read-only `service-tokens` mount), `bench/selftest/check-refs.ts`,
  `bench/README.md`
- bench, new: `bench/runtime-fixture.ts` (token creation and the settings and channel fixture,
  with injected `fetch`), `bench/selftest/check-runtime-fixture.ts`
- `package.json` (changed: contract pin to the merged `2.4.0` SHA; `bench:selftest` gains
  `check-runtime-fixture.ts`), `bun.lock` (changed)
- `README.md`, `docs/rest-api.md`, `docs/operation.md`, `docs/configuration.md` (changed)

Behavior change: yes. New tables, routes, scopes, audit actions and bench options.

Behavior: Decisions 3, 4, 5, 12, 14, 15 and 16, and R2.
- The component check of `componentOrder` reads the current applied components.
- The api never reads a notify reference or secret, and never validates a reference beyond the
  contract patterns.
- `GET /admin/notify/channels` computes `shadowed` from the last report's `shadowedIds`, even a
  stale one. With no report at all, `shadowed` is `[]` and `service.state` is `"never"`.
- The create collision check uses the ids of the last report's `fileChannels`.
- The aggregate byte limit is computed over the stored definitions with the candidate in place
  of its old version.
- Bench:
  - `--b-ref <repo>=<ref>` may repeat; an unknown repository, `api`, or a repeated repository
    exits `2` with a usage line. `--others-ref` still pins both sides; `--b-ref` then overrides B.
  - The admin tokens file holds one fixed bench admin token of at least 32 characters
    (`src/admin-tokens.ts:8-16`).
  - After the api is ready, `bench/runtime-fixture.ts` posts the two service tokens. On `201` it
    writes the secrets to `<run dir>/service-tokens/{status,notify}` (mode 0644, the containers'
    `bun` user reads them) and sets `BENCH_STATUS_TOKEN_FILE` and `BENCH_NOTIFY_TOKEN_FILE`. Then
    it PUTs one status settings document (`name`, `showLatency: false`) and creates five webhook
    channels (`urlEnv: PULSE_NOTIFY_SECRET_BENCH`, `checks: ["c0"]`). Any other answer to the
    token create leaves both variables empty and logs `service tokens: not available on <side>`.
  - Status and notify then start as today, after the api (`bench/stack.ts:198-199`).
  - `docker compose -f bench/compose.bench.yaml config --quiet` still passes with the defaults.

Checks (real server at `127.0.0.1:0`, `mkdtemp` database, injected `now`):
- Every R2 row has an allowed case and a denied case:
  - no token: `401`;
  - a `read` token: `403`;
  - a `status` token on `/admin/notify/channels`: `403`;
  - a `notify` token on `/service/status/settings`: `403`;
  - an admin token on `/service/notify/resends/claim`: `403`.
- Decision 16: stale and missing `If-Match` give `412` and `428` on the configuration writes; 100
  reports and 100 claims leave the notify revision unchanged (literal: the `etag` before equals the
  `etag` after); admin GETs answer `cache-control: no-store` and never `304`; service GETs answer
  `304` on a matching `If-None-Match`.
- The separate revisions of Counterexamples: a status save does not stale a channel write, and a
  check write does not stale a status save.
- The create collision with a report file id gives `409`. A shadowed PUT gives `409`, a shadowed
  DELETE `204`, a PUT of an unknown id `404`.
- Limits: the 101st channel and the byte boundary of Counterexamples (262 144 accepted, 262 145
  refused), with literal sizes built in the test.
- Resend: every Counterexample under "Resend" that touches the api, with a fake clock: idempotency,
  `requestId` conflict, open-command reuse for each open state, `503` stale (180 001 ms) and fresh
  (180 000 ms), `409` not failed, the 1000-command capacity both ways, requeue at 60 000 ms and
  not at 59 999 ms, every row of the acknowledgement rules (`204` or `409`), retention at 7 days.
- Migration: a step-8 file with checks, tokens, incidents and windows opens at version 9 with all
  rows kept. A backup holds the new tables.
- Audit rows for each configuration write and for a `202` resend hold the action, kind and target
  id, and no settings value; a `200` resend and every service route write no audit row. A
  sentinel reference name `PULSE_NOTIFY_SECRET_SENTINEL` appears in no audit row and no log line.
- Bench self-tests: `check-refs.ts` covers `--b-ref status=x` (A status = tag, B status = `x`,
  every other repository unchanged), with `--others-ref`, and the refusals; `check-runtime-fixture.ts`
  covers `201` (files written, variables set) and `422` (variables empty, log line) with a fake
  `fetch`.
- Expected codes and texts are the literals of R2 and Decision 14.
- The tests fail on `4b3e9b1` (routes `404`) and pass after.

Tool facts (api `4b3e9b1`):
- Bun `1.4.0` (`package.json:9` `engines`, `:35` `packageManager`).
- `check` is `bun run lint && bun run typecheck && bun run test` (`package.json:20`); `lint` is
  `biome check . && pulse-eslint . && pulse-workflows` (`:16`); `test` is `bun test` (`:15`);
  `bench:selftest` (`:18`).
- Biome `2.6.3` (`package.json:23`). `biome.json:2` extends `@lorenzh/pulse-config/biome.json`;
  the config pin is `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`package.json:24`). At that pin
  Biome checks `**` without `dist`, `node_modules`, `bun.lock`, `*.html` and `test/fixtures`
  (config `biome.json:8-18`), so `bench/` is linted too.
- Pins: contract `c4a2eb5214d48d40d0c1afbae5e3e49463185e15` (`package.json:31`), kit
  `c6d2cba7d90c981b884dcac2a9288dd9eccad8b5` (`:32`).
- `bunfig.toml:1-4`: `[test]` coverage on, lines `0.8`, functions `0`.
- CI (`.github/workflows/ci.yml`): `check` calls `check.yml@04108fa…` (`:17-18`), which at that
  pin (identical to the clone) runs install, lint, typecheck and test (`check.yml:25-30`,
  `:37-38`; no build). `bench-selftest` runs `bun run bench:selftest` and
  `docker compose -f bench/compose.bench.yaml config --quiet` (`:20-33`). `docker` builds the
  image (`:35-53`).

Completion evidence: `bun run check` and `bun run bench:selftest` output; the api A/B table of
Performance impact and the `cold-read.ts --seed-with` output; one manual run with `bun start`, an
admin token and a `status` token:

```sh
curl -X PUT /admin/status/settings
curl /service/status/settings
```

The output goes in the PR. Shared finding: record the api ref that has `--b-ref` and the runtime
fixture, so status, notify and contract can measure.

## Repository: status

Files:
- `src/settings.ts` (changed: new env names and token; "set" recorded per field)
- `src/runtime-settings.ts` (new: precedence merge of env, file and database into the effective
  snapshot, fingerprint, locked list, report trimming)
- `src/settings-poll.ts` (new: poll of `/service/status/settings`, re-read of local files, report)
- `src/theme-config.ts` (changed: keys from the contract constants; CSS from a snapshot)
- `src/server.ts` (changed: snapshot in place of fixed options: CSS, CSP, logo, wordmark, flags;
  readiness `settings not loaded`; `/page-settings.json`)
- `src/answer-cache.ts`, `src/http-cache.ts` (changed: fingerprint in the key and the ETag;
  in-flight rule)
- `src/api-filter.ts`, `src/hidden-checks.ts` (changed: `showLatency`, `showSlos` filtering)
- `src/poller.ts` (changed: `latencyMs: 0` placeholder in `fillLocations`, validated copy only)
- `src/render.ts` (changed: no latency label for a result without `latencyMs`)
- `src/components-view.ts` (changed: order)
- `src/sections.ts`, `src/component-latency.ts` (changed: latency and SLO switches)
- `public/client.js` (changed: fingerprint poll and one reload)
- `src/start.ts`, `src/main.ts` (changed: wiring)
- tests, new: `src/runtime-settings.test.ts`, `src/settings-poll.test.ts`,
  `src/server.runtime-settings.test.ts`
- tests, changed: `src/poller.test.ts`, `src/render.test.ts`, `src/api-filter.test.ts`,
  `src/server.privacy.test.ts`, `src/server.cache.test.ts`, `src/answer-cache.test.ts`,
  `src/http-cache.test.ts`, `src/components-view.test.ts`, `src/settings.test.ts`,
  `src/theme-config.test.ts`, `src/main.startup.test.ts`
- `e2e/run.ts` (changed: browser convergence and the `showLatency:false` refresh)
- `package.json`, `bun.lock` (changed: contract pin to the merged `2.4.0` SHA)
- `README.md`, `docs/configuration.md`, `docs/theming.md`, `docs/operation.md` (changed)

Behavior change: yes. New settings, live apply and new routes.

Behavior: Decisions 2 and 5–10, and the report size rule of R1.
- Without a token, the database layer is empty and nothing is reported. The status settings file
  and the new env names still work.
- Without either, the effective settings equal today's.
- The report goes to `PUT /service/status/report` after every apply attempt and at least every
  60 s.
- `poller.ts` is a browser module (`AGENTS.md`, "This repository"); the placeholder change stays
  free of `node:` imports.
- `docs/operation.md` names the full/dev `PULSE_STATUS_SHOW_CHECKS` lock.
- Empty `PULSE_STATUS_API_TOKEN_FILE` (as the bench passes on side A) means not set
  (kit `readString`).

Checks (fake api on `127.0.0.1:0`, fake clock and timers):
- A per-field matrix covers name, `logoUrl`, each theme token group (one colour per mode, one
  font, one radius), `componentOrder`, and each of the four flags in both directions. For each
  field:
  - the database value applies after one poll without a new server;
  - an env value, or a file value, wins and appears in `locked`;
  - removing the file key brings back the database value;
  - clearing the database key brings back the default.
- The Counterexamples' precedence, theme merge, order, visibility and in-flight cases. The
  expected values are literals.
- Poller (`src/poller.test.ts`): a `/api/checks` body with one check whose
  `locations[0].result` has no `latencyMs` refreshes with no error state, and the returned check
  has no `latencyMs` key. The same body on `8b6d431` fails with the path
  `checks[0].locations[0].result.latencyMs`.
- Render: `renderLatency` of that check returns `""`.
- CSP `img-src` follows a new `logoUrl` origin.
- `/theme.css` changes its body and ETag after a theme change.
- `/page-settings.json` changes.
- Bad answers keep the last good snapshot and report `rejected`, then recover on the next good
  poll:
  - a `200` with an invalid body;
  - a body over 1 048 576 bytes;
  - a wire mismatch;
  - an api timeout;
  - an invalid settings file.
- `404` from an older api: the database layer is empty and the page is ready.
- A token is set and no read has succeeded yet: the page answers `503`.
- A report with a 500-entry `componentOrder` of escaped characters stays at most 524 288 bytes.
- Browser (`e2e/run.ts`): an open page reloads once after a fingerprint change and shows the new
  name and no checks list; with `showLatency:false` and populated results, the page refreshes and
  shows no latency label.
- The tests fail on `8b6d431` and pass after.

Tool facts (status `8b6d431`):
- Bun `1.4.0` (`package.json:9` `engines`, `:38` `packageManager`).
- `check` is `bun run lint && bun run typecheck && bun run test` (`package.json:19`); `lint` is
  `biome check . && pulse-eslint . && pulse-workflows` (`:15`); `typecheck` also checks `e2e`
  (`:13`); `test` is `bun test` (`:14`); `check:a11y` is `bun e2e/run.ts` (`:18`).
- Biome `2.6.3` (`package.json:23`). `biome.json:2` extends the config; pin
  `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`package.json:24`). At that pin Biome checks `**`
  without `dist`, `node_modules`, `bun.lock`, `*.html` and `test/fixtures` (config
  `biome.json:8-18`), so `public/client.js` and `e2e/run.ts` are linted, `public/*.html` is not.
- Pins: contract `9ab7e2492a2cec91789fba7c742bdba900a800a9` (`package.json:34`), kit
  `236df214f9df8658f2992dd6f7c100952c07102b` (`:35`).
- `bunfig.toml:1-4`: `[test]` coverage on, lines `0.8`, functions `0`.
- CI (`.github/workflows/ci.yml`): `check` calls `check.yml@04108fa…` (`:17-18`), which runs
  install, lint, typecheck and test at that pin (`check.yml:25-30`, `:37-38`). `docker` builds the
  image (`:20-49`). `a11y` installs Chromium and runs `bun run check:a11y` (`:51-68`).

Completion evidence: `bun run check` and `bun run check:a11y` output; the status A/B table of
Performance impact (read the shared finding for the api ref first); one manual run against a local
api with a `status` token, changing `showChecks` in the database and showing the changed
`/api/checks` without a restart.

## Repository: notify

Files:
- `src/config.ts` (changed: token, database-only mode, `PULSE_NOTIFY_SECRET_DIR`, poll settings,
  webhook `urlEnv`/`urlFile`, resolving one channel at a time)
- `src/channel-schema.ts` (changed: webhook references, exactly one of `url`, `urlEnv`, `urlFile`)
- `src/remote-channels.ts` (new: poll of `/service/notify/channels`, database channel validation
  with the notify-local reference rules, secret directory resolution)
- `src/channel-set.ts` (new: effective set, shadowing, per-id diff)
- `src/notifier.ts`, `src/delivery.ts` (changed: reconcile: install, replace, remove workers;
  live enqueue of a resent key; final outcome hook)
- `src/resend-commands.ts` (new: claim, execute in one transaction, post results with the
  acknowledgement rules)
- `src/service-report.ts` (new: report with file channel views, shadowed ids, rejected list,
  failed list, size trimming)
- `src/ledger.ts` (changed: format 5 with `remote_channels` and `resend_commands` tables;
  migration from 4; prune of finished command rows)
- `src/failed-cli.ts` (changed: opens format 5)
- `src/metrics.ts` (changed: series per installed channel)
- `src/api.ts`, `src/index.ts` (changed: Bearer on `/service/*` only; wiring)
- tests, new (in `test/`, the repository's test directory, `AGENTS.md:108`):
  `test/remote-channels.test.ts`, `test/channel-set.test.ts`, `test/reconcile.test.ts`,
  `test/resend-commands.test.ts`, `test/service-report.test.ts`, `test/ledger.v5.test.ts`
- tests, changed: `test/support.ts` (fake api `/service/notify/*` routes), `test/config.test.ts`,
  `test/index.test.ts`, `test/ledger.test.ts`, `test/failed-cli.test.ts`, `test/webhook.test.ts`,
  `test/metrics.test.ts`
- `package.json`, `bun.lock` (changed: contract pin to the merged `2.4.0` SHA)
- `README.md`, `AGENTS.md` (ledger format), `docs/configuration.md`, `docs/channels.md`,
  `docs/operation.md` (changed)

Behavior change: yes. Live reload, database channels, live resend and a new ledger format.

Behavior: Decisions 2, 5, 6 and 11–14, and the report size rule of R1.
- The public reads stay without a token.
- The failed CLI still refuses with exit `2` while the service holds the lock. When notify is
  stopped, the CLI works offline on format 5 as before, and `docs/operation.md` describes both
  ways.
- A format-5 ledger opened by an older notify is refused by its version check, as today. The docs
  say downgrade is not supported.
- Empty `PULSE_NOTIFY_API_TOKEN_FILE` (as the bench passes on side A) means not set (kit
  `readString`).

Checks (fake api and fake receivers on `127.0.0.1:0`, fake clock and timers, `mkdtemp` ledger):
- Database-only start with zero channels:
  - a database webhook appears on the next poll;
  - a new matching incident is delivered once;
  - old incidents are seeded, not sent.
- Each routing field (`checks`, `excludeChecks`, `components`, `excludeComponents`, `alerts`,
  `sendIncidents`, `remindEverySeconds`) has a matching and a non-matching event after a live
  change. Widening the routing seeds quietly.
- File-over-database shadowing for the whole channel; the report's `shadowedIds` holds the id.
  Removing the file channel live unshadows the database copy. No field mixing: the receiver hit
  is at the file destination.
- Changed destination with a pending retrying job: the job goes to the new receiver only, once.
- Removed channel with a pending entry: not sent. Re-added: sent once.
- A slow channel does not block another channel or the poll.
- A missing secret reference keeps the last good version and reports a reason without the value.
- A sentinel secret value appears in no report body, log line or metric.
- A channels answer over 1 048 576 bytes keeps the last good set and is reported.
- Live resend:
  - a failed entry is resent through a claimed command;
  - the receiver gets exactly one more request (literal `1`) with the same `idempotency-key`;
  - the command ends `delivered`;
  - a second claim of the same id posts the stored state and sends nothing;
  - the Counterexamples' lost admission answer, lost final answer and `409` cases, with a fake
    api that drops or refuses answers;
  - a crash simulated between the transaction commit and the enqueue: a new notify on the same
    ledger sends once.
- Partial SMTP failure: a resend retries only the refused recipients (fake SMTP).
- Report trimming of Counterexamples: at most 524 288 bytes, totals kept.
- Ledger 4 → 5 migration keeps every entry; the prune keeps unposted command rows.
- The tests fail on `c79f0b7` and pass after.

Tool facts (notify `c79f0b7`):
- Bun `1.4.0` (`package.json:9` `engines`, `:35` `packageManager`).
- `check` is `bun run lint && bun run typecheck && bun run test` (`package.json:17`); `lint` is
  `biome check . && pulse-eslint . && pulse-workflows` (`:14`); `test` is `bun test` (`:13`),
  which finds the suites in `test/`.
- Biome `2.6.3` (`package.json:21`). `biome.json:2` extends the config; pin
  `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`package.json:22`). At that pin Biome checks `**`
  without `dist`, `node_modules`, `bun.lock`, `*.html` and `**/test/fixtures` (config
  `biome.json:8-18`), and turns `noNonNullAssertion` off in `**/test/**` (`:53-63`).
- Pins: contract `9ab7e2492a2cec91789fba7c742bdba900a800a9` (`package.json:30`), kit
  `236df214f9df8658f2992dd6f7c100952c07102b` (`:31`).
- `bunfig.toml:1-4`: `[test]` coverage on, lines `0.8`, functions `0`, `test/**` ignored for
  coverage.
- CI (`.github/workflows/ci.yml`): `check` calls `check.yml@04108fa…` (`:17-18`), which runs
  install, lint, typecheck and test at that pin (`check.yml:25-30`, `:37-38`). `docker` builds and
  smoke-tests the image (`:20-92`).

Completion evidence: `bun run check` output; the notify A/B table of Performance impact (read the
shared finding for the api ref first), with `test_cpu_s` called out; a local timing of opening a
format-4 ledger with 10 000 entries as format 5 (reported, not gating); one manual run with a
local api, a `notify` token and a fake webhook receiver, showing a database channel added and a
resend delivered without a restart.

## Repository: console

Files:
- `src/navigation.ts`, `src/icons.ts` (changed: ids `status-page`, `notifications`)
- `src/status-page-pages.ts`, `src/status-page-routes.ts` (new)
- `src/notification-pages.ts`, `src/notification-routes.ts` (new: list, new, edit, delete,
  failed, resend)
- `src/runtime-read.ts`, `src/runtime-write.ts` (new: reads and writes of the R2 admin routes, in
  the check write pattern)
- `src/api-failure.ts` (changed: `ApiCall` values `status-settings`, `notify-channels`,
  `notify-failed`, `notify-resend`)
- `src/people-log.ts` (changed: actions and targets of Decision 15)
- `src/token-view.ts`, `src/token-pages.ts` (changed: presets "Status service" `["status"]` and
  "Notify service" `["notify"]`; `missingScope` maps both to `admin`)
- `src/server.ts` (changed: route registration)
- tests, new: `src/server.status-page.test.ts`, `src/server.notifications.test.ts`,
  `src/runtime-read.test.ts`, `src/runtime-write.test.ts`
- tests, changed: `src/navigation.test.ts`, `src/icons.test.ts`, `src/people-log.test.ts`,
  `src/token-view.test.ts`, `src/token-read.test.ts`, `test/fake-api.ts`
- `e2e/run.ts` (changed: fixture pages, keyboard move controls)
- `package.json`, `bun.lock` (changed: contract pin to the merged `2.4.0` SHA)
- `README.md`, `docs/configuration.md`, `docs/team.md` (`settings.edit` is now built),
  `docs/tokens.md` (changed)

Behavior change: yes. New screens, routes and token presets.

Behavior: R3, and Decision 14 for the resend button.
- A Resend form holds a `requestId` of 24 random base64url characters. A repeat after a lost
  answer posts the same `requestId`.
- The People log row is written for saved and unknown outcomes, as for checks.
- The token list accepts tokens with the new scopes.
- The console reads admin views with the contract default limit (5 MiB, contract
  `client.ts:7`); the largest view is under 1 MiB (R1).

Checks (real console server, fake api on `127.0.0.1:0`):
- Owner can save, delete and resend. Admin, Member and Viewer get `403` on direct GET and POST of
  every new route (literal `403`).
- A role change between read and write gives `403`.
- Invalid Origin, CSRF and replayed form tokens are refused (`403`, `403`, `409`).
- Locked fields are read-only, and a forged POST of a locked field is refused by the console with
  `422`, and nothing is sent.
- Each state: `412` keeps the input; token rejected; old api (`404`); stale report; rejected
  apply; zero channels; `422` channel limit; `503` resend.
- A repeated Resend post after a fake api timeout sends the same `requestId` (the fake api sees
  two equal values).
- No secret value field exists in any form, and a forged `url` field is not forwarded (fake api
  sees no `url`).
- The token list with a `notify` token renders.
- Browser (`e2e/run.ts`): keyboard-only reorder of three components and save.
- The tests fail on `fc2c166` and pass after.

Tool facts (console `fc2c166`):
- Bun `1.4.0` (`package.json:9` `engines`, `:35` `packageManager`).
- `check` is `bun run lint && bun run typecheck && bun run test` (`package.json:18`); `lint` is
  `biome check . && pulse-eslint . && pulse-workflows` (`:15`); `typecheck` also checks `e2e`
  (`:13`); `test` is `bun test` (`:14`); `check:browser` is `bun e2e/run.ts` (`:19`).
- Biome `2.6.3` (`package.json:23`). `biome.json:2` extends the config; pin
  `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`package.json:24`). At that pin Biome checks `**`
  without `dist`, `node_modules`, `bun.lock`, `*.html` and `test/fixtures` (config
  `biome.json:8-18`), so `src/`, `test/` and `e2e/` are linted.
- Pins: contract `66818a24b81f5d0d86eee939dad64fa126617ba2` (`package.json:32`), kit
  `536133f3e8b708179fa01feeb02395a0e1961e07` (`:33`).
- `bunfig.toml:1-4`: `[test]` coverage on, lines `0.8`, functions `0`.
- CI (`.github/workflows/ci.yml`): `check` calls `check.yml@04108fa…` (`:17-18`), which runs
  install, lint, typecheck and test at that pin (`check.yml:25-30`, `:37-38`). `docker`
  (`:20-229`), `deploy-dev` with deploy, api, probe, status and notify at `main` (`:231-289`), and
  `browser` running `bun run check:browser` (`:291-308`).

Completion evidence: `bun run check` and `bun run check:browser` output; a manual run against a
local api with screenshots of both screens in the PR.

## Repository: deploy

Files:
- `e2e/compose.runtime.yaml` (new, test only: status `PULSE_STATUS_API_TOKEN_FILE`, notify
  `PULSE_NOTIFY_API_TOKEN_FILE`, `PULSE_NOTIFY_SECRET_DIR`, `PULSE_NOTIFY_SECRET_E2E_HOOK`,
  `PULSE_NOTIFY_RETRY_ATTEMPTS: "2"`, `PULSE_NOTIFY_RETRY_DELAY_MS: "500"`, read-only token and
  secret mounts, and the `e2e-hook` receiver service)
- `e2e/hook.mjs` (new: webhook receiver that counts requests per `idempotency-key` and can be
  switched between `500` and `200`)
- `e2e/runtime-settings.sh` (new: the scenario), `e2e/runtime-settings.test.sh` (new: its parsing
  helpers on fixed fixture answers, and `docker compose ... config --quiet` of the overlay)
- `e2e/compose-e2e.sh` (changed: a "Runtime settings" step after "Console probe locations",
  in the pattern of `:1097-1120`)
- `.github/workflows/ci.yml` (changed: a `lint` step `bash e2e/runtime-settings.test.sh` after
  `:67`; in `e2e-dev`, `grep -qx 'ok: runtime settings' e2e-dev.log` after `:306`)
- `README.md`, `full/README.md`, `dev/README.md` (changed)

Behavior change: yes. A new CI scenario and CI steps.

Behavior:
- `full/README.md` and `dev/README.md` document the operator steps with a Compose override file:
  1. update the console first;
  2. create the two service tokens in the console Tokens page;
  3. write them to files and mount them read-only;
  4. set `PULSE_STATUS_API_TOKEN_FILE`, `PULSE_NOTIFY_API_TOKEN_FILE`, and the
     `PULSE_NOTIFY_SECRET_*` variables or `PULSE_NOTIFY_SECRET_DIR`;
  5. recreate status and notify once.
- `PULSE_STATUS_SHOW_CHECKS: "true"` stays and is documented as a lock of that field.
- The step in `e2e/compose-e2e.sh`:
  - with `E2E_SETUP=full`, prints `skip: runtime settings (published images)`;
  - in the dev setup, prints `skip: runtime settings (api has no /admin/notify/channels)` when
    `GET /admin/notify/channels` with the admin token does not answer `200`; otherwise it runs
    `e2e/runtime-settings.sh` and prints `ok: runtime settings` on success.
- `e2e/runtime-settings.sh`:
  1. Create a `status` and a `notify` token with `POST /admin/tokens`, and write them to a `0700`
     temp directory that the overlay mounts.
  2. Recreate status and notify with the overlay added
     (`docker compose -f <base> -f e2e/compose.e2e.yaml -f e2e/compose.runtime.yaml up -d
     --no-deps --force-recreate status notify e2e-hook`).
  3. Sign in as Owner, as `e2e/console-setup.sh` does.
  4. Save `name` and `showLatency=false` through the console form, and see the public page change
     within 30 s without restarting status.
  5. Create a database webhook channel with `urlEnv: PULSE_NOTIFY_SECRET_E2E_HOOK` through the
     console, and see one delivery of a new incident at `e2e-hook`.
  6. Switch the receiver to `500` until the console failed list shows the delivery, switch it to
     `200`, press Resend once, and see exactly one more request with the same `idempotency-key`
     (literal `1`).
  7. Check that the status `showChecks` field shows "Set by PULSE_STATUS_SHOW_CHECKS".
  8. Check that no token value appears in the step output (the pattern of `:1110-1115`).
  9. Recreate status and notify without the overlay, so the later steps run as before.

Checks:
- `bash e2e/runtime-settings.test.sh` passes in `lint`.
- CI `e2e-dev` greps `ok: runtime settings` on images built from `main`, after the four services
  merged. The expected line is a literal.
- `full` stays green on the published images: the step prints `skip`.
- shellcheck and `bash -n` pass on the new scripts, `node --check` on `e2e/hook.mjs`.

Tool facts (deploy `e754d46`):
- Bun `1.4.0` (`package.json:9` `engines`, `:28` `packageManager`).
- `check` is `bun run lint && bun run typecheck && bun run test` (`package.json:18`); `test` is
  `bun test --coverage cli` (`:13`).
- Biome `2.6.3` (`package.json:21`); config pin `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`
  (`:22`). `biome.json:2` extends the config, and `biome.json:3-27` narrows the scope to `cli/**`
  and the root config files and excludes `e2e`, `full`, `dev` and `scripts` (`:12-21`). The new
  files are therefore not Biome-checked.
- CI (`.github/workflows/ci.yml`): `check` calls `check.yml@04108fa…` (`:17`), which runs install,
  lint, typecheck and test at that pin (`check.yml:25-30`, `:37-38`). `lint` runs shellcheck and
  `bash -n` on every tracked `*.sh` (`:34-37`), `node --check` on every `*.mjs` (`:38-39`),
  `jq empty` on every `*.json` (`:40-41`), and the explicit test list (`:42-67`); a new
  `*.test.sh` needs its own step there. `e2e-dev` runs `E2E_SETUP=dev bash e2e/compose-e2e.sh |
  tee e2e-dev.log` and greps its `ok:` lines (`:302-306`).

Completion evidence: CI `e2e-dev` log with `ok: runtime settings`; CI `lint` log with
`bash e2e/runtime-settings.test.sh`; `bun run check` output.

## Acceptance evidence (feature)

1. contract `bun run check` and the dist diff.
2. api, status, notify and console `bun run check`, plus the api `bench:selftest`, the status
   `check:a11y` and the console `check:browser`, each with tests that fail on the cited heads.
3. Per-setting live tests in status and notify:
   - a database change reaches the running service without a restart;
   - a file value overrides the database value.

   The expected values are literals in the tests (Counterexamples).
4. The notify resend test: exactly one more receiver request with the same key, from a single
   command, also after a lost admission answer. Expected count `1`, a literal.
5. The status poller test: a `/api/checks` answer without `latencyMs` refreshes without an error
   state (literal: no error kind), and fails on `8b6d431`.
6. The api limit tests: 262 144 bytes accepted and 262 145 refused, the 101st channel refused, and
   the 1000-open-command `503`; all literals.
7. The A/B tables of Performance impact in the api, status, notify and contract PRs, produced by
   `bun bench/run.ts` with `--b-ref` (two independently built sides).
8. deploy `e2e-dev` prints `ok: runtime settings`. This is the integrated check across console,
   api, status, notify and a fake receiver.
