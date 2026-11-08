# Spec #834: api: make the Docker bench robust against taken host ports

## Goal

The Docker bench of pulse-api (`bun bench/run.ts`) must not fail because a host port is taken. Two benches started at the same time on one machine must both finish without a bind error. Today the bench lets Docker pick random host ports from the host's ephemeral range. It also uses fixed Compose project names, fixed image tags and one shared workspace, so parallel runs collide.

## Sources

- Issue #834 body and its added requirements, and the issue comments: the issue review, the first plan, the breakdown, and the plan review that found three defects. This revision fixes them:
  1. Teardown is not confirmed before a retry (`bench/stack.ts:293-300,327-332,351-357` only log a failed `compose down`). Fixed by decision 4 (confirmed teardown) and its forced teardown-failure self-tests.
  2. `stackEnv` was to be exported only for a test, against api `AGENTS.md:72`. Fixed: `stackEnv` stays private. Every new export has a production caller (see "Exports and their production callers" in the api section).
  3. The collision search left out names. Fixed: the search under "Contract fields" covers every new name, module, file, env var and log text. It found a real collision: `CommandError` already exists in pulse-deploy (`deploy/cli/docker.ts:31`), so the new class is `CommandExitError`.
- The second plan review found two more defects. This revision fixes them:
  4. The end-of-day day-change retry reseeds without confirmed teardown. `runEodPhase` (`bench/eod.ts:187-208`) calls `seed` again after a UTC day change, and the seed callback in `runEodStack` removes the run directory first (`bench/stack.ts:362`), even when the `down()` in `measure`'s `finally` (`stack.ts:351-358,381-383`) failed. The outer confirmation runs only after the whole phase, too late. Fixed by decision 4a: a new `withConfirmedReseed` wrapper in `bench/bind-retry.ts` confirms the teardown before every `seed` call. `runEodStack` in `stack.ts` is authorized to use it (Required behavior 7). `bench/eod.ts` stays unchanged. `check-bind-retry.ts` drives the real `runEodPhase` with a deterministic day change and a failed teardown.
  5. The breakdown asked `check-side-round.ts` to check `stackEnv` fixtures, although that script uses fake phase functions and cannot reach `stackEnv`. Fixed: `check-side-round.ts` checks only what reaches its fakes (the `StackIdentity` and the confirmation closure). It must not claim any `stackEnv` check. The `stackEnv` path is proved only by the three production-boundary checks under "Exports and their production callers".
- `.factory/work/834/issue-review.md`: no blocking questions. Open points 1-8 are resolved below.
- Shared findings: `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/834` answered `HTTP 404` again in this run. There are no findings yet, which is normal for a feature without children.
- Read-only clones: api at `515031bd3fd2aa6b8993e325b24ab08f4a3510d6`, config at `bc870498cc8e2539a132ce2aac35a09db1deabd8`. The pinned config files `biome.json`, `eslint.config.js` and `.github/workflows/check.yml` at `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` were read with `gh api` in the first plan run and do not differ from the clone.
- Related: #831 (api child of #815) hit the error three times. A manager decision there moved the port fix to this issue. This issue does not redo #831's work.

## Current behavior (api `515031b`)

- `bench/compose.bench.yaml:27,43,62,87` publish api, probe, status and notify as `127.0.0.1::<container port>`. Docker picks each host port from the ephemeral range (`/proc/sys/net/ipv4/ip_local_port_range`, which is `32768 60999` on the machine that wrote this spec). The host's own outgoing connections use the same range, so a picked port can already be taken.
- `bench/compose.bench.yaml:6,15,34,53,71,94` and `bench/stack.ts:99,217,315,347` use the fixed project `pulse-bench-<side>` and the container names `pulse-bench-<side>-<service>`. The image tags are `pulse-bench-${BENCH_SIDE}-<service>` (`compose.bench.yaml:14,33,52,70`, `stack.ts:109`). Two benches on one Docker daemon share all of them.
- `bench/run.ts:56` uses one workspace `.bench/` per checkout. The shared clones use `FETCH_HEAD` (`:161`), and fixed paths are deleted (`:169,188,238,260,264`). Two runs from one checkout overwrite each other's files.
- The cold-read phase restarts the api twice through `composeTarget` (`bench/cold.ts:289-301`, `docker compose restart api`). With a port that Docker picks, every restart binds a new random host port.
- `runChecked` (`bench/measure.ts:75-87`) throws a plain `Error` that keeps only the last 500 characters of stderr. `bench/run.ts:339-344` turns any thrown error into exit `2`. A gating verdict gives exit `1` (`:329-331`).
- The end-of-day phase has its own inner retry: when the UTC day changes during the phase, `runEodPhase` (`bench/eod.ts:187-208`) runs `seed` and `measure` once more. `seed` in `runEodStack` starts with `rm(runDir, { recursive: true, force: true })` (`bench/stack.ts:361-362`). `measure` ends with `down()` in its `finally` (`stack.ts:381-383`), and `down()` only logs a failure (`stack.ts:351-358`). So after a failed `down`, the reseed deletes the run directory under a container that may still run.
- There is no retry on a bind failure. A failed stack writes `docker compose ps -a` and the logs to `failure-round<n>-<side>.log` (`stack.ts:288-290,323-325,378-380`). Then the phase's `finally` runs `compose down -v --remove-orphans -t 5`. A failed `down` is only logged (`stack.ts:293-300,327-332,351-357`), so containers can stay behind without anyone checking.
- `run.ts:339-344` ends the process with `process.exit`, so an open socket does not keep it alive.

## Decisions (the open points of the issue review)

1. **Port strategy: both.** The harness picks explicit host ports from a range outside the host's ephemeral range and checks them before use. If Docker still reports a bind failure, the harness retries the failed phase once with new ports. `bench/README.md` says so.
   - Candidate range: `20000-29999`, in blocks of five consecutive ports. Block `k` (0-1999) has guard port `20000 + 5k`, then the api, probe, status and notify ports at `+1` to `+4`.
   - The harness reads the ephemeral range from `/proc/sys/net/ipv4/ip_local_port_range` once at start. It uses only blocks whose five ports all lie outside that range. If the file cannot be read or parsed, that is a harness error (exit `2`). The harness never assumes a default range and never changes a sysctl. If no block lies outside the range, the error is `no bench port block in 20000-29999 outside the ephemeral range <low>-<high>` (exit `2`). This is raised at start, before any clone.
   - Coordination: a run reserves a block by listening on its guard port at `127.0.0.1`. It holds that listener until the phase's teardown is confirmed (decision 4). Another allocator, in the same process or another one, cannot listen on the guard, so it skips the block. The kernel frees the guard when a process dies, so no lock file can go stale.
   - Check: after taking the guard, the harness listens on each of the four service ports at `127.0.0.1` and closes the socket at once. If any listen fails, it frees the guard and tries the next block.
   - Order: start at a random block (the random source is injected) and scan forward with wrap-around. Each candidate is tried at most once per allocation. If no block is left, the error is `no free bench port block in 20000-29999` (exit `2`, not retried).
   - Gap between the check and Docker's bind: the retry below closes it. The kernel does not hand out ports outside the ephemeral range for outgoing connections. Docker also refuses a host port that another container already publishes (`port is already allocated`). So a race between the check and the bind ends in a bind failure, which the retry handles. It never ends with two stacks sharing a port.
   - Explicit ports also keep the host port across `docker compose restart api` in the cold-read phase. `bench/cold.ts` keeps reading the port with `docker compose port` and does not change.
