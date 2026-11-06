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

  The second plan-review asked for six more corrections; this version makes them too:
  1. every `requestId` the api answered is stored, so a retry after a lost `200` never creates a
     second command (Decision 14, table `resend_requests`);
  2. size limits that every valid value fits through end to end: a radius limit, a status
     settings byte limit, a per-channel byte limit that fits the console form, admin views that
     no longer copy the report, and report bodies limited at the api (Decisions 9, 12, R1, R3);
  3. an executable measurement: contract measures its own CPU without the api harness; the api
     harness simulates and counts the service traffic; status and notify measure after the api
     is merged, on the same api on both sides, and a failed token creation fails the run
     (Performance impact; status and notify now depend on api);
  4. the status contract pin and the served contract module list change together (status
     section);
  5. a per-field live and precedence matrix for every exposed notify field (notify section);
  6. one rule for a missing settings file and one capacity rule for resend commands, with the
     counterexamples changed to match (Decisions 7, 14, Counterexamples).

  The third plan-review asked for four more corrections; this version makes them:
  1. notify's format-5 change updates the suites that assert format 4 today
     (`test/ledger.test.ts`, `test/ledger.v4.test.ts`, `test/reminders.test.ts`), and the
     migration from 4 keeps the 3 → 4 checks for crashes and refusals (Decision 17, notify
     section);
  2. a controlled A/B: `--others-ref main` on both sides, every ref resolved once to a SHA and
     every checkout verified, so only the measured repository differs; the simulated traffic is
     counted per service, 2 status and 2 notify reports (Performance impact, api section);
  3. notify's report normalization: a cut rule for display names and references, left-out
     failed entries for keys a resend needs exactly, and an event enum and mapping that cover
     `update`, `budget-low`, `tls-expiry`, `domain-expiry` and payloadless entries (R1);
  4. the deploy scenario fails a separate event while the receiver answers `500`, then resends
     exactly that key (deploy section).
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

1. **One spec, six repository sections.** contract → api and console (in parallel) → status and
   notify (in parallel, after api) → deploy. Each of api, status, notify and console implements
   its own side of the HTTP interface this spec defines, and each builds and passes its checks
   against a fake api. Status and notify wait for the merged api only because their performance
   evidence needs it: an A/B run on the same api on both sides, with the bench harness and the
   service routes of this feature (Performance impact). Without that wait, the B side of their
   measurement would have no api that accepts their tokens.
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
   - `resend_commands`: id, request id (of the request that created it), channel id, key, state,
     created, updated and claimed times.
   - `resend_requests`: request id (primary key), command id, channel id, key and created time.
     One row for every `requestId` the api answered with `200` or `202` (Decision 14).
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
   - "Malformed" has two levels for the notify channels answer, and one for everything else.
     The status settings answer, the resend claim answer and every other `/service/*` answer
     are validated whole: one bad field rejects the whole answer. The notify channels answer
     (`GET /service/notify/channels`) is validated in two steps (R1,
     `validateServiceNotifyChannels` and `validateNotifyChannelRecord`):
     - **Envelope**, whole answer: body size, wire version, the top-level object `{revision,
       channels}` with no other key, `revision` a valid revision, `channels` an array of
       0..100 elements (`NOTIFY_CHANNEL_MAX`), each element a plain object whose own `id` is a
       string matching the database id pattern (Decision 12), and no id twice. A failure keeps
       the whole last good set, the stored ETag and the persisted rows (Decision 17) unchanged,
       and reports one `rejected` entry `{channelId: null, reason: "channels answer: <validator
       error>"}`; `appliedRevision` stays the earlier one.
     - **Per channel**, after a valid envelope: each element is checked on its own with
       `validateNotifyChannelRecord`, which includes the 16 384-byte definition limit, the
       type set and the reference rules. A valid element is a candidate for Decision 13. An
       invalid element is reported as `{channelId: <its id>, reason: "channels[<i>]: <validator
       error>"}` (cut by the R1 cut rule) and is handled like a channel whose secret cannot be
       resolved (Decision 13): its last good version, the one installed before this answer,
       stays installed if one exists; otherwise that id is not installed. The other channels
       of the answer apply.
     - With a valid envelope the answer is applied: its `revision` becomes `appliedRevision`
       and its ETag is stored, even when some channels were rejected. The next poll therefore
       gets `304`, and the rejections stay in every report until the api serves a changed
       answer. The console shows them per channel (R3, `rejected`).
     - Notify does not re-check the 262 144-byte aggregate (`NOTIFY_CHANNELS_MAX_BYTES`); the
       api applies it on writes, and the 1 048 576-byte answer limit bounds what notify reads.
