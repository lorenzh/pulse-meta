# Issue review: #861 — correct the result pagination explanation

## Decision and reviewed context

Ready for `plan`. No product decision blocks the spec. Only `api` is affected; no contract change, dependency upgrade, migration or other target is needed.

Behavior change: no
Correct the explanation of existing ingest and pagination behavior. Runtime behavior, response shapes, uniqueness, limits and cursors stay unchanged.

Read meta `AGENTS.md`, `README.md` and the issue-review prompt, and API `AGENTS.md`, `README.md`, the relevant docs, implementation and existing tests. The inspected API base is `e084bde0a5bc199748ec5614ed604ae79b8454cf`. Record the actual implementation base separately when build starts; refresh this evidence if it differs.

Read the live issue and all comments on 2026-11-08. The only comment is the Factory claim at https://github.com/lorenzh/pulse-meta/issues/861#issuecomment-6725400798; it contains no earlier decision or scope adjustment. Do not change provider labels or comments.

## Verified source behavior

- `api/src/migrations.ts:53–58`: schema step 2 removes duplicate samples, keeping the first row, and creates `results_by_sample`, unique on `(check_id, location, timestamp)`.
- `api/src/service.ts:451–475,565–568,1195–1213`: insertion uses `ON CONFLICT (check_id, location, timestamp) DO NOTHING`; a repeated sample returns without changing live state. The generated-sample timestamp adjustment is separate and must remain unchanged.
- `api/src/server.ts:764–785`: the token determines the stored location; an explicit different location is rejected. Both first and repeated valid submissions answer `204`, with a result metric only for a newly stored sample.
- `api/src/service.ts:663–667,1435–1445`: the initial query uses `timestamp < before`, orders by timestamp descending then row id descending, and takes `limit` rows. It then appends remaining rows at the last timestamp. This completes the boundary timestamp group across locations.
- `api/src/server.ts:67–68,849–857`: result history defaults to 100 rows, caps the requested limit at 1000, and uses an exclusive epoch-ms `before` cursor. No change to these rules is needed.
- Existing `api/src/service.idempotent.test.ts` covers duplicate storage and counting, distinct locations/timestamps, repeated HTTP submissions answering `204`, and generated heartbeat samples. Existing `api/src/server.reads.test.ts:130–164` covers equal-timestamp groups across three locations, oversized pages and traversal with `before`. These were read, not run in this review.

Five identical valid posts with the same check, token location and fixed timestamp therefore describe one stored sample. Five different locations at a single timestamp describe five samples; with `limit=1` the complete group can produce five rows. A page may contain several timestamps, so do not replace the stale claim with a general assertion that page length is bounded by the number of locations.

## Scope and non-blocking decisions

Files: `README.md`, `docs/rest-api.md` in `api`, and no other implementation files.

1. Replace the pagination paragraph at `docs/rest-api.md:167`. Retain newest-first traversal, the exclusive last-timestamp cursor and complete boundary timestamp groups. Remove the retry-causes-duplicates claim and its misleading five-row example. Give separate explicit examples: five identical valid submissions leave one sample; five locations at one timestamp can return five rows with `limit=1`.
2. Add a short matching clarification and a link to `docs/rest-api.md#get-checksidresults` beside the existing idempotence statement at `README.md:78`. Its current statement is true; this small update keeps the README and endpoint explanation together under the issue's standing documentation rule. Preserve the location-health statement and its link.
3. No source or test-file changes are authorized. This is a documentation correction, so runtime controls characterize behavior already present on the base. Do not manufacture a failing runtime regression or extend `src/docs-claims.test.ts` for this issue. Temporary verification scripts and fixtures belong outside the implementation checkout.
4. The issue does not identify the audit's two exact history query strings. Use the default history query and `?limit=1` as explicit acceptance queries on an isolated check containing only the repeated sample. Both must return one row. This makes the observable check concrete without needing a product decision.
5. Capture the submission timestamp once. Re-running the current POST curl example at `docs/rest-api.md:94–103` can compute a new timestamp and is not a reliable duplicate demonstration. A prose example can explain the fixed payload without expanding this change into an executable tutorial.
6. The five-location example needs five location-bound probe credentials if exercised over HTTP. Changing the body location under a single token answers `403` and cannot demonstrate pagination.
7. “Nothing is skipped or repeated” refers to traversing an unchanged sample set with the documented exclusive cursor. Do not introduce a snapshot or concurrent-ingest guarantee.

