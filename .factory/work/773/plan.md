# Spec #773: console: polish the check screens

## Goal

Fix six text and logic defects on the console check screens. They come from screenshots of
console `main` (c78c9d5, with api `main`):

1. Check detail, State: "Last reason" shows a raw float (`latency 1501.4197810000041ms`).
2. Check detail, Settings: the terms are raw API keys (`intervalMs`, `retryDelayMs`, …).
3. Check detail, Recent results: times appear twice.
4. Create vs. edit: the HTTP create form seems to have no Headers and no JSON assertions.
5. Heartbeat usage: the curl line holds the internal address `http://api:3000`.
6. Check detail, State: `Error budget exceeded (-87400.0 %)` shows a meaningless number.

The shared styling defects (radio layout, mobile table, danger button, 403 page) moved to #774,
which is closed. This spec does not restyle anything.

## Sources

- Issue #773, its body (with the section "Added after the second screenshot round") and its
  comments. The only comments are Factory records of the issue-review run; no person has made a
  decision yet.
- Issue review `.factory/work/773/issue-review.md`. It found no blocking question. This spec
  adopts its assumptions 1 to 7 and settles the choices it left open: the full label map (R2),
  milliseconds in Recent results only (R3), both disclosures open (R4), the placeholder name and
  note (R5), and the fallback above 100 (R6).
- Shared findings: `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/773`
  answered `HTTP 404` in this run, so there are no findings yet. That is normal for a feature
  without children.
- Read-only clones, read directly in this run: console `5cdc34b`, api `f25519b`, contract
  `c4a2eb5`, probe `9490141`, config `bc87049`. The console pins contract
  `66818a24b81f5d0d86eee939dad64fa126617ba2` (`package.json` `dependencies`). Read through
  `gh api` at that pin, `src/admin.ts` and `src/schema.ts` differ from the clone only in comments,
  status-text tables and the export of `plainText`. The check, view, result and SLO shapes used
  below are the same.

### Current behavior (console `5cdc34b` unless stated)

- **Last reason.** `stateEntries` (`src/check-detail-pages.ts:235–260`) puts
  `state?.lastReason ?? "None"` in as escaped text at line 240. The reason cells of Locations
  (line 322) and Recent results (line 421) show `result.reason ?? ""` as it is. The probe writes
  the reason `latency ${r.latencyMs}ms over objective ${objective}ms`
  (probe `src/check.ts:242`). On probe `main` `latencyMs` is already a whole number
  (`latencyBetween`, probe `src/check.ts:132–134`, `Math.round`), and contract `resultSchema`
  makes `latencyMs` an integer (contract `src/schema.ts:509`). The float in the screenshot is
  therefore a reason string that an older probe build stored. Stored reasons stay as they are
  (constraint: what is stored does not change), so the console must round when it renders.
- **Settings.** `settingsEntries` (`src/check-detail-pages.ts:144–162`) writes the fixed rows
  Name, Id, Type and Source. Then it writes one row per remaining key of the view, in the view's
  key order, with the raw key as the `<dt>` (line 152). It skips `SKIPPED_FIELDS` (lines
  116–125: id, name, type, source, headers, body, hasSecret, secret). After that come the
  `Header <name>`, `Body: set` and `Secret: set` rows. `shadowedPage` (line 526) uses the same
  `settingsSection`. The view keys that reach line 152 come from contract `adminCheckViewSchema`
  (contract `src/admin.ts:142–153`) over `httpCheckSchema` (`src/schema.ts:267–320`),
  `tlsCheckSchema` (322–347), `probedFields` (399–416), `tcpCheckSchema` (421–433),
  `dnsCheckSchema` (435–450), `domainCheckSchema` (452–474) and `heartbeatCheckSchema`
  (476–498). They are: `url`, `method`, `intervalMs`, `timeoutMs`, `latencyObjectiveMs`,
  `retries`, `retryDelayMs`, `keyword`, `expectedStatus`, `jsonAssert`, `availabilityTarget`,
  `host`, `port`, `warnDays`, `dnsName`, `recordType`, `expected`, `resolver`, `domain`,
  `period`, `grace`.
