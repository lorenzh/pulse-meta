# Issue review: #75 Developer guidelines in every code repository

Verdict: specifiable. No blocking question. #74 is closed, so its rules (type safety, errors, SonarJS) exist on `main` of the targets.

## Checked against the clones

- All five targets have `AGENTS.md`, `lefthook.yml`, `biome.json`, `tools/sonarjs`, and scripts `lint`, `format`, `typecheck`, `test`, `check`. The shared command table holds everywhere. `npm test` has the 80 % coverage gate.
- `start` exists in api, probe, status, notify. Not in contract (its section must not tell to run `npm start`).
- contract: `check` also runs `build`. `dist/` is committed, `test/smoke.test.ts` has "dist matches a fresh build of src", `test/types.fixture.ts` exists. Example holds. The shared "Node 24 ... `import type`" rules apply to `src/index.ts` (types only).
- api: SQL is in `src/db.ts` and `src/service.ts` (not only the service module); `main.ts` defaults `PULSE_DB=./pulse.db` and `PULSE_CHECKS_FILE=./checks.json`; `checks.example.json` exists; `service.test.ts` uses `mkdtemp`. The example's "SQL stays in the service module" is only half true: `db.ts` holds SQL too. The section must name `db.ts` and `service.ts`, or keep the example wording and note it. Assumption: name both modules, since the section is checked against the code.
- status: the server module map (`tsModules` in `src/server.ts`) lists `render.ts`, `poller.ts`, `theme.ts`; `public/index.html` and `public/client.js` exist. **Contradiction:** `src/poller.ts` imports `./validate.ts` at run time, and `validate.ts` is not in the map. The example says these modules have "no relative runtime imports". The constraint says the rule stays where the code breaks it and fixing code is out of scope. Assumption: keep the rule in the section, do not change code, and mention the poller/validate violation in the PR as a known limit (not in the section, since the section must not contradict the code in a misleading way; planner may add a short "known exception" line only if reviewers want it).
- probe: `sleep` is injected (`check.ts` deps, wired in `main.ts` with `node:timers/promises`). Example holds. Modules: `check.ts`, `client.ts`, `location.ts`, `scheduler.ts`, `main.ts`.
- notify: **Entry point is `src/index.ts`, not `main.ts`**; the shared text says wiring is only in `main.ts`. The shared text stays word for word. The notify section should state that `src/index.ts` is the entry point (wiring point) in place of `main.ts`. Channels live in `src/channels/` (`webhook.ts`, `file.ts`) behind types in `src/types.ts`; tests are in `test/` (with `test/support.ts`), not `src/*.test.ts`. The shared "Tests sit next to the code" rule stays; the section notes where notify's tests are. Check whether "one small interface" is true: channels are config types plus functions; the section should describe what the code has (e.g. channel adapters in `src/channels/`, fake channel in tests via `test/support.ts` if it exists) and verify the "fake channel" claim.
- README: none of the five READMEs mentions `AGENTS.md` yet. Add one line, for example `Contributing: see [AGENTS.md](AGENTS.md).`

## Open points and assumptions

1. The shared text is taken verbatim from the issue, including the `## This repository` heading; the placeholder comment is replaced, not kept.
2. Existing `AGENTS.md` content in each target is replaced entirely (issue says "replaces"). Repo-specific facts worth keeping from the old file go into the repository section only if still true and not contradicting the shared text.
3. `CLAUDE.md` is created or overwritten with the exact text from the issue.
4. Shared text mentions `main.ts`, `scheduler.ts`, `uptime.ts`, `service.quorum.test.ts` as examples only; they need not exist in each repo.
5. Where the code breaks a shared rule (status poller import, notify `index.ts`, tests in `test/` in contract/notify, possible `!` or `any` leftovers), the rule stays and no code changes.
6. CI: no workflow changes. Docs-only PRs must pass `npm run check` (Biome does not check `.md`).
7. Fan-out: five children, no dependencies between them are needed (the contract text does not change). Contract pin is not touched.
8. Agents must not add `.factory/` or note files to targets.

## Acceptance check

In each of contract, probe, api, status, notify:
- `AGENTS.md` from the start to the line before `## This repository` is byte-identical to the shared text (diff against the issue text, and across repos).
- `## This repository` has no placeholder comment; every command, path and module it names exists (`ls`/`grep` against the repo) and it does not contradict the shared text.
- `CLAUDE.md` equals the issue text.
- `README.md` links `AGENTS.md` in one line.
- `git diff --stat` shows only `AGENTS.md`, `CLAUDE.md`, `README.md`; `npm run check` and CI are green.