7. **Status local file.** A new optional `PULSE_STATUS_SETTINGS_FILE` holds a JSON document of the
   same `StatusSettings` shape as the database.
   - A key that is present is file-origin. An absent key is not set.
   - The existing `PULSE_STATUS_THEME` file keeps working: its present tokens are file-origin.
     When both the theme file and a `theme` key in the settings file are set, start fails with
     exit `2`.
   - Status re-reads the settings file and the theme file at each settings poll. A changed, valid
     file applies live. The env stays fixed for the life of the process.
   - One rule for a file that cannot be used, whatever the cause (invalid JSON, a value outside
     the rules, a read error, or a file that no longer exists): status keeps the last good values
     of that file and reports `rejected` with `source: "file"` and a reason such as `settings
     file: cannot read: ENOENT`. Deleting the file is therefore not a way to remove overrides.
     An override is removed by removing its key from the file, or by writing `{}`: the database
     value, else the default, then applies on the next poll.
   - At start, a configured file that cannot be used fails the start, as an unreadable theme file
     does today (`theme-config.ts:108-113`, thrown while the server is made at `server.ts:689`).
   - The settings file is read with a limit of 1 048 576 bytes; a larger file cannot be used.
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
   - `logoUrl`: a database or file value is an `https:` URL of at most 2048 printable ASCII
     characters (`0x21`..`0x7e`, without `"`, `\`, `<` and `>`), without userinfo. A local logo
     file is only possible through `PULSE_STATUS_LOGO`, as today.
   - `theme`: `{light?, dark?, "font-sans"?, "font-mono"?, "radius-sm"?, "radius-md"?,
     "radius-pill"?}`. The keys and value rules are those of `src/theme-config.ts:6-54`, with one
     addition: a radius is at most 32 characters (`STATUS_RADIUS_MAX`). Today `RADIUS_RE`
     (`theme-config.ts:41`) has no length limit, so an unbounded digit string would pass. The
     limit applies to the database and to the settings file (both use the contract validator).
     The legacy `PULSE_STATUS_THEME` file keeps today's rule, so no existing file breaks; such a
     token reaches only the local snapshot, and its report `value` follows the 2 048-byte rule of
     R1. Tokens are merged per token, so a partial file theme leaves the other database tokens in
     force.
   - `componentOrder`: 0..500 unique ids (`STATUS_COMPONENT_ORDER_MAX`), each matching the
     contract component id rule: at most 64 characters of `^[a-z0-9][a-z0-9._-]*$`
     (`MAX_COMPONENT_ID` and `COMPONENT_ID`, contract `src/schema.ts:776-797`). A list of ids that
     no component can have is therefore refused by the contract already.
   - Size: a whole `StatusSettings` document is at most 65 536 bytes as UTF-8
     `JSON.stringify` (`STATUS_SETTINGS_MAX_BYTES`), checked by the contract validator. The
     field rules already keep every valid document below about 40 000 bytes (R1, "Size
     bounds"), so the byte limit only guards against a rule that a later change loosens.
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
      valid file reconciles. A file that cannot be used, a deleted one included, keeps the last
      good set and is reported, as for status (Decision 7). A file channel is removed by removing
      it from the file.
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
      references and `statusUrl` follow their own rules above. On top of that, one definition is
      at most 16 384 bytes as UTF-8 `JSON.stringify(definition)`
      (`NOTIFY_CHANNEL_DEFINITION_MAX_BYTES`), checked by the contract validator. The list rules
      alone would allow a webhook with four 200 × 200-character routing lists (about 162 000
      bytes), which no console form could carry. With the byte limit, the console channel form
      of R3 (65 536 bytes) carries every valid definition: form encoding takes at most 3 bytes
      per JSON byte (`%XX`), a list separator is at most 6 bytes (`%0D%0A`) against 3 in JSON
      (`","`), and the field names, form token and revision add at most 8 192 bytes, so
      3 × 16 384 + 8 192 = 57 344 ≤ 65 536.
    - Aggregate: at most 100 database channels (`NOTIFY_CHANNEL_MAX`), and the sum over all of
      them of the UTF-8 byte length of `JSON.stringify(definition)` is at most 262 144
      (`NOTIFY_CHANNELS_MAX_BYTES`). The api refuses a create or replace that would exceed any of
      the three byte or count limits with `422`. With 100 × at most 120 bytes for `createdAt`,
      `updatedAt`, `source` and separators, the largest `GET /service/notify/channels` answer is
      at most 262 144 + 12 000 + 200 = 274 344 bytes, under the 1 048 576 limit of Decision 6.
      (Without the aggregate limit, 30 webhooks with one 200 × 200-character list each would
      reach 1 220 399 bytes, as the first plan-review computed.)
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
      (format 5, Decision 17). A cold start with the api down therefore still runs them.
14. **Resend.**
    - **States.** Open: `queued`, `claimed`, `admitted`. Finished: `delivered`, `failed`, `dropped`,
      `not-failed`, `no-payload`, `channel-unavailable`. Admission outcomes: `admitted`,
      `not-failed`, `no-payload`, `channel-unavailable`. Final outcomes: `delivered`, `failed`,
      `dropped`.
    - **Create** (`POST /admin/notify/resends`, body `{channelId, key, requestId}`; `requestId`
      matches `^[A-Za-z0-9_-]{16,64}$` and the console creates it when it renders the button).
      The api checks in this order, in one transaction under the write lock:
      1. a `resend_requests` row with this `requestId` exists:
         - its `channelId` and `key` differ → `409` `requestId was used for another delivery`;
         - its command still exists → `200` with that command, in whatever state it is now
           (`failed` included);
         - its command was deleted (by capacity, step 5, or by retention, because a reuse row can
           be younger than its command) → `409` `the resend request was already handled; reload
           the failed list`. The row's `command id` is therefore a plain column, with no foreign
           key that would delete the row with its command.
         No new command and no new row are made in any of these cases;
      2. an open command for the same `(channelId, key)` exists → a `resend_requests` row
         (`requestId` → that command) is inserted, then `200` with the command. When the
         `resend_requests` table already holds 10 000 rows (step 5), the answer is that step's
         `503` instead, and nothing is stored;
      3. the notify report is `stale` or `never` → `503` `pulse-notify has not reported recently`;
      4. the report's `failed` list holds no entry with this `(channelId, key)` → `409` `not a
         failed delivery`;
      5. capacity:
         - the `resend_requests` table holds 10 000 rows (`RESEND_REQUEST_MAX`) → `503` `too many
           resend requests` with `retry-after: 60`. Request rows are deleted only by retention
           (7 days), never to make room;
         - the `resend_commands` table holds 1000 commands (`RESEND_COMMAND_MAX`) → the single
           oldest finished command (smallest `updatedAt`, then smallest `id`) is deleted, so 999
           remain and the new command makes 1000 again. Its `resend_requests` rows stay; step 1
           then answers `409` for them. When no command is finished, the answer is `503` `too
           many open resend commands` with `retry-after: 60`;
      6. a new `queued` command with an api-made id (24 random base64url characters) and its
         `resend_requests` row → `202`, and one audit row `notify-resend.create`.
      - Steps 2 and 6 store the `requestId` in the same transaction as the answer they give, so
        every `requestId` that ever received `200` or `202` gets the same command again on a
        retry, as long as its row exists (7 days; the console's form token, which carries the
        `requestId`, lives 12 hours: console `src/form-tokens.ts:2`). A `503` or `409` of steps
        3 to 5 stores nothing, and a retry is evaluated again from step 1.
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
      `createdAt` is more than 7 days old (604 800 000 ms, `RESEND_RETENTION_MS`), in any state,
      and every `resend_requests` row whose own `createdAt` is more than 7 days old. Notify then
      gets `404` for a late result and stops posting it.
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
    | `POST /admin/notify/resends` | ignored | none | `notify-resend.create`, only on `202` | every answered `requestId` stored in `resend_requests` (Decision 14) |
    | `PUT /service/status/report` | ignored | none | none | whole replace, last write wins; body at most 524 288 bytes |
    | `PUT /service/notify/report` | ignored | none | none | whole replace, last write wins; body at most 524 288 bytes |
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
17. **Notify ledger format 5.** Format 5 is format 4 (`src/ledger.ts:37-63`) plus two `STRICT`
    tables, with `PRAGMA user_version = 5` (`LEDGER_VERSION`, `:31`):
    - `remote_channels (id TEXT PRIMARY KEY, definition TEXT NOT NULL, revision TEXT NOT NULL,
      applied_at INTEGER NOT NULL)`: one row per database channel that is installed after the
      last applied channel answer (Decision 13), `definition` its canonical JSON (references
      only, never a resolved value), `revision` the notify revision of the answer it came from.
      A channel taken from that answer has that answer's revision; a channel whose element was
      rejected, or whose secret could not be resolved, and whose last good version stays
      installed keeps its earlier row, revision and `applied_at` unchanged; a rejected id with
      no last good version has no row. A reconcile replaces all rows in one transaction. An
      answer whose envelope fails (Decision 6) changes no row.
    - `resend_commands (id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, key TEXT NOT NULL, state
      TEXT NOT NULL CHECK (state IN ('admitted','delivered','failed','dropped','not-failed',
      'no-payload','channel-unavailable')), posted_state TEXT CHECK (posted_state IS NULL OR
      posted_state IN (<the same seven>)), updated_at INTEGER NOT NULL)`: the notify side of
      Decision 14.
    - Loading a format-5 file validates every row of both tables, as format 4 does for its
      tables (`loadAlerts` and `loadRows`, `:420-443`); a bad row, or a format-5 file without
      either table, refuses the file (`unsupported format`) with its bytes unchanged.
    - **Migration.** The existing migration of format 3 (`:641-651`, the order documented in
      `docs/operation.md:8`) is generalized from one previous version (`PREVIOUS_VERSION`, `:34`)
      to two, 3 and 4:
      - a format-3 or format-4 file is validated read-only as its own format, checkpointed,
        validated again, copied to a private `<state>.v<N>.bak` (mode `0600`, an old backup or
        symlink removed first), built as format 5 at `<state>.migrating` and renamed over the
        path; the service logs `ledger migrated` with `from: 3` or `from: 4`;
      - format 4 → 5 keeps every channel, mark, entry, payload, recipient record and
        `alert_state` row. Today's `publish` (`:546-568`) writes only the channel rows
        (`writeRows`), so it gains the alert rows; format 3 → 5 starts with an empty alert
        state, as 3 → 4 does today. Both new tables start empty;
      - a JSON ledger of format 1 or 2 migrates directly to format 5, as it does to 4 today;
      - an interruption at any step leaves the old file with every row, and the next start
        migrates again;
      - any other `user_version` (6 and above included) is refused, as today.
    - Downgrade to a format-4 notify: stop, restore `<state>.v4.bak` to `<state>`, remove
      `<state>-wal` and `<state>-shm`, as `docs/operation.md:187` describes for format 3. Events
      settled and resend commands handled after the migration are lost and may be sent again.
    - The failed CLI opens and migrates the ledger in the same way (`failed-cli.ts`, unchanged
      call).

## Scope

- contract: schemas and validators for the new shapes, two new scopes, new audit actions and
  kinds, new constants.
- api: storage, admin routes, service routes, reports, the resend queue, audit; the bench
  options, the service-token fixture and the simulated service traffic for the A/B
  measurements.
- status: the new settings, the local settings file, token, poll, live apply, report, the poller
  placeholder, the served contract modules.
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
    share one list. Their values are the keys of status `src/theme-config.ts:6-29`, in that order;
  - the whole document is at most `STATUS_SETTINGS_MAX_BYTES` (65 536) bytes as UTF-8
    `JSON.stringify`, message `settings: must be at most 65536 bytes as JSON`.
- **`ServiceStatusSettings`** (answer of `GET /service/status/settings`): `{revision: Revision,
  settings: StatusSettings}`.
- **`StatusServiceReport`**:
  - `{at, startedAt, appliedRevision: Revision|null, rejected: {source: "database"|"file",
    reason}|null, locked: StatusLockedField[]}`;
  - `StatusLockedField`: `{field, source: "env"|"file", via, value?}`;
  - `field` is a dotted path: `name`, `logoUrl`, `theme.light.bg`, `theme.font-sans`,
    `componentOrder`, `showChecks`, …; at most 60 entries;
  - `via` is the env variable name or `"settings file"` / `"theme file"`;
  - `value` is the local value, except for a local logo file path, which is left out. A value
    whose JSON is over 2 048 bytes is left out too, except the `componentOrder` value, which its
    own rule bounds (at most 500 × 67 bytes);
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
  This is the type the api builds and serves.
  - **`ServiceNotifyChannelsEnvelope`**: `{revision, channels: ReadonlyArray<{id: string} &
    Record<string, unknown>>}`, the result of the envelope step of Decision 6.
  - `validateServiceNotifyChannels(value, path = "channels answer")` checks only the envelope
    of Decision 6 and returns `Validation<ServiceNotifyChannelsEnvelope>`; it does not look
    inside an element beyond its `id`. Envelope errors include `channels answer.channels: must
    hold at most 100 channels` and `channels answer.channels[3].id: must not repeat an id`.
  - `validateNotifyChannelRecord(value, path)` checks one element: a definition (the same
    rules as `validateNotifyChannelDefinition`, including `NOTIFY_CHANNEL_DEFINITION_MAX_BYTES`
    measured on the definition without `createdAt` and `updatedAt`) plus those two fields.
  - An answer is a valid `ServiceNotifyChannels` exactly when the envelope passes and every
    element passes `validateNotifyChannelRecord`. The api's tests check its own answers that
    way; notify uses the two steps separately (Decision 6).
- **`NotifyFileChannelView`**: `{source: "file", id (1..200 characters), type:
  "webhook"|"file"|"slack"|"teams"|"email", refs: string[] (0..6, each 1..200 characters)}`.
  `refs` are the reference names (`SLACK_OPS`, `hook.txt`), never values. A file channel id longer
  than 200 characters is cut by the cut rule below; such an id cannot collide with a database id
  (at most 64 characters).
- **`NotifyDatabaseChannelView`**: `NotifyChannelRecord & {source: "database"}`.
- **`NotifyRejectedChannel`**: `{channelId: string|null (1..200), reason (1..300)}`.
- **`NotifyFailedDelivery`**: `{channelId (1..200), key (1..300), event: NotifyFailedEvent,
  isManual: boolean, failedAt, hasPayload: boolean}`.
  - `NotifyFailedEvent` is one of `NOTIFY_FAILED_EVENTS` = `["opened", "update", "resolved",
    "reminder", "budget-low", "tls-expiry", "domain-expiry", "unknown"]`, in that order. The first
    seven are exactly notify's events today: `NotificationEvent` (`notify/src/types.ts:1`) and
    `AlertEvent` (`:13`). `unknown` is for a payloadless entry whose key tells nothing.
  - `isManual` is `true` for a manual incident event (key prefix `manual:`, `detector.ts:100`,
    `:112`).
  - The mapping is notify's (Report normalization below); the contract checks only the enum.
- **Report normalization (notify).** Notify builds the report from its in-memory state with
  these rules, before the size trimming; every length is JavaScript `string.length` (UTF-16 code
  units), which is what the contract's zod `.max()` counts.
  - **Cut rule** for display text: a string longer than its limit `L` becomes its longest prefix
    of at most `L − 1` code units that does not end in a high surrogate (U+D800–U+DBFF), plus `…`
    (U+2026, one code unit). So the result has at most `L` code units and never a lone
    surrogate. A string of at most `L` code units is unchanged. An empty string never occurs in
    these fields: notify refuses an empty channel id (`config.ts:264-266`) and an empty
    reference (`channel-schema.ts:26-30`).
  - Where it applies:
    - file view `id` (L 200), each file view `refs` entry (L 200), rejected `channelId` (L 200)
      and rejected `reason` (L 300). Today's file references have no length limit
      (`channel-schema.ts:26-30`, only `min(1)`), so a valid 201-character `urlFile` path is
      reported as its first 199 characters plus `…`. A ref is a name for display; the cut copy is
      never used to resolve a secret;
    - `refs` keeps at most 6 entries, in the order `urlEnv`, `urlFile`, `secretEnv`,
      `secretFile`, `smtp.passwordEnv`, `smtp.passwordFile`, skipping absent ones. A file channel
      can hold at most these six, so nothing is dropped in practice; the rule is a guard.
  - Where it never applies: a failed entry's `channelId` and `key` are the exact values a resend
    needs, so they are never cut. A failed entry whose `channelId` is over 200 or whose `key` is
    over 300 code units is left out of `failed` and counted in `failedTotal`. Notify's own keys
    are shorter (the longest, `manual:<id>:update:<32 hex>` or `budget:<kind>:<ms>:<32 hex>`, is
    under 80), so only a hand-edited or legacy JSON ledger can hold such a key.
  - **Event mapping** of a failed entry. A payload is *recognized* when it is an object whose
    `event` is one of the seven values above. The ledger checks only that a payload is an object
    (`ledger.ts:268-269`, `:328`), so a stored payload can lack `event` or hold another value.
    1. Recognized payload: `event` = the payload's `event`, `isManual` = the payload has a
       `manual` object (`types.ts:29`). The key is not read.
    2. Otherwise the **key fallback** decides, with the same rules for each of the three cases
       "no payload", "payload without `event`" and "payload with an `event` that is not one of
       the seven"; the first key rule that matches wins:
       - 2a. key `manual:<id>:<e>` or `manual:<id>:<e>:<rest>`: `event` = `<e>` when `<e>` is
         `opened`, `update`, `resolved` or `reminder`, else `unknown`; `isManual: true`;
       - 2b. key `budget:<rest>`: `budget-low`, `isManual: false`;
       - 2c. key `<n>:<e>` or `<n>:<e>:<rest>` with `<n>` decimal digits: `<e>` when it is
         `opened`, `update`, `resolved` or `reminder`, else `unknown`; `isManual: false`;
       - 2d. anything else, `expiry:<rest>` included (TLS and domain expiry keys have the same
         shape, `expiry-alerts.ts:90`, so the key alone cannot tell them apart): `unknown`,
         `isManual: false`.
    - `hasPayload` is `true` whenever a payload is stored, recognized or not; the key fallback
      changes only `event` and `isManual`.
    - The failed CLI keeps its own text column (`failed-cli.ts:16-20`) unchanged; its tests
      (`test/failed-cli.test.ts:287-307`, `:85-89`) stay as they are.
- **`NotifyServiceReport`**: `{at, startedAt, appliedRevision: Revision|null, fileChannels:
  NotifyFileChannelView[] (0..200, file order), fileChannelsTotal (integer ≥ fileChannels.length),
  shadowedIds: string[] (0..100, database id pattern), rejected: NotifyRejectedChannel[] (0..100),
  failed: NotifyFailedDelivery[] (0..200, newest first), failedTotal (integer ≥ failed.length)}`.
  - `shadowedIds` are the database channel ids that notify shadowed at its last apply, computed
    from all file ids, not only the 200 reported.
- **`NotifyServiceState`**: `{state: "fresh"|"stale"|"never", receivedAt: number|null, report:
  NotifyServiceReport|null}`, with the same rules as `StatusServiceState`.
- **Admin notify view** `AdminNotifyChannelsView`: `{revision, channels: NotifyDatabaseChannelView[],
  shadowed: NotifyDatabaseChannelView[], service: NotifyServiceState}`, where
  `NotifyDatabaseChannelView` is `NotifyChannelRecord & {source: "database"}`.
  - `channels` holds the unshadowed database channels in creation order; `shadowed` holds the
    database channels whose id is in the last report's `shadowedIds` (a stale report included).
    Each database channel is in exactly one of the two.
  - The file channels are not copied into the view: the console reads them from
    `service.report.fileChannels`. So the view holds each reported byte once (the size bounds
    below).
- **`AdminNotifyFailedView`**: `{state: "fresh"|"stale"|"never", receivedAt: number|null, failed:
  NotifyFailedDelivery[], failedTotal}`, taken from the last report; `failed` is `[]` and
  `failedTotal` 0 with no report. It does not carry the rest of the report.
- **Resend**:
  - `ResendRequest`: `{channelId (1..200), key (1..300), requestId}`.
  - `ResendCommandState`: the ten states of Decision 14, exported as `RESEND_COMMAND_STATES`.
  - `ResendCommand`: `{id, channelId, key, requestId, state: ResendCommandState, createdAt,
    updatedAt}`.
  - `ResendClaimResponse`: `{commands: ResendCommand[] (0..20)}`.
  - `ResendResultInput`: `{state}` with an admission or a final outcome; `queued` and `claimed`
    are refused.
- **Report size.** A service never sends a report whose JSON is over 524 288 bytes
  (`SERVICE_REPORT_MAX_BYTES`), and the api's two report routes refuse a larger body with `413`
  (R2), so a stored report is never larger. Notify leaves out entries from the end of `failed`,
  then of `fileChannels`, then of `rejected`, until it fits; the totals stay. Status leaves out
  the `value` of the `componentOrder` lock, then of the other locks.
- **Size bounds.** Every bound below is UTF-8 bytes of `JSON.stringify`; a string character is at
  most 6 bytes in JSON (`\u00XX`), and at most 1 byte for the ASCII-only rules named.
  - `StatusSettings`: `name` 60 × 6 = 360; `logoUrl` 2 048 (printable ASCII, Decision 9) plus
    its key, about 2 060; 40 colours of at most 9 characters with their keys, about 1 240; two
    fonts of 200 characters, where only `"` needs escaping (2 bytes), about 840; three radii of
    32 characters, about 156; `componentOrder` 500 ids of at most 64 ASCII characters, quoted and
    separated, 500 × 67 + 20 = 33 520; four flags and the remaining keys, about 200. Sum: below
    40 000, so `STATUS_SETTINGS_MAX_BYTES` (65 536) never refuses a document that the field rules
    accept.
  - `ServiceStatusSettings`: settings + revision (71) + keys, at most 65 536 + 120 = 65 656.
  - `StatusServiceReport`: the `componentOrder` lock at most 33 502 + 130; 59 other locks at most
    2 048 + 130 each (128 502); `rejected` at most 1 800 + 60; the rest about 200. Sum: at most
    164 224, so status never needs to trim; the rule stays as a guard.
  - `AdminStatusSettingsView`: 65 536 + 524 288 (the stored report limit) + 300 = 590 124.
  - `ServiceNotifyChannels`: 274 344 (Decision 12).
  - `NotifyServiceReport`: with plain ASCII values, 200 file views of at most 1 478 bytes
    (295 600), 200 failed entries of at most 630 with `isManual` and the longest event name
    `domain-expiry` (126 000), 100 shadowed ids (6 700) and 100 rejected entries of at most 540
    (54 000), plus about 200: 482 500, below 524 288. Escaped
    characters can exceed it; then the trimming applies.
  - `AdminNotifyChannelsView`: the database records once, in `channels` or in `shadowed`
    (274 344), plus the stored report (524 288), plus about 300: at most 798 932.
  - `AdminNotifyFailedView`: at most the stored report, 524 288 + 100.
  - `ResendClaimResponse`: 20 commands of at most 24 + 1 200 + 1 800 + 64 + 150 bytes: at most
    64 760.
  - All of them are below the 1 048 576 limit with which status and notify read service answers
    (Decision 6), and below the console's read limit (5 MiB, contract `src/client.ts:7`).
- **Tokens**: `TOKEN_SCOPES` gains `status` and `notify`, in that order after `probe`. The rule
  "probe must be the only scope" becomes "probe, status and notify must each be the only scope",
  with the message `"<scope> must be the only scope"`. A location is allowed only for `probe`.
- **Audit**: the actions and kinds of Decision 15.

### R2 Api routes

All new routes answer `405` with `Allow` for other methods. Bodies are JSON within 1 MiB (`413`
beyond), except the two report routes, whose limit is `SERVICE_REPORT_MAX_BYTES` (524 288;
`413` beyond). Decision 16 says which routes need `If-Match`: there it is `428` when missing, `400` when
malformed, `412` `the settings changed: reload them and retry` when stale, and the success answer
carries the new `etag`.

| Method and path | Token | Answer |
| --- | --- | --- |
| `GET /admin/status/settings` | `admin` | `200` `AdminStatusSettingsView`, `etag` |
| `PUT /admin/status/settings` | `admin` | body `StatusSettings`; `200` view; `422` invalid, over 65 536 bytes, or unknown component id |
| `GET /admin/notify/channels` | `admin` | `200` `AdminNotifyChannelsView`, `etag` |
| `POST /admin/notify/channels` | `admin` | `201` and `location`; `409` id exists in the database or in the last report's `fileChannels` ids; `422` invalid, over 16 384 bytes, over 100 channels or over 262 144 bytes in total |
| `PUT /admin/notify/channels/:id` | `admin` | `200`; `400` body id ≠ path id; `409` shadowed (only delete allowed); `422` invalid, over 16 384 bytes or over 262 144 bytes in total; `404` unknown |
| `DELETE /admin/notify/channels/:id` | `admin` | `204`; works on a shadowed copy; `404` unknown |
| `GET /admin/notify/failed` | `admin` | `200` `AdminNotifyFailedView` |
| `POST /admin/notify/resends` | `admin` | Decision 14: `202`; `200` for a repeat or an open command; `409`; `503` |
| `GET /admin/notify/resends/:id` | `admin` | `200` `ResendCommand`; `404` |
| `GET /service/status/settings` | `status` | `200` `ServiceStatusSettings` with `etag`; `304` on a matching `If-None-Match` |
| `PUT /service/status/report` | `status` | body `StatusServiceReport`; `204`; `413` over 524 288 bytes; `422` invalid |
| `GET /service/notify/channels` | `notify` | `200` `ServiceNotifyChannels` with `etag`; `304` |
| `PUT /service/notify/report` | `notify` | body `NotifyServiceReport`; `204`; `413` over 524 288 bytes; `422` invalid |
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
  - **Component order encoding.** The console's form parser refuses a repeated known field
    (`parseForm`, console `src/forms.ts:24-33`, "A repeated known field fails"), and
    `readFormFields` answers `400` "repeated form field" (`src/http-context.ts:187-190`). So the
    order is never sent as repeated `order=<id>` fields, and the parser stays unchanged:
    - The form carries exactly one hidden field `order` whose value is the ids in display order
      joined by `,`. A comma cannot occur in a component id (`^[a-z0-9][a-z0-9._-]*$`, contract
      `src/schema.ts:776-797`), so the split is unambiguous.
    - Each move button is a `<button name="action" value="up:<i>">` or `value="down:<i>">`
      (`<i>` the 0-based position); "Reset order" is `value="reset-order"`. A browser submits
      only the pressed button, so `action` is never repeated either. "Save" is
      `value="save"`; the form has no hidden `action` input (as the existing setup form,
      `src/pages.ts:71-72`, uses only buttons), which would repeat the field. Enter in a text
      field submits the first submit button in tree order (HTML implicit submission), so the
      first submit button of the form is a "Save" button, ahead of the order list.
    - Reading: an absent `order` field or an empty value means "not set" (the database document
      gets no `componentOrder`). Otherwise the value is split on `,`; an empty item (`a,,b`, a
      leading or trailing comma), an item that breaks the id rule, or more than 500 items shows
      the inline error "The component order is invalid." with the input kept and calls no api.
      Duplicates and unknown ids go to the api, whose `422` is shown with the input kept.
    - `up:<i>` and `down:<i>` move the item and re-render the form unsaved; `<i>` outside the
      list is ignored. "Save" sends `componentOrder` as the split list.
    - Bytes: `order=` (6) plus 500 ids of at most 64 bytes (32 000) plus 499 separators encoded
      as `%2C` (1 497) plus the `&` (1): at most 33 504 bytes.
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
      allow only Delete. A database channel named in a fresh report's `rejected` (Decision 6,
      per channel) is marked "Rejected by pulse-notify: <reason>"; an entry with `channelId:
      null` is shown as a banner above the list.
    - `/notifications/new`;
    - `/notifications/edit?id=`;
    - `/notifications/delete?id=`;
    - `/notifications/failed`: up to 200 rows, newest first, with channel, key, event (the
      `event` value as text, `unknown` shown as "unknown"; "manual" after it when `isManual`),
      failure time, and a Resend button only when `hasPayload`;
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
  - Form limits (`maxFormBytes` of the protected route, console `src/protected-route.ts:59-60`;
    the default `MAX_FORM_BYTES` is 8192, `src/forms.ts:4`):
    - status form 65 536 bytes (`MAX_STATUS_FORM_BYTES`). The largest form of a valid
      `StatusSettings` is below 47 000 bytes: name 60 characters of at most 4 UTF-8 bytes, each
      encoded as `%XX` (720); logo URL 2 048 × 3 (6 144); 40 colour fields of about 31 bytes
      (1 240); two fonts of 200 × 3 + 20 (1 240); three radii (150); four switches (100); one
      `order` field (33 504, see "Component order encoding"); form token, CSRF token, revision
      and action (1 000); in total about 44 100, below 47 000 with margin for the estimated
      parts. The order control lists at most 500 ids; further components follow in upstream
      order (Decision 9);
    - channel form 65 536 bytes (`MAX_CHANNEL_FORM_BYTES`), which carries every definition of at
      most 16 384 bytes (Decision 12: at most 57 344);
    - delete and resend forms keep 8192.
  - The notifications list takes the file channels from `service.report.fileChannels` of the
    admin view (R1), and the database channels from `channels` and `shadowed`.

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
- **status and notify wait for the api merge.** This serializes them behind the api (Decision 1)
  for their performance evidence only. Mitigation: their builds and checks use a fake api, so
  nothing else waits; console runs in parallel with the api.
