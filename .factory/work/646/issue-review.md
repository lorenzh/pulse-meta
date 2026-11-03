# Issue review: #646 — bind the E2E header secret to its host

## Disposition

Ready for `plan`. No question blocks the spec. The implementation belongs only to `deploy`, in the probe environment of `e2e/compose.e2e.yaml`.

## Request and earlier decisions

- Read [issue #646](https://github.com/lorenzh/pulse-meta/issues/646) and all its comments. The only comment is this run's Factory claim; there are no earlier decisions to incorporate.
- The request specifies the exact binding and requires two complete E2E runs: the existing pinned probe and an image built from probe `main`. Preserve the existing leak checks and change no probe or API behavior or dependencies.
- Probe PR #52 / meta #645 explains discovery of this problem, rather than additional work to implement here. The inspected probe `main` already contains that merge and host binding support, so planning does not need to wait for it or recreate it.

## Verified repository context

Read meta `AGENTS.md`, `README.md` and the issue-review prompt, and deploy/probe `AGENTS.md`. Inspected both clones directly without editing them.

| Target | Inspected main HEAD | Relevant files |
| --- | --- | --- |
| deploy | `d4fa0eeb4ff2639e17248d813046ac9e5968cf39` | `e2e/compose.e2e.yaml`, `e2e/compose-e2e.sh`, `e2e/ro/checks.json`, `e2e/target.mjs`, `common/services.yaml`, `scripts/check-setup.sh`, `.github/workflows/ci.yml`, `README.md` |
| probe | `89f12324a6e77d5a716beacc22e178b8e1112284` | `src/settings.ts`, `src/header-hosts.ts`, `src/client.ts`, `src/client.http-options.test.ts`, `src/main.ts`, `docs/configuration.md`, `Dockerfile` |

- Deploy's shared probe image is pinned to `0.1.0` plus a digest in `common/services.yaml`. The E2E overlay sets `PULSE_HEADER_SVC_TOKEN` on the probe, including the `Bearer ` scheme, but does not set `PULSE_PROBE_HEADER_HOSTS`.
- `e2e-post` references that variable for its Authorization header and calls `http://e2e-target:8000/svc`. The target returns success only for the expected method, route, Authorization, content type and body, and never logs headers or bodies.
- Probe parses the host policy at startup, defaults to an empty map, and compares the URL hostname exactly against the allowed hosts for each variable. `e2e-target` is the required bare hostname; neither a scheme nor `:8000` belongs in the binding. An unbound reference becomes a down result without sending the request. The startup log prints only the number of bound variables.
- Probe's migration documentation explicitly says an older probe ignores this variable, so it can be set before upgrading. Compatibility with the pinned binary remains a required runtime check, not a result established by this review.
- The E2E already waits up to 90 seconds by default for `e2e-post is up`, exercises JSON mismatch, HTTP 503 and invalid JSON, then waits for recovery. Its `assert_absent` checks the service token value, body sentinel and variable name in `GET /checks`, `GET /metrics`, the status page's `/api/checks` proxy, and combined container logs.
- The script always selects `full/compose.yaml:e2e/compose.e2e.yaml`, starts with `--pull missing`, rejects any service with a `build` key, and uses its own `pulse-e2e` project and teardown. CI's `full` job runs this script against the published pins. Setting `COMPOSE_FILE` externally will not select a locally built probe because the script overwrites it.
- Deploy's static rules forbid image lines in E2E/setup files and keep pins exclusively in `common/services.yaml`.

## Open points and assumptions for planning

1. **Representation is a routine implementation choice.** Add a quoted YAML string with JSON content: `PULSE_PROBE_HEADER_HOSTS: '{"PULSE_HEADER_SVC_TOKEN":["e2e-target"]}'`. The container receives JSON text without shell assignment syntax or extra quote characters. Keep the binding beside the existing probe header environment value.
2. **Keep the scope to this fixture.** Assume no permanent image bump, general operator setting, new CI matrix, E2E runner redesign, dependency update or change in the normal setups is requested. The existing fixture and assertions cover the behavior; no new probe/API implementation or separate test harness is needed.
3. **Make the second image selection explicit.** The plan must explain how to run the unchanged script with only the probe image replaced. A bounded option is to build probe `main` with its existing Dockerfile to a local tag, temporarily substitute only the probe image reference in `common/services.yaml` for validation, run the script, then restore that file exactly. This is a local validation step, never a committed pin change. Do not add a Compose `build` key or a permanent override file. Run static pin/setup checks on the restored deliverable. Record the actual main commit, built image identity and selection method so a successful run cannot silently use the old image.
4. **Interpret leak coverage using the existing checks.** The requested guarantee applies to the existing checked logs and response surfaces described above. Keep those assertions enabled for both image runs; passing the initial up wait alone is insufficient. The host policy contains a variable name and hostname, never the secret value. Expanding the leak suite or changing its diagnostics is outside this fix.
5. **Runtime evidence belongs to implementation.** Use a Docker-capable environment with Compose >= 2.23, network access, curl, jq and the documented free ports. Keep the other service images at their pins in both runs. If another main-versus-release incompatibility prevents a complete run, record the failure and actual image identities; do not count a partial pass or change unrelated services to manufacture acceptance. Nothing found in source inspection requires a product decision now.

## Derived acceptance check

1. The deploy diff adds the probe environment binding in `e2e/compose.e2e.yaml`. Rendering `full/compose.yaml` with that overlay gives a string whose parsed JSON is exactly `{"PULSE_HEADER_SVC_TOKEN":["e2e-target"]}`. The existing header value, target fixture and check remain intact; the delivered shared image pins and dependencies are unchanged.
2. With the original pinned `0.1.0` probe image, `bash e2e/compose-e2e.sh` exits 0 and reaches `==> All checks passed`, including initial `e2e-post` up, the failure-mode checks, recovery and every existing leak assertion.
3. Build an image from probe `main`, record its commit and image identity, and select it for the probe alone using the documented temporary validation method. A fresh complete `bash e2e/compose-e2e.sh` run also exits 0 and reaches `==> All checks passed`, including the same HTTP and leak assertions. Confirm the selected image actually ran. The main probe's startup count should report one bound variable.
4. Both runs retain the existing timeouts and assertions. The service token value, body sentinel and variable name are absent from the response surfaces and container logs checked by `assert_absent`.
5. Restore any temporary image substitution before handoff, verify the final diff, and run applicable existing deploy checks required by its repository instructions, including static setup validation and the affected `full` job checks. The implementation PR reports the two commands/results and identifies the two tested probe images. No probe/API behavior change or new dependency is delivered.

## Review validation

This state performed source and issue/comment inspection only; it did not run the Docker E2E or claim either image passed. The initial issue-fetch argument error was corrected and the issue was retrieved. The absent artifact directory is created by this review artifact. Only this meta artifact was written; no target files, labels or provider comments were changed.
