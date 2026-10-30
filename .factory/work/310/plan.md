# Spec #310: Config parsers on zod in api, notify and status

Step S5 of the shared-code plan in #166.

## Goal
The hand-written config checkers of api (checks file, tokens file), notify (channels config) and status (theme) are replaced by zod schemas. `z.strictObject` rejects unknown keys where rejection exists today; `issue.path` produces path-named errors.

## Scope
- api: `src/config.ts`, `src/tokens.ts` (plus `start.ts` only if error wiring needs it).
- notify: `src/config.ts`.
- status: `src/theme-config.ts`.
- Each repo adds `zod` `4.6.7` (exact pin, same as contract) to `dependencies` and updates its lockfile.

## Non-goals
- No new config features, no env var name change, no change for valid configs (including `Config` / `Theme` types and `public/theme-default.json`).
- No contract change (contract schemas are non-strict, lack defaults/secret, use epoch-ms maintenance, helpers private; api and notify/status pin different contract commits). Reuse exported contract schemas only where they fit unchanged; otherwise define bounds locally with a comment naming the contract counterpart.
- No change to `kit`, `probe`, `contract`, `config`.

## Required behavior (decisions)
1. **status unknown keys**: stay ignored (documented in `docs/theming.md`, tested). Use `z.object` (strip) there, not `strictObject`. `strictObject` is applied only where rejection exists today (api, notify).
2. **Messages**: keep current text where practical via per-field custom `error` messages and a shared local helper that formats `issue.path` (e.g. `checks[1].port`, `channels[0].smtp.port`, `light.bg`). Take the first issue only, in the order of today's checks where tests observe it. Errors are a single line (no `prettifyError`), never echo input values (tokens, heartbeat secrets, channel secrets; never print `issue.input`).
3. **Cross-field rules stay in code** (`superRefine`/post-parse): retries worst-case vs `intervalMs`, duplicate check ids, `maintenance.checkId` reference, end after start, duplicate/placeholder tokens, notify routing to known channels, file/env secret exclusivity.
4. **notify secrets**: zod validates the raw config shape; env/file secret resolution stays a separate step with current messages.
5. **Preserved details**: tls `host` rules, ISO-with-offset regex + real-calendar check, `type` default http, `ParsedChecks` secrets kept apart from served checks, defaults (tls port 443, warnDays 14, grace 0).
6. **Changed messages**: each repo's section lists every message that changes; the implementer records them in that repo's docs and tests. Any message not listed stays identical.
7. Error exit: api `ConfigError`/`TokensError` -> `StartupError` -> exit code 2, one line. notify and status reach `StartupError` as one line.

## Risks
- zod reports all issues; first-issue selection may reorder errors versus today. Mitigated by keeping existing rejected-case tests green.
- Message text drift: mitigated by listing changes and docs updates.
- `compose-e2e` in api builds notify/status from `main`, hence the order.

## Acceptance evidence
- `package.json` of api, notify, status lists `zod` `4.6.7`; parsers use zod schemas.
- `npm test`, lint and typecheck pass in each repo; all prior rejected-case tests pass; every example file and docs example loads unchanged.
- New tests cover the path format and unknown-key rejection with path (api, notify), and status unknown keys still ignored.
- Changed messages listed in the repo docs.
- api: bad checks file and bad tokens file exit 2 with one line; no secret in any message. `compose-e2e` green.

## Repository: notify
Files: `package.json`, lockfile, `src/config.ts`, tests, docs of the channels config.
- Parse all channel types, routing, reminders, SMTP options with zod `strictObject` schemas; unknown keys rejected as `<path>: unknown key "x"` style with path (keep current wording where practical).
- Secrets via env/file resolve in a separate step with current messages.
- Routing/known-channel and secret exclusivity checks stay in code.
- Tests: every earlier rejected case, the path format (`channels[0].smtp.port`), unknown keys, all example/doc configs load.
- Done: checks green, changed messages in docs.

## Repository: status
Files: `package.json`, lockfile, `src/theme-config.ts`, tests, `docs/theming.md`.
- `parseThemeFile` uses a zod schema (`z.object`, unknown keys stripped); font and color rules from #256 unchanged; error stays `theme file <file>: <path>: invalid value` style, single line, e.g. `light.bg`.
- Tests: prior rejected cases, unknown keys still ignored, path format, default theme and docs examples load.
- Done: checks green, docs updated where messages change.

## Repository: api
Files: `package.json`, lockfile, `src/config.ts`, `src/tokens.ts`, tests, docs.
- Checks file (checks, maintenance windows, heartbeat secrets) and tokens file parse via zod; #277 bounds and #163 token rules unchanged; no token/secret value in any message.
- Unknown keys rejected with path via `strictObject`.
- `ConfigError`/`TokensError` still map to `StartupError`, exit 2, one line.
- Tests: all prior rejected cases, path format (`checks[1].port`), unknown keys, `checks.example.json` and `tokens.example.json` load, docs examples load.
- Done: checks green, changed messages in docs, `compose-e2e` green after notify and status are merged.
