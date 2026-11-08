# Spec #862: probe validates `PULSE_LOCATION` before using it in HTTP headers

## Goal

The probe puts its location into the `User-Agent` header of every HTTP check request
(`pulse-probe (<location>)`). It accepts some locations that this header cannot carry. With such a
location the probe starts, and then every HTTP check reports `down`. TCP checks, and probes with a
valid location, stay `up` (audit finding security-probe-2026-11-04-1, P2). After this change the
probe refuses such a location at startup: exit 2, one line that names `PULSE_LOCATION` and does not
include the value. Every location that works today keeps working, with the same identity.

The audit trigger value is not public and this spec does not name it. The tests use synthetic inputs
from the character classes defined below.

## Evidence (probe `main` at `9490141ef9e92044808c70bb8200db3d497d1060`)

- `src/location.ts:5-12` `parseLocation`: trims, maps unset, empty or blank to `default`, rejects
  more than 64 UTF-16 code units (`PULSE_LOCATION is longer than 64 characters`), and accepts
  everything else. It has no character check.
- `src/location.ts:14-16` `userAgent` returns `` `pulse-probe (${location})` `` without escaping.
- `src/check.ts:502` sends `"user-agent": userAgent(deps.location)` on every HTTP hop.
  `src/check.ts:125,154` copy `deps.location` into the result. `src/check-tcp.ts` sends no HTTP
  header, so TCP checks are not affected. This is why only HTTP checks fail.
- `src/settings.ts:72` calls `parseLocation` in `loadSettings`. `src/settings.ts:91-95` wraps
  any non-`StartupError` as a one-line `StartupError` (first line of the message).
- `src/main.ts:241-243` `start()` calls `loadSettings` first, before the health listener
  (`startHealth`), the check fetch and the scheduler. `src/main.ts:273` runs `start` through kit's
  `runService`. At the pinned kit SHA `739188a87a177c0e8b5a8938e3f54c2bdaf19df4`
  (`package.json` `dependencies`), `src/run-service.ts:102-104` writes `<prefix>: <message>` to
  stderr and calls `exit(2)` for a `StartupError`. Read with
  `gh api "repos/lorenzh/pulse-kit/contents/src/run-service.ts?ref=739188a…"`.
- Existing tests: `src/location.test.ts` (defaults, trim, case, 64/65, user agent);
  `src/settings.test.ts:55-72` (one `StartupError` line per bad setting, the 65-character
  location among them); `src/main.test.ts:70-106` (child-process startup failures: exit 2, one
  stderr line, no token, zero API calls); `src/check.test.ts:96-112` (local HTTP server gets
  `pulse-probe (eu)`, result location `eu`, status not asserted).
- The issue review (`.factory/work/862/issue-review.md`) ran experiments on Bun 1.4.0. Characters
  above U+00FF fail header construction and fetch. Embedded CR or LF fail too. Some other C0
  controls pass `Headers` but get HTTP 400 from a local peer. Printable ASCII, an internal space,
  an internal horizontal tab and Latin-1 (U+0080 to U+00FF) samples complete HTTP 200 and arrive
  unchanged.
- The contract's header value rule (`contract/src/schema.ts:120`,
  `HEADER_VALUE = /^[\x20-\x7e\x80-\xff]*$/`) excludes the tab. That rule is the contract's policy
  for configured check headers. Reusing it here would reject locations with an internal tab, which
  work today. So the probe gets its own rule; the contract stays unchanged.
- No shared findings: `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/862`
  answered HTTP 404.

## Scope

- probe only: `src/location.ts` (the rule), tests, and docs (`docs/configuration.md`,
  `docs/troubleshooting.md`, `README.md`).

## Non-goals

- No change to the API's token location rule (`api/src/tokens.ts:38-44`: non-empty, 64 after trim),
  to the contract result schema or wire version, or to console or deploy snippets that write a
  `PULSE_LOCATION`.
- No change to check scheduling, retries, authentication, quorum, kit or contract pins, or
  dependencies.
- No escaping, encoding, lowercasing, replacing or truncating of a location. An invalid location
  is refused, not repaired.
- No change to other startup messages, and no change to the `running … from location <location>`
  info log for an accepted location.

## Required behavior

Rule for `PULSE_LOCATION` (applied by `parseLocation`, in this order):

1. Trim with `String.prototype.trim` as today. Unset, empty or blank means `default`.
2. More than 64 UTF-16 code units: the existing error `PULSE_LOCATION is longer than 64 characters`,
   unchanged.
