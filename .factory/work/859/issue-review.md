# Issue review: #859 — api reload documentation and unused configuration paths

## Decision and review basis

Ready for `plan`; no question requires a `needs-input` hold. Only `api` is affected; no contract, dependency, setting, endpoint, wire type, schema or migration change is needed. Behavior change: no. Security impact: yes, because the removed writer branches and migrated file tests border secret handling and durable writes; the existing safeguards must survive unchanged.

Reviewed the issue and all supplied comments, meta `AGENTS.md` and `README.md`, API `AGENTS.md`, the API source and the documentation inventory below. The read-only API checkout is clean at `515031bd3fd2aa6b8993e325b24ab08f4a3510d6`, the same base used in the earlier plan reviews. Record the actual implementation BASE before editing, and refresh evidence if it differs. The earlier #859 artifacts are absent from this fresh checkout; the comments preserve their decisions and reported results, but are not fresh test executions. This review creates this artifact only and does not change a target checkout.

The prior reviews resolved these points, which remain binding:

- Correct documentation to match existing deduplication; do not clear `lastWarning` on SIGHUP or change metrics.
- Remove the three loaders and their now-unused private file helpers; retain production parsing and reading entry points and the live admin views.
- Narrow the file writer to components; keep database check writes and the durable component write protocol intact. The previous narrowing trial reported only three errors, all within `src/config-write.ts`; do not add `src/admin-routes.ts` to scope preemptively.
- Structural search commands must use literal backticks inside shell single quotes, without backslashes. Match replacement prose through an external pattern file when convenient, rather than introducing fragile escaping.
- Real-process acceptance uses fresh valid tokens, a supported 1000 ms polling interval, port 0, readiness, and valid-file SIGHUP controls before and after the rejection sequence.
- Preserve all standing scope, baseline, coverage, comments and performance requirements from the issue, and add the manager's document-by-document inventory to the plan and task.

## Repository evidence and resolved assumptions

All target paths and line numbers here refer to the recorded API base.

1. **Deduplication is by the last complete warning line, shared by both entry points.** `src/config-reload.ts:174–185` compares each rejection with `lastWarning` before logging and before recording `invalid`. Successful apply clears it at lines 187–193. `poll()` and `reloadNow()` use the same loader at lines 229–259; forced reload does not reset warning memory. Different bytes or a different file stamp alone do not permit the same rejection to log or count again. A different warning, or a successful apply followed by the same rejection, does permit it. This is memory of the last warning, not a set of every warning seen during the process lifetime.
2. **Do not conflate invalid metrics with apply-error metrics.** Parse and read rejections use `invalid` (lines 179–185, 219–235). Apply errors still record `error` on each failed attempt, while suppressing a repeated warning (lines 195–208). Preserve this distinction and the `ok` count for each successful forced apply (lines 214–226).
3. **The startup wrapper is unused.** `loadInitialConfig` is only declared at `src/config-reload.ts:154–158`. Production startup calls `readInitialConfig` at `src/start.ts:240` and handles its discriminated result, including stored-snapshot fallback at lines 241–264. Keep that result contract, fallback and startup exit behavior unchanged.
4. **The file loaders are test-only.** `loadConfig` and `loadChecks` are declared at `src/config.ts:532–543`; their calls are confined to `src/config.test.ts:64–83`, `src/config.maintenance.test.ts:62–69` and `src/config.examples.test.ts:9–16`. Remove their names from imports, test titles and the stale `parseConfigText` comment too. Remove private `readJson` and `parseFile` at lines 505–513 and 527–530. Keep `parseConfig`, `parseChecks`, `parseNamed`, `parseJsonText`, `parseConfigText`, token loaders and the `readFileSync` import still needed by token loading (lines 545–558). Other modules' unrelated `readJson` functions stay.
5. **Use the production reader for migrated file tests.** `readInitialConfig` at `src/config-reload.ts:119–150` returns rejection data instead of throwing. Assert the returned `ConfigError`, state and safe messages, rather than wrapping it in a new throwing test adapter. Pair it with `nodeConfigFs` (`src/config-fs.ts:78–93`) for actual temporary-file cases. Missing-file text from this reader uses a safe error code, unlike the removed loader's OS message; do not change production to imitate the dead loader.
6. **The check branches of the file writer are unreachable from admin writes.** `src/admin-routes.ts:227–236` dispatches checks to `deps.checks`, maintenance to `deps.maintenance`, then components to the file writer. The `FileKind` parameter at lines 476–484 can narrow naturally without changing the route. Remove check-specific editing only: the union member at `src/config-write.ts:24`, `keepSecret` (232–237), check list mapping (240–244), `referenceOf` (250–259), check replacement/deletion branches (300, 314–319) and response branch (348–351). Update associated comments. Keep `ConfigKind` for route classification and keep `checkView` and `configView` (133–186), which are live views, not dead edit support.
7. **Atomic and secret protections are in scope as invariants.** Preserve validation before storage, revision checks, locking, pending audit recovery, exclusive temp creation, data and directory fsync, rename, adoption and failure handling (`src/config-write.ts:378–600`). Preserve the mode/owner handling and cleanup in `src/config-fs.ts:25–92`. Preserve heartbeat digests, keep markers and redaction in live database paths and views. Do not broaden the cleanup to maintenance, token handling or general parser refactoring.

