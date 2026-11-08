# Spec #834: api: make the Docker bench robust against taken host ports

## Goal

The Docker bench of pulse-api (`bun bench/run.ts`) must not fail because a host port is taken. Two benches started at the same time on one machine must both finish without a bind error. Today the bench lets Docker pick random host ports from the host's ephemeral range. It uses fixed Compose project names, image tags and a shared workspace, so parallel runs collide.

## Sources

- Issue #834 body and its added requirements. The only comment is the Factory claim of `issue-review`.
- `.factory/work/834/issue-review.md`: no blocking questions; open points 1-8 are resolved below.
- Shared findings: `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/834` answered `HTTP 404`. There are no findings yet, which is normal for a feature without children.
- Read-only clones: api at `515031bd3fd2aa6b8993e325b24ab08f4a3510d6`, config at `bc870498cc8e2539a132ce2aac35a09db1deabd8`. The pinned config files `biome.json`, `eslint.config.js` and `.github/workflows/check.yml` at `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` were read with `gh api` and do not differ from the clone.
- Related: #831 (api child of #815) saw the error three times. A manager decision there moved the port fix to this issue. This issue does not redo #831's work.

## Current behavior (api `515031b`)

- `bench/compose.bench.yaml:27,43,62,87` publish api, probe, status and notify as `127.0.0.1::<container port>`. Docker picks the host port from the ephemeral range (`/proc/sys/net/ipv4/ip_local_port_range`, `32768 60999` on the machine that wrote this spec). Outgoing connections of the host use the same range, so a picked port can already be taken.
- `bench/compose.bench.yaml:6,14,15` and `bench/stack.ts:99,217,315,347` use the fixed project `pulse-bench-<side>`, the container names `pulse-bench-<side>-<service>` and the image tags `pulse-bench-<side>-<service>` (`stack.ts:109`). Two benches on one daemon share them.
- `bench/run.ts:56` uses one workspace `.bench/` per checkout: the shared clones use `FETCH_HEAD` (`:161`), and fixed paths are deleted (`:169,188,238,260,264`). Two invocations from one checkout overwrite each other's files.
- The cold-read phase restarts the api twice (`bench/cold.ts:297-300`, `docker compose restart api`). With a Docker-picked port, every restart binds a new random host port.
- `runChecked` (`bench/measure.ts:75-87`) throws an `Error` with only the last 500 characters of stderr. `bench/run.ts:339-344` turns any thrown error into exit `2`, and a gating verdict is exit `1` (`:329-331`).
- There is no retry on a bind failure. A failed stack dumps `docker compose ps -a` and logs to `failure-round<n>-<side>.log` and is torn down (`stack.ts:288-301`).

## Decisions (the open points of the issue review)

1. **Port strategy: both.** The harness picks explicit host ports from a range outside the host's ephemeral range, checks them before use, and retries the failed phase once with new ports when Docker still reports a bind failure. `bench/README.md` says so.
   - Candidate range: `20000-29999`, in blocks of five consecutive ports. Block `k` (0-1999) is guard `20000 + 5k`, then api, probe, status, notify at `+1` to `+4`.
   - The harness reads the ephemeral range from `/proc/sys/net/ipv4/ip_local_port_range` and uses only the blocks whose five ports all lie outside it. If the file cannot be read or parsed, that is a harness error (exit `2`). The harness never assumes a default range and never changes a sysctl. If no block lies outside the range, the error is `no bench port block in 20000-29999 outside the ephemeral range <low>-<high>` (exit `2`).
   - Coordination: an invocation reserves a block by listening on its guard port at `127.0.0.1`, and holds the listener until the phase is torn down. A second allocator, in this or another process, cannot listen on the guard, so it skips the block. The kernel frees the guard when a process dies, so no lock file can go stale.
   - Check: after the guard, the harness listens on each of the four service ports at `127.0.0.1` and closes the socket at once. If any listen fails, it frees the guard and tries the next block.
   - Order: start at a random block (random source injected) and scan forward with wrap-around, trying every candidate at most once per allocation. If no block is left, the error is `no free bench port block in 20000-29999` (exit `2`, not retried).
   - Gap between the check and Docker's bind: closed by the retry below. Ports outside the ephemeral range are not taken by the kernel for outgoing connections. Docker also refuses a host port that another container already publishes (`port is already allocated`). So a race between the check and the bind ends in a bind failure that the retry handles; it never ends in a shared port.
   - Explicit ports also keep the host port across `docker compose restart api` in the cold-read phase. `bench/cold.ts` keeps reading the port with `docker compose port` and is not changed.
