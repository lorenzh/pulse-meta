# Spec: Operator and developer documentation in `docs/` for every repository (#132)

## Goal

Someone who hosts pulse or works on it finds the facts in one place per repository. Each operator repository gets a `docs/` folder. The READMEs keep a short quick start and link to it. The meta README is the entry point.

## Scope

- `docs/` in pulse-api, pulse-probe, pulse-status and pulse-notify (full operator and developer docs).
- pulse-contract: fix the consumer list in its README and add one short `docs/index.md` developer page (type reference and how to bump the pin). It adds content that the README does not hold.
- pulse-config: no change. Its README (46 lines) already covers files, pin update and the CI workflow, so a docs page adds nothing.
- pulse-meta (not a Factory target, see "Meta changes"): `docs/` with the cross-repo developer pages, a "Documentation" section in the README, `AGENTS.md` fix.

## Non-goals

- No code change in any repository. If the code and a doc disagree, the doc is fixed, never the code.
- No docs-site generator, no front matter, no images, no new CI jobs.
- No documentation of features in flight; the docs describe `main` as read by this plan.

## Required behavior

### Rules for every page

- Plain English, short sentences, Markdown only.
- Every fact is checked against the code on `main`. Derive lists from code (`process.env`, config parsers, route table, channel registry), not from the README.
- Every setting, config key, route and channel in the code appears in the docs. The docs name nothing that the code lacks.
- Details move into `docs/` and leave the README. A README keeps: one-paragraph description, quick start (install, run, Docker where the repo has a Dockerfile/Compose), a one-line development note, and links to `docs/index.md`. No settings table, route list, schema or payload stays in a README.
- Cross-repo links use absolute URLs: `https://github.com/lorenzh/pulse-<name>/blob/main/docs/<page>.md`. Links inside a repository are relative and must resolve (files and anchors).
- Each `docs/index.md` links every other file in its `docs/` folder with one line each.
- Commands are run once in the sandbox (npm install, test, lint, start the Node processes, `curl` against a local API with a temp DB). Docker commands are checked against `compose.yaml` and the Dockerfiles; the PR description lists every command that was not run and why.
- Missing features are stated as they are (for example "tokens are read at start; restart to rotate", "copy the file with the API stopped"). Invent nothing. Recommend a backup method only if it was tested.

### Single-probe and quorum (one wording everywhere)

Read from `quorumStatus` (`api/src/state.ts`) and `service.ts` (verified by this plan: the combined status of the window feeds `applyResult`, so incident opening follows `quorumStatus` exactly):

- Each location counts by its latest result in the window `[T - 2 * intervalMs, T]`.
- With one location in the window, it decides alone. A single probe can open an incident.
- With two or more locations in the window, the combined status is `down` only when at least two are down; otherwise `degraded` if any is degraded; else `up`.
- The third consecutive `down` evaluation opens an incident; an `up` or `degraded` evaluation resolves it.
- "Locations in the window" are those that sent a result in the window, not those configured in `tokens.json`. State this plainly on the page.

Remove these wrong claims: pulse-api README line 73 ("no incident opens" with one probe); pulse-probe README Settings (line 45, "at least two locations") and Docker (line 77, "needs two locations"); the meta README line in the npm walkthrough ("with two or more locations, a check is down only when…" is correct but make it match). Grep all READMEs, Compose comments, `compose/*` files and docs for "two locations", "quorum", "no incident", "at least two" and fix every hit. The one home for the rule is `docs/concepts.md` in pulse-api; all other pages link to it.

### Fixed page names (so the children can link before the others merge)

**pulse-api** `docs/`:
- `index.md`
- `install.md` (npm and Docker Compose, `.env`, ports, demo profile)
- `concepts.md` (check states, quorum and incident rules, locations, tokens model, retention, maintenance windows). Anchors that others link to: `#quorum-and-incidents`, `#locations-and-tokens`.
- `configuration.md` (every env var, `checks.json` schema, `tokens.json` schema, Compose variables `PULSE_STATUS_PORT`, `PULSE_API_PORT`, `.env.example`)
- `rest-api.md` (every endpoint)
- `operation.md` (upgrades, backup and restore, retention, token rotation, logs)
- `troubleshooting.md`
- `development.md`