2. **Retry boundary and count.** The unit is one phase call for one side in one round. There are three phases: `load` (`runStack`), `cold` (`runColdStack`) and `eod` (`runEodStack`). Each phase call runs at most two attempts (the private constant `BIND_ATTEMPTS = 2`). Attempt 2 runs only when attempt 1 failed with a port bind failure (decision 5) and its teardown is confirmed (decision 4). A nested helper never retries on a bind failure. The end-of-day day-change retry inside `runEodPhase` (`bench/eod.ts:187-208`) is not a bind retry: `bench/eod.ts` stays unchanged, and the day-change retry runs inside each attempt. Its reseed now waits for a confirmed teardown (decision 4a).
3. **Fresh attempt.** Before each attempt, the harness removes the phase's run directory, as `run.ts:238,260,264` does today. The phase function then rebuilds it from the side's untouched seed (`prepareRunDir`, or the eod `seed`). The load phase creates its runtime tokens again on the new api. Attempt 2 gets a new block that excludes the failed block. Samples of a failed attempt are dropped: only the result of the successful attempt is added to `samples`, so every metric gets exactly one value per side and round. Seeds, warm-up, the idle and load windows, settle, restart order, routes, cycle counts and metric definitions do not change.
4. **Confirmed teardown.** The phase functions keep their own `finally` with `compose down` and its log line, unchanged. After every attempt (success, bind failure or other failure), the attempt loop runs `confirmTeardown` for the phase's project, before anything else happens:
   - `docker ps -a -q --filter label=com.docker.compose.project=<project>`. Exit `0` with empty output means confirmed.
   - If containers are listed, run `docker compose -f <compose file> -p <project> down -v --remove-orphans -t 5` once more, then list again. Empty means confirmed.
   - Otherwise the teardown is not confirmed. The reason is `docker ps exited with <code>` or `<n> containers remain after compose down (exit <code>)`.
   - The harness releases the lease (guard) and runs the next step only when the teardown is confirmed. The next step is: remove the run directory and start attempt 2, return the result, or rethrow.
   - Not confirmed: log `teardown not confirmed: <phase> on <side> (project <project>): <reason>`. The lease is **not** released, and the run directory is **not** removed. Then:
     - after a bind failure in attempt 1: no attempt 2. The phase throws `PortBindError` with the message `host port bind failed, retry skipped because teardown was not confirmed: <phase> on <side> (ports <api>,<probe>,<status>,<notify>): <bind line>`, with `cause` set to the attempt-1 error;
     - after a successful attempt: the phase throws `TeardownError` with the message `teardown not confirmed: <phase> on <side> (project <project>): <reason>`. The next phase reuses the project name, so leftover containers would corrupt its numbers. This is new: today the run goes on;
     - after any other failure (including a second bind failure): the primary error is rethrown unchanged (`PortBindError` "failed twice", or the original error). The teardown failure is only logged and never replaces the primary error.
   - The process then ends with exit `2` through `run.ts:339-344`. `process.exit` frees the held guards.
   - Final cleanup (decision 8) checks both side projects with `confirmTeardown` again. If one is not confirmed, the cleanup removes no image and no directory. It logs `cleanup skipped: containers of <project> remain; kept .bench/<id> and its images`. So no workspace is deleted under a running container.

   4a. **Confirmed teardown before every end-of-day seed.** The inner day-change retry of `runEodPhase` deletes the run directory in `seed` (`stack.ts:362`). So `seed` must not run before the teardown is confirmed.
   - New export `withConfirmedReseed(phase, { confirmTeardown, side, project })` in `bench/bind-retry.ts`. It takes an `EodPhase` (the type exported by `bench/eod.ts:176-181`) and returns an `EodPhase`. `measure` is passed through unchanged. Its `seed(now)` first awaits `confirmTeardown()`:
     - Confirmed: it calls the wrapped `seed(now)` and returns its value.
     - Not confirmed: it throws `TeardownError` with the message `teardown not confirmed: eod on <side> (project <project>): <reason>`. The wrapped `seed` is not called, so the run directory is not removed.
   - It confirms before every `seed` call, the first one too. The first check finds no containers, because the outer loop confirmed the previous attempt or phase on the same project. It costs one `docker ps`.
   - The check runs inside `seed`, before the copy of the seed database. That is before `measure`, so it is outside every measured window. `runEodPhase` takes `seededAt` before it calls `seed`, as today, so the day-change rule does not change.
   - In `runEodStack` only the argument of `runEodPhase` changes: the `{ seed, measure }` object is wrapped with `withConfirmedReseed`. The bodies of `seed` and `measure`, `down()`, the dump and the log lines stay as they are.
   - `runEodStack` gets the check as a new parameter `confirmTeardown: () => Promise<TeardownCheck>`. `side-round.ts` passes `() => deps.confirmTeardown(project)` with the phase's project.
   - A `TeardownError` from the reseed is not a bind failure (decision 5). The outer `withBindRetry` handles it as "any other failure": it confirms again, logs if that fails too, and rethrows the `TeardownError`. Exit `2`.
5. **What counts as a bind failure.** A failure counts only when the error, or one of its `cause`s, is a `CommandExitError` (new, `bench/measure.ts`) of the command `docker` whose full stderr matches, case-insensitively, `address already in use` or `port is already allocated`. Nothing else is retried: other Docker errors, readiness timeouts, request failures, allocation errors, `TeardownError`, a second change of the UTC day, and gating verdicts (verdicts are never thrown anyway). `CommandExitError` keeps today's message (`<command> <args> exited with <code>: <last 500 chars of stderr>`) and adds the readonly fields `command`, `args`, `code` and the full `stderr`. So classification works even when the matching text is not in the last 500 characters.
6. **Terminal bind error.** When attempt 2 also fails with a bind failure, the phase throws `PortBindError` (name `PortBindError`, `cause` = the attempt-2 error). Its message is `host port bind failed twice: <phase> on <side> (ports <api>,<probe>,<status>,<notify>): <first stderr line that matches, at most 300 chars>`. `run.ts` prints it as `bench: host port bind failed twice: …` through the unchanged catch (`run.ts:339-344`) and exits `2`. It is not a table row, a budget row or a regression row, and no `table.*` or `samples.json` file is written. A recovered attempt-1 failure logs `bind retry: <phase> on <side>: host port in use, retrying once with new ports` (printed with the `[bench] ` prefix of `log`). The run stays valid.
7. **Diagnostics per attempt.** When attempt 1 fails and a retry follows, it writes its stack dump to `failure-round<n>-<side>-<phase>-attempt1.log` in `--out`. Every other failure keeps `failure-round<n>-<side>.log`.
8. **Invocation identity and cleanup.** Each `bun bench/run.ts` makes one invocation id: 12 lowercase hex characters from 6 `node:crypto` random bytes (48 bits). It logs `invocation <id>` and uses the id in every name of the run:
   - Compose project: `pulse-bench-<id>-<side>`. This also gives the container names `pulse-bench-<id>-<side>-<service>` and `…-target`.
   - Image tags: `pulse-bench-<id>-<side>-<service>`, used by build, run and `imageSizeMB`.
   - Workspace: `.bench/<id>/` with the run's clones, worktrees, seeds and run directories.

   At the end of a run (success or error), the cleanup touches only the run's own names. It first confirms the teardown of both projects (decision 4). Only then does it remove the eight image tags (`docker image rm`; the shared `oven/bun` image is kept) and the workspace `.bench/<id>/`. Before the `rm -rf`, the id must match `^[0-9a-f]{12}$` and the path must resolve to exactly `<repo>/.bench/<id>`. A cleanup failure is logged and changes neither the exit code nor the primary error. The harness never runs `compose down`, `image rm` or `rm` on a name of another run. There is no machine-wide lock, so two runs execute their phases in parallel.