2. **Retry boundary and count.** The unit is one phase call for one side in one round. There are three phases: `load` (`runStack`), `cold` (`runColdStack`) and `eod` (`runEodStack`). Each phase call runs at most two attempts (`BIND_ATTEMPTS = 2`). Attempt 2 runs only when attempt 1 failed with a port bind failure. A nested helper never retries on its own. The end-of-day day-change retry inside `runEodPhase` (`bench/eod.ts:186-208`) stays as it is and runs inside each attempt.
3. **Fresh attempt.** Before each attempt, the harness removes the phase's run directory, as `run.ts:238,260,264` does today. The phase function then rebuilds it from the side's untouched seed (`prepareRunDir` or the eod `seed`), and the load phase creates its runtime tokens again on the new api. Before attempt 2 starts, the failed attempt is torn down by the phase's own `finally` (`compose down -v --remove-orphans`) and its block is freed. Attempt 2 gets a new block that excludes the failed block. Samples of a failed attempt are dropped: only the returned result of the successful attempt is added to `samples`, so every metric gets exactly one value per side and round. Seeds, warm-up, idle and load windows, settle, restart order, routes, cycle counts and metric definitions do not change.
4. **What counts as a bind failure.** A failure counts only when the error or one of its `cause`s is a `CommandError` (new, `bench/measure.ts`) of the command `docker` whose full stderr matches, case-insensitively, `address already in use` or `port is already allocated`. Everything else is not retried. That includes other Docker errors, readiness timeouts, request failures, allocation errors, a midnight double change and gating verdicts (verdicts are never thrown anyway). `CommandError` keeps the current message (`<command> <args> exited with <code>: <last 500 chars of stderr>`) and adds the fields `command`, `args`, `code` and the full `stderr`. So classification works even when the matching text is not in the last 500 characters.
5. **Terminal bind error.** When attempt 2 also fails with a bind failure, the phase throws `PortBindError` (name `PortBindError`, `cause` = the attempt-2 error). Its message is `host port bind failed twice: <phase> on <side> (ports <api>,<probe>,<status>,<notify>): <first stderr line that matches, at most 300 chars>`. `run.ts` prints it as `bench: host port bind failed twice: …` through the unchanged catch (`run.ts:339-344`) and exits `2`. It is no table row, no budget row and no regression row, and no `table.*` or `samples.json` is written. A recovered attempt-1 failure logs `[bench] bind retry: <phase> on <side>: host port in use, retrying once with new ports`. The run stays valid.
6. **Diagnostics per attempt.** A failed attempt 1 that is retried writes its stack dump to `failure-round<n>-<side>-<phase>-attempt1.log` in `--out`. Every other failure keeps `failure-round<n>-<side>.log`. A teardown failure is logged and never replaces the primary error, as today.
7. **Invocation identity.** Each `bun bench/run.ts` makes one invocation id: 12 lowercase hex characters from `node:crypto` random bytes (48 bits), logged as `[bench] invocation <id>`. It is used in every name of the invocation:
   - Compose project: `pulse-bench-<id>-<side>`, which also gives container names `pulse-bench-<id>-<side>-<service>` and `…-target`.
   - Image tags: `pulse-bench-<id>-<side>-<service>`, used by build, run and `imageSizeMB`.
   - Workspace: `.bench/<id>/` with the clones, worktrees, seeds and run directories of the invocation.

   Cleanup at the end of a run (success or error) only touches the invocation's own names. It removes its eight image tags (`docker image rm`, the shared `oven/bun` image is kept) and its workspace `.bench/<id>/`. The path must resolve under `<repo>/.bench/` and the id must match `^[0-9a-f]{12}$` before `rm -rf`. A cleanup failure is logged and does not change the exit code or the primary error. The harness never runs `compose down`, `image rm` or `rm` on a name of another invocation. There is no machine-wide lock: two invocations run their phases in parallel.
