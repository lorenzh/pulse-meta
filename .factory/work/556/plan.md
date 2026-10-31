# Spec #556: Service images and CI: no `.env` autoload, approved action pins, no persisted credentials

Issue review: `.factory/work/556/issue-review.md`. Inspected baselines (main): api `c00a375`, probe `50ec9ca`, status `2e3067d`, notify `c090a07`, console `11a3f5f`, config `dc69a126bebbe50d8a7339ea1325d51b2ea43d7d`, contract `ebcbbb613328494185833f7133f1242910986948`.

## Goal

The five service images (api, probe, status, notify, console) read configuration only from their process environment and the files that their docs name. No Bun process in a runtime image loads a dotenv file (`.env`, `.env.production`, `.env.local` and the other names Bun discovers). Every service CI workflow uses only actions pinned to a SHA approved in `docs/approved-packages.md`, every checkout sets `persist-credentials: false`, and a check in the normal PR and main runs fails when that stops being true. notify validates checks with contract main, which accepts only `http:` and `https:` check URLs.

## Scope

- **meta (this spec PR)**: `docs/approved-packages.md` approves `actions/upload-artifact` `cf430e030ddbb5b0abf93d22962f4752f3646cd9` (v7.0.2) for the pulse-api `bench.yml` only, and states that the target rows are the action policy that pulse-config enforces (Decision 3). Done in this PR.
- **config**: a shared workflow check `pulse-workflows` (bin) with a checked-in policy `actions-policy.json`, tests, docs. Config runs it on its own workflows.
- **api, probe, status, notify, console**: Dockerfile `CMD` and `HEALTHCHECK` run `bun --no-env-file`; a new image test in the `docker` job on both architectures; `lint` runs `pulse-workflows`; config pins move to the merged config SHA; docs. api adds `persist-credentials: false` to its four checkouts. notify bumps its contract pin.

## Non-goals

- `bun run start` and other source-run scripts keep plain `bun` (no `--no-env-file`). The guarantee is for the runtime image only. Docs describe the source run accurately in one sentence, without the list of autoloaded files.
- No change to Compose: `api/compose.yaml`, `.env.example`, host-side Compose interpolation, `env_file:`/`--env-file` and `environment:` injection stay as they are. Helper containers that run `bun` on the plain `oven/bun` image (`api/compose.yaml:87,114`, `api/bench/compose.bench.yaml:83`) are not service images and stay unchanged.
- No change to `check.yml` and `release.yml` of pulse-config (both byte-identical after this feature), to `jobs.release` other than its pin (Decision 2), to the Dockerfile base, user, ports, `ENV`, healthcheck timing or path.
- kit, contract, website and deploy do not adopt the check in this feature. status keeps its contract pin `9fe5e80…`.
- The check does not verify the `# vX.Y.Z` comments, Docker image pins in `run:` lines, or the `container:`/`services:` images of jobs (it rejects jobs that have those keys; none exists today).
- No new runtime dependency, no new setting, route or wire field.

## Decisions

1. **One shared check in config, called from each service's `lint` script.** Service `AGENTS.md` puts shared tooling rules in pulse-config; five copies would drift. The check is the bin `pulse-workflows` of `@lorenzh/pulse-config`, like `pulse-eslint`. Each service's `lint` script becomes `biome check . && pulse-eslint . && pulse-workflows`, so it runs in the `Lint` step of the shared `check.yml` (`config/.github/workflows/check.yml:27-28`, `run: bun run lint`) on every pull request and every push to main, and locally in `bun run check`. `check.yml` itself does not change, so kit, contract, website and deploy are not affected by a later pin update.
2. **Internal workflow refs must equal the `@lorenzh/pulse-config` pin of `package.json`.** config `README.md:108-114` already requires that `package.json`, `check.yml@` and `release.yml@` carry the same SHA and says that no check asserts it; `pulse-workflows` now asserts it. A fixed list of allowed config SHAs could not name the merged config SHA from inside config. Consequence for "release jobs unchanged": each service's `jobs.release.uses` moves from `dc69a126…` to the merged config SHA, and nothing else in `jobs.release` changes. `release.yml` at the merged config SHA is byte-identical to `dc69a126…` (config must not touch it; acceptance 6), so the release behavior does not change.
3. **The approval source is `docs/approved-packages.md`; config holds a reviewed snapshot.** `actions-policy.json` lists the target-scoped rows of "Runtime and CI" (the meta-only rows, `actions/checkout` v5.1.0, `setup-node`, `upload-pages-artifact`, `deploy-pages`, are not in it). It names the pulse-meta commit it was copied from. The check never fetches meta at run time. A change of an approved pin is a meta PR, then a config PR that updates `actions-policy.json`, then the consumer pin updates.
4. **Scoped approvals are enforced.** `actions/upload-artifact` is allowed only in `bench.yml` of `@lorenzh/pulse-api`; `actions/attest` only in `release.yml` of `@lorenzh/pulse-config`, as `docs/approved-packages.md` scopes them. The package is identified by `name` in the `package.json` of the checked directory.
5. **The dotenv marker is an invalid `PULSE_LOG_LEVEL`.** Every service reads it through kit `readLogLevel` (`kit/src/logger.ts:29-30`; api `src/start.ts:126`, probe `src/settings.ts:76`, status `src/main.ts:10`, notify `src/index.ts:367`, console `src/main.ts:13`) and refuses to start with a value outside `debug|info|warn|error`. The marker `dotenv-marker-556` is no secret, needs no debug endpoint, and is observable: verified on the console image of main (`11a3f5f`) during planning: with `-v <file>:/app/.env:ro` holding `PULSE_LOG_LEVEL=dotenv-marker-556`, the unmodified image exits `2` with `pulse-console: PULSE_LOG_LEVEL: must be one of debug, info, warn, error`; the same for `/app/.env.production` and `/app/.env.local`; with `bun --no-env-file src/main.ts` it starts and `/healthz` answers `200`. A `bun -e` process (the healthcheck form) in the same container printed the marker from `/app/.env`, and `bun --no-env-file -e` printed `undefined`.
6. **The healthcheck is in scope.** Docker runs `HEALTHCHECK CMD` as an extra process in the container; it would load `/app/.env` (Decision 5). So every Bun invocation in the runtime image gets `--no-env-file`.
7. **notify's image test avoids a fake API.** notify's `/healthz` turns 503 after `PULSE_NOTIFY_HEALTH_MAX_FAILED_POLLS` failed polls in a row (default 5, `notify/src/config.ts:398`; `src/index.ts:236-242`). The test sets `-e PULSE_NOTIFY_HEALTH_MAX_FAILED_POLLS=1000` (a documented setting, passed explicitly) and an unreachable local API URL. At the default poll interval of 5 s (`src/config.ts:367`) the threshold cannot be reached within the 30 s deadline, so there is no race. The subject of the test is dotenv loading, not polling.

