# Quality audit: pulse-console (2026-11-09)

## Scope

- Issue: lorenzh/pulse-meta#947, periodic code quality audit of `main` of pulse-console. The issue comments hold only the Factory claim; there are no decisions and no review feedback. There was no earlier quality report for this scope.
- Audit date: 2026-11-09 (UTC).
- Examined commits:

| Repository | Commit | What was read |
| --- | --- | --- |
| pulse-console | `45b2d48260476510fa697f0c9cb560fbae26432f` | `main`: all of `src/`, `test/`, `e2e/`, `README.md`, `docs/`, `AGENTS.md`, `Dockerfile`, `.github/workflows/ci.yml`. Installed, linted, typechecked, tested and run in a temporary copy. |
| pulse-config | `88996cb46fe723c4f7f395477e049029cd847c81` | `main`. pulse-console pins `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (3 commits behind `main`, `gh api .../compare`: `ahead`). `diff -q` of `eslint.config.js`, `biome.json` and `tsconfig.base.json` between the installed pin and the clone of `main`: identical. |
| pulse-contract | `baf6aece0df479986511df8a7c9ef3e7e39ddc49` | pulse-console pins `96f33aaa85188c0794dedca89035f9c5500f85ee` (3 commits behind `main`). Read for the validators the console uses. |
| pulse-kit | `ece6a8990350deed4e6b780adbdc4ee75b09a07b` | pulse-console pins `536133f3e8b708179fa01feeb02395a0e1961e07` (1 commit behind `main`); `diff -rq` of the installed `src/` against the clone: no difference. `src/secret-file.ts`, `src/format-duration.ts` read for duplication. |
| pulse-api | `8959e0469a7b7a16e2329e968a7c42e176d287c6` | `src/tokens.ts`, `src/admin-routes.ts`, for duplication. |
| pulse-status | `f220fbc27a2d733e583aba63e5949062f29d9861` | `src/`, for duplication (`src/render.ts`). |
| pulse-notify | `6f4efe1fc776f43e1ead8e0f24b688cc4aa56faa` | `src/`, for duplication (`src/channels/loopback.ts`). |
| pulse-probe | `92f55df473d2032f8d7cc0ab8e393d84d108d9ba` | `src/`, `grep` for duplication only. |
| pulse-website, pulse-agent, pulse-deploy | `a3077ad6b5ae9c680c8032501c0320b7765da6e8`, `8e48f5cb2aea56cdcd8792673222a5110dc0ee1b`, `d47d8b90146601f97dad7de3dcf625a14e4bf018` | `grep` over `*/src` for duplicated helpers only. |
| pulse-meta | `6a09e6e9a0e5724b232a34312075b67068007dcc` | this repository, `docs/code-conventions.md` |

- Method: copy of the pulse-console clone into `mktemp -d` (`cp -a`; the runner has no `rsync`), then `bun install --frozen-lockfile` (Bun 1.4.0): exit 0, `125 packages installed`. The repository's own scripts ran under `timeout 600`. Extra measurements used only what the install brings: the shared ESLint setup (through `pulse-eslint`) with the complexity threshold at 0, `tsc` with extra flags, the `typescript` package that the install brings (AST only), `grep`, `diff`, `curl`, short Bun scripts outside the copy that read the copy's files or import its modules, and two scratch test files inside the copy that use the repository's own test helpers. The scratch files, the extra ESLint config and the copy were removed at the end. A local `bun src/main.ts` ran twice on `127.0.0.1` (ports 38611 and 38612) with `PULSE_API_URL=http://127.0.0.1:9` and a temporary database; both processes were stopped with `SIGTERM`.
- Results after audit-review: 13 findings, all `P3`. 5 are issue candidates. No item is blocked. Style-only items are notes.

## Checklist

### 1. Lint and typecheck: `checked`

- `timeout 600 bun run lint` (`biome check . && pulse-eslint . && pulse-workflows`): exit 0. Biome: `Checked 208 files in 157ms. No fixes applied. Found 1 warning. Found 7 infos.` ESLint: no output. `pulse-workflows: ok (1 files, 11 uses)`.
  - `lint/style/useTemplate` at `src/probe-pages.ts:77:20`, `78:20`, `80:64`, `src/probe-snippet.ts:114:21`, `118:21`, `164:34`, `183:27`. Style only: note.
  - `lint/performance/useDomNodeTextContent` (warning) at `e2e/run.ts:1667:38` (`page.locator("main").innerText()`). Browser test script only: note.
  - `deserialize DEPRECATED` at `node_modules/@lorenzh/pulse-config/biome.json:41:13`: the shared config uses the `recommended` field. Belongs to pulse-config: note.
- `timeout 600 bun run typecheck` (`tsc --noEmit && tsc --noEmit -p e2e`, TypeScript 7.0.2): exit 0, no output.
- `bun run check` is the three scripts in a row (lint, typecheck, test); each passed on its own (exit 0).
- `pulse-eslint --no-inline-config -f json src test e2e` (same shared config, inline directives ignored): exit 1. Outside tests the directives hide one problem: `sonarjs/no-clear-text-protocols` at `src/two-factor-harness.ts:109`, behind the file-wide directive at line 1 (`-- loopback test servers`; see finding 13). In test files they hide 63 `no-clear-text-protocols` and 6 `no-hardcoded-passwords`, all on fixtures. No `biome-ignore`, `@ts-ignore` or `@ts-expect-error` in `src`, `test`, `e2e` or `scripts`.

### 2. Complexity: `checked`

The shared budget is `"sonarjs/cognitive-complexity": ["error", 15]` (`node_modules/@lorenzh/pulse-config/eslint.config.js`). To read every value, the audit ran the shared config with only that rule, at threshold 0, in the copy (`eslint.cc.config.js`: the base config with `rules` replaced by `{"sonarjs/cognitive-complexity": ["error", 0]}` in the SonarJS block and `{}` elsewhere), then removed the file:

`./node_modules/.bin/pulse-eslint --no-inline-config --config eslint.cc.config.js -f json src test e2e`: exit 1, because every function above 0 is reported (1520 functions across `src`, `test` and `e2e`). Highest values:

| Value | Function | Against 15 |
| --- | --- | --- |
| 15 | test body "no seed, setup key, typed code, recovery code, key or session secret leaks", `src/server.security.test.ts:499` | at the budget (test) |
| 14 | `checkOutcome`, `src/check-outcome.ts:24` | under |
| 14 | `handleApp`, `src/server.ts:1111` | under |
| 14 | test body "secrets of each client appear only in their intended places", `src/server.setup.test.ts:813` | under (test) |
| 13 | `handleProtected`, `src/server.ts:1013` | under |
| 13 | `handleWrite`, `test/incident-api.ts:355` | under (test helper) |
| 12 | `exportedView`, `src/check-export.ts:43`; `outcomeOf`, `src/token-write.ts:87` | under |
| 11 | `settingsEntries`, `src/check-detail-pages.ts:177`; `deleteCheck`, `src/check-routes.ts:711`; `rowOf`, `src/permissions.ts:110`; `protectedRoutesOf`, `src/server.ts:1160`; `e2e/design-matrix.ts:583`; `e2e/run.ts:1512`, `3268` | under |