**pulse-probe** `docs/`: `index.md`, `install.md`, `configuration.md`, `operation.md`, `troubleshooting.md`, `development.md`.

**pulse-status** `docs/`: `index.md`, `install.md`, `configuration.md`, `theming.md` (theme file schema, white-label options, palette), `operation.md`, `troubleshooting.md`, `development.md`.

**pulse-notify** `docs/`: `index.md`, `install.md`, `configuration.md`, `channels.md` (`webhook`, `file`, payload, delivery and retry), `operation.md`, `troubleshooting.md`, `development.md`.

**pulse-contract** `docs/`: `index.md`.

**pulse-meta** `docs/`: `index.md`, `architecture.md`, `factory.md` (the full cross-repo developer text: architecture, data flow, roles of pulse-contract and pulse-config, contributing, spec → PR per repo).

Pages with no content for a repository may be reduced, but the names above are fixed and linked from the index. A repo's `development.md` holds only repo-specific points: local run, test commands, TDD/e2e rules from its `AGENTS.md`, lint (Biome, ESLint), Lefthook, CI (the shared `check.yml` of pulse-config), and links to the meta `architecture.md` and `factory.md`.

### Content per topic (derive from code)

- **Install/run**: npm (`npm ci`, `npm start`, Node 24+) and Docker per repo; Compose quick start with the `demo` profile in pulse-api.
- **Configuration**: every env var with default and example. Known from `main`: api `PORT`, `PULSE_DB`, `PULSE_CHECKS_FILE`, `PULSE_TOKENS_FILE`, `PULSE_RETENTION_DAYS`; probe `PULSE_API_URL`, `PULSE_LOCATION`, `PULSE_PROBE_TOKEN`; status `PORT`, `PULSE_API_URL`, `POLL_MS`, `PULSE_STATUS_THEME`, `PULSE_STATUS_NAME`, `PULSE_STATUS_LOGO`; notify variables read in `main()` of `src/index.ts` (`PULSE_NOTIFY_CONFIG`, `PULSE_API_URL`, `PULSE_NOTIFY_STATE`, `PULSE_NOTIFY_POLL_MS`, `PULSE_NOTIFY_RETRY_DELAY_MS`, `PULSE_NOTIFY_TIMEOUT_MS`). The implementer re-greps; the code wins. Also checks file keys (HTTP and TLS checks, maintenance), tokens file keys, theme file keys, notify config keys.
- **Operation**: DB path and mode as in `db.ts` (the implementer reads whether WAL files exist; if there are `-wal`/`-shm` files, backup and restore say so); schema migrations at start (`db.ts` column checks); retention job (`retention.ts`); tokens read at start (confirm in `tokens.ts`/`main.ts`); log lines from `main.ts`, `log.ts` and the notify `log.ts`; notify ledger/state file; checks read once at start by api and probe (restart order: api, then probe).
- **Troubleshooting**: each entry quotes an exact message found in the code (startup errors, 401/403 on `POST /results`, location mismatch, location longer than 64 characters, missing probe token exit, unknown check id, notify config errors, ledger errors, stale status page). Give cause and action.
- **REST reference** (api): every route in `server.ts` (`/results`, `/checks`, `/uptime`, `/incidents`, `/maintenance` and any others the implementer finds), with method, auth, query parameters, request body, response shape (name the pulse-contract type), status codes and error bodies, and a tested `curl` example for results, checks and incidents.
- **Channels** (notify): `webhook` and `file` with all keys, the payload, event types, retry and timeout.
- **Theming** (status): all theme keys, settings, palette rules, and a working white-label example.

## Meta changes (pulse-meta)