- **The resend request table grows with retries.** Mitigation: 10 000 rows and 7 days, with a
  `503` instead of deleting a row that a retry may still need (Decision 14).
- **A format-4 alert state is lost in the migration.** Today's `publish` writes only channel
  rows (`ledger.ts:546-568`). Mitigation: Decision 17 makes it write the alert rows for 4 → 5,
  and the migration test reads both alert rows back.
- **A long reference or id breaks the whole notify report.** A 201-character reference fails the
  contract and would leave the console with no report. Mitigation: the R1 cut rule before the
  report is sent, and failed entries the cut cannot apply to are left out and counted.
- **Full/dev `PULSE_STATUS_SHOW_CHECKS=true` locks show checks.** This is intended and documented;
  the E2E checks an unlocked field as well.

## Performance impact

Metrics of api `bench/budgets.json` that the change can move, with direction and size:

- **api** (`api` section):
  - `startup_cpu_ms` (gating, 325): + under 5 ms on a normal start (six more tables exist in the
    seed). The first start after the upgrade runs migration step 9 on an existing file: + under
    10 ms, measured with `cold-read.ts --seed-with` (below), reported, not gating.
  - `startup_wall_ms` (reported): the same.
  - `idle_rss_mib` (gating, 88): + under 1 MiB.
  - `load_cpu_s` (gating, 28.1): + under 0.1 s. In the 60 s window, B with the simulated service
    traffic (procedure 2 below) gets exactly 4 status settings reads, 4 notify channel reads, 12
    claims, 2 status reports and 2 notify reports: 24 small requests next to the about 2 600 of
    the load.
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

How the implementers measure. Three procedures, so that no measurement waits for code that is
not merged yet.

Controlled refs (procedures 2 and 3). Today a repository other than the api runs its newest `v*`
tag on A and `main` on B (`bench/refs.ts:63-65`), and every round fetches the ref again
(`bench/run.ts:106-118`), so `main` can move during a 40-minute run. An A/B of this feature must
differ only in the repository it measures. So:

- both procedures pass `--others-ref main`: every repository but the api runs `main` on both
  sides (`refs.ts:60-62`), and only `--b-ref` changes one repository's B side;