3. Every UTF-16 code unit of the trimmed value must be U+0009 (tab), U+0020 to U+007E (space and
   visible ASCII) or U+0080 to U+00FF (Latin-1, the HTTP `obs-text` range). Anything else fails.
   That means U+0000 to U+0008, U+000A to U+001F, U+007F, and every code unit above U+00FF
   (including surrogate halves, so every character outside the Basic Multilingual Plane).
   The error text is exactly:
   `PULSE_LOCATION must hold only tab, space, visible ASCII or Latin-1 (U+0080 to U+00FF) characters`
   It never contains the raw or trimmed value, a part of it, the generated header, a runtime
   exception text, or a token.
4. An accepted value is returned unchanged (same string as before this change). `userAgent` stays
   `pulse-probe (<location>)`, and the result's `location` stays that string.

Startup: an invalid value makes `loadSettings` throw a `StartupError` with the message above (one
line). The process prints exactly one line `pulse-probe: <message>` to stderr, nothing to stdout,
and exits 2 before it binds the health listener, fetches checks, runs a check or posts a result.
This holds for every probe, also for one that has only TCP, DNS, TLS or domain checks. The existing
order in `start()` already gives this. Do not add a second exit path.

## Risks

- A probe that runs today with a now-refused location (only possible for a probe without working
  HTTP checks) stops starting after the upgrade. Mitigation: a migration note in
  `docs/configuration.md#migration` and a troubleshooting entry. The operator renames the location
  in the probe and in the API token.
- A too-strict rule would break working names (internal tab, punctuation, Latin-1). The
  compatibility tests below pin these.
