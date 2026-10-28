# Spec: Developer guidelines in every code repository (#75)

## Goal
Every pulse code repository has the same approved agent guidelines (`AGENTS.md`), a thin `CLAUDE.md`, and a README link.

## Scope
Five targets: contract, probe, api, status, notify. Documentation only.

## Non-goals
- No change to code, tests, configuration, CI, `biome.json`, `tsconfig.json`, or the contract pin.
- No fixing of code that breaks a rule (rule stays).
- No `.factory/`, plan, or note files in a target.
- No edit of the shared text.

## Required behavior (all targets)
1. `AGENTS.md` is replaced entirely. It holds the shared text from the issue ("Shared AGENTS.md text", the content of the fenced block) word for word, from `# AGENTS.md` up to and including the `## This repository` heading. The placeholder HTML comment is removed and replaced by that repository's section. Take the text from the issue body, not from memory; compare with `diff` against a copy and across repos.
2. `CLAUDE.md` is created or overwritten with exactly the issue's CLAUDE.md block.
3. `README.md` gets one line linking `AGENTS.md` for contributors, for example `Contributing: see [AGENTS.md](AGENTS.md).` No other README change.
4. The repository section starts from the issue's example (if any) and is checked against the code: every command, path and module it names exists, and nothing contradicts the shared text. Facts of the old `AGENTS.md` are kept only if still true and not contradicting the shared text.
5. The diff contains only `AGENTS.md`, `CLAUDE.md`, `README.md`. `npm ci && npm run check` passes (Biome does not check `.md`).

## Risks
- Drift of the shared text between repos: mitigated by the byte-compare in the acceptance evidence.
- A section that claims something the code does not do (see per-repository notes, checked against `main`).

## Acceptance evidence (per repository, in the PR)
- Shared text part is identical to the issue text and to the other four repos (`diff` output empty).
- Each path, command and module in the section checked with `ls`/`grep`.
- `git diff --stat` shows only the three files; `npm run check` result; CI green.
- Known limits listed in the PR (not in the section) where code breaks a shared rule.

No dependencies between the five tasks: the shared text does not change the contract, so each target is independent.

## Repository: contract
- Section from the issue's contract example. Checked: `src/index.ts` is the only source (types only); `dist/` is committed; `npm run build` exists; `test/smoke.test.ts` has the "dist matches a fresh build of src" test; `test/types.fixture.ts` exists. There is no `npm start`; the section must not mention it.
- Tests live in `test/`, which differs from the shared "next to the code" rule; the rule stays. The section already says tests live in `test/`.
- Note that `npm run check` also runs `build` (true in `package.json`); this may be added as one line.
- Done: three files changed, `npm run check` green.

## Repository: probe
- Section from the issue's probe example. Checked: `sleep` is injected in `src/check.ts` and `src/client.ts` and wired in `src/main.ts` (`node:timers/promises`); `now` and `setTimeout` injection verified in `src/scheduler.ts` before the section names them, otherwise name only what exists.
- May add a module map: `check.ts`, `client.ts`, `location.ts`, `scheduler.ts`, `main.ts` (all exist). `npm start` exists (`node src/main.ts`).
- Done: three files changed, `npm run check` green.

## Repository: api
- Section from the issue's api example with one correction: SQL lives in `src/db.ts` (schema, migrations, `node:sqlite`) and `src/service.ts` (queries), so name both modules instead of "the service module". Rows are mapped to contract types in `service.ts`; verify before writing.
- Tests use a `mkdtemp` directory (verify in `src/service.test.ts`); `main.ts` defaults `PULSE_DB=./pulse.db`, `PULSE_CHECKS_FILE=./checks.json`; `checks.example.json` exists; `npm start` exists.
- Done: three files changed, `npm run check` green.

## Repository: status
- Section from the issue's status example. Checked: `tsModules` in `src/server.ts` lists `render.ts`, `poller.ts`, `theme.ts`; `public/index.html` and `public/client.js` exist.
- Known violation: `src/poller.ts` imports `./validate.ts` at run time and `validate.ts` is not in the module map. The rule stays in the section and no code changes. The implementer states this limit in the PR; the section may carry one short "known exception" line, as long as it does not weaken the rule.
- Done: three files changed, `npm run check` green.

## Repository: notify
- No example fits fully; the section is written from the code. Facts to verify and state: entry point and wiring is `src/index.ts` (not `main.ts`; `npm start` runs `node src/index.ts`); channels are sender functions in `src/channels/` (`webhook.ts`, `file.ts`) created by `createWebhookSender` / `createFileSender` and wired in `src/notifier.ts`; channel config types are in `src/types.ts`; delivery takes an injected `send`, `sleep`, `ledger` (`src/delivery.ts`).
- Tests live in `test/` with helpers in `test/support.ts` (which has a fake API server, not a fake channel). Do not claim "one small interface" or a fake channel unless the code has it; instead say tests use fake senders or a local server on `127.0.0.1`, never a real webhook or mail server, after checking the tests.
- The shared "Tests sit next to the code" and "`main.ts`" rules stay; the section only notes notify's layout.
- Done: three files changed, `npm run check` green.