pulse-meta is not a Factory target, so these land in the spec PR (this branch), written by this plan run:
- `docs/index.md`, `docs/architecture.md`, `docs/factory.md`.
- README: "Documentation" section linking each repository's `docs/index.md` and a path from the Compose quick start to configuring a check, a notification and the API reference.
- `AGENTS.md`: add `config` to the target list.
- README npm walkthrough: single-probe sentence aligned with the quorum rule.
Links to pages in other repositories resolve once their PRs merge.

## Repository sections

Children are independent. The fixed page names and anchors above replace a dependency. No `dependsOn`.

## Risks

- Cross-repo links are dead until all PRs merge. Mitigation: names fixed in this spec.
- Docs drift from code. Mitigation: the checklist below.
- No Docker in the sandbox. Mitigation: list unrun commands in the PR.
- The shared rule (quorum) is written in api only; other repos link to it, so a wording change happens once.

## Acceptance evidence

Each child PR includes:
1. A script output (a one-off command, not committed unless the repo already has a place for it) showing that every `docs/*.md` is linked from `docs/index.md`.
2. A relative-link and anchor check over all `*.md` in the repository: no dead link.
3. A "docs vs code" checklist in the PR: env vars (`grep process.env`), config parser keys, routes/channels, each marked present in docs; and the reverse (docs → code).
4. A list of the commands run and the ones not run.
5. README: quick start plus `docs/` link; no settings table, route list or schema left.
6. Grep for "two locations", "no incident", "at least two", "quorum" shows only text consistent with the rule above.

Overall: from the meta README a reader reaches the Compose quick start, `checks.json` configuration, notify configuration, and the `rest-api.md` endpoint for results and incidents by links only; and the pulse-contract README lists api, probe, status and notify as consumers.

## Repository: api

Files: `docs/*.md` (names above), `README.md`, any `compose/*` comments or `compose.yaml` comments that repeat the wrong single-probe claim (comment fixes only).
- Write all pages including `concepts.md` (single home of quorum/incident/locations/tokens rules) and `rest-api.md`.
- Move the README sections (settings, routes, schemas, demo detail, evaluation text at line 227) into `docs/`; keep install/Compose quick start and link.
- Fix README line 73.
- Check: link check, docs-vs-code checklist, `npm test` and `npm run lint` unchanged and green; `curl` examples run against a local API with a temp DB.
- Done when: the acceptance evidence above is in the PR.

## Repository: probe

Files: `docs/*.md`, `README.md`.
- Pages as listed. Probe has no database; `operation.md` covers logs, restart after checks change, token and location changes.
- Fix README lines 45 and 77; link to api `concepts.md#quorum-and-incidents` and `#locations-and-tokens`.
- Check: link check, checklist (env vars, location rules in `location.ts`, token rules in `token.ts`, check types in `check.ts`, retry/scheduler behavior), tests and lint green.
- Done when: acceptance evidence is in the PR.

## Repository: status

Files: `docs/*.md`, `README.md`.
- Include `theming.md` with every theme key from `theme-config.ts`/`validate.ts`, the white-label settings, and the proxy `/api/*` behavior from `server.ts`.
- Move the README White-label section into `docs/`; keep the quick start.
- Check: link check, checklist, start the server against a local API and fetch the page with a theme to prove the example, tests and lint green.
- Done when: acceptance evidence is in the PR.

## Repository: notify

Files: `docs/*.md`, `README.md`.
- Include `channels.md` (every channel, keys, payload, delivery, retries, timeouts) and `operation.md` (state file/ledger, restart behavior, logs).
- Move README configuration and payload sections into `docs/`.
- Check: link check, checklist (env vars in `src/index.ts`, config keys in `config.ts`, `channels/`), run notify against a local API with the `file` channel, tests and lint green.
- Done when: acceptance evidence is in the PR.

## Repository: contract

Files: `README.md`, `docs/index.md`.
- README: list api, probe, status and notify as consumers; link to `docs/index.md`.
- `docs/index.md`: type reference (every exported type in `src`, one line each, derived from the code), how to bump the pin in a consumer, and links to the meta `architecture.md`. Single page, no other file.
- Check: link check, every exported type listed, `npm test` and lint green.
- Done when: README consumer list is correct and the index page exists.