8. **Output directories.** `--out` keeps its default and its files. Parallel invocations must pass different `--out` directories; `bench/README.md` says so. The report keys, columns, files and verdict rules do not change.
9. **Concurrent proof versus budgets.** The proof is that both invocations complete every round and write `table.md`, `table.json` and `samples.json`, and neither prints `host port bind failed`. Exit `1` (a gating verdict from shared-machine noise) is reported, not fixed: budgets are not touched. Exit `2` or a missing report fails the proof. The self-tests prove the retry, because two lucky real runs do not.

## Scope

- In: `bench/` harness of pulse-api (port allocation, bind retry, invocation identity and cleanup), its self-tests, the `bench:selftest` script, and the three docs.
- Non-goals: changes to `bench/budgets.json`, `bench/baseline.json`, `bench/compare.ts`, the load, cold-read and end-of-day procedures (`bench/load.ts`, `bench/cold.ts`, `bench/eod.ts`, `bench/seed.ts`, `bench/fixtures.ts`, `bench/runtime-*.ts`), the report format, `src/`, `test/`, dependencies, lint, type or test config, CI and `.github/workflows/bench.yml`. No other repository changes. No host sysctl changes.

## Performance impact

None expected for any metric in `bench/budgets.json`. The change touches only harness code that runs outside the measured windows: allocation runs before `compose up`, and the `startup_*` clocks start at `up` (`stack.ts:187`). It leaves services, images and tests alone.
- `startup_cpu_ms`, `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`, `build_cpu_s`: unchanged (no service, image or build change).
- `test_cpu_s` of api: unchanged. `bun run test` (`package.json:15`) runs `bun test`, which loads `*.test.ts` only. The bench files and `bench/selftest/check-*.ts` are not loaded. Measured anyway (see the api section): five interleaved runs, expected delta within noise (|delta| < 10 %).
- Reported `startup_wall_ms`, p95 latencies, `rps`, `image_mb`: unchanged. The image content is the same; only its tag has the invocation id.
- Harness wall time, which is not a metric, grows by the fresh clones of each invocation (seconds to a minute). It shrinks for parallel runs that no longer fail.
- The bench itself is run only for the concurrent proof. Its metrics are not performance evidence, because two benches share one machine.

## Security impact

Security impact: yes. The change adds recursive deletes and Docker image removal by a computed name, and an error text that carries external data (Docker stderr).

Checklist items that apply:
- **Atomic, path-safe writes and deletes:** `rm -rf` only on `<repo>/.bench/<id>` after checking the id pattern and that the resolved path is under `<repo>/.bench/`. `docker image rm` only on the eight tags that this invocation built. `compose down` only on its own project. A hostile or malformed id (`..`, `/`, empty, upper case) is refused.
- **Secrets in errors and logs:** `PortBindError` carries at most one matching stderr line (300 chars) plus the ports, side and phase. No env values, tokens (`BENCH_ADMIN_TOKEN`, service token secrets) or config contents. The full stderr stays on `CommandError.stderr` for classification and is not printed further than today's 500-character tail.
- **Input validation:** the content of `ip_local_port_range` is parsed strictly (two integers 1-65535, low <= high); anything else is a harness error, not a silent default.
- **Dependency pins:** no new dependency. Only `node:crypto`, `node:net` and `node:fs` built-ins.

## Rollout order

One repository: only `pulse-api`'s `bench/` changes. No other repository consumes the bench, its Compose file or its names. A grep of all clones for `pulse-bench` finds only `api/bench/stack.ts` and `api/bench/compose.bench.yaml`. The nightly workflow `.github/workflows/bench.yml` calls `bun bench/run.ts … --out bench-out` and keeps working unchanged.

## Counterexamples

- **Ephemeral range (literal ranges):**
  - `32768 60999`: all 2000 blocks of 20000-29999 are candidates.
  - `25000 60999`: only blocks with guard 20000-24995 are candidates. Block 999 (24995-24999) is in; block 1000 (25000-25004) is out.
  - `24998 60999`: block 999 (24995-24999) is out because ports 24998 and 24999 lie in the range. Checking only the guard would wrongly accept it.
  - `1024 65535`: no candidate, error `no bench port block in 20000-29999 outside the ephemeral range 1024-65535`.
  - `60999 32768`, `abc`, an empty file: harness error, never a default.
