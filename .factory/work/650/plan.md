# Spec #650: deploy E2E accepts the digest key of a manual incident update

## Goal

The Compose E2E of pulse-deploy (`e2e/compose-e2e.sh`, step "Manual incidents") asks for the
notify key `manual:<id>:update:1` for the one update of its manual incident. Notify `v0.1.0`
built that key from a counter (`src/detector.ts:102-104` at tag `v0.1.0`:
`` return `manual:${id}:update:${n}`; ``). Notify `main` builds it from a digest
(`src/detector.ts:107-113` at `757e78f`: SHA-256 of `[at, status, message]`, `.digest("hex")`,
`.slice(0, 32)`). With a notify image built from `main`, the step "notify sent
manual:<id>:update:1" waits 60 s and fails, although the update was sent.

This spec makes the E2E accept both forms of the update key. It still demands exactly one
entry per event, before and after a notify restart. Deploy pins notify `0.1.0`
(`common/services.yaml:35`), so the E2E must stay green on that pin, and it must also pass
with a notify built from `main`, so that the pin can move later.

## Inputs and decisions

- The issue review (`.factory/work/650/issue-review.md`) found no blocking question. Its open
  points 1-6 are taken as decisions here:
  1. Key grammar: the update key is `manual:<id>:update:<suffix>` with a non-empty suffix of
     lower-case hex digits, `[0-9a-f]+`. The legacy counter `1` is in that set. The E2E does
     not check the width of 32 and does not recompute the hash. `opened` and `resolved` stay
     exact matches.
  2. "Exactly once" counts every update entry of this incident in the file, whatever its
     suffix. Two entries with the same digest, two with different digests, or one legacy and
     one digest entry count as 2 and fail.
  3. Restart coverage stays as it is: the catch-all channel before the restart, the web channel
     after it, all three events each time.
  4. No dependency on #646 (probe header host binding); no notify change. Notify `main`
     already holds the digest key and the work of #649 (pulse-notify PR #41).
  5. The run with a notify from `main` uses a local image and a substituted image reference in
     a throwaway copy of deploy. No pin moves in this change.
  6. A Docker-free helper test checks the counting helper, like `e2e/metric-is.test.sh`.
- The issue has no other comments with decisions.

## Scope

- deploy: the update helpers and the three update checks in `e2e/compose-e2e.sh`, a new
  Docker-free test of the helpers, its CI step, and its row in the command table of
  `AGENTS.md`.

## Non-goals

- No change to notify, its key format, its ledger, or its file channel.
- No move of the notify pin and no change of `common/services.yaml` in the merged change.
- No permanent switch or environment variable in the E2E to choose a candidate image, and no
  CI job that runs the E2E against `main` images.
- No check of the digest width or of the hash input. The E2E does not recompute the digest.
- No new incident, update, channel, or restart mode in the scenario.
- No new dependency, image, or action.
- Not #646.

## Required behavior

1. `e2e/compose-e2e.sh` gets a helper that counts the update entries of one manual incident in
   one notify channel file. Suggested name `manual_update_count <file> <id>`. It reads the file
   the same way as `manual_count` (`docker compose exec -T notify cat "/data/<file>"`) and
   counts the lines whose `key` field is exactly `manual:<id>:update:<suffix>` with
   `<suffix>` matching `[0-9a-f]+` and nothing after it. Notify writes each line with
   `JSON.stringify(notification)` (`src/channels/file.ts:8` of notify), with `key` as the first
   field (`src/types.ts:12-13`), so a match on `"key":"manual:<id>:update:[0-9a-f]+"` including
   both quotes is exact. Matching with `jq` on `.key` is also fine. The implementer picks one.
2. The helper accepts only a decimal id (`^[0-9]+$`). For any other id it prints `0` and
   returns non-zero. The id never reaches a regex unchecked.
3. A missing or empty file, or a file with no match, counts as `0`, as `manual_count` does today
   (`grep -c ... || true`, line 265).