9. **Output directories.** `--out` keeps its default and its files. Parallel runs must pass different `--out` directories, and `bench/README.md` says so. The report keys, columns, files and verdict rules do not change.
10. **Concurrent proof and budgets.** The proof passes when both runs complete every round and write `table.md`, `table.json` and `samples.json`, and neither prints `host port bind failed` or `teardown not confirmed`. Exit `1` (a gating verdict from shared-machine noise) is reported, not fixed, and budgets are not touched. Exit `2` or a missing report fails the proof. The self-tests prove the retry and the teardown handling, because two lucky real runs do not.

## Scope

- In: the `bench/` harness of pulse-api (port allocation, bind retry, confirmed teardown, run identity and cleanup), its self-tests, the `bench:selftest` script, and the three docs.
- Non-goals: changes to `bench/budgets.json`, `bench/baseline.json`, `bench/compare.ts`, the load, cold-read and end-of-day procedures (`bench/load.ts`, `bench/cold.ts`, `bench/eod.ts`, `bench/seed.ts`, `bench/fixtures.ts`, `bench/runtime-*.ts`), the report format, `src/`, `test/`, dependencies, lint, type or test config, CI and `.github/workflows/bench.yml`. No other repository changes, and no host sysctl changes.

## Performance impact

None expected for any metric in `bench/budgets.json`. The change touches only harness code that runs outside the measured windows: allocation and teardown confirmation run before `compose up` and after `compose down`, and the `startup_*` clocks start at `up` (`stack.ts:187`). Services, images and tests stay the same.
- `startup_cpu_ms`, `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`, `build_cpu_s`: unchanged (no change to a service, image or build).
- `test_cpu_s` of api: unchanged. `bun run test` (`package.json:15`) runs `bun test`, which loads only `*.test.ts`. The bench files and `bench/selftest/check-*.ts` are not loaded. It is measured anyway (see the api section): five interleaved runs, with the delta expected within noise (|delta| < 10 %).
- Reported `startup_wall_ms`, p95 latencies, `rps`, `image_mb`: unchanged. The image content is the same; only its tag carries the run id.
- Harness wall time, which is not a metric, grows by the fresh clones of each run (seconds to a minute) and by one `docker ps` per phase attempt plus one per end-of-day seed (decision 4a), all outside the measured windows. Parallel runs no longer fail, which saves reruns.
- The bench runs only for the concurrent proof. Its metrics are not performance evidence, because two benches share one machine.

## Security impact

Security impact: yes. The change adds recursive deletes and Docker image and container removal by computed names, and error text that carries external data (Docker stderr).

Checklist items that apply:
- **Atomic, path-safe writes and deletes:** `rm -rf` runs only on `<repo>/.bench/<id>`, after checking the id pattern and that the resolved path is exactly that directory, and only after confirmed teardown. The run-directory deletes before an attempt (`withBindRetry`) and before every end-of-day seed (`stack.ts:362`, behind `withConfirmedReseed`) also run only after confirmed teardown of the phase's project. `docker image rm` runs only on the eight tags this run built. `compose down` and `docker ps --filter label=…` run only for its own two projects. A hostile or malformed id (`..`, `/`, empty, upper case, 11 or 13 characters) is refused before any command runs.
- **Secrets in errors and logs:** `PortBindError` carries at most one matching stderr line (300 chars), plus the ports, side and phase. `TeardownError` carries the project, a count and an exit code. Neither carries env values, tokens (`BENCH_ADMIN_TOKEN`, service token secrets) or config contents. The full stderr stays on `CommandExitError.stderr` for classification, and nothing prints more of it than today's 500-character tail.
- **Input validation:** the content of `ip_local_port_range` is parsed strictly (two integers 1-65535 separated by whitespace, low <= high). Anything else is a harness error, never a silent default.
- **Dependency pins:** no new dependency. Only the `node:crypto`, `node:net`, `node:fs` and `node:path` built-ins.

## Rollout order

One repository: only the `bench/` directory of `pulse-api` changes. No other repository uses the bench, its Compose file or its names. A grep of all clones for `pulse-bench` finds only `api/bench/stack.ts` and `api/bench/compose.bench.yaml`. The nightly workflow `.github/workflows/bench.yml` calls `bun bench/run.ts … --out bench-out` and keeps working unchanged.

## Counterexamples

- **Ephemeral range (literal ranges):**
  - `32768 60999`: all 2000 blocks of 20000-29999 are candidates.
  - `25000 60999`: only blocks with guard 20000-24995 are candidates. Block 999 (24995-24999) is in; block 1000 (25000-25004) is out.
  - `24998 60999`: block 999 (24995-24999) is out, because ports 24998 and 24999 lie in the range. A check of the guard alone would wrongly accept it.
  - `1024 65535`: no candidate. Error `no bench port block in 20000-29999 outside the ephemeral range 1024-65535`.
  - `60999 32768`, `abc`, `0 60999`, `32768 70000` and an empty file: harness error, never a default.
- **Allocation:**
  - The guard of block 0 is taken: skip to block 1.
  - The guard is free but status port 20003 is taken: free guard 20000 and go to the next block. A wrong implementation that keeps the guard leaks the block.
  - Two allocators with the same random start on one fake socket table get blocks 0 and 1, never both block 0.
  - A retry after a failure on block 7 never gets block 7, even if it is free again.
  - All candidates are taken: the error comes after each block was tried once. No endless loop.
- **Retry count:**
  - bind, then ok: two attempts, one result.
  - bind, bind: two attempts, then `PortBindError` "failed twice". A third attempt is a defect.
  - ok on attempt 1: one attempt, one allocation.
  - A bind failure in `load`, then one in `cold` of the same side and round: each phase has its own allowance, so the run passes.
- **Confirmed teardown (forced failures):**
  - A bind failure, then `docker ps` still lists a container after the second `compose down` (exit 1): no attempt 2, the run directory is removed only once (before attempt 1), the lease is not released, and the phase throws `PortBindError` "retry skipped because teardown was not confirmed". A wrong implementation that retries anyway, or releases the guard, is caught here.
  - `docker ps` exits 1 after a bind failure: the same outcome, with reason `docker ps exited with 1`.
  - A successful attempt with containers left over: `TeardownError`, no samples are added, and the lease is not released.
  - A readiness timeout with containers left over: the readiness error is rethrown unchanged (not `TeardownError`), and the teardown failure is logged.
  - `docker ps` lists one container, the second `compose down` succeeds, and the list is then empty: confirmed, and the retry goes ahead.
  - Final cleanup with containers left in `pulse-bench-<id>-b`: no `docker image rm` and no directory removal, only the `cleanup skipped` log line.
