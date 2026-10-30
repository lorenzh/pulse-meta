# Issue review #377: performance budgets, nightly bench, Performance impact section

Verdict: specifiable. No blocking question. Placement in pulse-api is decided in the issue.

## Checked against the clones
- api has `src/bench-reads.ts` (referenced by `docs/development.md` line 44), `compose.yaml`, `compose.e2e.yaml`, `scripts/compose-e2e.sh`, `Dockerfile`. `bench/` does not exist yet.
- probe, status, notify and api each have a `Dockerfile`; `/readyz` is served by `kit/src/ops-server.ts` and `api`/`status` `src/server.ts`.
- Only contract and kit have a `build` script (contract `tsc -p tsconfig.build.json`, kit `tsc -p tsconfig.build.json`). config has `test` only (`bun test src`). website uses `node --test`, and is not a bench target.
- api `package.json` pins Bun 1.4.0; `check` = lint + typecheck + test. `bench/` must be outside `bun test` discovery, and in lint/typecheck scope (decide: keep it in scope).
- The `.factory/work/377` dir did not exist.

## Open points (for the plan to settle, none blocks)
1. Moving `src/bench-reads.ts`: tsconfig `include`, biome and eslint globs may need adjusting; `bun test` must not pick up `bench/*.test.ts` helper tests unless intended (a harness unit test, e.g. median/threshold logic, is useful but must live where `bun test` ignores it or be explicitly allowed; plan decides, issue says "bench/ is not part of bun test").
2. Cross-repo build of A and B: the compose files build probe/status/notify from sibling repos. The plan must say how `bench/run.ts` checks out a ref per repository (api B = checkout under test; probe/status/notify at A = `baseline.json` SHA, B = `main`) and how the api's own ref is built. Contract/kit/config are npm-style git dependencies pinned in each repo's package.json, so A/B for them is only via test/build CPU.
3. "B = main at the nightly run" for every repository, but the api repo is where the workflow runs: the workflow checks out api at B and A in separate worktrees. Plan fixes the layout.
4. A=B dispatch must pass: the absolute floor per unit and threshold must absorb noise. Plan must fix rounds (>=5, odd, suggest 7), load numbers (checks, locations, POST rate, GET rate, warm-up, duration) and the 30 s idle wait (adds ~30 s x rounds x 2 sides x 4 services; run services in one stack per round to bound job time; fix the job timeout).
5. Measurement method: per-process CPU/RSS inside containers. Options: cgroup v2 `cpu.stat` and `memory.peak`/`memory.current`, `/proc/<pid>` via `docker top`/exec, or running services as plain Bun processes. Plan picks one and states how "CPU from start until /readyz" is taken for a container (cgroup usage at ready minus 0 at start; includes container runtime init? state it). Image size needs a build, so reported only.
6. Unit-test CPU time per service needs each repo's checkout and `bun install` (needs `GITHUB_PACKAGES_TOKEN`? api devDependency uses git deps on public repos; confirm no token needed, since the issue says read access only). If a private/packages token is required, that conflicts with "no secrets" and must be raised.
7. p95 latency and rps are api-only, reported. Probe simulation: a load generator posting `POST /results` with valid probe auth; the plan must define the token/config used in a bench-specific compose override (`bench/compose.bench.yaml`) rather than editing `compose.yaml`.
8. `budgets.json` schema: per service/metric `{budget, unit, gating, thresholdPct?, floor?}`; values set from measured A (can only be done during implementation, stated in the PR with headroom). The "absolute floor per unit" needs concrete numbers in the plan (e.g. 50 ms CPU, 2 MiB).
9. Failure rule detail: "worse" for a lower-is-better metric only; improvements never fail. A missing metric or a failed round must fail the run, not be silently skipped.
10. Baseline SHAs in `baseline.json` for api, probe, status, notify, contract, kit, config; the newest `v*` tag logic is specified but not exercised (no releases). Plan should have the code implement tag lookup via `git ls-remote` with fallback and test it.
11. Acceptance runs with a CPU-burning branch, a sleep branch and a 50 MiB buffer branch are PR evidence produced by the implementer; they are not automated tests. The sleep branch affects only wall-clock p95 and must pass.
12. GitHub-hosted runner `ubuntu-24.04`, `concurrency` group, actions pinned by SHA, `permissions: contents: read`, artifact upload of raw samples + table JSON, job summary table.
13. Meta part: the plan state must not edit `.factory/prompts/plan.md` or `plan-review.md`. The spec holds the exact replacement text (new "Performance impact" section in the spec template and a check bullet in plan-review). Outcome contracts stay intact. A person applies it after the spec merges.
14. Targets for `targets.json`: only `api`. Meta prompts are not a child issue. The issue's "Order" confirms no dependencies.
15. Owner decision context: #166 and #352 are referenced; their comments were not available here; assumptions follow the issue text.

## Assumptions
- CPU and RSS are read from cgroup v2 counters of the containers (or /proc of the process) on ubuntu-24.04; the plan finalizes.
- Load numbers are named constants in `bench/load.ts` (or similar), changed only by PR.
- Image size is reported from `docker image inspect` of the built image.
- The spec's own Performance impact: none expected for the services; harness runs only in its own workflow.

## Derived acceptance check
1. `bench.yml` dispatched with A = B passes; summary lists every metric of the issue table for api, probe, status, notify, and test CPU (plus build CPU where built) for contract, kit, config.
2. B = branch with CPU busy loop in `GET /checks` fails on api load CPU time naming that metric; B = branch with 50 ms sleep passes and shows higher p95.
3. B = branch holding an extra 50 MiB buffer fails on api idle RSS.
4. `bun bench/run.ts --a <sha> --b <sha>` runs locally and prints the same table with the single-machine warning.
5. `bench/budgets.json` has a budget for every metric and service.
6. Spec carries the exact new text for `plan.md` and `plan-review.md`; after a person applies it, `npx factory validate` passes.
7. api `bun run check` stays green and `bench/` is not run by `bun test`.
8. The spec of #377 has a "Performance impact" section (none expected for services).
