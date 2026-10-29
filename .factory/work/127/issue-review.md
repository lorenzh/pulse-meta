# Issue review #127

## Findings (checked in the clones)
- `api/.github/workflows/ci.yml` line 32: `run: PULSE_STATUS_PORT=8090 docker compose config | grep 'published: "8090"'` is the only invalid workflow. A YAML parse (PyYAML) fails there.
- All other workflow files parse: `contract`, `probe`, `notify`, `status` (`ci.yml`), and `config` (`ci.yml`, `check.yml`).
- A grep for other plain-scalar `run:` values containing `: ` found no further hit.
- `api` ci.yml has the jobs `check` (reusable workflow from pulse-config, pinned by SHA) and `docker`. Triggers are already `push` to `main` and `pull_request`.

## Open points (none blocks the spec)
- Only target is `api`; one single-file change. The `config` repo is not a Factory target (targets: contract, probe, api, status, notify); the check found no problem there, so no change is needed.
- The "Done when" part about the run on `main` passing depends on the `docker` steps being valid at runtime. This is not verifiable from here; if the `Status port override` grep fails on the real compose output, the implementer must report it and not change the behaviour.
- `actionlint` may not be installed; parsing the YAML is accepted by the issue as alternative. Parse with a strict parser and also check that the job names are `check` and `docker`.

## Assumptions
- Fix: change that step to `run: |` followed by the unchanged command on its own line (or quote it). The command text stays byte-identical.
- The `check` job's `uses:` pin stays unchanged (constraint: no other behaviour change).
- The other repos need no change; the spec should say so, with the validation evidence.

## Acceptance check
- `ci.yml` in pulse-api parses as YAML (and passes `actionlint` if available), with the jobs `check` and `docker` and the same steps as before.
- The step `Status port override` runs the same command.
- The PR in pulse-api shows both jobs `check` and `docker` running and green; the run on `main` after the merge is green.