## Documentation inventory

Search performed explicitly in `.repos/api/README.md` and all `.repos/api/docs` files, since ordinary repository search skips the clones:

```sh
rg -n -i 'reload|sighup|loadinitialconfig|loadconfig|loadchecks|writer|atomic|checks.*(file|database)|components.*file' README.md docs
```

The following is the complete inventory for this handoff, including two contextual documents so the search exclusions are explicit. None of these documents names `loadInitialConfig`, `loadConfig` or `loadChecks`; only source comments and tests name those symbols. The planner must rerun this search and copy the same inventory and dispositions into the plan and the task. Each unchanged path is protected byte-for-byte against BASE. “Still true” below describes the relevant claim, not a certification of every unrelated sentence in that document.

| Document | Disposition and exact base evidence |
| --- | --- |
| `docs/operation.md` | **Changed**, only the paragraph at line 228. It incorrectly says to send SIGHUP to log the same bad file again. Lines 7, 110, 215–219, 226, 230–236, 249–265 and 296 describe surrounding reload, source, security or writer behavior; retain them. The SIGHUP at line 128 concerns backup interruption and is unrelated. |
| `README.md` | **Unchanged and still true**, line 58: polling and SIGHUP apply a changed file without restarting; line 11: database check writes and file component writes. Neither promises repeated warnings. |
| `docs/concepts.md` | **Unchanged and still true**, line 46: applied file windows change also on reload; line 124: file/database maintenance precedence. |
| `docs/configuration.md` | **Unchanged and still true**, lines 3 and 14: runtime file reload and its 0/off or 1000–3600000 ms interval; line 44: startup validation and snapshots; lines 94, 200, 216 and 231: removed-check cleanup, rejected placeholder secrets, file-window reload and component validation. |
| `docs/install.md` | **Unchanged and still true**, line 47: directory mounting is needed to observe an atomic replacement of the checks file. |
| `docs/troubleshooting.md` | **Unchanged and still true for this correction**, line 147: wait for reload or send SIGHUP after adding a check; line 139: a changed heartbeat secret works after apply. Lines 48–61 describe file validation. Line 163's advice to fix/reload the file before retrying a component write remains applicable. See the separate existing mismatch below. |
| `docs/rest-api.md` | **Unchanged and still true**, line 421: checks go to the database, components rewrite the file; lines 433–441: revisions, component-only writeability failures, redaction and the durable file protocol; line 473: database maintenance writes do not need a writable file; line 603: automatic reloads are not audited. Other search hits for “reload” at lines 542, 569 and 589 concern client refresh/retry, not file warning deduplication. |
| `docs/development.md` | **Unchanged and still true**, line 27: `config.ts` parses checks, maintenance, components and tokens. It does not promise either removed file loader. This is a contextual parser-layout match, not a reload-warning claim. |
| `docs/index.md` | **Unchanged and still true**, lines 5–11: documentation links; no matching reload/loader/writer claim. Included to record the complete searched docs directory. |

