# Spec #527: Release images to ghcr.io with SemVer tags and provenance

Implements decision 8 of #460 for the images: every service publishes a versioned image with build provenance to `ghcr.io/lorenzh/pulse-<service>`. It is a prerequisite for `pulse-deploy` (#528) and the setup wizard (#529). Issue review: `.factory/work/527/issue-review.md`.

## Goal

A SemVer tag `vX.Y.Z` on api, probe, status, notify or console runs the repo's existing checks and, only when they are green, publishes a multi-arch image (linux/amd64, linux/arm64) to `ghcr.io/lorenzh/pulse-<service>` with the tags `X.Y.Z`, `X.Y` and `X`, OCI labels, and a GitHub artifact attestation (SLSA build provenance) that `gh attestation verify` accepts. Setups can then pin an exact version by digest.

## Scope

- **config**: a new reusable workflow `.github/workflows/release.yml` (version check, two native per-platform builds, index merge, attestation), a test that runs its version logic and checks its structure, and README docs.
- **api, probe, status, notify, console**: `ci.yml` also runs on `v*` tags and calls `release.yml` after the existing gates; the `docker` job also builds and checks the image on a native arm64 runner; config pins move to the merged config SHA; `docs/development.md` gets a "Releasing" section; README names the image.
- **meta (this spec PR)**: `docs/approved-packages.md` approves `actions/attest`, the `moby/buildkit` image and the `ubuntu-24.04-arm` runner, and adds an `actions/checkout` row for the v7.0.1 SHA (`3d3c42e…`) that every target already uses (the existing v5.1.0 row stays, because the pulse-meta workflows still use it).

## Non-goals