- **Allocation:**
  - The guard of block 0 is taken: skip to block 1.
  - The guard is free but the status port 20003 is taken: free guard 20000 and go to the next block. A wrong implementation that keeps the guard leaks the block.
  - Two allocators with the same random start on one fake socket table get blocks 0 and 1, never both 0.
  - A retry after a failure on block 7 never gets block 7, even if it is free again.
  - All candidates are taken: error after trying each block once. No endless loop.
- **Retry count:**
  - bind, ok: two attempts, one result.
  - bind, bind: two attempts, then `PortBindError`; a third attempt is a defect.
  - ok on attempt 1: one attempt, one allocation.
  - bind in `load`, then bind in `cold` of the same side and round: each phase has its own allowance, so the run passes.
- **Classification:**
  - `docker compose … up` with stderr `Error response from daemon: driver failed programming external connectivity on endpoint pulse-bench-0a1b2c3d4e5f-b-api: Bind for 127.0.0.1:20001 failed: port is already allocated` is retried.
  - `… failed to bind host port for 127.0.0.1:20006:172.18.0.3:9100/tcp: address already in use` is retried.
  - The same text followed by 600 characters of other stderr is still retried: tail-only matching fails here.
  - `docker … up` with `no space left on device` is not retried. Neither is `api was not ready within 120 s`, `GET /checks answered 500`, a `git` `CommandError` whose stderr says `address already in use`, or `no free bench port block in 20000-29999`.
- **Samples:** a recovered load phase adds exactly one value per metric for that side and round (for example `samples.a.api.load_cpu_s.length === rounds`). Adding the failed attempt's partial values, or none, is wrong.
- **Identity:**
  - Two invocations with ids `0a1b2c3d4e5f` and `ffeeddccbbaa` on side `a` give projects `pulse-bench-0a1b2c3d4e5f-a` and `pulse-bench-ffeeddccbbaa-a`, and images `…-a-api`.
  - The old fixed `pulse-bench-a` must not appear.
  - Cleanup of one invocation never names the other's id.
  - Ids `../x`, `0A1B2C3D4E5F` and `` are refused by the cleanup.
- **Statistics (test-CPU only):** a sample is user + system CPU seconds of one `bun run test` in api, from `/usr/bin/time -f '%U %S'` (sum of both). There are five samples per version, interleaved base, branch, base, branch, … (ten runs). The median of five is the 3rd smallest. The delta is `median(branch) - median(base)` in seconds, rounded to 0.01 s, and in percent `delta / median(base) * 100`, rounded to 0.1. No percentile is used or averaged.

## Contract fields

No contract or config names. New harness-internal names in pulse-api only:
- Env vars of `bench/compose.bench.yaml`: `BENCH_API_PORT`, `BENCH_PROBE_PORT`, `BENCH_STATUS_PORT`, `BENCH_NOTIFY_PORT`.
- Error classes `CommandError`, `PortBindError`; the constant `BIND_ATTEMPTS`.
- Modules `bench/ports.ts`, `bench/bind-retry.ts`, `bench/side-round.ts`.
- Phase names `load`, `cold`, `eod`.
- The project and image pattern `pulse-bench-<id>-<side>`, and the log texts `host port bind failed twice` and `bind retry:`.

Collision search, run in `.target/.repos`. Every search printed no match:

```sh
for n in BENCH_API_PORT BENCH_PROBE_PORT BENCH_STATUS_PORT BENCH_NOTIFY_PORT PortBindError CommandError withBindRetry allocatePorts side-round bind-retry ports.ts "host port bind failed"; do
  grep -rn "$n" contract/src config api/bench api/src api/package.json
done
grep -rln pulse-bench .   # only api/bench/stack.ts and api/bench/compose.bench.yaml
```

## Repository: api

Files:
- `bench/compose.bench.yaml` (changed)
- `bench/measure.ts` (changed: `CommandError` only)
- `bench/stack.ts` (changed: identity and ports wiring only)
- `bench/run.ts` (changed: invocation id, workspace, cleanup, `measureStack` moved out)
- `bench/ports.ts` (new)
- `bench/bind-retry.ts` (new)
- `bench/side-round.ts` (new)
- `bench/selftest/check-command-error.ts` (new)
- `bench/selftest/check-ports.ts` (new)
- `bench/selftest/check-bind-retry.ts` (new)
- `bench/selftest/check-side-round.ts` (new)
- `package.json` (changed: `bench:selftest` only)
- `bench/README.md` (changed)
- `README.md` (changed)
- `docs/development.md` (changed)

