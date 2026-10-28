# Spec: READMEs for every pulse repository

## Goal
Someone who finds any pulse repository understands what pulse is, what that repository does, and how to run it, without reading code.

## Scope
A README.md in each of meta, contract, probe, api, status.

## Non-goals
Code, config, lockfile or `dist/` changes. License or maintenance sections. New files other than README.md (the example checks file is inlined in the meta README).

## Required behavior
Common to all five READMEs:
- Opening lines: pulse is an uptime monitor with a status page; this repository's part; which pulse repositories it depends on (links to https://github.com/lorenzh/pulse-<name>).
- This exact sentence: `pulse is built by Paragon Factory agents from the issues in [pulse-meta](https://github.com/lorenzh/pulse-meta).` (the meta README uses the equivalent "pulse is built by Paragon Factory agents from the issues in this repository.").
- Keep the existing accurate content (behavior, state rules); remove duplication (probe repeats its first sentence). Keep the "Part of pulse" line or fold it into the opening.
- Service READMEs (api, probe, status): install `npm ci`, test `npm run check`, run `npm start`, and a settings table matching the `process.env` reads exactly:
  - api: `PORT` 3000, `PULSE_DB` `./pulse.db`, `PULSE_CHECKS_FILE` `./checks.json`
  - probe: `PULSE_API_URL` `http://localhost:3000`
  - status: `PORT` 8080, `PULSE_API_URL` `http://localhost:3000`, `POLL_MS` 5000
- contract: install `npm ci`, test `npm run check`; no run step (library); settings: none.
- Node >= 24 stated for services.

## Risks
- Documenting something the code does not do. Mitigation: each implementer checks every command, setting, field, route and status code against `src/` and `package.json` before writing it.
- Accidental non-README changes. Mitigation: `git diff --stat` shows only README.md.

## Acceptance evidence
- `git diff --stat` in each repository lists only `README.md`; `npm run check` still passes.
- Grep of every README for env-style names finds only names present in the code.
- Following only the meta README, a person starts api, probe and status locally and sees the check on http://localhost:8080.

## Meta README (written in this spec run, not a child task)
Not a child task. `README.md` was written in this repository with: product overview, repository table with links and roles, local run steps (clone, `npm ci`, inline example `checks.json` identical to `api/checks.example.json`, start api, probe, status, a `node -e` listener on port 9000, open :8080, expected states), settings table, the Factory statement, and the issue-to-PR flow derived from `.factory/config.yaml`. Reviewers verify it against the code.

## Repository: contract
Files: `README.md` only (never touch `src/` or `dist/`).
Behavior: add the common intro (depends on nothing; consumed by probe, api, status). Keep Usage and the `dist/` explanation. Development: `npm ci`, `npm run check` (build, typecheck, tests). State "no settings, no run step; types only". Add Factory statement.
Completion evidence: README diff only; every type name listed exists in `src/`.

## Repository: probe
Files: `README.md` only.
Behavior: common intro (depends on contract at build, talks to pulse-api at run time: `GET /checks`, `POST /results`). Remove the duplicated sentence. Install `npm ci`, test `npm run check`, run `npm start`. Settings table with `PULSE_API_URL`. Check `src/` for the 5000 ms default timeout, redirect behavior and down reasons before keeping those claims. Factory statement.
Completion evidence: README diff only; claims match `src/`.

## Repository: api
Files: `README.md` only.
Behavior: common intro (depends on contract; consumed by probe and status). Install, test, run steps; settings table (three variables); checks file format and the fields of `Check` as validated in `src/` (verify `timeoutMs` optional and its default meaning); state rules verified against `src/state.ts`/`service.ts`. Routes section lists, verified against `src/server.ts`: `POST /results` (204, 400, 404), `GET /checks`, `GET /checks/:id/results?limit=N` (default 100, max 1000, newest first, 404), `GET /incidents?status=open|resolved` (400 on bad status, ordering), plus 405 for other methods on known paths, 404 for unknown paths, 413 for bodies over 1,000,000 bytes, and the `{"error": ...}` shape. Mention `node:sqlite` warning. Factory statement.
Completion evidence: README diff only; each route and code matches `server.ts`.

## Repository: status
Files: `README.md` only.
Behavior: common intro (depends on contract; reads pulse-api at run time via `/api/*` proxy, which must be running). Install `npm ci` (add it to Development too), test `npm run check`, run `npm start`; settings table (three variables). Keep description of the page; verify the error banner and refresh claims in `src/`. Factory statement.
Completion evidence: README diff only; settings equal the `process.env` reads.