## Required behavior

### Images (all five services)

- Final stage `CMD` is exactly `["bun", "--no-env-file", "src/main.ts"]` (notify: `["bun", "--no-env-file", "src/index.ts"]`).
- `HEALTHCHECK ... CMD` becomes `["bun", "--no-env-file", "-e", "<same script as today>"]`. Interval, timeout, start period, retries, URL and port logic stay as today.
- Nothing else in the Dockerfiles changes. `.dockerignore` keeps excluding `.env*`.
- Real environment variables (`-e`, `--env-file` on the host, Compose `environment:`/`env_file:`) and the documented setting files (`PULSE_CHECKS_FILE`, `PULSE_TOKENS_FILE`, `PULSE_PROBE_TOKEN_FILE`, `PULSE_NOTIFY_CONFIG`, channel `...File` keys, status theme/logo files) keep working.

### Image test (each service, `scripts/image-dotenv.sh <image>`)

A bash script (`set -euo pipefail`) that a new step `Image ignores dotenv files` runs in the existing `docker` job on both matrix legs, right after the image build: `run: bash scripts/image-dotenv.sh pulse-<svc>:local`. It creates its files in one `mktemp -d` directory (mode `0755`, files `0644`, so the image user `bun` can read them), gives each container a unique name, and removes containers and the directory in an `EXIT` trap, also on failure. It uses no public network endpoint and no secret.

1. **Static image config.** `docker image inspect` of the image: `.Config.Cmd` equals the literal of "Images" above; the first four entries of `.Config.Healthcheck.Test` equal `["CMD","bun","--no-env-file","-e"]` (compared with `jq -e`).
2. **Environment control.** `timeout 30 docker run --rm <fixture> -e PULSE_LOG_LEVEL=dotenv-marker-556 <image>` exits `2` and its stderr contains `PULSE_LOG_LEVEL`. This proves that the marker is observable when the process does read it.
3. **Dotenv files are ignored.** For each name in `.env`, `.env.production`, `.env.local`: write the fixture dotenv file (line `PULSE_LOG_LEVEL=dotenv-marker-556`; api and status add `PORT=1`, console adds `PULSE_CONSOLE_PORT=1`, so that a healthcheck that loaded the file would fetch a wrong port), start `docker run -d --name <unique> <fixture> -v "<dir>/dotenv:/app/<name>:ro" <image>` with the image's default entrypoint and command (no `--entrypoint`, no command, no `--env-file`, no `-e PULSE_LOG_LEVEL`, no `-e PORT`/`PULSE_CONSOLE_PORT`, no override of `NODE_ENV`, nothing mounted over `/app`). Then:
   - `docker exec <c> sh -c 'test -r /app/<name> && test -s /app/<name>'` succeeds (the file is there and readable by the image user);
   - within 30 s (polling every 0.5 s) the container is still running and the image's own healthcheck command, read from `.Config.Healthcheck.Test` (entries after `"CMD"`) and run with `docker exec <c> ...`, exits `0`. If the container stops, the script prints `docker logs` and fails;
   - `docker logs <c>` does not contain `dotenv-marker-556`;
   - `docker stop -t 10 <c>` and `.State.ExitCode` is `0`.
4. Exit `0` with one `ok:` line per case; any failed assertion exits non-zero with a message that names the case.

Fixture (`<fixture>`) per service, all through `-e` and read-only mounts outside `/app`:

| Service | Fixture |
| --- | --- |
| api | `-v <dir>/config:/config:ro -e PULSE_CHECKS_FILE=/config/checks.json -e PULSE_TOKENS_FILE=/config/tokens.json`; `checks.json` = `{"checks":[{"id":"ci","name":"CI","url":"http://127.0.0.1:9/","intervalMs":10000,"timeoutMs":2000}]}`, `tokens.json` = `{"tokens":[{"location":"ci","token":"dotenv-ci-0123456789abcdef"}]}`. Database at the image default `/data/pulse.db` (owned by `bun`). The healthcheck fetches `/readyz`. |
| probe | `-e PULSE_API_URL=http://127.0.0.1:9 -e PULSE_PROBE_TOKEN=dotenv-ci-0123456789abcdef`. `/healthz` on 9100 is liveness and does not depend on the API (`probe/docs/operation.md:54`). |
| status | `-e PULSE_API_URL=http://127.0.0.1:9`. `/healthz` never depends on the API (`status/README.md:24`). |
| notify | `-v <dir>/config:/config:ro -e PULSE_NOTIFY_CONFIG=/config/notify.json -e PULSE_API_URL=http://127.0.0.1:9 -e PULSE_NOTIFY_HEALTH_MAX_FAILED_POLLS=1000`; `notify.json` = `{"channels":[{"id":"log","type":"file","path":"/data/incidents.jsonl"}]}` (state under the image default `/data`). |
| console | `-e PULSE_API_URL=http://api.invalid:3000` (as the existing smoke step). |

