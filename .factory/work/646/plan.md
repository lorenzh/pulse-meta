# Spec #646: deploy E2E binds the header secret to its host

Source: issue #646, found while checking pulse-probe PR #52 (#645). Issue review: `.factory/work/646/issue-review.md`. It has no blocking question. Its five open points are settled below.

## Goal

The Compose E2E of pulse-deploy (`bash e2e/compose-e2e.sh`) passes with the pinned probe `0.1.0` and with a probe image built from probe `main`. Both runs keep every existing leak check. To get there, the E2E overlay binds the env header variable `PULSE_HEADER_SVC_TOKEN` to the host `e2e-target` through `PULSE_PROBE_HEADER_HOSTS` in the probe environment.

## Scope

- deploy only: one environment entry (plus a short comment) in the `probe` service of `e2e/compose.e2e.yaml`.

## Non-goals

- No change to probe, api or any other service. No new dependency, image, action or tool.
- No pin change: `common/services.yaml` keeps `ghcr.io/lorenzh/pulse-probe:0.1.0@sha256:c5cb30ec…` (`.repos/deploy/common/services.yaml:16`). The probe `main` run uses a temporary local substitution that is never committed (see the deploy section).
- No change to `e2e/compose-e2e.sh`, its timeouts, its assertions or `assert_absent`. No change to `e2e/ro/checks.json` or `e2e/target.mjs`.
- No new CI job or matrix. No second compose file or override file (`scripts/check-setup.sh` rule 11 forbids it).
- No change to the user setups (`minimal`, `full`, `demo`, `dev`) or to `docs/cli.md:177` (header secrets in `compose.override.yaml`). Operator docs for `PULSE_PROBE_HEADER_HOSTS` belong to the pin bump that moves the probe past `0.1.0`, not to this fix.

## Current behavior

deploy `main` at `d4fa0eeb4ff2639e17248d813046ac9e5968cf39`, probe `main` at `89f12324a6e77d5a716beacc22e178b8e1112284`. probe `v0.1.0` is commit `50ec9cabe8aebe6164eff6cf2272b0a6c6c86605`, read with `gh api`.

- `e2e/compose.e2e.yaml:37-44`: the `probe` service sets only `PULSE_HEADER_SVC_TOKEN: Bearer ${E2E_SVC_TOKEN:-e2e-svc-token-sentinel}` and `depends_on: e2e-target`. It does not set `PULSE_PROBE_HEADER_HOSTS`.
- `e2e/ro/checks.json`: check `e2e-post` POSTs to `http://e2e-target:8000/svc` with header `Authorization: {"env": "PULSE_HEADER_SVC_TOKEN"}`. No other check in `e2e/`, `full/`, `demo/`, `dev/` or `minimal/` uses an `env` header (`grep -rn '"env"'` finds only this one).
- probe `main`:
  - `src/header-hosts.ts:63-64`: `PULSE_PROBE_HEADER_HOSTS` unset or empty gives an empty policy.
  - `src/header-hosts.ts:25-40`: a host entry with a scheme, port, path, `@`, `*`, `%` or whitespace is rejected. A rejected entry is a `StartupError`, so the probe exits 2 (`docs/configuration.md:20`).
  - `src/client.ts:156-161`: an unbound reference becomes a denial `header <name> env <VAR> is not bound to host "<host>"`. The request is not sent and the check is `down`.
  - `src/main.ts:129`: at start the probe logs `header host bindings for <n> variable(s)`. It logs the count only.
  - `docs/configuration.md:207`: matching is an exact host match, on any port and on both `http:` and `https:`.
- probe `v0.1.0`: `src/settings.ts`, `src/main.ts` and `src/client.ts` never read `PULSE_PROBE_HEADER_HOSTS`. The settings read named keys only, and there is no scan for unknown variables. `src/client.ts` resolves only `PULSE_HEADER_*` names. The variable is therefore ignored, and `src/main.ts` has no `header host bindings` log line.
- `e2e/compose-e2e.sh`:
  - `:11`, `:14`: the script fixes `COMPOSE_PROJECT_NAME=pulse-e2e` and `COMPOSE_FILE=full/compose.yaml:e2e/compose.e2e.yaml`. A `COMPOSE_FILE` set from outside cannot change the image.
  - `:307-308`: it rejects any service with a `build` key.
  - `:320`: it starts with `docker compose up -d --pull missing`.
  - `:21`: `T_FIRST_RESULT` defaults to 90 s.
  - `:397`: `wait_for "$T_FIRST_RESULT" "e2e-post is up"`.
  - `:415-422`: failure modes and recovery.
  - `:375-381`: `assert_absent` fails on the token value, `e2e-body-sentinel` or the literal `PULSE_HEADER_SVC_TOKEN`.
  - `:423-426`: `assert_absent` runs on `GET /checks`, `GET /metrics`, the status proxy `/api/checks` and `docker compose logs`. It runs again on `/metrics` at `:544`.
  - `:680`: the run ends with `All checks passed`.
  - `:78`: the trap runs `down -v`.