4. A second helper, suggested name `manual_update_sent <file> <id>`, succeeds only when the count
   is exactly `1`, like `manual_sent` (line 268).
5. The three places with `update:1` use the new helpers:
   - line 501: `wait_for "$T_NOTIFY" ...` waits for `manual_update_sent manual-web.jsonl
     "$manual_id"`. The text names the key form, for example
     `notify sent manual:<id>:update:<hex> to the web channel`.
   - lines 521-524 (catch-all channel before the restart): `opened` and `resolved` keep
     `manual_count ... == "1"`; the update uses `manual_update_count incidents.jsonl "$manual_id"
     == "1"`. The fail text says which event and channel failed.
   - lines 531-534 (web channel after the restart, after `notify_has_polled` and the
     `sleep $((POLL_INTERVAL * 3))`): the same split for `manual-web.jsonl`.
6. After the wait of line 501 succeeds, the E2E prints the one update key it saw, once, as an
   `ok:` line, for example `ok: notify sent the update as manual:1:update:<suffix>`. It prints
   only text that matched the key pattern of item 1 (for example from `grep -oE`), never a whole
   line of the file. This line is the evidence of which key form a run exercised.
7. `manual_count`, `manual_sent`, the `opened`/`resolved` checks, the public-api routing check
   (line 518) and every other step keep their behavior.
8. A new test `e2e/manual-count.test.sh` checks the real helpers, extracted from
   `e2e/compose-e2e.sh` the way `e2e/metric-is.test.sh` extracts `metric_is` (`sed` range plus
   `declare -F`, failing when a helper is missing). A `docker` shell function stubs the read and
   prints fixture JSONL lines for the asked file. It needs no Docker. It covers every case of
   "Counterexamples" below and ends with a line that names the number of passed cases.
9. `.github/workflows/ci.yml`, job `lint`: a step `manual_count helpers` runs
   `bash e2e/manual-count.test.sh`, next to the steps `metric_is helper` and
   `published_port helper` (lines 44-47). `AGENTS.md` gets the matching row in its command
   table, next to the `metric_is helper test` row.

## Risks

- A notify from `main` with the pinned api, status and probe `0.1.0` could fail at a different
  step of the E2E for a reason other than the key. The issue says the key step was the failure
  seen for PR #41 (#649). If another step fails in acceptance run 3, the implementer records
  the step and holds with `needs-input`. It does not widen this change.
- The extraction of a one-line helper (`manual_sent() { ...; }`) with a `sed` range
  `/^name()/,/^}/` runs to the next `}` line and can pull in more code. The test must extract
  exactly the helpers it needs and fail with `declare -F` when one is missing.
- `grep -c` exits 1 on zero matches; under `set -o pipefail` the `|| true` keeps the output
  `0`. A refactor that drops it breaks the "no match is 0" case. The helper test covers it.
- The E2E tears the stack down on exit, so the channel files are gone after a run. The
  `ok:` line of item 6 is the only record of the key form; acceptance needs the run log.

## Performance impact

None expected. The change touches only the E2E shell script, a shell test, a CI step and a doc
row of deploy. No service code, image, or build changes, so none of the metrics of
`bench/budgets.json` in the api repository (`startup_cpu_ms`, `load_cpu_s`, `idle_rss_mib`,
`peak_rss_mib`, `test_cpu_s`, build CPU, and the reported wall-clock startup, p95 latency,
requests per second, image size) can move. The new lint step adds well under a second of CI
time.

## Security impact

Security impact: yes
The change edits a CI workflow (`.github/workflows/ci.yml`) and a script that prints text read
from a service's output files.

Checklist items that apply:

- Dependency pins: the new CI step is a `run:` step only. No new action, image, or package. All
  existing `uses:` lines stay pinned by SHA with `persist-credentials: false`
  (`.github/workflows/ci.yml:23-25` for job `lint`). `pulse-workflows` checks the workflow against the action
  policy in `bun run lint` (`package.json:14`).