No function is over 15, and no `eslint-disable` of `cognitive-complexity` exists (`grep -rn "eslint-disable" src test e2e scripts`: only the `no-clear-text-protocols` directives of item 1).

### 3. Duplicated logic: `checked`

Read and `grep` over `src/` of console and the other clones: `grep -rnE "function (shellQuote|base32Decode|hotp|totp\w*|timingSafe\w*|sha256Hex|isRecord|errorCode|codeOf|utcTime|formatDuration|escapeHtml|csrf\w*|sendHtml|sendText|isLoopback\w*|readSecret\w*)\b" --include=*.ts */src`, the markup `grep` of item 7, and `diff` of similar blocks.

- The Tokens and Probes screens write their own alert markup instead of the `src/states.ts` callouts (11 places): finding 1.
- The "saved, People row not logged" outcome is built inline six times in route handlers: finding 3.
- The "Your input" kept-input markup is written four times, one a byte copy (`diff` exit 0): finding 4.
- The write outcome classification and the refusal texts exist twice (checks and tokens), with different texts for the same api status: finding 6.
- The People-row append and the team-commit failure catch are written three and four times: finding 7.
- Three local readers of `err.code` with three fallbacks; one copies a private helper of pulse-kit: finding 11.
- Across repositories: the admin token placeholder rules are copied from pulse-api (finding 14). The incident-duration difference from pulse-kit is required by the approved spec, `.factory/work/569/plan.md:312-317`; audit-review removed finding 12 because that output does not establish a defect.
- The loopback host list exists twice in console (`src/settings.ts:44` `LOOPBACK_HOSTS`, `src/request-guard.ts:5` `LOOPBACK_HOST`) and once more in pulse-notify (`src/channels/loopback.ts:2`). The two console lists agree. Note.
- Checked and not duplicated: `escapeHtml`, `isRecord`, `readSecretFile` (admin token), settings readers, logger, ops routes and `runService` come from pulse-kit; `shellQuote` exists only in console.

### 4. Dead code: `checked`

- `timeout 600 bun node_modules/typescript7/bin/tsc --noEmit --noUnusedLocals --noUnusedParameters` and the same with `-p e2e`: exit 0 both, no output. No unused local or parameter.
- Export scan (`bun scripts/exports.ts <copy>`, a script outside the copy that lists every `export` of the non-test `src/*.ts` and the files of `src`, `test` and `e2e` that name it by word): exit 0, `exports: 844`, `no other file names it: 234`, `only tests name it: 54`. The 234 are mostly text constants and types of the module's own interface whose `export` keyword is not needed (note). Exports that no production code uses: finding 8. Exports used in their own module but exported only for a test (AGENTS.md:83 "Do not export a function only for a test"), checked one by one with `grep -cw <name> <file>`: `revisionOfEtag` (`src/check-outcome.ts:15`), `locationSlug` (`src/probe-snippet.ts:98`), `isTypedNameConfirmed` (`src/confirm.ts:48`), `sessionExpiresAt` (`src/account-store.ts:58`), `summarizeChecks`, `overallState` (`src/overview.ts:12`, `26`), `PERMISSION_MATRIX`, `minimumRole`, `NoMinimumRoleError` (`src/permissions.ts:40`, `73`, `84`), `hotp`, `totpStep` (`src/totp.ts:26`, `36`), `isUntitledIncident` (`src/incident-form.ts:18`), `readLocations` (`src/token-read.ts:104`), `normalizeCode` (`src/setup-code.ts:33`), `parseUtcTime`, `keptTime`, `selectedCheckIds` (`src/maintenance-form.ts:37`, `62`, `68`), `TestRouteError` (`src/server.ts:179`), `FontLoadError` (`src/fonts.ts:25`), `InvalidRoleError` (`src/roles.ts:18`). Note.
- Reachability (`bun scripts/reach.ts <copy> src/main.ts src/owner-reset.ts e2e/run.ts`, a script that follows relative imports): exit 0, `files: 100; reached: 96; unreached: 4`: `src/two-factor-harness.ts`, `test/rendered-audit.ts`, `test/team-console.ts`, `test/token-fixtures.ts`. The three `test/` files are test helpers that test files import. `src/two-factor-harness.ts` is a test harness in `src/`: finding 13. No production file is dead.
- `src/admin-token.ts:28-29` checks `token.length < MIN_TOKEN_LENGTH` and then calls `tokenProblem` (`src/admin-token.ts:30`), which checks the same length first (`src/admin-token.ts:17`); the second check cannot fire. Note.

### 5. Test quality: `checked`

- `timeout 600 bun run test`: exit 0, `1993 pass`, `0 fail`, `13005 expect() calls`, `Ran 1993 tests across 90 files. [76.78s]`. Coverage (gate `lines = 0.8`, `bunfig.toml`): `All files | 97.99 | 97.17` (% funcs, % lines). The lowest files by lines: `src/notification-routes.ts` 80.10, `src/team-routes.ts` 88.30, `src/incident-write.ts` 88.54, `src/icons.ts` 88.89, `src/token-routes.ts` 89.20, `src/status-page-routes.ts` 89.32. `src/main.ts`, `src/owner-reset.ts` (spawned as processes) and `src/protected-route.ts` (types only) are not in the table; `e2e/` is not part of `bun test`. Many uncovered lines are exhaustive `never` defaults.
- Tests without an assertion: `bun scripts/noassert.ts <copy>` (AST of every `test(...)`/`test.each(...)(...)` call; looks for `expect(`, `assert`, `.toThrow`, `.rejects`, `.resolves` or a call of an asserting local helper in the last argument): exit 0, `tests: 1197; without assertion: 12; skip/todo/only: 0`. All 12 are false positives: in 11 (`src/main.startup.test.ts:106` to `304`) the last argument is the timeout (`}, 20_000);`) and the body asserts through `assertOneLine` or `expect`; `src/maintenance-view.test.ts:109` uses `expect<string>(...)`. So none. No `test.skip`, `test.todo` or `test.only`.
- Tests that mirror the implementation: 5 test imports take an expected text from the module under test (`src/notification-form.test.ts` 3, `src/token-view.test.ts` 1, `src/server.factor.test.ts` 1); the other texts are literals. Note.
- Risky branches without a test: finding 10 (failed list reads on Tokens and Probes, refusal pages of notification delete and resend). Team refusals after a race (`src/team-routes.ts:363-382`: `session-gone`, `not-found`, `stale`, `no-authenticator`, `forbidden` of a member operation) are not covered either; the store side is tested in `src/team-store.test.ts`. Note.
- The rule of AGENTS.md:67 (every rendering `src/server.*.test.ts` runs `expectCalloutsOnly`) is kept by 3 of 31 files: finding 2.
- Real clock: `src/check-format.test.ts:83-85` asserts `performance.now() - start < 100` ms; `src/server.tokens.test.ts:510` polls with a real `Bun.sleep(1)`. AGENTS.md:85 forbids a real clock and real timers in tests. Note.

