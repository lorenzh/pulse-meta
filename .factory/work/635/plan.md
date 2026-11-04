# Spec #635: deploy: redact URL credentials in Compose diagnostics

## Goal

The `pulse` CLI never prints URL user info (username, password or both) that Docker or Docker Compose writes to stderr. Today `firstLine` in `cli/docker.ts` copies the first nonblank stderr line into five diagnostics as it is. A malformed `compose.override.yaml` whose `extends.file` is `http://u:SENTINEL@127.0.0.1:1/x.yaml` makes Compose print `open /x/http:/u:SENTINEL@127.0.0.1:1/x.yaml: no such file or directory`. `pulse status`, `up` and `down` then show `SENTINEL`. This is a follow-up to lorenzh/pulse-deploy#4, which added the CLI.

## Sources read

- `.factory/work/635/issue-review.md`: no blocking question. This spec adopts its working assumptions 1 to 7 and builds on its acceptance checks.
- Issue #635 and its comments. The only comment is the Factory issue-review report, so there are no earlier decisions.
- deploy clone at `621cbf0` (`main`): `cli/docker.ts`, `cli/args.ts`, `cli/lifecycle.ts`, `cli/main.ts`, `cli/main.test.ts`, `cli/docker.test.ts`, `cli/test/fake-docker.ts`, `cli/test/errors.sh`, `package.json`, `biome.json`, `bunfig.toml`, `.github/workflows/ci.yml`, `AGENTS.md`.
- config `.github/workflows/check.yml` at the deploy pin `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`, read with `gh api`. It is identical to the config clone on `main`.
- api `bench/budgets.json`. Its top-level keys are `api`, `config`, `contract`, `kit`, `notify`, `probe` and `status`. There is no deploy key.

## Current behavior (deploy `main`)

- `cli/docker.ts:99-101`: `firstLine(text)` returns the first line for which `trim() !== ""`, as it is, or `""`. It does no masking.
- `firstLine` has exactly five callers, all in `cli/docker.ts` (`grep -rn firstLine cli` finds no others):

| Diagnostic | Line | Exit code |
| --- | --- | --- |
| `cannot reach the Docker daemon: …` (preflight) | 139 | 3 |
| `docker compose config failed: …` (guard step 3) | 344 | 1 |
| `docker ps failed: …` (guard step 4) | 379 | 1 |
| `docker volume ls failed: …` (guard step 5) | 411 | 1 |
| `docker volume inspect failed: …` (guard step 5, not `no such volume`) | 421 | 1 |

- `guarded` in `cli/lifecycle.ts:81-95` prints `pulse <cmd>: <message>` to stderr and returns the `CommandError` exit code. `up`, `down`, `down --volumes` and `status` all go through it.
- `shown` in `cli/args.ts:135-152` already hides user input in argument diagnostics and uses the placeholder `(hidden)`. This spec reuses that placeholder so the CLI uses one word for hidden text.

## Scope

- deploy only: mask URL user info in the line that `firstLine` returns, so all five diagnostics and any later caller get it.

## Non-goals

- No masking of query strings, fragments, or secrets that are not URL user info. No change to `shown`.
- No change to Compose `up`/`down` output, which `inherit: true` sends straight to the terminal, or to the Compose `ps` failure in status, which prints only an exit code.
- No change to diagnostic prefixes, guard order, exit codes, the `no such volume` exception, or the first-nonblank-line choice.
- No new dependency, no change to Compose files, scripts, CI or docs.

## Required behavior

1. `firstLine(text)` picks the same line as today: the first line split on `\n` whose `trim()` is not empty, or `""`. It then returns that line with every URL user-info component replaced by the fixed text `(hidden)`.
2. A URL user-info component is the text between a URL scheme followed by `:` and one or two slashes, and the last `@` before the authority ends:
   - Scheme: RFC 3986 `ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )`, any case (`http`, `HTTPS`, `Http`, `ssh`, `git+https`).
   - Separator: `://` or `:/`. Compose turns `http://` into `http:/` inside file paths, so the single-slash form is required.
   - User info: one or more characters that are not whitespace, `/`, `?` or `#`, followed by `@`. If the run holds more than one `@`, the user info ends at the **last** `@` of the run, as in WHATWG URL parsing. So `http://u:p@ss@host` masks `u:p@ss`.
   - The URL may be embedded anywhere in the line, for example after a path prefix such as `/x/`.