- No Compose change. `api/compose.yaml`, `compose.e2e.yaml` and `compose/` keep building from source and `git#main`; moving to image tags is #528.
- No change to the wire version policy (#484), to `package.json` `version` (stays `0.0.0`), or to the Dockerfiles.
- No `latest` and no `edge` tag. No SBOM.
- No repository settings (tag rulesets, package visibility) are changed by the Factory; they are documented owner steps.

## Decisions

1. **Native arm64 runners, not QEMU.** `build-amd64` runs on `ubuntu-24.04`, `build-arm64` on `ubuntu-24.04-arm` (free for public repositories). Each pushes its single-platform image by digest; `publish` merges both into one index with `docker buildx imagetools create`. Reason: the build runs `bun install` inside the image, and Bun under QEMU user emulation has a history of crashes and is several times slower; native runners also let the PR `docker` job test the arm64 image for real. Cost: two build jobs instead of one. They are two explicit jobs, not a matrix, so each can expose its digest as a job output without an artifact action.
2. **Plain `docker buildx` in `run:` steps, no `docker/*` actions.** Login is `docker login ghcr.io --password-stdin` with the job's `GITHUB_TOKEN`; tags are computed by a short shell step; labels are `--label` flags. Reason: fewer third-party actions in a job that holds `packages: write`. The only new action is `actions/attest` (GitHub-owned). The BuildKit builder is created with `docker buildx create --name pulse-release --use --driver docker-container --driver-opt image=moby/buildkit:v0.34.1@sha256:99368f3e46177c6405b9740e4461d91cee004128daeecca78d4ceac50ec1da5c` (multi-arch index with amd64 and arm64, queried from Docker Hub for this spec), so the builder image is pinned by digest, which `docker/setup-buildx-action` does not do by default. `--use` selects it, and every `docker buildx build` also passes `--builder pulse-release`, so no build can fall back to the default `docker` driver.
3. **Provenance through `actions/attest` v4.2.2** (`1e69f48acb82d1966a394da916b4c1698aa569d6`), in its default provenance mode, on the index digest, with `push-to-registry: true` and `create-storage-record: false`. `actions/attest-build-provenance` v4 is only a wrapper of it and its release notes recommend `actions/attest` for new workflows. `create-storage-record: false` avoids the extra `artifact-metadata: write` permission. The buildx in-toto attestations are switched off (`--provenance=false --sbom=false`), so the index lists exactly two platforms and no `unknown/unknown` entries.
4. **`main` publishes nothing.** Nothing consumes an `edge` tag: #528 pins released versions by digest, and its dev setup builds from source. Publishing on every merge would give `packages: write` to every `main` run.
5. **The release lives in each service's existing `ci.yml`**, as a job `release` that runs only on tag refs and `needs` the existing gate jobs. Reason: the tag run then executes exactly the checks that guard `main` (check.yml lint, typecheck, test, plus the image checks of the `docker` job on both architectures) without copying them into a second workflow. A failed, cancelled or skipped gate skips `release`.
6. **The git tag is the version source.** `package.json` stays `0.0.0`; no version-bump PR is needed. The `version` label and the image tags come from the tag without `v`.
7. **Where a tag may point.** A stable tag `vX.Y.Z` must point to a commit reachable from `origin/main`, otherwise the workflow fails before any build. A pre-release tag `vX.Y.Z-<pre>` may point anywhere, so the throwaway-branch demonstration works.
8. **Moving tags only forward.** `X.Y` is pushed only when `X.Y.Z` is the highest stable `vX.Y.*` git tag; `X` only when it is the highest stable `vX.*.*` tag. A late patch on an old minor (v0.1.5 after v0.2.0) gets `0.1.5` and `0.1`, but `0` stays on 0.2.x.
9. **No re-publish.** `publish` refuses (fails, writes no tag) when `ghcr.io/lorenzh/pulse-<svc>:X.Y.Z` already exists. A moved or re-pushed git tag therefore never overwrites a published version. Already pushed untagged per-platform digests stay as untagged versions; that is harmless and documented.
10. **`0` stays** as the issue asks, although it moves across breaking 0.x minors; the docs tell setups to pin `X.Y.Z` by digest.
11. **The owner (a person) pushes all tags**: the test tag, the failing-test tag, and `v0.1.0` in all five repos. A tag pushed with a job's `GITHUB_TOKEN` starts no workflow, and cutting a release is a person's decision. The owner also makes each package public once (package settings UI; there is no REST endpoint for container visibility under a user account) and deletes the test tag and its package version afterwards.

## Required behavior

### Reusable workflow `lorenzh/pulse-config/.github/workflows/release.yml`

- Trigger `workflow_call`, no inputs. Image name: `ghcr.io/` + `github.repository` (for example `ghcr.io/lorenzh/pulse-probe`). If `github.repository` contains an upper-case letter, job `version` fails.
- Workflow-level `permissions: {}`; each job declares its own, and none declares more than listed here:
  - `version`: `contents: read`.
  - `build-amd64`, `build-arm64`: `contents: read`, `packages: write`.
  - `publish`: `contents: read` (checkout for the alias recomputation), `packages: write`, `id-token: write`, `attestations: write`.
- Every `uses:` is pinned by a 40-hex commit SHA with a version comment. Every `actions/checkout` sets `persist-credentials: false`. No secret other than `github.token` is referenced. `${{ github.ref_name }}` and other event values are never interpolated into a `run:` script; they reach scripts only through `env:`.
- **Job `version`** (`ubuntu-24.04`, `timeout-minutes: 5`): checkout with `fetch-depth: 0` (all tags and `origin/main`). A step with `id: version` reads `TAG` (= `github.ref_name`), `SHA` (= `github.sha`) and `REPOSITORY` (= `github.repository`) from `env`, and the git tags and `refs/remotes/origin/main` of the working directory. It:
  - accepts only `^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$`; any other tag fails the step with a message that names the expected form;
  - for a stable tag, fails unless `git merge-base --is-ancestor "$SHA" origin/main` succeeds;
  - writes to `$GITHUB_OUTPUT`: `image` (`ghcr.io/<repository>`), `version` (tag without `v`), `tags` (space-separated image tags, see the table), `prerelease` (`true`/`false`).

  | Tag | Pushed image tags |
  | --- | --- |
  | `v0.1.0` (first stable) | `0.1.0 0.1 0` |
  | `v0.1.1` with `v0.1.0` present | `0.1.1 0.1 0` |
  | `v0.1.5` with `v0.2.0` present | `0.1.5 0.1` |
  | `v0.1.5` with `v0.1.7` present | `0.1.5` |
  | `v0.0.0-rc.1` | `0.0.0-rc.1` |
  | `v1.2.3-rc.1` with `v1.2.2` present | `1.2.3-rc.1` |

  Pre-release git tags are ignored when the highest stable tag is computed. Comparison is numeric per component (`sort -V` over stable tags only, or equivalent), so `v0.10.0` is higher than `v0.9.0`.
- **Jobs `build-amd64` (`ubuntu-24.04`) and `build-arm64` (`ubuntu-24.04-arm`)**, `needs: version`, `timeout-minutes: 20`: checkout; login (`printf '%s' "$TOKEN" | docker login ghcr.io -u "$ACTOR" --password-stdin`, token from `env`); create the pinned BuildKit builder (decision 2); `docker buildx build --builder pulse-release --platform linux/<arch> --provenance=false --sbom=false` with the labels below and `--output type=image,name=<image>,push-by-digest=true,name-canonical=true,push=true --metadata-file <tmp>/meta.json .`; read `containerimage.digest` from the metadata file with `jq`, fail unless it matches `^sha256:[0-9a-f]{64}$`, and expose it as job output `digest`.
- Labels on each platform image config (`--label`):
  - `org.opencontainers.image.source=https://github.com/<repository>`
  - `org.opencontainers.image.revision=<github.sha>`
  - `org.opencontainers.image.version=<version>`
  - `org.opencontainers.image.licenses=MIT`
  - `org.opencontainers.image.title=<repository name>`
- **Job `publish`** (`ubuntu-24.04`, `timeout-minutes: 10`), `needs: [version, build-amd64, build-arm64]`, job-level `concurrency: { group: release-${{ github.repository }}, cancel-in-progress: false }` (one image per repository, so all releases of an image publish one after another): checkout with `fetch-depth: 0`; recompute `tags` inside this job by running the same version script as job `version` (so alias eligibility reflects every tag present when this job runs, not when the release started) and use these tags, not `needs.version.outputs.tags`; login; if `docker buildx imagetools inspect <image>:<version>` succeeds, fail with "version already published" before writing any tag; `docker buildx imagetools create` with one `-t <image>:<tag>` per entry of `tags`, `--annotation index:<key>=<value>` for the four required OCI keys above (source, revision, version, licenses), and the two sources `<image>@<amd64 digest>` and `<image>@<arm64 digest>`; read the index digest (`docker buildx imagetools inspect <image>:<version> --format '{{json .Manifest}}' | jq -r .digest`, same `sha256:` check); run `actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6 # v4.2.2` with `subject-name: <image>`, `subject-digest: <index digest>`, `push-to-registry: true`, `create-storage-record: false`.
- No job pushes or tags anything when job `version` fails. `publish` writes tags only after both builds succeed.

### Callers (each service's `ci.yml`)

- `on.push` gets `tags: ["v*"]` next to `branches: [main]`. `pull_request` stays.
- `concurrency.cancel-in-progress: ${{ github.ref_type != 'tag' }}`; the group stays.
- `check` moves to the new config SHA.
- The `docker` job becomes a matrix over `runner: [ubuntu-24.04, ubuntu-24.04-arm]` with `fail-fast: false`, `runs-on: ${{ matrix.runner }}`, and all its existing steps unchanged on both legs. It stays `contents: read`.
- New job `release`:

  ```yaml
  release:
    if: github.ref_type == 'tag'
    needs: [check, docker]          # api adds bench-selftest, status adds a11y
    permissions:
      contents: read
      packages: write
      id-token: write
      attestations: write
    uses: lorenzh/pulse-config/.github/workflows/release.yml@<merged config SHA>
  ```

  The `if` has no status function (`always()`, `!cancelled()`), so GitHub's implicit `success()` skips `release` when any needed job failed, was cancelled or was skipped. api `compose-e2e` is not in `needs`: it builds the other services from their `main`, so it says nothing about the tagged api commit.
- The `check.yml` ref, the `release.yml` ref and `package.json` `@lorenzh/pulse-config` (with `bun.lock`) carry the same SHA.

## Risks

- **arm64 image breaks only at release.** Mitigated: the `docker` job builds and checks the image on `ubuntu-24.04-arm` in every PR.
- **The release builds a second time.** The gate checks an image built by the `docker` job, and `release.yml` builds again from the same commit. Same Dockerfile, same lockfile, same digest-pinned base, so the content matches; the digests can differ by timestamps. Accepted and noted in the docs.
- **Package starts private** under the user account. The anonymous `docker pull` in the acceptance check catches a forgotten visibility step.
- **`ubuntu-24.04-arm` image lacks Docker or buildx.** GitHub's arm64 runner image ships Docker; the first PR run of the matrix `docker` job proves it before any release.
- **`imagetools create --annotation`** needs buildx 0.12 or newer on the runner. The implementer logs `docker buildx version` in `publish` and states the version in the PR.
- **Untagged digests** from a refused re-publish or a failed `publish` stay in the package. Documented; the owner deletes them if wanted.
- **`0` moves across breaking 0.x minors** (decision 10).

## Performance impact

None expected at runtime: the Dockerfiles and `src/` do not change, so no key of `api/bench/budgets.json` moves (`startup_cpu_ms`, `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`, `test_cpu_s`, `startup_wall_ms`, the p95 keys, `rps`); `image_mb` stays the same for amd64 because the image content is unchanged (`--provenance=false --sbom=false` adds no attestation layers to the platform image). `build_cpu_s` exists only for contract and kit, which do not change.

CI time: the PR `docker` job gains a parallel arm64 leg (expected about the amd64 leg's time, 1 to 3 minutes; wall-clock of the run does not grow when the leg is no longer than the longest other job). A tag run takes the gate jobs plus about 30 s `version`, 2 to 4 minutes for the parallel builds and about 1 minute `publish`: expected 5 to 9 minutes in total. The owner reports the measured duration of the `v0.1.0` runs (run page "Total duration", and the `release` job's duration) in the feature issue.

## Security impact

Security impact: yes — CI gains a job with `packages: write` and OIDC (`id-token: write`), new pinned dependencies (`actions/attest`, `moby/buildkit`), and the tag name is external input to a shell step.

Checklist items that apply:
- **Dependency pins**: every action by full SHA with version comment; BuildKit image by digest; the base image stays digest-pinned; both new pins are approved in `docs/approved-packages.md` in this spec PR.
- **Secrets in errors, logs and responses**: only `github.token`; passed to `docker login` through `env` and `--password-stdin`, never on a command line or in `echo`. No PAT, no registry secret, no long-lived credential.
- **Input validation**: the tag is validated by the strict regex before use; event values reach scripts only through `env`, so a tag such as `v1.0.0-$(id)` is neither executed nor accepted.
- **Least privilege**: workflow `permissions: {}` in `release.yml` and `contents: read` in callers; write scopes only on the jobs listed; `id-token` and `attestations` only on `publish`; `actions/checkout` with `persist-credentials: false`.
- **Provenance**: a Sigstore-signed SLSA provenance on the index digest, verifiable with `gh attestation verify ... --owner lorenzh`.
- **Not applicable**: auth order and status codes, body and size limits, accessor execution, SSRF and redirects, file writes in services (no product code changes).

## Rollout order

1. **meta spec PR** merges first: it approves `actions/attest` and `moby/buildkit`.
2. **config** merges `release.yml`. Nothing calls it yet. Every service still pins `51e95b0…` for `check.yml` and `package.json` and keeps working unchanged; `release.yml` is a new file, `check.yml` is untouched, and the config changes since `51e95b0` touch only config's own dev dependencies and tests (verified with the compare API: `bun.lock`, `package.json` devDependencies, `src/hook.test.ts`, `src/index.test.ts`).
3. **api, probe, status, notify, console**, in any order and in parallel: each moves its three config pins to the merged config SHA and adds the `release` job. A service not yet moved simply has no release; no service consumes another service's image, and Compose still builds from source, so mixed states are harmless.
4. **Owner, after all five merged**: test tag on one service, failing-test tag demonstration, then `v0.1.0` on all five, visibility, cleanup (see Acceptance evidence). No consumer exists yet; #528 starts consuming afterwards.

## Counterexamples

Tag shape (job `version` must fail, nothing is built or pushed):
- `v1.2` (two components), `1.2.3` (no `v`), `v01.2.3` (leading zero), `v1.2.3+build.5` (`+` is not allowed in an image tag), `v1.2.3-` (empty pre-release), `v1.2.3-rc..1` (empty identifier), `v1.2.3-rc_1` (`_` not allowed), `v1.2.3-$(id)`, `vX.Y.Z`, `release-1`. The trigger `v*` lets all of these that start with `v` start the run; the regex rejects them.
- Accepted: `v0.0.0-rc.1`, `v0.1.0`, `v10.20.30`, `v1.0.0-alpha.beta-1`.

Tag placement:
- `v0.2.0` on a commit only on a side branch: `version` fails (not an ancestor of `origin/main`).
- `v0.0.0-rc.2` on a side branch: accepted (pre-release exemption).

Tag list (see the table in Required behavior). A wrong implementation that always pushes `X.Y` and `X` moves `0` back to `0.1.5` after `v0.2.0`; one that compares as strings ranks `v0.9.0` above `v0.10.0`; one that counts pre-releases as stable lets `v0.3.0-rc.1` block `0` for `v0.2.1`. Pre-releases never get `X.Y`, `X` or `latest`. No run ever pushes `latest` or `edge`.

Gate:
- A tagged commit with a failing `bun run test` (check.yml step "Test"): `check` fails, `release` is skipped, no new package version appears.
- The `docker` arm64 leg fails while amd64 passes: `release` is skipped (`fail-fast: false` keeps the other leg's log, `needs` still fails).
- A wrong caller with `if: always() && github.ref_type == 'tag'` would publish after a red check; the spec forbids any status function in that `if`.
- A push to `main` or a PR: `release` is skipped (`github.ref_type` is `branch`), so nothing is published.

Re-publish:
- Owner deletes `v0.1.0`, re-tags another commit as `v0.1.0`, pushes: `publish` finds `:0.1.0` in the registry and fails; `0.1.0`, `0.1` and `0` keep their old digest.

Permissions:
- A `build-*` job with `id-token: write`, or `version` with `packages: write`, or a workflow-level write scope in `release.yml`, violates the spec; the config test rejects it.

## Contract fields

No wire field, route, env var or contract type changes. New names are CI and registry names only; searches on the clones (all with no match):

- `grep -rn 'release.yml' .repos/contract/src .repos/config` → no match (config has only `check.yml` and `ci.yml` in `.github/workflows`).
- `grep -rn 'ghcr' .repos/contract/src .repos/config .repos/*/README.md .repos/*/docs` → no match.
- Job names `version`, `build-amd64`, `build-arm64`, `publish` are new in a new file; job name `release` is new in each service `ci.yml` (existing jobs: api `check`, `bench-selftest`, `docker`, `compose-e2e`; status `check`, `docker`, `a11y`; probe, notify, console `check`, `docker`).
- Image names: `ghcr.io/lorenzh/pulse-api`, `pulse-probe`, `pulse-status`, `pulse-notify`, `pulse-console` (none exist yet).

## Acceptance evidence

Done when, after the six PRs are merged and the owner ran the steps below:

1. **Test tag** (owner, on probe): `git tag v0.0.0-rc.1 <main sha> && git push origin v0.0.0-rc.1`. The run is green. `docker logout ghcr.io; docker pull --platform linux/amd64 ghcr.io/lorenzh/pulse-probe:0.0.0-rc.1` and the same with `linux/arm64` succeed (after the visibility step). `docker buildx imagetools inspect ghcr.io/lorenzh/pulse-probe:0.0.0-rc.1` lists exactly `linux/amd64` and `linux/arm64`. Tags `0.0`, `0` and `latest` do not exist (`docker manifest inspect ghcr.io/lorenzh/pulse-probe:0` fails). Expected values are the literals in this spec.
2. **Labels**: `docker buildx imagetools inspect ghcr.io/lorenzh/pulse-<svc>:0.1.0 --format '{{json .Image}}'` shows, for both platforms, `org.opencontainers.image.source=https://github.com/lorenzh/pulse-<svc>`, `revision=<SHA>`, `version=0.1.0`, `licenses=MIT`, where `<SHA>` is `git rev-parse v0.1.0^{commit}` in a fresh clone of the service (independent of the image). `--raw` shows the same four keys as index annotations.
3. **Provenance**: `gh attestation verify oci://ghcr.io/lorenzh/pulse-<svc>:0.1.0 --owner lorenzh` exits 0 for all five, and its output names the service repository and `refs/tags/v0.1.0`.
4. **Red check publishes nothing** (owner, on probe): on a throwaway branch, commit a test `test("release gate", () => { expect(1).toBe(2); })`, tag `v0.0.0-rc.2`, push the tag. In that run `check` fails and `release` shows "skipped"; `gh api /user/packages/container/pulse-probe/versions --jq '.[].metadata.container.tags'` lists no `0.0.0-rc.2`. Delete the branch and tag. Before merge, the config test (Repository: config) is the workflow test that proves the gate inside `release.yml`, and each service PR shows its `release` job skipped on the PR run.
5. **First releases**: owner pushes `v0.1.0` on the merged `main` commit of api, probe, status, notify and console. Logged out, `docker pull --platform linux/amd64` and `--platform linux/arm64` of `ghcr.io/lorenzh/pulse-<svc>:0.1.0`, `:0.1` and `:0` succeed; `:latest` fails.
6. **main publishes nothing**: the package version list of each service shows no version created by a `main` run (each version's tags are a release tag or empty for the per-platform digests of a release run).
7. **Packages**: each package page shows "Public" and "Connected to lorenzh/pulse-<svc>".
8. **Cleanup**: tags `v0.0.0-rc.1` and `v0.0.0-rc.2` deleted (`git push origin :refs/tags/v0.0.0-rc.1`), and the package version `0.0.0-rc.1` (with its untagged platform digests) deleted with `gh api -X DELETE /user/packages/container/pulse-probe/versions/<id>`.
9. **CI green** in config, api, probe, status, notify and console, including both legs of every `docker` job. The measured release duration is posted in #527.

## Repository: config

Files:
- `.github/workflows/release.yml` (new)
- `src/release.test.ts` (new)
- `package.json` (`files` gains `.github/workflows/release.yml`, next to `check.yml` at line 20)
- `README.md`
- `AGENTS.md`

Behavior change: yes — a new reusable CI workflow that publishes images.

Behavior:
- `release.yml` exactly as in "Required behavior → Reusable workflow". The `version` step's script is self-contained bash (no event expressions inside `run:`), so the test can run it.
- Actions used: `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1` (same pin as `check.yml` line 19) and `actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6 # v4.2.2`. No other action.
- README: add `release.yml` to the Files table with the caller snippet from "Callers" (the four permissions the caller job must grant, the `needs` gate, the `if` without status function); describe the tag rules (table), the pre-release exemption, the re-publish refusal, the owner steps (visibility, cleanup); extend "Updating the pin" so step 3 names both `uses:` refs (`check.yml` and `release.yml`).
- AGENTS.md "This repository": list `.github/workflows/release.yml` among the shared files.

Tool facts (verified):
- Bun 1.4.0: `package.json` line 7 `"packageManager": "bun@1.4.0"`. `Bun.YAML.parse` is available (Bun 1.2.21 and newer), so the test needs no YAML package.
- Tests: `package.json` line 31 `"test": "bun test src"`; `bunfig.toml` `[test]` sets `coverage = true` and `coverageThreshold = { lines = 0.8 }` with `test/**` ignored; tests live in `src/*.test.ts` (as `src/index.test.ts`, `src/hook.test.ts`).
- Lint: `package.json` line 32 `biome check . && bun bin/pulse-eslint.js --config eslint.local.config.js .`; `biome.json` `files.ignoreUnknown: true`.
- CI: `.github/workflows/ci.yml` calls `./.github/workflows/check.yml` (lint, typecheck, test on `ubuntu-24.04`, `check.yml` lines 16, 27, 29, 37). Config CI does not call `release.yml`.

Checks — `src/release.test.ts`, parsing `.github/workflows/release.yml` with `Bun.YAML.parse`:
- **Version logic**: extract the `run` script of the step with `id: version`; for each case create a `mkdtemp` git repo (local commits only, no network), create the listed tags, a `refs/remotes/origin/main` ref, run the script with `bash` and env `TAG`, `SHA`, `REPOSITORY`, `GITHUB_OUTPUT=<tmp file>`, and assert the exit code and the output file. Expected values are literals: every row of the tag table, every rejected tag of the Counterexamples (non-zero exit, no `tags=` line), a stable tag on a commit not reachable from `origin/main` (non-zero), a pre-release on such a commit (zero), `v0.10.0` with `v0.9.0` present (`0.10.0 0.10 0`), `REPOSITORY=lorenzh/Pulse-Probe` (non-zero). **Overlapping releases**: `v0.1.1` is tagged while the `v0.1.0` run has already computed its tags; the recomputation in `publish` for `v0.1.0`, run after `v0.1.1` exists, yields only `0.1.0` (no `0.1`, no `0`), so aliases never move backward (literal expected values).
- **Structure**: workflow `permissions` equals `{}`; the permissions of each job equal the literal maps in "Required behavior" (deep equality, so an extra scope fails); `publish.needs` contains `version`, `build-amd64`, `build-arm64`; `publish.concurrency.group` is `release-${{ github.repository }}` (no ref) with `cancel-in-progress: false`; `publish` does not read `needs.version.outputs.tags`; every `docker buildx build` in a `run:` contains `--builder pulse-release` and the builder creation contains `--use`; both build jobs need `version`; every `uses:` matches `^[^@]+@[0-9a-f]{40}$`; every `actions/checkout` step has `persist-credentials: false`; no `run:` contains `${{ github.ref_name }}`, `${{ github.event`, or `${{ secrets.`; no `run:` or `-t` value contains `latest` or `edge`; `runs-on` of `build-arm64` is `ubuntu-24.04-arm`; the attest step has `push-to-registry: true` and `create-storage-record: false`.
- Each structural assertion is shown to fail once against a mutated copy of the YAML in the test (for example `publish` without `build-arm64` in `needs`), so the test is not vacuous.

Completion evidence: `bun run check` passes locally and in CI; the PR lists the test cases and quotes the failing mutation cases.

## Repository: api

Files:
- `.github/workflows/ci.yml`
- `package.json` (`@lorenzh/pulse-config` pin, line 24)
- `bun.lock`
- `docs/development.md`
- `README.md`

Behavior change: yes — CI gains an arm64 image leg and a tag-triggered release job.

Behavior:
- `ci.yml` as in "Callers": tag trigger; conditional `cancel-in-progress`; `check` (line 17) and `release` on the merged config SHA; `docker` (line 32, now `ubuntu-latest`) becomes the two-runner matrix with its four existing steps unchanged; `release` with `needs: [check, docker, bench-selftest]`. `bench-selftest` (line 19) and `compose-e2e` (line 48) stay otherwise unchanged; `compose-e2e` is not a gate.
- `docs/development.md` (sections today: Run, Code layout, Test, Performance bench, Lint and format, CI, Documentation): new section `## Releasing` after `## CI`: tag format and where a stable tag may point; command `git tag vX.Y.Z <sha on main> && git push origin vX.Y.Z`; the gate (`check`, both `docker` legs, `bench-selftest`); the image `ghcr.io/lorenzh/pulse-api` and its tags; no `latest`, `main` publishes nothing; never move a release tag (the workflow refuses a re-publish); verify with `gh attestation verify oci://ghcr.io/lorenzh/pulse-api:<version> --owner lorenzh`; pin by digest in setups. Update `## CI` to name the arm64 leg and the `release` job.
- README: name the image `ghcr.io/lorenzh/pulse-api` (with one `docker pull ghcr.io/lorenzh/pulse-api:0.1.0` line) and link the Releasing section. The Compose section stays as it is.

Tool facts (verified): config pin `51e95b0…` in `package.json` line 24 and `ci.yml` line 17; `check.yml` at that SHA is identical to the config clone (fetched with `gh api …/contents/.github/workflows/check.yml?ref=51e95b0…`, `diff` empty) and runs lint, typecheck, test (`check.yml` lines 27, 29, 37); scripts `lint` `biome check . && pulse-eslint .`, `typecheck`, `test` `bun test` in `package.json` lines 14 to 16; `biome.json` line 2 extends `@lorenzh/pulse-config/biome.json`.

Completion evidence: CI green on the PR with both `docker` legs passing and `release` shown as skipped; the PR states that the three pins carry the same SHA.

## Repository: probe

Files:
- `.github/workflows/ci.yml`
- `package.json` (`@lorenzh/pulse-config` pin, line 23)
- `bun.lock`
- `docs/development.md`
- `README.md`

Behavior change: yes — CI gains an arm64 image leg and a tag-triggered release job.

Behavior:
- `ci.yml` as in "Callers": `check` (line 17) and `release` on the merged config SHA; `docker` (line 18, now `ubuntu-latest`) becomes the matrix, its steps unchanged; `release` with `needs: [check, docker]`.
- `docs/development.md` (sections: Run locally, Layout, Checks, Hooks and CI): new `## Releasing` after `## Hooks and CI`, content as for api with `pulse-probe` and gate `check` plus both `docker` legs.
- README: name `ghcr.io/lorenzh/pulse-probe` next to the existing local `docker build`/`docker run` lines (lines 21, 22) and show `docker run` with `ghcr.io/lorenzh/pulse-probe:0.1.0`.
- Probe is the service for the owner's test tag and the failing-test demonstration (Acceptance 1 and 4).

Tool facts (verified): config pin in `package.json` line 23 and `ci.yml` line 17 (same pinned `check.yml` as above); scripts in `package.json` lines 14 to 16; `biome.json` line 2 extends the shared config.

Completion evidence: as for api.

## Repository: status

Files:
- `.github/workflows/ci.yml`
- `package.json` (`@lorenzh/pulse-config` pin, line 24)
- `bun.lock`
- `docs/development.md`
- `README.md`

Behavior change: yes — CI gains an arm64 image leg and a tag-triggered release job.

Behavior:
- `ci.yml` as in "Callers": `check` (line 17) and `release` on the merged config SHA; `docker` (line 19) becomes the matrix with both steps (build, test-file and dev-path check) unchanged; `release` with `needs: [check, docker, a11y]` (`a11y` line 44 is the accessibility test suite and gates the release).
- `docs/development.md` (sections: Run locally, Code layout, Checks, Lefthook, CI, Shared configuration): new `## Releasing` after `## CI`, content as for api with `pulse-status` and gate `check`, both `docker` legs, `a11y`.
- README: name `ghcr.io/lorenzh/pulse-status` next to lines 37, 38.

Tool facts (verified): config pin in `package.json` line 24 and `ci.yml` line 17; `typecheck` also checks `e2e` (`package.json` line 13); `lint`/`test` lines 14, 15; `biome.json` line 2 extends the shared config.

Completion evidence: as for api, plus `a11y` green.

## Repository: notify

Files:
- `.github/workflows/ci.yml`
- `package.json` (`@lorenzh/pulse-config` pin, line 22)
- `bun.lock`
- `docs/development.md`
- `README.md`

Behavior change: yes — CI gains an arm64 image leg and a tag-triggered release job.

Behavior:
- `ci.yml` as in "Callers": `check` (line 17) and `release` on the merged config SHA; `docker` (line 19) becomes the matrix, steps unchanged; `release` with `needs: [check, docker]`. The `docker` job's `actions/checkout` (line 24) gains `persist-credentials: false`, as in the other services.
- `docs/development.md` (sections: Run and test, Code map, Lint and hooks): new `## Releasing` at the end, content as for api with `pulse-notify`.
- README: name `ghcr.io/lorenzh/pulse-notify` next to lines 31 to 37.

Tool facts (verified): config pin in `package.json` line 22 and `ci.yml` line 17; scripts `package.json` lines 12 to 14; `biome.json` line 2 extends the shared config.

Completion evidence: as for api.

## Repository: console

Files:
- `.github/workflows/ci.yml`
- `package.json` (`@lorenzh/pulse-config` pin, line 22)
- `bun.lock`
- `docs/development.md`
- `README.md`

Behavior change: yes — CI gains an arm64 image leg and a tag-triggered release job.

Behavior:
- `ci.yml` as in "Callers": `check` (line 17) and `release` on the merged config SHA; `docker` (line 19) becomes the matrix with all its steps unchanged (image content checks, `/readyz` smoke test, non-root, headers, token not leaked, `docker stop` exit 0, missing `PULSE_API_URL` exit 2), so the smoke test runs on arm64 too and gates the release; `release` with `needs: [check, docker]`.
- `docs/development.md` (sections: Run locally, Code layout, Checks, Tests, Lefthook, CI, Shared configuration): new `## Releasing` after `## CI`, content as for api with `pulse-console`.
- README: name `ghcr.io/lorenzh/pulse-console` next to lines 26, 27.

Tool facts (verified): config pin in `package.json` line 22 and `ci.yml` line 17; scripts `package.json` lines 13 to 15; `biome.json` line 2 extends the shared config.

Completion evidence: as for api, with both legs of the container smoke test green.