- the harness (api section) resolves every ref of both sides to a full commit SHA once, before
  the first round (`git fetch origin <ref>`, then `git rev-parse FETCH_HEAD^{commit}` in the
  repository's bench clone), and every round checks out those SHAs, not the ref names;
- after each checkout it compares `git rev-parse HEAD` of the worktree with the resolved SHA, and
  checks that every repository without `--b-ref`, the api excluded, has the same SHA on A and
  B. A difference is exit `2` `ref mismatch: <repo> <side>`;
- it logs one line per repository, `ref <repo> a=<sha> b=<sha>`, and the PR pastes these lines
  with the table;
- `--b-ref` without `--others-ref` is a usage error (exit `2`), so an uncontrolled comparison
  cannot be run by accident.

1. **contract, before it merges (no api harness needed).** The bench measures `test_cpu_s` and
   `build_cpu_s` as user + system CPU of `bun run test` and `bun run build` and their waited
   children (`bench/measure.ts:47`, `:68-70`; `bench/run.ts:161-171`). The contract child
   measures the same quantity with bash's `time` keyword, which reports the user and system
   time of the command and its waited children:

   ```sh
   git worktree add ../contract-a <merge base with main>   # A
   # B is the branch checkout; run `bun install --frozen-lockfile` in both
   TIMEFORMAT='%3U %3S'
   for round in 1 2 3 4 5; do
     for side in a b; do
       dir=.; [ "$side" = a ] && dir=../contract-a
       (cd "$dir" && { time bun run test >/dev/null 2>&1; } 2>>"/tmp/contract-test-$side")
       (cd "$dir" && { time bun run build >/dev/null 2>&1; } 2>>"/tmp/contract-build-$side")
     done
   done
   ```

   Per side and metric the value of a round is user + system; the result is the median of the
   five rounds (the 3rd smallest), as `bench/README.md:79` defines it. The PR shows the ten raw
   values per metric, both medians, and the verdict by the bench rule: `FAIL regression` when
   B − A > max(A × 10 %, floor), with the contract `test_cpu_s` floor 2 s and the default `s`
   floor 0.2 s for `build_cpu_s` (`bench/README.md:89-90`, `:114`), and `FAIL budget` above
   9.0 s and 6.4 s. `bun run build` rewrites `dist/`; the PR's committed `dist/` is the one of
   the last B build, and `git diff --exit-code -- dist` must pass afterwards.
2. **api, before it merges: simulated service traffic.** The api section adds two options to
   `bench/run.ts`:
   - `--simulate-services`: after the api of a side is ready, the harness creates a `status` and
     a `notify` token with the bench admin token, PUTs one status settings document and creates
     five database webhook channels (`bench/runtime-fixture.ts`). During the 60 s load window it
     then sends, from the harness process, the traffic that status and notify will send:
     `GET /service/status/settings` every 15 s and `PUT /service/status/report` every 60 s;
     `GET /service/notify/channels` every 15 s, `POST /service/notify/resends/claim` every 5 s
     and `PUT /service/notify/report` every 60 s (`bench/runtime-traffic.ts`). The real status and
     notify containers get no token.
   - Answers of the token creation:
     - side B: `201` for both tokens is required; any other answer is a harness error (exit
       `2`, `service tokens: <status> on b`). There is no silent fallback on B;
     - side A: `201` turns the simulation on for A too. The only answer that turns it off for A
       is the one an api without the new scopes gives: status `400` and a JSON body whose
       `error` starts with `token.scopes[0]: must be one of ` and does not contain the requested
       scope in quotes (`"status"` for the status token, `"notify"` for the notify token). Then
       the run logs `service traffic: not available on a` and A runs without the simulation.
       Source of that text: `src/token-routes.ts:232-233` passes the validator error through
       unchanged as `{"error": …}` (`sendError`, `:142-150`); the validator at the api's
       contract pin `c4a2eb5` builds it as `<path>: <message>` with base path `token`
       (`validate-tokens.ts:30-34`, `validate-core.ts:23-43`) and the enum message
       `must be one of "read", "checks", "incidents", "admin", "probe"` (`tokens.ts:30-32`).
       Reproduced on `c4a2eb5`: `validateTokenCreateInput({name:"bench status",
       scopes:["status"]})` returns `{"ok":false,"error":"token.scopes[0]: must be one of
       \"read\", \"checks\", \"incidents\", \"admin\", \"probe\""}`, and the same text for
       `["notify"]`. The bench sends `scopes` with the one new scope only, so the first failing
       element is always `scopes[0]`. Any other answer on A (another status, another `error`
       text such as `token.name: is required` or `scopes: …`, a body that is not JSON, or an
       error that lists the requested scope) is a harness error (exit `2`, `service tokens:
       <status> on a`). Side B never uses this rule: on B every answer other than `201` is exit
       `2`, including this exact `400`.
   - Schedule, in ms from the window start `t = 0`: status settings reads and notify channel
     reads at 0, 15 000, 30 000 and 45 000 (4 each); claims at 0, 5 000, …, 55 000 (12); one
     status report and one notify report at 0 and one of each after the window's last load
     request (2 per service, 4 in total). Each request is sent when its time has come, even if
     the timer fires late, so the count does not depend on the machine's speed.
   - Observed traffic: every simulated request must answer `200`, `204` or `304`, else exit
     `2`. At the end each side with the simulation on must have counted exactly 4 status
     settings reads, 4 channel reads, 12 claims, 2 status reports and 2 notify reports
     (literals), else exit `2` `service traffic not observed on <side>`. The run logs `service
     traffic (<side>): <n> status reads, <n> channel reads, <n> claims, <n> status reports, <n>
     notify reports`.
   - Command: `bun bench/run.ts --a <api main SHA> --b <api branch SHA> --others-ref main
     --simulate-services`.
   - Migration on upgrade: `bun bench/cold-read.ts --api <api branch worktree> --seed-with <api
     main worktree>` (an existing tool, `bench/README.md:54`).
3. **status and notify, after the api merged: the real services with tokens.** The api section
   adds two more options:
   - `--b-ref <repo>=<ref>` (repeatable, any repository but the api, only together with
     `--others-ref`): it sets only that repository's B side; A keeps the `--others-ref` ref,
     and the controlled-refs rules above apply;
   - `--service-tokens`: the harness creates the two tokens and the fixture of procedure 2
     after the api is ready and before probe, status and notify start (`bench/stack.ts:198-199`),
     writes the token secrets to `<run dir>/service-tokens/{status,notify}` and passes them as
     `PULSE_STATUS_API_TOKEN_FILE` and `PULSE_NOTIFY_API_TOKEN_FILE` to the real containers on
     both sides. Any answer but `201` on either side is a harness error (exit `2`): both sides
     run the same api, so a refusal can only be a fault;
   - `--expect-report <status|notify>` (repeatable): after the load window, the harness reads
     `GET /admin/status/settings` or `GET /admin/notify/channels` with the admin token. On side
     B, `service.state` must be `"fresh"` and `service.report.appliedRevision` must equal
     `revision`, else exit `2` `<service> report not observed on b`. On side A the state is only
     logged: A runs that service's `main` (`--others-ref main`), which does not have the
     feature yet and ignores the token variable, so its loops are off. The other service gets
     the same token variable and the same SHA on both sides, so whatever it does (loops on if
     its feature merged first, off if not) is equal on A and B;
   - `--simulate-services` together with `--service-tokens` is a usage error (exit `2`).
   - Commands, with the merged api SHA on both sides:
     - status: `bun bench/run.ts --a <api main SHA> --b <api main SHA> --others-ref main
       --b-ref status=<status branch SHA> --service-tokens --expect-report status`;
     - notify: `bun bench/run.ts --a <api main SHA> --b <api main SHA> --others-ref main
       --b-ref notify=<notify branch SHA> --service-tokens --expect-report notify`.
   - So A runs status (or notify) `main`, B its branch, and probe, the other service, contract,
     kit and config run the same SHA on both sides, which the `ref` log lines show. B is proven
     to have polled, applied and reported.

- A local run may use `--rounds 1`; the PR says so and pastes the table.
- This is why status and notify depend on api in `targets.json`: procedure 3 needs the merged
  api with the routes and the options. Their builds and checks do not need it.
- Shared finding: the api child records the exact commands it ran and any deviation. The status
  and notify children read it before they measure, and use api `main` at their start as the api
  SHA on both sides (they are started only after the api merged). The contract child records its
  raw values.

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
  - Notify's report carries file reference names, cut by the R1 cut rule, never a resolved
    value; the cut copy is never used to resolve anything.
- **Auth order and status codes.** As in R2. Sole scopes `status` and `notify`. `403` for a
  service token on `/admin/*`, for an admin token on `/service/*`, and for one service's token on
  the other service's routes. Console Owner-only, checked on every route and again just before the
  write (`writeGuardProblem`).
- **Body and size limits.**
  - Every new api route: 1 MiB, except the report routes: 524 288 bytes (`413`). Status
    settings: 65 536 bytes. Channels: 16 384 bytes each, 100 and 262 144 bytes in total. Resend:
    1000 commands and 10 000 request rows.
  - The console forms: `MAX_FORM_BYTES` 8192 for resend and delete, and 65 536 for the status and
    channel forms, which every valid value fits (R3).
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
  transactions. The format-5 migration keeps today's order and file rules (Decision 17): a
  private `<state>.v4.bak` (mode `0600`, an existing symlink removed, not followed), the build at
  `<state>.migrating` (mode `0600`) and an atomic rename. A refused file keeps its bytes. No
  service file is ever written.
- **Bench.** The bench refuses an uncontrolled `--b-ref` run and a checkout at an unexpected SHA
  (`ref mismatch`), so a measurement cannot silently run other code than its log says.
- **Dependency pins.** Contract pin updates in api, status, notify and console. No new runtime
  package.
- **CI.** deploy adds one `lint` step and one `e2e-dev` grep; no new action or permission.

## Rollout order

1. **contract `2.4.0`.** Additive: new modules and validators, two new scopes, new audit values.
   - Older consumers stay on their pins: api `c4a2eb5`, status and notify `9ab7e24`, console
     `66818a24`. Nothing changes for them until they move.
2. **api and console** in either order, each with the contract pin `2.4.0`. Then **status and
   notify** in either order, after the api merged (their performance evidence needs it, Decision
   1), each with the contract pin `2.4.0`. Each step leaves the others' older versions working:
   - api: older status and notify send no token and call no `/service/*` route, so they keep
     working on public reads. The older console (contract `66818a24`) works until someone creates
     a `status` or `notify` token. Then its Tokens and Probes lists show "pulse-api sent an
     invalid answer." The api README and the release note say: update the console before creating
     service tokens.
   - status and notify without a token behave as today. With a token against an api without the
     routes, the settings read gets `404`: status runs on env and file, and notify on its file.
     Both log once that the api has no runtime settings. Because status and notify merge after
     the api, the released order never has a new service against an old api; the `404` rule
     covers an operator who runs a new image against an older api.
   - An older status serves the contract modules of its own pin, so its browser module list
     (`server.ts:189-206`) still matches. The new status serves the four new modules of
     `2.4.0` (status section).
   - The console against an older api: `/status-page` and `/notifications` show the "old api"
     state.
   - A format-5 notify ledger is refused by an older notify (`ledger.ts:670-690`). The first
     start migrates a format-4 file and keeps `<state>.v4.bak`; the notify docs describe the
     downgrade by restoring that backup (Decision 17).
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
  default) on the next poll.
  - The settings file holds `{"name": "Local"}` and the database `name: "Acme"`: the page shows
    `Local`. The file is rewritten as `{}`: on the next poll the page shows `Acme`. With no
    database value it shows `pulse status`.
  - The same file is deleted instead: the page still shows `Local` (the last good file values),
    and the report has `rejected: {source: "file", reason: "settings file: cannot read: ENOENT"}`
    (Decision 7). A wrong implementation that treats a missing file as `{}` shows `Acme`.
  - The file is put back with `{}`: the next poll shows `Acme`, and `rejected` is `null`.
- **Notify whole channel:** file channel `ops` (slack, `urlEnv: SLACK_OPS`) and database `ops`
  (webhook, `urlEnv: PULSE_NOTIFY_SECRET_HOOK`, `checks: ["api*"]`). The effective `ops` is the
  slack channel with the file routing. The webhook URL is never used, and the database copy is
  listed under `shadowed` because the report's `shadowedIds` holds `ops`.
- **Create collisions:** `POST` of id `ops` while the report lists file `ops`: `409`. `POST` of
  `Ops` (upper case): `422` id pattern. `POST` of the 101st channel: `422`.
- **Channel size:**
  - One definition of exactly 16 384 bytes: `201`. One more character in a routing string:
    `422` `channel: must be at most 16384 bytes as JSON`.
  - A webhook with four routing lists of 200 strings of 200 characters each (about 162 000
    bytes), which the per-list rules alone accept: `422`. A wrong implementation without the
    per-channel limit stores it, and then the console cannot render or post it within 65 536
    bytes.
  - Database channels whose definitions sum to exactly 262 144 bytes (sixteen of 16 384): the
    last create is `201`. A 17th channel of 1 byte more than the remaining room: `422`
    `channels: must be at most 262144 bytes as JSON in total`.
  - A replace that grows a channel past the aggregate is `422`, and one that keeps the total at
    262 144 is `200` (the candidate replaces its old version in the sum).
  - The largest console channel form, built from a 16 384-byte definition of 3-byte characters
    (each `%XX%XX%XX` in the form): at most 57 344 bytes, accepted by the 65 536 limit.
- **Settings size:**
  - A radius `"1" × 31 + "px"` (33 characters): `422` `theme.radius-sm: must be at most 32
    characters`. Today's status theme file accepts it (`theme-config.ts:41`), and the legacy theme
    file still does.
  - The largest valid `StatusSettings` (every field at its limit, 500 order ids of 64
    characters): below 40 000 bytes, accepted; its service answer below 65 656 bytes; its console
    form below 47 000 bytes with one comma-joined `order` field. The expected limits are the
    literals of R1 and R3.
  - A `componentOrder` id of 65 characters, or one with an upper-case letter: `422`
    (`MAX_COMPONENT_ID`, `COMPONENT_ID`).
  - A `logoUrl` with a space or a non-ASCII character: `422`.
- **Admin view size:** a stored notify report of 524 288 bytes plus 262 144 bytes of database
  channels: `GET /admin/notify/channels` is at most 798 932 bytes, and the report's file channels
  appear in it once. A wrong implementation that also copies them into `channels` exceeds
  1 048 576 bytes with escaped ids.
- **Report size:** a notify report with 200 file channels of 200-character ids made of `"`
  (escaped to 2 bytes each), 6 refs of 200 characters each and 200 failed entries: notify trims
  `failed`, then `fileChannels`, to at most 524 288 bytes, keeps `failedTotal` and
  `fileChannelsTotal`, and the api answers `204`, not `413`. A report body of 524 289 bytes sent
  directly to the api: `413`, and the stored report is unchanged.
- **Report normalization:**
  - A file webhook with `urlFile: "/" + "a" × 200` (201 characters, valid today): the report's
    ref is `"/" + "a" × 198 + "…"`, and the api accepts the report (`204`). A wrong implementation
    that sends the ref unchanged gets `422` for the whole report, and the console then shows the
    service as never reported; one that only trims bytes never fixes it.
  - A ref of 199 `a` plus `😀`: cut to 199 `a` plus `…`. A wrong cut at 199 code units plus the
    high surrogate leaves a lone surrogate.
  - A failed entry with a 301-character key is not cut: it is left out and counted in
    `failedTotal`. A cut key would make a resend name a key that does not exist.
- **Event mapping:** payloadless `expiry:1:14:<32 hex>`: `unknown`, not `tls-expiry` (the key
  does not tell TLS from domain). Payloadless `budget:check:1:<32 hex>`: `budget-low`, not
  `check` (which the failed CLI prints, `failed-cli.ts:19`). Payloadless `manual:3:resolved`:
  `resolved` with `isManual: true`. A payload `{event: "update", manual: {…}}`: `update`, `true`;
  a wrong enum without `update` refuses the report. A payload `{"event": "zzz"}` with key
  `9:opened`: `opened` by the key fallback; an implementation that applies the key rules only
  when there is no payload gives `unknown`, and one that copies `"zzz"` refuses the report.
- **Ledger format 5:**
  - A format-4 file with two `alert_state` rows: after the migration both rows are there. A
    wrong migration that reuses today's `publish` unchanged loses them (it writes only the
    channel rows).
  - A format-4 file and a crash in `beforePublish`: the next open finds a format-4 file with all
    rows and migrates; `<state>.v4.bak` is version 4.
  - `user_version = 6`: refused, bytes unchanged.
- **Bench refs:** `--b-ref status=<sha>` without `--others-ref`: exit `2`. With `--others-ref
  main`, a `main` of kit that moves between round 1 and round 2: both sides of every round still
  run the SHA resolved before round 1. A B worktree of notify at a SHA other than the resolved
  one: `ref mismatch: notify b`.
- **Notify channels answer, two levels (Decision 6):** an answer with valid `a`, a 16 385-byte
  `b` and valid `c`, after an earlier answer with all three valid: `a` and `c` apply, `b` keeps
  its earlier version, `rejected` names only `b`, and `appliedRevision` is the new revision. An
  implementation that rejects the whole answer because one element is invalid is wrong (`c`
  never applies), and so is one that drops `b`'s earlier version. The opposite case: an answer
  with 101 elements, or with one id twice, is malformed as a whole, changes nothing, and keeps
  `appliedRevision`; an implementation that applies the first 100 elements, or the first of two
  equal ids, is wrong.
- **Traffic counts:** in the 60 s window, 2 status reports and 2 notify reports, 4 in total; a
  count of 2 reports in total (one per service) is exit `2`.
- **Bench baseline token answer:** api `main` (`4b3e9b1`, contract `c4a2eb5`) answers a
  `scopes:["status"]` create with `400` `{"error":"token.scopes[0]: must be one of \"read\",
  \"checks\", \"incidents\", \"admin\", \"probe\""}`. A predicate that requires the error to
  start with `scopes` never matches it and makes procedure 2 exit `2` on A, so it is wrong. A
  predicate that turns A off on any `400` is wrong too: `400` `token.name: is required` (a bench
  bug) must be exit `2`. The same baseline `400` on B is exit `2`.
