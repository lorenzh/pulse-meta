# Issue review #556: Service images and CI

## Verdict

Ready for `plan`; no blocking question. The required behavior is clear enough to specify with the assumptions below. Some findings have already been fixed by #527, so the spec must describe the remaining work rather than repeat the historical audits.

Read the live issue and all comments on 2026-10-31. The only comment was the Factory claim, with no earlier decisions: https://github.com/lorenzh/pulse-meta/issues/556#issuecomment-6548646850.

## Inspected baseline

Read the root `AGENTS.md`, `README.md`, `docs/approved-packages.md`, the service instructions, and the files in the read-only clones. These are the captured main revisions, not proposed dependency pins:

| Repository | Inspected commit |
| --- | --- |
| api | `c00a375a1d78e17e9d01b8c25b5ae69b4fc3860e` |
| probe | `50ec9cabe8aebe6164eff6cf2272b0a6c6c86605` |
| status | `2e3067d90eeb41ee6086060d1e52d34ef30b9c22` |
| notify | `c090a07811590eb158849fb9981f3c94fec74276` |
| console | `11a3f5f85170bf068875509cf3d6f54559742177` |
| config | `dc69a126bebbe50d8a7339ea1325d51b2ea43d7d` |
| contract | `ebcbbb613328494185833f7133f1242910986948` |

### Images and documentation

- All five Dockerfiles have `WORKDIR /app`, `NODE_ENV=production`, a non-root runtime user, the approved digest-pinned Bun 1.4.0 base, and a final `CMD ["bun", "src/main.ts"]` (notify: `src/index.ts`). None disables env-file loading.
- All five also run Bun in `HEALTHCHECK CMD`, without `--no-env-file`. These are additional processes that can load mounted dotenv files even after the service startup command is fixed.
- `.dockerignore` already excludes `.env*` in every service. This does not protect against a file mounted into `/app` at runtime.
- Probe `docs/install.md:23-32` describes source-run autoload and explicitly says that a file mounted into `/app` would load in the image. Its Docker description at line 36 still names the old command. `docs/troubleshooting.md:10-11` also describes autoload as a possible source of conflicting token settings.
- Notify `docs/install.md:30` names the old startup command. Each service needs a short operator-facing statement of the image's new configuration boundary, even where it does not currently mention dotenv.
- API's `.env.example`, `docs/install.md:57-75`, `docs/configuration.md:257-269`, and Compose checks concern host-side Compose interpolation. Console `docs/configuration.md:51` explains that distinction. These do not require Bun inside a container to load a dotenv file.
- Every service validates `PULSE_LOG_LEVEL`; accepted values are the literals `debug`, `info`, `warn`, `error` in kit `src/logger.ts:3,29-30`. Service reads are in api `src/start.ts:126`, probe `src/settings.ts:76`, status `src/main.ts:10`, notify `src/config.ts:395`, console `src/main.ts:13`. An invalid marker in this setting gives an observable loading test without exposing tokens or adding a production diagnostic endpoint.

### CI: historical findings versus remaining defects

`docs/approved-packages.md:46` now approves target checkout `3d3c42e5aac5ba805825da76410c181273ba90b1` (v7.0.1), with `persist-credentials: false`. Do not downgrade targets to meta's separately scoped v5 checkout pin. Setup Bun `0c5077e51419868618aeaa5fe8019c62421857d6` is also already approved.

| Repository | Direct checkout steps | Remaining finding |
| --- | --- | --- |
| api | `ci.yml:25,42,72`; `bench.yml:36` | All four omit `persist-credentials: false`. `bench.yml:52` uses `actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9` (comment: v7.0.2), which has no entry in the approved list. |
| probe | `ci.yml:28` | Already uses the approved SHA and disables persisted credentials. Needs a continuing policy check. |
| status | `ci.yml:29,55` | Both already comply. Needs a continuing policy check. |
| notify | `ci.yml:29` | Already complies. Audit finding SEC-10 is fixed on this baseline. Needs a continuing policy check. |
| console | `ci.yml:29` | Already complies. Needs a continuing policy check. |