Behavior change: yes. The bench harness changes how it publishes ports, names its stacks, workspaces and images, and handles a bind failure.

### Tool facts (verified)

- Bun 1.4.0: `package.json:8-10` (`engines`) and `packageManager`. CI uses `bun-version: 1.4.0` (`.github/workflows/ci.yml:30`; pinned `check.yml:24` at `04108fa`).
- `bun run check` = `bun run lint && bun run typecheck && bun run test` (`package.json:20`). `lint` = `biome check . && pulse-eslint . && pulse-workflows` (`package.json:16`). `typecheck` uses `typescript7` `tsc --noEmit` (`package.json:14`).
- `tsconfig.json:3` includes `bench`, so the new modules and self-tests are typechecked.
- Biome: `biome.json:2` extends `@lorenzh/pulse-config/biome.json`. At pin `04108fa` that file includes `**` (lines 10-17) with `vcs.useIgnoreFile: true` (lines 3-7), so `bench/**` is linted and `.bench/` (`.gitignore`) is not. The `noNonNullAssertion` override applies only to `**/*.test.ts` and `**/test/**` (lines 53-63), not to `bench/selftest/`. The pinned file equals the config clone.
- ESLint: `eslint.config.js` ignores only `.repos/**`, `.bench/**` and `bench-out/**`. The pinned base config `eslint.config.js:16` at `04108fa` sets `sonarjs/cognitive-complexity` to 15 for `**/*.ts` (line 11). It equals the clone.
- Tests: `bunfig.toml` `[test]` sets coverage on with lines 0.8. `bun test` runs `*.test.ts` only, so self-tests are not part of `bun run test`.
- CI `bench-selftest` job (`.github/workflows/ci.yml:20-33`) runs `bun run bench:selftest` (`:32`) and `docker compose -f bench/compose.bench.yaml config --quiet` (`:33`). The `check` job uses the pinned `check.yml` (`ci.yml:18`), which runs lint (`check.yml:27-28`), typecheck (`:29-30`) and test (`:37-38`).
- `bench:selftest` is an explicit `&&` chain of ten scripts (`package.json:18`).

### Required behavior

1. `bench/compose.bench.yaml`:
   - The four `ports` entries become `"127.0.0.1:${BENCH_API_PORT:-}:3000"`, `"127.0.0.1:${BENCH_PROBE_PORT:-}:9100"`, `"127.0.0.1:${BENCH_STATUS_PORT:-}:8080"` and `"127.0.0.1:${BENCH_NOTIFY_PORT:-}:9100"`. An unset variable gives today's `127.0.0.1::<port>`, so `config --quiet` in CI still passes.
   - The four `image:` lines become `${BENCH_PROJECT:-pulse-bench}-<service>`. `BENCH_SIDE` is then unused and can be dropped from `stackEnv`.
   - Nothing else in the file changes: healthchecks, volumes, env and `depends_on` stay as they are.
2. `bench/measure.ts`:
   - Add an exported `CommandError extends Error` with `name = "CommandError"` and the readonly fields `command`, `args`, `code` and `stderr` (full).
   - `runChecked` throws it with today's message text.
   - The parsers, `median`, `percentile`, `runCommand` and `readContainerProcess` do not change.
3. `bench/ports.ts`: the allocation of decision 1.
   - Pure parts: `parseEphemeralRange(text)` and the candidate-block computation.
   - The allocator takes injected `listen(port) => Promise<{ close(): Promise<void> } | null>` (`null` = in use), `random()`, the ephemeral range and an `exclude` set of blocks. It returns a lease `{ block, ports: { api, probe, status, notify }, release() }`.
   - The real `listen` uses `node:net` on `127.0.0.1`. Only `run.ts` wires the real dependencies.
4. `bench/bind-retry.ts`:
   - `isPortBindFailure(err)` walks the `cause` chain as in decision 4.
   - `PortBindError` and `BIND_ATTEMPTS = 2`.
   - The attempt loop of decisions 2, 3 and 5 takes injected dependencies: allocate, remove the run directory, run the attempt with lease and failure-log path, and log. It releases the lease in a `finally` after each attempt.
