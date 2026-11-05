# Spec #726: deploy console-setup.sh sends each POST the form token of its own form

## Goal
In the two-factor flow, `e2e/console-setup.sh` in pulse-deploy sends the wrong single-use `form_token` at step 11. It reads the token from `GET /account/sessions`, where the only form posts to `/sign-out`, and then posts that token to `/account/sessions/sign-out-all`. The console of pulse-console#9 binds every token to its path, so it answers 409 and the `deploy-dev` job of that pull request fails ([#722 review evidence](https://github.com/lorenzh/pulse-meta/issues/722#issuecomment-6647303096)). The fix: step 11 gets the confirmation page `GET /account/sessions/sign-out-all` and posts the token of the form on that page. In general, every POST of the script sends the `form_token` of the form whose `action` is exactly the path of that POST, or no token at all. A stubbed regression test proves this and fails on the current script.

Sources: issue #726, the issue review `.factory/work/726/issue-review.md`, deploy `main` at `0157775f8046dbfd18f14d153322adfa6a44ca30` (the clone), console `main` at `875e35996ba0a8a0ab0b57bd61f7a13d07b2deda` (the clone) and console PR #9 head `c071619939691f046cfaaba08e58d2d80887419b` (read through `gh api`). No shared findings exist: `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/726` answered HTTP 404.