3. Masking replaces the whole user info, both username and password, with `(hidden)`. It keeps the scheme exactly as written (case, slash count), the `@`, the host, the port, the path and all surrounding text. The output does not depend on the length or content of the credential. Percent-encoded credentials are masked as opaque text and never decoded.
4. All matches on the selected line are masked.
5. A line without such a component is returned unchanged. This covers credential-free URLs, URLs with `@` only in the path, plain paths, email addresses without a scheme, and image references such as `ghcr.io/x/y@sha256:…`.
6. Masking must not let the credential reach the output through the replacement string. Use a fixed replacement that refers only to the scheme-and-slashes capture group (for example `"$1(hidden)@"`) or a replacer function. Never build the replacement from the matched credential.
7. Masking runs in linear time in the line length. A reference pattern that meets rules 2 to 6:
   `/(?<![A-Za-z0-9+.-])([A-Za-z][A-Za-z0-9+.-]*:\/\/?)[^\s/?#]+@/g` replaced by `"$1(hidden)@"`. The greedy `[^\s/?#]+` backtracks to the last `@` of the run. The lookbehind starts a scheme only at the start of a scheme-character run. Any equivalent implementation is acceptable if it passes the counterexamples.
8. Export the masking step as `maskUserInfo(line: string): string` from `cli/docker.ts` so it can be unit tested. `firstLine` calls it.
9. Exit codes and message prefixes of the five diagnostics stay exactly as in the table above.

Example: stderr `open /x/http:/u:SENTINEL@127.0.0.1:1/x.yaml: no such file or directory` on the config call gives, for `pulse status`, the stderr line
`pulse status: docker compose config failed: open /x/http:/(hidden)@127.0.0.1:1/x.yaml: no such file or directory` with exit code 1.

## Risks

- **False positives:** text like `C:/user@host` or `x:/a@b` would be masked. That costs some readability but leaks nothing, so it is acceptable. Image digests (`name@sha256:`) and `host:port/path@x` do not match, because a scheme must be followed directly by `:/`.
- **Raw `@` in a password:** handled by rule 2 (last `@`). A password with a raw `/`, `?` or `#` already ends the authority under URL parsing, and Compose would not resolve it as a credential either. Masking up to the first such character still hides the part before it. The part after it is outside this spec (non-goal: arbitrary secrets).
- **Regex cost on hostile stderr:** covered by rule 7 and a counterexample with a 1 MB line.
- **Test passes for the wrong reason:** an assertion of "no SENTINEL" alone passes if the call is never reached. Every test also asserts the prefix, the kept suffix and the exit code.

## Performance impact

None expected. The change is one regex replace on one stderr line, and only on a CLI failure path in deploy. The api `bench/budgets.json` covers only `api`, `config`, `contract`, `kit`, `notify`, `probe` and `status`, so no budgeted or reported metric (startup CPU, load CPU, idle or peak RSS, test CPU, build CPU, wall-clock startup, p95 latency, requests per second, image size) can move. No A/B is needed.

## Security impact

Security impact: yes
The change edits error texts that carry external data (Docker and Compose stderr) so that they stop leaking credentials.

Checklist items that apply:
- **Secrets in errors, logs and responses:** URL user info must not reach stdout or stderr from any of the five diagnostics, in either slash form and in any case. The security state should try hostile stderr: `HTTPS://U:P@h`, `http:/u:p@ss@h/x`, `git+ssh://tok@h`, `%75:%70@`, two URLs on one line, a credential on line 2 after a blank line 1, a password holding `$&` or `$1` (replacement-pattern injection), and a 1 MB line.
- **Input validation:** the masking regex runs on untrusted text and must stay linear (rule 7).

Not affected: auth, body limits, accessor execution, SSRF and redirects, file writes, dependencies, Dockerfiles, CI.

## Rollout order

One repository. Only deploy changes. The CLI is a self-contained binary with no consumers on older pins, so nothing else needs to keep working with it.

## Counterexamples

Each row is input text for `maskUserInfo` (or stderr for `firstLine`), with the exact expected output written out. A wrong implementation would fail the row.