5. `bench/side-round.ts`:
   - Exports `measureStack`, moved from `run.ts:230-273` with the same order of phases and the same `add(...)` calls and metric keys.
   - The three phase calls go through the attempt loop.
   - `runStack`, `runColdStack`, `runEodStack`, `imageSizeMB`, the allocator, directory removal and `log` come in as dependencies.
   - The `samples` and `missingOnA` logic stays the same, line for line apart from the dependency calls. Review it with `git diff --color-moved=zebra`.
6. `bench/stack.ts`:
   - `buildImages`, `imageSizeMB`, `runStack`, `runColdStack` and `runEodStack` take the stack identity (project and, for the phases, the lease ports) instead of computing `pulse-bench-${side}`.
   - `stackEnv` sets `BENCH_PROJECT` and the four `BENCH_*_PORT` values. Export it so the self-test can check it.
   - No other line of the procedures changes: `prepareRunDir`, `startServices`, waits, `IDLE_S`, load, sampling, dump and teardown stay as they are.
7. `bench/run.ts`:
   - Make the invocation id, log it and set `WORK_ROOT` to `.bench/<id>`.
   - Wire the real allocator: read `/proc/sys/net/ipv4/ip_local_port_range` once at start, and use `node:crypto` for the random start.
   - Call `measureStack` from `bench/side-round.ts`.
   - Run the cleanup of decision 7 in a `finally` around the run: image tags and workspace.
   - Parsing, ref resolution, report writing and exit codes (`0`, `1` verdict, `2` error) stay the same.
8. `package.json`: append the four new self-tests to `bench:selftest`. Nothing else in the file changes.
9. Docs, all three in the same change:
   - `bench/README.md`: in "Running it", the port strategy (range, blocks, the ephemeral-range filter and its errors, guard coordination, check, retry once with new ports, which errors count, the terminal `host port bind failed twice` exit `2`, the `-attempt1.log` file). Also the invocation id, `.bench/<id>/` and its removal at the end, separate `--out` for parallel runs, and the parallel-run command.
   - `bench/README.md`, "Reading a failure": the bind error and the attempt-1 log.
   - `bench/README.md`, "Self-tests": what the four new scripts cover.
   - `README.md`: one or two sentences beside the bench line (`README.md:74`) saying that runs can start in parallel on one machine, ports outside the ephemeral range, one retry on a bind failure, with a link to `bench/README.md`.
   - `docs/development.md` "Performance bench" (`:45-47`): the same short summary and the link to `../bench/README.md`.
   - `AGENTS.md` does not change: no command or convention changes.
10. New self-test files (`bench/selftest/check-*.ts`) use `node:assert/strict` and hand-written fakes. They use no Docker, no network, no module or global mocks, no real timers and no waiting. The only real process is the `sh` spawn of `check-command-error.ts`. Each file has exactly one comment line, naming what it tests and the expected outcome, and no other comment.
    - `check-command-error.ts`:
      - `runChecked("sh", ["-c", …])` writes `Bind for 127.0.0.1:20001 failed: port is already allocated` and then 600 `x` to stderr, and exits 1. Assert: a `CommandError` whose `stderr` contains the bind text and whose `message` ends with the last 500 chars.
      - It imports only `../measure.ts`, so it runs on the base and fails there because `stderr` is missing. This is the regression test for "classification sees the full stderr".
    - `check-ports.ts`: every allocation counterexample above with literal ports and ranges, and a release that frees the guard.
    - `check-bind-retry.ts`: the classification fixtures above (positive, negative, long stderr through a real `CommandError` and through a `cause` chain), plus the attempt loop:
      - bind then ok gives 2 attempts, 2 allocations, the second excluding the first block, and 2 run-directory removals before the attempts.
      - bind, bind gives `PortBindError` with side, phase, ports and the matching line, and exactly 2 attempts.
      - An unrelated error gives 1 attempt and the original error.
      - Leases are released after each attempt, also on error.
      - The attempt-1 log path is `failure-round1-b-load-attempt1.log`.
    - `check-side-round.ts`: drives `measureStack` from `bench/side-round.ts` with fake phase functions.
      - Load, three cases:
        - (a) Attempt 1 throws a `CommandError` for `docker compose … up -d --no-build api` with bind stderr, and attempt 2 succeeds: the phase recovers.
        - (b) Attempt 1 throws the same for the later services (`… up -d --no-build probe status notify`), and attempt 2 succeeds: the phase recovers.
        - (c) Attempt 1 fails at the api and attempt 2 at the later services: `PortBindError` naming `load` and the side, with no third attempt.
      - Cold: the `restart api` command fails once with bind stderr, then succeeds.
      - Eod: fails once, then succeeds.
      - Check that each phase gets a new lease with distinct ports, that samples hold exactly one value per metric, that no phase runs a third time, and that a non-bind error (readiness timeout) is not retried.
      - `stackEnv` for two identities gives distinct `BENCH_PROJECT` and ports with the literal values of the fixture.

