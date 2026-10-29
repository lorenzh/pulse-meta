# Issue review: #132 Operator and developer documentation in docs/

Verdict: specifiable. No blocking question. The open points below go into the plan.

## Findings from the clones (main of each target)

- No target has a `docs/` folder yet. README sizes: api 247 lines, status 152, notify 122, probe 107, contract 81, config 46.
- The READMEs already hold most operator facts (settings, tokens, checks file, routes, white label, payload, delivery). The work is to move them into `docs/`, check them against the code, and leave quick starts in the READMEs.
- The single-probe contradiction is wider than the issue lists. The wrong claim appears in:
  - pulse-api README line 73 ("no incident opens" with one probe).
  - pulse-probe README, Settings section (line 45: "declares a check down only when at least two locations report it down") and Docker section (line 77: "needs two locations reporting down before it opens an incident").
  - Maybe also the meta README and pulse-notify README; the plan must grep all READMEs and the Compose comments for "two locations", "quorum", "no incident".
- Code truth (`quorumStatus`, pulse-api `src/state.ts`): one location decides alone; with more than one location, at least two `down` are needed for `down`, otherwise `degraded` if any is degraded, else `up`. The plan must check whether incident opening follows `quorumStatus` exactly (read `service.ts`) before it words the page.
- pulse-contract README line 7 lists three consumers; pulse-notify also depends on it. The meta `AGENTS.md` lists targets without `config`. Check the `.factory/config.yaml` target list and the meta README table as well.
- pulse-config exists as a clone, but it is not a Factory target in the meta `AGENTS.md`. The issue says the four operator repositories get `docs/`; contract and config only "if the plan finds it useful".

## Open points (decide in the plan)

1. **Scope of contract and config.** Assumption: each gets a single short `docs/index.md` developer page only if it adds content not in its README (contract: type reference and how to bump the pin; config: files, updating the pin, CI workflow). Otherwise skip. Decide, and then state it.
2. **Where cross-repo developer docs live.** Architecture, data flow, Factory flow and contributing span all repos. Assumption: the full text lives once in pulse-meta `docs/` (new folder), and each target's `docs/development.md` covers only repo-specific points and links to it. The issue only says "docs/ in each of the four repositories", so a meta `docs/` is an addition; keep it small. Alternative: duplicate nothing and put it in pulse-api. Recommend meta.
3. **Link form.** Relative links must not break. Cross-repo links cannot be relative; use absolute `https://github.com/lorenzh/pulse-<name>/blob/main/docs/...` URLs. "No dead relative links" then applies to within-repo links only. The plan should add a link check step (a script or a command run once) per repository and say which one.
4. **No duplication rule.** READMEs keep a quick start and link to `docs/`. Settings tables, the routes list, the checks file schema, the theme schema and the payload move to `docs/` and are removed from the README. Decide for each README which sections stay (Install/Run/Docker quick start, development one-liner, shared tooling note).
5. **"Commands are run once and work as written."** Docker Compose commands need Docker and github.com access, and image builds come from `main`. The implementer may not have Docker. Assumption: run what the sandbox allows (npm install, test, lint, running the Node processes, curl against a local API with a temp DB). For the Docker commands, check them against `compose.yaml` and the Dockerfiles and note in the PR which commands were not run. The plan must list the commands per page and how each is verified.
6. **Facts without a settings source.** Backup and restore of SQLite, upgrades, token rotation and log format must come from code: DB path and journal mode (`db.ts`: WAL? then backup must handle `-wal`/`-shm` files), migrations at start, retention job behaviour (`retention.ts`), token reload (does the API read tokens at start only?), the log lines in `log.ts`/`main.ts`. If the code lacks a feature (for example hot reload, a migration step, online backup), the docs say what is true (restart needed, copy the file) and invent nothing. Recommended backup method must be one that is tested (for example `sqlite3 .backup` only if the CLI is in the image; otherwise stop and copy).
7. **Reference completeness.** Every route in `api/src/server.ts` (method, path, auth, request, status codes, errors), every env var of api/probe/status/notify, every key in checks, tokens, theme and notify config, and each notify channel (`webhook`, `file`) must appear. Plan: derive the lists from the code, not from the README, and add a "docs vs code" checklist to the plan. Include Compose-only variables (`PULSE_STATUS_PORT`, `PULSE_API_PORT`, `.env.example`) and the `demo` profile.
8. **Troubleshooting.** Take the errors from code (startup errors, 401/403 on results, location mismatch, location longer than 64 characters, missing token exits, unknown check ids, notify ledger errors, status page stale data). Each entry must be an exact message found in the code.
9. **Ownership of facts shared by two pages.** Quorum and incident rules: one home (pulse-api `docs/concepts` or reference). Probe, notify, status and the meta README link to it. Same for the location and token rules between api and probe.
10. **Meta README.** Add a "Documentation" section linking each repo's docs index, and a path from the Compose quick start to configuring a check, a notification and the API reference. Fix the target list in `AGENTS.md` (add `config`) and the contract consumer list. Existing meta README text already has some facts to check (for example "90 days", ports, restart order).
11. **Pin and CI.** Docs-only PRs in the target repos change no code. If a README link check or a Markdown lint is added to CI, it must not weaken the shared pulse-config check. Assumption: no new CI jobs; link check is a one-off command plus a documented command in `docs/development.md` only if it exists in the repo.
12. **Dependencies between children.** The pulse-api docs hold the shared concepts (quorum, tokens, checks), so probe, status and notify docs link to them. The pages can be written in parallel if the target URLs are fixed up front. The plan must fix page names for api (and the shared anchors) in the spec so children link to the right files. Recommend `targets.json` with no `dependsOn`, and the page names listed in the plan. The meta README change belongs to the meta spec PR scope or a `meta` target; check `targets.json` options. The README link edit in pulse-meta is not a Factory target by hand: the plan must say how it lands (a `meta` target or the spec PR).
13. **Docs vs tests rule.** Docs changes need no TDD, but any contradiction found in code (for example a message differing from docs) is fixed in the docs, not the code. Code changes are out of scope.