| # | Input | Expected output | Catches |
| --- | --- | --- | --- |
| 1 | `open /x/http:/u:SENTINEL@127.0.0.1:1/x.yaml: no such file or directory` | `open /x/http:/(hidden)@127.0.0.1:1/x.yaml: no such file or directory` | a pattern that needs `//` |
| 2 | `get http://u:SENTINEL@h:1/x` | `get http://(hidden)@h:1/x` | double-slash form |
| 3 | `HTTPS://u:SENTINEL@h/x` | `HTTPS://(hidden)@h/x` | a lowercase-only scheme, or a scheme rewritten to lowercase |
| 4 | `a https://u:S1@h/x b http:/v:S2@g/y` | `a https://(hidden)@h/x b http:/(hidden)@g/y` | masking only the first match |
| 5 | `http://SENTINEL@h/x` | `http://(hidden)@h/x` | masking only `user:password` |
| 6 | `http://:SENTINEL@h/x` | `http://(hidden)@h/x` | empty username |
| 7 | `http://SENTINEL:@h/x` | `http://(hidden)@h/x` | empty password |
| 8 | `http://%53ENTINEL:%70w@h/x` | `http://(hidden)@h/x` | decoding or keeping encoded parts |
| 9 | `http://u:p@SENTINEL@h/x` | `http://(hidden)@h/x` | stopping at the first `@` |
| 10 | `http://u:$&$1SENTINEL@h/x` | `http://(hidden)@h/x` | a replacement built from the match |
| 11 | `http://h:1/a@b` | unchanged | `@` in the path taken as user info |
| 12 | `http:/h/a@b c` | unchanged | the same in single-slash form |
| 13 | `open /srv/pulse/compose.override.yaml: no such file or directory` | unchanged | changing plain paths |
| 14 | `mail ops@example.com failed` | unchanged | masking an email address without a scheme |
| 15 | `pull ghcr.io/lorenzh/pulse-api@sha256:abc failed` | unchanged | masking an image digest |
| 16 | `Error response from daemon: get pulse_x: no such volume` | unchanged | changing ordinary Docker text |
| 17 | `http://@h/x` | unchanged | empty user info (nothing to hide; rule 2 needs one or more characters) |
| 18 | `http://` followed by 1 000 000 × `a` (no `@`) | unchanged, in under 1 s | quadratic backtracking |

`firstLine` cases. The stderr is written with `\n` escapes, and the expected output is literal:

| # | stderr | Expected `firstLine` |
| --- | --- | --- |
| F1 | `""` | `""` |
| F2 | `"\n  \n"` | `""` |
| F3 | `"\n\nhttp:/u:SENTINEL@h/x\nhttp://v:LATER@g\n"` | `http:/(hidden)@h/x` (line 2 is never shown) |
| F4 | `"plain error\nhttp://u:SENTINEL@h\n"` | `plain error` |

Diagnostic cases (rule 9). Each injects stderr `open /x/http:/u:SENTINEL@127.0.0.1:1/x.yaml: no such file or directory` into one failing call, with every earlier call succeeding:

| Failing call | Expected stderr contains | Exit |
| --- | --- | --- |
| `docker version` | `cannot reach the Docker daemon: open /x/http:/(hidden)@127.0.0.1:1/x.yaml` | 3 |
| `docker compose … config` | `docker compose config failed: open /x/http:/(hidden)@127.0.0.1:1/x.yaml` | 1 |
| `docker ps` | `docker ps failed: open /x/http:/(hidden)@127.0.0.1:1/x.yaml` | 1 |
| `docker volume ls` | `docker volume ls failed: open /x/http:/(hidden)@127.0.0.1:1/x.yaml` | 1 |
| `docker volume inspect` (stderr without `no such volume`) | `docker volume inspect failed: open /x/http:/(hidden)@127.0.0.1:1/x.yaml` | 1 |

A wrong implementation that masks only the config call fails the other four rows. One that drops the whole diagnostic fails the "contains" check.

No statistics are involved.

## Contract fields

No contract or config names. The only new name is the deploy-internal export `maskUserInfo`. The placeholder `(hidden)` already exists in `cli/args.ts:148,151`.

Collision search, run from `.target/.repos`:

```
$ grep -rn 'maskUserInfo' contract/src config deploy/cli
(no output)
```

## Repository: deploy

Files:
- `cli/docker.ts`: add the exported `maskUserInfo` and call it from `firstLine`. Add a doc comment.
- `cli/docker.test.ts`: unit tests for `maskUserInfo` and `firstLine` (Counterexamples 1-18 and F1-F4), plus the five diagnostic cases for all four commands.
- `cli/test/fake-docker.ts`: an optional `FakeOpts` field to inject a failing result (code 1 and given stderr) for one call: `version`, `config`, `ps`, `volume ls` or `volume inspect`. The default behavior stays unchanged.
- `cli/main.test.ts`: the end-to-end regression from "Done when", run through `main`.