- **End-of-day reseed (decision 4a), with the real `runEodPhase` and a fake clock.** The literal times are `late` = `2026-11-08T23:59:30Z`, `next` = `2026-11-09T00:11:00Z`, `noon` = `2026-11-08T12:00:00Z`. The clock gives the check time, the seed time and the end time of each pass.
  - The day changes (`late`, `late`, `next`, then `next`, `next`, `next` + 60 s), and both checks are confirmed. Events: `confirm`, `seed(late)`, `measure`, `confirm`, `seed(next)`, `measure`. The result is the second one.
  - The day changes and the second check returns `{ isConfirmed: false, reason: "1 containers remain after compose down (exit 1)" }`. Then `TeardownError` with the message `teardown not confirmed: eod on b (project pulse-bench-0a1b2c3d4e5f-b): 1 containers remain after compose down (exit 1)`. There is exactly one `seed` (at `late`) and one `measure`. The base code, which reseeds after a failed `down`, gives a second `seed`, and this case rejects it.
  - No day change (`noon`, `noon`, `noon` + 60 s): one `confirm`, one `seed`, one `measure`.
  - The first check is not confirmed: `TeardownError`, and no `seed` and no `measure`.
  - A `TeardownError` from the reseed, given to `withBindRetry` as the error of attempt 1: exactly one attempt, and the same error is rethrown. It is never retried as a bind failure.
- **Classification:**
  - `docker compose … up` with stderr `Error response from daemon: driver failed programming external connectivity on endpoint pulse-bench-0a1b2c3d4e5f-b-api: Bind for 127.0.0.1:20001 failed: port is already allocated` is retried.
  - `… failed to bind host port for 127.0.0.1:20006:172.18.0.3:9100/tcp: address already in use` is retried.
  - The same text followed by 600 characters of other stderr is still retried. Matching only the tail fails here.
  - These are not retried:
    - `docker … up` with `no space left on device`;
    - `api was not ready within 120 s`;
    - `GET /checks answered 500`;
    - a `git` `CommandExitError` whose stderr says `address already in use`;
    - `no free bench port block in 20000-29999`;
    - a `TeardownError`.
- **Samples:** a recovered load phase adds exactly one value per metric for that side and round (for example `samples.a.api.load_cpu_s.length === rounds`). Adding the failed attempt's partial values, or adding none, is wrong.
- **Identity:**
  - Two runs with ids `0a1b2c3d4e5f` and `ffeeddccbbaa` on side `a` give the projects `pulse-bench-0a1b2c3d4e5f-a` and `pulse-bench-ffeeddccbbaa-a`, and the images `pulse-bench-0a1b2c3d4e5f-a-api` and so on.
  - The old fixed names `pulse-bench-a` and `pulse-bench-a-api` must not appear.
  - The cleanup of one run never names the other run's id.
  - The ids `../x`, `0A1B2C3D4E5F`, `0a1b2c3d4e5`, `0a1b2c3d4e5f0` and the empty string are refused by `workspaceDir` and the cleanup.
- **Statistics (test CPU only):** a sample is the user plus system CPU seconds of one `bun run test` in api, from `/usr/bin/time -f '%U %S'` (the sum of both). There are five samples per version, interleaved base, branch, base, branch, … (ten runs). The median of five is the 3rd smallest. The delta is `median(branch) - median(base)` in seconds, rounded to 0.01 s, and in percent `delta / median(base) * 100`, rounded to 0.1. No percentile is used or averaged.

## Contract fields

No contract or config names. New harness-internal names in pulse-api only:
- Env vars of `bench/compose.bench.yaml`: `BENCH_API_PORT`, `BENCH_PROBE_PORT`, `BENCH_STATUS_PORT`, `BENCH_NOTIFY_PORT`. `BENCH_SIDE` is removed. `BENCH_PROJECT` already exists and now also names the images.
- Error classes: `CommandExitError` (`bench/measure.ts`, exported), `PortBindError`, `TeardownError`, `PortAllocationError` (private to their modules, tested by `name`).
- Constant: `BIND_ATTEMPTS` (private).
- Functions and types:
  - `bench/ports.ts`: `parseEphemeralRange`, `candidateBlocks`, `allocatePorts`, `listenLoopback`, `EphemeralRange`, `PortLease`, `ServicePorts`.
  - `bench/bind-retry.ts`: `withBindRetry`, `withConfirmedReseed`, `isPortBindFailure` (private).
  - `bench/invocation.ts`: `newInvocationId`, `benchProject`, `benchImage`, `portEnv`, `workspaceDir`, `confirmTeardown`, `cleanupInvocation`, and the type `TeardownCheck`.
  - `bench/side-round.ts`: `measureStack` (moved from `run.ts`, not new) and `SideRoundDeps`.
  - `bench/stack.ts`: `StackIdentity`.
- Modules: `bench/ports.ts`, `bench/bind-retry.ts`, `bench/invocation.ts`, `bench/side-round.ts`. Self-tests: `check-command-error.ts`, `check-ports.ts`, `check-bind-retry.ts`, `check-invocation.ts`, `check-side-round.ts`.
- Phase names `load`, `cold`, `eod`. Name patterns `pulse-bench-<id>-<side>` and `failure-round<n>-<side>-<phase>-attempt1.log`.
- Log and error texts: `invocation <id>`, `bind retry:`, `host port bind failed twice`, `host port bind failed, retry skipped`, `teardown not confirmed`, `no bench port block`, `no free bench port block`, `cleanup skipped`.

The collision search was run again in this plan run (api `515031b`, contract `6370c25`, config `bc87049`) over every clone in `.target/.repos` (agent, api, config, console, contract, deploy, kit, notify, probe, status, website), excluding `node_modules` and `.git`:

```sh
cd .target/.repos
for n in BENCH_API_PORT BENCH_PROBE_PORT BENCH_STATUS_PORT BENCH_NOTIFY_PORT \
  CommandExitError PortBindError TeardownError PortAllocationError BIND_ATTEMPTS \
  parseEphemeralRange candidateBlocks allocatePorts listenLoopback withBindRetry withConfirmedReseed isPortBindFailure \
  newInvocationId benchProject benchImage portEnv workspaceDir confirmTeardown cleanupInvocation \
  StackIdentity PortLease ServicePorts EphemeralRange SideRoundDeps TeardownCheck ip_local_port_range \
  "host port bind failed" "bind retry:" "teardown not confirmed" "no bench port block" \
  "no free bench port block" "cleanup skipped" "retry skipped" "attempt1.log" "pulse-bench-[0-9a-f]" \
  side-round bind-retry invocation.ts ports.ts \
  check-command-error check-ports check-bind-retry check-side-round check-invocation; do
  echo "$(grep -rn --exclude-dir=node_modules --exclude-dir=.git -- "$n" . | wc -l) $n"
done
grep -rln --exclude-dir=node_modules --exclude-dir=.git pulse-bench .
grep -rn --exclude-dir=node_modules --exclude-dir=.git -w measureStack .
```