## Scope
- Only pulse-deploy: `e2e/console-setup.sh`, a new stubbed test `e2e/console-setup.test.sh`, its CI step in the `lint` job, and the docs rows for the new test command.
- This builds on two features that are already in deploy `main`, and does not redo them:
  - The two-factor flow of the script (#563, deploy child #721, merged as deploy PR #10, the clone's HEAD `0157775`).
  - The optional form tokens and the step 8b replay check (deploy PR #11, merged): a page without `form_token` gets no token, and 8b is skipped then.

## Non-goals
- No change to pulse-console: not its pages, its token validation or its CI. Tokens stay single-use and bound to the path.
- No change to other targets, to image pins (`common/services.yaml`), to the Compose setups or to the CLI.
- No change to the `ok:` lines of steps 1 to 10 in either flow, nor to the existing step 11 to 13 lines.
- No general HTML parser, no new runtime or package. The script keeps using bash, sed/awk/grep/tr, curl, jq and node.
- CSRF stays page-level. Every console form carries the same per-session or per-cookie `csrf` value (PR #9 `src/account-pages.ts`: `csrfField(view.csrf)` in every form, lines 27, 35, 43, 66, 97, 131, 212, 225). The existing `csrf()` helper stays as it is.

## Current behavior (verified)
- `e2e/console-setup.sh:65-73` `form_token_args` takes no argument. It runs `sed -n 's/.*name="form_token" value="\([^"]*\)".*/\1/p' "$body" | head -n 1`. That is the first line that holds a token. When several tokens share one line, the greedy leading `.*` takes the last one on that line. The form the token belongs to plays no part.
- Step 11 (`e2e/console-setup.sh:289-299`): jar A, `GET /account/sessions` (200, `This browser`), `csrf`, `form_token_args`, then `POST /account/sessions/sign-out-all`. In PR #9 the sessions page holds only one form, `action="/sign-out"` with `signOutToken` (`src/account-pages.ts:189-216`, form at line 211). It links to `GET /account/sessions/sign-out-all` (line 210). That route renders `signOutAllPage` (`src/account-routes.ts:350-353`), whose only form posts to `/account/sessions/sign-out-all` with `formToken` (`src/account-pages.ts:220-229`). `postSignOutAll` checks that token with `acceptSessionForm` (`src/account-routes.ts:359-372`). The script never fetches that page.
- Other PR #9 pages with more than one form: the factor page has two `/sign-in/factor` forms with the same token, then a `/sign-out` form with `signOutToken` (`src/account-pages.ts:23-47`). The authenticator page has the `/account/authenticator` form first and a `/sign-out` form last (`src/account-pages.ts:126-136`). Console `main` puts a `/sign-out` form into the header of every signed-in shell page (`src/shell.ts:49-53`). Today the target form comes first on every page the script posts from, except the sessions page. That is why only step 11 fails.
- Step 7 (both flows, `e2e/console-setup.sh:216-223` and `371-378`): `GET /sign-in`, then `POST /setup` with the sign-in page's csrf and `form_token`. This is a deliberate negative check: setup is closed, and console answers 404 before it reads any form token (PR #9 `src/server.ts:453-460`: `gate === undefined` → 404, before `acceptFormToken` at line 485; `form_token` is an optional field of `CODE_FIELDS`, line 129). The sign-in page has no `/setup` form, so after the fix this POST sends no `form_token`.
- Step 8b (legacy, `e2e/console-setup.sh:388-396`) sends the cached `sign_in_args` again to `/sign-in`. This is an intended replay on the same path. It runs only when `ftok` is not empty after the last `sign_in`.
- The issue speaks of "the stubbed harness the repo already has for the e2e script". At deploy `0157775` there is none for `console-setup.sh`: `grep -rn 'console-setup.test' .repos/deploy` finds nothing. The repository has the stub patterns this test follows: `e2e/published-port.test.sh` (a shell-function stub and `eval` of one helper) and `scripts/wait-ready.test.sh` (a stub `docker` on `PATH` in a `mktemp -d` bin directory). The new test therefore creates the harness.

## Required behavior
1. **Form-scoped token.** `form_token_args <path>` (same name, one new required argument) sets the array `ftok` from the last body:
   - It resets `ftok=()` first, on every call. A token from an earlier page never survives.
   - It finds the first `<form ...>` element whose `action` attribute equals `<path>` exactly. `action="/account/sessions"` does not match `/account/sessions/sign-out-all`, and `action="/sign-in/factor/x"` does not match `/sign-in/factor`. The path is matched as a fixed string, not as a regular expression.
   - It takes the `form_token` value only between that form's opening tag and its `</form>`. It works with newline-separated markup (as the console renders it) and with several forms on one line.
   - If no form matches, or the matching form has no `form_token` field, `ftok` stays empty. This holds even when another form on the page has a token. There is no fallback to any other token on the page.
   - It prints nothing and never puts a token into an error line.
2. **Every call site names its path.** Steps 2 and 3 → `/setup`; step 5 and 5 result → `/setup/owner`; `sign_in` → `/sign-in`; `password_step` → `/sign-in/factor`; step 8 (both calls) → `/account/authenticator`; step 11 → `/account/sessions/sign-out-all`. Every POST sends the `ftok` that was selected for its own path from the page just before it, as today.
3. **Step 7 sends no form token.** In both flows the `POST /setup` after `GET /sign-in` keeps the sign-in page's csrf and the 404 expectation, and sends no `form_token` field. This happens either because `form_token_args /setup` finds no `/setup` form on the sign-in page, or because `ftok=()` is set explicitly. Its `ok:` line stays `7 POST /setup reused code 404`.
4. **Step 11 sequence (two-factor).** In jar A: `GET /account/sessions` → 200 with `This browser` (kept as is). Then `GET /account/sessions/sign-out-all` → 200, with the failure text `step 11 GET /account/sessions/sign-out-all`. From that body: `csrf "step 11"` and `form_token_args /account/sessions/sign-out-all`. Then `POST /account/sessions/sign-out-all` with that csrf and `ftok` → 303, Location `/account/sessions?signed-out=others`. The rest of step 11 is unchanged: jars B and C `GET /` → 303 `/sign-in?next=%2F`, jar A `GET /` → 200 `Signed in as`. The new GET adds no `ok:` line.
5. **PR #11 rule kept.** A console without form tokens gets no `form_token` field in any POST, and the script runs as before. Step 8b runs only when the `/sign-in` form of the last `sign_in` had a token. Otherwise it prints `ok: 8b replay check skipped: console without form_token`. With a token, 8b replays the identical `sign_in_args` to `/sign-in` and expects 409 and `Already submitted`.
6. **Output.** stdout holds only the existing `ok:` lines. Error lines name the step and the status or the rule, never a body, a submitted field, the setup code, the password, the setup key, a TOTP or recovery code, a csrf value or a form token.
7. **Regression test `e2e/console-setup.test.sh`.** It runs the real `e2e/console-setup.sh` (resolved relative to the test file, like `published-port.test.sh` does with `root`) end to end, without Docker and without network. Stubs go into a `mktemp -d` bin directory that is put first on `PATH`, following `scripts/wait-ready.test.sh`:
   - `docker`: `compose ... port console 8082` → `127.0.0.1:<any port>`. `compose ... logs --no-color console` → one line `pulse-console setup code: <fixture code>`. `logs ... --since ...` → no setup-code line. `up -d --force-recreate console` → exit 0. `exec ...` → prints `files=1`, exit 0.
   - `node`: stands in for `node e2e/totp.mjs <key>`. Each call prints `<n> <6 digits>`, where n grows by one, so `totp_after` never sleeps.
   - `curl`: a fake console. It parses the arguments the script uses (`-o`, `-D`, `-w '%{http_code}'`, `-b`/`-c` jar, `-X`, `-H`, `--data-urlencode k=v`, the URL), writes the body and the headers files, prints the status, and keeps its state in the test's temp directory. The cookie jar file path identifies the browser session. `GET /readyz` → 200. It renders the pages and statuses the script expects in both flows (setup, owner test with `Checks: N.`, complete with the flow's Location, sign-in, factor, authenticator with a 32-character base32 `id="totp-secret"`, the confirm page with `<ol id="recovery-codes">` and 10 distinct codes, sessions, the sign-out-all confirmation, `/` with `Signed in as`, and after setup `GET /setup` and `POST /setup` → 404).
   - Token rules of the fake, the same as the console: each form action on a rendered page gets its own fresh token, recorded with that action path (forms with the same action on one page share it, as the two `/sign-in/factor` forms of PR #9 do). A POST to path P with a `form_token` that was not issued for P, or that was already used, → 409 with `Already submitted`. A POST to a form that was rendered with a token but arrives without one → 409. In a tokenless layout, any `form_token` field → 409. `POST /setup` after setup → 404 before any token check, as in the console.
   - The fake appends every POST to a request log in the temp directory: the path and the names of the fields. It also records whether the `form_token` sent was issued for that path. The log is never printed.
   - Layouts (one environment variable of the fake, test-internal):
     - `pr9`: the forms and their order exactly as in PR #9 (sessions page with only a `/sign-out` form; a separate sign-out-all confirmation; `/sign-out` after the target on factor and authenticator pages), newline-separated.
     - `around`: on every page the script posts from, the target form sits between two decoy forms, each with its own distinct token (the fake issues a token per action, so the three tokens differ). The order on the page is fixed:
       1. **Before** the target: a prefix decoy, `action="<target path>/x"` (for example `/account/sessions/sign-out-all/x`, `/sign-in/factor/x`, `/setup/x`). Its action starts with the target path.
       2. The target form, `action="<target path>"` (on the factor page, both `/sign-in/factor` forms, next to each other and sharing one token).
       3. **After** the target: an unrelated decoy, `action="/sign-out"`. Its action neither starts with the target path nor is a prefix of it.

       All HTML of the page is on one line. Each wrong selector then takes a decoy token, and the fake answers 409:
       - first-match (first `form_token` on the page) and prefix-match (first form whose action starts with `<path>`) take the prefix decoy's token, because it comes first;
       - greedy last-match on the line takes the `/sign-out` decoy's token.

       Only the exact-action selector takes the target's token. The prefix decoy must come **before** the target. If it came after, a prefix selector would reach the target first and pass.
     - `none`: no `form_token` anywhere (legacy console before PR #11).
     - `mixed`: the `/setup` and `/setup/owner` forms carry tokens. The `/sign-in` form has none, but the sign-in page carries a token-bearing `/sign-out` decoy.
   - Cases, each a separate run of the script with a fresh fake state:
     - A. two-factor, `pr9` → exit 0.
     - B. two-factor, `around` → exit 0.
     - C. legacy, `around` → exit 0, stdout has `ok: 8b POST /sign-in replay 409 Already submitted`.
     - D. legacy, `none` → exit 0, stdout has `ok: 8b replay check skipped: console without form_token`, and the request log holds no `form_token` field.
     - E. legacy, `mixed` → exit 0, the 8b skipped line, and no `form_token` on any `POST /sign-in`. This proves that there is no fallback to the decoy and no stale owner token.
     - F. two-factor, `pr9`, the fake answers 500 to `POST /account/sessions/sign-out-all` → exit 1, stderr has `FAIL: step 11 sign out all: status 500, want 303`.
     - In every case: `POST /setup` at step 7 carries no `form_token`. Every POST that carries a `form_token` carries one that was issued for its own path (from the request log). Neither stdout nor stderr contains any fixture secret: the setup code, the setup key, any of the 10 recovery codes, any issued form token or csrf value, any TOTP code the stub printed, or the password the fake received.
     - For A to E, stdout equals a literal list of expected `ok:` lines written in the test for that flow, the current texts of steps 1 to 13 (two-factor) or 1 to 10 (legacy). The only computed part is `N` in `Checks: N.`. The test reads N with `jq '.checks | length' full/config/api/checks.json`, an independent source, not the script under test.
   - It prints `ok: <case>` per passed case and ends with `console-setup.test: <n> cases passed`. It needs bash, jq, coreutils and sed, and finishes in seconds (no `sleep` path is hit).

## Performance impact
None expected. Only a pulse-deploy e2e script and its shell test change. No api code, image, build or runtime path is touched, so no metric of pulse-api `bench/budgets.json` can move. The `lint` job of deploy CI gets one more step of a few seconds.

## Security impact
Security impact: yes. The change edits a CI workflow (`.github/workflows/ci.yml` of pulse-deploy) and a script that handles setup codes, passwords, TOTP keys, recovery codes and tokens.

Checklist items that apply:
- **Secrets in errors, logs and responses:** the script and the test print no token, csrf value, setup code, password, setup key, TOTP or recovery code. Error lines name the step and the status. The test asserts this for success runs and for a failure run (case F). Request logs of the fake stay in the temp directory, which is removed on exit, and are never printed.
- **Input validation:** the response body is untrusted. `form_token_args` matches the action as a fixed string (no regex built from the path) and never `eval`s page content. The token value goes into curl only as one `--data-urlencode` array element.
- **Dependency pins:** no new action, image or package. The new CI step is a `run:` step in the existing `lint` job, whose checkout stays pinned by SHA with `persist-credentials: false` (`ci.yml:23-25`).
- **Auth order and status codes:** not changed on the console side. The test's fake checks the console's order (404 for closed setup before any token check, 409 for a wrong-path or spent token) so that the script cannot depend on looser rules.

## Rollout order
One repository: only pulse-deploy changes.
1. Merge the deploy PR into `main`. Its own CI `dev` job builds console `main` (`ci.yml:179-225`, `ref: main` for pulse-console at lines 211-216) and runs `bash e2e/console-setup.sh dev/compose.yaml` (auto flow). Console `main` at `875e359` has the legacy flow with form tokens (`src/pages.ts:16-18, 53-55, 79-81`). It keeps working because each of its forms is the only form posting to its path on the pages the script reads. 8b still replays.
2. Rerun the failed `deploy-dev` job of pulse-console PR #9. That job checks out `lorenzh/pulse-deploy` at `ref: main` (PR #9 `.github/workflows/ci.yml:206-208`) and runs `E2E_CONSOLE_FLOW=two-factor bash e2e/console-setup.sh dev/compose.yaml` (line 243). No console commit is needed.
- Older consumers: the `full`, `demo` and `minimal` jobs do not run this script. A legacy console without form tokens is covered by case D.

## Counterexamples
- Sessions page plus confirmation page (`pr9`): a script that takes the first token on `/account/sessions` sends the `/sign-out` token to `/account/sessions/sign-out-all`. The fake, like the console, answers 409. Case A must fail with `FAIL: step 11 sign out all: status 409, want 303` on the old script.
- A script that adds the missing GET but keeps first-match selection passes `pr9` and fails `around`. The first token on each page belongs to the `<path>/x` prefix decoy before the target, so the fake answers 409 at step 2 (`POST /setup`).
- A script that flattens the body and keeps the greedy `.*name="form_token"` takes the last token on the line, the `/sign-out` decoy after the target, and fails `around` with 409.
- A prefix selector matches `action="<path>` without the closing quote, as a regex, or as `[[ $action == "$path"* ]]`. It takes the first form whose action starts with the path. In `around` that is the `<path>/x` decoy, which comes before the target, so it sends the decoy's token and gets 409 in cases B and C. With an exact comparison, the same layout passes. Acceptance evidence 3 checks this with a mutant of the fixed script.
- A script that falls back to "any token on the page" when the target form has none sends the decoy token in `mixed` (case E). The fake answers 409 for a token on a tokenless form, and the request-log check fails.
- A script that does not reset `ftok` sends the owner-form token to `/sign-in` in `mixed`, and 8b replays instead of printing the skipped line.
- Step 7 sending the sign-in page's token to `/setup` passes on the real console (404 first) but fails the request-log rule "no `form_token` on step 7".
- A script that prints a token in an error line (for example `fail "no form for $path: $body"`) fails the secret scan of case F.
- No statistics are involved.

## Contract fields
No new names in the contract or config. The only new names are inside pulse-deploy: the argument `<path>` of the existing script-local function `form_token_args`, the test file `e2e/console-setup.test.sh`, and test-internal environment variables of the fake. Searches in the clones:
- `grep -rn 'console-setup' .repos/contract/src .repos/config/src` → no match.
- `grep -rn 'form_token' .repos/contract/src .repos/config/src` → no match.
- `grep -rn 'console-setup.test' .repos/deploy` → no match (the file name is free).

## Risks
- The fake console can drift from the real one. Layout `pr9` follows PR #9's `src/account-pages.ts` line by line (cited above). The real-stack run in the acceptance evidence is the final check.
- Same-line forms: the console renders newline-separated markup today. The selector must still handle one-line markup (`around`), so a later minifier does not break it.
- `mixed` and `around` are stricter than any console today. They guard the general rule from the issue, not a current console page.
- PR #9 may change before it merges. If its forms change, the implementer updates layout `pr9` to its head at implementation time and names the SHA in the PR.

## Acceptance evidence
1. `bash e2e/console-setup.test.sh` passes on the new script with 6 cases (A to F). Expected values are literals in the test: exit codes 0/1, statuses 303/409/500, the `ok:` texts, the zero `form_token` count of case D. The only exception is N from `full/config/api/checks.json`.
2. The same unchanged test file fails on the old script. Run it from a worktree at the base commit: `git worktree add /tmp/old 0157775f8046dbfd18f14d153322adfa6a44ca30`, copy the new `e2e/console-setup.test.sh` there, then run `bash /tmp/old/e2e/console-setup.test.sh`. It must exit non-zero, and case A must report the script's `FAIL: step 11 sign out all: status 409, want 303`. A syntax error, a missing helper or a missing stub does not count as this proof. The PR quotes the failing line.
3. Prefix selection fails and exact selection passes on the same layout. Copy the fixed script and the test file into a temporary directory that keeps the `e2e/` layout and has `full/config/api/checks.json` (or into a scratch worktree of the PR branch). In that copy only, change the action comparison of `form_token_args` from exact to prefix: drop the closing `"` from the action pattern, or compare with `[[ $action == "$path"* ]]`, whichever fits the implementation. Run the test on the copy. It must exit non-zero, and cases B and C must fail with a `status 409` line of the script (expected values: the literal 409 of the fake and the literal step texts). The unmodified fixed script passes the same cases (evidence 1). The PR quotes the mutant's diff (one line) and its failing lines. Then the temporary copy is removed. Nothing of it is committed.
4. `git ls-files -z '*.sh' | xargs -0 shellcheck -x` and `git ls-files -z '*.sh' | xargs -0 -n 1 bash -n` pass from the deploy root (`ci.yml:34-37`), and so does `bun run lint` (the `check` job, see the repository section).
5. On a local `dev` stack built with pulse-console at PR #9 head (`c071619`, or its newer head, SHA named in the PR), after `scripts/wait-ready.sh dev/compose.yaml 900`: `E2E_CONSOLE_FLOW=two-factor bash e2e/console-setup.sh dev/compose.yaml` exits 0 and prints steps 1 to 13. The PR quotes the `ok:` lines only.
6. After the merge: the rerun `deploy-dev` job of pulse-console PR #9 is green. The deploy CI `dev` job on the merge commit (console `main`, auto flow) stays green.

## Repository: deploy
Files:
- `e2e/console-setup.sh` (change)
- `e2e/console-setup.test.sh` (new)
- `.github/workflows/ci.yml` (change: one step in the `lint` job)
- `AGENTS.md` (change: one row in the Commands table)
- `README.md` (change: the form-token sentence at line 142 and one new sentence after it)

Behavior change: yes. The e2e script selects form tokens differently and step 11 makes a new request; CI gains a step.

Behavior:
- `e2e/console-setup.sh`: required behavior 1 to 6 above. Change `form_token_args` at lines 65-73 to take the path, update every call site (lines 93, 101, 113, 127, 152, 213, 220, 230, 239, 295, 375), and add the `GET /account/sessions/sign-out-all` to step 11 (lines 289-299). Step 7 in both flows sends no `form_token`. Keep the header comment true. Extend its last sentence: each POST sends the `form_token` of the form that posts to its path, or none. Keep every `ok:` text unchanged.
- `e2e/console-setup.test.sh`: required behavior 7 above, cases A to F. Write the stubs into a `mktemp -d` directory with a `trap 'rm -rf …' EXIT`, as `scripts/wait-ready.test.sh:6-20` does. Do not copy or `eval` the script's `form_token_args`: the test must run the real script, so it detects the missing GET as well as a wrong selector. Put the expected `ok:` lines as literals in the test. The test must pass `shellcheck -x` (use `# shellcheck disable=` only with a reason comment, as the script does at line 325).
- `.github/workflows/ci.yml`: in the `lint` job, add after the `published_port helper` step (lines 48-49):
  ```yaml
      - name: console-setup form tokens (stub curl, docker, node)
        run: bash e2e/console-setup.test.sh
  ```
  No new action, no new permission. The `lint` job already prints `jq --version` and `node --version` (lines 30-31), and runs on `ubuntu-24.04` (line 20). The test needs no Docker and no node (node is stubbed).
- `AGENTS.md`: a Commands row `| console-setup form tokens (stub curl, docker, node) | bash e2e/console-setup.test.sh |` next to the other `e2e/*.test.sh` rows.
- `README.md`: line 142 now says "every POST sends it back". Reword it: each POST sends the `form_token` of the form that posts to its path, or none when that form has none; step 11 reads it from the sign-out-all confirmation page. Keep the rest of that paragraph (8b replay and skipped line). Add one sentence after it: `bash e2e/console-setup.test.sh` runs the script against a stub console (no Docker) and checks that each POST sends the form token of its own form.

Tool facts (verified):
- Shell lint is `shellcheck -x` and `bash -n` over `git ls-files '*.sh'` in the `lint` job (`.github/workflows/ci.yml:34-37`). It picks up the new test file without further wiring.
- The `check` job calls `lorenzh/pulse-config/.github/workflows/check.yml@04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`ci.yml:16-17`). At that ref it runs `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck` and `bun run test` (check.yml lines 25-38, read with `gh api`, identical to the config clone). deploy `package.json:14` defines `lint` as `biome check . && pulse-eslint . && pulse-workflows`. `pulse-workflows` checks the workflow files against the action policy, so the new `run:` step must keep it green. `package.json:13` `test` is `bun test --coverage cli` and does not run shell tests. The pinned config `04108fa` differs from the config clone `main` only in `src/hook.test.ts` (`gh api repos/lorenzh/pulse-config/compare/04108fa…main`).
- The `dev` job runs `bash e2e/console-setup.sh dev/compose.yaml` against console `main` (`ci.yml:223-225`, console checkout `ref: main` at 211-216).

Checks to run before handoff (from the deploy root):
- `bash e2e/console-setup.test.sh`
- the old-script proof of acceptance evidence 2
- the prefix-mutant proof of acceptance evidence 3 (in a temporary copy, never committed)
- `git ls-files -z '*.sh' | xargs -0 shellcheck -x` and `git ls-files -z '*.sh' | xargs -0 -n 1 bash -n`
- `bun install --frozen-lockfile && bun run check` (the workflow file changed)
- the other `lint` job steps stay green: `bash e2e/published-port.test.sh`, `bash e2e/metric-is.test.sh`, `bash e2e/manual-count.test.sh`, `bash e2e/outage-history.test.sh`
- when Docker is available: acceptance evidence 5 against pulse-console PR #9, and the auto flow against console `main` (`bash e2e/console-setup.sh dev/compose.yaml` on a fresh `dev` stack)

Completion evidence:
- The PR names #726 and lists: the passing test output (`console-setup.test: 6 cases passed`); the failing line of the old-script run; the one-line diff and the failing lines of the prefix mutant; the shellcheck and `bun run check` results; the `ok:` lines of the real two-factor run against PR #9 with the console SHA, or the reason it could not run locally.
- After the merge, the rerun of pulse-console PR #9 `deploy-dev` turns green. That run is outside this PR and is recorded on #722.
