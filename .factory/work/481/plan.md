# Spec #481: probe token from `PULSE_PROBE_TOKEN_FILE`, docs on the network reach of checks

Checked against `main` of pulse-probe (`9674e51`) and pulse-kit (`6a06ec2`). Issue review: `.factory/work/481/issue-review.md`.

## Goal

The probe can read its token from a file (Docker and Kubernetes secrets), so the token does not have to sit in the environment. Operators learn from the docs what HTTP, TCP and DNS checks can reach from the probe's network and how to limit that.

## Scope

- `pulse-probe` only: token reading in `src/token.ts` and `src/settings.ts`, wiring in `src/main.ts`, tests, docs, README, `.gitignore`.
- Decision (open point 1 of the review): **no kit target**. The reader is one file read plus trim, no other service needs it now, and pulse-api keeps its own token-file code. A kit helper would add a kit PR and a pin bump for one function. If a second service later needs it, it moves to kit then (AGENTS.md: keep a helper beside its only caller).

## Non-goals

- No deny list for private, loopback or metadata addresses. No change to check types, check reasons or the contract.
- No `_FILE` variant for any other setting.
- No change to how `PULSE_PROBE_TOKEN` itself is parsed (still trimmed, still required when it is the chosen source).
- No reload of the token at run time: it is read once at start.

## Current behavior (verified)

- `src/token.ts` `parseToken(raw)` trims `PULSE_PROBE_TOKEN` and throws `Error("PULSE_PROBE_TOKEN is missing or empty")` when blank.
- `src/settings.ts` `loadSettings(env)` calls it once and turns any non-`StartupError` into a `StartupError` (first line only). kit `runService` prints `pulse-probe: <message>` to stderr and exits 2.
- `src/main.test.ts` spawns `src/main.ts` with a clean env (`PATH` plus test vars) and checks exit 2, one line, the variable name and no `tok-secret`.
- kit has no file reader (`grep -rn readSecretFile .repos/kit/src` finds nothing).
- Bun loads `.env`, `.env.<NODE_ENV>` and `.env.local` from the working directory unless disabled; real environment variables win. `bunfig.toml` does not disable it. The image ships no `.env` (`.dockerignore` has `.env*`); `.gitignore` lists only `node_modules/`.
- The image runs as the non-root `bun` user (uid 1000) in `/app`.

## Required behavior

### Token source

1. A variable counts as **set** when it is present and not blank after trim (same rule as kit `readString`). `PULSE_PROBE_TOKEN=` (empty) counts as unset.
2. Read `PULSE_PROBE_TOKEN` (trimmed) and `PULSE_PROBE_TOKEN_FILE` (trimmed path) first, **before any file read**:
   - both set: `StartupError("set only one of PULSE_PROBE_TOKEN and PULSE_PROBE_TOKEN_FILE")`. The file is not read.
   - neither set: `StartupError("PULSE_PROBE_TOKEN or PULSE_PROBE_TOKEN_FILE must be set")`.
   - only `PULSE_PROBE_TOKEN`: the trimmed value is the token (as today). The file reader is never called.
   - only `PULSE_PROBE_TOKEN_FILE`: read the file once, synchronously, as UTF-8.
3. File rules (`<path>` is the trimmed value of `PULSE_PROBE_TOKEN_FILE`, as given; relative paths resolve against the working directory):
   - read fails: `PULSE_PROBE_TOKEN_FILE=<path>: cannot read (<CODE>)`, where `<CODE>` is the error's `code` when it is a string matching `^E[A-Z0-9]+$` (`ENOENT`, `EACCES`, `EISDIR`, …), else the text `cannot read` alone: `PULSE_PROBE_TOKEN_FILE=<path>: cannot read`. Never the raw error message, never content.
   - content blank after trim: `PULSE_PROBE_TOKEN_FILE=<path>: file is empty`.
   - trimmed content still holds a CR or LF: `PULSE_PROBE_TOKEN_FILE=<path>: must hold one line`. (A line break in the token would make an invalid `Authorization` header later; a trailing newline is removed by the trim and is fine.)
   - otherwise the trimmed content is the token.
   - No size cap.
4. All these errors are `StartupError` from `@lorenzh/pulse-kit`, so `loadSettings` stays the one place that throws at start, and `runService` prints exactly one line `pulse-probe: <message>` and exits 2. The old text `PULSE_PROBE_TOKEN is missing or empty` is gone.
5. Design: the file read is I/O, so it is injected. `src/token.ts` exports `readProbeToken(env: Env, readFile: (path: string) => string): string` (replaces `parseToken`). `loadSettings(env: Env, readFile: (path: string) => string): Settings` passes it through. Only `src/main.ts` wires the real reader: `(path) => readFileSync(path, "utf8")` from `node:fs`, called as `loadSettings(process.env, readTokenFile)`. `Settings.token` stays a `string`.
6. The token is never in any log, error or metric (unchanged rule). Nothing else changes in start order: token errors still come before the health listener and before any API call.

