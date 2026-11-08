# Spec #861: api: correct the result pagination explanation

## Goal

`docs/rest-api.md` in pulse-api says that a retried `POST /results` submission can store several
rows for one location and timestamp, and gives "5 rows for `limit=1`" as the consequence. That is
stale: since idempotent ingest, a sample is unique on (check, location, timestamp), so five
identical submissions store one sample. Correct the explanation: remove the duplicate-row claim
and explain that a page includes the complete timestamp group at its boundary and can therefore
exceed `limit` across locations. Add a matching short note with a link next to the existing
idempotence sentence in the api `README.md`.

Inputs read: the issue and its only comment (the Factory issue-review note), the issue review
`.factory/work/861/issue-review.md` (no blocking questions, two-file scope), and the api, website
and contract clones. Shared findings: `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/861`
answered `HTTP 404` on 2026-11-08, so there are no findings yet.

## Scope

- One repository: `api`. Two files: `README.md` and `docs/rest-api.md`.
- Documentation only. No source, test, config, lockfile, CI or bench change.

## Non-goals

- No change to ingest, the unique sample index, `ON CONFLICT ... DO NOTHING`, the heartbeat
  generated-sample timestamp shift, the history defaults (100), cap (1000), the exclusive `before`
  cursor, errors or the response shape.
- No new or extended checked-in test (`src/docs-claims.test.ts` stays unchanged, as the issue
  review decided).
- No snapshot or concurrent-ingest guarantee. "Nothing is skipped or repeated" keeps its current
  meaning: traversal of an unchanged sample set with the exclusive cursor.
- No promise about the order inside one timestamp group (it is row id descending today, not
  location order).
- The website renders the api docs from a pinned api commit (`.repos/website/docs.config.json`,
  `repos.api.sha` = `11f5555…`, refreshed by `scripts/bump-docs.ts`) and keeps a fixture copy in
  `test/fixtures/api-rest-api.md` that its facts test reads only for endpoint names
  (`src/content/facts.test.ts:71-75`). The corrected text reaches the website at its next docs pin
  bump; that bump is not part of this feature and the website needs no child.
- The historical commit 494e0b8 is not in the shallow clone; current source is the evidence.

## Verified current behavior (api `main` at `e084bde0a5bc199748ec5614ed604ae79b8454cf`)

- `src/migrations.ts:53-58`: step 2 deletes duplicate samples (keeps `MIN(id)`) and creates
  `UNIQUE INDEX results_by_sample ON results (check_id, location, timestamp)`.
- `src/service.ts:565-568`: `insertResult` ends with `ON CONFLICT (check_id, location, timestamp) DO NOTHING`.
  `src/service.ts:451-475`: `storeSample` returns `undefined` for a stored sample; only generated
  (heartbeat) samples retry at `timestamp + 1`.
- `src/server.ts:764-785`: the token sets the stored location; a different explicit `location`
  answers `403`; first and repeated valid posts answer `204`; the metric counts only a new sample.
- `src/service.ts:663-668,1437-1445`: `listResults` takes `limit` rows with `timestamp < before`,
  ordered `timestamp DESC, id DESC`; when the page is full it appends the remaining rows of the last
  timestamp (`tiedRows`). That completes the boundary timestamp group across locations.