Result: every name above printed `0`. Other results:
- `pulse-bench` is found only in `api/bench/stack.ts` and `api/bench/compose.bench.yaml`.
- `measureStack` is found only in `api/bench/run.ts:230,313`, which is the function being moved.
- The first-choice name `CommandError` printed `23`, all in pulse-deploy (`deploy/cli/docker.ts:31` defines its own class, and `deploy/cli/lifecycle.ts` uses it). The two repositories do not share code, but to keep searches clear the bench uses `CommandExitError`.
- The filter `label=com.docker.compose.project` is a standard Docker Compose label. pulse-deploy already uses it the same way (`deploy/cli/docker.ts:386`), so it is not a new name.

## Repository: api

Files:
- `bench/compose.bench.yaml` (changed)
- `bench/measure.ts` (changed: `CommandExitError` only)
- `bench/stack.ts` (changed: identity and port wiring, and the `withConfirmedReseed` wrapper in `runEodStack`)
- `bench/run.ts` (changed: run id, workspace, port and teardown wiring, cleanup; `measureStack` moved out)
- `bench/ports.ts` (new)
- `bench/bind-retry.ts` (new)
- `bench/invocation.ts` (new)
- `bench/side-round.ts` (new)
- `bench/selftest/check-command-error.ts` (new)
- `bench/selftest/check-ports.ts` (new)
- `bench/selftest/check-bind-retry.ts` (new)
- `bench/selftest/check-invocation.ts` (new)
- `bench/selftest/check-side-round.ts` (new)
- `package.json` (changed: `bench:selftest` only)
- `bench/README.md` (changed)
- `README.md` (changed)
- `docs/development.md` (changed)

Behavior change: yes. The bench harness changes how it publishes ports, names its stacks, workspaces and images, confirms teardown, and handles a bind failure.

### Tool facts (verified)

- Bun 1.4.0: `package.json:8-10` (`engines`) and `packageManager`. CI uses `bun-version: 1.4.0` (`.github/workflows/ci.yml:30`, and the pinned `check.yml:24` at `04108fa`).
- `bun run check` = `bun run lint && bun run typecheck && bun run test` (`package.json:20`). `lint` = `biome check . && pulse-eslint . && pulse-workflows` (`package.json:16`). `typecheck` runs `typescript7` `tsc --noEmit` (`package.json:14`).
- `tsconfig.json:3` includes `bench`, so the new modules and self-tests are typechecked.
- Biome: `biome.json:2` extends `@lorenzh/pulse-config/biome.json`. At pin `04108fa`, that file includes `**` (lines 10-17) with `vcs.useIgnoreFile: true` (lines 3-7). So `bench/**` is linted and `.bench/` (in `.gitignore`) is not. The `noNonNullAssertion` override applies only to `**/*.test.ts` and `**/test/**` (lines 53-63), not to `bench/selftest/`. The pinned file equals the config clone.
- ESLint: `eslint.config.js` ignores only `.repos/**`, `.bench/**` and `bench-out/**`. The pinned base config `eslint.config.js` at `04108fa` sets `sonarjs/cognitive-complexity` to 15 for `**/*.ts` (line 11). It equals the clone. The attempt loop and the allocator must stay within 15 per function, so split them into small functions; never lower the limit.
- Tests: `bunfig.toml` `[test]` turns coverage on with a line threshold of 0.8. `bun test` runs only `*.test.ts`, so the self-tests are not part of `bun run test`.
- CI `bench-selftest` job (`.github/workflows/ci.yml:20-33`) runs `bun run bench:selftest` (`:32`) and `docker compose -f bench/compose.bench.yaml config --quiet` (`:33`). The `check` job uses the pinned `check.yml` (`ci.yml:18`), which runs lint (`check.yml:27-28`), typecheck (`:29-30`) and test (`:37-38`).
- `bench:selftest` is an explicit `&&` chain of ten scripts (`package.json:18`).
- Docker on the machine that wrote this spec: Docker 29.9.2, Compose v2.40.3.

### Exports and their production callers

api `AGENTS.md:72` forbids exporting a function only for a test. Every new export has a production caller, and the self-tests use only these exports. Everything else stays private and is tested through them.

| Export | Production caller |
|---|---|
| `measure.ts` `CommandExitError` | thrown by `runChecked`; `bind-retry.ts` checks for it with `instanceof` |
| `ports.ts` `parseEphemeralRange`, `candidateBlocks` | `run.ts` at start: reads the `/proc` file, computes the blocks, and stops with the "no bench port block" error |
| `ports.ts` `allocatePorts`, `listenLoopback` | `run.ts` wires them into the `side-round.ts` dependencies |
| `bind-retry.ts` `withBindRetry` | `side-round.ts`, once per phase |
| `bind-retry.ts` `withConfirmedReseed` | `stack.ts` `runEodStack`, around the `{ seed, measure }` object it gives to `runEodPhase` |
| `invocation.ts` `TeardownCheck` (type) | returned by `confirmTeardown`; used by `bind-retry.ts`, `stack.ts` (`runEodStack` parameter) and `side-round.ts` |
| `invocation.ts` `newInvocationId`, `workspaceDir`, `cleanupInvocation` | `run.ts` |
| `invocation.ts` `benchProject` | `run.ts` (the side projects) and `side-round.ts` (teardown confirmation) |
| `invocation.ts` `benchImage` | `stack.ts` `imageSizeMB`, and `cleanupInvocation` |
| `invocation.ts` `portEnv` | `stack.ts` private `stackEnv` |
| `invocation.ts` `confirmTeardown` | `cleanupInvocation`, and `run.ts` wires it into the `side-round.ts` dependencies |
| `side-round.ts` `measureStack` | `run.ts` |
| `stack.ts` `StackIdentity` (type) | `side-round.ts` and `run.ts` |

`stackEnv` in `stack.ts` stays private, as today. How the lease ports reach Compose is proved by three checks: `portEnv` in `check-invocation.ts` (literal ports to literal env names), the Compose driver below (literal env to literal published ports), and the `docker ps` snapshot of the concurrent proof. In addition, a review of the `stack.ts` diff shows that `stackEnv` sets `BENCH_PROJECT` from `identity.project` and spreads `portEnv(identity.ports)`. No self-test reaches `stackEnv`, and no task acceptance may claim that one does. In particular, `check-side-round.ts` replaces the phase functions with fakes, so it cannot see `stackEnv` or any env value.

### Required behavior

1. `bench/compose.bench.yaml`:
   - The four `ports` entries become `"127.0.0.1:${BENCH_API_PORT:-}:3000"`, `"127.0.0.1:${BENCH_PROBE_PORT:-}:9100"`, `"127.0.0.1:${BENCH_STATUS_PORT:-}:8080"` and `"127.0.0.1:${BENCH_NOTIFY_PORT:-}:9100"`. An unset variable gives today's `127.0.0.1::<port>`, so `config --quiet` in CI still passes.
   - The four `image:` lines become `${BENCH_PROJECT:-pulse-bench}-<service>`. `BENCH_SIDE` is then unused and is dropped from `stackEnv`.
   - Nothing else in the file changes: healthchecks, volumes, env and `depends_on` stay as they are. The header comment may name the new variables.
2. `bench/measure.ts`:
   - Add an exported `CommandExitError extends Error` with `name = "CommandExitError"` and the readonly fields `command`, `args`, `code` and `stderr` (full).
   - `runChecked` throws it with today's message text.
   - The parsers, `median`, `percentile`, `runCommand` and `readContainerProcess` do not change.