### Docs (pulse-probe)

- `docs/configuration.md`
  - Env table: new row `PULSE_PROBE_TOKEN_FILE` (default unset; path to a file whose trimmed content is the token; exactly one of the two token variables). The `PULSE_PROBE_TOKEN` row says "required unless `PULSE_PROBE_TOKEN_FILE` is set".
  - "Probe token" section: the two sources, the blank-is-unset rule, all five messages from Required behavior 2–3, read once at start (restart after changing the file), the file needs to be readable by the probe user (uid 1000 in the image).
  - "Migration" section: a line that the startup message for a missing token changed from `PULSE_PROBE_TOKEN is missing or empty` to `PULSE_PROBE_TOKEN or PULSE_PROBE_TOKEN_FILE must be set` (log matchers must follow). Exit code 2 is unchanged.
  - New top-level section `## Network reach of checks` (anchor `#network-reach-of-checks`), after `## Checks`:
    - HTTP, TCP and DNS checks run from the probe's host and network. The probe connects to whatever the check names: public hosts, RFC 1918 ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), loopback (`127.0.0.0/8`, `::1`), link-local (`169.254.0.0/16` including the cloud metadata address `169.254.169.254`, `fe80::/10`) and unique local IPv6 (`fc00::/7`). DNS checks can query any `resolver` address. In the container, loopback is the container itself, but the container network and the host's reachable networks still apply.
    - TCP reasons tell `connection refused` from `timeout`, HTTP checks report status codes, so whoever can edit checks (the API checks file, or the admin config routes of pulse-api, #380) can use probes to scan ports and services in the probe's network. Treat check editors as trusted with the probe's network reach.
    - There is no deny list in code. Guidance: run probes in a network without access to internal services they do not monitor; restrict egress with firewall rules (block `169.254.169.254` and internal ranges unless needed); use one dedicated probe (location) per internal zone you want to monitor; keep the admin tokens and the checks file to the people who may do this.
- `docs/install.md`
  - Bun section: subsection on `.env` auto-load (L6): Bun reads `.env`, `.env.<NODE_ENV>` and `.env.local` from the working directory when running from source (`bun run start`); real environment variables win; a `.env` with `PULSE_PROBE_TOKEN` plus an exported `PULSE_PROBE_TOKEN_FILE` stops the start with the "set only one" message; keep `.env` out of git (now in `.gitignore`). The image ships no `.env` (excluded by `.dockerignore`), but a file mounted into `/app` would be loaded too. The implementer checks the exact file list against Bun 1.4.0 docs and writes what Bun does.
  - Docker section: subsection "Token from a file (Compose secrets)" with this example (names may change only if `docker compose config` still passes):

    ```yaml
    services:
      probe:
        image: pulse-probe:local
        environment:
          PULSE_API_URL: http://api:3000
          PULSE_LOCATION: default
          PULSE_PROBE_TOKEN_FILE: /run/secrets/probe_token
        secrets:
          - probe_token
    secrets:
      probe_token:
        file: ./probe-token.txt
    ```

    Plus: create the file with `openssl rand -hex 32 > probe-token.txt`; Compose (not Swarm) bind-mounts it with the host owner and mode and ignores `uid`/`gid`/`mode`, so it must be readable by uid 1000 (for example `chmod 0444`, or `chown 1000 probe-token.txt && chmod 0400 probe-token.txt`); otherwise exit 2 with `cannot read (EACCES)`. Do not set `PULSE_PROBE_TOKEN` as well. One line for `docker run`: `-v "$PWD/probe-token.txt:/run/secrets/probe_token:ro" -e PULSE_PROBE_TOKEN_FILE=/run/secrets/probe_token`. Kubernetes: a Secret mounted as a volume, path in `PULSE_PROBE_TOKEN_FILE`.
  - The line "Without a token the container exits at startup" names both variables.
- `docs/troubleshooting.md`: replace the `PULSE_PROBE_TOKEN is missing or empty` entry with entries for the "must be set", "set only one", "cannot read (<CODE>)", "file is empty" and "must hold one line" messages, with cause and action (the "set only one" cause names a `.env` file as a likely source).
- `docs/operation.md`: "Changing the token or location" and token rotation cover the file: replace the file content, then restart the probe (the file is read only at start).
- `docs/development.md`: `src/token.ts` description: reads the token from `PULSE_PROBE_TOKEN` or `PULSE_PROBE_TOKEN_FILE`.
- `docs/index.md`: the configuration bullet mentions the token file and network reach.
- `README.md`: direct links to `docs/configuration.md#probe-token` (token, including the `_FILE` variant), `docs/install.md` Compose secrets subsection, and `docs/configuration.md#network-reach-of-checks`. Optionally a quick-start note that `PULSE_PROBE_TOKEN_FILE` can replace `PULSE_PROBE_TOKEN`.
- `.gitignore`: add `.env` and `.env.*` (hygiene for L6).

## Risks

- **Message change.** Operators matching `PULSE_PROBE_TOKEN is missing or empty` in logs must update; the Migration note says so. Exit code is unchanged.
- **`.env` collisions.** A forgotten `.env` with `PULSE_PROBE_TOKEN` makes a file-based setup fail with "set only one". This is deliberate (no silent precedence); docs explain it.
- **Compose secret permissions.** A host file with mode 0600 owned by another uid gives `EACCES` in the container. Docs say so.
- **Fs error codes.** Bun may report some read errors without a `code`; then the message ends in `cannot read`, which is still one line without content.
- **Docker in the build environment.** If `docker compose` is not available where the PR is built, the PR says so plainly and does not claim a pass.

## Performance impact

None expected: one synchronous read of a small file at start, and only when `PULSE_PROBE_TOKEN_FILE` is set. The probe metrics of `bench/budgets.json` in pulse-api (`startup_cpu_ms`, `startup_wall_ms`, `idle_rss_mib`, `peak_rss_mib`, `load_cpu_s`, `test_cpu_s`, `image_mb`) do not move beyond noise; `test_cpu_s` may grow by a few subprocess spawns (well under 0.1 s of CPU each). No A/B run required; if `test_cpu_s` nears its budget, the implementer reports `bun test` CPU before and after.

## Security impact

Security impact: yes
It reads a secret from a file at a trust boundary (env and file content) and writes error texts that carry external data (path, fs code).

Checklist items that apply:
- **Secrets in errors, logs and responses:** no message ever holds the token or file content; "both"/"neither" are decided before any read; read errors carry only the path and an `E…` code, never the raw error message. A sentinel test proves no output holds the token.
- **Input validation:** blank-is-unset for both variables; empty file, unreadable file and multi-line content are rejected at start with exit 2.
- **Atomic, path-safe writes:** not applicable (read only; the probe writes no file). The path is operator-chosen and read as-is; no path is built from check data.
- Not applicable: auth order and status codes, body and size limits, accessor execution, SSRF and redirects (docs only, no code change), dependency pins (no dependency change), Dockerfile, CI.

## Rollout order

One repository: only pulse-probe changes. No contract, kit or config pin changes, and the API sees the same `Authorization: Bearer <token>` header. Existing deployments with `PULSE_PROBE_TOKEN` keep working unchanged (only the "missing token" message text changes).

## Counterexamples

| Input | Must give | A wrong implementation would |
| --- | --- | --- |
| `PULSE_PROBE_TOKEN=tok`, `PULSE_PROBE_TOKEN_FILE=/x` (file exists, holds `other`) | exit 2, `pulse-probe: set only one of PULSE_PROBE_TOKEN and PULSE_PROBE_TOKEN_FILE`; file reader not called | prefer one source silently, or read the file first |
| neither set (also `PULSE_PROBE_TOKEN="  "` and `PULSE_PROBE_TOKEN_FILE=""`) | exit 2, `pulse-probe: PULSE_PROBE_TOKEN or PULSE_PROBE_TOKEN_FILE must be set` | treat the empty `_FILE` as a path and report `cannot read` |
| `PULSE_PROBE_TOKEN=""`, `PULSE_PROBE_TOKEN_FILE=/run/secrets/t` (holds `tok`) | token `tok` | report "both set" |
| file holds `"  tok-sentinel-481\n"` | token `tok-sentinel-481`; API receives `Authorization: Bearer tok-sentinel-481` | send the untrimmed content |
| file holds `""` or `" \n\t\n"` | exit 2, `PULSE_PROBE_TOKEN_FILE=<path>: file is empty` | accept an empty token |
| file holds `"tok\nsecond"` | exit 2, `PULSE_PROBE_TOKEN_FILE=<path>: must hold one line`; neither `tok` nor `second` printed | use the first line, or print the content |
| path does not exist | exit 2, `PULSE_PROBE_TOKEN_FILE=<path>: cannot read (ENOENT)` | print a stack or the raw fs message |
| path is a directory | exit 2, `... cannot read (EISDIR)` | crash with exit 1 |
| any of the above with the token `tok-sentinel-481` in env or file | the string `tok-sentinel-481` is in neither stdout nor stderr | echo the value in a message |

## Contract fields

New name: the environment variable `PULSE_PROBE_TOKEN_FILE` (probe only; no contract type, route or field). Searches that show no collision (both exit 1, no match):

```sh
grep -rn 'PULSE_PROBE_TOKEN_FILE' .repos/contract/src .repos/config .repos/kit/src .repos/probe/src .repos/probe/docs   # no match
grep -rn 'readSecretFile' .repos/kit/src .repos/contract/src                                                           # no match (no kit helper added)
```

New exported function `readProbeToken` in probe `src/token.ts` replaces `parseToken` (probe-internal). Doc anchor `#network-reach-of-checks` is new in probe `docs/configuration.md`.

## Repository: probe

Files:
- `src/token.ts` (change: `readProbeToken(env, readFile)` replaces `parseToken`)
- `src/token.test.ts` (change)
- `src/settings.ts` (change: `loadSettings(env, readFile)`)
- `src/settings.test.ts` (change: pass a fake reader; new token-source cases)
- `src/main.ts` (change: wire `readFileSync(path, "utf8")`)
- `src/main.test.ts` (change: subprocess regression tests)
- `docs/configuration.md`, `docs/install.md`, `docs/troubleshooting.md`, `docs/operation.md`, `docs/development.md`, `docs/index.md`, `README.md` (change)
- `.gitignore` (change: `.env`, `.env.*`)

Behavior: as in "Required behavior" above. Follow AGENTS.md: the reader is injected, only `main.ts` touches `node:fs`; errors are kit `StartupError`; no `any`, no `!`; cognitive complexity ≤ 15 (split the env decision and the file check into two small functions if needed).

Tests (each new one written first and shown red on current `main`):
- `src/token.test.ts` with a fake reader: env token trimmed and reader not called; file token trimmed; both → "set only one" and reader not called; neither (absent, blank, empty `_FILE`) → "must be set"; blank env plus file → file used; empty and whitespace-only file → "file is empty" with path; multi-line → "must hold one line"; reader throws an error with `code: "ENOENT"` → `cannot read (ENOENT)`; reader throws an error without `code` (message holding `tok-sentinel-481`) → `cannot read`, and the sentinel is not in the message. Every message is checked not to contain the sentinel.
- `src/settings.test.ts`: existing table updated for the new message; `loadSettings` throws `StartupError` with one line for both/neither/empty file.
- `src/main.test.ts` (subprocess, clean env, files in an own `mkdtemp` directory removed in `after`):
  1. only `PULSE_PROBE_TOKEN_FILE` → file with `"  tok-sentinel-481\n"`, fake API on `127.0.0.1:0`: the API receives `Authorization: Bearer tok-sentinel-481` on `GET /probe/checks`; stop with SIGTERM, exit 0.
  2. both set → exit 2, one stderr line matching `^pulse-probe: ` and containing `PULSE_PROBE_TOKEN` and `PULSE_PROBE_TOKEN_FILE`.
  3. neither set → exit 2, one line naming both variables.
  4. empty file → exit 2, one line with the path; missing file → exit 2, one line with the path and `ENOENT`.
  5. In every case `tok-sentinel-481` is not in stdout or stderr.
  The existing `["PULSE_PROBE_TOKEN", {}]` row still passes (the new message names the variable).

Checks:
- `bun run check` (lint, typecheck, tests, coverage ≥ 80 %).
- `bun run start` once with `PULSE_PROBE_TOKEN_FILE` pointing at a temp file and once with both variables; report command and result.
- The Compose example from `docs/install.md` copied into a temp `compose.yaml` with a dummy `probe-token.txt`, then `docker compose config`; output in the PR (or a plain statement that docker is not available). No compose file is committed.

Completion evidence (in the PR):
- Mutation output: the new tests run against `main`'s `src/token.ts`, `src/settings.ts` and `src/main.ts` (for example `git stash` of the source changes, or `git checkout main -- src/token.ts src/settings.ts src/main.ts`, then `bun test src/token.test.ts src/settings.test.ts src/main.test.ts`) fail; with the change they pass.
- `docker compose config` output for the docs example.
- README links to `docs/configuration.md#probe-token`, the Compose secrets subsection of `docs/install.md` and `docs/configuration.md#network-reach-of-checks` resolve.
- CI green.
