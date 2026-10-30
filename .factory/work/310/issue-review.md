# Issue review: #310 Config parsers on zod in api, notify and status

Verdict: specifiable. No blocking question. Open points and assumptions below.

## Current state (read from the clones)
- `zod` is only a dependency of `contract` (`4.6.7`, exact pin). `api`, `notify`, `status` do not list it. Contract does not re-export zod or any helper. Each service needs `zod: 4.6.7` in its own `package.json` and lockfile.
- api `src/config.ts` (checks, heartbeat secrets, maintenance, bounds from #277) and `src/tokens.ts` (#163 rules) are hand-written. They throw `ConfigError` / `TokensError`; `start.ts` turns them into `StartupError` (`isConfigFailure`).
- notify `src/config.ts` (~500 lines) has per-channel parsers, with `unknown key ... in ...` errors in the form `<path>: unknown key "x" in <where>`. Secrets are read via env/file through a `SecretSource`, and the errors are `channel "<id>": ...`.
- status `src/theme-config.ts`: `parseThemeFile` throws `theme file <file>: <key>: invalid value`. It **keeps only known keys and ignores unknown ones**. `docs/theming.md` documents "unknown keys are ignored", and a test covers it.
- Contract schemas (`httpCheckSchema`, `tlsCheckSchema`, `heartbeatCheckSchema`, `maintenanceWindowSchema`) are non-strict `z.object`, and have different semantics than the config file.

## Open points (to settle in the plan)
1. **Status unknown keys contradict "No behavior change".** The goal says `z.strictObject` for unknown-key rejection, but the status theme ignores unknown keys by contract, in docs and tests. Assumption: status keeps ignoring unknown keys (`z.object` strip), and strict rejection applies only where it exists today (api checks/maintenance, notify). The plan states this explicitly.
2. **Contract schema reuse is only partial.**
   - Contract check schemas require `tls.port`, `tls.warnDays` and `grace`. The config file has defaults for them (443, 14, 0), plus `retries` and `retryDelayMs`.
   - Contract has no `secret` field and its `maintenanceWindowSchema` uses epoch ms, while the file uses ISO strings with offset.
   - The file's tls check requires `intervalMs`, while the contract's served check does as well, so this one matches.
   - Assumption: reuse contract field-level schemas only if contract exports them. They are currently private (`intBetween`, `timerMs`, `nonEmpty`). Otherwise the api builds file schemas with `.extend`/`.partial` from the exported check schemas, or defines the bounds locally with a comment. Check `contract/src/index.ts` exports. If contract must export new pieces, that is a **contract change** (a new target and an extra child, which must come first). The issue lists no contract work, so the default is no contract change.
3. **Different pinned contract commits.** api uses `c98a2d4`, notify and status use `cc8c1fa`. The plan must not rely on schema exports that exist only in one of them.
4. **Error message text.** The path format changes: notify now uses `channel "<id>": key ...`, while zod gives `channels[2].url`. The plan keeps the current text where practical (custom `error` per field, a helper that formats `issue.path` as `checks[0].port`) and lists every changed message. Docs and tests are updated per repo. Messages must not contain secrets or tokens (api tokens and heartbeat secrets: never echo input values; zod's default messages and `issue.input` must not be printed).
5. **Cross-field and cross-item rules stay in code (`superRefine`/after-parse).** These are: retries worst-case vs `intervalMs`, duplicate check ids, `maintenance.checkId` referencing a check, end after start, duplicate tokens, example/placeholder token rejection, and notify routing to known channels and the file/env secret exclusivity. First-error-only reporting must match today's order of checks (zod reports all issues; take the first one, and keep the order of today's checks, where it is observable in tests).
6. **notify secrets** are read from the environment or from files, so zod validates the raw config shape, and secret resolution (file read, trimming newlines) stays a separate step with its current messages.
7. **Behavior details to preserve.** The tls `host` rules, ISO-with-offset regex plus real-calendar check, `type` defaulting to http (and `type: "http"` echoing), and the `ParsedChecks` secrets map being kept apart from served checks.
8. **Errors exit path.** api: `ConfigError`/`TokensError` → `StartupError` → exit 2, one line. Zod messages must be a single line (join issues, no multi-line `prettifyError`). notify and status already go through `StartupError`; confirm the status theme error reaches it as one line.
9. **Order** (from the issue): notify and status first, api last, because `compose-e2e` builds the others from `main`. Link api as blocked by notify and status through `targets.json` `dependsOn`. notify and status are independent of each other.
10. Bundle/size or startup effects of adding zod to the three services: assumption is negligible (Docker images install production deps; zod is added to `dependencies`, not dev).

## Assumptions
- No new config features, no env var name changes, no change to valid-config results (including `Config` and `Theme` types and the default theme file `public/theme-default.json`).
- All example files and docs examples (api `checks.example.json`, `tokens.example.json`, notify docs, status theme docs) load unchanged. The existing tests load them.
- The existing rejected-case tests stay green without edits, except where the plan documents a changed message and the test changes with it.
- Each target's `AGENTS.md` conventions (lint, coverage) apply; the plan should not touch `kit` or `probe`.

## Derived acceptance check
1. In each of api, notify and status, `package.json` lists `zod` `4.6.7` (same as contract), and the config parsers use zod schemas (no hand-written object/unknown-key/range checkers remain except documented cross-field rules).
2. `npm test` (and lint/typecheck) passes in each repo: all prior rejected-case tests pass, every example file loads, and the new tests cover the path-named error format (e.g. `checks[1].port`, `channels[0].smtp.port`, `light.bg`) and unknown-key rejection with path in api and notify.
3. Messages that changed are listed in the plan and in the docs of that repo; unchanged ones are identical.
4. api exits with code 2 and one line through `StartupError` for a bad checks file and a bad tokens file; no token or secret value appears in any message.
5. `compose-e2e` is green in api after notify and status are merged.