Canonical replacement for `docs/operation.md:228` (the planner may format it to repository style without changing its meaning):

> An invalid or unreadable file is not applied. The API keeps the running configuration and logs a `warn` line, `config reload rejected: <path>: <message>` (the message never quotes a value), and counts `pulse_api_config_reload_total{result="invalid"}`. Polling and `SIGHUP` share the last warning: the same rejection message is not logged or counted again, even if the file's bytes change. A different warning message is logged and counted; a successful apply clears the last warning, so the same rejection can be logged and counted again afterward. `SIGHUP` forces a read and validation but does not clear the last warning. An unreadable file is read again at every look, so fixing its permissions applies it without a `SIGHUP`. Database check writes still work while the file is broken.

No README change is needed: this corrects inaccurate prose and removes internal unused paths without changing runtime behavior, settings, endpoints or public types; the README's existing statements remain true.

Nonblocking existing mismatch: `docs/troubleshooting.md:163` calls maintenance-window writes file writes, although `src/admin-routes.ts:228–229`, `docs/operation.md:215` and `docs/rest-api.md:473` establish database writes. This is pre-existing, does not contradict the corrected warning semantics, and is outside the requested cleanup. Do not silently describe that entire paragraph as true or expand this issue to fix it. No other document found promises that SIGHUP repeats a deduplicated rejection.

## Exact proposed API file scope

The comments describe a nine-file change but do not supply the old artifact's exact filenames. Resolve that missing detail with this concrete nine-file scope. Consolidate migrated file-read cases in the new production-reader suite; add warning characterization to the existing reload suite. The plan, task `Files:` list and their acceptance must agree on these exact paths:

```text
docs/operation.md
src/config-reload.ts
src/config.ts
src/config-write.ts
src/config.test.ts
src/config.maintenance.test.ts
src/config.examples.test.ts
src/config-reload.test.ts
src/config-reload.initial.test.ts
```

The new suite carries forward file-read, maintenance and example rejection checks; delete only those migrated cases from their old suites, keeping all pure parser tests and token tests. Do not replace fixed expected results with calls to the parser under test. No new production export solely for testing. No new dependency or config change. Protect every other tracked file, explicitly including all unchanged documents in the inventory, `AGENTS.md`, `src/admin-routes.ts`, `src/start.ts`, `src/main.ts`, `src/config-fs.ts`, `src/check-write.ts`, `src/check-store.ts`, `src/maintenance-write.ts`, `src/maintenance-store.ts`, `src/effective-checks.ts`, `src/effective-maintenance.ts`, `src/audit-log.ts`, contract pins, lockfile and tooling/CI files. Within allowed files, review that unrelated sections, live reload code and durable write steps remain unchanged.

## Derived acceptance and evidence required from plan/build

### 1. Structural and documentation regression checks

Run these exact searches from API root. In this review each ran three times against the recorded base: S1 16 matching lines, S2 2, S3 8, S4-old 1; every run exited 0. These are reproducible baseline-presence controls; the desired absence assertions fail on BASE because the obsolete paths and sentence are present.

```sh
# S1: declarations, imports, calls, test titles and stale comments
rg -n '\b(loadInitialConfig|loadConfig|loadChecks)\b' src
# S2: only config.ts helpers, not unrelated HTTP readers
rg -n '^function (readJson|parseFile)([<(])' src/config.ts
# S3: dead file check-edit surface, not live checkView/configView
rg -n 'keepSecret|referenceOf|kind === "check"|case "check"|check: "checks"|Exclude<ConfigKind, "maintenance">' src/config-write.ts
# S4-old: backticks are literal within these single quotes
rg -n -F 'The same bad file is not logged again at every look; fix it or send `SIGHUP` to log it again.' docs/operation.md
```