## Assumptions

- "Plain English, short sentences, Markdown only": no front matter, no generator config, no images needed (ASCII or Mermaid-free text diagrams for the data flow).
- `docs/index.md` is the index in each repo; it links every other page in that repo.
- Page set (proposal for the plan): per operator repo `index.md`, `install.md`, `configuration.md`, `operation.md`, `troubleshooting.md`, `development.md`, plus a reference page: api `rest-api.md`, notify `channels.md`, status `theming.md`. Pages that have no content for a repo (for example probe has no database) are left out or reduced; the index lists what exists.
- Docs describe `main` as of the plan. A plan sees only `main`, so features in flight are not documented.

## Derived acceptance check

1. `docs/index.md` exists in api, probe, status and notify and links every page in its `docs/` folder; a script finds no `docs/*.md` file that the index misses.
2. A relative-link check over every `*.md` in each of the four repositories and in pulse-meta finds no dead link or anchor.
3. Starting at the meta README, a reader reaches the Compose quick start, the page that configures one check (`checks.json`) and one notification (notify config), and the API reference page that lists the endpoint for results and incidents, by links only.
4. Every env var, config key and route in the code (listed by grep of `process.env`, the config parsers and the route table) appears in the docs, and every setting or route in the docs exists in the code. The plan's checklist is the proof.
5. The single-probe case reads the same everywhere and matches `quorumStatus`: a lone location decides alone; the quorum of two applies with more than one location. No README or page says "no incident opens" for one probe. `AGENTS.md` in pulse-meta lists `config`; the pulse-contract README lists api, probe, status and notify as consumers.
6. Each README has a quick start and a link to `docs/`, and no settings table, route list or schema that now lives in `docs/`.
7. Each command in the docs was run (or is marked as not run in the PR where the sandbox cannot) and works as written.