- **Recent results.** `resultsSection` (`src/check-detail-pages.ts:435–457`) renders each
  element of `detail.results.value` once (`read.value.map(resultCells)`). `readCheckDetail`
  makes one results request (`docs/checks.md:58–61`, `src/server.checks.test.ts:602`).
  `resultCells` (lines 413–423) shows `utcTime(result.timestamp)`. `utcTime`
  (`src/check-format.ts:23–28`) cuts the ISO string at seconds, so it drops the milliseconds.
  pulse-api stores one row per `(check_id, location, timestamp)` (api `src/migrations.ts:57`,
  `CREATE UNIQUE INDEX results_by_sample`; insert with `ON CONFLICT … DO NOTHING`,
  api `src/service.ts:559–561`), so the API never returns one sample twice. Every probe starts a
  new check after a random delay below `min(intervalMs, 1000)` ms (probe
  `src/scheduler.ts:38–46`) and then runs it once per interval. So the probes `eu` and `us`
  usually report in the same second. Their two rows then show the same time, which is the
  "two timestamps twice" of the screenshot. These are two real samples from two locations, not
  a duplicate. The console paging keeps whole equal-timestamp groups
  (`docs/checks.md:58–61`, fixture `webResults`, `test/check-fixtures.ts:243–246`).
- **Editor.** Create and edit both render `httpFields` (`src/check-editor-page.ts:416–428`),
  which already holds Body, Headers (20 rows) and JSON assertions (10 rows). The difference is
  only what is visible. `headerRows` (lines 338–354) wraps the rows in
  `<details${existing > 0 ? " open" : ""}>` with `<summary>Headers</summary>`, so an empty create
  form shows Headers closed, while the edit form of a check with headers shows it open. JSON
  assertions sit in a closed `<details>` with `<summary>JSON assertions</summary>` (lines
  425–427) in both modes, also when the edit form prefills stored assertions (lines 160–165).
  Playwright `page.fill` cannot fill an input inside a closed `<details>`, and the browser
  create flow (`e2e/run.ts` `createEach`, about line 1441) fills no header or assertion.
- **Heartbeat.** `heartbeatSection` (`src/check-detail-pages.ts:200–211`) builds
  `heartbeatLine(`${apiUrl}/heartbeat/${segment}`)`. `apiUrl` is `DetailContext.apiUrl`
  (lines 479–484), which `src/check-routes.ts:137–142` fills from `apiUrlOf(deps)` (line 71–72:
  the saved server-to-server pulse-api URL, `http://api:3000` in the Compose stack). The note
  `HEARTBEAT_NOTE` (lines 50–51) reads "Use the address under which your job reaches pulse-api.
  The secret is not shown again." `heartbeatLine` (`src/shell-line.ts:22–25`) quotes the header
  and the URL with `shellQuote`. Tests pin the internal URL: `src/server.checks.test.ts:799–800`
  and `e2e/run.ts:1358–1366`. `docs/checks.md:98–104` shows the example with
  `http://localhost:3000`.
- **Error budget.** `budgetText` (`src/check-format.ts:15–21`) prints
  `budgetRemaining.toFixed(1)` and words the result "left" or "exceeded (…)". `sloText`
  (`src/check-detail-pages.ts:262–268`) appends it. Contract `sloSchema.budgetRemaining`
  (contract `src/schema.ts:605–609`) is a finite number that is negative when the budget is
  exceeded, and api `budgetRemaining` (api `src/slo.ts:10–13`) computes
  `100 * (1 - (100 - availability) / (100 - target))`. With target 99.9 and availability 12.6
  that gives about -87300. A large negative value is therefore a correct API value that the console
  words badly. With `availability <= 100` and `target < 100` the value is never above 100. Tests
  pin the old wording: `src/check-format.test.ts:22–34`, `src/server.checks.test.ts:644–650`,
  and `docs/checks.md:295–296`.

