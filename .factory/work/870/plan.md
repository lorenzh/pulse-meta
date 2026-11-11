# Spec: deploy: mask cookies, form tokens and one-time codes in e2e failure logs (#870)

## Goal

Make the end-to-end failure diagnostics of pulse-deploy stop showing five kinds of short-lived credential that the console scenarios create:

1. session cookie values (every cookie in every browser jar, also rotated ones),
2. CSRF tokens,
3. form tokens,
4. TOTP codes that `e2e/totp.mjs` generates,
5. recovery codes.

Today `e2e/redact.sh` masks only the owner password, the owner TOTP setup key, the secret files and a few tokens. This limit was already on `main` before deploy #17 and #18. The reviews showed only that the masking leaves these values. They did not show that a service logs them. No service changes.

## Sources read

- Issue #870 and all its comments: two earlier plan and plan-review rounds, and the manager decisions added to the issue body (quoted JSON cookie keys, docs consistency).
- Issue review `.factory/work/870/issue-review.md` (this run). This spec settles each of its points. See "Decisions" and the mapping at the end of "Repository: deploy".
- The previous spec of this issue (closed meta PR #887, commit `c3cf064`). This spec keeps its design (registry, persistent invalidation, L5 to L8, W3). It changes the fallback shapes so that they also match quoted JSON cookie keys, adds an ownership rule for standalone `console-setup.sh`, and replaces the old totals (33 cases, 32 as root) with a new explicit case list.
- Shared findings: `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/870` answered `HTTP 404` in this run, so this feature has no findings yet. That is normal for a feature with no children.
- deploy clone at `f7210ec3e9905cf0c3eeaf9d86ad662008578ebf` (merge of deploy #18). Files read: `AGENTS.md`, `README.md`, `dev/README.md`, `docs/cli.md`, `package.json`, `biome.json`, `bunfig.toml`, `.github/workflows/ci.yml`, and in `e2e/`: `redact.sh`, `redact.test.sh`, `compose-e2e.sh`, `console-lib.sh`, `console-setup.sh`, `console-setup.test.sh`, `runtime-settings.sh`, `console-probes.sh`, `console-incidents.sh`.
- console clone `aa5dc18`. `src/cookies.ts:11-13` names the cookies `pulse_console_session`, `pulse_console_csrf` and `pulse_console_setup`. In `strict-https` mode they get the prefix `__Host-` (`:33`). `src/recovery-codes.ts:9-14`: there are ten codes, each 8 groups of 4 lower-case hex characters joined by `-`.
- config clone `bc87049`. deploy pins config at `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`. Four files were read at that pin with `gh api …?ref=04108fa…` and are byte-identical to the clone: `.github/workflows/check.yml`, `biome.json`, `package.json` and `bin/pulse-workflows.js`.
- api clone `515031b`: `bench/budgets.json` has entries for `api`, `config`, `contract`, `kit`, `notify`, `probe` and `status`, and none for deploy.

### Checks run by this spec (base `f7210ec`, a disposable `git clone` in `/tmp`, uid 1001)

- Baseline controls, each exit 0:
  - `bash e2e/redact.test.sh`: 5 cases;
  - `bash e2e/console-setup.test.sh`: 7 cases;
  - `bash e2e/runtime-settings.test.sh`: 58 cases;
  - `bash e2e/incident-card.test.sh`;
  - `bash e2e/snippet.test.sh`: 9 cases;
  - every other step of the CI `lint` job (`ci.yml:34-75`): shellcheck and `bash -n` over all `*.sh`, `node --check`, `jq empty`, outage-history (5), metric-is (3), manual-count (18), published-port (4), dev-console-prefills (3), subscriptions (48), `scripts/check-setup.sh`, check-setup.test (44), secrets-init.test (66, Docker), bump-images.test (17), wait-ready.test (1) and init-secrets.test (7);
  - `bun install --frozen-lockfile && bun run check`: 317 tests pass, 0 fail.
- The gap is real on the base. `redact` with an empty readable needles file printed `{"cookie": "…"}`, `{"set-cookie": "…"}` and `{"pulse_console_session": "…"}` unchanged.
- File size limit: in a child `bash` with `trap '' XFSZ; ulimit -f 0`, `(printf '%s\n' v >>"$reg") 2>/dev/null` returned 1, the registry stayed a readable regular file, and `: >"$reg.invalid"` still succeeded. Output of such a child must go to a pipe, because the limit also stops writes to files.
- Fallback shapes: a prototype of shapes S1 to S9 below ran on 43 lines under `mawk` and `gawk` with identical output. 28 credential lines were suppressed, including all JSON cookie forms. 15 ordinary lines stayed (see "Counterexamples").
- Tools on this machine: `mawk` and `gawk` (`awk` is gawk), `shellcheck`, Bun 1.4.0, Node v24.19.0, `jq`, Docker Compose v2.38.2.
- Test CPU of one base run (`/usr/bin/time`, user+sys): `redact.test.sh` 0.13 s, `console-setup.test.sh` 4.65 s. This is a single sample on a noisy machine, for scale only.

## Current behavior (deploy `f7210ec`)

- `e2e/redact.sh:6-23` `redact <needles file>` replaces each non-empty needle line with `[redacted]`, as a literal string. If the needles file cannot be read, it prints only `[redacted: no needles file]`. `redact_needles` (`:27-42`) writes:
  - the token arguments,
  - the `password` and `setup_key` of `owner.env`,
  - each secret file line.

  It writes nothing else. There is no field-based fallback.
- `e2e/compose-e2e.sh:80-120`: on a failure, `cleanup` prints `docker compose ps --all`, then `docker compose logs` through `redact` (`:83-92`). `trap cleanup EXIT` is at `:122`.
- Child output in `compose-e2e.sh`:
  - The probe step prints the captured child output with a plain `cat` on failure (`:1124-1127`) and on success (`:1129`).
  - The incidents step (`:1148-1159`) and the runtime step (`:1186-1199`) first scan the raw log for owner and token values, then `cat` it, on success and on failure.
  - None of these paths masks cookies, CSRF or form tokens, TOTP codes or recovery codes.
- `e2e/console-lib.sh`:
  - `fail` (`:10`) prints `FAIL: …` and exits 1. Inside `$(…)` it ends only that subshell.
  - `req` (`:14-21`) writes body, headers and jar to files that the next request overwrites.
  - `csrf` (`:23-28`) runs in command substitutions.
  - `form_token_args` (`:34-51`) sets `ftok`.
  - `totp_after` (`:79-92`) keeps only the last code.
- `e2e/console-setup.sh`:
  - It sources `console-lib.sh` (`:27-28`).
  - `trap 'rm -rf "$work"' EXIT` (`:31-32`).
  - It writes the recovery codes to `$work/recovery-codes` (`:133`, `:170-171`).
  - It uses the jars A to E and S, and ends with `exit 0` (`:290`) or at the end of the legacy flow.
- `e2e/runtime-settings.sh` sources `console-lib.sh` (`:17-18`). Its own `form_args` (`:105-140`) reads the `csrf` and `form_token` fields through `FORM_JS` (node). Its trap `cleanup_runtime` makes no `req` call; it uses only `admin`, `hook_control`, `notify_view` and `dc`.
- `console-probes.sh` and `console-incidents.sh` source `console-lib.sh` and use `req`, `csrf`, `form_token_args` and `totp_after`, with no parser of their own for these fields.
- `.github/workflows/ci.yml`, `dev` job (`:193-261`):
  - `bash e2e/console-setup.sh dev/compose.yaml` (`:237-239`);
  - on failure, "Stack state and logs" (`:240-245`) prints `docker compose -f dev/compose.yaml logs --no-color` unredacted;
  - "Teardown" (`:246-249`) runs under `if: always()`.

## Decisions

- **Registry.** A run keeps a registry file. Its path is in the exported variable `E2E_NEEDLES`. The file is mode 600 and sits in a mode 700 directory of the run owner. Helpers append each value as soon as they see it.
  - Appends to a file survive command substitutions, child `bash` processes, overwritten response files, removed jars and removed work directories. An array or variable cannot.
  - Values shorter than 6 characters are not recorded. A TOTP code has exactly 6, so it is recorded. Short values like `on` or `1` would mask ordinary text.
- **Ownership.** Only a run owner creates a registry. A helper or child never creates one and never removes one.
  - `compose-e2e.sh` always owns its own registry. It ignores an inherited `E2E_NEEDLES`, exports its own to its children (probes, incidents, runtime), and removes it at the very end of `cleanup`.
  - In CI, the `dev` job owns a registry in `$RUNNER_TEMP/e2e-needles`. It creates the registry before any service starts and passes it through step `env` to `console-setup.sh` and to the failure-log step. The registry survives until the "Teardown" step removes it under `if: always()`, after the failure-log step.
  - Standalone `console-setup.sh` with a non-empty `E2E_NEEDLES` uses that registry and does not remove it. With an empty or unset `E2E_NEEDLES`, it creates a private registry `$work/needles` (mode 600, `$work` is the mode 700 `mktemp -d`), exports it, and `setup_exit` removes it with `$work`. So recording and the failure check run the same way in every invocation.
  - The other scenarios (`console-probes.sh`, `console-incidents.sh`, `runtime-settings.sh`) only run as children. An empty `E2E_NEEDLES` there means "record nothing", exactly as on the base.
- **Collection points.** The shared helpers in `e2e/console-lib.sh` record, so `console-probes.sh` and `console-incidents.sh` need no change. Three more places record:
  - `form_args` in `runtime-settings.sh`;
  - `console-setup.sh`, for the password, the setup key and each recovery code;
  - nothing else. `console_owner_signed_in` gets its recovery page and TOTP codes through `req` and `totp_after`. Its password and key are in `owner.env`, which the existing needles already read.
- **Fallback.** `redact` also replaces every line that has a credential-bearing field (shapes S1 to S9 under "Required behavior") with the marker `[suppressed: credential line]`. The fallback catches values that no registry holds:
  - the one-time recovery page,
  - a value seen before the registry existed,
  - the standalone `console-setup.sh` path, whose private registry has no consumer.

  It matches header forms, unquoted assignments and quoted JSON keys (`"cookie": "…"`, `"set-cookie": "…"`, `"pulse_console_session": "…"`, and the `__Host-` and escaped-quote forms). It does not claim to find unknown secrets in unlabelled text.
- **Fail closed, persistently.** A registry is trusted only while it is valid. A collection failure makes it invalid for good, for every later process. Every diagnostic consumer then prints no log line.
  - **Valid** (`needles_valid`): `E2E_NEEDLES` is empty, or all of these hold:
    - the marker `"$E2E_NEEDLES.invalid"` does not exist;
    - `E2E_NEEDLES` is a regular file and not a symlink;
    - the file is readable and writable;
    - its directory is writable.
  - **Invalidation** (`needles_invalidate`): creates the empty marker (mode 600) and removes the registry, each best effort and silent. Either one alone makes the registry invalid. No helper ever creates a registry, so a removed registry stays removed.
  - **Who invalidates.** `needle_add` invalidates when an append fails. It refuses to append to an invalid registry. In both cases it returns 1.
  - **Failure status.**
    - A recording call that fails ends the scenario with `FAIL: needle registry: append failed`. The text names the rule only.
    - A failure inside `$(…)` can be swallowed by the caller. So both run owners check validity on exit: `compose-e2e.sh` `cleanup` and the new `setup_exit` of `console-setup.sh`. When the registry is invalid, each turns exit code 0 into 1 and prints `FAIL: needle registry: collection failed; diagnostics suppressed`.
    - `setup_exit` checks validity **before** it removes `$work`. Otherwise its own private registry would look missing.
  - **Suppressed diagnostics.** With an invalid registry, `redact_needles` removes its output file and returns 1. `cleanup`, `replay_redacted` and `e2e/failure-logs.sh` then print only `[redacted: no needles file]` in place of the logs. `failure-logs.sh` exits 1.
  - **Residual limit** (stated in the spec and README). Suppose an append fails, and the helper can neither remove the registry nor create the marker, while the registry and its directory still look writable to the consumer. Then the consumer cannot tell. This needs an unlink failure on a writable directory, and no scenario path produces it.
- **Replay of child output.** `compose-e2e.sh` prints a child's captured output through `replay_redacted` when the child failed *or* the registry is invalid. Otherwise it prints the output unchanged with `cat`, as today. The existing raw scans run first, unchanged. Masking before a scan would hide a violation.
- **Probe secrets.** The needles of `compose-e2e.sh` also take the lines of `$probe_work/secrets` when that file exists. So a failed probe step cannot show the probe secrets it just created.
- **Docs.** The changed docs are `README.md`, which owns the e2e test (deploy `AGENTS.md`, "Documentation"), and `dev/README.md`, which documents `console-setup.sh` (`dev/README.md:67`). `docs/cli.md` stays unchanged and protected:
  - it owns the CLI install, wizard and flags;
  - `grep -c -i 'e2e\|redact\|failure log' docs/cli.md` gives `0`;
  - its operator text at `:198` is about the console log in an install, which this change does not touch.

  The issue review requires exactly these two docs too. No `docs/operation.md` exists in deploy.

## Scope

deploy only. The scope is the e2e collection and diagnostic paths, their tests, `README.md`, `dev/README.md`, and the failure-log wiring of the CI `dev` job.

## Non-goals

- No change to a service or its logger, a cookie, an auth flow, an image pin, a Compose file, a package or the lockfile.
- No change to what a scenario requests, selects, checks or prints on success. The raw secret scans stay on the raw logs and get no new categories.
- The console setup code is not added to the needles. The scenarios read it from the raw log (`console-lib.sh:113-114`, `console-setup.sh:50-51`), and the operator text `docs/cli.md:198` stays true. Lines labelled `setup code:` are suppressed in diagnostics by shape S9.
- No change to the `minimal`, `full`, `demo`, `e2e-dev` or CLI jobs. `e2e-dev` and `full` run `compose-e2e.sh`, which handles its own diagnostics. The readiness-only "Stack state and logs" steps of `minimal`, `full` and `demo` run no console scenario.
- `e2e/subscriptions.sh` creates no console session and is unchanged. Its failure still reaches `cleanup`, so the container logs printed after it get the new filter.
- No search for arbitrary secrets in unlabelled text.

## Required behavior

1. **Registry functions** (`e2e/redact.sh`). The file still only defines functions. It defines no `fail`, because `compose-e2e.sh` and `console-lib.sh` define their own.
   - `needles_valid` returns 0 or 1 by the rule in "Decisions". It prints nothing.
   - `needles_invalidate` does nothing when `${E2E_NEEDLES:-}` is empty. Otherwise it runs `(umask 077; : >"$E2E_NEEDLES.invalid")` and `rm -f -- "$E2E_NEEDLES"`, both with stderr to `/dev/null`, and returns 0.
   - `needle_add <value...>`:
     - returns 0 at once when `${E2E_NEEDLES:-}` is empty;
     - otherwise returns 1 without writing when `needles_valid` fails;
     - otherwise appends each value of at least 6 characters as one line, with `(umask 077; printf '%s\n' "$v" >>"$E2E_NEEDLES") 2>/dev/null`;
     - on the first failed append, calls `needles_invalidate` and returns 1.

     It prints nothing on stdout or stderr.
2. **Recording** (`e2e/console-lib.sh`). The file also sources `e2e/redact.sh`, from the repository root, with a `# shellcheck source=e2e/redact.sh` line.
   - `needles_from_response` returns 0 at once when `${E2E_NEEDLES:-}` is empty. Otherwise it passes these values to `needle_add`:
     - every cookie value in `$jar`: field 7 of each tab-separated line with at least 7 fields that is not a comment, where `#HttpOnly_` lines count as cookie lines;
     - the value of each `Set-Cookie:` header in `$headers`, matched without regard to case, with CR removed, up to the first `;`, and also the part after the first `=` of that value;
     - every `value` of `name="csrf" value="…"` and `name="form_token" value="…"` in `$body`, from every form, also forms that the scenario does not pick;
     - every recovery-code-shaped string in `$body` (8 groups of 4 lower-case hex digits joined by `-`).

     A missing file is skipped without output. It returns 1 when `needle_add` returns 1.
   - Every recording point below ends with `|| fail "needle registry: append failed"`:
     - `req` keeps curl's exit code (`curl … || rc=$?`), then calls `needles_from_response`, then returns curl's code. Its stdout stays exactly curl's `%{http_code}`.
     - `csrf` and `form_token_args` record the value they select.
     - `totp_after` records every code that `e2e/totp.mjs` prints, also the codes it skips.
     - `form_args` in `runtime-settings.sh` records the values of the fields `csrf` and `form_token` that it puts into `fargs`.
     - `console-setup.sh` records `password` right after it creates it, `setup_key` after step 8 reads it, and each line of `$secrets_file` after step 8 writes it.
   - Recording changes no selected form, curl argument, HTTP check, token replay check or TOTP timing.
3. **Consumers in `e2e/redact.sh`.**
   - `redact_needles`:
     - first checks the registry. When `E2E_NEEDLES` is non-empty and `needles_valid` fails, it removes its output file and returns 1.
     - otherwise it writes what it writes today, plus every line of `$E2E_NEEDLES` when that variable is non-empty.
     - its output holds no empty and no duplicate line, and is ordered by length, longest first, so a needle that contains a shorter one is masked whole.
   - `redact` keeps literal masking and the unreadable-file behavior. It also replaces each line that matches a shape below with exactly `[suppressed: credential line]`. Lines that match no shape print after masking.
     - The test runs on a lower-cased copy of the original line.
     - Every regex is written without `{n}` interval expressions, so mawk and gawk agree.
     - The shapes use these awk string pieces: `q = "(\\\\?[\"\047])?"` (an optional quote, plain or backslash-escaped), `ws = "[ \t]*"`, `h4 =` four `[0-9a-f]`, `rc = h4` followed by seven `"-" h4`, and `d6 =` six `[0-9]`.
     - S1 cookie header, assignment or JSON key: `"(^|[^a-z0-9_-])" q "(set-)?cookies?" q ws "[:=]"`
     - S2 console cookie, also `__Host-` and JSON: `"pulse_console_(session|csrf|setup)" q ws "[:=]"`
     - S3 CSRF, form token or recovery field: `"(^|[^a-z0-9_])" q "(csrf|xsrf|csrf[-_]token|xsrf[-_]token|form_token|recovery_codes?|totp_code)" q ws "[:=]"`
     - S4 form markup: `"name" ws "=" ws q "(csrf|form_token|code|recovery_code)" q "([^a-z0-9_-]|$)"`
     - S5 TOTP code field: `"(^|[^a-z0-9_])" q "(code|totp)" q ws "[:=]" ws q d6 "([^0-9]|$)"`
     - S6 recovery list: `"id" ws "=" ws q "recovery-codes"`
     - S7 recovery-code shape: `"(^|[^0-9a-z])" rc "([^0-9a-z]|$)"`
     - S8 authorization header or key: `"(^|[^a-z0-9_-])" q "(proxy-)?authorization" q ws "[:=]"`
     - S9 setup code line or key: `"setup[ _-]?code" q ws "[:=]"`
4. **`e2e/compose-e2e.sh`.**
   - **Registry.** At the top it sets `e2e_needles_dir=""` and `export E2E_NEEDLES=""`, which overrides an inherited value. Right after `trap cleanup EXIT`, it creates `e2e_needles_dir=$(mktemp -d)` with mode 700 and the empty file `"$e2e_needles_dir/needles"` with mode 600. Only then does it set `E2E_NEEDLES` to that file.
   - **New functions**, each defined at the top level as `name() {` … `}`, so a test can extract it with `sed -n '/^name()/,/^}/p'`:
     - `collect_needles <out>` calls `redact_needles` with the arguments that `cleanup` uses today, plus the lines of `$probe_work/secrets` when that file exists, and returns its status;
     - `replay_redacted <log>` builds needles with `collect_needles` into a `mktemp` file, prints `<log>` through `redact`, and removes the file;
     - `print_child_log <log> <code>` calls `replay_redacted <log>` when `<code>` is not 0 or `needles_valid` fails. Otherwise it runs `cat <log>`.
   - **Child output.** The probe step uses `print_child_log "$probe_log" 1` on failure and `print_child_log "$probe_log" 0` on success. The incidents and runtime steps call `print_child_log` with their child exit code in place of `cat`. The raw `hits` scans, their order, their messages and the `fail` texts stay unchanged.
   - **`cleanup`.**
     - Right after `set +e`: when `code == 0` and `needles_valid` fails, it prints `FAIL: needle registry: collection failed; diagnostics suppressed` on stderr and sets `code=1`.
     - The failure block uses `collect_needles`. Its logs print only the marker when the registry is invalid.
     - As its last action before `exit "$code"`, it removes `$e2e_needles_dir` when that is set. This is after every other cleanup step, on success and on failure.
     - Teardown order and the exit code stay unchanged otherwise.
5. **`e2e/console-setup.sh`.**
   - `trap setup_exit EXIT`. `setup_exit()` is defined at the top level and does this, in order:
     1. keeps `code=$?`;
     2. computes validity with `needles_valid`;
     3. runs `rm -rf "$work"`;
     4. when `code == 0` and the registry was invalid, prints `FAIL: needle registry: collection failed; diagnostics suppressed` on stderr and exits 1;
     5. otherwise exits with `code`.
   - When `${E2E_NEEDLES:-}` is empty, right after the trap it creates `$work/needles` (mode 600) and exports `E2E_NEEDLES` with that path. A non-empty `E2E_NEEDLES` is used as given and never created or removed.
6. **New `e2e/failure-logs.sh <compose file>`.**
   - It runs from the repository root, uses `set -euo pipefail` and sources `e2e/redact.sh`.
   - It prints `docker compose -f <file> ps --all`. Then it prints `docker compose -f <file> logs --no-color 2>&1` through `redact`, with needles from `redact_needles "$needles" "" "$PWD/secrets"`. It removes the needles file.
   - Exit status:
     - a wrong argument count or a missing file: the usage line `usage: e2e/failure-logs.sh <compose file>` on stderr, exit 2;
     - an invalid registry: the `ps` output, `[redacted: no needles file]`, and the `FAIL: needle registry: collection failed; diagnostics suppressed` line on stderr, exit 1;
     - otherwise, also with an empty `E2E_NEEDLES`: exit 0. Without a registry only the secret files and the fallback apply.
7. **CI `dev` job** (`.github/workflows/ci.yml`, only between `  dev:` and `  e2e-dev:`):
   - a new `run` step right after the six checkouts, before `scripts/init-secrets.sh`, with `install -d -m 700 "$RUNNER_TEMP/e2e-needles"` and `install -m 600 /dev/null "$RUNNER_TEMP/e2e-needles/needles"`;
   - `env: E2E_NEEDLES: ${{ runner.temp }}/e2e-needles/needles` on "Console setup, sign-in and recreation" and on "Stack state and logs";
   - "Stack state and logs" keeps `if: failure()` and runs `bash e2e/failure-logs.sh dev/compose.yaml`, which replaces both of its current lines;
   - "Teardown" keeps `if: always()` and starts with `rm -rf "$RUNNER_TEMP/e2e-needles"`, followed by the existing `down` line.

   No other change: no action, pin, `persist-credentials`, checkout, gate or other job changes.

## Risks

- The `req` change could alter its stdout and break the status capture of every scenario. Mitigation: the exact-stdout checks of `console-setup.test.sh` and an exact `s == 200` check in K1.
- The fallback could hide lines needed to diagnose a failure. Mitigation: the shapes need a label followed by `:` or `=`. The visible-line counterexamples must stay visible.
- awk dialect: ubuntu runners can use mawk, where a `{4}` interval does not match and the fallback would silently fail open. Mitigation: no interval expressions, and a full test run under mawk and under gawk.
- Over-masking: a recorded 6-digit TOTP code also masks the same digits inside an unrelated number. That only costs readability. Values under 6 characters are not recorded.
- Registry growth: `req` records the same cookie and CSRF values on every request. Mitigation: `redact_needles` removes duplicates before `redact` runs.
- A swallowed recording failure inside `$(…)`. Mitigation: invalidation is on disk and permanent, and both run owners check it on exit (L5, L8).
- An invalid registry hides every log line of a failed run. This is the intended fail-closed trade. The `ps` output and the `FAIL` lines still name what failed, and a rerun gives the logs.
- A helper that recreates a removed registry would make it look valid again. Mitigation: `needle_add` checks `needles_valid` before each append. L5 proves that a later append in a new process fails and creates no file.
- A late `req` after registry removal would fail. Mitigation: `compose-e2e.sh` removes the registry as the last action of `cleanup`. No cleanup path calls `req`: `cleanup_runtime` and `console-probes.sh cleanup` make no `req` call.

## Performance impact

None of the metrics in `bench/budgets.json` (api clone `515031b`) can move. No service, image or runtime path changes, and the file has no deploy entry.
- `startup_cpu_ms`, `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`, `build_cpu_s`, `startup_wall_ms`, the `p95_*` keys, `rps` and `image_mb`: none expected, because no service code, build or image changes.
- Test CPU in deploy (the kind that `test_cpu_s` measures for other repositories; deploy has no budget):
  - `bash e2e/redact.test.sh` grows from 5 to 54 cases, each a few short shell, awk and stub processes. The base is about 0.13 s user+sys. The expected increase is a few seconds, below 5 s.
  - `bash e2e/console-setup.test.sh` gains about four short processes per stub request, from `needles_from_response`. The base is about 4.7 s. The expected increase is below 2 s.
  - `bun run test` (CLI) should not change, because no CLI file changes.
- **How to measure.** Run four interleaved samples (base, branch, base, branch) of the same suite in each revision: `redact.test.sh`, `console-setup.test.sh` and `runtime-settings.test.sh`. Use `/usr/bin/time -f '%U %S'`, which counts user+sys including children. For each command report:
  - all four samples, the base mean, the branch mean and the branch-minus-base delta;
  - the case counts on each side. `redact.test.sh` grows from 5 to 54 cases, so report it on its own line: its delta is the cost of the new regression cases, apart from the delta of the two unchanged-count suites.

  Wall time on this shared machine is not evidence. Do not run the Docker bench (host port collision, #834). No numeric threshold is defined, and no budget changes.

## Security impact

Security impact: yes
The change touches log texts that carry external data (container logs and child output), CI (`ci.yml`) and the writes of temporary credential files.

Checklist items that apply:
- **Secrets in errors, logs and responses.** This is the purpose of the change. Every new error line names a rule only, never a value or a path. Recording never prints. A failed collection suppresses every log line instead of trusting an incomplete registry. Docs and test names describe categories only, never a way to pull a credential from a log.
- **Atomic, path-safe writes.** The registry is mode 600 in a mode 700 `mktemp -d` directory or `$RUNNER_TEMP/e2e-needles`. Only the run owner creates it. Helpers only append, and they refuse a missing, symlinked, unwritable or invalidated registry. The marker is mode 600 in the same directory. All of it is removed after the last consumer. Nothing is written into the checkout.
- **Input validation.** Values parsed from response bodies and headers are only appended as literal lines and used as literal `index()` needles. They are never evaluated or used as a regex.
- **Dependency pins.** No new action or package. All `uses:` lines and `persist-credentials: false` lines in `ci.yml` stay as they are.

Not applicable: auth order and status codes, body and size limits, accessor execution, SSRF and redirects. No service or route changes.

## Rollout order

One repository (deploy). Only its e2e scripts, tests, docs and CI change. No consumer pins deploy, and no service reads these files.

## Counterexamples

- `req` with the registry set must print exactly `200` for a 200 answer. `200` followed by a newline or by a recorded value is wrong. A curl failure must still return curl's exit code. A wrong version returns the code of the recording step.
- A cookie that rotates between two requests, and a second jar: all four values (two jar values, two `Set-Cookie` values) must be masked after both jars are deleted. Keeping only the last jar is wrong.
- A CSRF value that only `csrf` saw (its body file was never fetched by `req`) must be masked. Recording only in `req` is wrong.
- The token of a decoy form that the scenario does not pick must be masked. Recording only the selected token is wrong.
- A form token that only `form_args` read must be masked.
- `totp_after` called twice, with one skipped code: all three codes must be masked. Recording only the final `totp_code` is wrong.
- The recovery-code page overwritten by the next `req`: all 10 codes must be in the registry. Relying on the fallback S7 alone is wrong, so K5 also checks the registry.
- Values recorded inside `$(csrf …)` or in a child `bash` must reach `cleanup`. A shell array fails this.
- A needle `abcdef123456` and a needle `abcdef` must mask `abcdef123456` as one `[redacted]`. `[redacted]123456` is wrong.
- A needle with awk and regex metacharacters (`a.b*c[d]\e&f|g`), twice on one line, must be masked both times.
- These lines, each with a value that no registry holds, must print as `[suppressed: credential line]`:
  - `console-1 | Set-Cookie: pulse_console_session=<s>; Path=/; HttpOnly`
  - `console-1 | Cookie: __Host-pulse_console_csrf=<s>`
  - `console-1 | cookie=<s>`
  - `console-1 | __Host-pulse_console_setup=<s> expired`
  - `{"cookie": "<s>"}`, `{"set-cookie": "<s>"}`, `{"pulse_console_session": "<s>"}`, `{"__Host-pulse_console_csrf":"<s>"}`, `{\"Cookie\":\"<s>\"}`, `{'Set-Cookie': '<s>'}`
  - `x | csrf=<s>&form_token=<s2>`, `<input type="hidden" name="form_token" value="<s>">`, `{"csrf": "<s>"}`, `X-CSRF-Token: <s>`
  - `x | code=135790`, `{"totp_code": "246802"}`
  - a recovery-code-shaped string alone on a line, `<ol id="recovery-codes"><li>…</li></ol>`, `{"recovery_code": "<s>"}`

  A filter that knows only the header form (`Cookie:`) fails the JSON lines.
- These ordinary lines must print unchanged:
  - `api-1 | plain line`
  - `notify-1 | exit code=1` (not 6 digits)
  - `api-1 | code=1234567` (7 digits)
  - `api-1 | request 3f2a9c1e-5b7d-4e2f-9a1b-0c3d5e7f9a1b` (UUID shape, not a recovery code)
  - `api-1 | sha 0123456789abcdef0123-4567-89ab-cdef-0123-4567-89ab-cdef` (hex run before the groups)
  - `console-1 | csrf check failed`, `console-1 | cookie consent banner`, `api-1 | cookie_policy: strict`, `api-1 | {"cookieless": true}`, `api-1 | session=abc ended`, `api-1 | recovery code used`, `api-1 | {"form":"x"}`, `api-1 | authorization failed for request`, `console-1 | setup completed`, `console-1 | setup code used`
- `E2E_NEEDLES` names a path that does not exist when the diagnostics are built: the output is only `[redacted: no needles file]` with no log line. Printing the raw logs is wrong.
- **Readable registry, failed append.** One value was recorded. Then an append fails while the registry stays a readable, writable regular file (a file size limit). Wrong: the scenario goes on, or a later consumer prints logs with only the first value masked. Right:
  - the recording call fails;
  - the registry is invalid for every later process;
  - every consumer prints only `[redacted: no needles file]`;
  - the run exits 1, even when its last step reported success.
- **No resurrection.** After invalidation removed the registry, a later `needle_add` in a new process with no limit must return 1 and create no file.
- **Marker alone.** The registry is a readable regular file with all values, but the marker exists. Consumers must suppress.
- **Read-only registry** (mode 400, no marker): `needles_valid` must fail.
- **Symlinked registry:** `needles_valid` must fail, and `needle_add` must not write through the link.
- **Private registry at exit.** `setup_exit` that removes `$work` before it checks validity would see its own registry as missing and fail a passing run. That is wrong.
- **Empty `E2E_NEEDLES`.** After an early failure before `owner.env` exists, the logs print with masking and the fallback, the exit code is kept, and nothing crashes. `failure-logs.sh` with an empty value exits 0. This differs from a supplied missing path, which exits 1.
- An inherited `E2E_NEEDLES=/some/other/file` is replaced by the run's own registry in `compose-e2e.sh`.
- A value of 5 characters (`abcde`) is not recorded. A value of 6 characters is.
- The registry, the marker and their directory must still exist while the failure block of `cleanup` prints, and be gone after `cleanup`: on success, on failure and after invalidation.
- A successful child with a valid registry: its output prints byte-identical, even with a labelled line in it. Filtering success output is wrong.

No statistic is defined. The performance figures are four raw samples per command, with arithmetic means and the difference of the means.

## Contract fields

These are new names. None is a contract or config name. The searches were run from the meta root on the clones, excluding `node_modules` and `.git`, as `grep -rn -e '<name>' .repos/contract/src .repos/config .repos/deploy`. Each count is 0:

| Name | Kind | Hits |
| --- | --- | --- |
| `E2E_NEEDLES` | env variable (deploy e2e and CI) | 0 |
| `needle_add` | shell function | 0 |
| `needles_from_response` | shell function | 0 |
| `needles_valid` | shell function | 0 |
| `needles_invalidate` | shell function | 0 |
| `collect_needles` | shell function | 0 |
| `replay_redacted` | shell function | 0 |
| `print_child_log` | shell function | 0 |
| `setup_exit` | shell function | 0 |
| `e2e_needles_dir` | shell variable | 0 |
| `<registry>.invalid` (search `needles\.invalid`) | marker file | 0 |
| `e2e/failure-logs.sh` (search `failure-logs`) | script | 0 |
| `e2e-needles` | CI temp directory | 0 |
| `[suppressed: credential line]` | marker text | 0 |
| `needle registry` | prefix of the new `FAIL` texts | 0 |

There are no new contract fields, keys or routes.

## Repository: deploy

Files:
- `e2e/redact.sh`
- `e2e/console-lib.sh`
- `e2e/console-setup.sh`
- `e2e/runtime-settings.sh`
- `e2e/compose-e2e.sh`
- `e2e/failure-logs.sh` (new)
- `e2e/redact.test.sh`
- `e2e/console-setup.test.sh`
- `.github/workflows/ci.yml` (only the `dev` job, see "Required behavior" item 7)
- `README.md`
- `dev/README.md`

Behavior change: yes
It changes what e2e failure diagnostics print, adds a fail-closed exit status when credential collection fails, and changes how CI prints the `dev` job's failure logs.

### Tool facts (cited)

- Bun `1.4.0`: `package.json:9` (`engines.bun`) and `:28` (`packageManager`). The pinned config check job uses `bun-version: 1.4.0` (config `.github/workflows/check.yml:24` at `04108fa`, identical to the clone).
- `bun run check` is `bun run lint && bun run typecheck && bun run test` (`package.json:18`).
  - `lint` is `biome check . && pulse-eslint . && pulse-workflows` (`package.json:14`).
  - `pulse-workflows` checks the `uses:` lines of `.github/workflows/*.yml` against the config action policy (config `bin/pulse-workflows.js`, 52 lines, identical at `04108fa`).
  - `test` is `bun test --coverage cli` (`package.json:13`), with `bunfig.toml:1-3` `[test]` coverage settings.
- Biome `2.6.3` (`package.json:21`). `biome.json` extends `@lorenzh/pulse-config/biome.json` (identical at `04108fa`). Its `files.includes` (`biome.json:3-26`) lists `cli/**` and the root config files, and leaves out `!.github`, `!*.md`, `!dev` and `!e2e`. So Biome checks no file of this change; shellcheck and the CI lint job do.
- CI `lint` job (`ci.yml:19-75`) runs over every tracked file of each type, so it also covers the new `e2e/failure-logs.sh`:
  - `shellcheck -x` and `bash -n` over `git ls-files '*.sh'` (`:34-37`);
  - `node --check` over `*.mjs` (`:38-39`) and `jq empty` over `*.json` (`:40-41`);
  - `bash e2e/console-setup.test.sh` (`:50-51`), `bash e2e/redact.test.sh` (`:58-59`), `bash e2e/runtime-settings.test.sh` (`:62-63`), and the other e2e and script tests (`:42-75`).
- CI `check` job: `uses: lorenzh/pulse-config/.github/workflows/check.yml@04108fa…` (`ci.yml:16-17`).
- CI `dev` job: `ci.yml:193-261`. Its steps are "Console setup, sign-in and recreation" (`:237-239`), "Stack state and logs" (`:240-245`) and "Teardown" (`:246-249`).
- Spec machine: `mawk` and `gawk` are installed, `awk` is gawk, shellcheck is installed, uid 1001. A test that needs a different awk puts a directory with an `awk` link first on `PATH`.

### Behavior

Implement "Required behavior" items 1 to 7 exactly.

Docs, in the same change:
- **`README.md:149`.** Replace the last two sentences of the "Console incidents and maintenance" paragraph ("On a failure the test prints the container logs through `e2e/redact.sh`: … `bash e2e/redact.test.sh` checks this with stub docker logs."). The new text must say that, on a failure, the test prints the container logs and any failed scenario output through `e2e/redact.sh`, and that these values read `[redacted]`:
  - the admin and service tokens,
  - the owner password and TOTP key,
  - each secret file,
  - the probe secrets,
  - every cookie, CSRF token, form token, TOTP code and recovery code that the console scenarios recorded in the run's private registry (`E2E_NEEDLES`).

  It must also say:
  - lines with a credential-bearing field (cookie, CSRF, form token, TOTP or recovery code, authorization, setup code) print as `[suppressed: credential line]`;
  - a missing or invalid registry prints only `[redacted: no needles file]`, with no log line;
  - when recording fails, the registry stays invalid for the rest of the run, and the run fails with a `needle registry` message even if every step passed;
  - the residual limit from "Decisions";
  - this covers e2e diagnostics only, not service logs.

  The paragraph keeps the sentence that `bash e2e/redact.test.sh` checks this with stub logs.
- **`README.md:168`**, the CI `dev` paragraph. Add that the job creates the registry before the stack starts, its failure step prints the stack state and logs with `bash e2e/failure-logs.sh dev/compose.yaml` with the same masking and fail-closed rule, and the teardown removes the registry.
- **`dev/README.md:67`.** Add two sentences:
  - with `E2E_NEEDLES` set to a mode 600 file in a mode 700 directory, `console-setup.sh` records the credentials it handles there and fails when it cannot; without it, the script uses a private registry that it removes on exit;
  - `bash e2e/failure-logs.sh dev/compose.yaml`, with the same `E2E_NEEDLES`, prints the stack state and logs with those values masked, or no log line when the registry is invalid.
- No doc text quotes a sentinel or shows how to find a credential in a log.

### Tests

**`e2e/redact.test.sh`** runs every case even after a failure.
- Each case prints `ok: <id> <name>`, `FAIL: <id> <name>: <reason>` or, for L7 as root only, `skip: L7 read-only registry (root ignores file modes)`.
- The file ends with `redact.test: <n> cases passed` and exit 0, or with `redact.test: <f> of <n> cases failed` and exit 1.
- Every sentinel is a synthetic literal in the test file. Expected values are literals in the test, never read back from the code under test.
- The test extracts functions from the scripts with `sed -n '/^name()/,/^}/p'`: `cleanup`, `collect_needles`, `replay_redacted` and `print_child_log` from `compose-e2e.sh`, and `setup_exit` from `console-setup.sh`. A function that does not exist yields an empty `eval`, so the leak cases still run on the base.
- Stdout and stderr are checked together (`2>&1`). FAIL lines are also checked on stderr alone.

The cases (54 in total, 53 when root skips L7):

- **E1–E5** (5, kept). The existing cases keep their sentinels and assertions: owner password, owner TOTP key, admin token, svc token, secret file.
- **K1–K5** (5, the regression, one per category).
  - Setup of each case:
    - a fresh registry (`$tmp/reg` mode 700, `needles` mode 600) exported as `E2E_NEEDLES`;
    - values recorded only through the real helpers, in a child `bash` run from the repository root that sources `e2e/console-lib.sh` (or `e2e/runtime-settings.sh` with `RUNTIME_SETTINGS_LIB=1`), with stub `curl` and `node` on `PATH` that write literal fixture responses;
    - afterwards the test deletes the jars, body and header files, and `owner_dir` is empty;
    - stub logs hold each category sentinel in unlabelled text (`console-1 | refused: <v> here`) next to `api-1 | plain line`;
    - `cleanup` of `compose-e2e.sh` runs with exit 1, as in the existing cases.
  - Each case checks, in this order:
    1. no sentinel of its category is in the output: `FAIL: … cleanup printed the credential`;
    2. `plain line` is in the output;
    3. every category sentinel, from the test's literal list, is a line of the registry: `FAIL: … not recorded`.
  - The cases:
    - K1, session cookie. Two jars and two `req` calls. Each response writes a Netscape jar line (one with `#HttpOnly_`) and a different `Set-Cookie` value. That makes four cookie sentinels. `s=$(req GET /)` must give exactly `200`.
    - K2, CSRF. One CSRF value arrives through `req`. A second one is in a body file that the test writes directly and reads with `$(csrf …)`.
    - K3, form token. One `req` body has the selected form with token T1 and a decoy form with token T2; `form_token_args` selects T1. Then one `form_args` call (real `node`, `FORM_JS`) reads token T3 from a file that no `req` fetched.
    - K4, TOTP code. A stub `node e2e/totp.mjs` prints `1 135790`, then `1 246802`, then `2 975310`. `totp_after s 0` and then `totp_after s 1` (one 1 s wait). All three codes are sentinels.
    - K5, recovery codes. One `req` returns a `<ol id="recovery-codes">` page with 10 synthetic codes of the recovery-code shape, and a second `req` overwrites the body. The logs hold codes 1 and 10. The registry check covers all 10 codes.
- **R1** (1). After K1–K5: the registry is mode 600, and the helper calls printed nothing beyond the expected status. A 5-character value passed to `needle_add` is not recorded; a 6-character value is.
- **F1–F13** (13, header and unquoted forms, values not in the registry). Each case:
  - first asserts that the sentinel is not a line of the valid registry;
  - runs `cleanup` with exit 1 on one counterexample line plus `api-1 | plain line`;
  - checks that the output contains `[suppressed: credential line]`, does not contain the sentinel, and still contains `plain line`.

  The lines:
  - F1 `Set-Cookie:` header
  - F2 `Cookie: __Host-pulse_console_csrf=`
  - F3 `cookie=`
  - F4 `__Host-pulse_console_setup=`
  - F5 `csrf=…&form_token=…`
  - F6 `<input … name="form_token" value="…">`
  - F7 `{"csrf": …}`
  - F8 `X-CSRF-Token:`
  - F9 `code=135790`
  - F10 `{"totp_code": "246802"}`
  - F11 a recovery code alone on a line
  - F12 the `<ol id="recovery-codes">` line
  - F13 `{"recovery_code": …}`
- **J1–J6** (6, quoted JSON cookie keys, unregistered, as the manager requires). Same method as F:
  - J1 `{"cookie": "<s>"}`
  - J2 `{"set-cookie": "<s>"}`
  - J3 `{"pulse_console_session": "<s>"}`
  - J4 `{"__Host-pulse_console_csrf":"<s>"}`
  - J5 `{\"Cookie\":\"<s>\"}`
  - J6 `{'Set-Cookie': '<s>'}`
- **V1** (1). All 15 ordinary lines from "Counterexamples" print unchanged.
- **M1** (1). A needle with metacharacters (`a.b*c[d]\e&f|g`), given as the admin token, twice on one unlabelled line: both are masked and the rest of the line stays.
- **O1** (1). Needles `abcdef123456` and `abcdef`, both in the registry with the short one first: the line prints `[redacted]`, never `123456`.
- **C1–C4** (4, controls).
  - C1: `Authorization: Bearer <admin-token sentinel>`. The sentinel is absent and `plain line` stays.
  - C2: an SMTP password file in the secrets directory is masked.
  - C3: the status and notify token files in `runtime_work` are masked.
  - C4: a probe secret in `$probe_work/secrets` is masked.
- **L1–L9** (9, lifecycle).
  - L1, empty `E2E_NEEDLES` and no `owner_dir`: the logs print, a labelled line is suppressed, and the exit code is 1.
  - L2, supplied missing file: the output holds `[redacted: no needles file]` and neither `plain line` nor a sentinel.
  - L3, no premature removal and eventual removal. The stub `docker logs` prints `registry-present` only when the registry file exists at that moment. Under `cleanup` with exit 1 that line is visible. After `cleanup` with exit 1, and again with exit 0, `e2e_needles_dir` no longer exists.
  - L4, a needles path that does not exist, passed directly to `redact`: only `[redacted: no needles file]` (existing behavior). It uses a missing path, not file modes, so it holds as root too.
  - L5, readable registry, failed append (the plan-review regression). A fresh valid registry, then:
    1. a child `bash` records sentinel A through `csrf` (succeeds);
    2. a second child `bash` runs `trap '' XFSZ; ulimit -f 0`, then `csrf` on a body with sentinel B, with stdout and stderr to a pipe;
    3. a third child `bash` without a limit calls `needle_add` with sentinel C;
    4. `cleanup` runs with incoming exit 0 (`( exit 0 ) && cleanup`), with stub logs that hold A, B and C in unlabelled text and `plain line`, and with `e2e_needles_dir` set to the registry directory.

    Expected, all literals:
    - step 2 exits 1, and its output contains `FAIL: needle registry: append failed` and not B;
    - step 3 returns 1; afterwards the registry path does not exist and the marker exists;
    - `needles_valid` fails in a fourth child `bash`;
    - step 4 exits 1. Its output contains `FAIL: needle registry: collection failed; diagnostics suppressed` and `[redacted: no needles file]`, and none of `plain line`, A, B or C;
    - after step 4 the registry directory does not exist.
  - L6, marker alone. The registry is a readable regular file with sentinel D, and the marker exists.
    - `cleanup` with incoming 0 exits 1 and prints neither D nor `plain line`.
    - `replay_redacted` on a child log with D prints only `[redacted: no needles file]`.
  - L7, read-only registry (mode 400, no marker): `needles_valid` fails and `needle_add` returns 1. When `id -u` is 0, the case prints the skip line and is not counted.
  - L8, `setup_exit`:
    - supplied valid registry, incoming 0: exit 0, `$work` removed, registry kept;
    - private registry inside `$work`, incoming 0: exit 0 and `$work` removed. This is the check-before-remove counterexample;
    - invalidated registry, incoming 0: exit 1, the `collection failed` line on stderr, `$work` removed;
    - incoming 1: exit 1.
  - L9, symlinked registry. `E2E_NEEDLES` is a symlink to a mode 600 file: `needles_valid` fails, `needle_add` returns 1, and the link target is unchanged.
- **P1–P3** (3, `print_child_log`).
  - P1: code 1 and a valid registry. A recorded sentinel is masked, a labelled line is suppressed, and `plain line` stays.
  - P2: code 0 and a valid registry. The output is byte-identical to the log (`cmp`), which holds a labelled line and a registry value.
  - P3: code 0 and an invalid registry. The output is only `[redacted: no needles file]`.
- **W1–W5** (5, `bash e2e/failure-logs.sh <compose file>` with stub `docker`).
  - W1, registry with a sentinel. The stub logs also hold J1–J3 lines with unregistered values. The output holds the stub `ps` line and `plain line`, no sentinel, and three `[suppressed: credential line]`. Exit 0.
  - W2, supplied missing registry: the `ps` line and `[redacted: no needles file]`, no `plain line`. Exit 1.
  - W3, registry invalidated by a failed append as in L5 step 2: the `ps` line, `[redacted: no needles file]` and the `needle registry` FAIL line on stderr, no sentinel and no `plain line`. Exit 1.
  - W4: no argument, or a missing compose file, gives exit 2 and the usage line on stderr.
  - W5, empty `E2E_NEEDLES`: a secret-file sentinel is masked, a J1 line is suppressed, and `plain line` stays. Exit 0.

**`e2e/console-setup.test.sh`** keeps exactly its seven cases A–G, their names, their expected stdout literals and the F failure check. It adds no case and still ends with `console-setup.test: 7 cases passed`.
- The stub `curl` also appends every `csrf` value that it embeds in a page (in `form()`) to `$st/csrf-issued`.
- Cases A, B, C, E and G run with `E2E_NEEDLES` set to a fresh mode 600 file in a mode 700 directory. After each of them:
  - the registry file still exists (the child did not remove it), is mode 600, and has no marker;
  - it holds every line of `$st/csrf-issued`, every token in field 1 of `$st/tokens`, the content of `$st/password`, and in the two-factor cases also every line of `$st/totp-issued`, all 10 values of `FAKE_RECOVERY` and `FAKE_SETUP_KEY`.

  These expected values come from the stub's own state files and fixtures, never from the registry.
- Cases D and F run without `E2E_NEEDLES` and with `TMPDIR` set to a fresh empty `$st/tmp`. After the run, `$st/tmp` is empty. That shows the private registry and `$work` are removed, also on F's failure path.
- The existing secret scan of stdout and stderr stays.

### Acceptance (deploy)

Record the base with `BASE=$(git rev-parse HEAD)` before the first change, as a full SHA, and put it in the PR. Expected values come from literals in this spec or the test files, never from the file under test. If `BASE` is not `f7210ec3e9905cf0c3eeaf9d86ad662008578ebf`, run items 1 and 3 again on the new base. Do not reuse this spec's results for it.

1. **Red on base.** In a disposable clone at `$BASE`, copy only the new `e2e/redact.test.sh` over the base copy and run `bash e2e/redact.test.sh`. Expected:
   - the 24 cases K1–K5, F1–F13 and J1–J6 each print `FAIL:` with a leak reason. K1–K5 print `cleanup printed the credential`. F and J print that the sentinel is in the output. A syntax error or a missing helper is not a leak reason. Each of the five categories therefore fails at least once, and J1–J3 fail because the base prints the JSON cookie value;
   - the 11 cases E1–E5, V1, M1, C1–C3 and L4 print `ok:`;
   - the other cases may fail because their interface is missing. They are not part of the red proof;
   - the run exits 1 and prints `redact.test: <f> of 54 cases failed` with `f >= 24`.

   Record the exact output summary.
2. **Green on branch.** `bash e2e/redact.test.sh` on HEAD prints `ok:` for every case and `redact.test: 54 cases passed`, and exits 0. As root it prints the L7 skip line and `redact.test: 53 cases passed`.
3. **Baseline controls, run on `$BASE` and on HEAD.** Each must pass on both. The counts are literals from this spec's base run:
   - `bash e2e/console-setup.test.sh`: `console-setup.test: 7 cases passed`;
   - `bash e2e/runtime-settings.test.sh`: `runtime-settings.test: 58 cases passed`;
   - `bash e2e/incident-card.test.sh` (`ok: incident-card`) and `bash e2e/snippet.test.sh` (`snippet.test: 9 cases passed`);
   - the base `bash e2e/redact.test.sh`: `redact.test: 5 cases passed` (on HEAD, item 2 replaces it);
   - `bun install --frozen-lockfile && bun run check`: exit 0, with `317 pass` and `0 fail` on the base and `0 fail` on HEAD;
   - every other step of the CI `lint` job (`ci.yml:34-75`), with the counts from "Checks run by this spec".

   A control that cannot run is recorded with its missing prerequisite on both sides and is not called green.
4. **Branch checks on HEAD:**
   - `git ls-files -z '*.sh' | xargs -0 shellcheck -x` and `git ls-files -z '*.sh' | xargs -0 -n 1 bash -n` from the repository root, after `git add -N e2e/failure-logs.sh` or after the commit, so the new script is linted;
   - `shellcheck -x e2e/failure-logs.sh` and `bash -n e2e/failure-logs.sh` also before it is tracked;
   - `git ls-files -z '*.mjs' | xargs -0 -n 1 node --check` and `git ls-files -z '*.json' | xargs -0 -n 1 jq empty`;
   - the stdout of `bash e2e/console-setup.test.sh` and `bash e2e/runtime-settings.test.sh` is the same as on the base, apart from timing.
5. **awk dialects.** Run `bash e2e/redact.test.sh` twice more: once with a `PATH` whose first directory has `awk` linked to `mawk`, once to `gawk`. Both give `redact.test: 54 cases passed`. If one is not installed, state that and do not claim it.
6. **CI wiring**, checked against `$BASE` and literals. `dev_job` stands for `sed -n '/^  dev:$/,/^  e2e-dev:$/p' .github/workflows/ci.yml`.
   - `diff <(git show "$BASE":.github/workflows/ci.yml | sed '/^  dev:$/,/^  e2e-dev:$/d') <(sed '/^  dev:$/,/^  e2e-dev:$/d' .github/workflows/ci.yml)` is empty.
   - `grep -c 'uses:'` and `grep -c 'persist-credentials: false'` give the same counts on the base file and on HEAD.
   - In `dev_job`:
     - `E2E_NEEDLES: ${{ runner.temp }}/e2e-needles/needles` occurs exactly 2 times;
     - `bash e2e/failure-logs.sh dev/compose.yaml` occurs exactly 1 time, in the step "Stack state and logs" with `if: failure()`;
     - `docker compose -f dev/compose.yaml logs --no-color` occurs 0 times;
     - the line numbers within `dev_job` are strictly ascending in this order: `install -d -m 700 "$RUNNER_TEMP/e2e-needles"` < `run: scripts/init-secrets.sh` < `bash e2e/console-setup.sh dev/compose.yaml` < `bash e2e/failure-logs.sh dev/compose.yaml` < `rm -rf "$RUNNER_TEMP/e2e-needles"` < `docker compose -f dev/compose.yaml down -v --remove-orphans`;
     - the `rm -rf` line is in the step "Teardown" with `if: always()`.
   - `bun run check` (item 3) passes, which includes `pulse-workflows`.
7. **Live stack.** Run `E2E_SETUP=dev bash e2e/compose-e2e.sh` and the CI `dev` steps locally only when their prerequisites exist: the sibling checkouts and free host ports. Otherwise name the missing prerequisite. The PR's CI `dev` and `e2e-dev` jobs must pass. Unit tests do not prove the live scenarios. Do not run the Docker bench (#834).
8. **Performance.** Report the four interleaved CPU samples (base, branch, base, branch) as described in "Performance impact".
9. **Docs.**
   - `git diff --name-only "$BASE" HEAD -- README.md dev/README.md` lists both files.
   - `grep -c 'suppressed: credential line' README.md` is at least 1.
   - `grep -c 'e2e/failure-logs.sh' README.md dev/README.md` is at least 1 in each file.
   - `grep -c 'E2E_NEEDLES' dev/README.md` is at least 1.
   - `git diff --exit-code "$BASE" HEAD -- docs/cli.md` exits 0.
   - Read the changed text against "Required behavior". It must not overstate the residual limit or the fallback.
10. **Public text.** `git diff "$BASE" HEAD` adds no value except synthetic sentinels, and only in `e2e/*.test.sh`. Docs and the PR body name categories only.
11. **Scope**, after the last commit. Each check passes on its own.
    - `git diff --name-only "$BASE" HEAD | sort` equals exactly:
      ```
      .github/workflows/ci.yml
      README.md
      dev/README.md
      e2e/compose-e2e.sh
      e2e/console-lib.sh
      e2e/console-setup.sh
      e2e/console-setup.test.sh
      e2e/failure-logs.sh
      e2e/redact.sh
      e2e/redact.test.sh
      e2e/runtime-settings.sh
      ```
    - `git diff --name-only --cached` is empty, `git diff --name-only` is empty, and `git status --porcelain` is empty.
    - Protected files, explicit list (the tracked complement of the allowed list at `f7210ec`):
      `git diff --exit-code "$BASE" HEAD -- .github/workflows/release.yml .gitignore AGENTS.md CLAUDE.md LICENSE biome.json bun.lock bunfig.toml cli common demo dev/.env.example dev/compose.yaml docs eslint.config.js full lefthook.yml minimal package.json scripts tsconfig.json e2e/compose.e2e.yaml e2e/compose.runtime.yaml e2e/compose.subscriptions.yaml e2e/console-incidents.sh e2e/console-probes.sh e2e/dev-console-prefills.test.sh e2e/hook.mjs e2e/incident-card.mjs e2e/incident-card.test.sh e2e/manual-count.test.sh e2e/metric-is.test.sh e2e/notify.json e2e/outage-history.sh e2e/outage-history.test.sh e2e/published-port.test.sh e2e/ro e2e/runtime-settings.test.sh e2e/snippet.mjs e2e/snippet.test.sh e2e/subscriptions.sh e2e/subscriptions.test.sh e2e/target.mjs e2e/totp.mjs` exits 0.
    - Complement from the base tree, which also catches a file that is tracked on a newer base: `git ls-tree -r --name-only "$BASE" | grep -vxF -f <(printf '%s\n' <the 11 allowed paths>) | xargs git diff --exit-code "$BASE" HEAD --` exits 0.
    - Prove the checker on a disposable Git fixture outside the checkout, with these exact lists, then remove the fixture. The fixture covers:
      - passing: a clean control, and an allowed committed change;
      - failing: an uncommitted allowed change;
      - failing: an unstaged protected change, a staged protected change, and a committed protected change with a clean index and worktree;
      - failing, the restored-worktree trick: a staged protected change, and separately a committed one, each followed by restoring only the worktree copy to the base (`git restore --worktree --source "$BASE" -- <file>`). In both, the base-to-worktree diff is empty, while the index, commit and allowlist checks still catch the change.

### Issue review mapping

| Issue review point | Where this spec settles it |
| --- | --- |
| 1 collection and lifetime | Decisions "Registry", "Ownership", "Collection points"; Required behavior 1, 2, 4, 5, 7; K1–K5, L3, L8 |
| 2 fallback incl. quoted JSON cookie keys | Required behavior 3 (S1–S9); F1–F13, J1–J6, V1, W1, W5 |
| 3 persistent failure | Decisions "Fail closed"; Required behavior 1, 3–6; L2, L5–L9, P3, W2, W3 |
| 4 consumers and scope | Required behavior 4, 6, 7; P1–P3, W1–W5; acceptance 6 |
| 5 docs consistency | Decisions "Docs"; Files; acceptance 9 and 11 (`docs/cli.md` protected) |
| Derived acceptance 1–12 | acceptance 1–11, "Performance impact", tests above |
