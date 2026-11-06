# Spec: #772 contract: remove stale maintenance entries from docs/index.md

## Goal

`docs/index.md` of `contract` contradicts itself about maintenance windows. Contract PR #50
(feature #765, merged as `c4a2eb5` on contract `main`) added the section "Database maintenance
windows", which documents ID-based writes with the body `AdminMaintenanceWindowInput` and says the
api no longer accepts `AdminMaintenanceInput` as a body. Two older entries in the same file still
describe the old behavior:

- `docs/index.md:65`, type table: `AdminMaintenanceInput`, `AdminMaintenanceView` — "A
  `MaintenanceWindow` in a request; in a response it also carries its `index`." This presents the
  file-window shape as a request body.
- `docs/index.md:330-331`, admin route list: `POST /admin/maintenance`,
  `PUT|DELETE /admin/maintenance/{index}` (`index` is the position in `GET /admin/config`). This
  advertises index-based window writes.

This feature corrects those entries so the document has one consistent description of window
writes. It builds on #765 (contract PR #50, already on `main`); nothing of #765 is redone.

## Scope

- `contract`: `docs/index.md` only.

## Non-goals

- No change to `src/` (schemas, validators, exports, comments), `test/`, `dist/`, `package.json`,
  `bun.lock`, the package version or `WIRE_VERSION`. The stale source comment above
  `adminMaintenanceViewSchema` in `src/admin.ts:200` ("the address of `/admin/maintenance/:index`")
  is out of scope; this issue is docs only.
- No change in `api`, `console`, `status` or any other target: the api already serves ID-based
  writes (`api/src/server.maintenance-admin.test.ts:293-295` creates `/admin/maintenance/w`;
  `api/src/config-admin.test.ts:494-501` shows the old body answers 422 on POST, 400 on
  `PUT /admin/maintenance/0`, and `DELETE /admin/maintenance/0` answers 409 "file maintenance windows
  are read-only; edit the checks file").
- Do not remove valid descriptions of the file-window shape, of `MaintenanceWindow`, of
  `AdminConfigResponse.maintenance` (`AdminMaintenanceView[]`), of the `AdminWriteResponse` union, or
  of `index` as response metadata of a file window. Those exports still exist (`src/admin.ts:191-213`,
  `src/index.ts`).
- No second, divergent description of the window body: the "Database maintenance windows" section
  (`docs/index.md:390-413`) stays the detailed reference.

## Required behavior

In `contract/docs/index.md`:

1. Type table row at line 65 (`AdminMaintenanceInput`, `AdminMaintenanceView`): describe
   `AdminMaintenanceInput` as the file maintenance window shape of the checks file (not a request
   body) and `AdminMaintenanceView` as that shape plus its file `index`, served in
   `GET /admin/config`. Point write callers to `AdminMaintenanceWindowInput` (for example "window
   writes take `AdminMaintenanceWindowInput`; see 'Database maintenance windows'"). The word
   "request" must not describe `AdminMaintenanceInput`.
2. Admin route list at lines 330-331: replace `PUT|DELETE /admin/maintenance/{index}` and its
   parenthesis with `PUT|DELETE /admin/maintenance/{id}`, where `id` is a database window id
   (`AdminMaintenanceWindowInput.id`). The list may also name `GET /admin/maintenance`, which the
   database section documents (`docs/index.md:410-411`). The parenthesis about `index` being the
   position in `GET /admin/config` is removed.
3. Status table row at line 380 (`404 | Unknown id or index`): change it to `Unknown id`, so it cannot
   be read as an index-addressed window write. The 409 row ("a file window") stays: the api answers
   409 for a file window (`api/src/maintenance-write.ts:150`).
4. Every other maintenance passage keeps its meaning: line 324 (schema list), lines 385-388
   (validator list), lines 390-413 (database section, including "`AdminMaintenanceInput` stays as the
   file window shape; the api no longer accepts it as a body").
5. Markdown tables keep their column alignment (each row padded to the column width of its table,
   as the file has it now). If a new cell is wider than the column, re-pad the whole table.
   Current widths (measured in the contract clone at `c4a2eb5`): the type table (header
   `docs/index.md:12-13`, rows to line 76) has every row 280 characters long, and its `Meaning`
   column holds at most 169 characters of cell text; the admin status table
   (`docs/index.md:368-381`) has every row 99 characters long, and its `Meaning` column holds at most
   86 characters of cell text.

## Risks

- Over-deletion: removing the `AdminMaintenanceView` description loses documentation of
  `AdminConfigResponse.maintenance`, which is still exported and served. Mitigation: rule 1 rewrites
  the row, it does not delete it.
- Drift from the database section: a second body description could disagree with lines 395-404.
  Mitigation: rules 1 and 2 point to the section instead of repeating limits.
- `bun run check` builds into `dist/`. A docs change leaves `dist/` unchanged; CI checks that with
  `git diff --exit-code -- dist` (pinned `pulse-config` `check.yml` line 36).

## Performance impact

none expected: the change edits one Markdown file that is neither built into `dist/` nor read at
run time, so no metric of `api/bench/budgets.json` (startup CPU, load CPU, idle or peak RSS, test
CPU, build CPU, wall-clock startup, p95 latency, requests per second, image size) can move.

## Security impact

Security impact: no
The change edits documentation prose only; no parser, validator, route, dependency, Dockerfile or
CI file changes.

## Rollout order

one repository: only `contract/docs/index.md` changes, and `docs/` is not in the published package
(`package.json` `files` is `["dist"]`), so no consumer pin needs to move and every consumer on an
old or new contract pin keeps working unchanged.

## Counterexamples

The rules here are documentation rules; these texts must be rejected by review:

- `PUT|DELETE /admin/maintenance/{index}` anywhere in the file (an index-addressed write).
- "`AdminMaintenanceInput` ... in a request" or any sentence that names `AdminMaintenanceInput`, or
  the single-check `{ checkId, start, end, note }` shape, as the body of `POST` or `PUT
  /admin/maintenance`.
- `404 | Unknown id or index` in the admin status table.
- A wrong fix that deletes the `AdminMaintenanceView` row entirely: `AdminConfigResponse` (line 66)
  would then reference an undocumented type. Reject it.
- A wrong fix that changes `AdminWriteResponse` (line 67) to drop `AdminMaintenanceView`: the union in
  `src/admin.ts` still contains it, so the doc would disagree with the code. Reject it.
- Rule 4, schema list: a wrong fix that drops `adminMaintenanceInputSchema` or
  `adminMaintenanceViewSchema` from the schema list at line 324 because they "sound old". Both are
  still exported (`src/index.ts`); `grep -c 'adminMaintenanceInputSchema' docs/index.md` and
  `grep -c 'adminMaintenanceViewSchema' docs/index.md` must each still print at least 1 (literal
  minimum). Reject it.
- Rule 4, validator list: a wrong fix that drops `validateAdminMaintenanceInput` or
  `validateAdminMaintenanceView` from the validator list at lines 385-388. Both validators are still
  exported; `grep -c -w 'validateAdminMaintenanceInput' docs/index.md` and
  `grep -c -w 'validateAdminMaintenanceView' docs/index.md` must each still print at least 1.
  Reject it.
- Rule 4, database section: a wrong fix that deletes or rewords line 413 ("`AdminMaintenanceInput`
  stays as the file window shape; the api no longer accepts it as a body.") or any other line of
  390-413. That section is the reference the new entries point to; the diff of the edit must add or
  remove no line between the heading `### Database maintenance windows` and the next heading.
  Reject it.
- Rule 5, table alignment: a rewritten line 65 whose row is padded to a different length than its
  neighbours (for example 260 or 300 characters while lines 64 and 66 stay 280), or a status row
  `| 404    | Unknown id |` that is not padded to 99 characters like the other rows of lines
  368-381. `awk 'NR>=12 && NR<=76 {print length($0)}' docs/index.md | sort -u` must print exactly
  one value, and `awk 'NR>=368 && NR<=381 {print length($0)}' docs/index.md | sort -u` too (line
  numbers as before the edit; adjust them if the edit adds or removes table rows). A new cell wider
  than 169 (type table) or 86 (status table) characters without re-padding the whole table fails
  this. Reject a fix that prints two values.

No statistics are defined by this feature.

## Contract fields

no new names. The change renames no field, key, type or route; `/admin/maintenance/{id}` is the
route the database section already documents (`grep -n 'admin/maintenance/{id}'
.repos/contract/docs/index.md` matches line 397) and the api already serves
(`.repos/api/src/server.maintenance-admin.test.ts:295`).

## Repository: contract

Files:
- `docs/index.md`

Behavior change: no
Docs-only correction; no source, test, build output or package metadata changes.

Behavior: apply "Required behavior" rules 1-5 to `docs/index.md`. Read every match of
`grep -n -i 'maintenance\|index' docs/index.md` in context before and after the edit.

Tool facts (verified in the contract clone at `c4a2eb5`):
- Bun 1.4.0: `package.json:7` (`"packageManager": "bun@1.4.0"`) and `package.json:8-9`
  (`engines.bun` `1.4.0`).
- `bun run check` = `bun run lint && bun run build && bun run typecheck && bun run test`
  (`package.json:28`); `lint` = `biome check . && pulse-eslint .` (`package.json:25`); `build` and
  `typecheck` run `typescript7` `tsc` (`package.json:22-23`); `test` = `bun test`
  (`package.json:24`); `format` = `biome check --write .` (`package.json:26`); `prepare` =
  `lefthook install || true` (`package.json:27`).
- Biome `@biomejs/biome` 2.6.3 (`package.json:31`). `biome.json:2` only `extends`
  `@lorenzh/pulse-config/biome.json`, pinned at `51e95b0eb463b27a196a33b428607bd92443e4f0`
  (`package.json:32`). At that ref, pulse-config `biome.json:8-18` sets `ignoreUnknown: true` and
  includes `**` except `dist`, `node_modules`, `bun.lock`, `*.html`, `test/fixtures`; the formatter
  `lineWidth` is 100 (`biome.json:23`). The pinned file (read with
  `gh api "repos/lorenzh/pulse-config/contents/biome.json?ref=51e95b0…"`) is byte-identical to the
  config clone's `main` (`diff` prints nothing).
- CI: `.github/workflows/ci.yml:17-19` calls
  `lorenzh/pulse-config/.github/workflows/check.yml@51e95b0eb463b27a196a33b428607bd92443e4f0` with
  `build: true`. At that ref pulse-config `check.yml` pins Bun 1.4.0 (line 24) and runs install
  (line 26, `bun install --frozen-lockfile`), lint (line 28), typecheck (line 30), build (line 33,
  `if: inputs.build`), `git diff --exit-code -- dist` (line 36) and test (line 38). The pinned file
  is byte-identical to the config clone's `main` (`diff` prints nothing).
- `bunfig.toml:1-3`: `[test]` sets `coverage = true` and `coverageThreshold = { lines = 0.8 }`
  (line 4 ignores test files and `dist/**` for coverage). No test reads `docs/index.md`
  (`grep -rln 'docs/index\|index.md' test src` finds nothing), so no test needs to change, and no
  test is added for prose.
- Whether Biome 2.6.3 formats or lints `.md` files is not verified here; do not rely on
  `bun run format` to re-pad the tables. Pad by hand and check with the `awk` length checks
  (check 7).

Checks:
1. `grep -n '/admin/maintenance/{index}' docs/index.md` prints nothing (expected: zero matches,
   literal).
2. `grep -n 'Unknown id or index' docs/index.md` prints nothing (expected: zero matches, literal).
3. `grep -n -i 'AdminMaintenanceInput' docs/index.md` lists only lines that describe it as the file
   window shape, a schema or a validator name, or say the api no longer accepts it as a body; none
   calls it a request or write body (expected source: the issue text "no sentence describes the old
   request shape").
4. `grep -n 'PUT|DELETE /admin/maintenance/{id}' docs/index.md` prints exactly one line, in the admin
   route list (expected: 1 match, literal), and `grep -c 'AdminMaintenanceView' docs/index.md`
   is at least 3 (rows for the type, `AdminConfigResponse`, `AdminWriteResponse`; literal minimum,
   from the current file's lines 65-67, before the edit).
5. `bun install --frozen-lockfile && bun run check` exits 0.
6. `git diff --exit-code -- dist` exits 0 after the build, and `git status --porcelain` lists only
   `docs/index.md` (expected: one path, literal).
7. Table alignment (rule 5): `awk 'NR>=12 && NR<=76 {print length($0)}' docs/index.md | sort -u`
   and `awk 'NR>=368 && NR<=381 {print length($0)}' docs/index.md | sort -u` each print exactly one
   line (expected: one distinct row length per table, literal count; adjust the line ranges only if
   the edit adds or removes table rows, and name the new ranges in the evidence).
8. Preservation (rule 4): `grep -c 'adminMaintenanceInputSchema' docs/index.md` and
   `grep -c 'adminMaintenanceViewSchema' docs/index.md` each print at least 1, `grep -c -w 'validateAdminMaintenanceInput' docs/index.md` and
   `grep -c -w 'validateAdminMaintenanceView' docs/index.md` each print at least 1 (all four counts
   are 1 in the clone at `c4a2eb5` before the edit), and `grep -n 'the api no longer accepts it as a body' docs/index.md`
   prints exactly one line (expected: literal counts). The diff of `docs/index.md` adds or removes
   no line inside the "Database maintenance windows" section (from its `###` heading to the next
   heading), checked by reading `git diff -- docs/index.md`.

Completion evidence: the diff of `docs/index.md`, the output of checks 1-4, 7 and 8, and the exit
status of `bun run check` and of check 6.