Behavior change: yes
CLI diagnostics no longer show URL user info.

### Behavior

Implement the "Required behavior" section, rules 1 to 9. `firstLine` stays the only path, so the five call sites at `cli/docker.ts:139,344,379,411,421` need no edit except through `firstLine`.

### Tests

1. **Done-when regression (`cli/main.test.ts`).** Use `makeInstall()` for an install directory. Call `main(["status", "--dir", dir], io, {}, { spawn, env })` with the spawn from `fakeDocker`. Inject code 1 and stderr `open /x/http:/u:SENTINEL@127.0.0.1:1/x.yaml: no such file or directory` on the Compose `config` call. Preflight succeeds. Assert all of:
   - exit code `1`;
   - collected stderr and stdout contain `pulse status: docker compose config failed: open /x/http:/(hidden)@127.0.0.1:1/x.yaml: no such file or directory`;
   - neither stream contains `SENTINEL` or `u:SENTINEL`.

   `status` takes `--dir` (`cli/args.ts:102`).

   The expected values are the literals in this spec, not values read from the code.
2. **Diagnostic matrix (`cli/docker.test.ts`).** For each of the five rows of the diagnostic table, and for each of `up`, `down`, `down --volumes` and `status` (the existing `COMMANDS` helper), assert the exit code from the table, that stderr contains the prefixed masked line, and that `SENTINEL` is absent. Preflight is shared, so the preflight row may extend the existing `Docker preflight` cases. The volume-inspect row needs a declared volume and stderr without `no such volume`, so it reaches line 421.
3. **Unit cases (`cli/docker.test.ts`).** Counterexamples 1-18 and F1-F4 with the literal expected strings above. Run row 18 with a timing bound of 1000 ms.
4. **Fails before the fix.** Run test 1 against unmodified `cli/docker.ts` (for example `git stash push cli/docker.ts`). It must fail on the `SENTINEL` assertion. Record this in the PR.
5. The existing test `cli/docker.test.ts:55-76`, which expects `cannot reach the Docker daemon: Cannot connect to the Docker daemon`, keeps passing unchanged. So does `cli/test/errors.sh:59-60`, which expects `cannot reach the Docker daemon`.

### Tool facts (verified)

- Bun `1.4.0`: `package.json:8-9` (`engines.bun`) and `package.json:28` (`packageManager`).
- Tests: `bun test --coverage cli` (`package.json:13`). Coverage threshold `lines = 0.8` (`bunfig.toml:2`). Test files and `cli/test/**` are excluded from coverage (`bunfig.toml:3`).
- Lint: `biome check . && pulse-eslint . && pulse-workflows` (`package.json:14`). Biome `2.6.3` (`package.json:21`). Its scope includes `cli/**` (`biome.json:5`). `biome.json:2` extends `@lorenzh/pulse-config/biome.json`. This spec relies on no rule of that file beyond the fact that `bun run lint` passes.
- `check` = lint, typecheck, test (`package.json:18`).
- CI: `.github/workflows/ci.yml:17` calls `lorenzh/pulse-config/.github/workflows/check.yml@04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`. At that ref, `check.yml` runs Bun 1.4.0 (lines 22-24), `bun install --frozen-lockfile` (26), `bun run lint` (28), `bun run typecheck` (30) and `bun run test` (38). It is identical to the config clone. The `cli-errors` job (`ci.yml:367-380`) builds and runs `bash cli/test/errors.sh dist/pulse`.

### Checks

- `bun install --frozen-lockfile && bun run check` passes.
- `bun run build && bash cli/test/errors.sh dist/pulse` passes, so existing failure messages still work in the binary.
- `grep -rn 'firstLine(' cli/*.ts` shows only the definition and the five call sites. No caller bypasses the mask.

### Completion evidence

- The PR lists the new test names and the output of `bun run check` and `errors.sh`, and confirms test 1 failed before the fix (test 4).
- Known limit, stated in the PR: query strings, fragments, inherited Compose `up`/`down` output and secrets outside URL user info are not masked.

## Acceptance

Done when the deploy test in "Tests" item 1 passes. Its stderr line is `open /x/http:/u:SENTINEL@127.0.0.1:1/x.yaml: no such file or directory`. The CLI output contains no `SENTINEL` and contains the literal `pulse status: docker compose config failed: open /x/http:/(hidden)@127.0.0.1:1/x.yaml: no such file or directory` with exit code 1. The same test fails on deploy `621cbf0`.