### 6. Error handling: `checked`

- `grep -nE -A4 "catch( \(\w+\))? \{|\.catch\(|catch \{"` over the non-test `src/*.ts` (35 sites), each block read:
  - Catches that drop the error, each with a reason comment: `src/api-failure.ts:64`, `src/secret-box.ts:50`, `src/check-detail-pages.ts:207`, `src/check-editor-page.ts:381`, `src/check-form.ts:373`, `src/forms.ts:88`, `src/probe-snippet.ts:58`, `src/secret-key.ts:12`. Fine.
  - Catches that release a reservation and rethrow (`src/account-routes.ts:164`, `src/server.ts:766`, `787`, `src/sign-in-factor.ts:74`), map to a typed error with `cause` (`src/people-log.ts:147`, `src/fonts.ts:35`, `src/secret-key.ts:36`) or to a result (`src/factor-store.ts:268`, `276`, `283` through `abortReason`, which rethrows any other error; `src/server.ts:854`). Fine.
  - Log-and-answer catches: People-row failures (`src/check-write.ts:246`, `src/runtime-write.ts:77`, `src/token-write.ts:161`) and team commits (`src/team-routes.ts:90`, `src/account-routes.ts:449`, `src/link-routes.ts:125`, `231`), `src/server.ts:669`. They log the error name at `error` and answer `500` or a "not logged" page. Not swallowed; duplicated (finding 7).
  - The request catch-all `src/server.ts:1234-1241` logs `request failed` with `err.name` only, no message; deliberate (no secrets in logs, AGENTS.md "Error and log text never contains secrets"), but an unexpected `TypeError` leaves no clue. Note.
- Ignored promise rejections: `@typescript-eslint/no-floating-promises` and `no-misused-promises` pass (item 1). `src/console-script.ts:49` passes both handlers to `.then`. No `void <promise>` in production code.
- Error shapes for the same failure: finding 6 (the same api `500` gives two texts), finding 11 (`cannotOpen` drops `cause`; three `err.code` fallbacks). `src/account-store.ts:227` throws a plain `Error` ("owner insert returned no id"), against AGENTS.md:71; the setup handler logs its name `Error`. Note.

### 7. Consistency: `checked`

Against pulse-console `AGENTS.md`, `docs/code-conventions.md` and the layout of probe, status, notify and api:

- Shared callout helpers (AGENTS.md:66) and the callout audit (AGENTS.md:67): findings 1 and 2.
- Mixed concerns and duplicated markup: `grep -cE "<(section|p|a|div|form|h[1-6]|span|ul|li|table|pre|input|button|code)[ >]"` per route module: `check-routes.ts` 6, `token-routes.ts` 5, `status-page-routes.ts` 4, `notification-routes.ts` 4, `team-routes.ts` 3, `maintenance-routes.ts` 3, `incident-routes.ts` 3, `probe-routes.ts` 2, `server.ts` 0. Most are a one-line "Open it again" or "Back to" link; the larger blocks are findings 3 and 4. `*-pages.ts` modules hold no I/O (`grep -nE "Date\.now|deps\.|fetch|await |async |log\." src/*-pages.ts src/pages.ts`: no hit in code).
- "Pass side effects in as dependencies" (AGENTS.md:56): finding 9 (`randomBytes` from `node:crypto` in a route module). `grep -nE "process\.env|console\.(log|error|warn|info)|readFileSync|Date\.now\(\)|setTimeout\(|Math\.random"` outside `main.ts`, `server.ts`, `owner-reset.ts` and the harness: only the browser script `src/console-script.ts`. Fine.
- "Wrap with `{ cause }`" (AGENTS.md:71): finding 11.
- "Do not export a function only for a test" (AGENTS.md:83): the note list in item 4.
- TypeScript rules: `grep` found no `any`, no default export, no non-null `!` in `src/`, no relative import without `.ts`, no built-in without `node:`, no `enum` or `namespace`, no `utils.ts`. `as` in production code: `src/incident-list.ts:104-105`, `src/incident-form.ts:90`, `92`, `106` (each right after an `includes` check) and `src/server.ts:1263` (`AddressInfo`, with a comment). Fine.
- Explicit return types: `bun scripts/returns.ts <copy>` (AST of every exported function declaration and exported arrow or function expression in non-test `src/`): exit 0, `exported functions: 378; without explicit return type: 0`.
- Booleans: `grep -nE "(let|const) [a-z]\w* = (true|false)\b"` finds none without `is`/`has`/`can`; two boolean parameters `withConfig` (`src/incident-read.ts:151`) and `withLocations` (`src/token-read.ts:118`). Style only: note.
- File names are kebab-case (`ls src test e2e`, all match).
- Configuration handling matches probe and status: one `src/settings.ts` reads the environment through pulse-kit readers, `main.ts` wires it; start errors exit 2 with one line (checked in item 8).
- Test harness in `src/`: finding 13.
- `AGENTS.md:92` lists 23 `src/server.*.test.ts` files that start the real server; there are 31 (`ls src/server*.test.ts | wc -l`). Not listed: `account-shell`, `account-token`, `confirm`, `form-token`, `notifications`, `overview`, `states`, `status-page`. Note.
- Pins: contract, kit and config pins are on `main` of their repositories (`gh api repos/lorenzh/pulse-<repo>/compare/<pin>...main`: `ahead`, 3, 1 and 3 commits). The config pin equals that of api, probe, status and notify. Fine.

### 8. Docs against code: `checked`

Read `README.md` and every page of `docs/`, then checked the claims with the code and the local server. Contradictions: finding 5 (README endpoint table, `docs/index.md:3`, `docs/development.md:25`), finding 9 (the randomness claim of `docs/development.md:16`) and finding 14 (the example-token error of `docs/configuration.md:91`, which cannot be printed). The claims behind finding 5 and 9 in detail:

- `docs/index.md:3`: "Today it serves first-run setup with a local owner account, password sign-in with sessions, sign-out and the ops routes. Two-factor sign-in follows in #563." The code serves `/sign-in/factor`, TOTP and recovery codes (`src/sign-in-factor.ts`, `src/totp.ts`; README table rows `GET /sign-in/factor`, `POST /account/authenticator`) and the Checks, Incidents, Maintenance, Tokens, Probes, Status page, Notifications and Team screens. Part of finding 5.
- `docs/development.md:25`: "`src/navigation.ts` holds the nine-entry registry". `bun -e 'import * as n from "./src/navigation.ts"; ...'` in the copy: `NAVIGATION 11 overview,checks,incidents,maintenance,tokens,probes,status-page,notifications,team,activity,system`. Part of finding 5.
- `docs/development.md:16`: `src/main.ts` "is the only module that touches `process.env`, the file system, `crypto` randomness, `Bun.password` and stdout". `src/server.ts:1214` reads the fonts with `loadFonts(readFileSync)`; `src/notification-routes.ts:69` draws randomness (finding 9); `src/owner-reset.ts` (the second entry point) reads `process.env` and writes stdout. Part of finding 9.

Claims checked and correct:

- Start errors (`env -i ... timeout 20 bun --no-env-file src/main.ts`, one bad setting at a time, each exit 2 with one line): `PULSE_CONSOLE_DB=<dir>/missing/console.db` gives `cannot open (ENOENT)`; a text file as database `cannot open (SQLITE_NOTADB)`; `PULSE_CONSOLE_PUBLIC_URL=https://c.example/x` gives `must not have a path other than /`; a key file `zz` gives `must hold 64 lowercase hex characters`; a missing key file `cannot read (ENOENT)`; `PULSE_LOG_LEVEL=loud` gives `must be one of debug, info, warn, error`. All equal `docs/configuration.md:24-44`. `SCHEMA_VERSION = 3` (`src/database.ts:4`) equals the documented `(3)`.
- HTTP (local run, `curl`): before setup `GET /`, `GET /probes`, `GET /status-page` answer `303` to `/setup`; `PUT /probes`, `PUT /tokens`, `PUT /checks`, `DELETE /notifications`, `POST /healthz`, `PUT /console.css` answer `405` with `allow: GET, HEAD`, `PATCH /status-page` `405` with `allow: GET, HEAD, POST`; `GET /nope` `404`; `HEAD /` `303`. Every one of `GET /healthz`, `POST /healthz`, `/metrics`, `/readyz`, `/nope`, `PUT /setup`, `GET /setup`, `/console.css` and a font route carries the CSP, `nosniff`, `DENY` and `same-origin` of `docs/configuration.md:217-222`; pages and `404`/`405` carry `no-store`, the font `public, max-age=31536000, immutable`, as README says.
- The CSP constant (`src/server.ts:104-105`) equals AGENTS.md and `docs/configuration.md:221`. Token refusal texts (`docs/tokens.md:102-108`) equal `src/token-write.ts:111-130`; check write outcomes (`docs/checks.md:279-293`) equal `src/check-write.ts:145-175`. The coverage gate (80 %) and the complexity budget (15) in `docs/development.md` hold (items 2 and 5).

## Issue candidates

Ranked by how much a fix is worth. Every command ran on pulse-console `45b2d48` in the installed copy.

### quality-console-2026-11-09-1 (P3): Duplication: the Tokens and Probes screens write their own alerts instead of the `states.ts` callouts; the banners have no style and fail the callout audit

- Location: `src/token-routes.ts:126`, `128` (`selfBanner`), `155` (`listBanner`); `paragraph(text, ' role="alert"')` at `src/token-routes.ts:94`, `src/probe-routes.ts:76`, `src/probe-pages.ts:108`, `182`, `206`, `src/token-pages.ts:160`, `201`. Helpers that already cover them: `callout` and `alertCallout` (`src/states.ts:31`, `59`). Rule: AGENTS.md:66.
- What happens: the banners for "no admin token", "`/self` read failed" and "the last active admin token expires at ..." render `<section class="state state-error|state-warning" role="alert">`. `src/styles.ts` has no rule for `.state`, `.state-error` or `.state-warning` (`grep -nE "\.state(-error|-warning)?[ ,{:.]|\.state-" src/styles.ts`: only `.state-tiles` and `.state-tile`, lines 170-173), so they show as plain text without the callout box and icon (`.callout-warning`, `src/styles.ts:150`). The "saved, not logged" and refusal notices of these two screens are bare `<p role="alert">`, while the same notices on Checks, Incidents, Maintenance, Status page and Notifications are callouts. Without an admin token `/tokens` and `/probes` show the same sentence twice, once in each form, both `role="alert"`, so a screen reader announces it twice.
- Command (audit-review): write the following reproduction to `review-callouts.test.ts` in the installed temporary copy, then run `timeout 300 bun test ./review-callouts.test.ts`: exit 1. All three failures are the callout assertion at `test/rendered-audit.ts:10`; the status, duplicate-text and no-admin-request assertions pass. The services close in `finally`.

```ts
import { expect, test } from "bun:test";
import { jsonReply, startFakeApi } from "./test/fake-api.ts";
import { expectCalloutsOnly } from "./test/rendered-audit.ts";
import { getPage, START } from "./test/signed-in-console.ts";
import { startTeamConsole } from "./test/team-console.ts";
import { adminToken, selfToken } from "./test/token-fixtures.ts";

test("last admin expiry banner on /tokens", async () => {
  const api = startFakeApi();
  const expired = selfToken({ expiresAt: START - 1 });
  api.reply("/admin/tokens/self", jsonReply(expired));
  api.replyTo("GET", "/admin/tokens", jsonReply({
    tokens: [expired, adminToken({ expiresAt: START + 86_400_000 })],
  }));
  const c = await startTeamConsole({ apiUrl: api.url, adminToken: "tokens-admin-token-sentinel-0123456789" });
  try {
    const res = await getPage(c, "/tokens", c.cookies.admin);
    expect(res.status).toBe(200);
    console.log("/tokens expiry alert tags:", JSON.stringify(res.body.match(/<[^>]+role="alert"[^>]*>/g)));
    expectCalloutsOnly(res.body);
  } finally {
    await c.close();
    api.stop();
  }
});

for (const path of ["/tokens", "/probes"]) {
  test(`no admin token banner on ${path}`, async () => {
    const api = startFakeApi();
    const c = await startTeamConsole({ apiUrl: api.url });
    try {
      const res = await getPage(c, path, c.cookies.admin);
      expect(res.status).toBe(200);
      const text = "The console has no pulse-api token. Set PULSE_CONSOLE_ADMIN_TOKEN_FILE and restart the console.";
      const copies = res.body.split(text).length - 1;
      console.log(path, "no-token text copies:", copies, "alert tags:", JSON.stringify(res.body.match(/<[^>]+role="alert"[^>]*>/g)));
      expect(copies).toBe(2);
      expect(api.seen.filter(s => s.path.startsWith("/admin/"))).toEqual([]);
      expectCalloutsOnly(res.body);
    } finally {
      await c.close();
      api.stop();
    }
  });
}
```