With the probe `main` image the binding is missing, so `e2e-post` stays `down` with the denial reason and `:397` times out after 90 s. That reason also contains `PULSE_HEADER_SVC_TOKEN`, which `assert_absent` would reject on `GET /checks`.

## Required behavior

- `e2e/compose.e2e.yaml`, service `probe`, `environment` gets one new key next to `PULSE_HEADER_SVC_TOKEN`:
  ```yaml
  PULSE_PROBE_HEADER_HOSTS: '{"PULSE_HEADER_SVC_TOKEN":["e2e-target"]}'
  ```
  - The value is a single-quoted YAML string, so Compose passes it as the JSON text.
  - The host is the bare service name `e2e-target`: no scheme, no `:8000`, no path.
  - The text has no `$`, so Compose interpolation leaves it unchanged.
  - Add a short English comment above it, in the style of the file. It says that probe `main` sends an env header only to a bound host, that older probes ignore the variable, and that the value names the variable and host only, never the secret.
- Everything else in the file stays byte-identical, including the existing `PULSE_HEADER_SVC_TOKEN` line, `depends_on` and the `e2e-target` service.
- Rendered result: `docker compose -f full/compose.yaml -f e2e/compose.e2e.yaml config --format json` gives `.services.probe.environment.PULSE_PROBE_HEADER_HOSTS` as a string whose parsed JSON equals `{"PULSE_HEADER_SVC_TOKEN":["e2e-target"]}`.

## Risks

- **Wrong value shape.** An unquoted YAML flow mapping would give Compose a mapping, not a string, and Compose rejects it. `e2e-target:8000` or `http://e2e-target` makes probe `main` exit 2 at start. A misspelled host or variable gives a denial, and `e2e-post` stays down. The static render check below catches the first case. The probe `main` run catches the rest.
- **The second run uses the old image by mistake.** The script overwrites `COMPOSE_FILE` and pulls only missing images, so the only way to select another probe image is the image line in `common/services.yaml`. The implementer records the image ID and the start log line `header host bindings for 1 variable(s)`. That line exists only in probe `main` (absent in `v0.1.0`).
- **The temporary substitution leaks into the PR.** The image line is restored before the commit. `git diff --exit-code -- common/services.yaml` and `scripts/check-setup.sh` (rule 2: digest pin) prove it.
- **Another incompatibility between probe `main` and the `0.1.0` stack.** One example would be a probe/api contract change since `0.1.0`. If such a mismatch breaks the second run at a step other than the header binding, the implementer requests a hold with `needs-input`. The hold names the failing step and both image identities. Do not edit other services, timeouts or assertions to get a pass.

## Acceptance evidence

1. The diff of the deploy PR touches only `e2e/compose.e2e.yaml`. It adds the `PULSE_PROBE_HEADER_HOSTS` line and its comment. `git diff --exit-code origin/main -- common e2e/compose-e2e.sh e2e/ro e2e/target.mjs full` passes.
2. Static render, with the expected value as a literal in the command:
   ```sh
   docker compose -f full/compose.yaml -f e2e/compose.e2e.yaml config --format json |
     jq -e '.services.probe.environment.PULSE_PROBE_HEADER_HOSTS | fromjson == {"PULSE_HEADER_SVC_TOKEN":["e2e-target"]}'
   ```
   It prints `true` and exits 0.
3. Run A, the pinned probe: `bash e2e/compose-e2e.sh` with `common/services.yaml` unchanged. It exits 0 and its output contains `==> All checks passed` (literal from `e2e/compose-e2e.sh:680`). It also contains the lines `ok: <surface> shows no secret` for `GET /checks`, `GET /metrics`, `the status page proxy` and `the container logs` (literals from `:380`, `:423-426`).
4. Run B, probe `main`. Build an image from probe `main` and select it with the temporary substitution in the deploy section. Then run `bash e2e/compose-e2e.sh` with no other change.
   - It exits 0 with the same `==> All checks passed` and the same four `shows no secret` lines.
   - While the stack runs, `docker compose -p pulse-e2e logs probe` contains `header host bindings for 1 variable(s)`. The count `1` comes from this spec: one key in the binding. `docker inspect` of the probe container shows the image ID of the local build.
   - The PR reports the probe commit SHA, the local tag and the image ID.