3. `bench/ports.ts` implements decision 1:
   - `parseEphemeralRange(text)` and `candidateBlocks(range)` are pure. `candidateBlocks` throws `PortAllocationError` ("no bench port block …") when the result is empty.
   - `allocatePorts(deps, blocks, exclude)` takes an injected `listen(port) => Promise<{ close(): Promise<void> } | null>` (`null` = in use) and `random()`. It returns a lease `{ block, ports: { api, probe, status, notify }, release() }`, or throws `PortAllocationError` ("no free bench port block …").
   - `listenLoopback(port)` is the real `listen`, built on `node:net` at `127.0.0.1`. Only `run.ts` wires the real dependencies.
4. `bench/bind-retry.ts`:
   - The private `isPortBindFailure(err)` walks the `cause` chain as in decision 5.
   - `PortBindError`, `TeardownError` and `BIND_ATTEMPTS = 2` are private.
   - `withBindRetry(deps)` is the attempt loop of decisions 2, 3, 4, 6 and 7. It has these injected dependencies: `allocate(exclude)`, `removeRunDir()`, `attempt(lease, failureLogFile)`, `confirmTeardown()`, `log`, plus `phase`, `side` and the two failure-log paths.
   - Per attempt, the order is: allocate, remove the run directory, run the attempt, confirm the teardown. Only after confirmation does it release the lease, then return, retry or rethrow, as decision 4 says.
   - `withConfirmedReseed(phase, { confirmTeardown, side, project })` implements decision 4a. It throws the same private `TeardownError`. It has no other logic: no retry, no log, no clock.
5. `bench/invocation.ts` implements decision 8:
   - `newInvocationId(randomBytes)`, `benchProject(id, side)`, `benchImage(project, service)` and `portEnv(ports)`, which returns the four `BENCH_*_PORT` strings.
   - `workspaceDir(root, id)` throws on an invalid id or a path that escapes `<root>/.bench/`.
   - `confirmTeardown({ run, composeFile, project })` follows decision 4. Here `run(command, args)` is an injected command runner (in production, `runCommand` of `measure.ts`). It returns `{ isConfirmed: true }` or `{ isConfirmed: false, reason }`.
   - `cleanupInvocation({ run, removeDir, root, id, composeFile, log })` checks the id, confirms both side projects, and only then removes the eight images and `workspaceDir(root, id)`. Each failure is logged and does not throw.
6. `bench/side-round.ts`:
   - Exports `measureStack`, moved from `run.ts:230-273` with the same order of phases and the same `add(...)` calls and metric keys.
   - Each of the three phase calls goes through `withBindRetry`, with the phase's project from `benchProject`.
   - `runStack`, `runColdStack`, `runEodStack`, `imageSizeMB`, `allocate`, `confirmTeardown` (`(project) => Promise<TeardownCheck>`), `removeDir`, `log`, the run id, the work root and the `--out` directory come in as `SideRoundDeps`.
   - The eod attempt calls `runEodStack` with the identity `{ project, ports: lease.ports }` and the closure `() => deps.confirmTeardown(project)` (decision 4a).
   - The `samples` and `missingOnA` logic stays the same, line for line, apart from the dependency calls. Review it with `git diff --color-moved=zebra`.
7. `bench/stack.ts`:
   - `buildImages`, `imageSizeMB`, `runStack`, `runColdStack` and `runEodStack` take a `StackIdentity` (`{ project, ports }`; `ports` is `null` for `buildImages`) instead of computing `pulse-bench-${side}`.
   - The private `stackEnv` sets `BENCH_PROJECT` and spreads `portEnv(ports)`. `imageSizeMB` inspects `benchImage(project, service)`.
   - `runEodStack` (`stack.ts:340-388`) is the one adapter change beyond the identity: it gets the new parameter `confirmTeardown: () => Promise<TeardownCheck>`, and its `return runEodPhase({ seed, measure }, log)` (`:359-387`) becomes `return runEodPhase(withConfirmedReseed({ seed, measure }, { confirmTeardown, side: dirs.side, project }), log)`. The bodies of `seed` (`:361-370`, including the `rm` at `:362`) and `measure` (`:371-384`), and `down()` (`:351-358`), stay the same line for line.
   - No other line of the procedures changes: `prepareRunDir`, `startServices`, the waits, `IDLE_S`, the load, the sampling, the dump, and the `finally` with `compose down` and its log line all stay as they are. `bench/eod.ts` (with `runEodPhase`) does not change.
8. `bench/run.ts`:
   - Make the run id, log it, and set `WORK_ROOT` to `workspaceDir(ROOT, id)`.
   - At start, read `/proc/sys/net/ipv4/ip_local_port_range` and compute `candidateBlocks`. Wire `allocatePorts` with `listenLoopback` and a `node:crypto` random start.
   - Wire `confirmTeardown` with `runCommand`, and call `measureStack` from `bench/side-round.ts`.
   - Run `cleanupInvocation` in a `finally` that covers everything from the first clone to the report.
   - Parsing, ref resolution, report writing and exit codes (`0`, `1` for a verdict, `2` for an error) stay the same.
9. `package.json`: append the five new self-tests to `bench:selftest`. Nothing else in the file changes.
10. Docs, all three in the same change:
   - `bench/README.md`, "Running it": the port strategy, covering:
     - the range, the blocks, the ephemeral-range filter and its errors;
     - guard coordination and the port check;
     - one retry with new ports, which errors count, and the terminal `host port bind failed twice` with exit `2`;
     - the confirmed teardown and its `teardown not confirmed` and `retry skipped` errors;
     - the `-attempt1.log` file.
     It also covers the run id, `.bench/<id>/` and its removal at the end (and when it is kept), separate `--out` directories for parallel runs, and the parallel-run command.
   - `bench/README.md`, "Reading a failure": the bind errors, the teardown errors (also the one before an end-of-day reseed after a UTC day change), the kept workspace and the attempt-1 log.
   - `bench/README.md`, "Self-tests": what the five new scripts cover.
   - `README.md`: one or two sentences beside the bench line (`README.md:74`). They say that runs can start in parallel on one machine, ports come from outside the ephemeral range, and a bind failure gets one retry. Add a link to `bench/README.md`.
   - `docs/development.md`, "Performance bench" (`:45-47`): the same short summary and the link to `../bench/README.md`.
   - `AGENTS.md` does not change, because no command or convention changes.
