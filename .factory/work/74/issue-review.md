# Issue review: #74 Enforce the type-safety and error-handling rules

Verdict: specifiable. No blocking question.

## Findings from the clones (main)
- All five `biome.json` files are identical today and set `style.noNonNullAssertion: off` and `suspicious.noExplicitAny: off`. The change is to remove those two overrides and add an `overrides` entry that turns `noNonNullAssertion` off for test files.
- Test files are not in one place: api has `src/*.test.ts` next to the source; notify has `test/` (`notifier.test.ts`, `support.ts`); contract has `test/`. The override glob must match both (`**/*.test.ts`, `**/test/**`) and must cover `test/support.ts`, which is not named `*.test.ts`.
- `any` also occurs in pulse-notify (`test/notifier.test.ts:61` `any[]`, `test/support.ts:92` `body: any`), which the issue does not list. `noExplicitAny` applies to tests, so these must be fixed too.
- api tests have more `any` than the three named files: `server.test.ts` (`as any[]`, lines 87, 97, 146) and `degraded.test.ts` are listed; `retries.test.ts` is listed. Many `!` in api test files (`service.test.ts`, `service.quorum.test.ts`, `retries.test.ts`) stay allowed, because tests are exempt.
- `pulse-status/src/poller.ts` `getJson<T>` casts `response.json()` to `T` for the four endpoints. The contract package may not export runtime validators; check `contract/src`.

## Open points (assumptions)
1. Where do validators live? Assumption: a small hand-written validator in `pulse-status/src` (no new dependency), unless the contract already exports guards. Plan must check the contract first and not add contract changes unless needed (contract change would force a release and dependsOn ordering).
2. Validation failure behaviour: assume it follows the existing failed-refresh path (`error` set, last good data kept). The uptime fetch already treats malformed data as "no bars" (see the comment in `poller.ts`); keep that. The issue says "behaviour does not change", so valid responses must produce identical state.
3. Depth of validation: assume shape checks of the top level (array) and the fields the status page reads, not every field. Plan must state this; the new test sends a malformed body (for example an object instead of an array, or a wrong-typed field) and expects the error state.
4. `public/index.html` and `public/client.js` are browser code, and `*.html` is excluded from Biome. Their ignored errors still get a one-line why-comment; `client.js` is linted by Biome.
5. "Handled or commented" for each empty `catch` / `.catch(() => {})`: assume a comment is enough when ignoring is deliberate (for example best-effort localStorage, best-effort cleanup); do not change behaviour. The plan must read each site (probe `client.ts`, `check.ts`; status `theme.ts`, `client.js`, `index.html`). Other repos (api, notify) may have more silent catches; the plan should grep them too, even though the issue lists only status and probe.
6. Temp dirs: `config.test.ts` and `config.maintenance.test.ts` should remove the directory with `rmSync(dir, { recursive: true, force: true })` in `after`/`finally`. Other api tests also call `mkdtempSync` (`degraded`, `retries`, `tls`, `service.quorum`); the issue says tests that create a temp dir remove it, so the plan should check them and fix any that leak, or state why they are out of scope.
7. `pulse-api/src/state.ts` and `server.ts` `!` removal: replace with an `undefined` check that keeps behaviour (throw or skip only where the value is provably present today).
8. Pulse-contract and pulse-notify get only the config change plus whatever the greps find; contract has no known breaks.
9. Each target ships its own PR; they are independent (no `dependsOn`). The config JSON must be byte-identical across the five repos.

## Constraints to carry into the spec
- No other Biome rule change; keep the #66 SonarJS and coverage setup untouched (#66 is closed and its work is on main).
- No `biome-ignore` suppressions, no `// @ts-ignore`.

## Acceptance check
In each of contract, probe, api, status, notify:
- `npm run check` passes (lint, types, tests, as configured).
- `biome.json` matches in all five repos; `noExplicitAny` is on everywhere, `noNonNullAssertion` is on for `src/` and off for test files.
- Adding `const x: any = 1;` to a test file, or `a[0]!` to a `src/` file, makes `npm run lint` fail; `!` in a test file passes.
- `grep -rn "biome-ignore"` finds nothing new.
- pulse-status has a new test: the poller gets a malformed API body and does not pass it on as contract data (it reports the error state); a valid body behaves as before.
- No empty `catch {}` or `.catch(() => {})` without a one-line reason comment in the five repos.
- `config.test.ts` and `config.maintenance.test.ts` leave no `pulse-cfg-*` dir in the temp dir.
