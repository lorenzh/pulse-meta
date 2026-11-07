---
name: adding-factory-targets
description: Registers a new lorenzh/pulse-<name> repository as a Paragon Factory target in pulse-meta. Use when the user asks to create a new pulse repository and add it to the meta repo, to add or register a Factory target, or says "neues Repo anlegen und im meta Repo hinzufügen". Use also when a feature issue needs a target that does not exist yet.
---

# Adding Factory targets

Create the repository, put the new target into every target list of pulse-meta in one pull request, and keep the feature work waiting until that pull request is merged.

**A plan sees only the targets on `main`: never start a spec run for the new target before the target pull request is merged.**

Scope: this skill writes no product code in the new repository. The Factory builds it from a feature issue.

## 1. Create the repository

Before you create it, confirm the name `pulse-<name>`, its stack and a one-line description with the user.
Run `gh repo create lorenzh/pulse-<name> --public --license mit --add-readme --description "pulse: <role>"`.
Done when `gh api repos/lorenzh/pulse-<name> -q '.default_branch,.license.spdx_id'` prints `main` and `MIT`.

## 2. Branch and add the target

Create a branch from `origin/main` named `chore/add-<name>-target`. Never use `factory/*`: those names belong to Factory runs.
In `.factory/config.yaml`, copy the newest target block and change `url`, `repository` and `context`.
`context` is always `meta`, plus `contract` if it uses the wire contract, `api` if it calls the API, and `config`/`kit` only for TypeScript repositories.
Add the new name to the `context` of `meta`, `website`, and every target that builds on or deploys it (for example `deploy`).
Done when `npx factory validate` prints `Valid` (needs `npm ci` with `GITHUB_PACKAGES_TOKEN`).

## 3. Update every list of all targets

Find the lists with `grep -rnE "<last-target>" .github report AGENTS.md README.md docs .github/audits/architecture.md`, where `<last-target>` is the current last target name.
Update these places:
- `.github/audits/open-issue.sh`: `security` and `quality` lists always; `performance` only for a service with runtime budgets (not for config, deploy, or non-TypeScript repositories).
- `.github/workflows/factory-audit.yml`: the target `options`.
- `report/data.mjs`: `TARGETS`.
- `AGENTS.md` targets line, `.github/audits/architecture.md` repository list.
- `README.md` repository table and `docs/architecture.md` table: one row, marked "planned, no code yet".
Done when the grep shows the new name in each of these files.

## 4. Fix the rotation tests

`.github/workflow-tests/test.sh` pins the audit rotation to dates. With N entries, security picks `day % N` and quality picks `((day + 3) / 7) % N`, where `day` is days since 1970-01-01.
Pick a security date where the new target is index N-1, and the next day for `contract`: `python3 -c "import datetime as d;x=d.date(2026,11,10);print((x-d.date(1970,1,1)).days % N)"`.
Move the label fixture: the existing-label loop gains the previous newest target; the new target's label is the one the first run creates.
Recompute the quality expectations and their comments with the same formula.
Done when `bash .github/workflow-tests/test.sh` shows no rotation `FAIL`.

## 5. Run all checks and compare with main

Run `npx factory validate`, `node --test 'report/*.test.mjs'` and `bash .github/workflow-tests/test.sh`.
If a test still fails, run it again with your change undone. If it also fails on `main`, report it as pre-existing; do not fix it in this pull request.
Done when every failure is fixed or named as pre-existing with evidence.

## 6. Open the pull request and hold the feature

Commit as `Factory: add pulse-<name> target`, push, and open a pull request with the files changed and the check results.
If a feature issue for the new target exists or is written now, comment that its spec run starts only after this pull request is merged.
Never merge the pull request yourself; the user merges.
Done when the pull request URL exists and the feature issue carries the wait comment.

## Example

Input: "Lege das Repo pulse-agent an (Rust) und füge es im meta Repo hinzu."
Action: repository with LICENSE and README; target `agent` with context `meta, contract, api`; security and quality rotation only; test dates moved to 2026-11-10 (agent) and 2026-11-11 (contract).
Result: one pull request with 9 changed files, `factory validate` valid, and the feature issue waiting on its merge.