11. New self-test files (`bench/selftest/check-*.ts`):
    - They use `node:assert/strict` and hand-written fakes, and import only production exports (see the table above).
    - They use no Docker, no network, no module or global mocks, no real timers and no waiting. The only real process is the `sh` spawn in `check-command-error.ts`. `check-invocation.ts` uses a `mkdtemp` directory for the path checks and removes it.
    - Each file has exactly one comment line, naming what it tests and the expected outcome, and no other comment.

    The files:
    - `check-command-error.ts`:
      - `runChecked("sh", ["-c", …])` writes `Bind for 127.0.0.1:20001 failed: port is already allocated` and then 600 `x` to stderr, and exits 1. Assert first that the thrown error's `stderr` contains the bind text, then that `name` is `CommandExitError` and that `message` ends with the last 500 characters.
      - It imports only `../measure.ts`, so it runs on the base and fails there on the `stderr` assertion. This is the regression test for "classification sees the full stderr".
    - `check-ports.ts`: every ephemeral-range and allocation counterexample above, through `parseEphemeralRange`, `candidateBlocks` and `allocatePorts`, with literal ports and ranges. Also a release that frees the guard.
    - `check-bind-retry.ts`: drives `withBindRetry` with fakes.
      - Classification: every fixture above (positive, negative, and long stderr through a real `CommandExitError` and through a `cause` chain), as the thrown error of attempt 1, with the retried-or-not outcome asserted.
      - Bind, then ok: 2 attempts, 2 allocations (the second excluding the first block), 2 run-directory removals (each before its attempt), 2 confirmations, and 2 releases (each after its confirmation).
      - Bind, bind: a `PortBindError` "failed twice" with side, phase, ports and the matching line, and exactly 2 attempts.
      - An unrelated error: 1 attempt and the original error.
      - Forced teardown failures, all with a fake `confirmTeardown` that returns `{ isConfirmed: false, reason: "1 containers remain after compose down (exit 1)" }`:
        - after a bind failure: 1 attempt, 1 run-directory removal, 0 releases, `PortBindError` "retry skipped because teardown was not confirmed", and the `teardown not confirmed` log line;
        - after a success: `TeardownError` and 0 releases;
        - after a readiness timeout: the timeout error is rethrown unchanged, with 0 releases.
      - The attempt-1 log path is `failure-round1-b-load-attempt1.log`.
      - End-of-day reseed (decision 4a): every "End-of-day reseed" counterexample above. Each one drives the real `runEodPhase` from `../eod.ts` with `withConfirmedReseed` around a fake `EodPhase`. The fake `seed` and `measure` only record events (a fake `seed` stands for the `rm` at `stack.ts:362`). The clock and `sleep` are fakes passed to `runEodPhase`, and the times are the ISO literals of the counterexamples. Assert the exact event list, the number of `seed`, `measure` and `confirm` calls, and the error `name` and message. The `TeardownError` from the failing reseed case is then thrown by the fake attempt of a `withBindRetry` run: assert one attempt and the same error rethrown.
    - `check-invocation.ts`:
      - `newInvocationId` on fixed bytes `0a 1b 2c 3d 4e 5f` gives `0a1b2c3d4e5f`.
      - `benchProject`, `benchImage` and `portEnv` give the literal names, and `{ BENCH_API_PORT: "20001", BENCH_PROBE_PORT: "20002", BENCH_STATUS_PORT: "20003", BENCH_NOTIFY_PORT: "20004" }`.
      - `workspaceDir` refuses every bad id from the identity counterexamples.
      - `confirmTeardown` with a fake runner: empty list (confirmed, no `down`); a listed container, then `down` exits 1, then still listed (not confirmed, with the literal reason); a listed container, then `down` ok, then empty (confirmed); `docker ps` exits 1 (not confirmed). The fake records the exact commands, which name only the given project.
      - `cleanupInvocation`:
        - confirmed: exactly the eight `docker image rm pulse-bench-<id>-<side>-<service>` commands, and one `removeDir` of `<root>/.bench/<id>`;
        - not confirmed for side `b`: no `image rm` and no `removeDir`, only the `cleanup skipped` line;
        - a failing `image rm`: logged, no throw;
        - a bad id: no command at all.
    - `check-side-round.ts`: drives `measureStack` with fake phase functions and fakes for `allocate`, `confirmTeardown` and `removeDir`.
      - Load, three cases:
        - (a) Attempt 1 throws a `CommandExitError` for `docker compose … up -d --no-build api` with bind stderr, and attempt 2 succeeds: the phase recovers.
        - (b) Attempt 1 throws the same for the later services (`… up -d --no-build probe status notify`), and attempt 2 succeeds: the phase recovers.
        - (c) Attempt 1 fails at the api and attempt 2 at the later services: `PortBindError` naming `load` and the side, with no third attempt.
      - Cold: the `restart api` command fails once with bind stderr, then succeeds.
      - Eod: fails once, then succeeds.
      - Teardown not confirmed after a bind failure in `cold`: no second `cold` attempt, `eod` never runs, and `PortBindError` "retry skipped".
      - Check that:
        - each phase's fake gets the `StackIdentity` `{ project: "pulse-bench-0a1b2c3d4e5f-a", ports }`, where `ports` are the lease ports that the fake `allocate` handed out for that attempt (literal ports, distinct per attempt), and `confirmTeardown` gets the project `pulse-bench-0a1b2c3d4e5f-a`;
        - the fake `runEodStack` gets a `confirmTeardown` closure, and calling it calls the fake `deps.confirmTeardown` with `pulse-bench-0a1b2c3d4e5f-a`;
        - samples hold exactly one value per metric;
        - no phase runs a third time;
        - a non-bind error (readiness timeout) is not retried.
      - It does not check `stackEnv`, `BENCH_*` env values or Compose names. Its fakes replace the phase functions, so it cannot reach them. Those are proved only by the checks named under "Exports and their production callers".

### Checks and completion evidence

Record `BASE` (the full SHA of api `main` at the start of the build) before any edit.

1. **Baseline controls on `BASE`.** Each must run and pass there. Record the command, SHA, status and output tail. They are `bun run bench:selftest` (the ten existing scripts), `docker compose -f bench/compose.bench.yaml config --quiet` and `bun run check`. If one does not pass on `BASE`, stop and hold: it is not a baseline control.
2. **Regression tests red on `BASE`, three times each in isolation, for the stated reason:**
   - `bun bench/selftest/check-command-error.ts`, with the branch file copied into a `BASE` worktree, fails on the assertion about `stderr` (not on an import error). Show the assertion text from each of the three runs.
   - The Compose identity and port driver, run in the `BASE` worktree and then on the branch:

     ```sh
     BENCH_PROJECT=pulse-bench-0a1b2c3d4e5f-a BENCH_API_PORT=20001 BENCH_PROBE_PORT=20002 BENCH_STATUS_PORT=20003 BENCH_NOTIFY_PORT=20004 \
       docker compose -f bench/compose.bench.yaml config --format json \
       | jq -c '[.services.api.image, .services.api.ports[0].published, .services.probe.ports[0].published, .services.status.ports[0].published, .services.notify.ports[0].published, .services.api.container_name]'
     ```

     The expected output on the branch is the literal `["pulse-bench-0a1b2c3d4e5f-a-api","20001","20002","20003","20004","pulse-bench-0a1b2c3d4e5f-a-api"]`. On `BASE`, the image is `pulse-bench-a-api` and the published ports are missing, so the comparison with the literal fails all three times.

     This plan run checked it with Docker 29.9.2 and Compose v2.40.3, on a copy of the file in a temp directory:
     - On api `515031b`, the driver printed `["pulse-bench-a-api",null,null,null,null,"pulse-bench-0a1b2c3d4e5f-a-api"]`.
     - A trial copy with the four port entries and the `image:` lines of Required behavior 1 printed the expected literal above. It also passed `config --quiet` with all five variables unset.

     If the installed Compose prints `published` as a number, write the literal with numbers and say so.
   - The other new scripts test new modules. On `BASE`, they would only fail on a missing import, which the rules do not count as evidence. Say this in the PR and show them green on the branch.
   - This also holds for the end-of-day reseed cases in `check-bind-retry.ts`. The base code path (`runEodStack`) cannot be driven without Docker. The failing reseed case rejects the base order by its literal count of one `seed`, and the build quotes `stack.ts:361-362` of `BASE` to show that the base reseeds with no check.