On the completed branch all four searches must find zero matching lines (rg exit 1, not an execution error). Also verify that `FileKind` admits only `"component"`; no disguised check-edit branch remains; `checkView`/`configView` and production parsing remain live. Check the corrected paragraph against the canonical text and runtime evidence. Rerun the full documentation search, read every relevant hit for contradictions about warning/invalid-counter repetition, and prove all eight unchanged inventory paths byte-identical to BASE. Restrict the operation document diff to the stated paragraph. The pre-existing troubleshooting maintenance mismatch is recorded above, not part of the new warning promise.

### 2. Production-entry-point tests and reload characterization

- Through `readInitialConfig(nodeConfigFs, path)`, preserve actual-file success with exact parsed check defaults, maintenance epoch values and configuration shape; malformed JSON; malformed JSON containing header/body sentinels with no leaked values; missing file with `ConfigError` and `unreadable`; and the checked-in example's placeholder-heartbeat-secret rejection. Keep pure validation and token/example assertions. Cover the success/rejection discriminants rather than recreating removed throwing loaders.
- Through `createConfigReloader`, use fake filesystem, clock, log, apply and metrics dependencies. An invalid poll followed by two `reloadNow()` calls leaves exactly one rejected log and one `invalid` count, unchanged revision/applied config and no apply call. Change bytes/stamp while preserving the safe rejection text: counts stay unchanged. A different rejection records another warning and invalid event. A valid apply clears warning memory; restoring the original rejection records it again. Cover repeated read failure plus forced reload without leaking content; retain existing retry and error-metric controls.
- These warning and reader cases characterize behavior already present on BASE; do not falsely claim they should fail there or change behavior to manufacture a red test. The documentation/removal structural regressions above supply the reliable failing-on-base assertions. Any additional test described as a new regression must fail reliably on BASE for its stated reason. Migrated runtime tests and new characterization controls must pass reliably there.
- New test files have no explanatory comments except at most the single line naming the class and expected outcome. Read every added line, including inline comments and modified existing files; list every added comment in the PR body. Write “none” only after that read.

### 3. Reliable controls and complete checks

Use Bun 1.4.0. API `package.json:8–16,20,23–28,35` records the engine/package manager, scripts, Biome version, shared-config pin and TypeScript alias. `biome.json:2` extends the shared config; `.github/workflows/ci.yml:17–18` pins its workflow. `bunfig.toml:1–4` enables coverage and the 80% line threshold. The planner must inspect and cite the pinned shared config for any inherited tooling claim, rather than infer it from another checkout's HEAD.

Every control called “passes on the recorded base” in the plan must actually run three times at that base, exit 0 and report its expected pass count. Earlier comments report three 191-pass focused runs with `bun test --config=/dev/null`, and three 900-pass full checks with 97.82% line coverage; those are historical reports, not results of this review. The planner must reconstruct the exact focused file list and verify it instead of copying a count without a command. Focused tests must use an empty config through `--config`, verified on BASE; default focused runs fail the repository-wide coverage threshold. Keep coverage enforced in full `bun run check`. Never make a known-flaky suite a mandatory passing baseline control.

Run `bun run check` on the final implementation, preserve required coverage and lint/type checks, and report results. Preserve database check-write, component-write validation, revision, secret/redaction, atomicity and crash/audit tests as appropriate controls. Do not weaken tooling or skip hooks.

### 4. Real-process local SIGHUP check

Run through `bun start` with its own temporary checks file, fresh database and tokens file containing a fresh `openssl rand -hex 32` value, never unchanged `tokens.example.json`. Placeholder/public example tokens are rejected (`src/tokens.ts:6–14,30–33`). Use valid non-secret check fixtures with ids `api` and `web`, no placeholder heartbeat check, `PORT=0`, and `PULSE_CHECKS_RELOAD_INTERVAL_MS=1000`; 500 is invalid (`src/start.ts:112–123`). Keep inherited settings from contaminating the run. Capture commands and sanitized results without token values.