If a service's control (step 2) does not exit `2` with `PULSE_LOG_LEVEL` in stderr, or a fixture does not reach a passing healthcheck on the fixed image, the implementer requests a hold with the observed output instead of changing the marker or the assertions.

### Workflow check `pulse-workflows` (config)

Run in a repository root (`process.cwd()`). Exit `0` and print one line `pulse-workflows: ok (<n> files, <m> uses)` when all rules pass; else print one line per violation to stderr and exit `1`. A violation line is `<file>: jobs.<job>[.steps[<i>]]: <rule>`; it may name the `uses` value but never prints `with`, `env`, `run` or `secrets` values.

Inputs:
- Every regular file matching `.github/workflows/*.yml` and `.github/workflows/*.yaml` (top level, as GitHub reads them). No such file, or no `.github/workflows` directory: violation `no workflow files`.
- `package.json` of the root: `name`, and the `@lorenzh/pulse-config` entry of `devDependencies` or `dependencies` if present. Missing or unparsable `package.json`: violation.
- The policy `actions-policy.json` shipped next to the bin (resolved from the bin's own location, never from the checked repository).

Rules:
1. A file that `Bun.YAML.parse` cannot parse, or whose root is not a map with a non-empty `jobs` map, or a job that is not a map, or `steps` that is not a list of maps: violation (fail closed).
2. A step `uses` must be a string of the form `<owner>/<repo>@<sha>` with `<sha>` exactly 40 lower-case hex characters. Rejected: tags and branches (`@v7`, `@main`), short SHAs, upper-case hex, sub-path actions (`github/codeql-action/init@…`), local actions (`./…`), `docker://…`, and any value containing `${{`.
3. `<owner>/<repo>` must be an entry of the policy, and `<sha>` must equal that entry's `sha`. A SHA approved for another action does not count.
4. An entry with `only` is allowed only when the `package.json` `name` and the workflow file name match one of its pairs.
5. Every `actions/checkout` step must have a `with` map whose own `persist-credentials` key is the boolean `false`. Missing `with`, missing key, `true`, the string `"false"`, an expression, or the key on another step or job do not count. Each checkout is checked on its own.
6. A job-level `uses` (reusable workflow) is allowed only as `./.github/workflows/<file>` where `<file>` is one of the checked files, or as `lorenzh/pulse-config/.github/workflows/check.yml@<sha>` or `lorenzh/pulse-config/.github/workflows/release.yml@<sha>` where `<sha>` is 40 lower-case hex and equals the SHA in the `package.json` entry `github:lorenzh/pulse-config#<sha>`. Without that entry, every remote reusable workflow is a violation. Any other owner, repository or path is a violation.
7. A job with `container` or `services` is a violation (`not covered by the action policy`).
8. A job with neither `steps` nor `uses` is a violation.

Policy file `actions-policy.json` (config root), exact content apart from the meta commit:

```json
{
  "source": "lorenzh/pulse-meta docs/approved-packages.md at <40-hex pulse-meta commit that contains the actions/upload-artifact row>",
  "actions": [
    { "uses": "actions/checkout", "sha": "3d3c42e5aac5ba805825da76410c181273ba90b1", "version": "v7.0.1" },
    { "uses": "oven-sh/setup-bun", "sha": "0c5077e51419868618aeaa5fe8019c62421857d6", "version": "v2.2.0" },
    { "uses": "actions/attest", "sha": "1e69f48acb82d1966a394da916b4c1698aa569d6", "version": "v4.2.2", "only": [{ "package": "@lorenzh/pulse-config", "workflow": "release.yml" }] },
    { "uses": "actions/upload-artifact", "sha": "cf430e030ddbb5b0abf93d22962f4752f3646cd9", "version": "v7.0.2", "only": [{ "package": "@lorenzh/pulse-api", "workflow": "bench.yml" }] }
  ]
}
```

A malformed policy (not this shape, a SHA that is not 40 lower-case hex, a duplicate `uses`) makes the bin exit `1` with `actions-policy.json: <reason>` before any workflow is checked.

### CI files of the services

- api: `persist-credentials: false` under `with:` on the checkouts at `ci.yml:25` (`bench-selftest`), `ci.yml:42` (`docker`), `ci.yml:72` (`compose-e2e`) and `bench.yml:36`. `bench.yml:52` keeps `actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2` (now approved) and its `if: always()`, `name`, `path`, `if-no-files-found` unchanged.
- probe, status, notify, console: already compliant (probe `ci.yml:28-30`; status `ci.yml:29-31,55-57`; notify `ci.yml:29-31`; console `ci.yml:29-31`). Only the pins and the new image step change.
- All five: `jobs.check.uses` and `jobs.release.uses` refs and the `package.json` pin (with `bun.lock`) move to the merged config SHA. `jobs.release` `if`, `needs` and `permissions` stay byte-identical.

### notify contract

- `package.json:30` `@lorenzh/pulse-contract` becomes `github:lorenzh/pulse-contract#ebcbbb613328494185833f7133f1242910986948`; `bun.lock` is regenerated with `bun install` and `bun install --frozen-lockfile` passes. The contract diff `61f7bf8...ebcbbb6` touches only `src/schema.ts`, `dist/schema.js`, docs and tests (the http/https URL rule, GitHub compare API, 2 commits ahead, 0 behind).
- `fetchChecks` (`notify/src/api.ts:170-182`) keeps using the contract's `validateCheck`; no URL validation is added in notify.

### Docs

Each service states, in its Docker section, that the image starts Bun with `--no-env-file`, so neither the service nor its healthcheck reads `.env` files, also not ones mounted into `/app`; settings come from the container environment (`-e`, `docker run --env-file` read on the host, Compose `environment:`/`env_file:`) and the documented setting files. Old command texts are corrected. Details per repository below.

## Risks

- **An operator relied on a `.env` mounted into `/app`.** It silently stops applying after the upgrade; the service then fails on a missing required setting (exit `2` with the setting name) or runs with defaults. Mitigated by the docs sentence and a README note in each service; no published setup (api Compose, deploy) mounts a dotenv file into `/app` (`grep -rn ':/app' deploy api/compose.yaml api/compose.e2e.yaml api/bench/compose.bench.yaml`: no match).
- **The check blocks a future workflow change.** Intended. A new action needs a meta approval and a config policy update first (Decision 3).
- **api `bench.yml` without persisted credentials.** `bench/run.ts:105-116` and `bench/refs.ts:86-88` clone and fetch the public repositories into their own work clones over anonymous HTTPS; they do not use the checkout's credentials. The nightly run after the merge proves it (acceptance 7).
- **Healthcheck regression.** A typo in the new `HEALTHCHECK` would mark the container unhealthy only at runtime; the image test runs the image's own healthcheck command on both architectures.
- **Pin divergence.** A service that moves `package.json` but not both `uses:` refs fails its own `lint` (rule 6), which is the intent.

## Performance impact

- `--no-env-file` removes Bun's lookup of up to six dotenv paths at process start. Expected effect on `startup_cpu_ms` and `startup_wall_ms` (api, probe, status, notify): below 1 ms, inside noise; direction down or none. The healthcheck process runs every 10 s (api) or 30 s, so `idle_rss_mib`, `peak_rss_mib` and `load_cpu_s` do not move.
- `image_mb`: unchanged; only image config metadata (`CMD`, `HEALTHCHECK`) changes, no layer content.
- p95 keys (`p95_get_checks_ms`, `p95_post_results_ms`, `p95_get_latency_ms`, `p95_get_check_latency_ms`), `rps`, `cold_*`: none expected, request handling does not change.
- `test_cpu_s`: none expected for the services (the check runs in `lint`, not `test`; notify adds a few small tests, well under 0.1 s). config `test_cpu_s` (budget 29.8 s, floor 3) grows by the new tests, expected under 1 s; the bin tests spawn Bun a handful of times.
- `build_cpu_s`: not measured for these repositories; none.
- CI: each `docker` leg gains about 30 to 60 s (three container starts plus the control run); `lint` gains under 1 s.
- Measurement: the implementer of api runs `bun bench/run.ts --a c00a375a1d78e17e9d01b8c25b5ae69b4fc3860e --b <PR head>` once locally (it builds the images through `bench/compose.bench.yaml`) and reports `startup_cpu_ms`, `startup_wall_ms` and `image_mb` for the four benched services; probe, status and notify cite that run. A difference beyond the run-to-run noise documented in `bench/README.md` is reported in the PR, not tuned away.

## Security impact

Security impact: yes. The change touches Dockerfiles (startup command and healthcheck), CI (credentials, action pins, a new policy check), dependencies (notify's contract pin, a newly approved action) and a validator at a trust boundary (contract `validateCheck` in notify).

Checklist items that apply:
- **Secrets in errors, logs and responses**: the image test uses no secret (the marker and the fixture token are public test literals); `pulse-workflows` never prints `with`, `env`, `run` or `secrets` values; no service error text changes.
- **Dependency pins**: every action pinned by 40-hex SHA from the approved list; `actions/upload-artifact` approved in this spec PR after checking that tag `v7.0.2` points to `cf430e030ddbb5b0abf93d22962f4752f3646cd9` (`gh api repos/actions/upload-artifact/git/ref/tags/v7.0.2`), licence MIT, repository not archived; config pins stay full SHAs and equal across `package.json` and both `uses:`; notify pins contract by full SHA.
- **Input validation**: `pulse-workflows` fails closed on malformed YAML, unexpected shapes and dynamic `uses`; notify rejects non-http(s) check URLs through the contract.
- **Least privilege / credential exposure**: no checkout persists the `GITHUB_TOKEN` into `.git/config`; no workflow permission changes.
- **Configuration boundary**: no implicit configuration source in the image (dotenv), including the healthcheck process.
- **Not applicable**: admin routes and auth order, body and size limits, accessor execution, SSRF and redirects (the probe HTTP client does not change), atomic and path-safe writes (no file writes change).

## Rollout order

1. **meta spec PR** merges first: approves `actions/upload-artifact` for api `bench.yml`. Nothing consumes the approval yet.
2. **config** merges `pulse-workflows`, `actions-policy.json` (citing the meta merge commit of step 1) and docs. `check.yml` and `release.yml` are unchanged. Every consumer still pins an older config (services `dc69a126…`, kit and contract `51e95b0…`, website `86896e9…`) and keeps working: the bin is opt-in through a target's own `lint` script, and the shared workflows they call are untouched.
3. **api, probe, status, notify, console**, in any order and in parallel, after step 2: each moves its three config pins to the merged config SHA, adds `pulse-workflows` to `lint`, changes the Dockerfile, adds the image test and docs; notify also bumps contract. Mixed states are harmless: services talk only over HTTP and the wire version does not change; status on contract `9fe5e80…` and probe/api on `ebcbbb6` are unaffected; notify on the new contract only drops check entries with non-http(s) URLs, which api main (`ebcbbb6`) already never serves.
4. **Releases**: no release is cut for this feature. The next `vX.Y.Z` tag of a service publishes an image with the new `CMD`. deploy pins released images by digest and keeps running the old images until it updates them; its setups pass settings through Compose `environment:`, which the new images still read.

## Counterexamples

Image (each must make `scripts/image-dotenv.sh` fail):
- Current main Dockerfile (`CMD ["bun", "src/main.ts"]`): the `.env` case exits `2` with `PULSE_LOG_LEVEL: must be one of debug, info, warn, error` (observed on console during planning), and step 1 fails.
- `CMD` fixed but `HEALTHCHECK` without `--no-env-file`: step 1 fails; for api, status and console the healthcheck `docker exec` also fails, because it would read `PORT=1`/`PULSE_CONSOLE_PORT=1` from `/app/.env`.
- `ENTRYPOINT ["bun","--no-env-file"]` with `CMD ["src/main.ts"]`: step 1 fails (the literal `Cmd` differs); the spec fixes one form.
- A test that passes the marker with `-e` or `--env-file`, or runs `--entrypoint bun ... --no-env-file`, would pass on main; the script forbids those in step 3.
- A test that only greps the logs for the marker would pass on main when the service crashes before logging; step 3 requires a passing healthcheck and a clean stop.
- A fixture file that the user `bun` cannot read (mode `0600` owned by the runner user): Bun would skip it on main too, so the red case vanishes; the `test -r` assertion catches it.

`pulse-workflows` (each input must give exit `1`; the compliant baseline gives `0`):
- `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1` with no `with` (api `ci.yml:25` today).
- Two checkouts in one job, the first with `persist-credentials: false`, the second without: one violation for the second.
- `persist-credentials: "false"` (string), `persist-credentials: true`, `persist-credentials: ${{ false }}`.
- `persist-credentials: false` set in the job's `env` or on a `setup-bun` step, checkout without it.
- `actions/checkout@v7`, `actions/checkout@main`, `actions/checkout@3d3c42e` (short), `actions/checkout@3D3C42E5AAC5BA805825DA76410C181273BA90B1` (upper case).
- `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b2` (same length, last digit changed).
- `actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09` (approved for pulse-meta only, not in the target policy).
- `evil/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1` (unknown action with an approved SHA).
- `actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9` in `ci.yml` of api, or in `bench.yml` of a package named `@lorenzh/pulse-probe`.
- `actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6` in a service workflow.
- `uses: ${{ matrix.action }}`, `uses: ./.github/actions/setup`, `uses: docker://alpine:3`.
- A defect only in `bench.yml`, or only in a `*.yaml` file: still reported.
- `lorenzh/pulse-config/.github/workflows/release.yml@dc69a126bebbe50d8a7339ea1325d51b2ea43d7d` while `package.json` pins another config SHA; `lorenzh/pulse-config/.github/workflows/check.yml@main`; `lorenzh/pulse-config/.github/workflows/other.yml@<pin>`; `lorenzh/pulse-kit/.github/workflows/check.yml@<pin>`.
- `./.github/workflows/missing.yml` as a job `uses`.
- A file with a YAML syntax error, a file whose root is a list, `jobs: {}`, `steps: "x"`.
- A job with `container: node:22`.
- A comment `# persist-credentials: false` under a checkout: YAML drops comments, so it is still a violation.

notify contract:
- An HTTP check with `url` `file:///tmp/dotenv-marker-556` or `ftp://example.invalid/check`, otherwise valid: `fetchChecks` must drop it and call `onInvalidCheck` (the old pin `61f7bf8` accepts it, so this test fails on main).
- `https://example.invalid/` and `http://example.invalid/` stay accepted. TLS, TCP, DNS, domain and heartbeat checks (no `url`) stay accepted.

Statistics: none. The spec defines no percentile, average or window.

## Contract fields

No wire field, route, env var, contract type or service setting is added or renamed. New names are tooling names only. Searches in the clones, each with no match:

- `grep -rn 'pulse-workflows' .repos/contract/src .repos/config` → 0
- `grep -rn 'workflow-policy' .repos/contract/src .repos/config` → 0
- `grep -rn 'actions-policy' .repos/contract/src .repos/config` → 0
- `grep -rn 'image-dotenv' .repos/contract/src .repos/config` → 0
- `grep -rn 'dotenv-marker' .repos/contract/src .repos/config` → 0
- `grep -rn 'no-env-file' .repos/api .repos/probe .repos/status .repos/notify .repos/console` (excluding `node_modules`, `.git`) → 0
- Existing bin names in config `package.json:11-13`: only `pulse-eslint`. The step name `Image ignores dotenv files` is new in each `ci.yml`.

## Acceptance evidence

Done when all six child PRs are merged and:

1. **Red/green image test per service.** Each service PR quotes `bash scripts/image-dotenv.sh <image>` run twice locally: against an image built from the service's inspected baseline Dockerfile (api `c00a375`, probe `50ec9ca`, status `2e3067d`, notify `c090a07`, console `11a3f5f`) it exits non-zero, with the `.env` case reporting exit `2` and `PULSE_LOG_LEVEL` in the container output; against the PR image it exits `0` with the `ok:` lines for the control and for `.env`, `.env.production`, `.env.local`. In CI, the step `Image ignores dotenv files` is green on both `ubuntu-24.04` and `ubuntu-24.04-arm`.
2. **Image config.** On the PR image, `docker image inspect --format '{{json .Config.Cmd}}'` prints `["bun","--no-env-file","src/main.ts"]` (notify `["bun","--no-env-file","src/index.ts"]`), and `.Config.Healthcheck.Test[0:4]` is `["CMD","bun","--no-env-file","-e"]`. Expected values are the literals here.
3. **Workflow check is red on the defects.** In config, `src/workflow-policy.test.ts` covers every counterexample above with an inline fixture and a literal expected violation count. In the api PR, before the four `persist-credentials: false` lines are added, `pulse-workflows` (with the new config installed) exits `1` and lists exactly 4 checkout violations (`ci.yml` jobs `bench-selftest`, `docker`, `compose-e2e`; `bench.yml` job `bench`) and none for `upload-artifact`; after the fix it exits `0`. Each of probe, status, notify and console quotes one temporary mutation (remove `persist-credentials: false` from one checkout) that makes `bun run lint` fail with 1 violation, reverted before commit.
4. **Policy matches the approval source.** The config test asserts the four `uses`/`sha` pairs of `actions-policy.json` against literals written in the test, copied from `docs/approved-packages.md` (rows `actions/checkout` v7.0.1, `oven-sh/setup-bun`, `actions/attest`, `actions/upload-artifact`); and a test changes one character of one SHA in a copy of the policy and expects exit `1` for a compliant workflow.
5. **notify contract.** `package.json` and the `bun.lock` entry contain `ebcbbb613328494185833f7133f1242910986948` (literal); `bun install --frozen-lockfile` passes; the new test in `test/api.test.ts` passes on the PR and fails when the pin is reverted to `61f7bf8` (quoted in the PR); `test/check-types.test.ts` passes unchanged.
6. **Release unchanged.** `git -C pulse-config diff --exit-code dc69a126bebbe50d8a7339ea1325d51b2ea43d7d <merged config SHA> -- .github/workflows/release.yml .github/workflows/check.yml` exits `0`. In each service PR, `git diff <baseline>..HEAD -- .github/workflows/ci.yml` shows, inside `jobs.release`, only the changed SHA on the `uses:` line.
7. **CI green** on the merged main of config, api, probe, status, notify and console: `check`, both `docker` legs, api `bench-selftest` and `compose-e2e`, status `a11y`. The next nightly (or a `workflow_dispatch`) run of api `bench.yml` after the merge is green and uploads `bench-out`.
8. **Docs.** `grep -rn 'bun src/main.ts\|bun src/index.ts' docs README.md` in each service finds no sentence that names the image command without `--no-env-file`; probe `docs/install.md` no longer has the `.env` files list (old lines 23-32).

## Repository: config

Files:
- `actions-policy.json` (new)
- `src/workflow-policy.ts` (new)
- `src/workflow-policy.test.ts` (new)
- `bin/pulse-workflows.js` (new)
- `src/pulse-workflows.test.ts` (new)
- `package.json`
- `README.md`
- `AGENTS.md`

Behavior change: yes — new shared CI tooling (a bin and a policy) that fails a target's lint on unapproved actions or persisted credentials.

Behavior:
- `src/workflow-policy.ts`: pure functions, no I/O. `parsePolicy(value: unknown)` validates the policy shape; `checkWorkflows({ files: { name: string; text: string }[], packageJson: unknown, policy })` returns the list of violations (rules 1 to 8 in "Workflow check"). YAML via `Bun.YAML.parse` (Bun 1.4.0, no YAML package; the existing `src/release.test.ts:12` uses it). Typed errors or result values per `AGENTS.md` "Errors"; cognitive complexity at most 15 per function.
- `bin/pulse-workflows.js`: `#!/usr/bin/env bun`, like `bin/pulse-eslint.js:1`. Reads `.github/workflows/*.yml|*.yaml` and `package.json` from `process.cwd()`, `actions-policy.json` from `new URL("../actions-policy.json", import.meta.url)`, imports `../src/workflow-policy.ts`, prints, exits `0`/`1`.
- `actions-policy.json` exactly as in "Workflow check", with `source` naming the pulse-meta commit on main that contains the `actions/upload-artifact` row.
- `package.json`: `bin` gains `"pulse-workflows": "./bin/pulse-workflows.js"` (line 11-13); `files` (lines 14-22) gains `bin/pulse-workflows.js`, `src/workflow-policy.ts`, `actions-policy.json`; `lint` (line 33) becomes `biome check . && bun bin/pulse-eslint.js --config eslint.local.config.js . && bun bin/pulse-workflows.js`, so config checks its own `ci.yml`, `check.yml` and `release.yml` (all compliant today: `check.yml:19-24`, `release.yml:22-25,87-89,134-136,185-188,291`; `ci.yml:17` is the local `./.github/workflows/check.yml`).
- `.github/workflows/check.yml` and `.github/workflows/release.yml` do not change.
- README: a `pulse-workflows` section (rules, the policy file and its source, `"lint": "biome check . && pulse-eslint . && pulse-workflows"` for targets, how to approve a new action: meta PR, then `actions-policy.json`); add `bin/pulse-workflows.js` and `actions-policy.json` to the Files table (around line 24); in "Updating the pin" (lines 108-114) replace "No check asserts that they match" with: `pulse-workflows` fails when a `uses:` ref differs from the `package.json` pin.
- AGENTS.md "This repository": list `bin/pulse-workflows.js` and `actions-policy.json` among the shared files, and the rule that `actions-policy.json` changes only together with `docs/approved-packages.md` in pulse-meta.

Tool facts (verified at the clone, `dc69a126…`):
- Bun 1.4.0: `package.json:7` `"packageManager": "bun@1.4.0"`.
- Tests: `package.json:32` `"test": "bun test src"`; `bunfig.toml:1-4` `[test]` `coverage = true`, `coverageThreshold = { lines = 0.8 }`, `coveragePathIgnorePatterns` includes `test/**`. New tests live in `src/*.test.ts`.
- Lint: `package.json:33` (Biome, then ESLint through `bin/pulse-eslint.js` with `eslint.local.config.js`). `biome.json:16-25` `files.ignoreUnknown: true`, includes `**` except `dist`, `node_modules`, `bun.lock`, `*.html`, `test/fixtures`; so the new `.js`, `.ts` and `.json` files are formatted and linted.
- Typecheck: `package.json:31` (TypeScript 7 `tsc --noEmit`); `tsconfig.json` includes `src` only, so `bin/pulse-workflows.js` stays a thin wrapper and the logic lives in `src/`.
- CI: `.github/workflows/ci.yml:16-17` calls `./.github/workflows/check.yml`, whose steps are Install, Lint (`bun run lint`), Typecheck, Test (`check.yml:25-38`), on `pull_request` and push to `main` (`ci.yml:3-6`).

Checks:
- `src/workflow-policy.test.ts`: one test per counterexample of "pulse-workflows" with inline YAML fixtures and literal expected violations (count and rule); a compliant fixture with two checkouts, setup-bun, the config reusable workflows at the fixture pin and a local reusable workflow gives zero violations; policy shape errors. A test asserts the policy's four `uses`/`sha` pairs equal literals in the test (acceptance 4).
- `src/pulse-workflows.test.ts`: spawns `bun bin/pulse-workflows.js` with `cwd` in a `mkdtemp` directory (`package.json` plus `.github/workflows/`): compliant → exit `0` and the `ok` line; one defect → exit `1`, the violation line, and the stderr does not contain a sentinel value placed in that step's `env` and `with`; no workflow directory → exit `1`; a copy of the policy with one SHA character changed (bin pointed at it through a copied bin layout in the temp directory, not through an option of the shipped bin) → exit `1` for the compliant fixture. Also runs the bin on this repository's own root → exit `0`.

Completion evidence: `bun run check` passes locally and in CI; the PR lists the rules with their test names, quotes `bun bin/pulse-workflows.js` output on config itself, and names the pulse-meta commit in `source`.

## Repository: api

Files:
- `Dockerfile`
- `scripts/image-dotenv.sh` (new)
- `.github/workflows/ci.yml`
- `.github/workflows/bench.yml`
- `package.json`
- `bun.lock`
- `docs/install.md`
- `docs/development.md`
- `README.md`

Behavior change: yes — the image stops loading dotenv files, CI checkouts stop persisting credentials, and lint gains the workflow check.

Behavior:
- `Dockerfile:17-19`: `HEALTHCHECK ... CMD ["bun", "--no-env-file", "-e", <unchanged script>]`, `CMD ["bun", "--no-env-file", "src/main.ts"]`.
- `scripts/image-dotenv.sh` as in "Image test" with the api fixture; dotenv fixture adds `PORT=1`.
- `ci.yml`: `persist-credentials: false` on the checkouts at lines 25, 42, 72; new step `Image ignores dotenv files` after the build at line 43 (`run: bash scripts/image-dotenv.sh pulse-api:local`); `check` (line 18) and `release` (line 64) refs to the merged config SHA. `jobs.release` otherwise unchanged; `compose-e2e` and `bench-selftest` steps otherwise unchanged.
- `bench.yml:36`: `persist-credentials: false`. Line 52 unchanged.
- `package.json`: line 24 config pin to the merged config SHA (`bun.lock` refreshed); line 16 `lint` becomes `biome check . && pulse-eslint . && pulse-workflows`.
- `docs/install.md:107`: "with `bun --no-env-file src/main.ts`" plus the dotenv sentence of "Docs". The Compose `.env` sections (lines 57-75) stay; add one sentence there that this `.env` is read by Compose on the host, never by the API process in the container. `docs/development.md` CI section (lines 59-61): name the new step and that `bun run lint` runs `pulse-workflows`. README Docker section: one-line note on the dotenv boundary.

Tool facts (verified): `package.json:16` lint, `:15` test `bun test`, `:35` `packageManager: bun@1.4.0`, `:24` config pin `dc69a126…`; `biome.json:2` extends `@lorenzh/pulse-config/biome.json` (the pinned `biome.json` equals the clone, checked with `gh api …/contents/biome.json?ref=dc69a126…`); `bunfig.toml` `[test]` coverage 0.8 lines; `ci.yml:18` check uses `check.yml@dc69a126…`, whose Lint step runs `bun run lint` (`config/.github/workflows/check.yml:27-28`, fetched at the pin with `gh api …/contents/.github/workflows/check.yml?ref=dc69a126…`: identical to the clone); `ci.yml:54` already uses `jq` on the runner.

Checks: acceptance 1, 2, 3 (the 4-violation red run), 6, 7 (including the next `bench.yml` run), and the local bench A/B of "Performance impact".

Completion evidence: CI green on both `docker` legs, `bench-selftest`, `compose-e2e`; PR quotes red/green output of the image test and of `pulse-workflows`, and the bench numbers.

## Repository: probe

Files:
- `Dockerfile`
- `scripts/image-dotenv.sh` (new)
- `.github/workflows/ci.yml`
- `package.json`
- `bun.lock`
- `docs/install.md`
- `docs/troubleshooting.md`
- `docs/development.md`
- `README.md`

Behavior change: yes — the image stops loading dotenv files and lint gains the workflow check.

Behavior:
- `Dockerfile:16-18`: `--no-env-file` in `HEALTHCHECK` and `CMD` as in "Images".
- `scripts/image-dotenv.sh` with the probe fixture; new step after `ci.yml:31`.
- `ci.yml:18` and `:48` refs, `package.json:23` pin to the merged config SHA; `package.json:16` lint adds `&& pulse-workflows`.
- `docs/install.md`: replace the section `### .env files` (lines 23-32) with a short section on settings sources: the image never reads dotenv files (`--no-env-file`, also for the healthcheck, also when mounted into `/app`); pass settings with `-e`, `docker run --env-file` (read on the host) or Compose `environment:`/`env_file:`, the token also as `PULSE_PROBE_TOKEN_FILE`; one sentence for the source run: `bun run start` is plain Bun, which also reads a `.env` in the working directory, so keep settings in the shell environment. No page links to `install.md#env-files` afterwards. Line 36: "with `bun --no-env-file src/main.ts`".
- `docs/troubleshooting.md:10-11`: cause becomes "both variables are set in the environment (`-e`, `--env-file`, Compose `environment:`/`env_file:`; from source also the shell or a `.env` in the working directory)"; drop the link to `install.md#env-files`.
- `docs/development.md:49`: name the new step and the lint check. README Docker section (lines 21-29): one-line note on the dotenv boundary.

Tool facts (verified): `package.json:8` `packageManager: bun@1.4.0`, `:15` test, `:16` lint, `:23` config pin; `biome.json:2` extends the shared config (pinned file equals clone); `bunfig.toml` `[test]` coverage 0.8; `ci.yml:18` check at `dc69a126…` (Lint step `check.yml:27-28`, identical at the pin); `ci.yml:28-30` checkout already compliant.

Checks: acceptance 1, 2, 3 (mutation), 6, 7, 8.

Completion evidence: CI green on both `docker` legs; PR quotes red/green image test output and the lint mutation.

## Repository: status

Files:
- `Dockerfile`
- `scripts/image-dotenv.sh` (new)
- `.github/workflows/ci.yml`
- `package.json`
- `bun.lock`
- `docs/install.md`
- `docs/development.md`

Behavior change: yes — the image stops loading dotenv files and lint gains the workflow check.

Behavior:
- `Dockerfile:16-18`: `--no-env-file` in `HEALTHCHECK` and `CMD`.
- `scripts/image-dotenv.sh` with the status fixture; dotenv fixture adds `PORT=1`; new step after the build step (`ci.yml:32-33`).
- `ci.yml:18` and `:76` refs, `package.json:24` pin to the merged config SHA; `package.json:15` lint adds `&& pulse-workflows`. Contract pin `9fe5e80…` unchanged.
- `docs/install.md:24`: add the start command `bun --no-env-file src/main.ts` and the dotenv sentence. `docs/development.md:55`: name the new step and the lint check.

Tool facts (verified): `package.json:38` `packageManager: bun@1.4.0`, `:14` test, `:15` lint, `:24` config pin; `biome.json:2` extends the shared config; `bunfig.toml` `[test]` coverage 0.8; `ci.yml:18` check at `dc69a126…`; checkouts `ci.yml:29-31,55-57` already compliant; `a11y` job (`ci.yml:49-66`) unchanged.

Checks: acceptance 1, 2, 3 (mutation), 6, 7 (including `a11y`).

Completion evidence: CI green on both `docker` legs and `a11y`; PR quotes red/green image test output and the lint mutation.

## Repository: notify

Files:
- `Dockerfile`
- `scripts/image-dotenv.sh` (new)
- `.github/workflows/ci.yml`
- `package.json`
- `bun.lock`
- `test/api.test.ts`
- `docs/install.md`
- `docs/operation.md`
- `docs/development.md`

Behavior change: yes — the image stops loading dotenv files, lint gains the workflow check, and check validation follows contract main (non-http(s) URLs rejected).

Behavior:
- `Dockerfile:18-20`: `--no-env-file` in `HEALTHCHECK` and `CMD ["bun", "--no-env-file", "src/index.ts"]`.
- `scripts/image-dotenv.sh` with the notify fixture (Decision 7); new step after `ci.yml:32`.
- `ci.yml:18` and `:50` refs, `package.json:22` pin to the merged config SHA; `package.json:14` lint adds `&& pulse-workflows`.
- `package.json:30` contract pin to `ebcbbb613328494185833f7133f1242910986948`, `bun.lock` regenerated (line 8 and the resolved entry at line 81).
- `test/api.test.ts`: through the existing fake API helpers in `test/support.ts` (`startFakeApi`, `httpCheck`), `fetchChecks` returns the valid `http://` and `https://` HTTP checks and drops otherwise identical checks with `file:///tmp/dotenv-marker-556` and `ftp://example.invalid/check`, calling `onInvalidCheck` once for each (literal counts: 2 returned, 2 rejected).
- `docs/install.md:30`: "starts `bun --no-env-file src/index.ts`" plus the dotenv sentence. `docs/operation.md:38`: the Docker command becomes `... pulse-notify:local bun --no-env-file src/index.ts failed list`, so the documented one-off container does not read dotenv either. `docs/development.md`: name the new step and the lint check. The source-run commands (`bun src/index.ts failed ...`, `docs/operation.md:31-35`, README line 7) stay.

Tool facts (verified): `package.json:35` `packageManager: bun@1.4.0`, `:13` test `bun test`, `:14` lint, `:22` config pin, `:30` contract pin `61f7bf8…`; tests live in `test/*.test.ts` (`test/check-types.test.ts`, `test/api.test.ts`); `biome.json:2` extends the shared config; `bunfig.toml` `[test]` coverage 0.8 with `test/**` excluded from coverage; `ci.yml:18` check at `dc69a126…`; checkout `ci.yml:29-31` already compliant.

Checks: acceptance 1, 2, 3 (mutation), 5, 6, 7.

Completion evidence: CI green on both `docker` legs; PR quotes red/green image test output, the lint mutation, and the contract test failing on the old pin.

## Repository: console

Files:
- `Dockerfile`
- `scripts/image-dotenv.sh` (new)
- `.github/workflows/ci.yml`
- `package.json`
- `bun.lock`
- `README.md`
- `docs/development.md`

Behavior change: yes — the image stops loading dotenv files and lint gains the workflow check.

Behavior:
- `Dockerfile:15-17`: `--no-env-file` in `HEALTHCHECK` and `CMD`.
- `scripts/image-dotenv.sh` with the console fixture; dotenv fixture adds `PULSE_CONSOLE_PORT=1`; new step after the image content check (`ci.yml:34-47`), before `Start the container and wait for /readyz`. The existing smoke steps (`ci.yml:48-110`) stay unchanged.
- `ci.yml:18` and `:120` refs, `package.json:22` pin to the merged config SHA; `package.json:15` lint adds `&& pulse-workflows`.
- `README.md:39`: add the start command and the dotenv sentence. `docs/configuration.md:51` already explains that Compose does not pass `.env` into the container and stays. `docs/development.md:52`: name the new step and the lint check.

Tool facts (verified): `package.json:31` `packageManager: bun@1.4.0`, `:14` test, `:15` lint, `:22` config pin; `biome.json:2` extends the shared config; `bunfig.toml` `[test]` coverage 0.8; `ci.yml:18` check at `dc69a126…`; checkout `ci.yml:29-31` already compliant.

Checks: acceptance 1, 2, 3 (mutation), 6, 7.

Completion evidence: CI green on both `docker` legs; PR quotes red/green image test output and the lint mutation.
