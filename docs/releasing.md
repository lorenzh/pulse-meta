# Releasing

This page holds the release facts and procedures for all pulse repositories. Read it before you cut a release.

Each section has a mark:

- **CURRENT**: works today.
- **PLANNED**: decided by the owner on 2026-11-09. Issue [#943](https://github.com/lorenzh/pulse-meta/issues/943) builds it. Until #943 is merged, use the CURRENT path.

## State per repository (2026-11-09)

| Repository | Tags | What a release publishes today |
|---|---|---|
| `api`, `probe`, `status`, `notify`, `console` | `v0.1.0` | Image `ghcr.io/lorenzh/pulse-<svc>` with tags `0.1.0`, `0.1`, `0`, published 2026-10-31. No GitHub release object. |
| `deploy` | none | `release.yml` exists (CLI binaries). It has not run yet. |
| `contract`, `kit`, `config`, `website` | none | No release path. |
| `agent` | none | No CI. |
| `meta` | none | Never released. |

- No pulse npm package exists. Internal dependencies are git dependencies pinned to commit SHAs (for example `github:lorenzh/pulse-config#<sha>`).
- The `v0.1.0` tags of the five services point to old commits. `main` of `api` and `probe` is well ahead of them.
- No repository has branch protection or a ruleset on `main`.

## CURRENT: service images

Services: `api`, `probe`, `status`, `notify`, `console`.

1. A person pushes a tag: `git tag vX.Y.Z <sha on main> && git push origin vX.Y.Z`.
2. The tag starts the service's `ci.yml`. Its `release` job runs only on a tag and only after all gate jobs passed (`needs` lists every gate; a failed, cancelled or skipped gate skips the release).
3. The `release` job calls the reusable workflow `lorenzh/pulse-config/.github/workflows/release.yml@<sha>`. The SHA must equal the `pulse-config` pin in `package.json` (`pulse-workflows` checks this).
4. That workflow builds `linux/amd64` and `linux/arm64`, pushes one multi-arch index to `ghcr.io/lorenzh/pulse-<svc>`, and attaches a GitHub artifact attestation (SLSA build provenance).

Tag rules (source: pulse-config `README.md`, "Tag rules"):

- The tag matches `vX.Y.Z` or `vX.Y.Z-<pre-release>`: SemVer without build metadata and without leading zeros. Any other tag fails before a build.
- A stable tag must point to a commit on `main` (ancestor of `origin/main`). A pre-release tag may point anywhere.
- Image tags: `X.Y.Z` always. `X.Y` only for the highest stable `vX.Y.*`. `X` only for the highest stable `vX.*.*`. Pre-releases get only their own tag. There is no `latest` and no `edge`.
- A published `X.Y.Z` is never published again: the `publish` job fails with "version already published". Never move or re-push a tag. Use the next version.
- The version comes from the tag only. `package.json` `version` stays `0.0.0` and is not read.
- A tag pushed with a workflow's `GITHUB_TOKEN` starts no workflow. A person must push the tag.
- A push to `main` and a pull request publish nothing.

## CURRENT: deploy CLI

- `release.yml` runs on a pushed `v*` tag. It creates a draft GitHub release, builds three binaries (`pulse-linux-x64`, `pulse-linux-arm64`, `pulse-darwin-arm64`), uploads `SHA256SUMS`, publishes the release, and a `verify` job downloads and checks each binary.
- The CLI prints `pulse <version>` from `package.json` `version`. The build fails when this differs from the tag. Today `package.json` says `0.1.0`.
- deploy pins the service images in `common/services.yaml` by tag and digest, for example `ghcr.io/lorenzh/pulse-api:0.1.0@sha256:…`. All five pins are `0.1.0` today.
- `scripts/bump-images.sh <svc>=<x.y.z> ...` sets a pin (tag plus digest from ghcr.io). `--verify` checks every pinned digest against ghcr.io. `--check-latest` fails when a higher release exists.
- The `pins-latest` job in deploy `ci.yml` runs `--check-latest` on the daily schedule, on Mondays only. It fails when a newer service release exists and deploy still pins an older one.

## CURRENT: open issues that need releases

- [#692](https://github.com/lorenzh/pulse-meta/issues/692) needs an `api` tag that contains commit `e1153f99ba3466f6509d29760896e2cdf5061fb5`, and a `probe` tag that contains `a5dc88d5473a9c63cfd984988201da32cd15ec5c`. `v0.1.0` contains neither (`compare` says `behind`); `main` of both contains them (`ahead`). Any semver tag on today's `main` works, for example `v0.1.1`. Check a tag with `gh api repos/lorenzh/pulse-api/compare/e1153f99ba3466f6509d29760896e2cdf5061fb5...v0.1.1 --jq .status`. `ahead` or `identical` is good.
- [#530](https://github.com/lorenzh/pulse-meta/issues/530) (`pulse upgrade`) tests an upgrade from one release to another. It needs at least two published releases of each image.

## PLANNED: one release line and release on every merge

Rules:

- **Release line**: the highest `major.minor` of any stable tag in any `lorenzh/pulse-*` repository. Every release uses it.
- **When**: every merge to `main` releases, after all gates passed (CD). The tag and the GitHub release are created only after a successful publish, in the same workflow run. Reason: a tag pushed with `github.token` starts no workflow.
- **Next version of a repository**:
  - its latest tag is on the line: patch + 1;
  - the line is higher than its latest tag: `<line>.0`;
  - the pull request has the label `breaking`: major + 1, minor 0, patch 0. This raises the line. Other repositories join it at their next merge.
- A feature and a fix both raise the patch. The minor changes only when a person pushes a tag `vX.Y.0` above the line.
- First release of a repository without a tag: `v0.1.0`. The five services continue with `0.1.1`.
- One version script lives in `pulse-config`. Every repository calls it.
- The version comes from the tag only. `package.json` is not changed. Exception: deploy, where the built CLI version must equal the tag.
- What each repository publishes: services as today (image); deploy as today (binaries); `contract`, `kit`, `config`, `website`: a tag and a GitHub release only. `agent` is skipped until it has CI. `meta` has no release.

The label `breaking`:

- Meaning: the pull request changes documented public behavior in an incompatible way (an API route, a contract shape, a config key, a CLI flag, an image interface).
- Who sets it: the Factory `review` state sets it or asks for it, or a person sets it. It must be on the pull request before the merge. A label added after the merge has no effect.

Why not changesets: pulse publishes no npm package, and the version comes from the tag. A changeset file would add a second source of truth.

Why not a Factory release workflow: a release is deterministic CD with no decision left. Factory only helps the review set the `breaking` label.

## Procedures

### 1. First release `0.1.0` of a repository without a tag

For `contract`, `kit`, `config`, `website` and `deploy`. This makes the line `0.1` official.

1. Get the `main` HEAD and check that CI is green on it:
   ```sh
   repo=lorenzh/pulse-<name>
   sha=$(gh api repos/$repo/commits/main --jq .sha)
   gh api repos/$repo/commits/$sha/check-runs --jq '.check_runs[] | "\(.name) \(.conclusion)"'
   ```
   Every line must say `success` or `skipped`. If not, stop.
2. For deploy only: check `gh api repos/lorenzh/pulse-deploy/contents/package.json -H 'Accept: application/vnd.github.raw' | jq -r .version` prints `0.1.0`.
3. Tag and push from a clone with `main` fetched:
   ```sh
   git fetch origin && git tag v0.1.0 "$sha" && git push origin v0.1.0
   ```
4. What gets published:
   - `contract`, `kit`, `config`, `website`: only the tag. They have no release workflow today, so no run starts. Optional: `gh release create v0.1.0 -R $repo --verify-tag --notes "First release"`.
   - `deploy`: `release.yml` runs. Check: `gh release view v0.1.0 -R lorenzh/pulse-deploy` lists three binaries and `SHA256SUMS`, and the `verify` job is green.

### 2. Release a service by hand (today's path)

1. Pick the version: the next free patch, for example `v0.1.1`. Check that it does not exist: `gh api repos/lorenzh/pulse-<svc>/git/refs/tags/v0.1.1` must answer 404.
2. Check that `main` CI is green (as in procedure 1, step 1).
3. Tag and push: `git tag v0.1.1 <sha on main> && git push origin v0.1.1`.
4. Wait for the tag run: `gh run list -R lorenzh/pulse-<svc> --branch v0.1.1` and `gh run watch <id> -R lorenzh/pulse-<svc>`.
5. Verify:
   ```sh
   gh attestation verify oci://ghcr.io/lorenzh/pulse-<svc>:0.1.1 --owner lorenzh
   docker buildx imagetools inspect ghcr.io/lorenzh/pulse-<svc>:0.1.1   # index with linux/amd64 and linux/arm64
   docker buildx imagetools inspect ghcr.io/lorenzh/pulse-<svc>:0.1 --format '{{json .Manifest}}' | jq -r .digest
   ```
   The `0.1` digest must equal the `0.1.1` digest.
6. Bump deploy: in a deploy branch run `scripts/bump-images.sh <svc>=0.1.1`, then `scripts/bump-images.sh --verify` (prints `ok:` for all five). Open a pull request. Only the `image:` line of that service changes.

For #692, release `api` and `probe` this way, then check the marker commits as shown above.

### 3. Minor bump (for example `0.2.0`)

1. Choose one repository with a green `main`.
2. Push `v0.2.0` on its `main` HEAD, as in procedure 2. The line is now `0.2`.
3. Today: every other repository moves only when a person tags it. PLANNED: every other repository gets `v0.2.0` at its next merge.

### 4. Recovery from a failed release

- **Publish failed, no image**: today the tag already exists (a person pushed it). Find the cause in the run log. If the cause was outside the commit (a runner or registry outage), re-run the failed jobs: `gh run rerun <id> --failed -R <repo>`. If the commit needs a fix, merge the fix and release the next patch. PLANNED: the tag is created only after the publish, so a failed run leaves no tag; the next merge or a re-run releases.
- **Tag exists, image missing or partial**: never move or delete the tag to re-use the version. Release the next patch from a fixed commit.
- **"version already published"**: the image exists. Do nothing for that version. Use the next patch if you need a new build.
- **Wrong image published**: never overwrite it. Release a fixed next patch and bump the deploy pins to it.

### 5. Breaking release walkthrough (PLANNED)

Example: the line is `0.3`. An `api` pull request removes a documented route.

1. The review sees the incompatible change and sets the label `breaking` (or a person does).
2. The pull request merges. The api release computes `v1.0.0` (major + 1). The line is now `1.0`.
3. The api image gets `1.0.0`, `1.0` and `1`. The tag and GitHub release follow the publish.
4. Each other repository releases `v1.0.0` at its next merge.
5. deploy pins move only through `scripts/bump-images.sh`. Bump api only together with the clients that work with the new behavior.

Today the same result needs a person: tag `api` `v1.0.0` by hand, then tag the others when they are ready.

## Open points

- `contract`: `docs/index.md` speaks of "Contract 2.0.0" to "2.5.2", and `package.json` says `2.5.2`. Releases start at `v0.1.0`. The `package.json` version is not read. The wire version (`WIRE_VERSION`, now 1) is separate from both. The contract docs need a note when #943 ships.
- Tag creation in CD needs `github.token` with `contents: write` inside the same run that published, because a tag pushed by that token starts no new run.
- No repository has branch protection. A direct push to `main` would skip the gates of a pull request, and with CD it would release.