3. **Branch green:**
   - `bun run bench:selftest` (15 scripts), the Compose `config --quiet`, the driver above (literal match) and `bun run check` all pass on the final branch.
   - Show the output of `bun run bench:selftest` with each new script's exit status.
   - Show `grep -n '^export' bench/ports.ts bench/bind-retry.ts bench/invocation.ts bench/side-round.ts` and, for each export, `grep -rn '<name>' bench --include='*.ts' | grep -v selftest`. Each export must have a non-self-test caller, as the table above says, including `withConfirmedReseed` (in `bench/stack.ts`) and `TeardownCheck`. `grep -n 'export function stackEnv' bench/stack.ts` must print nothing.
   - `git diff "$BASE" HEAD -- bench/stack.ts` touches inside `runEodStack` only the signature, the `project` line and the `runEodPhase(...)` call. `git diff --exit-code "$BASE" HEAD -- bench/eod.ts` passes (it is in the protected list).
4. **Concurrent Docker proof on the factory runner.** The exception of this issue applies: only this proof runs the Docker bench. From one checkout of the final branch, start two runs at the same time:

   ```sh
   API=<api main SHA, full>
   ( bun bench/run.ts --a "$API" --b "$API" --others-ref main --rounds 1 --out /tmp/bench-834-1 > /tmp/bench-834-1.log 2>&1; echo "exit $?" >> /tmp/bench-834-1.log ) &
   ( bun bench/run.ts --a "$API" --b "$API" --others-ref main --rounds 1 --out /tmp/bench-834-2 > /tmp/bench-834-2.log 2>&1; echo "exit $?" >> /tmp/bench-834-2.log ) &
   while [ "$(jobs -r | wc -l)" -gt 0 ]; do date -u +%FT%TZ; docker ps --format '{{.Names}} {{.Ports}}' | grep pulse-bench; sleep 30; done; wait
   ```

   - Record the harness commit, `API`, the `ref <repo> a=… b=…` lines of both logs, the start and end times, the two `invocation <id>` lines and both exit codes.
   - Record the `docker ps` snapshots. At least one snapshot must show both ids live at the same time, with disjoint host ports in 20000-29999.
   - The proof passes when both logs end with `exit 0` or `exit 1`, both `--out` directories hold `table.md`, `table.json` and `samples.json`, and neither log contains `host port bind failed` or `teardown not confirmed`.
   - Report every `bind retry:` line (none expected), and every `FAIL` row of an exit 1 as noise from the shared machine. Do not change budgets.
   - After both runs, `docker ps -a --filter label=com.docker.compose.project=pulse-bench-<id>-a`, the same for `-b`, and `docker images 'pulse-bench-<id>-*'` must be empty for both ids, and `.bench/<id>` must be gone for both.
   - If Docker or the runner is not available, record the concrete blocker and do not claim this check.
5. **Test CPU:** five interleaved runs of `bun run test` in api, alternating `BASE` and branch (ten runs), as defined under Counterexamples. Report the raw samples, both medians and the delta in seconds and percent. Never run it at the same time as the benches.
6. **Docs:** quote the changed paragraphs of `bench/README.md`, `README.md` and `docs/development.md`, and check each statement against the code. The range, block size, attempt count, error and log texts and file names must match the literals of this spec.
7. **Scope, after the last commit, against `BASE`:**
   - `git diff --name-only "$BASE" HEAD | sort` equals exactly the sorted 17 paths of `Files:` above.
   - `git diff --name-only --cached` is empty, `git diff --name-only` is empty, and `git status --porcelain` is empty. Check each on its own.
   - `git diff --exit-code "$BASE" HEAD -- bench/budgets.json bench/baseline.json bench/compare.ts bench/cold.ts bench/eod.ts bench/load.ts bench/seed.ts bench/fixtures.ts bench/fixtures bench/runtime-fixture.ts bench/runtime-traffic.ts bench/refs.ts bench/cold-read.ts bench/eod-read.ts bench/today-parity.ts bench/uptime-parity.ts bench/selftest/check-compare.ts bench/selftest/check-budgets.ts bench/selftest/check-refs.ts bench/selftest/check-measure.ts bench/selftest/check-load.ts bench/selftest/check-missing-route.ts bench/selftest/check-cold.ts bench/selftest/check-eod.ts bench/selftest/check-runtime-fixture.ts bench/selftest/check-runtime-traffic.ts src test bun.lock biome.json tsconfig.json bunfig.toml eslint.config.js lefthook.yml .github Dockerfile .dockerignore .gitignore AGENTS.md CLAUDE.md scripts` passes.
   - `git diff "$BASE" HEAD -- package.json` changes only the `bench:selftest` line.
   - Prove the guard in a throwaway `mktemp -d` repository fixture, which is not committed to api:
     - An allowed change passes.
     - A protected change and an unlisted change each fail on their own, when committed, when staged and when unstaged.
     - Include both restored-worktree traps: (a) stage a protected edit, then `git restore --worktree` it to the base; (b) commit a protected edit, then `git checkout "$BASE" -- <file>` and `git restore --staged`. Show that the `--cached` and `"$BASE" HEAD` checks still reject both, while a worktree-only `git diff` misses them.
   - Show the real check on the api branch as well.
8. **Comments:** read every added line of the diff, including inline comments in the changed source files. The PR body lists every added comment, or says `none` only after that read. Each new self-test file has exactly its one header line.
9. **Handoff:** the PR body holds:
   - `Closes lorenzh/pulse-meta#<child>` and `BASE`;
   - the baseline, red and green results;
   - the export-caller check;
   - the concurrent proof;
   - the test-CPU table;
   - the docs check;
   - the scope checks.

   It contains no secrets, tokens or private runner details. Write host ports and container names, but no host names, and no IPs other than `127.0.0.1`.

## Risks

- **The runner's ephemeral range may cover 20000-29999.** Then every run fails at once with the explicit `no bench port block …` error (exit `2`), not with a random collision. The concurrent proof shows whether this happens on the factory runner. The machine that wrote this spec has `32768 60999`.
- **A non-bench service may listen on many ports in 20000-29999.** The check skips those blocks. Running out of blocks gives a clear error.
- **Docker without the userland proxy** (iptables only) does not show published ports to the listen check. The guards still keep benches apart, and Docker's `port is already allocated` plus the retry covers other containers.
- **A Docker daemon that cannot remove containers** now stops the run with exit `2` (`TeardownError`, also before an end-of-day reseed, or `retry skipped`) and keeps the workspace. Today such a run would go on with leftovers. This is intended: a leftover container would distort the next phase. The README explains how to remove it by hand (`docker compose -p <project> down -v`).
- **Per-run clones** cost network and time on every run. That is accepted for isolation, and the nightly hosted runner clones fresh anyway.
- **Moving `measureStack`** could change the sample order or keys by mistake. The `--color-moved` review and `check-side-round.ts`, which checks the exact metric keys and one value per metric, cover this.