5. After the substitution is restored: `git diff --exit-code -- common/services.yaml` passes, `scripts/check-setup.sh` passes, and `bash scripts/check-setup.test.sh` passes.
6. Optional negative control, recommended: Run B without the new line (for example on `main` of deploy) fails at `e2e-post is up` after 90 s, and the probe logs `header host bindings for 0 variable(s)`. This shows that the binding is what makes Run B pass.

## Performance impact

None expected. The change adds one environment variable to a test-only Compose overlay of the deploy repository. It does not change api code, the api image or the api bench (`.repos/api/bench/budgets.json`: `startup_cpu_ms`, `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`, `test_cpu_s` and the reported ones). Nothing needs to be measured.

## Security impact

Security impact: yes. The change sets the probe's host policy for env headers, which controls where the probe HTTP client sends a header secret, and it is a CI-tested fixture.

Checklist items that apply:
- **Secrets in errors, logs and responses.**
  - The binding holds a variable name and a host, never the secret value.
  - The probe logs only the count (`src/main.ts:129`). Its parse errors never echo the value (`src/header-hosts.ts:15`).
  - The existing `assert_absent` keeps checking the token value, the body sentinel and the variable name on `GET /checks`, `GET /metrics`, the status proxy and the container logs, in both runs.
- **SSRF and redirects (header scope).**
  - The binding is the narrowest that works: one variable, one exact host (`e2e-target`), no wildcard or extra hosts.
  - Same-origin redirect rules for checks with headers stay as they are (probe `docs/configuration.md:105`).
- **Dependency pins.** No image, action or package changes. The probe `main` image is used only locally and is never committed.

The security state should try hostile variants of the binding, for example:
- an extra host;
- `e2e-target:8000` or `http://e2e-target/`;
- `*.e2e-target`;
- a second variable;
- the token value as a key.

It confirms that the committed line is exactly the one in Required behavior.

## Rollout order