Plan, breakdown and task review must retain this exact two-file list and matching acceptance. Any later discovery requiring another file must be reconciled explicitly before implementation.

## Documentation inventory on the inspected base

Searched API `README.md`, every file under `docs/`, and `bench/README.md` for pagination, retries/re-sends, duplicates, idempotence, sample uniqueness, same timestamps, history limits and cursors. Relevant claim hits are classified below; broad matches about other routes, probe attempt settings and duplicate config ids are unrelated to stored-sample pagination.

| Location | Classification and proving text / intended change |
| --- | --- |
| `docs/rest-api.md:167` | **Changed.** Replace “A retried submission can store several rows for one location and timestamp” and its five-row example with the two cases above. Keep complete timestamp groups and last-timestamp paging. |
| `README.md:78` | **Changed.** Preserve “`POST /results` is idempotent on (check, location, timestamp)” and add the brief matching clarification and result-history link. |
| `docs/rest-api.md:84,88,90` | **Unchanged and still true in context.** First accepted sample is stored; history can include older samples; line 90 explicitly says a repeat “answers `204` ... stores no row” and “The first post wins”. Preserve the heartbeat exception and other ingest details. |
| `docs/rest-api.md:160–165,169–172` | **Unchanged and still true.** “newest first”, default 100/cap 1000, and “Epoch ms, exclusive cursor: only older results”; retain errors and existing history curl. |
| `docs/rest-api.md:636` | **Unchanged and still true.** Result-ingest counter: “A repeated post is not counted.” The route records it only when `isNew`. |
| `docs/operation.md:23` | **Unchanged and still true.** “`POST /results` is idempotent, so a re-send of a result that is already stored is safe”; power-loss durability is a separate concern. |
| `docs/operation.md:31` | **Unchanged and still true.** “Version 2 makes `results` unique on (`check_id`, `location`, `timestamp`)”, keeping the first row during migration. |
| `docs/operation.md:332` | **Unchanged and still true.** A re-sent result already stored is safe; replay retains original timestamps. |
| `docs/concepts.md:50` | **Unchanged and still true.** “A second result with the same timestamp in the same location is a repeat and is ignored”. Distinct-location ties remain valid. |
| `docs/configuration.md:98–99` | **Unchanged and still true.** Probe attempts and redirects are separate from result submissions; “The idempotence of `POST /results` ... cover results ... not the checked request.” |
| `bench/README.md:139` | **Unchanged and still true.** The duplicate warning explicitly concerns benchmark side A running an API “from before the unique key”; it is historical compatibility, not current ingest behavior. |

`docs/index.md`, `docs/install.md`, `docs/development.md` and `docs/troubleshooting.md` contain no additional claim about duplicate sample storage or timestamp-group pagination requiring correction. For example, troubleshooting line 85 describes rejected posts and retry/drop behavior, not successful duplicate ingestion. Notify resend request ids, admin audit pagination, incident limits, duplicate configuration ids and per-check location state listings are separate features and remain unchanged.

Protect these unchanged documents as whole paths: `docs/concepts.md`, `docs/configuration.md`, `docs/development.md`, `docs/index.md`, `docs/install.md`, `docs/operation.md`, `docs/troubleshooting.md`, `bench/README.md`. Within the two allowed files, review the diff to restrict edits to the specified paragraphs and preserve all other inventoried claims. Repeat the inventory against the implementation base and completed branch.

## Derived acceptance

### Documentation and observable examples

