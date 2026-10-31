# Issue review: #481 probe token from `PULSE_PROBE_TOKEN_FILE`, docs on the network reach of checks

Reviewed against `main` of pulse-probe (`9674e51`) and pulse-kit (`6a06ec2`). No earlier decisions in the issue comments.

## Current behavior (verified)

- `src/token.ts`: `parseToken(raw)` trims `PULSE_PROBE_TOKEN`. When it is missing or blank it throws a plain `Error("PULSE_PROBE_TOKEN is missing or empty")`.
- `src/settings.ts` `loadSettings(env)` calls `parseToken(env.PULSE_PROBE_TOKEN)` once at start. It wraps any non-`StartupError` into a `StartupError` (first line only).
- kit `runService` prints `pulse-probe: <message>` to stderr and exits 2 on a `StartupError`. `src/main.test.ts` already spawns `src/main.ts` with a clean env (`PATH` plus the test vars) and checks for exit 2, one line, the variable name and no `tok-secret`. The new subprocess tests can follow that pattern.
- pulse-kit has no file or secret reader. Its exports are `readString`, `readMs`, `readPort`, `readUrl`, `readEnum`, `readBool`, `readLogLevel` and the `Env` type. `readString` treats blank as unset. pulse-api reads its own token files (`PULSE_TOKENS_FILE`, `PULSE_API_ADMIN_TOKENS_FILE`) with local code, not with kit.
- The probe pins kit by commit (`github:lorenzh/pulse-kit#fa79ba8…`). A kit helper would need a kit PR merged first and then a pin bump in probe.
- Docs that name the token today: `docs/configuration.md` (env table, "Probe token" section, which quotes the message `PULSE_PROBE_TOKEN is missing or empty`), `docs/install.md` (source and `docker run` examples), `docs/troubleshooting.md` (heading is the old message), `docs/operation.md` (token rotation, exit codes), `docs/development.md` (`src/token.ts` description), `README.md` (it links only `docs/index.md`).
- The image runs `bun src/main.ts` as the non-root `bun` user in `WORKDIR /app` with `NODE_ENV=production`. `.dockerignore` excludes `.env*`. `.gitignore` lists only `node_modules/` and not `.env`.
- Bun loads `.env`, `.env.<NODE_ENV>` and `.env.local` from the working directory by default. This happens both from source and in the container, but the image ships no `.env`. `bunfig.toml` does not turn this off. Real environment variables win over `.env` values.
- TCP check reasons (`docs/configuration.md` "TCP checks") are `connection refused (ECONNREFUSED)`, `host not found (ENOTFOUND)`, another error code, or `timeout after <n>ms`. They tell refused from timed out, as the issue says. Nothing in `docs/` covers private ranges, loopback or metadata addresses.

## Open points (none block the spec)

1. **Kit or not.** The issue lets the plan decide. Recommendation: probe only. A one-file read plus trim is small, and no other service needs it yet; pulse-api has its own readers. A kit target would add a cross-repo dependency (kit PR, then a probe pin bump) for one function. If the plan picks kit, `targets.json` needs `kit` with `probe` `dependsOn: ["kit"]`, and kit's helper must never put the file content in its error.
2. **Blank counts as unset.** Compose and Kubernetes often set an empty variable. Assumption: a blank or whitespace-only `PULSE_PROBE_TOKEN` or `PULSE_PROBE_TOKEN_FILE` counts as unset (same rule as kit `readString`). So `PULSE_PROBE_TOKEN=` with `PULSE_PROBE_TOKEN_FILE=/run/secrets/x` uses the file and is not "both".
3. **Message texts.** The plan must fix the exact one-line messages (all start with `pulse-probe: `), for example:
   - neither: `PULSE_PROBE_TOKEN or PULSE_PROBE_TOKEN_FILE must be set`
   - both: `set only one of PULSE_PROBE_TOKEN and PULSE_PROBE_TOKEN_FILE`
   - unreadable: `PULSE_PROBE_TOKEN_FILE=<path>: cannot read: <reason>`, where the reason is the error code or system message (`ENOENT`, `EACCES`, `EISDIR`)
   - empty: `PULSE_PROBE_TOKEN_FILE=<path>: file is empty`

   The old text `PULSE_PROBE_TOKEN is missing or empty` goes away. `docs/troubleshooting.md` (heading and action), `docs/configuration.md` and the existing `main.test.ts`/`token.test.ts` assertions must follow. This changes a log line, so give it a short changelog or breaking note in the docs, as earlier changes did.