- **Deploy resend:** the event resent is `manual:<B>:opened`, which failed because the receiver
  answered `500` while it was sent. Resending `manual:<A>:opened`, delivered in step 5, gives
  `409` `not a failed delivery`; a scenario that switches the receiver to `500` after a
  delivery has no failed entry to resend.
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
- **Component order form:** a console form that sends one `order=<id>` field per component gets
  `400` "repeated form field" from the existing parser for any order of two or more components;
  the single comma-joined `order` field saves. A trailing comma (`web,db,`) is an empty item and
  is refused in the console, not sent as `["web","db",""]`.
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
    the first command, and `resend_requests` then holds both ids for it.
  - Lost `200` after reuse (the second plan-review's sequence): request A gets `202` (command
    `C`). Request B, with another `requestId`, gets `200` with `C`, but the answer is lost. `C`
    ends `failed`, and the report lists the delivery as failed again. B is retried with the same
    `requestId`: `200` with `C` in state `failed`; the command count stays 1, no claim returns a
    new command, and the receiver gets no extra request. A wrong implementation that stores only
    the creating `requestId` answers `202` with a second command.
  - A retry of a `requestId` whose command was deleted by the capacity rule: `409` `the resend
    request was already handled; reload the failed list`, and no command is made.
  - 1000 commands, all open: the next create is `503` `too many open resend commands` with
    `retry-after: 60`, and nothing is stored.
  - 1000 commands of which 3 are finished, with `updatedAt` 10, 20 and 30: the one with
    `updatedAt` 10 is deleted, the create is `202`, the table holds 1000 commands, and the two
    others stay. A wrong implementation that deletes all finished commands leaves 998.
  - 10 000 `resend_requests` rows, all younger than 7 days: a new `requestId` is `503` `too many
    resend requests`, also when it would reuse an open command. A row 604 800 001 ms old is
    deleted by retention; one 604 800 000 ms old is kept.
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
  `NotifyChannelRecord`, `ServiceNotifyChannels`, `ServiceNotifyChannelsEnvelope`,
  `NotifyFileChannelView`, `NotifyDatabaseChannelView`,
  `NotifyRejectedChannel`, `NotifyFailedDelivery`, `NotifyFailedEvent`, `NotifyServiceReport`,
  `NotifyServiceState`,
  `AdminNotifyChannelsView`, `AdminNotifyFailedView`, `ResendRequest`, `ResendCommand`,
  `ResendCommandState`, `ResendClaimResponse`, `ResendResultInput`.
- Validators: `validateStatusSettings`, `validateServiceStatusSettings`,
  `validateStatusServiceReport`, `validateAdminStatusSettingsView`,
  `validateNotifyChannelDefinition`, `validateNotifyChannelRecord`, `validateServiceNotifyChannels`,
  `validateNotifyServiceReport`, `validateAdminNotifyChannelsView`, `validateAdminNotifyFailedView`,
  `validateResendRequest`, `validateResendCommand`, `validateResendClaimResponse`,
  `validateResendResultInput`.
- Constants: `STATUS_COLOR_KEYS`, `STATUS_FONT_KEYS`, `STATUS_RADIUS_KEYS`, `STATUS_NAME_MAX`
  (60), `STATUS_COMPONENT_ORDER_MAX` (500), `NOTIFY_SECRET_ENV_PREFIX` (`"PULSE_NOTIFY_SECRET_"`),
  `NOTIFY_CHANNEL_MAX` (100), `NOTIFY_CHANNELS_MAX_BYTES` (262144), `NOTIFY_FAILED_REPORT_MAX`
  (200), `NOTIFY_FILE_CHANNEL_REPORT_MAX` (200), `SERVICE_REPORT_MAX_BYTES` (524288),
  `SERVICE_REPORT_STALE_MS` (180000), `RESEND_CLAIM_MAX` (20), `RESEND_CLAIM_TIMEOUT_MS` (60000),
  `RESEND_COMMAND_MAX` (1000), `RESEND_COMMAND_STATES`, `STATUS_RADIUS_MAX` (32),
  `STATUS_SETTINGS_MAX_BYTES` (65536), `NOTIFY_CHANNEL_DEFINITION_MAX_BYTES` (16384),
  `RESEND_REQUEST_MAX` (10000), `RESEND_RETENTION_MS` (604800000), `NOTIFY_FAILED_EVENTS`.
- Fields: `showLatency`, `showSlos`, `showChecks`, `hideDetails`, `componentOrder`, `logoUrl`,
  `requestId`, `appliedRevision`, `startedAt`, `receivedAt`, `locked`, `via`, `fileChannels`,
  `fileChannelsTotal`, `shadowedIds`, `failedTotal`, `failedAt`, `hasPayload`, `channelId`,
  `urlEnv`, `urlFile`, `secretEnv`, `secretFile`, `passwordEnv`, `passwordFile`, `isManual`.
  - `refs`: 2 hits, both in config tests about git refs (`config/src/release.test.ts:104`,
    `config/src/workflow-policy.test.ts:151`). No contract field.
  - `rejected`: 18 hits, all in comments of contract validators ("unknown keys are rejected",
    for example `validate.ts:266`). No field or export.
- State and kind values: `not-failed`, `no-payload`, `channel-unavailable`, `status-settings`,
  `notify-channel`, `notify-resend`.
- Event values of `NOTIFY_FAILED_EVENTS` (searched with the quotes, `'"<value>"'`): `"opened"`,
  `"reminder"`, `"budget-low"`, `"tls-expiry"`, `"domain-expiry"`: 0 hits. `"update"`: 1 hit, a
  default parameter `path = "update"` (`contract/src/validate.ts:351`). `"resolved"`: 6 hits,
  incident status values (`client.ts:362`, `schema.ts:861,944,1033,1111,1123`). `"unknown"`: 3
  hits, a check state (`schema.ts:98`, `:1183`, `components.ts:14`). They live only inside the
  new enum, as members, and become no export of their own, so none collides.
  - The values `queued`, `claimed`, `admitted`, `delivered`, `failed`, `dropped` are members of the
    new `RESEND_COMMAND_STATES` only; they become no export of their own.
- Scope values: `"notify"`: 0 hits. `"status"`: 5 hits, all incident status fields
  (`client.ts:366`, `schema.ts:970,1036,1041,1068`), not scopes or kinds. The new scope value
  `status` lives in `TOKEN_SCOPES` only.
- Routes and paths: `/service/`, `/admin/status`, `/admin/notify`, `page-settings`,
  `data-settings`.
- Permission names (api only): `runtime-admin`, `status-service`, `notify-service`.
- Api table `resend_requests`: 0 hits in the contract and config clones, and 0 in
  `.repos/api/src` (`grep -rn resend_requests .repos/api/src | wc -l`).
- Notify ledger names (Decision 17): `remote_channels`, `resend_commands`, `posted_state`,
  `.v4.bak`: 0 hits in `.repos/notify/src`, `.repos/notify/test` and `.repos/notify/docs`
  (`grep -rn 'remote_channels\|resend_commands\|posted_state' .repos/notify/src
  .repos/notify/test | wc -l`, and `grep -rn 'v4\.bak' … | wc -l`).
- Api bench names: `--b-ref`, `--simulate-services`, `--service-tokens`, `--expect-report`,
  `runtime-fixture`, `runtime-traffic`, `ref mismatch`: 0 hits each in `.repos/api/bench` and
  `.repos/api/package.json` (`grep -rn -- '<name>' .repos/api/bench .repos/api/package.json | wc
  -l`).
- Console constants: `MAX_STATUS_FORM_BYTES`, `MAX_CHANNEL_FORM_BYTES`: 0 hits in
  `.repos/console/src` and in the contract and config clones.
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
- Console status form (R3, "Component order encoding"): field `order`; `action` values `save`,
  `up:<i>`, `down:<i>`, `reset-order`. Searches over `.repos/console/src`,
  `.repos/contract/src` and `.repos/config`: `grep -rn 'name="order"\|"order"'` and
  `grep -rn 'value="up\|value="down\|value="save\|reset-order'`, 0 hits each. The field name `action` exists already for buttons
  (`console/src/pages.ts:71-72`); it is per form, so a new value does not collide. Bare `up:` and
  `down:` match only check-status object keys (`console/src/overview.ts:13`), not form values.
- Bench options (api): `--b-ref`, `--simulate-services`, `--service-tokens`, `--expect-report`.

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
- `test/runtime-settings.test.ts` (new)
- `test/notify-channels.test.ts` (new)
- `test/resend.test.ts` (new)
- `test/tokens.test.ts` (changed)
- `test/audit.test.ts` (changed)
- `test/smoke.test.ts` (changed)
- `test/types.fixture.ts` (changed)
- `dist/` (changed: rebuilt and committed)
- `package.json` (changed: `version` 2.4.0)
- `README.md` (changed)
- `docs/index.md` (changed)

Behavior change: yes. New shapes and validators, wider scope and audit enums.

Behavior: R1 exactly.
- Validators never throw and return the same object, as the existing ones do.
- Unknown keys give `has an unknown field: <key>`.
- The `componentOrder` duplicate message is `componentOrder[<i>]: must not repeat an id`.
- Database channels refuse `type: "file"` with `type: must be one of "webhook", "slack", "teams",
  "email"`.
- The file view accepts `file` too.
- The channel validators check one definition, including its 16 384-byte limit
  (`NOTIFY_CHANNEL_DEFINITION_MAX_BYTES`). `validateNotifyChannelRecord` does the same for one
  element of a channels answer. `validateServiceNotifyChannels` checks only the envelope of
  Decision 6 (top-level keys, revision, 0..100 elements, each a plain object with a valid,
  distinct `id`) and never fails because of the content of an element. The aggregate byte limit is a constant that the api
  applies over all channels; the contract exports it and documents the measure (UTF-8 bytes of
  `JSON.stringify(definition)`).
- The `StatusSettings` validator checks the radius limit (32), the `componentOrder` id rule of
  `schema.ts:776-797`, the printable-ASCII `logoUrl` rule and the 65 536-byte document limit.
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
  - a `NotifyServiceState` with `state: "never"` and a non-null report;
  - a 33-character radius, a 65-character order id, a `logoUrl` with a space;
  - a channel definition of 16 384 bytes (accepted) and of 16 385 bytes (refused), built in the
    test from literal lengths;
  - a channels answer `{revision: "r1", channels: [<valid webhook "a">, <webhook "b" of 16 385
    bytes>, <valid slack "c">]}` (the revision in the format the contract defines):
    `validateServiceNotifyChannels` accepts it with three elements; `validateNotifyChannelRecord`
    accepts elements 0 and 2 and refuses element 1 with `channels[1]: must be at most 16384
    bytes as JSON`;
  - envelope refusals (literal texts): 101 elements (`channels answer.channels: must hold at
    most 100 channels`); two elements with id `a` (`channels answer.channels[1].id: must not
    repeat an id`); an element without `id`, or with id `Ops`; an element that is an array; a
    top-level key `extra`; a missing `revision`;
  - an `AdminNotifyChannelsView` with a file view in `channels` (refused: only database views);
  - a `NotifyFailedDelivery` with `event: "update"` and `isManual: true` (accepted), with
    `event: "manual"` or `"warning"` (refused), and without `isManual` (refused);
  - a file view with a `refs` entry of 201 characters (refused) and of 200 characters ending in
    `…` (accepted): the contract checks the limit, notify cuts (R1).
