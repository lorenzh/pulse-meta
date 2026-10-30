# Issue review #324 (small review leftovers P3, round 3)

Verdict: specifiable. No blocking question. A bundle of independent small fixes; the spec should split them per target and keep each child small.

## Checked against the clones
- probe `src/settings.ts` still has `apiUrl: env.PULSE_API_URL ?? "http://localhost:3000"` (no validation); kit exports `readUrl` (`kit/src/settings.ts`). The README exception sentence (README.md ~161) exists.
- api `docs/install.md` ~50 still says status healthcheck `GET /`.
- contract pins `typescript` 6.0.3; probe, api and status use `^7.0.2`; kit and config run `typescript7` (alias) via `bun node_modules/typescript7/bin/tsc` while config also pins `typescript` 6.0.3 (for typescript-eslint). So the downgrade check: contract still on 6; config and kit have a workaround.
- status docs: the grep for "nine" found nothing in `docs/`; the count wording may already be fixed or live elsewhere (README or docs file name differs). Implementer must find it and count the real variables, or note it is done.

## Open points / assumptions
1. Several items cite line numbers from older reviews; the implementer must re-locate them and skip items already fixed (say so in the PR).
2. api #44 "demo guard": the expected service list (four regular, seven demo) must be read from the compose file in the repo, not copied from this issue.
3. api P2 (manual-incident reads empty when `PULSE_API_ADMIN_TOKENS_FILE` unset): behavior change. Assumption: reads return an empty list (200), not 404, as spec decision 1 of #340 says "empty reads". Needs the populated-database test and a docs fix.
4. api duplicate component id: message should be `components[1].id` style path; the docs note that `/components` and `/components/uptime` are public.
5. status 404 on manual incidents: keep last successful list in the feed, clear only on a successful empty list. Also the page shows incidents of checks without component under the label `Service` while checks are hidden. Reuse the feed's label; do not redo the feed.
6. TypeScript 7 in contract: "restore if it runs under Bun, or record why not". Both outcomes acceptable; record the build time before/after (~0.71 s vs ~3.9 s). Same check for config (typescript 6.0.3 alongside typescript7 alias) and any other repo; only contract/config/kit differ. Docs items: contract `AGENTS.md` (`node --test`), README (requires Node), `docs/index.md` (`package-lock.json`).
7. contract validator: check declared fields without spreading; nested required fields (own-property) too; never throw on getters; accept non-enumerable own `id`. Keep the wire format and JSON input unchanged. Contract change is a new release only if behavior is observable; no version bump in other targets expected, but the spec should say whether a release is needed (assume no).
8. Test-quality items (probe scheduler wiring extraction, status poller test, notify manual-incident tests, api `start.test.ts`, status `manual-incidents.test.ts`, config `hook.test.ts`): acceptance is mutation based: remove the guarded line and show the test fails. The process note applies to all: implementers run the mutation and paste the failing output in the PR. The spec should add this to each such child. Plan prompts may also get this rule (optional; mention only if prompt change is wanted; assumption: not in scope, spec-only guidance).
9. notify docs: `RETRY_DELAY_MS`/`RETRY_MAX_DELAY_MS` wording (`integer >= 0`), whole days read `1d`; README mention of manual incidents, updates, component routing.
10. api and probe docs: env header reference replaces the whole value, so token needs the scheme (`SVC_TOKEN="Bearer ..."`).
11. Dependencies: probe `PULSE_API_URL` validation must come before the meta README edit (README sentence removed in this repo once probe merges). Spec should mark the meta README change as part of the same feature, after probe; `targets.json` likely has meta not as a target, so the README edit may need to be in the spec PR or a follow-up. Assumption: made as a meta change when the probe PR merges (flag in the plan).
12. Targets touched: contract, probe, api, status, notify, config. kit, website not touched (kit only read). `dependsOn`: none needed, items are independent (probe uses existing kit `readUrl`).

## Derived acceptance check
Per target, the PR lists each leftover with its fix and for every test-related item the mutation output (guard removed, test red). Observable end state:
- contract: constructed objects with inherited nested required fields are rejected; a non-enumerable own `id` is accepted; a throwing getter does not make a validator throw; TypeScript 7 restored or reason recorded; docs fixed.
- probe: `PULSE_API_URL=bogus` (or invalid) exits 2 with one line naming the variable; scheduler wiring test fails if `main.ts` uses `Date.now`; docs bearer note.
- status: failure-abort test fails without the guarded line; feed keeps manual entries after 404; page shows component-less incidents as `Service` with hidden checks; docs count correct.
- notify, api, config: items above done; api manual reads empty with feature off (populated-db test); duplicate id error names `components[1].id`; `bun test src` works without Node on PATH in config.
- meta README exception sentence removed.