- `src/server.ts:67-68,849-857`: default 100, cap 1000, `before` is a non-negative integer.
- Runtime reproduction through `bun start` on the base: three planner runs on
  `e084bde0a5bc199748ec5614ed604ae79b8454cf` (fresh clone in `/tmp`, `bun install --frozen-lockfile`,
  Bun 1.4.0). Each run used a fresh temp dir outside the checkout for `PULSE_DB`, `PULSE_CHECKS_FILE`
  (non-heartbeat checks `dup` and `tie`, `intervalMs` 60000) and `PULSE_TOKENS_FILE` (five
  location-bound random tokens `a`..`e`), its own free `PORT` (18761, 18762, 18763), and waited for
  `/readyz` `200`. The script lived outside the checkout and was not kept. The temp dir was removed
  after each run, and `git status --porcelain` in the clone stayed empty. All three runs gave the same
  results:
  - five identical posts of check `dup` from token `a` at one captured timestamp `T` (now − 5000):
    statuses `204 204 204 204 204`; `GET /checks/dup/results` and `?limit=1` each return exactly one
    row (`a@T`);
  - check `tie`: one older sample at `T − 1000` from `a`, then one sample per location `a`..`e` at
    `T` (statuses `204` ×6): `?limit=1` returns 5 rows (order `e,d,c,b,a`, all at `T`);
    `?limit=1&before=T` returns 1 row (`a@T−1000`); `?limit=1&before=T−1000` returns 0 rows;
  - `SIGTERM` → API exit `0`; script exit `0`.

  | Run | Port | dup statuses | dup default / `limit=1` rows | tie `limit=1` rows | `before=T` rows | `before=T−1000` rows | API exit |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | 1 | 18761 | `204` ×5 | 1 / 1 | 5 | 1 | 0 | 0 |
  | 2 | 18762 | `204` ×5 | 1 / 1 | 5 | 1 | 0 | 0 |
  | 3 | 18763 | `204` ×5 | 1 / 1 | 5 | 1 | 0 | 0 |

## Required behavior (documentation)

1. `docs/rest-api.md`, section `## GET /checks/:id/results`, the paging paragraph (line 167 on
   the base). Keep: newest first, `before` = `timestamp` of the last item, exclusive cursor, the
   whole boundary group, "Nothing is skipped or repeated." Remove the sentence "A retried
   submission can store several rows for one location and timestamp, so a page can hold more rows
   than the number of locations (5 rows for `limit=1`)." Say that a sample is unique on
   (check, location, timestamp), so a timestamp group holds at most one result per location; that
   a page ending inside a group returns the whole group, so it can exceed `limit` across
   locations; give the five-locations example (`limit=1` returns all five) and the
   five-identical-submissions example (one stored sample, one row). The paragraph must contain
   these two exact sentences (the acceptance greps them):
   - `A page that ends inside such a group returns the whole group, so it can exceed `limit` across locations.`
     (the phrase checked is ``so it can exceed `limit` across locations``)
   - `Five identical submissions from one location store one sample, so they return one row.`
     (the phrase checked is `Five identical submissions from one location store one sample`)

   Suggested full paragraph (wording outside the two checked phrases may change):

   > To page, request the next page with `before` set to the `timestamp` of the last item. A
   > sample is unique on (check, location, timestamp), so the results with one timestamp hold at
   > most one result per location. A page that ends inside such a group returns the whole group, so
   > it can exceed `limit` across locations: when five locations posted at the same timestamp,
   > `limit=1` returns all five. Five identical submissions from one location store one sample, so
   > they return one row. Nothing is skipped or repeated.

   Do not claim that a page holds at most one row per location overall: a page can hold several
   timestamps.
2. `README.md`, section `## Health and metrics` (line 78 on the base). Keep the sentence
   "`POST /results` is idempotent on (check, location, timestamp), so a probe may re-send." and the
   trailing "See [REST API](docs/rest-api.md#get-locations)." Add one short clarification that a
   re-send stores no second row and that a results page keeps the whole group of one timestamp, so
   it can exceed `limit` across locations, with the link
   `[GET /checks/:id/results](docs/rest-api.md#get-checksidresults)`. The anchor is GitHub's slug of
   the existing heading `## GET /checks/:id/results`.

Everything else in both files is unchanged.

## Risks

- A rewrite that drops a still-true claim (exclusive cursor, defaults, first-post-wins, heartbeat
  exception). Mitigated by the literal "still present" greps below and a full diff read.
- A replacement that over-claims (pages bounded by location count; ordering by location; snapshot
  guarantee). Mitigated by the counterexamples and the review read.
- An edit that breaks an existing doc-reading test: `src/docs-claims.test.ts` reads
  `docs/rest-api.md` and `README.md` (lines 60-70, 92-127; it asserts `There is no import\.` in the
  README) and `src/server.location-uptime.test.ts:118-125` parses the JSON example of the
  location-uptime section. None of them touches the paging paragraph or line 78, and the full
  `bun run check` must stay green.