### Checks and completion evidence

Record `BASE` (full SHA of api `main` at the start of the build) before any edit.

1. **Baseline controls on `BASE`.** Each must run and pass there; record command, SHA, status and output tail. They are `bun run bench:selftest` (the ten existing scripts), `docker compose -f bench/compose.bench.yaml config --quiet` and `bun run check`. If one does not pass on `BASE`, stop and hold: it is not a baseline control.
2. **Regression tests red on `BASE`, three times each in isolation, for the stated reason:**
   - `bun bench/selftest/check-command-error.ts` with the branch file copied into a `BASE` worktree fails on the assertion about `stderr` (not an import error). Show the assertion text from each of the three runs.
   - The compose identity and port driver, run in the `BASE` worktree and then on the branch:

     ```sh
     BENCH_PROJECT=pulse-bench-0a1b2c3d4e5f-a BENCH_API_PORT=20001 BENCH_PROBE_PORT=20002 BENCH_STATUS_PORT=20003 BENCH_NOTIFY_PORT=20004 \
       docker compose -f bench/compose.bench.yaml config --format json \
       | jq -c '[.services.api.image, .services.api.ports[0].published, .services.probe.ports[0].published, .services.status.ports[0].published, .services.notify.ports[0].published, .services.api.container_name]'
     ```

     The expected output on the branch is the literal `["pulse-bench-0a1b2c3d4e5f-a-api","20001","20002","20003","20004","pulse-bench-0a1b2c3d4e5f-a-api"]`. On `BASE` the image is `pulse-bench-a-api` and the published ports are missing, so the comparison with the literal fails three times.

     The spec run checked this with the Compose of Docker 28.0.4:
     - On api `515031b` the driver printed `["pulse-bench-a-api",null,null,null,null,"pulse-bench-0a1b2c3d4e5f-a-api"]`.
     - A trial copy of the file with `127.0.0.1:${BENCH_API_PORT:-}:3000` printed `"published":"20001"` (a string) with the variable set, and passed `config --quiet` with it unset.

     If the installed Compose prints `published` as a number, write the literal with numbers and say so.
   - The other new scripts test new modules. Their red on `BASE` would be only a missing import, which the rules do not count as evidence. Say this in the PR and show them green on the branch.
3. **Branch green:**
   - `bun run bench:selftest` (14 scripts), the compose `config --quiet`, the driver above (literal match) and `bun run check` all pass on the final branch.
   - Show the output of `bun run bench:selftest` with each new script's exit status.
4. **Concurrent Docker proof on the factory runner.** The exception of this issue applies: only this proof runs the Docker bench. From one checkout of the final branch, start two invocations at the same time:

   ```sh
   API=<api main SHA, full>
   ( bun bench/run.ts --a "$API" --b "$API" --others-ref main --rounds 1 --out /tmp/bench-834-1 > /tmp/bench-834-1.log 2>&1; echo "exit $?" >> /tmp/bench-834-1.log ) &
   ( bun bench/run.ts --a "$API" --b "$API" --others-ref main --rounds 1 --out /tmp/bench-834-2 > /tmp/bench-834-2.log 2>&1; echo "exit $?" >> /tmp/bench-834-2.log ) &
   while [ "$(jobs -r | wc -l)" -gt 0 ]; do date -u +%FT%TZ; docker ps --format '{{.Names}} {{.Ports}}' | grep pulse-bench; sleep 30; done; wait
   ```

   - Record the harness commit, `API`, the `ref <repo> a=… b=…` lines of both logs, start and end times, the two `invocation <id>` lines and both exit codes.
   - Record the `docker ps` snapshots. At least one snapshot must show both ids live at once, with disjoint host ports in 20000-29999.
   - Pass when both logs end with `exit 0` or `exit 1`, both `--out` directories hold `table.md`, `table.json` and `samples.json`, and neither log has `host port bind failed`.
   - Report every `bind retry:` line (expected none) and every `FAIL` row of an exit 1 as noise of the shared machine. Do not change budgets.
   - After both runs, `docker ps -a --filter name=pulse-bench-<id>` and `docker images 'pulse-bench-<id>-*'` are empty for both ids, and `.bench/<id>` is gone for both.
   - If Docker or the runner is not available, record the concrete blocker and do not claim this check.