```text
/tokens expiry alert tags: ["<section class=\"state state-warning\" role=\"alert\">"]
/tokens no-token text copies: 2 alert tags: ["<section class=\"state state-error\" role=\"alert\">","<p role=\"alert\">"]
/probes no-token text copies: 2 alert tags: ["<section class=\"state state-error\" role=\"alert\">","<p role=\"alert\">"]
Expected substring or pattern: /^<section class="callout callout-(?:info|success|warning|error|neutral)"/
Received: "<section class=\"state state-warning\" role=\"alert\">" or "<section class=\"state state-error\" role=\"alert\">"
0 pass
3 fail
10 expect() calls
```

  CSS check: `grep -nE "\\.state(-error|-warning)?[ ,{:.]|\\.state-" src/styles.ts`: exit 0; only `.state-tiles` and `.state-tile` at lines 170-173, no rule for these banners.

### quality-console-2026-11-09-2 (P3): Only 3 of 31 `src/server.*.test.ts` files run `expectCalloutsOnly`, although AGENTS.md requires it of every one that renders a page

- Location: rule `AGENTS.md:67`; helper `test/rendered-audit.ts:7`. Callers: `src/server.checks.test.ts` (7), `src/server.checks-write.test.ts` (4), `src/server.checks-change.test.ts` (4). Not called in the other 28, among them `src/server.tokens.test.ts`, `src/server.probes.test.ts`, `src/server.incidents.test.ts`, `src/server.maintenance.test.ts`, `src/server.team.test.ts`, `src/server.status-page.test.ts`, `src/server.notifications.test.ts`.
- What happens: the audit that would catch hand-written alerts and inline styles runs only on the Checks screens. Finding 1 got through on Tokens and Probes; any later screen can do the same.
- Command: `for f in src/server.*.test.ts src/server.test.ts; do echo "$(grep -c expectCalloutsOnly $f) $f"; done | sort -n`: exit 0.

```text
0 src/server.account-shell.test.ts
0 src/server.account-token.test.ts
...
0 src/server.tokens.test.ts
0 src/server.upgrade.test.ts
4 src/server.checks-change.test.ts
4 src/server.checks-write.test.ts
7 src/server.checks.test.ts
```

  (28 lines with `0`, `ls src/server*.test.ts | wc -l`: `31`.)

### quality-console-2026-11-09-3 (P3): Mixed concerns: six route handlers build the "saved, People row not logged" page inline

- Location: `src/check-routes.ts:354`, `src/check-routes.ts:758`, `src/incident-routes.ts:162`, `src/maintenance-routes.ts:325`, `src/notification-routes.ts:221`, `src/status-page-routes.ts:283`.
- What happens: each handler writes `${callout({ kind: "warning", body: paragraph(SAVED_NOT_LOGGED_TEXT), role: "alert" })}<p><a href="...">Open ...</a></p>` itself, with its own link markup (`<a href>` five times, `link(...)` once). AGENTS.md:66 names outcome pages as shared helpers in `src/states.ts`; `docs/code-conventions.md` rule 3 says handlers build no markup. The Tokens and Probes screens show the same notice as a bare paragraph (finding 1).
- Command: `grep -n "SAVED_NOT_LOGGED_TEXT" src/*.ts | grep -v test | grep callout`: exit 0.

```text
src/check-routes.ts:354:    body: `${callout({ kind: "warning", body: paragraph(SAVED_NOT_LOGGED_TEXT), role: "alert" })}<p><a href="${escapeHtml(href)}">Open the check</a></p>\n`,
src/check-routes.ts:758:      body: `${callout({ kind: "warning", body: paragraph(SAVED_NOT_LOGGED_TEXT), role: "alert" })}<p>${link("/checks", "Open the checks")}</p>\n`,
src/incident-routes.ts:162:        `${callout({ kind: "warning", body: paragraph(SAVED_NOT_LOGGED_TEXT), role: "alert" })}<p><a href="${answer.href}">Open the incident</a></p>\n`,
src/maintenance-routes.ts:325:    `${callout({ kind: "warning", body: paragraph(SAVED_NOT_LOGGED_TEXT), role: "alert" })}<p><a href="${LIST_PATH}">Open Maintenance</a></p>\n`,
src/notification-routes.ts:221:    body: `${callout({ kind: "warning", body: paragraph(SAVED_NOT_LOGGED_TEXT), role: "alert" })}<p><a href="${NOTIFICATIONS_PATH}">Open the notifications</a></p>\n`,
src/status-page-routes.ts:283:        body: `${callout({ kind: "warning", body: paragraph(SAVED_NOT_LOGGED_TEXT), role: "alert" })}<p><a href="${STATUS_PAGE_PATH}">Open the status page settings</a></p>\n`,
```

### quality-console-2026-11-09-4 (P3): Duplication: the "Your input" block is written four times, one a byte copy, two of them in route modules

- Location: `src/incident-pages.ts:499-507` (`keptInputHtml`, exported), `src/maintenance-pages.ts:228-245` (`maintenanceKeptHtml`), `src/check-routes.ts:284-299` (`keptInputHtml`, private, in a route module), `src/status-page-routes.ts:233-244` (`keptInputText`, in a route module).
- What happens: lines 238-244 of `maintenanceKeptHtml` equal lines 500-506 of the exported incident helper. The check and status page copies sit in route modules (mixed concerns), and the status page copy renders a `<ul>` with `.mono` names where the other three render `<dl class="settings">`, so the same kept input looks different on the Status page.
- Command: `diff <(sed -n 500,506p src/incident-pages.ts) <(sed -n 238,244p src/maintenance-pages.ts); echo "diff exit $?"; grep -n "Your input</h2>" src/*.ts`: exit 0.