All five call config's `check.yml` and `release.yml` at `dc69a126bebbe50d8a7339ea1325d51b2ea43d7d`, also their devDependency pin. The clone is that exact revision, so its reusable workflows were inspected at the consumers' actual pin. Shared `check.yml` already uses approved checkout/setup-bun pins and disables persisted credentials. Shared `release.yml` already disables credentials on all four checkouts and uses the approved `actions/attest` SHA. No release-workflow fix is needed.

Every service has a `docker` job with native amd64 and arm64 runner legs. Existing checks build the production image and inspect its contents; console additionally starts its real image. API also has scheduled/manual `bench.yml`, `bench-selftest`, and `compose-e2e`; status has `a11y`. The new policy check must cover all workflow files, including the scheduled bench workflow, rather than inspect only `ci.yml`.

The audit's unapproved `alpine/openssl` observation is also stale: that digest is now listed in `docs/approved-packages.md`. It is not another image change for this issue.

### Notify contract

Notify `package.json` and `bun.lock` pin `61f7bf88c38ab4827fb47e9409e18d37b9a7ccd3`. The inspected contract main is `ebcbbb613328494185833f7133f1242910986948`; its `src/schema.ts:13-22,246` restricts HTTP check URLs to `http:` or `https:`. API and probe already use this newer revision. Notify has fake-API coverage in `test/check-types.test.ts`; `src/api.ts:170-174` validates fetched checks with the imported contract's `validateCheck`. A consumer pin/lock update suffices; no contract implementation task is needed. Status has a different contract pin, but changing it is not requested.

## Open points for the spec (nonblocking)

1. **What "docs no longer describe the autoload" covers.** The requested guarantee is for images. Keep source-run behavior accurate if `package.json` still starts plain Bun; replace probe's long autoload guidance with a concise image guarantee and, if necessary, a qualified source-run note. Do not claim that source commands changed unless they actually do. Correct the troubleshooting advice and old Docker command descriptions too. Preserve Compose's separate `.env` interpolation and explicit `docker run --env-file` / Compose environment injection.

2. **Healthcheck processes.** Include `--no-env-file` in every Bun invocation in the runtime image's CMD and HEALTHCHECK CMD. Otherwise the image still has an implicit configuration reader. Keep the existing probes, paths, timings, user, base digest, and ports. Build-time installs and developer scripts are outside this runtime guarantee.

3. **No approved upload-artifact entry exists yet.** There is no existing approved SHA to substitute. Recommended resolution: verify the existing GitHub-owned action's exact commit/version, maintenance and licence, and add the reviewed pin and benchmark-only use to `docs/approved-packages.md` in the spec PR. This follows #527's precedent of approving actions in the meta spec PR; merging that PR is the review. Do not silently call a 40-character SHA "approved", delete benchmark artifacts, or exempt this action from the guard. If verification selects a different pin, preserve the artifact name, contents, retention behavior, and failure handling. This review has not independently verified the upstream upload-artifact release.

4. **Where the CI guard lives.** Service instructions say shared tooling rule changes belong in config. Recommended design: a shared validator distributed by config, then service devDependency/check-workflow pin updates and calls from their normal checks. Include config as a prerequisite target if its released code is needed. A per-service implementation is technically possible, but the plan must explain policy ownership and avoid five diverging copies. Bun 1.4.0 provides `Bun.YAML.parse`; no YAML package is necessary.

5. **The source of approval.** Define an exact action-identity-to-SHA map from the reviewed meta list, including its scope. A reproducible, checked-in policy snapshot may cite the meta revision; do not fetch mutable meta main during every CI run. Document how an approved change updates that snapshot. Never generate the expected allowlist from the workflows under test. Include the upload approval from item 3 before the API guard is enabled.

