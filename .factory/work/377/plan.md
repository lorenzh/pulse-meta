# Spec #377: performance budgets per service, nightly A/B bench, Performance impact section

## Goal
A benchmark harness in `pulse-api/bench/` with a fixed load and versioned budgets per service. A nightly GitHub-hosted job runs an interleaved A/B comparison (baseline against `main`). CPU time and memory gate the run. Wall-clock latency, throughput, wall-clock startup and image size are reported only. Every future spec states its performance impact (prompt change in pulse-meta, applied by a person).

## Scope
- api: `bench/` (harness, `budgets.json`, `baseline.json`, README), `.github/workflows/bench.yml`, `docs/development.md`, removal of `src/bench-reads.ts`.
- meta: new text for `.factory/prompts/plan.md` and `plan-review.md` (below). The plan state does not edit the prompts; a person applies the text right after this spec merges. It does not wait for api.
- No other target changes. contract, kit and config are measured (test and build CPU) but not modified.

## Non-goals
No Node vs Bun comparison, no release/tag creation, no profiling or performance fixes, no per-PR gate, no dashboard or committed history, no browser performance of status/website, no self-hosted runner, no issue creation on regression, no gating on wall-clock, throughput or image size. No new repository: `bench/` lives in pulse-api (decision of the issue; no concrete reason for a separate repository was found: the compose files and `bench-reads.ts` are there).

## Performance impact
None expected for the services. The harness runs only in its own workflow and local `bench/run.ts`; nothing in `src/`, the Dockerfile or the runtime dependencies changes except deleting `src/bench-reads.ts` (not shipped in the image behavior). The api `bun test` suite must not gain or lose tests, so test CPU is unchanged.

## Design decisions (fixed here; changed only by a PR that says why)

### Layout and refs
- `bench/run.ts` is the entry point (`bun bench/run.ts --a <ref> --b <ref> [--rounds n] [--others-ref <ref>] [--out <dir>]`). Local mode prints a warning that numbers are comparable only on one machine.
- For each side it clones (`git clone --filter=blob:none https://github.com/lorenzh/pulse-<name>.git`) once into `.bench/repos/<name>` (git-ignored) and creates a worktree per side at `.bench/work/<a|b>/<name>`, for `api`, `probe`, `status`, `notify`, `contract`, `kit`, `config`. It runs `bun install --frozen-lockfile` there. Only public repositories, no token. If an install needs a token anyway, the implementer stops and raises `needs-input` (conflicts with "no secrets").
- Ref resolution per repository and side:
  - `--a` / `--b` give the ref (SHA, branch, tag) of **api**. Defaults: A = `baseline`, B = `main`.
  - Other repositories: A = newest `v*` tag (`git ls-remote --tags --sort=-v:refname`) else the SHA in `bench/baseline.json`; B = `main`. For api with A = `baseline` the same rule applies.
  - `--others-ref <ref>` (workflow input `others`) pins every non-api repository to that ref on both sides. Use `--others-ref main` with `--a <sha> --b <sha>` for the A = B acceptance run.
  - The tag lookup and fallback are implemented and covered by a self-test (tag present, no tag, no network error handling: error fails the run).
- `bench/baseline.json`: `{ "<repo>": "<sha>" }` for all seven repositories, set by the implementer to the `main` SHAs at implementation time; bumped by a PR.

