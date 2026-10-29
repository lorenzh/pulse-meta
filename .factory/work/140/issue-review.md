# Issue review #140: fix errors in the new docs

## Verdict
Specifiable. Docs-only change across six targets (api, probe, status, notify, contract, meta). No question blocks the spec.

## Observations from the clones
- Meta README (item 15) already says `docker compose restart api` then `restart probe` (README.md l.58). Item 15 is mostly a check. The only leftover found: `PULSE_PROBE_TOKEN=<token> npm start` (README.md l.121) is the unquoted form of item 4; the spec should include it.
- Targets with no listed item but affected: config target is untouched.

## Open points (non-blocking)
1. Item 4 scope: "README, install, development, Docker examples" of pulse-probe, plus the same snippet in the meta README. The plan should grep every repo for `=<token>` style placeholders (including api/status/notify docs) and quote them consistently.
2. Item 3: the rotation must restart the API (`docker compose restart api`) after the old token is removed. Confirm against `.repos/api` whether the probe needs a restart too (it needs the new token), and state the order.
3. Item 7: the correct statement is at-least-once delivery, receivers deduplicate by key. The plan must read `src/delivery.ts` for the key's name and format so the docs name it correctly. Search all notify docs and README for "at most once" and "unexpected duplicate".
4. Item 8: Docker config for notify uses `/data/incidents.jsonl`. Check the volume mount path in `compose/` of meta, and keep README local-run config (`./incidents.jsonl`) for non-Docker use.
5. Item 14: contract README should move type details, routes, retries and locations to `docs/index.md`. The README should keep a short summary and link. Make sure nothing is lost (diff content before deleting) and that links stay valid.
6. Item 6/13: check exact wording in code (`N days left`, newest ten resolved incidents) before editing.
7. Item 10: also verify whether any other error class name in docs (not only `ConfigError:`) is wrong.
8. Items 1–8 require running the documented commands. Docker or a sandbox may not be available. Where it is not, the plan should record which check was done by code reading only. This is an assumption: reading the code is sufficient where a run is impossible.
9. Each target gets its own child issue and PR. No dependency between targets (`dependsOn` empty). The meta change can be independent too.
10. Meta README `Closes` linkage: the fan-out creates children per target in `targets.json`; the spec must list `api`, `probe`, `status`, `notify`, `contract` and `meta` if the meta README needs a change (item 4 leftover).

## Assumptions
- The docs follow the code in every disagreement; no code is changed.
- "Should fix" items 9–15 are in scope, same as "Must fix".

## Derived acceptance check
- In each target's docs, a grep finds none of: `docker compose up -d` as a reload step, "a single up or degraded result resolves", unquoted `PULSE_PROBE_TOKEN=<token>`, `ConfigError:`, "at-most-once", "does not get the incidents", `./incidents.jsonl` in a Docker config.
- The corrected statements for items 1–15 are present and match the cited source files.
- The diff of every target contains only documentation files (`*.md`), and the contract README links to `docs/index.md` for the moved details.