6. **Internal reusable workflows.** Calls to `lorenzh/pulse-config/.github/workflows/check.yml` and `release.yml` are internal dependencies, not third-party marketplace actions. Give them explicit allowed paths and full commit pins in policy; an arbitrary `lorenzh/*` or arbitrary 40-hex ref is not sufficient. The check pin may move with a new config release, while the release pin stays at the inspected revision. Include the third-party actions in the called workflow revisions in the approval audit; current pinned shared workflows already comply.

7. **Guard semantics.** Parse every `.github/workflows/*.yml` and `*.yaml`, inspect each job/step and every relevant `uses`, and validate checkout's own `with` map. Count matching strings is insufficient: one compliant step cannot excuse another missing the setting. Reject unknown actions, unapproved SHA values, tags/branches, missing or true credential persistence, and dynamic values that evade verification. The spec should decide how local/composite actions are treated; none are present in these service workflows. Fail closed on malformed input and report file/job/step, without credentials. The guard must run on pull requests as well as main pushes.

8. **Release jobs unchanged.** Keep every service's entire `jobs.release` block, including `uses`, `needs`, conditions and permissions, and config's `release.yml` unchanged. Integrate checks into existing prerequisite jobs rather than adding a release dependency. If config changes, update service tooling and `jobs.check.uses` separately from `jobs.release.uses`; their refs may legitimately differ. Continue the existing multi-arch build/attestation behavior from #527 without rerunning that feature.

9. **Actual service startup, observable marker.** A `docker run --entrypoint bun ... -e` test can pass while the default CMD remains unsafe. Start the built image with its default command, mount only a readable fixture at `/app/.env`, and observe a real service outcome. Do not mount over `/app`, override `NODE_ENV`, pass the marker as an environment variable, or provide the same setting through the environment so it masks the file. Do not use `docker exec env` to infer the PID 1 environment: exec starts a separate process. Absence from logs alone is not proof.

10. **Healthy fixture requirements.** Supply all required configuration independently of dotenv: API checks/tokens and writable DB storage; probe token; notify nonempty channel config and writable state; console API URL. Use local fake peers where needed, never public endpoints. Notify's liveness also reflects poll failures (`src/index.ts:237-249`), so provide a working fake API for a stable check rather than rely on racing its failure counter. Keep fixture permissions readable by the non-root user. Specify deadlines and unconditional container/network/temporary-file cleanup.

11. **Notify pin completion.** Pin the full inspected contract SHA, regenerate the lockfile with Bun, and verify a frozen install. Preserve support for all six check types. Exercise rejection of non-http(s) HTTP check URLs in notify's actual validation path; this does not forbid TLS/TCP/DNS/domain/heartbeat check types. Do not add ad hoc URL validation or copy contract schemas into notify.

## Assumptions

- Product scope is api, probe, status, notify and console. Meta's action approval belongs in the spec PR. Config may additionally change to supply the shared CI guard; contract, kit, deploy and website need no implementation task.
- Existing #527 release behavior and already compliant checkout pins/settings are retained. API receives the four missing credential settings. No registry credential scheme changes are implied.
- The image guarantee includes all automatically discovered dotenv variants, including `.env.production` and `.env.local`, because the runtime flag disables discovery. Explicit operator-provided environment and documented configuration/secret files remain supported.
- Source-run dotenv behavior is outside the required runtime change. Compose host interpolation and explicit env-file injection remain supported and are documented distinctly.
- New checks use existing Bun/Docker capabilities and no new runtime dependency. There are no new wire fields, routes or production debug interfaces.
- This is security-impacting work: Docker startup, CI credential handling, action pins and notify's contract dependency all change.

## Derived acceptance check

### 1. Runtime image regression in every service

Run in each existing Docker matrix leg, using that leg's freshly built production image:

