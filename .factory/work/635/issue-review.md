# Issue review #635: redact URL credentials in Compose diagnostics

Verdict: ready for `plan`. No question blocks the spec.

## Sources and current behavior

- Read [issue #635](https://github.com/lorenzh/pulse-meta/issues/635) and all its comments. The only comment is this run's Factory claim; no earlier decisions need to be carried forward.
- Read meta's `AGENTS.md`, `README.md` and issue-review prompt, and deploy's `AGENTS.md`, package scripts, CLI Docker access, lifecycle, status, entry point and relevant tests and fake Docker helpers.
- Inspected the read-only deploy clone at `621cbf0ecbd98b7dca1424055fba12f657827410`. The CLI introduced by [pulse-deploy#4](https://github.com/lorenzh/pulse-deploy/pull/4) is already present. This work extends that CLI; it must not recreate the setup wizard or wait for an unmerged prerequisite.
- `cli/docker.ts:99` exports `firstLine`, which returns the first nonblank newline-separated line verbatim, or an empty string. It does not sanitize credentials. The example `/x/http:/u:SENTINEL@127.0.0.1:1/x.yaml` therefore reaches diagnostics unchanged by this helper.
- There are five diagnostic call sites in `cli/docker.ts`:

| Failure | Source line | Existing CLI exit code |
| --- | --- | --- |
| Docker daemon preflight | 139 | 3 |
| Compose config resolution | 344 | 1 |
| Docker container listing (`docker ps`) | 379 | 1 |
| Docker volume listing | 411 | 1 |
| Docker volume inspection | 421 | 1 |

- These failures are shared by `up`, `down` (including `--volumes`) and `status` through project resolution. `guarded` in `cli/lifecycle.ts` prints the `CommandError` message with the command prefix and returns its exit code. `main` accepts Docker dependency overrides, and `cli/test/fake-docker.ts` supplies a fake spawn, captured output and installation fixtures, so the regression can be tested without Docker or a network request.
- Compose `up` and `down` pass child output directly to the terminal with `inherit: true`; that output does not pass through `firstLine`. The status operation's separate Compose `ps` failure prints only an exit code. These paths are distinct from the five diagnostics named by this issue.

## Open points and working assumptions

1. **Affected repository and scope.** Only deploy needs product changes. Interpret “every diagnostic built with firstLine” to include all five call sites, including plain Docker errors and the preflight error, rather than only Compose config failures. A shared sanitization step in or immediately around `firstLine` can cover them consistently. No changes to service repositories, Compose generation, input validation, Factory configuration or runtime dependencies are required.
2. **Meaning of user info.** Mask the entire user-info component before the authority's `@`, including the username and any password. Password-only masking would leave user info visible. Cover username-only credentials and empty username/password forms as well as `user:password`; treat percent-encoded credentials as opaque text to mask without decoding or echoing them.
3. **Recognizing the URL inside diagnostic text.** Match both `scheme://userinfo@host` and Compose's `scheme:/userinfo@host`, including occurrences embedded after a filesystem prefix such as `/x/`. At minimum cover HTTP and HTTPS in either slash form; use normal case-insensitive URL scheme recognition rather than assuming lowercase `http`. Apply masking to every credential-bearing URL in the selected line. Preserve the scheme, slash count, host, port, path and surrounding error text. Whole-line URL parsing alone is insufficient for the supplied embedded, single-slash example.
4. **Mask text and readability.** The request does not prescribe a placeholder. The spec can choose a fixed, recognizable placeholder such as `[redacted]` for the whole user-info component, retaining `@` and the authority. The mask must not depend on the credential's contents or length. For example, the supplied line could become `open /x/http:/[redacted]@127.0.0.1:1/x.yaml: no such file or directory`.
5. **Existing helper behavior.** Preserve selection of the first nonblank line, the empty result for blank-only stderr and the selected line's noncredential text. Messages without credential-bearing URLs must remain unchanged, including ordinary filesystem paths, credential-free URLs and email-like text without a URL scheme. Preserve existing error prefixes, guard ordering and exit codes, including the missing-volume exception during volume inspection.
6. **Limits.** This request concerns URL user info in diagnostics assembled using `firstLine`. Query strings, fragments, arbitrary secrets elsewhere in a message, unrelated diagnostics and inherited Compose output are outside its stated scope. Do not turn this fix into a general output filtering or subprocess streaming redesign. No blocking policy choice is needed to specify the requested change.
7. **Regression design.** An assertion that output lacks `SENTINEL` can pass if the failing Docker call is never reached or the entire diagnostic disappears. Require the expected error prefix, readable suffix and existing exit code as positive evidence. Inject failing spawn results through the existing dependency seam; a live malformed override is optional corroboration, not a prerequisite for a deterministic test.

## Derived acceptance check

Run these checks in the later writable deploy implementation checkout:

1. Create a valid installation fixture and arrange for Docker preflight to succeed but the Compose config call to return nonzero with stderr exactly `open /x/http:/u:SENTINEL@127.0.0.1:1/x.yaml: no such file or directory`. Invoke `pulse status` through `main` with injected Docker dependencies (or the equivalent command handler with captured stdout and stderr). Require exit 1, `pulse status: docker compose config failed:` in stderr, no `SENTINEL` or original user-info component in either output stream, and retained `/x/http:/`, `127.0.0.1:1/x.yaml` and `no such file or directory`. This regression must fail against the current unsanitized implementation.
2. Exercise all five diagnostic failure sites with credential-bearing stderr. Require masked output, the appropriate diagnostic prefix and the unchanged exit code from the table. Let preceding guard steps succeed so each intended call site is reached; the inspection case must be an actual error rather than the ignored `no such volume` case. Confirm shared guard behavior for `up`, `down`, `down --volumes` and `status`, using the existing command matrix where practical.
3. Add focused cases for single- and double-slash HTTP/HTTPS URLs, embedded paths, multiple URLs on one line, username-only user info, empty username/password components and percent-encoded credentials. Assert the whole user-info component is masked while noncredential text remains readable. Include a mixed-case scheme. Credential-free URLs, ordinary paths, plain text, blank-only stderr, leading blank lines and multiline stderr must retain the existing first-nonblank-line behavior; later lines must not be emitted.
4. Run deploy's required CLI checks: `bun install --frozen-lockfile && bun run check`. If shell tests are changed, also run every required check of the affected CI job, including the build and Docker failure-path script as applicable under deploy's `AGENTS.md`.

## Review validation

This state inspected source and issue history; it did not modify any target clone or claim execution of the proposed regression tests. The initial artifact-directory lookup found that `.factory/work/635/` did not yet exist; writing this artifact creates it. Only this review artifact was written. Keep it available to later states without adding an ignore rule.