Wait for the `listening` log and `/readyz` 200 before signals. Identify the actual service PID, not all Bun processes or only a wrapper, and deliver each SIGHUP separately with bounded waits. Registration is at `src/start.ts:433`, process signal wiring at `src/main.ts:39–44`.

| Step | Cumulative ok / invalid / error | Rejected warning count |
| --- | --- | --- |
| Ready with valid fixture | 0 / 0 / 0 | 0 |
| SIGHUP on unchanged valid fixture (delivery control) | 1 / 0 / 0 | 0 |
| Replace with invalid fixture, wait for polling rejection | 1 / 1 / 0 | 1 |
| First SIGHUP on same invalid fixture | 1 / 1 / 0 | 1 |
| Second SIGHUP on same invalid fixture | 1 / 1 / 0 | 1 |
| Restore valid fixture, wait for apply | 2 / 1 / 0 | 1 |
| SIGHUP on unchanged valid fixture (final delivery control) | 3 / 1 / 0 | 1 |

The effective check ids remain `api` and `web` throughout. Distinguish a metric series absent at zero from a nonzero counter. Check successful signal commands, functional before/after controls, readiness and exactly one safe rejected-warning line. Terminate the service normally, require exit 0 and clean up all child processes and temporary data. The procedure must agree with the corrected paragraph, not require a behavior change. Earlier comments report three successful BASE runs; final implementation still needs its own handoff run.

### 5. Scope gate, including commits, index and worktree

Every task acceptance records implementation BASE and the exact allowed list above. After the last implementation commit, require `git diff --name-only "$BASE" HEAD` to equal that list exactly; `git diff --name-only --cached` and `git diff --name-only` each empty; `git status --porcelain` empty; and `git diff --exit-code "$BASE" HEAD -- <protected files>` exit 0. The protected list must explicitly enumerate the eight unchanged inventory documents and the other protected paths, and the allow-list gate must reject any other path. A worktree-only diff or an intersection with allowed paths is insufficient.

Prove the gate with a disposable fixture, outside the target checkout, for clean allowed changes, a protected committed change, a protected staged change and a protected unstaged change, plus an untracked file. Include the restored-worktree trick twice: stage a protected change then restore only its worktree bytes to BASE; commit a protected change then restore only its worktree bytes to BASE. Both must still fail. Save expected exit/status evidence per state. Do not leave fixture edits or harness files in the target. Compare protected paths against the actual BASE, not just the preceding commit.

### 6. Performance and handoff

Report test CPU (user + system), command, revisions, counts and raw samples from interleaved base/branch/base/branch runs, with the same dependencies and runtime. The shared machine is noisy; the delta is information, not a fabricated performance guarantee or an extra pass gate. Do not run the Docker benchmark (port collision tracked in #834). Keep verification scripts/data outside the target and create/edit files with file tools, not shell redirection or heredocs.

## Remaining open points and execution limits

There is no unresolved product decision. The planner must refresh the base, validate the proposed test consolidation and exact nine-file list, reproduce any promised baseline controls, carry this entire documentation inventory into the task and specify executable scope fixtures. These are implementation/spec details, not reasons to hold.

This review ran source/document/caller searches and the structural baseline searches three times. It did not run Bun tests, install dependencies, execute the real-process SIGHUP procedure, measure CPU or execute scope-gate fixtures. Those checks are required in later states as described, and no fresh result is claimed for them. Initial reads of the absent #859 directory and a guessed `src/runtime.ts` path failed; the artifact is created here and the signal/metrics search was rerun against the real `main.ts`, `start.ts` and `metrics.ts` paths. The runtime skill was read; no environment-status tool is available in this session, which does not block local repository review.