### Runs
- Rounds: **5 per side**, alternating A, B, A, B, ... (10 runs) in one job. Each run starts fresh containers and a fresh database; result per metric is the median per side. A failed run or missing metric fails the whole run (never skipped).
- One run = one compose stack with all four services (api, probe, status, notify) plus a `bench-target` container, defined in `bench/compose.bench.yaml` (standalone file with `build.context` from the side's worktrees, image names unique per side, healthchecks disabled so they cannot add CPU; readiness is polled by the harness on `/readyz`). Repository `compose.yaml` is not edited. The implementer keeps the bench file in step with `compose.yaml` environment names.
- Image size: `docker image inspect` `.Size`, reported.

### Measurement method (decided)
- Per process, from inside the container: the service is PID 1 of its container, so `docker exec <c> cat /proc/1/stat` (utime+stime, `CLK_TCK` 100) gives CPU time and `/proc/1/status` gives `VmRSS` (idle) and `VmHWM` (peak). Not `docker stats`, not cgroup counters (they would include healthcheck and exec processes and page cache).
- Startup CPU and wall: harness records the time before `docker start`/`compose up` of the service and polls `/readyz` every 50 ms; CPU is read at the first 200. Startup CPU resolution is 10 ms; floors account for that.
- Idle RSS: `VmRSS` after startup + 30 s idle (no requests; probe and notify idle-ish by their configured polling, no extra load). Peak RSS: `VmHWM` read at end of the load phase. Load CPU: CPU at end of load minus CPU at start of the measured window (after warm-up).
- Test CPU: `bun run test` of each repository in its worktree on the host; `user+system` from the child's `resourceUsage()` (includes waited descendants). Build CPU: `bun run build` for contract and kit (the only repositories with a `build` script). Tests and builds also alternate A, B for the same 5 rounds.

### Fixed load (named constants in `bench/load.ts`)
- Seeded api database: `SEED_CHECKS = 20`, `SEED_DAYS = 30`, 1-minute results (864 000 rows), built once per side by `bench/seed.ts` using that side's own `src/db.ts` (`openDb`, as `bench-reads.ts` did) and copied into each run's data directory, so schema differences between A and B cannot break a run.
- `PROBE_LOCATIONS = 3` simulated probes (own tokens file in the bench compose), together `POST_RATE = 30` req/s of `POST /checks/:id/results` round robin over the seeded checks with valid bodies, plus `GET_CHECKS_RATE = 10` req/s `GET /checks` and `GET_UPTIME_RATE = 1` req/s `GET /uptime`. The load generator is `fetch` based (open loop, fixed schedule), no new dependency.
- The real probe runs the checks of the bench checks file against `bench-target` (a trivial Bun HTTP container), at `intervalMs = 10000` for 20 checks; status and notify poll the api as configured in compose (bench `notify.json` with one no-op channel that fails closed to a local sink).
- `WARMUP_S = 20`, `DURATION_S = 60`, `IDLE_S = 30`. Expected run time about 2.5 min; job total about 35 min including installs and builds; `timeout-minutes: 90`.
- The implementer checks that the busy-loop acceptance branch (below) is caught by load CPU. If not, they raise the rates in the same PR and say why.

### Failure rule (gating metrics only)
For a lower-is-better metric: fail if `B - A > max(A * thresholdPct/100, floor)` (improvements never fail) or `B > budget`. Defaults: `thresholdPct = 10`, floors per unit: `ms` 30, `s` 0.2, `MiB` 3. Both are overridable per metric in `budgets.json`. Reported metrics always get verdict `reported`.

### `bench/budgets.json` schema
`{ "<service>": { "<metric>": { "budget": number, "unit": "ms|s|MiB|MB|req/s", "gating": boolean, "thresholdPct"?: number, "floor"?: number } } }`. Services: api, probe, status, notify (all metrics of the issue table, wall-clock p95 and rps for api only) and contract, kit, config (`test_cpu_s`, plus `build_cpu_s` for contract and kit; all gating). Metric keys: `startup_cpu_ms`, `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`, `test_cpu_s`, `build_cpu_s`, `startup_wall_ms`, `p95_get_checks_ms`, `p95_post_results_ms`, `rps`, `image_mb`. Budget = measured A median + headroom (about 30 %, rounded up), headroom stated in the PR. A schema check (self-test) requires a budget for every metric the harness emits.

### Workflow `.github/workflows/bench.yml`
- Triggers: `schedule` (nightly, 02:17 UTC) and `workflow_dispatch` with inputs `a`, `b`, `others` (all optional).
- `runs-on: ubuntu-24.04`, `permissions: contents: read`, `concurrency: { group: bench, cancel-in-progress: false }`, `timeout-minutes: 90`. Actions pinned by SHA (same pins as `ci.yml`: `actions/checkout`; plus setup-bun and `actions/upload-artifact` pinned by SHA with the version comment). Bun 1.4.0 as in `package.json`.
- Steps: checkout, install Bun, `bun install --frozen-lockfile`, `bun bench/run.ts` (writes the markdown table to `$GITHUB_STEP_SUMMARY`, JSON to `bench-out/`), upload `bench-out/` (raw samples + table JSON) with `if: always()`. No secrets, no issue creation. Exit code non-zero on a gating failure.

### Summary table
One table per service with columns: Metric, A, B, Change, Budget, Gating/Reported, Verdict (`ok`, `FAIL regression`, `FAIL budget`, `reported`). Failing rows name the metric key. Both local and CI print the same table.

### Lint, typecheck, tests
- `bench/` is typechecked (add `bench` to tsconfig `include`) and linted (biome/eslint already scan `.`; the implementer adds `.bench/` to ignores).
- The harness logic (median, failure rule, ref resolution, budgets schema) has self-tests as plain `node:assert` scripts in `bench/selftest/check-*.ts`, named so `bun test` does not discover them, run by `bun run bench:selftest` and as a step of `ci.yml`. `bench/` is not part of `bun test`.

## Repository: api

Files:
- New: `bench/run.ts`, `bench/load.ts`, `bench/seed.ts`, `bench/measure.ts`, `bench/compare.ts`, `bench/refs.ts`, `bench/compose.bench.yaml`, bench fixtures (checks, tokens, notify config), `bench/budgets.json`, `bench/baseline.json`, `bench/selftest/check-*.ts`, `bench/README.md`, `.github/workflows/bench.yml`.
- Changed: `package.json` (script `bench:selftest`, no new dependency), `tsconfig.json`, `.gitignore`, lint ignores, `.github/workflows/ci.yml` (selftest step), `docs/development.md` (replace the `bench-reads.ts` paragraph at line 44 with a pointer to `bench/README.md` and a short summary).
- Removed: `src/bench-reads.ts` (its seed shape moves into `bench/seed.ts`; its service-level timing of `GET /checks` and `GET /uptime` is replaced by the load p95).

Behavior: as in "Design decisions". `bench/README.md` and `docs/development.md` explain what is measured, running locally, changing a budget (a PR with the reason and measured values), reading a failure, and why only CPU time and memory gate (hosted runners are too noisy for wall-clock numbers; image size is deterministic but not a decision to gate).

Checks: `bun run check` (lint, typecheck, test) green; `bun run bench:selftest` green; `bench/` not run by `bun test`; `docker compose -f bench/compose.bench.yaml config --quiet` in CI.

Completion evidence (in the PR):
1. `bench.yml` dispatched with `a` = `b` = same SHA and `others` = `main` passes; the summary shows every metric of the issue table for every service.
2. Dispatch with B = branch that adds a few ms of busy loop to `GET /checks`: fails on api `load_cpu_s`, the row names it. Branch that only adds a 50 ms sleep: higher p95 shown, run passes.
3. Dispatch with B = branch that holds an extra 50 MiB buffer in the api: fails on api `idle_rss_mib`.
4. `bun bench/run.ts --a <sha> --b <sha>` works locally and prints the same table.
5. `budgets.json` budgets from measured A medians with the headroom stated.

## Exact text for the meta prompts (applied by a person after the spec merges)

### `.factory/prompts/plan.md`
Insert this paragraph after the paragraph that starts "State the goal, scope, non-goals" (before "Then write one section per repository"), and change nothing else:

```
Write a section headed `## Performance impact` before the repository sections. It names which
metrics of `bench/budgets.json` in the api repository the change can move (startup CPU, load CPU,
idle or peak RSS, test CPU, build CPU, and the reported ones: wall-clock startup, p95 latency,
requests per second, image size), in which direction and roughly how much, and how the
implementer measures it (for example a local `bun bench/run.ts --a <ref> --b <ref>` A/B). If the
change cannot move any of them, write "none expected" with a one-line reason. If `bench/` does not
exist yet in `main` of the api repository, name the kinds of metric instead of the keys.
```

### `.factory/prompts/plan-review.md`
Insert this paragraph after the paragraph that starts "Check the scope, required behavior" (before "If either file is missing"), and change nothing else:

```
Check that the spec has a `## Performance impact` section. It must name the budget metrics the
change can move with direction and rough size and a way to measure them, or say "none expected"
with a one-line reason that fits the change. Flag a missing section, a bare "none expected", and
an impact that contradicts the described behavior (for example a new background loop or a larger
image without any metric named). If the section is missing or implausible, transition to `plan`
with a concise defect report.
```

Outcome contracts (transitions, `needs-input`, files written) stay unchanged. After applying, `npx factory validate` must pass.

## Risks
- Hosted-runner noise in CPU time: mitigated by 5 interleaved rounds, medians, floors and 10 % threshold; the implementer reports observed A/A spread in the PR and widens floors per metric if A = B flakes.
- Probe, status and notify config differs from the compose defaults; the implementer verifies the bench environment against each repository's current `AGENTS.md`/README.
- `/proc/1` access via `docker exec` requires the container to run the service as PID 1 (true for the current Dockerfiles; no `init`).
- Nightly run length (about 35 min) on a hosted runner; acceptable, `main` only.

## Acceptance evidence
See api completion evidence; plus after merge: the person applies the prompt text and `npx factory validate` passes, and the next spec contains a `## Performance impact` section.
