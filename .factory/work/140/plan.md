# Spec #140: Fix errors in the new docs found by review

## Goal
Make the docs from #132 match the code. Where code and docs disagree, the docs change.

## Scope
Markdown docs and READMEs in `api`, `probe`, `status`, `notify`, `contract` and the meta README (item 4 leftover, item 15).

## Non-goals
No code, config, workflow or test changes in any repository.

## Required behavior (rules for all repositories)
- Verify every changed statement against the cited source file in the clone (`.repos/<target>`). For items 1–8 run the documented command or reproduction where the sandbox allows (Docker may be missing); otherwise record "checked by code reading" in the PR description.
- Item 4 applies everywhere: grep the repo's docs for `=<token>`-style placeholders (also api, status, notify) and quote them, e.g. `PULSE_PROBE_TOKEN='<token>'`, with a sentence that the placeholder must be replaced by the real token.
- The diff contains only `*.md` files.

## Risks
- Changed prose may leave stale duplicates elsewhere in the docs: grep for the old wording in README and `docs/`.
- Moving contract README content must not lose information or break links.

## Acceptance evidence
In each repo's docs a grep finds none of: `docker compose up -d` as a reload step, "a single up or degraded result resolves", unquoted `PULSE_PROBE_TOKEN=<token>`, `ConfigError:`, "at-most-once", "does not get the incidents", `./incidents.jsonl` in a Docker config. The corrected statements are present and match the source. `git diff --name-only` lists only `.md` files.

## Repository: api
Files: `docs/install.md`, `docs/operation.md`, `docs/concepts.md`, `docs/rest-api.md`, `docs/troubleshooting.md`, README if it repeats these.
- Item 1: reload changed checks with `docker compose restart api`, then `docker compose restart probe`; say the API reads checks only at startup (`src/main.ts`) and `up -d` does not recreate it. Also fix the same text in the README if present.
- Item 2: incident resolution follows the combined quorum evaluation (`src/service.ts`), not a single `up`/`degraded` result. Include the example: two locations down open an incident, a third reporting `up` during maintenance leaves it open.
- Item 9: `GET /checks` is ordered by database rowid, not file order.
- Item 10: checks-file errors print `Error:`, not `ConfigError:` (troubleshooting, operation). Check other error names in docs against the code.
- Item 4: quote token placeholders if any occur.
Completion: reproductions of 1, 2 (service tests or a local run) and 10 documented in the PR.

## Repository: probe
Files: `README.md`, `docs/install.md`, `docs/development.md`, `docs/operation.md`, `docs/configuration.md`.
- Item 3: the token rotation must restart the API after the old token is removed (API reads tokens only at startup), then restart the probe with the new token; state the order. Confirm the old token gets 401 after the restart.
- Item 4: quote `PULSE_PROBE_TOKEN='<token>'` in README, install, development and Docker examples, and say it must be replaced.
- Item 11: TLS servername is set only for host names, not IP addresses (`src/check.ts`).
- Item 12: tests do use real time (50 ms timeouts in `check.test.ts`, `tls.test.ts`); fix the claim in `docs/development.md`.
Completion: copied command no longer fails with `No such file or directory`.

## Repository: status
Files: `docs/troubleshooting.md`, `docs/operation.md`.
- Item 5: under 502, document that the proxy itself returns 502 when the API cannot be reached (`src/server.ts`), and the page then shows `returned HTTP 502`; so `returned HTTP <status>` does not always mean the API answered with an error.
- Item 13: only the newest ten resolved incidents are shown; certificate text is `N days left` (verify exact strings in code).
Completion: reproduce 502 with an unreachable API URL.

## Repository: notify
Files: `README.md`, `docs/operation.md`, `docs/channels.md`, `docs/troubleshooting.md`.
- Item 6: a re-added channel does receive the incidents from the time it was removed, because the ledger keeps the channel and only unknown IDs are seeded (`src/notifier.ts`).
- Item 7: delivery is at-least-once; retries (`src/delivery.ts`) can deliver twice; receivers deduplicate by the key (read its exact name and format in `src/delivery.ts`). Remove "at-most-once" and "unexpected duplicates" wording everywhere.
- Item 8: add a Docker config using `/data/incidents.jsonl` (only `/data` is writable); keep `./incidents.jsonl` for non-Docker use. Check the path against the meta Compose `compose/notify.json`.
Completion: EACCES reproduction and fixed Docker config noted in the PR.

## Repository: contract
Files: `README.md`, `docs/index.md`.
- Item 14: move type details, routes, retries and locations from the README to `docs/index.md` (first diff, so nothing is lost). README keeps a short summary and links to `docs/index.md`; links stay valid.

## Meta repository (not a child issue)
Item 15 and the item 4 leftover (`PULSE_PROBE_TOKEN=<token> npm start`, README.md l.121) are in meta only. The Compose cleanup in README l.58 already matches the corrected api docs. Since meta gets no child issue, a person applies the one-line README quoting fix after merge, or opens a follow-up issue.