1. With valid explicit configuration and local fixtures, start the image's unmodified default CMD and establish a healthy HTTP response. Expected statuses come from literals in the test, e.g. `/healthz` answers `200`.
2. Repeat with a read-only `/app/.env` containing the literal `PULSE_LOG_LEVEL=dotenv-marker-556`. Leave `PULSE_LOG_LEVEL` absent from the container's explicit environment and do not load the fixture with Docker `--env-file`. Require successful startup and the same healthy response within a bounded deadline, then stop cleanly. A mounted file must actually exist, be nonempty and be readable as the image user.
3. As a control, run the same image with that literal value supplied through `-e PULSE_LOG_LEVEL=dotenv-marker-556`; require startup exit `2` and a diagnostic naming `PULSE_LOG_LEVEL`. This demonstrates that real environment configuration is still read and that the marker would be observable if loaded from the file.
4. Repeat the file case for `.env.production` and `.env.local`, or specify equivalent coverage of automatic dotenv variants. Also verify each runtime HEALTHCHECK Bun command disables dotenv; if behaviorally checking it, execute the image's actual configured healthcheck rather than a substituted probe.

The marker is intentionally outside the four documented log levels. Current main's default CMD loads it and fails startup; the fixed image ignores it and starts. No secret is used. Implementers must record that red/green result against the captured baseline or an equivalent temporary reversion of the CMD flag, not merely assert that the test would fail. The `.env` case is mandatory in all five services.

### 2. CI policy regression

- The normal PR/main checks in each service validate all its workflow files against the independently approved policy. Include API `bench.yml`, not just workflows that run on PRs. Shared workflow action pins are audited at their exact referenced revisions.
- With current API workflows as input, the validator rejects all four missing checkout settings and the upload action until the new approval is present. Already compliant services should pass, then fail under the mutations below; no current failure is expected for behavior already fixed on main.
- Temporary fixture mutations must cause failure for an otherwise valid 40-hex but unapproved SHA, an unknown action using an approved action's SHA, a tag such as `@v7`, and any checkout missing its own `persist-credentials: false` or setting it true. A second compliant checkout, an unrelated false setting, comments, or an unexamined `.yaml`/bench workflow must not hide the defect. Keep malformed-YAML coverage. Internal workflow refs also require their explicit permitted path/ref.
- The merged policy's external action identities and SHAs match `docs/approved-packages.md`, including the separately reviewed upload action. Expected SHA values come from that approved source, never from the workflows being checked. A changed SHA with the same length must fail.

### 3. Notify contract regression

- `package.json` and the resolved `bun.lock` entry use literal `ebcbbb613328494185833f7133f1242910986948`; `bun install --frozen-lockfile` succeeds.
- Through the notifier's fake-API validation path, a valid HTTP/HTTPS check is accepted, while an otherwise identical HTTP check with `file:///tmp/dotenv-marker-556` or `ftp://example.invalid/check` is rejected as malformed. Use the resulting validated-check behavior/log to prove rejection, without claiming notify fetches check targets. This distinguishes the contract upgrade from an edit only to package metadata.
- Existing `test/check-types.test.ts` still accepts HTTP, TLS, heartbeat, TCP, DNS and domain checks and names their notifications correctly. The full notify suite passes.

### 4. Preserve supported behavior and gates

- All five service checks and both Docker architectures pass; API's bench selftests and Compose e2e, and status's a11y check, remain green. If config changes, its own checks pass before consumers adopt its merged pin.
- Compare each `jobs.release` block and the pinned shared release workflow with the captured baseline: unchanged. No release is published merely to validate this feature.
- Operator docs state that runtime images ignore mounted dotenv files, explain explicit environment/documented file configuration, and preserve correct Compose and source-run instructions. Existing token/config-file mechanisms continue to work with the new startup command.

## Evidence limits of this review

This state performed repository inspection and derived implementation checks; it did not build or run the five service images or assert that their CI is green. Locally, Bun reports `1.4.0`; `bun --no-env-file -e ...` succeeds and `Bun.YAML.parse` is available. Docker's daemon is available. These capability checks do not substitute for the per-service red/green image evidence required above.