4. **When both are set, do not read the file.** The check for "both" or "neither" runs before any read, so the message can never hold file content. A file error message holds only the path and the fs reason, never content. Do not echo a raw fs error that could include data.
5. **Content rules.** Assumption: trim the whole content (handles the trailing newline that Kubernetes and Compose secrets usually carry). Internal whitespace or line breaks are not validated, same as the env variable today. Optional for the plan: reject a CR or LF inside the trimmed content with exit 2 (`must be a single line`), because it would make an invalid `Authorization` header later. No size cap is required; the plan may add a small one, for example 4 KiB.
6. **Read once at start.** Read synchronously inside `loadSettings` or a helper it calls, so `loadSettings` stays the single place that throws `StartupError`. Keep `loadSettings` testable: inject the file reader, or test the file path through the subprocess test with a temp file.
7. **`.env` interaction.** If a `.env` in the working directory sets `PULSE_PROBE_TOKEN` while the operator sets `PULSE_PROBE_TOKEN_FILE`, the probe exits 2 ("both"). The `.env` docs (L6) should say this. Adding `.env` to `.gitignore` is not asked for; the plan may include it as a one-line hygiene change or leave it out.
8. **Compose secrets and the non-root user.** Compose file-based secrets (not Swarm) are bind-mounted at `/run/secrets/<name>` with the host file's owner and mode, and long-syntax `uid/gid/mode` is ignored outside Swarm. The image runs as `bun` (uid 1000), so the host file must be readable by that uid; otherwise the probe exits 2 with `EACCES`. The docs example should say this.
9. **Where the docs go.** "Network reach of checks": assumption is a new section in `docs/configuration.md` (next to the check types), linked from `README.md` and `docs/index.md`. The `_FILE` variant goes in the env table and the "Probe token" section of `docs/configuration.md`, and in `docs/install.md` with the Compose `secrets:` example. "Linked from the README" means a direct link to each new section, not only to `docs/index.md`. Also update the operation docs (token rotation: replace the file content, then restart) and `docs/development.md` if `token.ts` changes.
10. **Proof that the Compose example works.** The acceptance asks for `docker compose config` output in the PR. The implementer must put the docs example in a temp `compose.yaml` (with a dummy secret file) and run `docker compose config`. If docker is not available in the build environment, the PR must say so plainly instead of claiming a pass. No compose file has to be committed to the repo.
11. **Network reach section content.** Per the issue: HTTP, TCP and DNS checks run from the probe's network; they can reach RFC 1918 ranges, loopback, link-local including `169.254.169.254` and IPv6 equivalents (`::1`, `fc00::/7`, `fe80::/10`). TCP reasons tell refused from timeout, so anyone who can edit checks (API checks file, or the admin API from #380) can scan ports. Guidance: an isolated network, egress firewall rules, one dedicated probe per internal zone. Also: treat check editors as trusted with the probe's network reach. The section must say plainly that there is no deny list in code.
12. **Mutation evidence.** Each new regression test must fail on the current code. The PR shows this, for example by running the new tests against `main`'s `src/token.ts`/`settings.ts`.

## Assumptions

- Target: `probe` only (see point 1), unless the plan decides kit is worth it.
- No `_FILE` variants for other settings, no deny list, no change to check types or reasons (non-goals).
- Exit code 2 and the one-line `pulse-probe: <message>` format come unchanged from kit `runService`.
- The `docker run` example may also show `PULSE_PROBE_TOKEN_FILE` with a read-only mounted file, but the issue requires only the Compose example.

## Derived acceptance check

In pulse-probe, `bun run check` passes, and subprocess tests of `src/main.ts` (clean env, sentinel token such as `tok-sentinel-481`) show:
1. Only `PULSE_PROBE_TOKEN_FILE` set to a temp file holding `"  tok-sentinel-481\n"`: the probe starts and sends `Authorization: Bearer tok-sentinel-481` (trimmed) to a stub API.
2. Both variables set: exit 2, one stderr line naming `PULSE_PROBE_TOKEN` and `PULSE_PROBE_TOKEN_FILE`.
3. Neither set: exit 2, one line naming both variables.
4. Empty or whitespace-only file: exit 2, one line with the path. A missing file: exit 2, one line with the path and the reason.
5. In every case the sentinel never appears in stdout or stderr.

Each test fails on current `main`, and the PR shows that. `docs/configuration.md` and `docs/install.md` document `PULSE_PROBE_TOKEN_FILE` with a Compose `secrets:` example (the PR shows `docker compose config` passing on it) and the Bun `.env` auto-load. A "Network reach of checks" section exists. `README.md` links both directly. CI is green.