- `NOTIFY_FAILED_EVENTS` equals the literal list of R1, written out in the test; its first seven
  entries are notify's events at `c79f0b7` (`notify/src/types.ts:1`, `:13`), an independent
  source.
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
build`; the new tests fail on `ebf6bbc` (missing exports) and pass after; the contract CPU A/B of
Performance impact, procedure 1 (ten raw values per metric, the medians and the verdict against
`test_cpu_s` 9.0 s and `build_cpu_s` 6.4 s). It needs no api change, so it is done before the
contract merges.

## Repository: api

Files:
- `src/migrations.ts` (changed: step 9 with `status_settings`, `notify_channels`,
  `service_reports`, `resend_commands`, `resend_requests`, `runtime_state`)
- `src/runtime-store.ts` (new: SQL of the six tables, generations, revisions, per-channel and
  aggregate size)
- `src/status-settings-routes.ts` (new: admin and service status routes, report)
- `src/notify-channel-routes.ts` (new: admin and service channel routes, report, failed view)
- `src/resend-routes.ts` (new: resend create with the `resend_requests` lookup, read, claim,
  results, requeue)
- `src/token-scopes.ts` (changed: permissions `runtime-admin`, `status-service`,
  `notify-service`; `canGrant` for `status`/`notify`)
- `src/admin-routes.ts` (changed: dispatch of the new admin sections)
- `src/admin-auth-failures.ts` (changed: a service token on an admin route is `403`)
- `src/server.ts` (changed: `/service/*` dispatch before the read paths, `routeOf` labels,
  `ADMIN_ROUTE`)
- `src/retention.ts` (changed: retention of resend commands and resend requests)
- `src/start.ts` (changed: wiring)
- `src/main.ts` (changed: wiring)
- `src/runtime-store.test.ts` (new)
- `src/server.status-settings.test.ts` (new)
- `src/server.notify-channels.test.ts` (new)
- `src/server.resend.test.ts` (new)
- `src/server.service-auth.test.ts` (new)
- `src/db.migrations.test.ts` (changed: step 9)
- `src/token-scopes.test.ts` (changed)
- `src/server.allow.test.ts` (changed)
- `src/server.scopes.test.ts` (changed)
- `src/retention.test.ts` (changed)
- `src/backup.test.ts` (changed)
- `bench/refs.ts` (changed: `--b-ref`; the same-SHA rule and the checkout comparison of
  "Controlled refs", as pure functions)
- `bench/run.ts` (changed: `--b-ref`, `--simulate-services`, `--service-tokens`,
  `--expect-report`; refs resolved to SHAs once before the first round, `checkout` (lines
  106-118) by SHA, the `git rev-parse HEAD` comparison after each checkout, the
  `ref <repo> a=<sha> b=<sha>` log lines)
- `bench/stack.ts` (changed: admin tokens file; fixture between the api start and the other
  services; traffic during the window; report check after it)
- `bench/fixtures.ts` (changed: admin tokens file)
- `bench/compose.bench.yaml` (changed: api `PULSE_API_ADMIN_TOKENS_FILE`; status
  `PULSE_STATUS_API_TOKEN_FILE: ${BENCH_STATUS_TOKEN_FILE:-}`; notify
  `PULSE_NOTIFY_API_TOKEN_FILE: ${BENCH_NOTIFY_TOKEN_FILE:-}` and `PULSE_NOTIFY_SECRET_BENCH`; a
  read-only `service-tokens` mount)
- `bench/selftest/check-refs.ts` (changed)
- `bench/README.md` (changed)
- `bench/runtime-fixture.ts` (new: token creation with the per-side answer rules, the settings
  and channel fixture, the report check; injected `fetch`)
- `bench/runtime-traffic.ts` (new: the simulated service traffic and its counts; injected
  `fetch` and timers)
- `bench/selftest/check-runtime-fixture.ts` (new)
- `bench/selftest/check-runtime-traffic.ts` (new)
- `package.json` (changed: contract pin to the merged 2.4.0 SHA; the `bench:selftest` script at
  line 18 gains the two new self-tests)
- `bun.lock` (changed: same pin)
- `README.md` (changed)
- `docs/rest-api.md` (changed)
- `docs/operation.md` (changed)
- `docs/configuration.md` (changed)

Behavior change: yes. New tables, routes, scopes, audit actions and bench options.

Behavior: Decisions 3, 4, 5, 12, 14, 15 and 16, and R2.
- The component check of `componentOrder` reads the current applied components.
- The api never reads a notify reference or secret, and never validates a reference beyond the
  contract patterns.
- `GET /admin/notify/channels` computes `shadowed` from the last report's `shadowedIds`, even a
  stale one. With no report at all, `shadowed` is `[]` and `service.state` is `"never"`.
- The create collision check uses the ids of the last report's `fileChannels`. A file id that
  the report left out (beyond 200) cannot be checked; such a database channel is shadowed by
  notify after its create and then shows under `shadowed`.
- The report routes read their body with the 524 288-byte limit (`413` beyond), so a stored
  report never exceeds it, and the admin views stay within the R1 size bounds.
- A resend create inserts its `resend_requests` row in the same transaction as the answer
  (Decision 14 steps 2 and 6).
- The aggregate byte limit is computed over the stored definitions with the candidate in place
  of its old version.
- Bench, as Performance impact procedures 2 and 3 define it:
  - `--b-ref <repo>=<ref>` may repeat; an unknown repository, `api`, a repeated repository, or
    `--b-ref` without `--others-ref` exits `2` with a usage line. `--others-ref` pins both sides;
    `--b-ref` then overrides B.
  - Every run, with or without the new options, resolves its refs to SHAs once and verifies each
    checkout, as "Controlled refs" of Performance impact says. A run without `--b-ref` thus
    measures what it measured before, but `main` cannot move between rounds.
  - The admin tokens file holds one fixed bench admin token of at least 32 characters
    (`src/admin-tokens.ts:8-16`).
  - Without `--simulate-services` and `--service-tokens`, nothing changes: no token is created,
    both token variables are empty, and the run is today's run.
  - With either option, `bench/runtime-fixture.ts` posts the two service tokens after the api is
    ready, with the answer rules per side of procedure 2 (`--simulate-services`) or procedure 3
    (`--service-tokens`). After `201` it PUTs one status settings document (`name`,
    `showLatency: false`) and creates five webhook channels (`urlEnv: PULSE_NOTIFY_SECRET_BENCH`,
    `checks: ["c0"]`); any other answer to these writes is a harness error (exit `2`).
  - With `--service-tokens` it writes the secrets to `<run dir>/service-tokens/{status,notify}`
    (mode 0644, so the containers' `bun` user reads them) and sets `BENCH_STATUS_TOKEN_FILE` and
    `BENCH_NOTIFY_TOKEN_FILE` before status and notify start (`bench/stack.ts:198-199`).
  - With `--simulate-services`, `bench/runtime-traffic.ts` sends the traffic of procedure 2
    during the window on the schedule of procedure 2, checks every answer, and fails the run
    unless it counted exactly 4 status settings reads, 4 channel reads, 12 claims, 2 status
    reports and 2 notify reports.
  - With `--expect-report`, the report check of procedure 3 runs after the window.
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
- Limits, with literal sizes built in the test: the 101st channel; the aggregate boundary
  (262 144 accepted, one byte more refused); one definition of 16 384 bytes accepted and 16 385
  refused; the four-list webhook of Counterexamples refused; a status settings document of the
  largest valid size accepted and one of 65 537 bytes refused; a report body of 524 289 bytes
  `413` with the stored report unchanged.
- Serialized answers, measured in the test with `Buffer.byteLength` of the body: with a stored
  report of 524 288 bytes and 262 144 bytes of channels, `GET /admin/notify/channels` is at most
  798 932 bytes and holds no file view outside `service.report`; `GET /service/notify/channels`
  is at most 274 344 bytes; `GET /service/status/settings` of the largest valid settings is at
  most 65 656 bytes. The limits are the literals of R1.
- Every `GET /service/notify/channels` answer of the tests passes `validateServiceNotifyChannels`
  and, element by element, `validateNotifyChannelRecord` of contract `2.4.0` (R1: that is what
  a valid `ServiceNotifyChannels` means).
- Resend: every Counterexample under "Resend" that touches the api, with a fake clock: idempotency,
  `requestId` conflict, open-command reuse for each open state, the lost `200` after reuse (a
  second command must not appear; literal command count `1`), the `409` for a request whose
  command was deleted, `503` stale (180 001 ms) and fresh (180 000 ms), `409` not failed, the
  1000-command capacity both ways (all open: `503`; three finished: exactly one deleted, count
  `1000`), the 10 000-request `503`, requeue at 60 000 ms and not at 59 999 ms, every row of the
  acknowledgement rules (`204` or `409`), retention of commands and requests at 604 800 000 ms
  (kept) and 604 800 001 ms (deleted).
- Migration: a step-8 file with checks, tokens, incidents and windows opens at version 9 with all
  rows kept. A backup holds the new tables.
- Audit rows for each configuration write and for a `202` resend hold the action, kind and target
  id, and no settings value; a `200` resend and every service route write no audit row. A
  sentinel reference name `PULSE_NOTIFY_SECRET_SENTINEL` appears in no audit row and no log line.
- Bench self-tests (literal expectations, fake `fetch` and timers):
  - `check-refs.ts`: `--others-ref main --b-ref status=x` gives A status `main`, B status `x`,
    and `main` on both sides for probe, notify, contract, kit and config; the refusals (`api`,
    unknown, repeated, `--b-ref` without `--others-ref`); the comparison with literal SHAs:
    resolved kit `1111…` (40 hex) on A and `2222…` on B without a `--b-ref` for kit is `ref
    mismatch: kit b`, an observed `HEAD` `3333…` for a resolved `1111…` is `ref mismatch: kit a`,
    and equal SHAs pass; the existing cases (`check-refs.ts:25-40`) keep passing;
  - `check-runtime-fixture.ts`: `--service-tokens` with `201` on both sides writes both files and
    sets both variables; `--service-tokens` with `400` on A is exit `2`;
    `--simulate-services` with the baseline answer on A, status `400` and body
    `{"error":"token.scopes[0]: must be one of \"read\", \"checks\", \"incidents\", \"admin\",
    \"probe\""}` (literal, the text reproduced on contract `c4a2eb5`, see procedure 2), turns A
    off with the log line `service traffic: not available on a` and the run goes on; the same
    literal `400` on B is exit `2`; on A, `400` `{"error":"scopes: must be one of …"}`, `400`
    `{"error":"token.name: is required"}`, `400` `token.scopes[0]: must be one of "read",
    "status"` (lists the requested scope), `400` with a body that is not JSON, `500` and `401`
    are each exit `2`;
  - the literal above is checked against the real baseline outside the self-test, because the
    branch's own api (contract `2.4.0`) can no longer produce it: the PR shows (a) the output of
    `bun -e 'import {validateTokenCreateInput} from "@lorenzh/pulse-contract"; console.log(JSON.stringify(validateTokenCreateInput({name:"bench status",scopes:["status"]})))'`
    run inside a worktree of api `main` (`4b3e9b1`, contract `c4a2eb5`) after `bun install`,
    which must print the literal error text above, and (b) the log of the real procedure-2
    run with A at api `main`, which must contain `service traffic: not available on a`, then
    `service traffic (b): 4 status reads, 4 channel reads, 12 claims, 2 status reports, 2
    notify reports`, and end with exit `0`. A predicate that does not match the real baseline
    answer fails (b) with exit `2`; `--expect-report` with a `stale` B report
    is exit `2`, with a `fresh` but unapplied B report exit `2`, with a `never` A report a log
    line only; both options together are exit `2`;
  - `check-runtime-traffic.ts`: in a fake 60 s window it sends exactly 4 status settings
    reads, 4 channel reads, 12 claims, 2 status reports and 2 notify reports (literals; 24
    requests); with timers that fire 4 000 ms late it still sends those counts; one `500` answer
    is exit `2`; a count of 11 claims, or 1 notify report, is exit `2`.
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
Performance impact procedure 2 (`--others-ref main --simulate-services`) with its `ref …` lines
and its `service traffic (b): …` log line,
and the `cold-read.ts --seed-with` output; one manual run with `bun start`, an admin token and a
`status` token:

```sh
curl -X PUT /admin/status/settings
curl /service/status/settings
```

The output goes in the PR. Shared finding: record the exact commands of procedures 2 and 3 as
they ran, and any deviation, so the status and notify children can measure. They take the api SHA
from api `main` at their start: they start only after the api merged.

## Repository: console

Files:
- `src/navigation.ts` (changed: ids `status-page`, `notifications`)
- `src/icons.ts` (changed: icons of the two new ids)
- `src/status-page-pages.ts` (new)
- `src/status-page-routes.ts` (new: includes the comma-joined `order` field reading of R3)
- `src/notification-pages.ts` (new: list, new, edit, delete, failed, resend)
- `src/notification-routes.ts` (new: same screens)
- `src/runtime-read.ts` (new: reads of the R2 admin routes)
- `src/runtime-write.ts` (new: writes of the R2 admin routes, in the check write pattern)
- `src/api-failure.ts` (changed: `ApiCall` values `status-settings`, `notify-channels`,
  `notify-failed`, `notify-resend`)
- `src/people-log.ts` (changed: actions and targets of Decision 15)
- `src/token-view.ts` (changed: presets "Status service" `["status"]` and "Notify service"
  `["notify"]`; `missingScope` maps both to `admin`)
- `src/token-pages.ts` (changed: same presets)
- `src/server.ts` (changed: route registration)
- `src/server.status-page.test.ts` (new: includes the component-order route checks and the
  `parseForm` pin)
- `src/server.notifications.test.ts` (new)
- `src/runtime-read.test.ts` (new)
- `src/runtime-write.test.ts` (new)
- `src/navigation.test.ts` (changed)
- `src/icons.test.ts` (changed)
- `src/people-log.test.ts` (changed)
- `src/token-view.test.ts` (changed)
- `src/token-read.test.ts` (changed)
- `test/fake-api.ts` (changed)
- `e2e/run.ts` (changed: fixture pages, keyboard move controls)
- `package.json` (changed: contract pin to the merged 2.4.0 SHA)
- `bun.lock` (changed: same pin)
- `README.md` (changed)
- `docs/configuration.md` (changed)
- `docs/team.md` (changed: `settings.edit` is now built)
- `docs/tokens.md` (changed)

Behavior change: yes. New screens, routes and token presets.

Behavior: R3, and Decision 14 for the resend button.
- A Resend form holds a `requestId` of 24 random base64url characters. A repeat after a lost
  answer posts the same `requestId`.
- The People log row is written for saved and unknown outcomes, as for checks.
- The token list accepts tokens with the new scopes.
- The console reads admin views with the contract default limit (5 MiB, contract
  `client.ts:7`); the largest view is at most 798 932 bytes (R1, "Size bounds").
- The status and channel routes set `maxFormBytes` to 65 536 (`MAX_STATUS_FORM_BYTES`,
  `MAX_CHANNEL_FORM_BYTES`, R3); delete and resend keep the default 8192 (`src/forms.ts:4`).
- The notifications list shows the file channels of `service.report.fileChannels` and the
  database channels of `channels` and `shadowed` (R1: the view no longer copies file channels).
- The failed list reads `GET /admin/notify/failed` (`{state, receivedAt, failed, failedTotal}`).

Checks (real console server, fake api on `127.0.0.1:0`):
- Owner can save, delete and resend. Admin, Member and Viewer get `403` on direct GET and POST of
  every new route (literal `403`).
- A role change between read and write gives `403`.
- Invalid Origin, CSRF and replayed form tokens are refused (`403`, `403`, `409`).
- Locked fields are read-only, and a forged POST of a locked field is refused by the console with
  `422`, and nothing is sent.
- Component order through the real protected route (`POST /status-page` on the real console
  server, with origin, CSRF and form token, body built with `URLSearchParams`):
  - `order=web,db,cdn` (encoded `order=web%2Cdb%2Ccdn`) with `action=save` saves: the response
    is the saved state (not `400`), and the fake api receives `componentOrder` deep equal to the
    literal `["web", "db", "cdn"]`;
  - `action=up:2` with `order=web,db,cdn` re-renders unsaved with the hidden value `web,cdn,db`
    and sends nothing to the fake api;
  - `order=web&order=db` gets `400` "repeated form field" (the unchanged parser) and sends
    nothing;
  - `order=web,,db` and `order=Web` show "The component order is invalid." and send nothing;
  - an empty `order` value with `action=save` sends a document without `componentOrder`.
  - A `parseForm` unit check pins the unchanged parser: `parseForm("order=a&order=b", ["order"])`
    deep equals `{ isOk: false, repeated: "order" }`.
- Form sizes, built in the test with `Buffer.byteLength` of the encoded body:
  - the status form of the largest valid settings (500 order ids of 64 characters, every field
    at its limit, 4-byte characters in the name, one comma-joined `order` field) is below
    47 000 bytes and is accepted; a body
    of 65 537 bytes is refused with `413`, as for check forms;
  - the channel form of a 16 384-byte definition made of 3-byte characters is at most 57 344
    bytes and is accepted, and the fake api receives the same definition (deep equal);
  - a channel definition that the api refuses with `422` over 16 384 bytes shows the limit
    state with the input kept.
- Each state: `412` keeps the input; token rejected; old api (`404`); stale report; rejected
  apply; zero channels; `422` channel limit; `503` resend.
- A fresh notify report with `rejected: [{channelId: "b", reason: "channels[1]: must be at most
  16384 bytes as JSON"}]` and `appliedRevision` equal to `revision`: the row of channel `b`
  contains the literal text "Rejected by pulse-notify: channels[1]: must be at most 16384 bytes
  as JSON", the rows of the other channels do not, and no "Saved, not yet applied" banner is
  shown; a `rejected` entry with `channelId: null` and reason `channels answer: x` is shown as a
  banner with that text.
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

## Repository: status

Files:
- `src/settings.ts` (changed: new env names and token; "set" recorded per field)
- `src/runtime-settings.ts` (new: precedence merge of env, file and database into the effective
  snapshot, fingerprint, locked list, report trimming)
- `src/settings-poll.ts` (new: poll of `/service/status/settings`, re-read of local files, report)
- `src/theme-config.ts` (changed: keys from the contract constants; CSS from a snapshot)
- `src/server.ts` (changed: snapshot in place of fixed options: CSS, CSP, logo, wordmark, flags;
  readiness `settings not loaded`; `/page-settings.json`; the four new contract modules in
  `contractModules`, `:189-206`)
- `src/answer-cache.ts` (changed: fingerprint in the key; in-flight rule)
- `src/http-cache.ts` (changed: fingerprint in the ETag)
- `src/api-filter.ts` (changed: `showLatency`, `showSlos` filtering)
- `src/hidden-checks.ts` (changed: same filtering)
- `src/poller.ts` (changed: `latencyMs: 0` placeholder in `fillLocations`, validated copy only)
- `src/render.ts` (changed: no latency label for a result without `latencyMs`)
- `src/components-view.ts` (changed: order)
- `src/sections.ts` (changed: latency and SLO switches)
- `src/component-latency.ts` (changed: same switches)
- `public/client.js` (changed: fingerprint poll and one reload)
- `src/start.ts` (changed: wiring)
- `src/main.ts` (changed: wiring)
- `src/runtime-settings.test.ts` (new)
- `src/settings-poll.test.ts` (new)
- `src/server.runtime-settings.test.ts` (new)
- `src/server.contract-modules.test.ts` (changed: the four new modules are served)
- `src/poller.test.ts` (changed)
- `src/render.test.ts` (changed)
- `src/api-filter.test.ts` (changed)
- `src/server.privacy.test.ts` (changed)
- `src/server.cache.test.ts` (changed)
- `src/answer-cache.test.ts` (changed)
- `src/http-cache.test.ts` (changed)
- `src/components-view.test.ts` (changed)
- `src/settings.test.ts` (changed)
- `src/theme-config.test.ts` (changed)
- `src/main.startup.test.ts` (changed)
- `e2e/run.ts` (changed: browser convergence and the `showLatency:false` refresh)
- `package.json` (changed: contract pin to the merged 2.4.0 SHA)
- `bun.lock` (changed: same pin)
- `README.md` (changed)
- `docs/configuration.md` (changed)
- `docs/theming.md` (changed)
- `docs/operation.md` (changed)

Behavior change: yes. New settings, live apply and new routes.

Behavior: Decisions 2 and 5–10, and the report size rule of R1.
- **Contract pin and served modules change together.** The browser gets the contract under
  `/pulse-contract/` only for the files in `contractModules` (`server.ts:189-206`, checked at
  `:255`). Contract `2.4.0`'s `index.js` exports four new modules (`runtime-settings.js`,
  `notify-channels.js`, `resend.js`, `validate-runtime.js`), so the change that moves the pin
  also adds those four names; otherwise the existing graph test
  (`src/server.contract-modules.test.ts:107-129`, which follows every import from `index.js` and
  expects `200`) gets `404`. A task that moves the pin therefore includes the module list and
  that test, and passes `bun run check` on its own. `src/server.contract-modules.test.ts` also
  asserts `200` for each of the four paths by name (literal list).
- The settings file follows Decision 7: a file that cannot be used, a deleted one included,
  keeps the last good values and reports `rejected`; `{}` removes all file overrides. Its values
  go through the contract `StatusSettings` validator (radius at most 32 characters). The legacy
  `PULSE_STATUS_THEME` file keeps today's rules.
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
  - removing the file key (the file rewritten without it, or as `{}`) brings back the database
    value;
  - clearing the database key brings back the default.
- The Reset counterexamples literally: a deleted settings file keeps `Local` and reports
  `settings file: cannot read: ENOENT`; `{}` shows `Acme`.
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
- The largest valid settings (every field at its limit, 500 order ids of 64 characters) and 60
  locks give a report of at most 164 224 bytes (literal, R1), measured with `Buffer.byteLength`.
- A 33-character radius in the settings file is rejected and reported; the same value in the
  legacy theme file is accepted, and its lock carries no `value` when its JSON is over 2 048
  bytes.
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
Performance impact procedure 3 (`--others-ref main --b-ref status=<branch SHA> --service-tokens
--expect-report status`, api `main` on both sides; read the api child's shared finding first),
with the `ref <repo> a=<sha> b=<sha>` lines (only status differs) and the log line that B's
report was fresh and applied; one manual run against a local api with a `status` token,
changing `showChecks` in the database and showing the changed `/api/checks` without a restart.

## Repository: notify

Files:
- `src/config.ts` (changed: token, database-only mode, `PULSE_NOTIFY_SECRET_DIR`, poll settings,
  webhook `urlEnv`/`urlFile`, resolving one channel at a time)
- `src/channel-schema.ts` (changed: webhook references, exactly one of `url`, `urlEnv`, `urlFile`)
- `src/remote-channels.ts` (new: poll of `/service/notify/channels`, the two-level validation of
  Decision 6 (envelope, then each element), per-id fallback to the last good version, database
  channel validation with the notify-local reference rules, secret directory resolution)
- `src/channel-set.ts` (new: effective set, shadowing, per-id diff)
- `src/notifier.ts` (changed: reconcile: install, replace, remove workers; live enqueue of a
  resent key)
- `src/delivery.ts` (changed: final outcome hook of `ChannelDelivery`; stopping one channel's
  worker when the reconcile removes or replaces it)
- `src/resend-commands.ts` (new: claim, execute in one transaction, post results with the
  acknowledgement rules)
- `src/service-report.ts` (new: report with file channel views, shadowed ids, rejected list,
  failed list; the normalization of R1 (cut rule, left-out failed entries, event mapping); size
  trimming)
- `src/ledger.ts` (changed: format 5 of Decision 17 with `remote_channels` and
  `resend_commands` tables; migration from 3 and from 4; prune of finished command rows)
- `src/failed-cli.ts` (changed: opens format 5)
- `src/metrics.ts` (changed: series per installed channel)
- `src/api.ts` (changed: Bearer on `/service/*` only)
- `src/index.ts` (changed: wiring)
- `test/remote-channels.test.ts` (new; notify's tests live in the test directory, AGENTS.md
  line 108)
- `test/channel-set.test.ts` (new)
- `test/reconcile.test.ts` (new)
- `test/resend-commands.test.ts` (new)
- `test/service-report.test.ts` (new; includes the event-mapping table of R1, see the notify
  checks)
- `test/ledger.v5.test.ts` (new)
- `test/channel-fields.test.ts` (new: the per-field matrix below)
- `test/support.ts` (changed: fake api routes under /service/notify/)
- `test/config.test.ts` (changed)
- `test/index.test.ts` (changed: startup wiring with the api token and the remote loops; the
  existing test "a hostile SQLite state file stops startup and keeps its bytes", lines 174-210,
  keeps every case unchanged, including the user_version 4 file at line 188)
- `test/failed-cli.test.ts` (changed)
- `test/webhook.test.ts` (changed)
- `test/metrics.test.ts` (changed)
- `test/ledger.test.ts` (changed; asserts format 4 today, so it changes in the same task as the
  ledger version, see "Format-4 test updates" below)
- `test/ledger.v4.test.ts` (changed; same rule)
- `test/reminders.test.ts` (changed; same rule)
- `package.json` (changed: contract pin to the merged 2.4.0 SHA)
- `bun.lock` (changed: same pin)
- `README.md` (changed: format 5)
- `AGENTS.md` (changed: ledger format; line 105 still says format 3)
- `docs/configuration.md` (changed)
- `docs/channels.md` (changed)
- `docs/operation.md` (changed: format 5, migration from 4, downgrade by restoring the v4 backup;
  lines 7-9 and 184-194)
- `docs/troubleshooting.md` (changed: line 31 becomes "other than 3, 4 or 5")
- `docs/development.md` (changed: line 28)

Behavior change: yes. Live reload, database channels, live resend and a new ledger format.

Format-4 test updates (the ledger part of this section; a task split puts them in the same task
as `LEDGER_VERSION` = 5, so the suite stays green):
- `test/ledger.test.ts`, the test at lines 95-113: "format 4 has the exact schema, user_version 4
  and WAL mode" becomes "format 5 has the exact schema, user_version 5 and WAL mode", with the
  five tables of Decision 17 written out as literal SQL and `{ user_version: 5 }`.
- `test/ledger.v4.test.ts`: lines 159-185 "a valid format-3 file migrates to format 5 …" with
  `inspect(file).version` equal to `5` (line 163) and the `.v3.bak` still version `3`; lines
  188-197 "a JSON ledger migrates directly to format 5" (line 196: `5`); the WAL crash and publish
  tests keep every step and expect `{ version: 3, entries: THREE }` after the crash (lines
  245-246, unchanged) and `{ version: 5, entries: THREE }` after the next open (lines 255 and
  266); the refusal tables (lines 200-220 and 539-557) keep every case, rename
  `"user_version 5"` to `"format 5 without its new tables"` (still refused) and add
  `"user_version 6"` (`${SCHEMA_V3} PRAGMA user_version = 6;`), and also assert that no
  `.v4.bak` appears.
- `test/reminders.test.ts`, line 149: `assert.equal(state.version, 5)`.

Tests that must pass unchanged (not in Files): `test/ledger.v2.test.ts`, whose refusal table at
lines 211-212 builds user_version 4 and 5 files on a format-3 schema without the alert_state
table. Those files lack the tables of their claimed format and stay refused under format 5. The
same holds for the user_version 4 case of `test/index.test.ts` line 188 (that file changes only
by added wiring tests). The completion evidence of notify includes
`git diff --exit-code <base> -- test/ledger.v2.test.ts` with exit 0 (base: the main SHA the child
branched from) and the passing hostile-file test of `test/index.test.ts`.

Behavior: Decisions 2, 5, 6, 11–14 and 17, and the report normalization and size rules of R1.
- The public reads stay without a token.
- The failed CLI still refuses with exit `2` while the service holds the lock. When notify is
  stopped, the CLI works offline on format 5 as before, and `docs/operation.md` describes both
  ways.
- A format-5 ledger opened by an older notify is refused by its version check, as today. The docs
  describe the downgrade by restoring `<state>.v4.bak` (Decision 17).
- Empty `PULSE_NOTIFY_API_TOKEN_FILE` (as the bench passes without `--service-tokens`) means not
  set (kit `readString`).

Checks (fake api and fake receivers on `127.0.0.1:0`, fake clock and timers, `mkdtemp` ledger):
- Database-only start with zero channels:
  - a database webhook appears on the next poll;
  - a new matching incident is delivered once;
  - old incidents are seeded, not sent.
- Each routing field (`checks`, `excludeChecks`, `components`, `excludeComponents`, `alerts`,
  `sendIncidents`, `remindEverySeconds`) has a matching and a non-matching event after a live
  change. Widening the routing seeds quietly.
- **Per-field matrix** (`test/channel-fields.test.ts`, table-driven). Every field that a database
  channel can hold, and that the console editor exposes, has three steps on one running notifier
  (one `Notifier` instance and one ledger for the whole row; literal expected values in the
  table):
  1. **live**: the fake api changes the database channel from value V1 to V2 and its revision;
     after one channel poll, without a new notifier, the next matching event shows V2;
  2. **file wins**: the channel file gains a channel with the same id and value V3 (the file is
     re-read at the next poll, Decision 11); the next event shows V3, never V2, and the report's
     `shadowedIds` holds the id;
  3. **back**: the file is rewritten without that channel; the next event shows V2 again.

  | Field | Types | What the fake receiver shows |
  | --- | --- | --- |
  | `urlEnv` | webhook, slack, teams | the request reaches receiver R2 (`PULSE_NOTIFY_SECRET_R2`) instead of R1; V3 is a file `urlEnv` naming R3 |
  | `urlFile` | webhook, slack, teams | the request reaches the URL in `r2.url` of `PULSE_NOTIFY_SECRET_DIR` |
  | `secretEnv`, `secretFile` | webhook | `x-pulse-signature` (`src/channels/webhook.ts:19`) verifies with secret S2, not S1; without a secret the header is absent |
  | `statusUrl` | slack, teams, email | the message body holds the new link |
  | `hideReason` | slack, teams, email | `true`: the incident reason text is absent; `false`: present |
  | `smtp.host` | email | V1 `127.0.0.1` (the stub of `test/smtp-stub.ts`) → V2 `mail.invalid`: the stub gets no connection and the attempt fails with a resolve error; V3 `127.0.0.1`: the stub gets it again |
  | `smtp.port` | email | the stub on the second port gets the message |
  | `smtp.tls` | email | `none`: the stub sees no `STARTTLS`; `starttls`: it sees `STARTTLS` (the stub's `starttls` option, `smtp-stub.ts:52`, `:89`) |
  | `smtp.username`, `smtp.passwordEnv`, `smtp.passwordFile` | email | the stub's `AUTH` (`smtp-stub.ts:54`, `:161`) decodes to the new user name and the sentinel password P2 |
  | `smtp.clientName` | email | the `EHLO` argument (`smtp-stub.ts:155`) |
  | `from` | email | `MAIL FROM` |
  | `to` | email | the set of `RCPT TO` addresses |
  | `subjectPrefix` | email | the `Subject` header starts with the new prefix |
  | `type` | all four | an id changed from webhook to slack: the next event reaches the slack receiver, not the webhook one |
  | routing fields | all four | the matching and non-matching events of the item above, after V2 and after V3 |

  - A sentinel secret value (S2, P2, the R2 URL) is absent from every report body, log line and
    metric of the row.
  - To keep `test_cpu_s` low (Risks), one fake api, one set of receivers and one SMTP stub per
    port serve the whole file, and every wait uses fake timers.
  - These checks need a running notifier with live reconciliation, so they belong with the
    worker reconciliation part of this section, not with the configuration part: a task split
    puts `test/channel-fields.test.ts` in the task that makes the notifier reconcile channels.
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
- Report trimming of Counterexamples: at most 524 288 bytes measured with `Buffer.byteLength`,
  `failed` trimmed first, then `fileChannels`, then `rejected`, totals kept.
- Two-level validation of the channels answer (Decision 6), in a new
  `test/remote-channels.test.ts` case table with a fake api; the expected values are literals:
  - answer r1 `[a (webhook), b (slack), c (webhook)]`, all valid: three installed,
    `appliedRevision` r1, `rejected` `[]`;
  - answer r2 where `b` is 16 385 bytes (an api that does not apply the limit) and `c` changed
    its routing: `a` unchanged, `c` changed, `b` keeps its r1 version (its worker still sends to
    the r1 destination); `rejected` is exactly `[{channelId: "b", reason: "channels[1]: must be
    at most 16384 bytes as JSON"}]`; `appliedRevision` r2; the next poll sends the r2 ETag and
    gets `304`; the ledger's `remote_channels` rows are `a` r2, `b` r1, `c` r2;
  - the same r2 answer on a fresh ledger with no r1 (cold start): `b` is not installed and has
    no row, `a` and `c` are installed;
  - answer r3 with 101 elements, or with id `a` twice: nothing changes (`a`, `b`, `c` as
    before, rows unchanged, stored ETag unchanged), `rejected` is one entry with `channelId:
    null` and a reason starting with `channels answer`, `appliedRevision` stays r2;
  - answer r4 where `b` is valid again: `b` takes the r4 version, `rejected` `[]`.
  A wrong implementation that rejects the whole r2 answer fails the `c` and `appliedRevision`
  checks; one that drops `b`'s r1 version fails the `b` check.
- Ledger format 5 (`test/ledger.v5.test.ts`, Decision 17):
  - a valid format-4 file with three entries (one `failed` with payload and recipients) and two
    `alert_state` rows migrates: `ledger.migration` is `{ from: 4, entries: 3, backup:
    "<file>.v4.bak" }`, `user_version` is `5`, the backup is version `4` with mode `0600`, and
    every entry, mark and alert row reads back equal to the fixture literals;
  - the same file with the `afterSidecars` and `beforePublish` crash hooks (the pattern of
    `test/ledger.v4.test.ts:238-268`): after each crash the file is still `{ version: 4,
    entries: … }` with all rows, and the next open migrates;
  - a format-5 file with a `resend_commands` row of state `queued` (not a notify state), or
    with `remote_channels` missing: `unsupported format`, bytes of main file, `-wal` and `-shm`
    unchanged;
  - a second open of a migrated file has `migration` `undefined`;
  - the prune keeps unposted command rows and deletes a posted, finished row older than 7 days.
- Report normalization (`test/service-report.test.ts`, literal inputs and outputs):
  - a file webhook with `urlFile` of 201 characters `"/" + "a" × 200`: its view `refs` entry is
    `"/" + "a" × 198 + "…"` (200 code units); one of 200 characters is unchanged;
  - a ref of 198 `a` followed by `😀` (U+1F600, two code units, 200 in total) is unchanged; a ref
    of 199 `a` followed by `😀` (201 code units) becomes 199 `a` plus `…`, never a lone
    surrogate;
  - a file id of 201 `x`: view id 199 `x` plus `…`; a rejected reason of 301 characters: 299
    plus `…`;
  - a failed entry with a 301-character key: absent from `failed`, `failedTotal` counts it;
  - event mapping of failed entries, one row each (key → `event`, `isManual`):
    payload `update` with `manual` → `update`, `true`; payload `budget-low` → `budget-low`;
    payload `tls-expiry` → `tls-expiry`; payload `domain-expiry` → `domain-expiry`; no payload
    `5:resolved` → `resolved`, `false` (the legacy JSON case of `test/failed-cli.test.ts:85-89`);
    no payload `7:reminder:2` → `reminder`; no payload `manual:3:update:<32 hex>` → `update`,
    `true`; no payload `budget:check:1:<32 hex>` → `budget-low`; no payload
    `expiry:1:14:<32 hex>` → `unknown`; no payload `x` → `unknown`;
  - key fallback for payloads that are not recognized (each row also expects
    `hasPayload: true`): payload `{"event": "zzz"}` with key `9:opened` → `opened`, `false`;
    payload `{"event": "zzz", "manual": {}}` with key `manual:3:resolved` → `resolved`, `true`
    (the key decides `isManual`, not the payload); payload `{}` (no `event`) with key
    `budget:check:1:<32 hex>` → `budget-low`, `false`; payload `{"event": "zzz"}` with key `x` →
    `unknown`, `false`; and the recognized case for contrast: payload `{"event": "update"}`
    without `manual` and key `manual:3:opened` → `update`, `false` (rule 1 does not read the
    key);
  - every report of these tests passes `validateNotifyServiceReport` of contract `2.4.0`.
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

Completion evidence: `bun run check` output; the notify A/B table of Performance impact procedure
3 (`--others-ref main --b-ref notify=<branch SHA> --service-tokens --expect-report notify`, api
`main` on both sides; read the api child's shared finding first), with the `ref <repo> a=<sha>
b=<sha>` lines (only notify differs) and the log line that B's report was fresh and applied, and `test_cpu_s` called out; a local timing of opening a
format-4 ledger with 10 000 entries as format 5 (reported, not gating); one manual run with a
local api, a `notify` token and a fake webhook receiver, showing a database channel added and a
resend delivered without a restart.

## Repository: deploy

Files:
- `e2e/compose.runtime.yaml` (new, test only: status `PULSE_STATUS_API_TOKEN_FILE`, notify
  `PULSE_NOTIFY_API_TOKEN_FILE`, `PULSE_NOTIFY_SECRET_DIR`, `PULSE_NOTIFY_SECRET_E2E_HOOK`,
  `PULSE_NOTIFY_RETRY_ATTEMPTS: "2"`, `PULSE_NOTIFY_RETRY_DELAY_MS: "500"`, read-only token and
  secret mounts, and the `e2e-hook` receiver service: `bun-tools` running `/e2e/hook.mjs`, as
  `e2e-target` does in `e2e/compose.e2e.yaml:47-53`, with port 8080 published on `127.0.0.1`)
- `e2e/hook.mjs` (new: webhook receiver. Per `idempotency-key` it counts `seen` (every request)
  and `accepted` (requests it answered `200`). `POST /control` with `{"status":500}` or
  `{"status":200}` sets the answer for all later webhook requests; `GET /counts?key=<key>`
  answers `{"seen":n,"accepted":m}`. The scenario reaches it through `published_port e2e-hook
  8080` (`e2e/compose-e2e.sh:303-306`).)
- `e2e/runtime-settings.sh` (new: the scenario)
- `e2e/runtime-settings.test.sh` (new: the scenario's parsing helpers on fixed fixture answers,
  and `docker compose ... config --quiet` of the overlay)
- `e2e/compose-e2e.sh` (changed: a "Runtime settings" step after "Console probe locations",
  in the pattern of `:1097-1120`)
- `.github/workflows/ci.yml` (changed: a `lint` step `bash e2e/runtime-settings.test.sh` after
  `:67`; in `e2e-dev`, `grep -qx 'ok: runtime settings' e2e-dev.log` after `:306`)
- `README.md` (changed)
- `full/README.md` (changed)
- `dev/README.md` (changed)

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
  5. Delivery. Create the database webhook channel `e2e-db-hook` with `urlEnv:
     PULSE_NOTIFY_SECRET_E2E_HOOK` and no routing fields through the console. Wait until
     `GET /admin/notify/channels` has `service.state` `"fresh"` and
     `service.report.appliedRevision` equal to its `revision`. Create manual incident A with
     `POST /manual-incidents` and the admin token (the script's own copy of `manual_call`,
     `e2e/compose-e2e.sh:257-262`; the body as at `:543`, with `componentIds: []`). Wait until `GET /counts?key=manual:<A>:opened` is `{"seen":1,"accepted":1}`.
  6. Failure. `POST /control {"status":500}`. Create a second manual incident B. Wait (at most
     60 s) until `GET /admin/notify/failed` lists `channelId` `e2e-db-hook` with key
     `manual:<B>:opened`; with `PULSE_NOTIFY_RETRY_ATTEMPTS: "2"` and a 500 ms delay that takes
     a few seconds. Read `seen` for that key as `n0` (at least `1`, every request refused, so
     `accepted` is `0`). This is a separate event from step 5, so its failed entry exists
     only because the receiver refused it.
  7. Resend. `POST /control {"status":200}`. In the console failed list, press Resend once on the
     row `e2e-db-hook` / `manual:<B>:opened`. Wait until `GET /counts?key=manual:<B>:opened` has
     `accepted` `1` and the row is gone from `GET /admin/notify/failed`; wait 15 s more (three
     claim intervals), then check: `accepted` is still `1` and `seen` is `n0 + 1` (exactly one
     more request, the literal `1`), and `manual:<A>:opened` is still `{"seen":1,
     "accepted":1}`. All counts come from the receiver, not from notify or the api.
  8. Check that the status `showChecks` field shows "Set by PULSE_STATUS_SHOW_CHECKS".
  9. Check that no token value appears in the step output (the pattern of `:1110-1115`).
  10. Clean up: delete `e2e-db-hook` with the admin token, resolve manual incidents A and B
      (`POST /manual-incidents/<id>/updates` with `{"status":"resolved","message":"Fixed."}`, as
      `:562`),
      and recreate status and notify without the overlay, so the later steps run as before.

Checks:
- `bash e2e/runtime-settings.test.sh` passes in `lint`. It runs the scenario's parsing helpers
  on fixed fixture answers with literal expectations: a `/counts` answer `{"seen":3,"accepted":0}`
  gives `3` and `0`; a failed view that lists `e2e-db-hook` / `manual:7:opened` is found, one
  that lists only `other` / `manual:7:opened` is not; an admin view with `appliedRevision` ≠
  `revision` is "not applied".
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
3. Per-setting live tests in status and notify (the status matrix and the notify per-field
   matrix, `test/channel-fields.test.ts`):
   - a database change reaches the running service without a restart;
   - a file value overrides the database value;
   - removing the file value brings the database value back.

   The expected values are literals in the tests (Counterexamples).
4. The notify resend test: exactly one more receiver request with the same key, from a single
   command, also after a lost admission answer. Expected count `1`, a literal. The api test of
   a lost `200` after reuse: command count `1`, a literal.
5. The status poller test: a `/api/checks` answer without `latencyMs` refreshes without an error
   state (literal: no error kind), and fails on `8b6d431`.
6. The api limit tests: 262 144 bytes accepted and one byte more refused, 16 384 bytes per
   channel accepted and 16 385 refused, the 101st channel refused, the 65 537-byte status
   settings refused, the 524 289-byte report `413`, the serialized admin view at most 798 932
   bytes, the 1000-open-command `503`, and exactly one finished command deleted at capacity; all
   literals.
7. The performance evidence of Performance impact: the contract CPU A/B of procedure 1 (two
   worktrees measured independently), the api A/B with `--simulate-services` and its traffic
   counts, and the status and notify A/Bs with `--service-tokens --expect-report` on the merged
   api (two independently built sides each).
8. The notify format-5 and report tests: a format-4 file migrates with `from: 4`, `user_version`
   `5` and its alert rows; the updated format-4 suites pass with the literal `5`; a 201-character
   reference is reported as 200 characters ending in `…`; the event mapping rows of the notify
   section hold their literal values.
9. deploy `e2e-dev` prints `ok: runtime settings`. This is the integrated check across console,
   api, status, notify and a fake receiver.