## Scope

Console only: `src/check-detail-pages.ts`, `src/check-format.ts`, `src/check-editor-page.ts`,
their tests, the HTTP tests in `src/server.checks.test.ts`, the browser checks in `e2e/run.ts`,
and the console docs `docs/checks.md` (and `README.md` only if a sentence there becomes wrong).

## Non-goals

- No restyle: no change to `src/styles.ts`, class names, panels, table wrappers or radios (#774).
- No change to roles, routes, permissions, CSRF or form tokens, POST guard order, revisions,
  write payloads, field names, row limits, validation, or stored data in the console or the API.
- No rewrite of a stored or served reason. No change to the probe, the API SLO formula, or the
  contract.
- No deduplication of results by time, no change to paging, cursor or page size.
- No new setting, route or proxy for heartbeats. The console does not guess the public pulse-api
  address.
- No change to `utcTime`. Other screens keep second precision.
- No new dependency and no lockfile change. No other repository changes.

## Required behavior

### R1. Rounded latency reason

Add an exported pure function `reasonText(reason: string): string` to `src/check-format.ts`.

- When `reason` matches `/^latency (\d+\.\d+)ms/` (a decimal right after `latency ` at the very
  start, followed by `ms`), replace only that number with `Math.round(Number(number))` and keep
  the rest of the string byte for byte. For example, `latency 1501.4197810000041ms over objective
  500ms` becomes `latency 1501ms over objective 500ms`.
- Every other string is returned unchanged: an integral latency, any other reason, and a number
  in any other place.
- The State "Last reason" row uses `reasonText(state.lastReason)` when the reason is a string,
  and `None` when it is `null` or there is no state. The Reason cells of Locations and Recent
  results use `reasonText(result.reason)` when the reason is a string, and `""` when it is
  `null`. Escaping stays where it is (`definitionList`, `cellHtml`), so the output is escaped
  exactly once.
- The API answer is not changed. The console only changes the text it renders.

### R2. Readable settings labels

Add a fixed map from view key to label in `src/check-detail-pages.ts`. `settingsEntries` uses it
for the `<dt>` of every row it writes at line 152. The row order (the view's key order), the
values (`valueText`), the fixed rows Name, Id, Type and Source, the source tag, the `Header`,
`Body: set` and `Secret: set` rows and `SKIPPED_FIELDS` stay as they are. The labels follow the
editor wording (`src/check-editor-page.ts`, `msInput` appends ` (ms)`, line 232–234):

| View key             | Label                    |
| -------------------- | ------------------------ |
| `url`                | `URL`                    |
| `method`             | `Method`                 |
| `intervalMs`         | `Interval (ms)`          |
| `timeoutMs`          | `Timeout (ms)`           |
| `latencyObjectiveMs` | `Latency objective (ms)` |
| `retries`            | `Retries`                |
| `retryDelayMs`       | `Retry delay (ms)`       |
| `keyword`            | `Keyword`                |
| `expectedStatus`     | `Expected status`        |
| `jsonAssert`         | `JSON assertions`        |
| `availabilityTarget` | `Availability target (%)`|
| `host`               | `Host`                   |
| `port`               | `Port`                   |
| `warnDays`           | `Warn days before expiry`|
| `dnsName`            | `DNS name`               |
| `recordType`         | `Record type`            |
| `expected`           | `Expected values`        |
| `resolver`           | `Resolver`               |
| `domain`             | `Domain`                 |
| `period`             | `Period (ms)`            |
| `grace`              | `Grace (ms)`             |

A key that is not in the map (a field that a newer contract adds) keeps its raw key as the
label, so no stored field disappears from the page. Values and units stay as they are: the
milliseconds are not converted.

### R3. Recent results: one row per sample, times with milliseconds

- Recent results keeps one row per element of the API answer. Order, Location column, paging
  links, `Older results` cursor (`before=<timestamp of the last row>`, the exact epoch ms) and
  `Newest results` stay as they are.
- The Time cell of Recent results only uses a new exported formatter
  `utcTimeMs(epochMs: number): string` in `src/check-format.ts`. It returns
  `YYYY-MM-DD HH:MM:SS.mmm UTC`, for example `1762343970123` →
  `2025-11-05 11:59:30.123 UTC`. `utcTime` and every other time on the console stay at seconds.
- When the table has rows, a paragraph stands above it:
  `One row per result. Each location reports its own result, so two rows can share a time.`
  The empty state `No results yet` stays without that paragraph.
- No other cause of a repeated row was found (see Current behavior). If the implementer
  reproduces a row that is rendered twice for the same `(location, timestamp)`, the implementer
  records the cause and fixes it at that point. Equal times from different locations stay two
  rows.

### R4. Same HTTP fields visible on create and edit

- `headerRows` always renders `<details open>` with `<summary>Headers</summary>`, in create and
  edit, with or without stored headers. The first `max(existing + 3, 5)` rows and the inner
  `More rows` disclosure stay as they are.
- The JSON assertions disclosure always renders `<details open>` with
  `<summary>JSON assertions</summary>`, in create and edit.
- Nothing else in the editor changes: the shared `httpFields`, 20 header rows, 10 assertion
  rows, field names, defaults, validation, and the edit-only Keep/Replace/Remove rows for stored
  literal headers and body. Create still has the `id` input and edit still shows the id as text.
  These are the only documented differences, and field parity does not include them.
- Without JavaScript, both forms show the header and assertion inputs, and a person can fill and
  submit them.

### R5. Heartbeat line with a placeholder address

- `heartbeatSection` stops reading `DetailContext.apiUrl`. The curl URL is
  `<pulse-api-url>/heartbeat/<segment>`, where `<pulse-api-url>` is a literal placeholder and
  `<segment>` is `apiIdSegment(view.id)` as today. The line is still built by `heartbeatLine`,
  so it is one quoted word:
  `curl -fsS -X POST -H 'Authorization: Bearer <secret>' '<pulse-api-url>/heartbeat/nightly-backup'`.
- The note below the line becomes: `Replace <pulse-api-url> with the address under which your
  job reaches pulse-api, for example https://pulse-api.example.com, and <secret> with the secret
  of this check. The secret is not shown again.`
- The `<pre id="heartbeat-line">`, the copy button, HTML escaping, POSIX quoting and the text for
  the ids `.` and `..` (`unaddressableHeartbeatText`) stay as they are. The copied text keeps
  both placeholders.
- Remove `apiUrl` from `DetailContext` if nothing else reads it. The detail reads still use the
  saved API URL (`src/check-routes.ts:137–139`).
- The internal pulse-api address never appears in the Heartbeat usage section.

### R6. Error budget wording

`budgetText(budgetRemaining)` returns:

- `budgetRemaining < 0`: `Error budget exceeded`, with no number and no parenthesis.
- `0 <= budgetRemaining <= 100`: `<budgetRemaining.toFixed(1)> % of the error budget left`, as
  today.
- `budgetRemaining > 100` (the API formula cannot produce it): `Error budget not available`.

`sloText` keeps its other texts (`No availability objective`, `Objective <target> %: no
results in the last 30 days`, the availability text and the 30-day window). The API value is not
clamped or recalculated.

## Performance impact

None expected. The change is console-only template text and three small pure formatters. It
does not touch pulse-api, so none of the metrics of api `bench/budgets.json` (startup CPU, load
CPU, idle or peak RSS, test CPU, build CPU, wall-clock startup, p95 latency, requests per
second, image size) can move.

## Security impact

Security impact: no
The change touches only console rendering. It touches no auth, admin route, trust-boundary
parser, probe client, file write, error or log text, dependency, Dockerfile or CI.

The rendered reason is still API data. It goes through `escapeHtml` exactly once, as today, and
R1 adds a test with HTML characters in a reason. The heartbeat line now holds less data: no
saved API address, which removes an internal host name from a copied shell line.

## Rollout order

One repository: only `console` changes. It reads API fields that exist in its pinned contract
(`66818a24`) and that api `main` serves. No other repository needs a release, and no older
consumer reads anything that this spec changes.

## Counterexamples

R1 `reasonText` (expected values are literals in this spec):

| Input | Expected | A wrong implementation that would fail |
| ----- | -------- | -------------------------------------- |
| `latency 1501.4197810000041ms over objective 500ms` | `latency 1501ms over objective 500ms` | leaves the float |
| `latency 1501.5ms over objective 500ms` | `latency 1502ms over objective 500ms` | truncates instead of rounding |
| `latency 1501ms over objective 500ms` | unchanged | appends `.0` |
| `keyword "1.5" not found` | unchanged | rounds every decimal in the string |
| `timeout after 1500.5ms` | unchanged | matches without the `^latency ` anchor |
| `<b>latency</b> 2.5ms` | unchanged, then rendered as `&lt;b&gt;latency&lt;/b&gt; 2.5ms` | escapes twice or not at all |
| `null` lastReason | Last reason `None` | renders `null` or an empty `<dd>` |

R2 labels:

- A database HTTP view with `intervalMs` and `retryDelayMs` renders `<dt>Interval (ms)</dt>` and
  `<dt>Retry delay (ms)</dt>`, and no `<dt>intervalMs</dt>` or `<dt>retryDelayMs</dt>`.
- A view of each type renders exactly the labels of the table for its keys. A
  `<dt>` that equals any of the 21 raw keys is a failure. A view that has an extra key `fooBar`
  (built in the test, not through the contract) renders `<dt>fooBar</dt>`: a map that drops
  unknown keys fails.
- The shadowed page `/checks/shadowed?id=<id>` renders the same labels. A fix that only touches
  `checkDetailPage` fails.

R3 times (from `new Date(t).toISOString()`, worked out in this spec and written as literals):

- One location `eu` with `1762343970123` and `1762343970987` renders two rows with
  `2025-11-05 11:59:30.123 UTC` and `2025-11-05 11:59:30.987 UTC`. `utcTime` would give
  `2025-11-05 11:59:30 UTC` twice.
- `eu` and `us` both at `1762343970000` render two rows with `2025-11-05 11:59:30.000 UTC`.
  A fix that deduplicates by time renders one row and fails.
- With the 21-row fixture `webResults` (20th and 21st share a timestamp), all 21 rows render and
  `Older results` links to `before=<the exact epoch ms of the last row>`. A fix that rounds the
  cursor to seconds, or cuts the tie group to 20 rows, fails.
- The Last result time in State and the Locations Time column stay at seconds
  (`… 11:59:30 UTC`). A fix that changes `utcTime` fails.

R4 parity:

- GET `/checks/new?type=http` and GET `/checks/edit?id=<an HTTP check without headers or
  assertions>` both contain `<details open>\n<summary>Headers</summary>` and
  `<details open>\n<summary>JSON assertions</summary>`. Opening them only when data exists fails
  the create case.
- Both still contain 20 `header_<i>_name` (or stored-header) rows, 10 `assert_<i>_pointer`
  inputs, and the `More rows` disclosure. A fix that removes `More rows` or the row limits
  fails.

R5 heartbeat:

- The fake API listens at `http://127.0.0.1:<port>`. The heartbeat detail page then contains
  `'&lt;pulse-api-url&gt;/heartbeat/nightly-backup'` in `<pre id="heartbeat-line">` and does not
  contain `127.0.0.1:<port>/heartbeat`. A fix that uses `PULSE_CONSOLE_PUBLIC_URL`, the request
  `Host`, or `localhost` fails.
- The ids `.` and `..` still show `unaddressableHeartbeatText` and no `curl`.
- An id with `'` (if a fixture has one) stays inside one quoted word through `shellQuote`.

R6 budget (literals in this spec):

| `budgetRemaining` | `budgetText` |
| ----------------- | ------------ |
| `-87400` | `Error budget exceeded` |
| `-0.04` | `Error budget exceeded` (never `-0.0 %`) |
| `0` | `0.0 % of the error budget left` |
| `42.26` | `42.3 % of the error budget left` |
| `100` | `100.0 % of the error budget left` |
| `100.5` | `Error budget not available` |

No statistic is computed by this spec. The budget value comes from the API unchanged.

## Contract fields

No new names in the contract, the config or the API. The new console-internal names are
`reasonText`, `utcTimeMs` (exported from `src/check-format.ts`), the settings label map, the
results note, and the placeholder `<pulse-api-url>`. Searches in this run, each with no match:

```sh
grep -rn 'utcTimeMs' .repos/contract/src .repos/config .repos/console/src .repos/console/e2e .repos/console/test
grep -rn 'reasonText' .repos/contract/src .repos/config .repos/console/src .repos/console/e2e .repos/console/test
grep -rn 'SETTING_LABELS' .repos/contract/src .repos/config .repos/console/src
grep -rn 'RESULTS_IDENTITY_TEXT' .repos/contract/src .repos/config .repos/console/src
grep -rn 'pulse-api-url' .repos/contract/src .repos/config .repos/console/src .repos/console/e2e .repos/console/test
```

`SETTING_LABELS` and `RESULTS_IDENTITY_TEXT` are suggested names. The implementer may choose
others in the same module, but must not export one only for a test.

## Repository: console

Files:
- `src/check-format.ts` (change: `reasonText`, `utcTimeMs`, `budgetText`)
- `src/check-format.test.ts` (change)
- `src/check-detail-pages.ts` (change: label map, reason cells, results time and note,
  heartbeat line and note, `DetailContext`)
- `src/check-routes.ts` (change only if `DetailContext.apiUrl` is removed, line 142)
- `src/check-editor-page.ts` (change: both disclosures open)
- `src/check-editor-page.test.ts` (change)
- `src/server.checks.test.ts` (change)
- `test/check-fixtures.ts` (change only to add fixtures; existing exports keep their values)
- `e2e/run.ts` (change)
- `docs/checks.md` (change)
- `README.md` (change only if a sentence becomes wrong; the detail sentence at `README.md:16`
  stays right as written)

Behavior change: yes
The console renders new labels, times, reason, budget and heartbeat texts and opens two form
disclosures.

### Tool facts (cited)

- Bun 1.4.0: `package.json` `engines.bun` and `packageManager` `bun@1.4.0`; CI
  `.github/workflows/ci.yml` job `browser` sets `bun-version: 1.4.0`.
- `bun run check` = `bun run lint && bun run typecheck && bun run test` (`package.json`
  `scripts.check`). `lint` = `biome check . && pulse-eslint . && pulse-workflows`; `typecheck`
  runs `tsc --noEmit` from `typescript7` (`npm:typescript@7.0.2`) for the root and `-p e2e`;
  `test` = `bun test` (`package.json` `scripts`).
- `bun run check:browser` = `bun e2e/run.ts` (`package.json` `scripts.check:browser`). CI runs it
  in job `browser` after `bunx playwright install --with-deps chromium`
  (`.github/workflows/ci.yml`, job `browser`, steps "Install Chromium" and "Browser checks").
  Playwright 1.64.1 and `@axe-core/playwright` 4.14.0 are devDependencies (`package.json`).
- `bunfig.toml` `[test]` lines 1–4: `coverage = true`,
  `coverageThreshold = { lines = 0.8, functions = 0 }`, and test, `test/**` and `dist/**` are
  ignored for coverage.
- Biome: `biome.json` line 2 `extends ["@lorenzh/pulse-config/biome.json"]`, with
  `@biomejs/biome` 2.6.3 (`package.json`). The pinned config
  `lorenzh/pulse-config@04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` `biome.json` lines 8–17
  includes `**` and excludes `dist`, `node_modules`, `bun.lock`, `*.html` and `test/fixtures`.
  The pinned file is the same as the config clone (`bc87049`), checked with `gh api` and
  `diff` in this run.
- CI job `check` uses
  `lorenzh/pulse-config/.github/workflows/check.yml@04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`
  (`ci.yml` job `check`). At that pin, `check.yml` lines 25–38 run `bun install
  --frozen-lockfile`, `bun run lint`, `bun run typecheck` and `bun run test` (build steps off by
  default). It is the same as the config clone.
- The SonarJS cognitive-complexity limit of 15 per function is in `AGENTS.md` ("Tests (TDD)").
  Keep `settingsEntries`, `resultsSection` and `budgetText` under it: put the label lookup in the
  map, not in a `switch`.

### Tasks of this section

1. **Formatters (R1, R3 formatter, R6).** In `src/check-format.ts` add `reasonText` and
   `utcTimeMs` and change `budgetText`, starting with failing tests in `src/check-format.test.ts`.
   The tests use every R1 row except the HTML one (that is a page test), the two R3 time
   literals, and every R6 row. Replace the old rows `-0.04 → Error budget exceeded (-0.0 %)` and
   `-12.25 → Error budget exceeded (-12.3 %)`.
2. **Detail page (R1 use, R2, R3, R5, R6 use).** Change `src/check-detail-pages.ts` as in R1 to
   R5, starting with failing HTTP tests in `src/server.checks.test.ts` through
   `GET /checks/check` and `GET /checks/shadowed`:
   - Last reason: a state override with the float reason shows
     `<dt>Last reason</dt><dd>latency 1501ms over objective 500ms</dd>` and no
     `1501.4197810000041`. The HTML reason renders escaped once, and a `null` reason renders
     `None`. The same float reason in a Locations result and a Recent results row renders
     rounded. The fake API answer (the test's fixture object) still holds the float after the
     request.
   - Settings: one fixture view per type (HTTP with every optional field set, TLS, TCP, DNS
     with `expected` and `resolver`, domain, heartbeat) renders every label of the R2 table for
     its keys and none of the raw keys as a `<dt>`. The existing `Header …`, `Body: set`,
     `Secret: set`, `Id` and `Source` assertions (`src/server.checks.test.ts:606–612`) still
     pass. The shadowed page renders the same labels.
   - Recent results: the R3 rows and texts. The existing 21-row paging test still passes, with
     its Time expectations changed to the `.mmm` form.
   - Heartbeat: change `src/server.checks.test.ts:799–800` to the placeholder line, assert the
     new note and that the body does not contain `${api.url}/heartbeat`. The `.` id test (lines
     1008–1020) still passes.
   - Budget: change the expectation at `src/server.checks.test.ts:644–650` to
     `Availability 99.95 % over 30 days, objective 99.9 %. Error budget exceeded`, and add a
     state with `budgetRemaining: -87400` that renders `Error budget exceeded` and no `-87400`.
3. **Editor (R4).** Change `headerRows` and the JSON assertions disclosure in
   `src/check-editor-page.ts`, starting with failing tests in `src/check-editor-page.test.ts`
   (or the server check tests) for both create and edit of an HTTP check without headers or
   assertions, as in the R4 counterexamples. Existing write tests in
   `src/server.checks-write.test.ts` and `src/server.checks-change.test.ts` must pass unchanged:
   payloads and validation do not change.
4. **Browser checks.** Extend `e2e/run.ts`:
   - The fixture API gives the check `web` the float `lastReason`. On `/checks/check?id=web` the
     page shows `latency 1501ms over objective 500ms` and not `1501.4197810000041`, and it shows
     the terms `Interval (ms)` and `Retry delay (ms)` and not `intervalMs`.
   - The heartbeat check at `e2e/run.ts:1358–1366`: the expected line becomes the placeholder
     line. It is a literal in the test, not read from the page builder. The copied text equals
     it.
   - Create flow (`createEach`): on `/checks/new?type=http`, without clicking a summary, fill
     `header_0_name` = `X-E2E`, `header_0_kind` = plain, `header_0_value` = `1`, a second row
     with `header_1_name` = `X-E2E-Token`, kind env and value `PULSE_HEADER_E2E`, and `assert_0_pointer` = `/ok` with mode `exists`.
     The POST body that the fake API receives holds
     `headers: {"X-E2E":"1","X-E2E-Token":{"env":"PULSE_HEADER_E2E"}}` and
     `jsonAssert: [{"pointer":"/ok","exists":true}]`. On `/checks/edit?id=<an HTTP check
     without stored headers>` the same inputs are visible and fillable without clicking a
     summary.
   - Keep the existing narrow-screen, no-JavaScript, design-matrix and axe checks green.
5. **Docs.** Update `docs/checks.md`: Settings (line 45–46: readable labels, raw key only for an
   unknown field), Recent results (lines 58–61: one row per result, times with milliseconds, the
   note), the heartbeat example (lines 98–104: the placeholder line and the note), Editor fields
   (lines 166–171: Headers and JSON assertions open on create and edit), Display formats (lines
   295–297: the R6 wording and `.mmm` in Recent results).

### Completion evidence

- `bun run check` passes, with coverage at or above the `bunfig.toml` threshold.
- `bun run check:browser` passes, including the new browser assertions of task 4.
- Each new test fails on console `5cdc34b` and passes after the change. The expected values are
  the literals of this spec, not values regenerated from the code under test.
- As `AGENTS.md` ("End-to-end checks") requires, the implementer starts the fixture console with
  `bun e2e/run.ts --serve`, opens `/checks/check?id=web`, `/checks/check?id=nightly-backup`,
  `/checks/new?type=http` and `/checks/edit?id=web`, and records the command and what was seen
  in the PR.
- `git diff --stat` shows no change to `src/styles.ts`, `src/check-form.ts`,
  `src/check-write.ts`, `src/server.ts`, `src/permissions.ts`, `package.json` or `bun.lock`.

## Risks

- **Old reasons in other shapes.** An older probe may have written other float reasons, such as
  `timeout after 1500.5ms`. R1 only rounds the latency reason that the issue names. Other shapes
  stay as stored, which is honest and leaves no worse state.
- **Long editor.** With both disclosures open, the HTTP form shows 5 header rows and 10
  assertion rows on create. That is a longer page, but it is the parity the issue asks for. The
  `More rows` disclosure still holds the remaining header rows.
- **Fixture coupling.** Changing shared fixtures in `test/check-fixtures.ts` can break unrelated
  tests. Add new fixtures or per-test overrides instead of changing existing exports.
- **Placeholder in a copied line.** An operator who pastes the line without replacing
  `<pulse-api-url>` gets a curl error, not a wrong request. The note says to replace it.

## Acceptance evidence

1. Console `src/check-format.test.ts`: every R1 (non-HTML), R3 and R6 row of the Counterexamples,
   with the literal expected values written there.
2. Console `src/server.checks.test.ts` over real HTTP: the rounded Last reason, Locations and
   Recent results reasons; the escaped HTML reason; `None`; the R2 labels for all six types and
   on the shadowed page; the R3 rows, times, note and cursor; the placeholder heartbeat line and
   note without the fake API origin; the `-87400` and `-0.04` budget texts.
3. Console editor tests: both disclosures open on create and edit, with unchanged row counts.
4. Console `bun run check:browser`: the rounded reason and labels are visible, the heartbeat line
   is the placeholder literal, and the create and edit flows fill header and assertion inputs
   without opening a summary. The POST body equals the literal payload of task 4.
5. `bun run check` and `bun run check:browser` pass in the console PR.