One repository: only deploy changes. Probe `main` already has host bindings (merged with probe PR #52, #645). The pinned probe `0.1.0` ignores the variable, as shown in Current behavior and by Run A. So the merge is safe before and after a later pin bump of the probe. No consumer of contract, kit or config is affected.

## Counterexamples

| Input or case | Required result | A wrong implementation would |
| --- | --- | --- |
| `PULSE_PROBE_HEADER_HOSTS: {"PULSE_HEADER_SVC_TOKEN":["e2e-target"]}` unquoted | not used: Compose sees a YAML mapping and rejects it, so check 2 fails | appear correct in a diff review |
| `'{"PULSE_HEADER_SVC_TOKEN":["e2e-target:8000"]}'` | rejected: probe `main` exits 2 (`must be a host name or IP address without scheme, port or path`), so Run B fails | pass Run A only |
| `'{"PULSE_HEADER_SVC_TOKEN":["http://e2e-target"]}'` | rejected as above | pass Run A only |
| `'{"PULSE_HEADER_SVC_TOKEN":["e2e-target","example.com"]}'` | rejected by review: the spec requires exactly one host; check 2 compares the whole object | pass both runs while widening where the secret may go |
| `'{"PULSE_HEADER_SVC":["e2e-target"]}'` (wrong variable) | Run B fails: `e2e-post` stays down with the denial reason, and `assert_absent` would also see `PULSE_HEADER_SVC_TOKEN` in `GET /checks` | pass Run A only |
| Run B with `COMPOSE_FILE` or a `-f` override instead of the image line | not a valid run: the script resets `COMPOSE_FILE` (`:14`), so the pinned `0.1.0` runs | report Run B green while testing the old image |
| Run B with a Compose `build:` key | rejected by the script (`:307-308`) and by `check-setup.sh` rule 1 | — |
| Temporary image line left in the PR | rejected: check 5 (`git diff --exit-code -- common/services.yaml`, `check-setup.sh` rule 2 digest pin) fails | ship an unpinned probe |
| Run B passes `e2e-post is up` but a leak check fails | the run fails: only `==> All checks passed` counts | count a partial pass |

No statistics are defined or changed.

## Contract fields

No new names in the contract or the config repository. `PULSE_PROBE_HEADER_HOSTS` is an existing probe setting (`.repos/probe/src/header-hosts.ts:6`, `src/settings.ts:89`, `docs/configuration.md:20`). This spec only sets it in a deploy fixture. Search:

- `grep -rn 'PULSE_PROBE_HEADER_HOSTS' .repos/contract/src .repos/config` finds no match.
- `grep -rn 'PULSE_PROBE_HEADER_HOSTS' .repos/deploy` finds no match (the line is new to deploy).

## Repository: deploy

Files:
- `e2e/compose.e2e.yaml` (changed)

Behavior change: yes. The E2E fixture now binds the env header to its host, which changes what probe `main` sends in the E2E.

If the implementer finds `PULSE_PROBE_HEADER_HOSTS` already set to this value in `e2e/compose.e2e.yaml` on `main`, it requests a hold instead of a review.

### Change

Add to `services.probe.environment` in `e2e/compose.e2e.yaml`, directly after the `PULSE_HEADER_SVC_TOKEN` line (`:41`), the comment and the line from Required behavior. Change nothing else in the repository. Deploy `AGENTS.md` rules that apply:
- no `image:` in `e2e`;
- pins only in `common/services.yaml`;
- no literal secret in a setup (the binding is not a secret);
- no `.factory/` or note files.

### Validation of probe `main` (local only, never committed)

1. Build the image from probe `main`. Use the probe clone in the context (`.repos/probe`) or a fresh `git clone https://github.com/lorenzh/pulse-probe.git`.
   - Record `git -C <probe> rev-parse HEAD`.
   - Build with `docker build -t pulse-probe:e2e-main <probe>`. The probe `Dockerfile` installs the GitHub dependencies with `bun install --frozen-lockfile`, so it needs network access.
   - Record `docker image inspect pulse-probe:e2e-main --format '{{.Id}}'`.
2. Copy `common/services.yaml` aside. Replace only the probe image value at `common/services.yaml:16` with `pulse-probe:e2e-main`. `--pull missing` (`e2e/compose-e2e.sh:320`) uses the local image.
3. Run `bash e2e/compose-e2e.sh`. In a second shell, while the stack runs:
   - run `docker compose -p pulse-e2e logs probe | grep 'header host bindings for 1 variable(s)'`;
   - run `docker inspect --format '{{.Image}}' $(docker compose -p pulse-e2e ps -q probe)` and compare the result with the recorded image ID.
4. Restore `common/services.yaml` from the copy, then run `git diff --exit-code -- common/services.yaml`.

### Checks (from deploy `AGENTS.md` and CI)

CI facts, cited from `.repos/deploy/.github/workflows/ci.yml`:
- The `lint` job checks Compose >= 2.23 (`:26-33`). It runs shellcheck and `bash -n` (`:34-37`), `jq empty` on JSON (`:40-41`), `scripts/check-setup.sh` (`:48-49`) and `bash scripts/check-setup.test.sh` (`:50-51`).
- The `full` job pulls the pins, runs `scripts/measure.sh full` and then `bash e2e/compose-e2e.sh` (`:99-118`).
- The reusable `check` job (`:16-17`, `lorenzh/pulse-config/.github/workflows/check.yml@04108fa`) is not affected: the change touches no TypeScript or JSON.

The implementer runs:
- `scripts/check-setup.sh` and `bash scripts/check-setup.test.sh`. Rule 5 renders `-f full/compose.yaml -f e2e/compose.e2e.yaml`, so the overlay still has to render.
- The static render check (acceptance 2).
- Run A and Run B (acceptance 3 and 4) in a Docker environment with Compose >= 2.23, curl, jq, network access, and ports 3000, 8080 and 8082 free (`README.md:121`).
- Optionally, the negative control (acceptance 6).

### Completion evidence

The PR names issue #646 and reports:
- the diff (one file);
- the output of the render check;
- the end of Run A (`==> All checks passed` and the four `shows no secret` lines);
- for Run B: the same lines, plus the probe commit SHA, the local tag, the image ID and the `header host bindings for 1 variable(s)` log line;
- the restored `common/services.yaml` (`git diff --exit-code`);
- the static checks.

If a Docker run is not possible in the implementation environment, the PR says so plainly, and the runs stay an open item for the reviewer. Do not claim a pass.