- Secrets in errors and logs: the new `ok:` line prints only text matched by the key pattern
  (`manual:<digits>:update:[0-9a-f]+`), never a whole JSONL line, a message, or a token. Fail
  texts name the event and channel only, as deploy's rule "Scripts never print a token" demands.
- Input validation: the id is checked as `^[0-9]+$` before it is put into a pattern, so it can
  not widen the match.

## Rollout order

One repository: only deploy changes. Notify `main` already writes the digest key, notify
`0.1.0` (the pin) writes the counter key, and the new E2E accepts both, so no other
repository waits for this change and no running service changes.

## Counterexamples

Fixture lines are compact JSON as notify writes them (`{"key":"...","event":"...",...}`).
Incident id `1` unless noted. "Count" is the output of `manual_update_count <file> 1`.

| Case | Lines in the file | Expected | A wrong implementation that fails it |
|---|---|---|---|
| legacy | one line, key `manual:1:update:1` | count 1, `sent` ok | matches only 32-hex suffixes |
| digest | one line, key `manual:1:update:0123456789abcdef0123456789abcdef` | count 1, `sent` ok | matches only `update:1` (today's code) |
| none | no line / missing file | count 0, `sent` fails | prints empty text or fails under `pipefail` |
| same digest twice | two lines with the same digest key | count 2, `sent` fails | counts distinct keys |
| two digests | two lines with different digest keys | count 2, `sent` fails | stops at the first match |
| legacy and digest | `update:1` and one digest key | count 2, `sent` fails | counts one form only |
| other incident | key `manual:11:update:abc`, and `manual:2:update:1` | count 0 | match without the closing/opening boundary (`manual:1` prefix of `manual:11`) |
| other event | keys `manual:1:opened`, `manual:1:resolved` | count 0 | counts every key of the incident |
| upper case | key `manual:1:update:ABCDEF` | count 0 | case-insensitive match |
| non-hex | key `manual:1:update:xyz`, `manual:1:update:12g4` | count 0 | `[^"]+` suffix |
| empty suffix | key `manual:1:update:` | count 0 | `*` instead of `+` |
| trailing text | key `manual:1:update:abc:2` | count 0 | no closing quote in the pattern |
| key only in a message | `key` is `manual:1:opened`, `manual.message` holds the text `"key":"manual:1:update:1"` (escaped by `JSON.stringify` as `\"key\":\"...`) | count 0 | matches the text anywhere in the line without the quote boundary |
| bad id | `manual_update_count incidents.jsonl '1|.*'` or `''` | prints `0`, non-zero exit | id put into the regex unchecked |
| exact keys unchanged | one line `manual:1:opened` | `manual_count <file> manual:1:opened` is 1, `manual_sent` ok | a change of `manual_count` |

No statistics are involved. The count is the number of lines of one file that match, read once.

## Contract fields

No new names in contract or config: the key format `manual:<id>:update:<hex>` is notify's
existing format, and the change adds only shell helper names, a test file and a CI step in
deploy. Searches on the clones (run from `.repos/`):

```
$ grep -rn 'manual_update_count\|manual_update_sent\|manual-count' contract/src config deploy | grep -v node_modules
(no output, exit 1)
$ grep -rn 'manual_count' contract/src config deploy | grep -v node_modules
deploy/e2e/compose-e2e.sh:264:manual_count() { # manual_count <file> <key>: lines of a notify channel file with the key
deploy/e2e/compose-e2e.sh:268:manual_sent() { [[ "$(manual_count "$1" "$2")" == "1" ]]; }
deploy/e2e/compose-e2e.sh:518:[[ "$(manual_count manual-public-api.jsonl "manual:${manual_id}:opened")" == "0" ]] ||
deploy/e2e/compose-e2e.sh:522:  [[ "$(manual_count incidents.jsonl "manual:${manual_id}:${key}")" == "1" ]] ||
deploy/e2e/compose-e2e.sh:532:  [[ "$(manual_count manual-web.jsonl "manual:${manual_id}:${key}")" == "1" ]] ||
```

The new names do not exist in contract, config or deploy. `manual_count` is the existing helper,
kept unchanged.

## Repository: deploy

Files:
- `e2e/compose-e2e.sh` (change: new update helpers, lines 501, 521-524, 531-534, and the ok line that prints the update key)
- `e2e/manual-count.test.sh` (new: Docker-free helper test)
- `.github/workflows/ci.yml` (change: one step in the lint job)
- `AGENTS.md` (change: one row in the command table)

Behavior change: yes
The E2E today fails with a notify from `main` and must pass with both key forms; a CI step is
added.

Behavior: items 1-9 of "Required behavior". Keep `manual_count` and `manual_sent` as they are.
Do not touch `common/services.yaml`, any pin, or any other step of the E2E. If the code
already accepts the digest form at all three places, hold instead of a review.

Tool facts, verified in this repository at `d4fa0ee`:

- CI job `lint` runs `git ls-files -z '*.sh' | xargs -0 shellcheck -x` and
  `git ls-files -z '*.sh' | xargs -0 -n 1 bash -n` (`.github/workflows/ci.yml:34-37`), so the
  new test file is linted without a CI change. The helper tests run as their own steps
  (`ci.yml:42-47`: `outage-history.test.sh`, `metric-is.test.sh`, `published-port.test.sh`);
  the new step goes there.
- CI job `full` runs `bash e2e/compose-e2e.sh` (`ci.yml:116-118`) on the pinned images.
- CI job `check` uses `lorenzh/pulse-config/.github/workflows/check.yml@04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`
  (`ci.yml:17`); `package.json:22` pins `@lorenzh/pulse-config` to the same SHA. At that ref
  `check.yml` runs `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck` and
  `bun run test` (`check.yml:25-38` at `04108fa`, read with `gh api` from the contents API at
  that ref; byte-equal to the config clone on `main`). Deploy's `lint` is
  `biome check . && pulse-eslint . && pulse-workflows` (`package.json:14`).
- `pulse-workflows` (`bin/pulse-workflows.js:39-45` of config at `04108fa`, byte-equal to the
  clone) reads every `*.yml` file of `.github/workflows` and checks it against the action
  policy, so the changed `ci.yml` passes through it.
- Biome does not read `.sh` files and does not read `e2e/` or `.github/`: deploy's `biome.json:2`
  extends `@lorenzh/pulse-config/biome.json`, and its own `files.includes` (`biome.json:4-27`)
  lists `cli/**` and a few root config files and excludes `!.github` (line 12), `!*.md`
  (line 13) and `!e2e` (line 17). The inherited `biome.json` of config at `04108fa` sets
  `"ignoreUnknown": true` (line 9) and has no shell support; it is byte-equal to the clone.
  `AGENTS.md` is excluded by `!*.md`.
- ESLint does not read `.sh` or `.yml` files: deploy's `eslint.config.js:4` spreads the base
  config of `@lorenzh/pulse-config/eslint.config.js`, which at `04108fa` sets
  `files: ["**/*.ts", "**/*.js"]` (lines 11 and 20) and nothing else; it is byte-equal to the
  clone.
- The E2E sets `COMPOSE_FILE=full/compose.yaml:e2e/compose.e2e.yaml` itself
  (`e2e/compose-e2e.sh:14`) and starts with `docker compose up -d --pull missing` (line 320),
  so a local image named in `common/services.yaml` is used without a pull.

Checks before handoff (deploy `AGENTS.md`, "Commands"; the changed jobs are `lint`, `full` and
`check`):

1. `bash e2e/manual-count.test.sh`: every case of "Counterexamples" passes. The expected
   counts are the literals of that table, not values read from `compose-e2e.sh`. Show that the
   test fails on today's helpers: with the line-501 form (exact `update:1` only), the `digest`
   case must fail.
2. `git ls-files -z '*.sh' | xargs -0 shellcheck -x` and
   `git ls-files -z '*.sh' | xargs -0 -n 1 bash -n`, from the repository root.
3. Every other step of job `lint` (`ci.yml:26-59`), run from the repository root, each with
   exit `0`:
   - `git ls-files -z '*.mjs' | xargs -0 -n 1 node --check` (helper syntax, `ci.yml:38-39`)
   - `git ls-files -z '*.json' | xargs -0 -n 1 jq empty` (JSON syntax, `ci.yml:40-41`)
   - `bash e2e/outage-history.test.sh`, `bash e2e/metric-is.test.sh`,
     `bash e2e/published-port.test.sh` (`ci.yml:42-47`)
   - `scripts/check-setup.sh` and `bash scripts/check-setup.test.sh` (`ci.yml:48-51`)
   - `bash scripts/secrets-init.test.sh` (needs Docker, `ci.yml:52-53`)
   - `bash scripts/bump-images.test.sh` (`ci.yml:54-55`)
   - `bash scripts/wait-ready.test.sh` (`ci.yml:56-57`)
   - `bash scripts/init-secrets.test.sh` (`ci.yml:58-59`)
   These are the rows of deploy's `AGENTS.md` command table (lines 43-54) for the `lint` job.
4. `bun install --frozen-lockfile && bun run check` (job `check`; covers `pulse-workflows` on
   `ci.yml`).
5. No pin changed in the committed branch. Record the implementation base as
   `base=$(git merge-base origin/main HEAD)` and name its SHA in the pull request. Then
   `git diff --exit-code "$base" HEAD -- common/services.yaml` exits `0` and
   `git diff --name-only "$base" HEAD` lists exactly the four files of the Files: list. This
   compares the committed branch against the base, so a pin moved in a commit is caught. The
   job `full` (`ci.yml:99-123`) is covered by acceptance run A.

Completion evidence (acceptance):

A. Pinned notify. In the implementation checkout, `bash e2e/compose-e2e.sh` exits `0` and ends
   with `==> All checks passed` (printed by `step` at `e2e/compose-e2e.sh:680`). The log holds the `ok:` line of item 6 with the suffix `1`.
   The expected suffix `1` comes from notify `v0.1.0` `src/detector.ts:102-104` (counter `n`,
   and the update is the second entry, `n = 1`), not from the E2E.
B. Notify from `main`. Record the notify `main` SHA. Build it:
   `docker build -t pulse-notify:e2e-<sha> <notify checkout at sha>`. In a throwaway copy of
   the deploy branch, replace only the notify `image:` value in `common/services.yaml:35` with
   `pulse-notify:e2e-<sha>`; leave every other pin. Before the run, show that Compose selects
   it: `COMPOSE_FILE=full/compose.yaml:e2e/compose.e2e.yaml docker compose config --images`
   lists `pulse-notify:e2e-<sha>`. Run `bash e2e/compose-e2e.sh` in that copy: it exits `0`
   and ends with `==> All checks passed`. The `ok:` line shows a suffix of exactly 32 characters
   of `[0-9a-f]`. That shape comes from notify `main` `src/detector.ts:107-113`
   (`.digest("hex").slice(0, 32)`), a separate source from the E2E. A notify `0.1.0` can not
   write such a key, so the line also proves that the `main` image ran. Delete the copy after
   the run; nothing of it is committed.
C. In the pull request, list the notify SHA, the image ID of `pulse-notify:e2e-<sha>`, the two
   `ok:` key lines, and the results of checks 1-5. If run B fails at a step other than the
   manual-incident update checks, hold with `needs-input` and name the step (see "Risks").