- A too-loose rule would keep the bug. The tests use one input per refused class.
- Test titles and logs are public: they must name the class ("a C0 control", "a code unit above
  U+00FF"), not show the value.
- The NUL character cannot go through a process environment. Test it only through `parseLocation`
  and `loadSettings`, not with a child process.

## Acceptance evidence

1. `bun test src/location.test.ts src/settings.test.ts`: the refused and accepted cases of
   `## Counterexamples` pass. The expected values are the literals written in the tests (the
   error text above, the returned strings).
2. `bun test src/main.test.ts`: a child probe with an invalid location exits with code 2 (literal),
   writes exactly one stderr line matching `^pulse-probe: PULSE_LOCATION must hold only `, writes
   nothing to stdout, and makes 0 (literal) requests to the fake API. A child probe with an accepted
   Latin-1 location posts a result with `status` `up` and that location. The check target receives
   the literal `User-Agent` written in the test.
3. `bun test src/check.test.ts`: an accepted location, parsed with `parseLocation`, runs a real
   HTTP check against a local server on `127.0.0.1:0`. The result has `status: "up"`,
   `statusCode: 200` and the literal location. The server receives the literal user agent.
4. Red before green: tests 1 to 3 for refused inputs fail on the current `main` (the parser accepts
   them). The implementer reports that run.
5. `bun run check` passes. A manual `bun run start` with a refused location exits 2 with the one
   line, and with `PULSE_LOCATION=default` it starts as before.

## Performance impact

None expected: the change adds one character check of at most 64 code units, once at startup. It
does not touch the request path, memory or the image. No metric of `api/bench/budgets.json` moves
(`startup_cpu_ms`, `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`, `test_cpu_s` for the probe;
`startup_wall_ms`, `image_mb` reported). The bench probe uses `PULSE_LOCATION: real`
(`api/bench/compose.bench.yaml:39`), which stays accepted. No A/B run is needed.

## Security impact

Security impact: yes. The change adds input validation at the environment trust boundary for a value
that goes into a probe HTTP request header, and adds a startup error text.

Checklist items that apply:
- Input validation: the exact allowed code unit set, checked after trim and after the length check;
  no partial acceptance, no repair.
- Secrets in errors, logs and responses: the new error is a fixed text. It never carries the location
  value, the generated `User-Agent`, a runtime exception text or the token. The tests check stdout
  and stderr for a sentinel token and a sentinel fragment of the refused location.
- Probe HTTP client headers: header injection (CR, LF) and non-ByteString values can no longer reach
  `fetch`, because the probe refuses them before any check runs.

Not affected: authentication order and status codes, body and size limits, SSRF and redirects, file
writes, dependency pins.

## Rollout order

One repository: only probe changes. The API, contract and other services are unchanged, and the
location reaches the API as the same string as before for every accepted name. An older probe keeps
its current behavior until the operator upgrades it. Before the upgrade, an operator whose location
is refused renames it in the probe and in the API token (documented in the migration note).

## Counterexamples

Location rule (`parseLocation`, through `loadSettings` for the error type):

| Input (JavaScript string literal in the test) | Wrong implementation would | Expected |
| --- | --- | --- |
| `"euĀwest"` (code unit above U+00FF, inside) | accept (current `main`) | refused, exact error text |
| `"eu\u{1F600}"` (outside the BMP: two surrogate halves) | accept, or count one character | refused |
| `"eu\uD800"` (lone surrogate) | accept | refused |
| `"eu\u0001west"` (C0 control, inside) | accept: `Headers` takes it, the peer answers 400 | refused |
| `"eu\nwest"`, `"eu\rwest"` (line break, inside) | accept | refused |
| `"eu\u007fwest"` (DEL) | accept, a range check that ends at U+00FF but starts at U+0020 | refused |
| `"eu\u0000west"` (NUL, parser and settings only) | accept | refused |
| `"Ā".repeat(65)` (too long and invalid) | report the character error | the length error `PULSE_LOCATION is longer than 64 characters` (length is checked first) |
| `" euĀ "` | trim away the problem | refused: the invalid unit is inside the trimmed value |
| `"\teu\n"` (tab and LF at the ends) | refuse | accepted as `"eu"`: trim removes them first |
| `undefined`, `""`, `"   "` | refuse | `"default"` |
| `"  Eu-West "` | lowercase or keep spaces | `"Eu-West"` |
| `"x".repeat(64)` / `"x".repeat(65)` | off by one | accepted / length error |
| `"ÿ".repeat(64)` (64 Latin-1 units, 128 UTF-8 bytes) | count bytes | accepted |
| `"eu\twest"` (internal tab) | refuse (contract header rule) | accepted unchanged |
| `"Zürich 1"` (U+00FC, internal space) | refuse (ASCII-only rule) | accepted unchanged |
| `"<R&D> \"x\" (eu)"` (punctuation, quotes, parentheses; deploy uses `<R&D> "x"` in `deploy/e2e/snippet.test.sh:47`) | refuse (slug rule) | accepted unchanged |

Error text: for every refused input, the message equals the literal error text and contains neither
the input nor a sentinel fragment of it (for example `west`), and has no newline.

Startup (child process): a refused location must give exit 2, one stderr line, empty stdout, 0 API
requests. A wrong implementation that validates when the first HTTP check runs would make an API
request first and fail this test. One that logs the value would fail the sentinel check.

## Contract fields

No new names. The change adds no environment variable, result field, route or contract key; it
tightens the existing `PULSE_LOCATION`. Search that the variable already exists only in the probe
and is not a contract or config name:
`grep -rn 'PULSE_LOCATION' .repos/contract/src .repos/config` gives no match;
`grep -rln 'PULSE_LOCATION' .repos/probe/src --include=*.ts` gives `src/location.ts`,
`src/settings.ts`, `src/client.ts` (the existing token-rejected log text) and their tests. The new
error text adds no name.

## Repository: probe

Files:
- `src/location.ts`
- `src/location.test.ts`
- `src/settings.test.ts`
- `src/check.test.ts`
- `src/main.test.ts`
- `docs/configuration.md`
- `docs/troubleshooting.md`
- `README.md`

Behavior change: yes. The probe now refuses at startup a location that its HTTP check header cannot carry.

Tool facts (verified):
- Bun 1.4.0: `package.json` `packageManager` and `engines` (lines 8-11). `bun:test` runs the
  tests; `bunfig.toml:1-4` turns on coverage with an 80 % line threshold.
- `bun run check` = `bun run lint && bun run typecheck && bun run test` (`package.json` scripts);
  `lint` = `biome check . && pulse-eslint . && pulse-workflows`.
- Biome 2.6.3 (`package.json` devDependencies). `biome.json` extends
  `@lorenzh/pulse-config/biome.json`. At the pinned config SHA
  `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`package.json` devDependencies,
  `.github/workflows/ci.yml` `uses:`), `biome.json:10-17` includes `**` except `dist`,
  `node_modules`, `bun.lock`, `*.html`, `test/fixtures`. The pinned file is the same as the config
  clone on `main`.
- CI: `.github/workflows/ci.yml` job `check` uses
  `lorenzh/pulse-config/.github/workflows/check.yml@04108fa…`. At that SHA, `check.yml:22-38` sets
  up Bun 1.4.0 and runs `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck` and
  `bun run test`. The build steps run only with input `build`, which defaults to `false`
  (`check.yml:5-9`) and which probe does not set. The pinned file is the same as the clone.

Behavior:
- `src/location.ts`: add the character rule of `## Required behavior` step 3 after the length check,
  with the exact error text. Keep `DEFAULT_LOCATION`, `MAX_LOCATION_LENGTH`, the trim, the length
  message and `userAgent` unchanged. Throw a `StartupError` from `@lorenzh/pulse-kit` or a plain
  `Error` that `loadSettings` wraps (both end as the same one-line `StartupError`). Add a one-line
  comment that the rule is the set of code units that fetch can send in the `User-Agent` field
  value. Do not import the contract's header rule (it refuses the tab).
- No change to `src/settings.ts`, `src/main.ts`, `src/check.ts` or the scheduler. If the
  implementer finds a need, it says why in the pull request.

Tests (write them first and show they fail on `main` for the refused inputs):
- `src/location.test.ts`: every row of `## Counterexamples` (refused and accepted), with the
  literal expected strings and the literal error text. Test titles name the class, not the value.
- `src/settings.test.ts`: `loadSettings` with a refused location (one non-ASCII case above U+00FF,
  one C0 control, NUL) and `PULSE_PROBE_TOKEN: "tok-secret"` throws a `StartupError` whose
  message equals the literal error text: it names `PULSE_LOCATION`, has no newline, no
  `tok-secret` and no fragment of the input. The existing 65-character case stays.
- `src/check.test.ts`: extend or add next to "result carries the location and the request the user
  agent". Pass `parseLocation(" Zürich 1 ")` and `parseLocation("Eu-West")` as `deps.location`
  to `runCheck` against a server on `127.0.0.1:0`. Assert `status === "up"`,
  `statusCode === 200`, `location === "Zürich 1"` (or `"Eu-West"`), and the server received
  `user-agent` equal to the literal `"pulse-probe (Zürich 1)"` (or `"pulse-probe (Eu-West)"`).
  Node's HTTP server decodes header bytes as Latin-1, so U+00FC arrives as `ü`.
- `src/main.test.ts`, refused location: with the existing `run` and `fakeApi` helpers, start the
  probe with `PULSE_PROBE_TOKEN` set to the file's `SENTINEL`, `PULSE_API_URL` set to a fake API
  that counts requests, and `PULSE_LOCATION` set to a refused value that a process environment can
  carry (for example `"zqĀmarker"` and `"zq\u0001marker"`). Assert exit code 2, exactly one
  stderr line matching `^pulse-probe: PULSE_LOCATION must hold only `, empty stdout, 0 API
  requests, and neither stream contains `SENTINEL` or `marker`. The `until` helper and the exit
  promise bound the wait; servers close in `after`.
- `src/main.test.ts`, accepted location: start the probe with `PULSE_LOCATION=" Zürich 1 "`, a
  fake API that serves one HTTP check to a local target (as the existing test at
  `src/main.test.ts:122` does), and record the `POST /results` body. Assert the parsed result has
  `status` `"up"` and `location` `"Zürich 1"`, and the target got `user-agent`
  `"pulse-probe (Zürich 1)"`. Stop the child with SIGTERM and expect exit 0.

Docs:
- `docs/configuration.md`: in the variable table, `PULSE_LOCATION` says "trimmed, case-sensitive,
  at most 64 characters, only tab, space, visible ASCII or Latin-1". In `## Location`, list the
  accepted code units (U+0009, U+0020 to U+007E, U+0080 to U+00FF), say that trim runs first and the
  length check before the character check, give the exact error text and exit 2, and say why
  (the location goes into the `User-Agent` header of every HTTP check). Add a note to the last
  `## Migration` section: a location with other characters now stops the start with that message
  and exit 2; before, the probe started and every HTTP check was `down`. Rename the location in the
  probe and in the API token.
- `docs/troubleshooting.md`: a new entry with the error text as heading, cause and action, next to
  the `PULSE_LOCATION is longer than 64 characters` entry.
- `README.md`: one sentence that `PULSE_LOCATION` accepts only tab, space, visible ASCII or Latin-1
  and links `docs/configuration.md#location`.

Completion evidence:
- The red run on `main` of the new refused-input tests (failing because the input is accepted).
- `bun test src/location.test.ts src/settings.test.ts src/check.test.ts src/main.test.ts` passes.
- `bun run check` passes (lint, typecheck, tests with the 80 % line coverage threshold).
- Manual: `PULSE_PROBE_TOKEN=x PULSE_LOCATION="$(printf 'a\001b')" bun run start` prints
  `pulse-probe: PULSE_LOCATION must hold only tab, space, visible ASCII or Latin-1 (U+0080 to U+00FF) characters`
  and `echo $?` gives `2`. `PULSE_LOCATION=default` starts as before. The pull request reports the
  commands and results.
- The diff touches only the files listed above.