- Markdown formatting: Biome with `files.ignoreUnknown: true` (pinned
  `@lorenzh/pulse-config/biome.json:8-18`) and the lint script (`package.json:16`) run in
  `bun run check`; the implementer keeps the paragraph on one line like its neighbours.

## Performance impact

None expected: only two Markdown files change; no code path, dependency, image content that runs,
or test changes, so none of the `bench/budgets.json` metrics (startup CPU, load CPU, idle or peak
RSS, test CPU, build CPU, wall-clock startup, p95 latency, requests per second, image size) can
move beyond noise. The image copies only `package.json`, `node_modules` and `src`
(`Dockerfile:4,12-14`), so the docs do not reach it and image size is unchanged.
The implementer reports test CPU (user + sys) of `bun run check` from interleaved runs (base,
branch, base, branch, base, branch) as information only, with raw samples. The Docker bench is not
run (host port collision, #834).

## Security impact

Security impact: no
Documentation-only change to two Markdown files; no route, auth, parser, probe client, file write,
error or log text, dependency, Dockerfile or CI changes.

## Rollout order

One repository: only api docs change, and no other service, probe or older consumer reads them at
run time. The website shows the new text at its own next docs pin bump; until then it shows the
older explanation, which is a pre-existing state and not a compatibility issue.

## Counterexamples

The rules the docs describe, and inputs a wrong explanation (or a wrong check) would get wrong:

- Uniqueness: five identical valid `POST /results` from token `a` with one fixed timestamp must
  give statuses `204` ×5 and exactly 1 row for both `GET /checks/<id>/results` and `?limit=1`. The
  old text predicts 5 rows for `limit=1`; that is wrong.
- Re-running the `docs/rest-api.md` POST curl example five times is not a duplicate test: it takes
  `$(date +%s)000` each time, so it can create several samples one second apart. The fixed
  timestamp must be captured once.
- Location under one token: posting five bodies with `location` `a`..`e` under token `a` answers
  `403 location does not match token` for `b`..`e`; it cannot demonstrate a tie group. Five
  location-bound tokens are needed.
- Tie group: one sample per location `a`..`e` at timestamp `T` plus one older sample at `T − 1000`:
  `?limit=1` must return 5 rows (all at `T`); `?limit=1&before=T` must return only the older one.
  A text saying "a page has at most `limit` rows" is wrong here.
- Page not bounded by location count: with `limit=3`, three distinct timestamps from one
  location are three rows from a single location; with five locations tied at the third
  timestamp, the page has 2 + 5 = 7 rows. A text saying "at most one row per location per page"
  is wrong.
- Order inside a group: the tie above came back `e,d,c,b,a` (row id descending), not alphabetical.
  The docs must not promise location order.
- `before` is exclusive: `?before=T` must not return any sample at `T`.
- Heartbeat generated samples: two in one millisecond are both kept, the second at `+1 ms`; that
  sentence (`docs/rest-api.md:90`) stays and is not a counterexample to uniqueness.

No statistic is defined or changed by this feature.

## Contract fields

No new names. The change adds no field, key, route or setting; the only new link target is the
existing heading `## GET /checks/:id/results` (`grep -cx '## GET /checks/:id/results' docs/rest-api.md`
= `1` on the base).

## Repository: api

Files:
- `README.md`
- `docs/rest-api.md`

Behavior change: no
The change corrects documentation of ingest and paging behavior that already exists; no code, test,
config or tooling file changes.

### Tool facts (verified)

- Bun 1.4.0: `package.json:8-10` (`engines.bun`), `package.json:35` (`packageManager`); `bun --version`
  printed `1.4.0` on the runner.
- `bun run check` = `bun run lint && bun run typecheck && bun run test` (`package.json:20`); `lint` =
  `biome check . && pulse-eslint . && pulse-workflows` (`package.json:16`); `test` = `bun test`
  (`package.json:15`); Biome `2.6.3` (`package.json:23`).
- `bunfig.toml:1-4`: `[test]` `coverage = true`, `coverageThreshold = { lines = 0.8, functions = 0 }`.
- `biome.json:2` extends `@lorenzh/pulse-config/biome.json`, pinned to
  `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`package.json:24`); pinned file lines 8-18:
  `ignoreUnknown: true`, includes `**` minus dist, node_modules, bun.lock, `*.html`, test fixtures.
  Read with `gh api .../contents/biome.json?ref=04108fa…`; identical to the config clone.
- CI: `.github/workflows/ci.yml:17-18` uses `lorenzh/pulse-config/.github/workflows/check.yml@04108fa…`,
  whose steps (pinned file lines 22-38, identical to the clone) are Bun 1.4.0 setup,
  `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck`, `bun run test`.
- A focused `bun test <files>` without flags inherits the coverage threshold and exits 1 on the base
  (planner run: 27 pass, 0 fail, exit 1). `bun test --config=/dev/null <files>` disables coverage
  (no coverage table) and exits 0.

### Baseline controls (planner-run on `e084bde0a5bc199748ec5614ed604ae79b8454cf`, Bun 1.4.0, copy in `/tmp`, after `bun install --frozen-lockfile`)

| Control | Runs | Result each run |
| --- | --- | --- |
| `bun test --config=/dev/null src/service.idempotent.test.ts src/server.reads.test.ts src/docs-claims.test.ts` | 3 | exit 0, `27 pass`, `0 fail` (7 + 8 + 12 tests) |
| `bun run check` | 3 | exit 0, `904 pass`, `0 fail`, line-coverage threshold met (no exact figure promised) |
| Runtime reproduction through `bun start` (planner's own script, not kept; the build writes its own outside the checkout) | 3 | exit 0 for the script and the API on `SIGTERM`; dup: `204` ×5, 1 row for default and `limit=1`; tie: 5 rows for `limit=1`, 1 row for `before=T`, 0 rows for `before=T−1000` (table in "Verified current behavior") |

These pass on the recorded base. The implementer records its own `BASE` (full SHA of api `main`
when build starts); if it differs from `e084bde…`, re-run the three controls three times there and
refresh the source line citations.

### Tasks and checks

Record `BASE=$(git rev-parse HEAD)` before the first edit. Edit only the two files.

Documentation acceptance (each expected value is a literal written here; base values in brackets
were observed by the planner):

1. `grep -cF 'A retried submission can store several rows' docs/rest-api.md` → `0` [base `1`].
2. ``grep -cF '5 rows for `limit=1`' docs/rest-api.md`` → `0` [base `1`].
3. ``grep -cF 'so it can exceed `limit` across locations' docs/rest-api.md`` → `1` [base `0`].
4. `grep -cF 'Five identical submissions from one location store one sample' docs/rest-api.md` → `1` [base `0`].
5. Still present, each → `1` [base `1`]: `Nothing is skipped or repeated.`,
   `Epoch ms, exclusive cursor: only older results.`, `Default 100, capped at 1000.`,
   `The first post wins` in `docs/rest-api.md`; `grep -cx '## GET /checks/:id/results' docs/rest-api.md` → `1`.
6. `grep -cF '(docs/rest-api.md#get-checksidresults)' README.md` → `1` [base `0`].
7. Still present in `README.md`, each → `1` [base `1`]:
   ``'`POST /results` is idempotent on (check, location, timestamp)'``,
   `'See [REST API](docs/rest-api.md#get-locations).'`, `'There is no import.'`.
8. Read the whole diff `git diff "$BASE" HEAD -- README.md docs/rest-api.md`: only the paging
   paragraph of `## GET /checks/:id/results` and line 78 of `README.md` change; the new text says
   nothing about location order inside a group, no snapshot guarantee, and no per-location bound on
   page length. A temporary assertion of checks 1-4 and 6 (kept outside the checkout) fails three
   times on `BASE` for the stated reason (stale sentence present / new phrase absent) and passes
   on the branch.

Documentation inventory (search `README.md`, `docs/*.md`, `bench/README.md` on `BASE` and on the
branch for: retried, several rows, idempotent, re-send, same timestamp, unique on, repeat, whole
group, exceed `limit`, no unique key, repeated post). Expected classification:

| Location | Classification |
| --- | --- |
| `docs/rest-api.md:167` | changed (paging paragraph) |
| `README.md:78` | changed (clarification + link added) |
| `docs/rest-api.md:84,88,90,160-165,169-172,636` | unchanged and still true ("stores no row", "The first post wins", defaults/cap/exclusive cursor, "A repeated post is not counted.") |
| `docs/operation.md:23,31,332` | unchanged and still true (idempotent re-send; version 2 makes results unique on (`check_id`, `location`, `timestamp`)) |
| `docs/concepts.md:50` | unchanged and still true ("A second result with the same timestamp in the same location is a repeat and is ignored") |
| `docs/configuration.md:98-99` | unchanged and still true (probe attempts vs result idempotence) |
| `bench/README.md:139` | unchanged and still true (concerns a side-A API from before the unique key) |

Runtime acceptance (should already hold on `BASE` and must hold on the branch): with `bun start`,
fresh temp `PULSE_DB`, `PULSE_CHECKS_FILE`, `PULSE_TOKENS_FILE` outside the checkout, five
location-bound probe tokens (≥ 16 characters, not the placeholders), a free `PORT`, wait for
`/readyz` `200`:
- five identical posts of one non-heartbeat check from one token at one captured timestamp →
  statuses `204 204 204 204 204`; `GET /checks/<id>/results` and `?limit=1` → `200`, exactly `1`
  row with that timestamp and location;
- separate check: one sample per location at `T` and one older at `T − 1000` → `?limit=1` returns
  `5` rows all at `T`; `?limit=1&before=T` returns `1` row at `T − 1000`; traversal with `before`
  ends in an empty page without omissions or repeats;
- `SIGTERM` → exit `0`. Report sanitized commands (no tokens) and outputs; leave no fixture in the
  checkout.

Tests and performance:
- `bun test --config=/dev/null src/service.idempotent.test.ts src/server.reads.test.ts src/docs-claims.test.ts`
  → exit 0, `27 pass`, `0 fail` on the branch.
- `bun run check` → exit 0, `904 pass`, `0 fail`, coverage threshold enforced (`bunfig.toml:3`),
  unchanged config. No checked-in test is added, so the pass count stays `904`.
- Test CPU: interleaved `bun run check` (or `bun test`) runs base, branch ×3 each, user + sys from
  `/usr/bin/time` or `time`, raw samples and delta reported as information. No Docker bench (#834).
- PR body: lists every added comment after reading all added lines (expected: none, the change is
  Markdown prose), names `Closes lorenzh/pulse-meta#<child>`, the checks run and known limits.

Scope gates after the last commit (all against the recorded `BASE`, never `HEAD~1`):
1. `git diff --name-only "$BASE" HEAD` prints exactly `README.md` and `docs/rest-api.md` (sorted,
   two lines, nothing else).
2. `git diff --name-only --cached` prints nothing.
3. `git diff --name-only` prints nothing.
4. `git status --porcelain` prints nothing (no untracked files).
5. `git diff --exit-code "$BASE" HEAD -- docs/concepts.md docs/configuration.md docs/development.md docs/index.md docs/install.md docs/operation.md docs/troubleshooting.md bench AGENTS.md CLAUDE.md src test package.json bun.lock bunfig.toml biome.json tsconfig.json eslint.config.js lefthook.yml .github Dockerfile scripts`
   exits `0`.

Prove the gates in a disposable clone outside the implementation checkout, with expected and
actual exit codes saved for each state: clean commits to the two allowed files pass; a committed
protected change fails gates 1 and 5; a staged protected change fails gate 2 (and 4); an unstaged
protected change fails gate 3 (and 4); an untracked file fails gate 4; a protected change staged
and then its worktree bytes restored to `BASE` still fails gate 2; a protected change committed and
then its worktree bytes restored to `BASE` still fails gates 1 and 5.

Completion evidence: the grep results 1-7 with counts, the inventory table re-run on the branch,
the three focused and three full runs with pass counts, the runtime transcript, the CPU samples,
the scope-gate outputs and the fixture evidence, and the README/rest-api diff.