- Read the entire two-file diff. Both documents agree that a sample is unique on check, location and timestamp, and retries do not add stored rows. The stale retry explanation is absent.
- The REST explanation explicitly states that a page includes the complete timestamp group at its boundary across locations and can exceed `limit`. It retains the last-item timestamp as the exclusive `before` cursor and does not alter parameter defaults, caps, errors or response shape.
- The example distinguishes five identical submissions from five distinct locations at one timestamp. Preserve the existing first-write-wins and generated heartbeat explanations. Verify the README's new result-history link resolves to the existing heading.
- Against a fresh isolated non-heartbeat check through the real local routes, freeze one current valid timestamp and payload, then submit it five times with the same location-bound token: statuses `[204, 204, 204, 204, 204]`. `GET /checks/:id/results` and `GET /checks/:id/results?limit=1` both answer `200` and contain exactly one sample with that timestamp and location. This should already work on the recorded base.
- In a separate fresh fixture, submit one sample at the same timestamp from each of five locations using matching tokens, plus an older sample. `?limit=1` returns all five tied samples; `?limit=1&before=<last timestamp>` returns the older sample and none of the tie. Traverse to exhaustion without omissions or repeats. Treat order within the timestamp group as the existing row-id order; do not promise alphabetical location order.
- Run a final local handoff through `bun start` with fresh temporary database/checks/token files, a non-placeholder valid credential, and an available local port. Wait for readiness, exercise the documented cases, stop cleanly and report sanitized commands/results. Leave no fixture files in the target repository.

### Baseline controls, tests and performance

- The planner must execute every control it labels “passes on the recorded base” three times on that base, exit 0 each time, recording exact commands and expected/observed pass counts. Do not copy historical results or invent counts. The source inspection above is not a baseline test result.
- Existing idempotence and pagination suites are natural focused controls. Use Bun 1.4.0 and an empty config via `--config` (for example `--config=/dev/null`), first verifying that this disables focused coverage on the recorded base. Default focused runs inherit `bunfig.toml`'s coverage threshold and are unsuitable as passing controls.
- Run the API-required `bun run check` for final handoff without weakening lint, type checks, hooks or the repository's 80% line-coverage threshold. Do not promise an exact coverage percentage or require a known-flaky file as a mandatory passing baseline control. Diagnose failures and report them accurately.
- No checked-in tests are added. A temporary documentation assertion can be red on the base because the stale sentence is present, then green on the corrected branch; any claimed regression must fail three times on the base for its stated documentation reason. Runtime characterization should pass before and after.
- Read every added line before handoff and list every added comment, including inline comments, in the PR body; write “none” only after that read. The two-file scope permits no test-file comments.
- Report test CPU (user + system) from matching interleaved base/branch/base/branch runs, with raw samples, commands, revisions, pass counts and delta. Treat the delta as information on a shared noisy machine. Do not run the Docker benchmark (#834).

### Scope gates for every implementation task

Record `BASE` as the full implementation-base commit. After the last commit, require all of:

1. `git diff --name-only "$BASE" HEAD` equals exactly `README.md` and `docs/rest-api.md`, with no other paths.
2. `git diff --name-only --cached` is empty.
3. `git diff --name-only` is empty.
4. `git status --porcelain` is empty, including no untracked files.
5. `git diff --exit-code "$BASE" HEAD -- <protected files>` exits 0. Enumerate the eight unchanged document paths above and protect `AGENTS.md`, `src/`, `test/`, `package.json`, `bun.lock`, `bunfig.toml`, `biome.json`, `tsconfig.json`, `eslint.config.js`, `lefthook.yml`, `.github/`, and all of `bench/`. The exact two-file allow-list rejects any other changed path even when it is not named here.

Prove the gate in a disposable fixture outside the implementation checkout: clean committed edits to the two allowed files pass; a protected committed, staged or unstaged edit fails independently; an untracked file fails. Include both restored-worktree cases: stage a protected edit then restore only worktree bytes to BASE, and commit a protected edit then restore only worktree bytes to BASE. Each must still fail. Save expected and actual exit/status evidence for all states. Never use the preceding commit instead of recorded BASE or accept a worktree-only comparison as proof.

## Review execution limits

This state only writes this meta artifact. The target clones were not edited. Bun 1.4.0 is present; API dependencies are not installed. No Bun tests, runtime reproduction, CPU measurement or scope fixtures were executed here; these remain planner/build verification work, not claimed successes.

Initial searches used absent guessed paths (`.factory/work/861`, `api/tests` and result/pagination filename globs); searches were rerun against the actual `api/src`, `api/test` and docs paths. The historical `494e0b8` object cannot be resolved in the shallow API clone; current source directly establishes the relevant behavior, so no historical attribution is claimed as independently verified. The cloud runtime skill was read; no environment-status tool is available, which does not block local source review.
