# Spec: Enforce the type-safety and error-handling rules (#74)

## Goal
Make Biome enforce "no `any`" and "no non-null assertions in source", and fix what breaks: unchecked JSON casts, silently swallowed errors, leaked temp dirs.

## Scope
All five targets get the same `biome.json` change. Code fixes are in api, status, probe, notify.

## Non-goals
- No other Biome rule change; the SonarJS and coverage setup from #66 stays untouched.
- No `biome-ignore` or `@ts-ignore`. No behaviour change. No contract change (it exports types only, so validators live in status).

## Shared Biome change (identical, byte for byte, in all five repos)
In `biome.json`:
- Remove the `style.noNonNullAssertion: "off"` and `suspicious.noExplicitAny: "off"` overrides (both rules are then on through `recommended`; set them explicitly to `"error"` for clarity, same text everywhere).
- Add `overrides` with `includes: ["**/*.test.ts", "**/test/**"]` that sets `style.noNonNullAssertion: "off"`. This must cover `notify/test/support.ts` and contract's `test/` too. `noExplicitAny` stays on for tests.
- Each repo verifies with `diff` against the others.

## Required behaviour
- Lint fails for `const x: any = 1;` in a test and for `a[0]!` in `src/`; `!` in a test passes.
- Valid inputs and valid API responses behave exactly as before.
- Every deliberately ignored error has a one-line comment saying why (or is handled).
- Tests that create a temp dir remove it afterwards.

## Risks
- Biome may flag more places than the issue lists; the implementer runs `npm run lint` and fixes all, without suppressions.
- Validators must not reject valid data the API sends today (check optional fields against `contract/src/index.ts`).

## Acceptance evidence
In each repo `npm run check` passes and CI is green; `grep -rn biome-ignore` finds nothing new; `biome.json` identical in all five; a new status test passes.

## Repository: contract
- `biome.json` change only. Fix any lint finding that the new rules raise in `test/` or `src/` (none known).
- Done: `npm run check` green.

## Repository: probe
- `biome.json` change.
- Add a one-line why-comment (best-effort body cancel after the response is handled; failure to cancel is irrelevant) to `.catch(() => {})` in `src/check.ts` (~l.136) and `src/client.ts` (~l.27, ~l.83). Read each site; handle instead only if that keeps behaviour.
- Done: `npm run check` green; no uncommented empty catch.

## Repository: api
- `biome.json` change.
- Replace `any` in tests `retries.test.ts`, `server.test.ts` (`as any[]`, ~l.87, 97, 146), `degraded.test.ts` and any other the lint finds, with `unknown` plus narrowing or contract types (`ResultsResponse`, `ChecksResponse`, ...).
- Remove `!` in `src/state.ts` (~l.44 `latest[0]!`) and `src/server.ts` (~l.174 `RESULTS_PATH.exec(path)![1]!`): check for `undefined` and keep behaviour (the server case already sits in a try/catch that yields a 400/404 path; keep that outcome). Test files keep their `!`.
- Review the silent `catch {}` in `src/server.ts` (~l.175) and `src/config.ts` (~l.87): comment the reason or handle.
- Temp dirs: `config.test.ts` and `config.maintenance.test.ts` remove their `pulse-cfg-*` dir with `rmSync(dir, { recursive: true, force: true })` in `after`/`finally`. Check `degraded`, `retries`, `tls`, `service`, `service.quorum` tests; fix those that leak the same way (or note in the PR why one is out of scope).
- Done: `npm run check` green; no `pulse-cfg-*` left after the tests.

## Repository: status
- `biome.json` change.
- `src/poller.ts`: `getJson<T>` no longer casts. Add small hand-written validators (no new dependency), e.g. in `src/validate.ts`, that take `unknown` and return the contract type or throw. Check the top level is an array and that each element is an object with the fields the status page reads (checks: `id`, `name`, `state`; incidents and maintenance windows: the fields the page renders; read `public/client.js`, `src/server.ts` and the contract types to choose). Depth is shape checks of those fields, not every field.
- Failure behaviour: a malformed body for checks, incidents or maintenance follows the existing failed-refresh path (`error` set, last good data kept, `updatedAt` unchanged). Uptime keeps its rule: malformed or failed means no bars.
- New test (in the poller test file): a body that is not an array, and an element with a wrong-typed field, produce the error state and do not reach `onUpdate` as data; a valid body gives the same state as before.
- Ignored errors: `src/theme.ts` (l.21, l.29), `src/server.ts` (~l.59), `public/client.js` (l.9) and `public/index.html` (l.14 `catch (e) {}`) get a one-line reason comment (for example best-effort localStorage when storage is blocked). `poller.ts` ~l.65 already has a comment; keep it. `*.html` is outside Biome, but the comment is still required.
- Done: `npm run check` green, new test passes.

## Repository: notify
- `biome.json` change.
- Replace `any` in `test/notifier.test.ts` (~l.61 `any[]`) and `test/support.ts` (~l.92 `body: any`) with `unknown` and narrowing or contract types.
- Silent catches: `src/config.ts` (~l.28), `test/support.ts` (~l.124), `test/notifier.test.ts` (~l.67) get a one-line reason comment or are handled.
- Temp dirs in `test/config.test.ts` and `test/delivery.test.ts`: remove them after the tests if they leak.
- Done: `npm run check` green.

The five repos are independent; no `dependsOn`.
