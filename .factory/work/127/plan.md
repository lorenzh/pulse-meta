# Spec #127: pulse-api CI workflow is invalid and runs no jobs

## Goal
Make `.github/workflows/ci.yml` in pulse-api valid YAML again so that both jobs (`check`, `docker`) run on pushes to `main` and on pull requests.

## Scope
- One step in `api/.github/workflows/ci.yml` (line 32, step "Status port override").

## Non-goals
- No change to behavior, triggers, jobs, steps, action pins or the reusable workflow pin.
- No new CI step or test for workflow validity.
- No change in `contract`, `probe`, `status`, `notify`: their workflow files were parsed and have no plain-scalar `run:` value containing `: ` (see issue review). `config` is not a target and is also fine.

## Required behavior
- The step "Status port override" uses a block scalar:

  ```yaml
  - name: Status port override
    run: |
      PULSE_STATUS_PORT=8090 docker compose config | grep 'published: "8090"'
  ```
  The command text stays byte-identical.
- The file parses; jobs are exactly `check` and `docker`; triggers are `push` on `main` and `pull_request`; all other steps are unchanged.

## Risks
- If `grep 'published: "8090"'` fails at runtime on the real compose output, the implementer reports it and does not change the behavior.
- `actionlint` may be unavailable; a strict YAML parse is accepted.

## Acceptance evidence
- Local validation output for the changed file (`actionlint` if available, otherwise a YAML parse listing jobs `check` and `docker`).
- The pulse-api PR shows both jobs running and green; the run on `main` after merge is green.

## Repository: api
- File: `.github/workflows/ci.yml` only.
- Change: convert the `run:` of "Status port override" to a `run: |` block scalar as above.
- Checks: parse the YAML with a strict parser (and `actionlint` if installed); confirm jobs `check`, `docker`, the triggers, and a diff limited to that step.
- Completion evidence: validation output in the PR description; PR checks show `check` and `docker` green.