```text
diff exit 0
src/check-routes.ts:294:  return `<h2>Your input</h2>
src/incident-pages.ts:506:  return `<h2>Your input</h2>\n<dl class="settings">\n${items.join("\n")}\n</dl>\n`;
src/maintenance-pages.ts:244:  return `<h2>Your input</h2>\n<dl class="settings">\n${items.join("\n")}\n</dl>\n`;
src/status-page-routes.ts:243:  return rows.length === 0 ? "" : `<h2>Your input</h2>\n<ul>\n${rows.join("\n")}\n</ul>\n`;
```

### quality-console-2026-11-09-5 (P3): The README endpoint table lacks the Probes, Status page and Notifications routes, and two docs pages describe an older console

- Location: `README.md:91-148` (table); `docs/index.md:3`; `docs/development.md:25`. Code: `src/server.ts:1160-1169` registers `probeRoutes`, `statusPageRoutes`, `notificationRoutes`.
- Claim: AGENTS.md:99 "`README.md` owns ... its HTTP endpoints". The table lists every other screen's routes, but not `/probes`, `/probes/new`, `/probes/rotate`, `/probes/revoke`, `/status-page`, `/notifications`, `/notifications/new`, `/notifications/edit`, `/notifications/delete`, `/notifications/failed`, `/notifications/resend`. They are described only in prose (`README.md:16`, `docs/tokens.md:124-127`, `docs/configuration.md:154-158`), without the status codes the table gives for every other route. `docs/index.md:3` says the console serves setup, password sign-in, sign-out and the ops routes and that "Two-factor sign-in follows in #563"; `docs/development.md:25` says "the nine-entry registry", the registry has 11 entries.
- Command (audit-review): `bun -e 'import { readFileSync } from "node:fs"; import { NAVIGATION } from "./src/navigation.ts"; const rows = readFileSync("README.md", "utf8").split("\n").filter(l => l.startsWith("|")); for (const p of ["/probes","/probes/new","/probes/rotate","/probes/revoke","/status-page","/notifications","/notifications/new","/notifications/edit","/notifications/delete","/notifications/failed","/notifications/resend"]) console.log(p + " table=" + rows.filter(l=>l.includes(p)).length); console.log("NAVIGATION", NAVIGATION.length, NAVIGATION.map(e=>e.id).join(","));'`: exit 0.

```text
/probes table=0
/probes/new table=0
/probes/rotate table=0
/probes/revoke table=0
/status-page table=0
/notifications table=0
/notifications/new table=0
/notifications/edit table=0
/notifications/delete table=0
/notifications/failed table=0
/notifications/resend table=0
NAVIGATION 11 overview,checks,incidents,maintenance,tokens,probes,status-page,notifications,team,activity,system
```

## Notes

Findings that are not issue candidates (all `P3`), then the notes of the checklist.

### quality-console-2026-11-09-6 (P3): Duplication: write outcome and refusal mapping exist twice, with different texts for the same api answer

- Location: `src/token-write.ts:86-133` (`outcomeOf`, `messageOf`, `refusedAnswer`; the comment at line 86 says "as `check-outcome.ts`") against `src/check-outcome.ts:24-44` and `src/check-write.ts:140-175`, which checks, incidents, maintenance, status page and notifications share (`src/runtime-write.ts:85` adds a third mapping for 403 and 404).
- What happens: a `500` with the wire header answers `pulse-api refused the request (500). Nothing was changed.` on Tokens and Probes and `pulse-api could not save the change (500). Nothing was changed.` elsewhere; a `413` is a form error on checks and a `502` text on tokens; a refused `4xx` keeps the api message on checks and drops it on tokens. Each screen documents its own texts (`docs/tokens.md:102-108`, `docs/checks.md:286-290`), so the docs match.
- Command: `grep -n "refused the request\|could not save the change\|function refusedAnswer\|function runtimeRefused\|function outcomeOf\|as \`check-outcome.ts\`" src/check-write.ts src/token-write.ts src/runtime-write.ts`: exit 0.

```text
src/token-write.ts:86:// Decided by status and wire header first, as `check-outcome.ts`; the body only for the secret.
src/token-write.ts:87:function outcomeOf(write: TokenWrite, result: RequestJsonResult<unknown>): Outcome {
src/token-write.ts:111:function refusedAnswer(status: number, message: string | undefined): TokenWriteAnswer {
src/token-write.ts:126:    message: `pulse-api refused the request (${status}). Nothing was changed.`,
src/check-write.ts:145:export function refusedAnswer(
src/check-write.ts:165:      message: `pulse-api refused the request (${status}): ${messageOf(message)} Nothing was changed.`,
src/check-write.ts:172:    message: `pulse-api could not save the change (${status}). Nothing was changed.`,
src/runtime-write.ts:85:function runtimeRefused(status: number, message: string | undefined): WriteAnswer {
```

### quality-console-2026-11-09-7 (P3): Duplication: the People-row append is written three times, the team-commit failure catch four times

- Location: `isLogged` at `src/check-write.ts:230-252`, `src/runtime-write.ts:66-82`, `src/token-write.ts:145-167`; the `team change could not be saved` catch at `src/team-routes.ts:86-95` (`commit`), `src/account-routes.ts:447-456`, `src/link-routes.ts:118-131`, `src/link-routes.ts:224-237`. The last three also repeat `messagePage("Not saved", "The change could not be saved.")`, while `src/team-routes.ts:42` holds the same text as `SAVE_FAILED`.
- Command: `diff <(sed -n 67,83p src/runtime-write.ts) <(sed -n 236,252p src/check-write.ts); echo "diff exit $?"`: exit 0; the `diff` itself exits 1 with three changed lines only (the signature, `target: write.target` against `write.targetOf(answer)`, and the log message). `grep -n "team change could not be saved" src/*.ts | grep -v test`: four hits at the lines above.

```text
1c1
< function isLogged(deps: CheckWriteDeps, write: RuntimeWrite, user: User, value: string): boolean {
---
> ): boolean {
7c7
<       target: write.target,
---
>       target: write.targetOf(answer),
12c12
<     deps.log.error("runtime change not logged", {
---
>     deps.log.error(`${write.logMessage} not logged`, {
diff exit 1
```

### quality-console-2026-11-09-8 (P3): Four exports have no production user; one is a refusal text nothing renders

- Location: `src/token-routes.ts:61` `LAST_ADMIN_REFUSED_TEXT` (no user at all; the refusal uses `LAST_ADMIN_TEXT`, `src/token-routes.ts:418`); `src/states.ts:159` `readOnlyState` ("The 503 body when pulse-api reported its checks file as read-only"; only `src/states.test.ts:162` and `test/fixture-routes.ts:360` call it; a real `503` from pulse-api answers `pulse-api could not save the change (503)` from `src/check-write.ts:172`); `src/probe-snippet.ts:198` `composeStopCommand` (only `src/probe-snippet.test.ts:197`); `src/check-filters.ts:95` `checkFiltersQuery` (only `src/check-filters.test.ts:122`).
- Command (audit-review): `grep -rn 'composeStopCommand\|readOnlyState\|checkFiltersQuery\|LAST_ADMIN_REFUSED' --include='*.ts' src test e2e | grep -v '^src/\(probe-snippet\|states\|check-filters\)\.ts'`: exit 0. This directly confirms the four names without the removed exploratory export-scan script.

```text
src/check-filters.test.ts:4:  checkFiltersQuery,
src/check-filters.test.ts:122:    expect(checkFiltersQuery(filters)).toBe("q=a+b&type=dns&state=down&source=file");
src/token-routes.ts:61:export const LAST_ADMIN_REFUSED_TEXT = "This is the last active admin token. Nothing was changed.";
src/states.test.ts:12:  readOnlyState,
src/states.test.ts:162:  const html = readOnlyState();
src/probe-snippet.test.ts:11:  composeStopCommand,
src/probe-snippet.test.ts:197:    expect(composeStopCommand(base)).toBe(
test/fixture-routes.ts:26:  readOnlyState,
test/fixture-routes.ts:360:      page(503, "Edit", `${readOnlyState()}${editForm(request)}`),
```

  `grep -cw <name> <file>` in the defining files: `composeStopCommand` 1, `readOnlyState` 1, `checkFiltersQuery` 1, `LAST_ADMIN_REFUSED_TEXT` 1 (the declaration only).

### quality-console-2026-11-09-9 (P3): The resend request id comes from `node:crypto` in a route module, not from the injected `randomBytes`

- Location: `src/notification-routes.ts:1` (`import { randomBytes } from "node:crypto"`), `src/notification-routes.ts:67-70` (`newRequestId`), used at `405`. Rules: AGENTS.md:56 (side effects as dependencies; only `main.ts` wires the real ones); `docs/development.md:16` (`main.ts` "is the only module that touches ... `crypto` randomness"). Every other random value takes `deps.randomBytes` or a `randomBytes` parameter (`src/setup-code.ts:42`, `src/form-tokens.ts:94`, `src/http-context.ts:132`, `src/account-routes.ts:206`, `src/account-links.ts:34`, `src/recovery-codes.ts:10`, `src/secret-box.ts:20`).
- Effect: a test cannot fix the id; `src/server.notifications.test.ts:535` can only match `/^[A-Za-z0-9_-]{24}$/`.
- Command (audit-review): `grep -HnE 'from "node:crypto"|randomBytes\(' src/notification-routes.ts`: exit 0. This route draws randomness directly:

```text
src/notification-routes.ts:1:import { randomBytes } from "node:crypto";
src/notification-routes.ts:69:  return randomBytes(18).toString("base64url");
```

### quality-console-2026-11-09-10 (P3): Failed list reads on Tokens and Probes and the notification refusal pages have no test

- Location: `src/token-routes.ts:102-115` (`readProblem`, called from `src/token-routes.ts:171`, `384`, `414` and `src/probe-routes.ts:97`, `309`); `src/probe-routes.ts:97-101`; `src/notification-routes.ts:217-222`, `335-361` (delete refusals: form, token rejected, stale `412`), `370-375`, `417-422`, `436-441`, `465-466`, `474-490` (refused resend). AGENTS.md: "Test the main behavior ... and the obvious failures (invalid input, unreachable service, timeout)".
- What happens: no test makes `GET /admin/tokens` fail (unreachable, `5xx`, no token) while the page renders; the `/self` failures are tested (`src/server.tokens.test.ts:535`, `567`). The untested no-token path shows the duplicated sentence of finding 1. `src/notification-routes.ts` is the least covered production file.
- Command: `timeout 600 bun run test` (exit 0), coverage rows:

```text
 src/notification-routes.ts |   97.78 |   80.10 | 118,217-222,237,244-248,291,303,335-361,370-375,417-422,436-441,465-470,474-490
 src/probe-routes.ts        |   93.48 |   91.78 | 97-101,210,214-223,287,309-310,391-397,437,439,450-451
 src/token-routes.ts        |   92.98 |   89.20 | 102-115,125,129-132,171-175,273,283-286,336-340,384-385,414-415,556-562,574-575
```

  `grep -n '"/admin/tokens"' src/server.tokens.test.ts src/server.probes.test.ts | grep -v POST`: only `jsonReply({ tokens: rows })` answers (`src/server.tokens.test.ts:33`, `src/server.probes.test.ts:44`).

### quality-console-2026-11-09-11 (P3): Duplication: three local `err.code` readers with three fallbacks; the database one drops the `cause`

- Location: `codeOf` `src/database.ts:128-133` (any string `code`, else `"UNKNOWN"`; read through `in`, so a getter runs); `errorCode` `src/server.ts:1245-1248` (`Reflect.get`, `/^E[A-Z0-9_]+$/`, else `"unknown"`); `errorCode` `src/secret-key.ts:6-17` (own data property, `/^E[A-Z0-9]+$/`, else `undefined`), which is a copy of the private `errorCode` of pulse-kit `src/secret-file.ts:4-15`. `cannotOpen` (`src/database.ts:135-140`) builds the `StartupError` without `cause`, while `src/secret-key.ts:38` and `src/server.ts:1255` pass it. Rule: AGENTS.md:71 "Wrap with `{ cause }`". pulse-kit `runService` prints only `err.message` of a `StartupError` (`src/run-service.ts:102-103`), so the cause would not leak SQLite text.
- Command: in the copy, `bun -e 'import { openDatabase } from "./src/database.ts"; const boom = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }); try { openDatabase("/nonexistent-dir/console.db", { createFile: () => { throw boom; }, chmod: () => {} }); } catch (err) { console.log(JSON.stringify({ name: err.name, message: err.message, setting: err.setting, hasCause: err.cause !== undefined })); }'`: exit 0.

```text
{"name":"StartupError","message":"PULSE_CONSOLE_DB=/nonexistent-dir/console.db: cannot open (EACCES)","setting":"PULSE_CONSOLE_DB","hasCause":false}
```

### quality-console-2026-11-09-13 (P3): A shared test harness lives in `src/`: it ships in the image and counts toward the coverage gate

- Location: `src/two-factor-harness.ts:1-6` imports `bun:test`; `Dockerfile:12` copies all of `src`; `bunfig.toml:4` excludes test-named files and `test/` from coverage but not this harness. `docs/development.md:60` says shared test helpers live in `test/`. Seven test files import the harness. This is a placement deviation; the separate claim that `test/` never ships is true. The harness is not reached by the service entry points, and its loopback lint suppression is test code, not a production lint defect.
- Commands (audit-review): `timeout 600 bun run check` (exit 0), `sed -n '1,6p' src/two-factor-harness.ts`, `grep -n 'COPY src' Dockerfile`, `grep -l two-factor-harness src/*.test.ts`, and `cat bunfig.toml` (exit 0 each). Excerpts:

```text
src/two-factor-harness.ts | 97.56 % Funcs | 100.00 % Lines
1993 pass, 0 fail, 13005 expect() calls, 90 files.
/* eslint-disable sonarjs/no-clear-text-protocols -- loopback test servers */
import { expect } from "bun:test";
12:COPY src ./src
src/owner-reset.test.ts
src/server.account-token.test.ts
src/server.factor.test.ts
src/server.recovery.test.ts
src/server.security.test.ts
src/server.sessions.test.ts
src/server.upgrade.test.ts
coveragePathIgnorePatterns = ["**/*.test.ts", "test/**", "**/test/**", "dist/**"]
```

### quality-console-2026-11-09-14 (P3): Duplication: the admin token example-token rule is copied from pulse-api and can never fire

- Location: `src/admin-token.ts:6-11` (`PLACEHOLDER_PREFIX`, `EXAMPLE_TOKENS`, comment "Copied from pulse-api src/tokens.ts:11-14 (EXAMPLE_TOKENS); the console cannot import the api"), checked at `src/admin-token.ts:21`; pulse-api `src/tokens.ts:8`, `11-14`. pulse-contract and pulse-kit have no such constant (`grep -rn "EXAMPLE_TOKENS\|example-token-change-me" contract/src kit/src`: no hit). Both example tokens have 28 and 30 characters; the console's 32-character rule (`src/admin-token.ts:17`) answers first, so the copied list never decides anything (the test says so: `src/admin-token.test.ts:53` "The public example tokens are shorter than 32, so the length rule reports them first"). `docs/configuration.md:91` still documents the error `PULSE_CONSOLE_ADMIN_TOKEN is a public example token: generate your own`, which cannot be printed for either token.
- Command: `grep -n "EXAMPLE_TOKENS\|replace-with-\|example-token" api/src/tokens.ts console/src/admin-token.ts` over the clones: exit 0. Then in the copy `bun -e 'import { readAdminToken } from "./src/admin-token.ts"; for (const t of ["example-token-change-me-0000","example-token-0123456789abcdef"]) { try { readAdminToken({ PULSE_CONSOLE_ADMIN_TOKEN: t }, () => ""); console.log(t.length, "accepted"); } catch (e) { console.log(t.length, e.message); } }'`: exit 0, `28 PULSE_CONSOLE_ADMIN_TOKEN must hold at least 32 characters` and `30 PULSE_CONSOLE_ADMIN_TOKEN must hold at least 32 characters`.

```text
api/src/tokens.ts:8:export const PLACEHOLDER_PREFIX = "replace-with-";
api/src/tokens.ts:11:export const EXAMPLE_TOKENS: readonly string[] = [
api/src/tokens.ts:12:  "example-token-change-me-0000",
api/src/tokens.ts:13:  "example-token-0123456789abcdef",
console/src/admin-token.ts:6:const PLACEHOLDER_PREFIX = "replace-with-";
console/src/admin-token.ts:7:// Copied from pulse-api src/tokens.ts:11-14 (EXAMPLE_TOKENS); the console cannot import the api.
console/src/admin-token.ts:8:const EXAMPLE_TOKENS: readonly string[] = [
console/src/admin-token.ts:9:  "example-token-change-me-0000",
console/src/admin-token.ts:10:  "example-token-0123456789abcdef",
```

### Other notes

- Biome: 7 `useTemplate` infos (`src/probe-pages.ts`, `src/probe-snippet.ts`), the `useDomNodeTextContent` warning at `e2e/run.ts:1667`, and the deprecated `recommended` field in the shared `biome.json:41` (item 1).
- 234 of 844 exports are named by no other file; 20 functions and classes are exported only for a test (item 4).
- `src/admin-token.ts:28-29` repeats the length check of `tokenProblem` (item 4).
- Real clock in two tests (item 5); 5 test imports of expected texts (item 5); untested team race refusals (item 5).
- `request failed` logs only the error name (item 6); plain `Error` at `src/account-store.ts:227` (item 6).
- Loopback host list in two console modules and pulse-notify (item 3).
- `AGENTS.md:92` lists 23 of the 31 server test files (item 7); `docs/development.md:16` names `main.ts` as the only module with file system access while `src/server.ts:1214` reads the fonts (item 8).
- Boolean parameters `withConfig`, `withLocations` (item 7).

## Audit review (2026-11-09)

- Started at 16:41:06 UTC. Every target clone HEAD matches the table above. The meta checkout is `f58ee076e40cdb8ce7f02abb9e12ca9a875fb2f1`, the audit-report commit directly after the examined meta baseline; `git diff 6a09e6e HEAD -- AGENTS.md docs/code-conventions.md` exits 0 with no output. No product revision moved.
- Structure: `jq -e . audits/quality/console.json` and a JSON/Markdown comparison exit 0. All retained ids, severities, candidate flags, required fields and eight `checked` checklist items match. No P1 or P2 finding requires reproduction. The remaining P3 findings concern code quality, test gaps, documentation or minor presentation; their evidence does not establish a higher-severity functional failure. Five issue candidates remain; style-only notes remain outside the candidate list.
- In a new temporary copy (`cp -a`, since `rsync` is unavailable), `TMPDIR=/tmp BUN_INSTALL_CACHE_DIR=<copy>/.review-cache bun install --frozen-lockfile` exits 0. `timeout 600 bun run check` exits 0: the same one warning and seven infos, passing workflow lint and typecheck, 1993 pass, 0 fail, 13005 assertions, 90 files, 100.62 s. Coverage is **97.17% lines and 97.99% functions**; the earlier issue comment had called the function number line coverage. The two `tsc --noEmit --noUnusedLocals --noUnusedParameters` commands (root and `-p e2e`) each exit 0 with no output. The installed shared ESLint, Biome and base TypeScript configs match the config clone (`diff -q`, exit 0 each).
- The installed shared ESLint API, with inline config disabled and only the complexity threshold overridden to 0, reports 1520 functions. The API driver exits 0 and prints a maximum of 15 at `src/server.security.test.ts:499`; the highest production functions remain `checkOutcome` and `handleApp`, both 14 against 15. The only other diagnostic in a non-test-named `src` file is the harness's loopback protocol suppression at line 109. The first attempt to consume the CLI's large JSON was truncated; the direct API check replaced it.
- Spot checks substantiate every retained finding: grep/diff confirm the callout-audit counts, repeated outcome markup, kept-input byte copy, write mapping and logging copies, four unused exports, direct randomness and harness placement. The byte copy's `diff` exits 0; the near-copy logging `diff` exits 1 with the three reported differences. Coverage confirms the uncovered read/refusal branches. The README/navigation command exits 0 with all 11 missing table paths and 11 navigation entries. The database command exits 0 with `hasCause:false`; the example-token command exits 0 with lengths 28 and 30, both rejected by the 32-character minimum. Finding 1's supplied test exits 1 at the three expected callout assertions, with the no-token text appearing twice on both pages.
- Removed `quality-console-2026-11-09-12`: `.factory/work/569/plan.md:312-317` explicitly requires half-up rounding and the console's duration wording. The command below reproduces the difference (exit 0), but establishes intended behavior rather than a defect. No finding was regraded. Corrected finding 13's scope and the 230/234 export-count typo; replaced deleted-script references in retained finding commands with direct checks.

```sh
bun -e 'import { durationText } from "./src/incident-list.ts"; import { formatDuration } from "@lorenzh/pulse-kit/format-duration"; for (const ms of [30_000, 89.5*60_000, 1439.6*60_000]) console.log(ms, JSON.stringify(durationText(ms)), JSON.stringify(formatDuration(ms)));'
```

```text
30000 "1 min" "<1m"
5370000 "1 h 30 min" "1h 29m"
86376000 "1 d" "23h 59m"
```

Limitations: P3 checks are spot checks, not an independent repeat of every exploratory scan. The browser suite and image build were not rerun; source, Dockerfile and coverage checks suffice for the retained claims. Runtime checks used only the temporary copy and localhost fakes; their services closed and the copy was removed. No security payloads, unfinished checks or audit gates remain.