5. **Test CPU:** five interleaved runs of `bun run test` in api, `BASE` and branch alternating (ten runs), as defined under Counterexamples. Report raw samples, both medians and the delta in seconds and percent. Never run it at the same time as the benches.
6. **Docs:** quote the changed paragraphs of `bench/README.md`, `README.md` and `docs/development.md`, and check each statement against the code. The range, block size, attempt count, error texts and file names must match the literals of this spec.
7. **Scope, after the last commit, against `BASE`:**
   - `git diff --name-only "$BASE" HEAD | sort` equals exactly the sorted 15 paths of `Files:` above.
   - `git diff --name-only --cached` is empty, `git diff --name-only` is empty and `git status --porcelain` is empty, each checked on its own.
   - `git diff --exit-code "$BASE" HEAD -- bench/budgets.json bench/baseline.json bench/compare.ts bench/cold.ts bench/eod.ts bench/load.ts bench/seed.ts bench/fixtures.ts bench/fixtures bench/runtime-fixture.ts bench/runtime-traffic.ts bench/refs.ts bench/cold-read.ts bench/eod-read.ts bench/today-parity.ts bench/uptime-parity.ts bench/selftest/check-compare.ts bench/selftest/check-budgets.ts bench/selftest/check-refs.ts bench/selftest/check-measure.ts bench/selftest/check-load.ts bench/selftest/check-missing-route.ts bench/selftest/check-cold.ts bench/selftest/check-eod.ts bench/selftest/check-runtime-fixture.ts bench/selftest/check-runtime-traffic.ts src test bun.lock biome.json tsconfig.json bunfig.toml eslint.config.js lefthook.yml .github Dockerfile .dockerignore .gitignore AGENTS.md CLAUDE.md scripts` passes.
   - `git diff "$BASE" HEAD -- package.json` changes only the `bench:selftest` line.
   - Prove the guard in a throwaway `mktemp -d` repository fixture, which is not committed to api. An allowed change passes. A protected change and an unlisted change each fail separately when committed, when staged and when unstaged. Include both restored-worktree traps: (a) stage a protected edit, then `git restore --worktree` it to base; (b) commit a protected edit, then `git checkout "$BASE" -- <file>` and `git restore --staged`. Show that the `--cached` and `"$BASE" HEAD` checks still reject both, while a worktree-only `git diff` misses them.
   - Show the real check on the api branch as well.
8. **Comments:** read every added line of the diff, including inline comments in the changed source files. The PR body lists every added comment, or says `none` only after that read. Each new self-test file has exactly its one header line.
9. **Handoff:** the PR body holds `Closes lorenzh/pulse-meta#<child>`, `BASE`, the baseline, red and green results, the concurrent proof, the test-CPU table, the docs check and the scope checks. It contains no secrets, tokens or private runner details: write host ports and container names, but not host names or IPs other than `127.0.0.1`.

## Risks

- **The runner's ephemeral range may cover 20000-29999.** Then every run fails at once with the explicit `no bench port block …` error (exit `2`), not with a random collision. The concurrent proof shows this on the factory runner. The machine that wrote this spec has `32768 60999`.
- **A non-bench service may listen on many ports in 20000-29999.** The check skips those blocks. Exhaustion is a clear error.
- **Docker without the userland proxy** (iptables only) does not show published ports to the listen check. Guards still keep benches apart, and Docker's `port is already allocated` plus the retry covers other containers.
- **Per-invocation clones** cost network and time on every run. That is accepted for isolation; the nightly hosted runner clones fresh anyway.
- **Moving `measureStack`** could change sample order or keys by mistake. The `--color-moved` review and `check-side-round.ts`, which checks the exact metric keys and one value per metric, cover it.
