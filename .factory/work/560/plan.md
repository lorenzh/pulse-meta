# Spec #560: fix docs drift across api, probe, notify, contract, kit, status

## Goal

Make the operator and agent documentation of api, probe, notify, contract and kit match the code on
`main` again, and add six missing operator warnings. Only Markdown files change. The child PRs record
the evidence: for each item, the source file and symbol that the new text was checked against.

## Baseline

Every claim below was checked against these `main` commits. Paths are relative to the repository
(clones under `.repos/<target>/`). If `main` has moved when a child starts, the implementer checks the
cited source again and states the commit it used in the PR.

| Target   | Commit                                     |
| -------- | ------------------------------------------ |
| api      | `2d4a6b23d532e66ad30840a778ac21ab465647dc` |
| probe    | `89f12324a6e77d5a716beacc22e178b8e1112284` |
| notify   | `3f120cc0efcf80fd68c5974dd603b9b4d1ae000c` |
| contract | `7ce23aaf3fa3e038f65ecfed755188b83bde143f` |
| kit      | `0f79e934a0b8d0f78e06c8ffe94206f464ff88f9` |
| status   | `d268b5b1b0afcf9bc94ce508934ddd879bb90df0` |

## Scope

- api: `docs/operation.md`, `docs/configuration.md`, `docs/install.md`, `docs/rest-api.md`,
  `docs/concepts.md`, `docs/troubleshooting.md`.
- probe: `docs/operation.md`, `docs/configuration.md`, `docs/troubleshooting.md`.
- notify: `docs/channels.md`, `docs/operation.md`, `docs/troubleshooting.md`.
- contract: `AGENTS.md`.
- kit: `AGENTS.md`.
- status: no change. The reported broken list is not present on `main` (see the finding ledger).
- The closely related contradictions that the issue review found in the same subjects (restart-only
  advice after hot reload, file-token rotation by API restart, "read routes are public") are in scope,
  because leaving them would contradict the corrected text in the same file.

## Non-goals

- No change to code, tests, `package.json`, lockfiles, `dist/`, CI, Dockerfiles, Compose files or
  labels. No new tests for wording. No dependency or pin bump.
- No change of behavior to make the docs true: retry rules, token scopes, host binding, the WAL
  mode, the metric and the route set stay as they are.
- No new server-side access control for the heartbeat route; the exposure advice is deployment
  guidance only.
- No rename of an existing heading in api (`Token rotation`, `Changing checks`,
  `Backup and restore`, `Admin tokens and header secrets`, `Admin config routes`, `Manual incidents`,
  `GET /locations`, `Tokens`, `Audit log`, `Scopes`): probe and other repositories link to these anchors.
- Historical audits and specs in meta keep their old wording.

## Finding ledger

Each row is one item of the issue. "Status on main" is the result of this plan's check.

| # | Item | Status on main | Source checked |
| - | ---- | -------------- | -------------- |
| F1 | api `docs/operation.md` WAL and resend text (now line 21) | Still wrong: "probes re-send buffered results and `POST /results` is idempotent, so lost results are mostly sent again". A probe forgets a result once the API answered `204`, so a committed result lost by the database is never re-sent. | api `src/db.ts:setJournal` (WAL, `synchronous = NORMAL`; stays `FULL` without WAL), `src/db.ts:withDurableCommit` (EXTRA for audit); probe `src/buffer.ts` (`submit` drops on `204`, `close()` loses the queue); api `src/service.ts` `ON CONFLICT (check_id, location, timestamp) DO NOTHING`; SQLite `PRAGMA synchronous` docs (https://sqlite.org/pragma.html#pragma_synchronous): WAL + NORMAL survives an application crash, may lose the last commits after power loss or an OS crash. |
| F2 | api `docs/configuration.md:94` "cleared at the next start" | Still wrong. The clearing and deactivation run in `upsertChecks` at start and at every successfully applied reload (`SIGHUP`, poll look, admin write). | api `src/service.ts:upsertChecks` (deactivate all, clear request options, resolve incidents of inactive checks); `src/start.ts:257` (start) and `src/start.ts:289-296` (`createConfigReloader` `onApply` calls `upsertChecks`). |
| F3 | api `docs/install.md:139` "reads them at start only" | Already gone: the file has 54 lines, the phrase is absent, line 47 explains directory mounts for hot reload. A negative grep must stay at exit 1. The file still changes for warning W3. | api `docs/install.md` at the baseline; `src/config-reload.ts`, `src/token-import.ts`. |
| F4 | api `docs/rest-api.md:7-25` overview omits `/locations`, `/manual-incidents`, `/admin/*` | Still incomplete. Token and audit rows exist; `/locations`, manual-incident reads and writes, and `/admin/config`, `/admin/checks`, `/admin/components`, `/admin/maintenance` are missing. Line 36 "Read routes have no authentication" is wrong for `GET /probe/checks` and `GET /admin/*`. | api `src/server.ts:197-213` (`HEARTBEAT_PATH`, `ADMIN_ROUTE`, `ROUTES`), `src/server.ts:604-710` dispatch, `src/token-routes.ts`, `src/audit-routes.ts`, `src/token-scopes.ts:canUse`. |
| F5 | probe `docs/operation.md:32` contradicts `:25` (now 35 vs 27) | Still wrong: "A restart loses nothing except the results that were dropped" against "On a restart or a stop the whole buffer is lost". | probe `src/buffer.ts` (in-memory queue; `close()` logs `shutting down: <n> buffered result(s) lost` and returns the count). |
| F6 | notify `docs/channels.md:120` key format (now 123, also 16, 38) | Still wrong as a universal statement. Automatic opened/resolved keys are `<incidentId>:<event>`; reminders `<incidentId>:reminder:<n>`; manual `manual:<id>:opened`, `manual:<id>:resolved`, `manual:<id>:update:<32 hex>`. `docs/troubleshooting.md:73` repeats the wrong form. | notify `src/detector.ts:17-22` (`eventKey`, reminder key), `src/detector.ts:100,112` (manual keys), `src/channels/webhook.ts` (`idempotency-key` is `notification.key`). |
| F7 | contract `AGENTS.md:26` "plain-TS validators" | Still wrong; line 105 of the same file says Zod. | contract `src/schema.ts` (Zod schemas, `httpUrl`), `src/validate.ts`, `package.json:39` (`"zod": "4.6.7"`). |
| F8 | kit `AGENTS.md:105` "Planned modules" | Still wrong: `docs/index.md` is the reference of exported modules that exist. | kit `src/index.ts`, `src/*.ts` (17 modules), `package.json` `exports` (root, `./format-duration`, `./escape`, `./is-record`), `docs/index.md` "Exports". |
| F9 | status `docs/operation.md:75` broken list | Not reproducible. The section "Latency and availability" (lines 63-78) renders as one `<ul>` with seven `<li>`; the layout table is inside the first item. The whole file has no `<pre>` block and no paragraph starting with a list marker. No status change. | `gh api markdown -f mode=gfm` over lines 63-78 and over the whole file at `d268b5b`, run by this plan. Chart statements match `src/render.ts:renderLatencyChart` and `src/component-latency.ts`. |

Related contradictions in the same subjects (in scope):

| # | File | Stale text | Source |
| - | ---- | ---------- | ------ |
| R1 | api `docs/operation.md:7`, `:11-15` | "After a change to the checks file, restart only the API." and the paragraph "Use `restart`, not `docker compose up -d` ... (`src/main.ts` reads the file once)". | `src/start.ts:289-310` (reload by poll and `SIGHUP`); `src/main.ts` does not read the checks file. |
| R2 | api `docs/configuration.md:214` | "Windows are read at start only." | `src/start.ts:244` (`maintenance: () => holder.get().maintenance`), `src/start.ts:296` (`holder.set(next)`). |
| R3 | api `docs/troubleshooting.md:139` | "the API reads the file at start only" | as R1. |
| R4 | api `docs/concepts.md:63` | "Read routes (`GET`) are public." | `src/server.ts:604` (`/admin/*`), `:692` (`/probe/checks` needs a probe token). |
| R5 | probe `docs/operation.md:39`, `docs/troubleshooting.md:72`, `:90-91` | "The API reads its checks file at startup ... restart the API only"; "After a checks change, restart only the API"; "restart the API, then wait one reload interval". | api `src/start.ts:289-310`; probe `PULSE_CHECKS_RELOAD_MS` reload (`docs/configuration.md` "Checks reload"). |
| R6 | probe `docs/operation.md:45-51` | Token rotation by "adds the new token and restarts the API" and "The API reads its tokens only at startup". | api `src/token-import.ts` (one-time import), `src/token-routes.ts` (`POST /admin/tokens/:id/rotate`, 10-minute overlap); api `docs/operation.md#token-rotation`. |
| R7 | probe `docs/troubleshooting.md:43` | "compare both values with the API's tokens file" | api tokens are in the database after import; `GET /admin/tokens` lists `location` (`TokenMetadata`). |
| R8 | probe `docs/configuration.md:75` | "It fetches the checks once at startup" (omits the reload). | probe `docs/configuration.md` "Checks reload"; `PULSE_CHECKS_RELOAD_MS`. |

## Warnings to add

| # | Warning | Where | Required content | Source |
| - | ------- | ----- | ---------------- | ------ |
| W1 | A token that can write checks reaches every header secret | api `docs/operation.md` "Admin tokens and header secrets" (keep the heading); a one-line link from api `docs/configuration.md` "Secrets" note | Name the exact authority: a token with `admin` and `checks` can point a check that uses `{ "env": NAME }` at another URL; the probe sends the secret to that URL only when `PULSE_PROBE_HEADER_HOSTS` binds `NAME` to that host. So the token is as sensitive as every bound secret, and keeping the secret only in the probe environment does not remove that authority. A probe token reads literal header values and bodies from `GET /probe/checks`. Do not claim that the API returns probe environment values, or that a secret goes to any host. | api `src/token-scopes.ts:canUse` (`config-write` = `admin` and `checks`), probe `src/client.ts:resolveHeaders`, `src/header-hosts.ts:isBound`. |
| W2 | Non-idempotent checks repeat their side effect | probe `docs/configuration.md` "Retries" (exists; add the distinction); api `docs/configuration.md` `retries` and `method` rows | `retries` applies only to HTTP `GET`/`HEAD` (and omitted method), TCP, DNS and domain checks; any other HTTP method gets no retry: one attempt per scheduled run, judged on the configured method before redirects. An attempt is not one request: within one attempt the probe follows redirects hop by hop, and a `307` or `308` keeps the method and body, so a `POST` answered by `307` is sent again to the `Location` (up to 20 redirect hops, so at most 21 requests per attempt). A `301`/`302` turns a `POST` without headers or body into a `GET`; a check with headers or a body follows only same-origin hops and stops on `301`-`303` for a non-`GET`. Each probe location makes its own attempt on every scheduled run, so side effects may repeat across runs, across locations and across followed redirects. The docs must not promise that a run reaches the target: an attempt can end without any request, for example a check with a header denial reports `down` with `attempts: 1` and sends nothing, a run whose signal is already aborted starts no request, and a connection can fail before the target acts. The text must say "one attempt per run", not "one request" or "once per interval". The idempotence of `POST /results` and the at-least-once delivery of notify concern results and notifications, not the checked request. Point the check at a side-effect-free endpoint. | probe `src/check.ts:isRetryable` (lines 196-200), `src/check.ts:161`; attempts without a request: `src/check.ts:111-127` (`headerDenial`, `attempts: 1`, no request), `:158-159` (already-aborted run starts no request); redirects: `src/check.ts:410` (`MAX_REDIRECTS = 20`), `:462-485` (`fetchFollowing` loop, one request per hop), `:527-539` (`secretHop`), `:543-549` (`openHop`), `src/check.redirect.test.ts:112-124` ("307 same-origin keeps method and body": two `POST`s in one run). |
| W3 | Publish only `/heartbeat/*` | api `docs/install.md` (new section "Network exposure") and a link from api `docs/rest-api.md` general rules | Keep the API on a private network. If jobs outside it must ping, publish only `GET`/`POST` on `/heartbeat/<id>` and `/heartbeat/<id>/<secret>` through a TLS reverse proxy that matches the normalized path. Keep `/admin/*`, `/manual-incidents` writes, `/probe/checks`, `/results`, the public reads and `/healthz`, `/readyz`, `/metrics` off that ingress. The status page serves the public data through its own proxy. | api `src/server.ts:197` (`HEARTBEAT_PATH = /^\/heartbeat\/([^/]+)(?:\/([^/]+))?$/`), `:604`, `:611`, `:692`; status `docs/operation.md` "What is public". |
| W4 | A copy on the live volume is not a backup | api `docs/operation.md` "Backup and restore" | `bun run backup` makes a consistent snapshot in the target's directory. A file under `/data` sits on the live volume: losing the volume or the host loses both. Move each copy to storage outside that volume and host (the existing `docker compose cp` step, then off-host), keep more than one, and test a restore. Keep the existing command, the exit codes and the temp-directory text. | api `src/backup.ts:copyLive` (read-only connection, `VACUUM INTO`). |
| W5 | No credentials in check URLs | api `docs/configuration.md` `url` row and "Secrets" note; api `docs/operation.md` "Admin tokens and header secrets" or "Heartbeat checks" neighbourhood | Userinfo is already rejected. A token in the query string or path is accepted and stored, and the URL is served raw by the public `GET /checks` and by `GET /probe/checks` and `GET /admin/config`. The status page strips userinfo, query and fragment, but that does not protect direct API reads. Put credentials in a header with `{ "env": NAME }` bound to the host. Keep the existing heartbeat path-secret warning. | contract `src/schema.ts:35-41` (`httpUrl` rejects userinfo only); api `src/service.ts:741` (`url: r.url ?? ""` in the public check); status `src/api-filter.ts:sanitizeUrl`. |
| W6 | Meaning of `pulse_notify_polls_total` | notify `docs/operation.md` "Health and metrics" paragraph after the table, and one bullet in "Upgrading" | The counter counts the feed reads of a poll: `ok` when all three feeds answered (a `404` on `manual-incidents` counts), `error` when any read failed. It is counted before detection and enqueue, so a poll whose detection then throws stays `ok` here while it still adds 1 to `pulse_notify_consecutive_failed_polls` (as does every `error` poll; a fully successful poll resets it to 0). `/readyz` fails only when that streak reaches `PULSE_NOTIFY_HEALTH_MAX_FAILED_POLLS` (default 5, minimum 1), checked as `failed >= threshold`. At the default threshold, starting from zero failures, one failed poll does not fail readiness; with `PULSE_NOTIFY_HEALTH_MAX_FAILED_POLLS=1` the first failed poll does. The text must not say that one failed poll never fails readiness. An `error` poll still uses the feeds that answered. It says nothing about delivery: use `pulse_notify_deliveries_total` and `pulse_notify_pending_deliveries`. For feed health use `pulse_notify_feed_polls_total`, `pulse_notify_consecutive_failed_polls` and `/readyz`. The upgrade bullet tells operators who alert on `outcome="error"` as "nothing was delivered" that this no longer holds, and names no version number. | notify `src/notifier.ts:330-349` (`#poll`, `pollDone` before `#pollChannel`), `src/notifier.ts:311-318` (`tick`, `#failedPolls`), `src/metrics.ts:24-26`, `src/index.ts:240-246` (readiness: `failed >= healthMaxFailedPolls`), `src/config.ts:402` (`PULSE_NOTIFY_HEALTH_MAX_FAILED_POLLS`, default 5, min 1); meta `.factory/work/454/plan.md` (feeds used independently); meta `audits/security/notify.md` N7. |

## Required behavior

- Every row of the finding ledger with status "Still wrong" or "Still incomplete" and every row
  R1-R8 is corrected in its file, so the stale text is gone and the new text states what the cited
  source does.
- F3 and F9 are recorded in the child PRs (api for F3) and the spec PR (F9) as already satisfied,
  with the evidence above. No edit is made only to produce a diff.
- W1-W6 are present in the named places with the required content.
- Text that is already correct stays (for example api `docs/operation.md` heartbeat secret handling,
  probe `docs/configuration.md` Retries bullets, notify manual-incident key paragraph).
- Operator prose does not carry source citations; the citations go into the PR description.
- Each child PR description has an evidence table with one row per item it touches: item id, file
  and section, old text (or "missing"), new statement, source file and symbol at the commit used.
- No new heading replaces an existing anchor that another document links to. New links and anchors
  resolve.

## Risks

- **Doc assertions in tests.** api `src/docs-claims.test.ts` asserts strings in `docs/operation.md`
  (`bun run backup`, `pulse.db-wal`, `` `synchronous = EXTRA` ``, `uptime_daily`, `PULSE_PROBE_TOKEN`,
  `restore a [backup]`, `The table only grows`, `Delete it while the API is stopped`,
  `Rotate imported tokens once`, the 32-character sentence, `Going back without restoring the backup
  works only to a release with the same`), `docs/configuration.md` (`Both token files are imported once
  and then ignored`, `ignored: tokens are stored in the database`) and `docs/rest-api.md` (token and
  audit routes, `valid for 10 minutes`, NDJSON, `limit`, ordering note). api `src/tokens.test.ts`
  rejects any `Bearer <16+ chars>` or `PULSE_PROBE_TOKEN=<value>` in `docs/*.md` unless it starts with
  `replace-with-`, `$` or `<`. notify `test/config.test.ts:378-404` parses every ` ```json ` block with a
  `channels` key in `README.md`, `docs/` and `docs/channels/`. Edits keep these passing; tests are not
  changed.
- **Cross-repository links.** probe links to api anchors that exist at the baseline
  (`operation.md#token-rotation`, `operation.md#changing-checks`, `rest-api.md#tokens`). The api task
  keeps those headings, so both children can merge in any order.
- **Over-claiming.** The WAL text must not promise recovery by probes; the exposure text must not
  read as a server-side restriction; the poll counter text must not invent a version boundary.
- **Compose restart semantics.** R1 replaces the restart advice. `docker compose restart` does not
  apply a changed Compose `environment:` or `env_file:` (Docker docs,
  https://docs.docker.com/reference/cli/docker/compose/restart/); a recreate (`docker compose up -d api`)
  does. The new text says which one an environment change needs and that a checks file change needs
  neither.

## Acceptance evidence

All negative checks use `rg -n -F -- '<fragment>' <file>` in the named repository at the PR head. The
expected result is exit code 1 (no match), written here as a literal. Exit 2 is a failure of the check,
not a pass. The fragments are literals of this spec, copied from the baseline files.

| Check | Repo | Command | Expected |
| ----- | ---- | ------- | -------- |
| N1 | api | `rg -n -F -- 'so lost results are mostly sent again' docs/operation.md` | exit 1 |
| N2 | api | `rg -n -F -- 'After a change to the checks file, restart only the API' docs/operation.md` | exit 1 |
| N3 | api | `rg -n -F -- 'reads the file once' docs/operation.md` | exit 1 |
| N4 | api | `rg -n -F -- 'cleared at the next start' docs/configuration.md` | exit 1 |
| N5 | api | `rg -n -F -- 'Windows are read at start only' docs/configuration.md` | exit 1 |
| N6 | api | `rg -n -F -- 'reads them at start only' docs/install.md` | exit 1 (already at baseline) |
| N7 | api | `rg -n -F -- 'reads the file at start only' docs/troubleshooting.md` | exit 1 |
| N8 | api | `rg -n -F -- 'Read routes have no authentication' docs/rest-api.md` | exit 1 |
| N9 | api | ``rg -n -F -- 'Read routes (`GET`) are public' docs/concepts.md`` | exit 1 |
| N10 | probe | `rg -n -F -- 'A restart loses nothing except the results that were dropped' docs/operation.md` | exit 1 |
| N11 | probe | `rg -n -i -F -- 'reads its checks file at startup' docs/` | exit 1 |
| N12 | probe | `rg -n -F -- 'reads its tokens only at startup' docs/` | exit 1 |
| N13 | probe | `rg -n -F -- 'adds the new token and restarts the API' docs/operation.md` | exit 1 |
| N14 | probe | `rg -n -i -F -- 'restart only the API' docs/` | exit 1 |
| N15 | probe | `rg -n -F -- "with the API's tokens file" docs/troubleshooting.md` | exit 1 |
| N16 | probe | `rg -n -F -- 'fetches the checks once at startup' docs/configuration.md` | exit 1 |
| N17 | notify | `rg -n -F -- '<incident id>:<event>' docs/` | exit 1 |
| N18 | notify | ``rg -n -F -- '`<incidentId>:<event>`. Unique per channel' docs/channels.md`` | exit 1 |
| N19 | notify | ``rg -n -F -- 'The event key is `<incidentId>:<event>`' docs/channels.md`` | exit 1 |
| N20 | contract | `rg -n -F -- 'plain-TS validators' AGENTS.md` | exit 1 |
| N21 | kit | `rg -n -F -- 'Planned modules' AGENTS.md` | exit 1 |

Positive checks (expected values are literals of this spec):

| Check | Repo | What | Expected |
| ----- | ---- | ---- | -------- |
| P1 | api | The overview table (`awk '/^## Overview/,/^General rules/' docs/rest-api.md`) contains each of these literal paths: `/locations`, `/manual-incidents`, `/manual-incidents/:id`, `/admin/config`, `/admin/checks`, `/admin/components`, `/admin/maintenance`, `/admin/tokens`, `/admin/audit` | each `grep -c -F` ≥ 1 (9 paths) |
| P2 | api | In that table the auth column of `/probe/checks` names the probe token, `/admin/config` names `read` or `checks`, the config writes name `admin` and `checks`, the manual writes name `admin` and `incidents`, `GET /manual-incidents` and `/locations` name none | reviewer reads the 5 rows; matches `src/token-scopes.ts:canUse` |
| P3 | api | `rg -c -F -- '/heartbeat/' docs/install.md` | ≥ 1, in a section that also names `/admin/` and `/metrics` as not published |
| P4 | api | `rg -n -i -- 'synchronous = NORMAL' docs/operation.md` still matches, and the Database paragraph names application crash versus power loss / OS crash separately | match ≥ 1; reviewer reads |
| P5 | api | "Backup and restore" names storage outside the live volume and a restore test | reviewer reads; `rg -c -F 'bun run backup' docs/operation.md` ≥ 1 |
| P6 | api | `docs/configuration.md` `url` row or Secrets note warns against tokens in the query string | `rg -n -i 'query' docs/configuration.md` has a match in the HTTP checks section |
| P7 | probe | `docs/operation.md` State section says buffered results are lost on stop, restart or crash | reviewer reads; consistent with Result buffer bullet |
| P8 | probe | `docs/configuration.md` Retries names that result idempotence and notification delivery do not cover the checked request, and that a `307`/`308` redirect resends a `POST` within one attempt | `awk '/^### Retries/,/^### Schedule/' docs/configuration.md \| grep -c -F -- '307'` ≥ 1 (literal; 0 on current main, line 103 outside the section does not count); reviewer reads |
| P9 | notify | `docs/channels.md` lists all five key forms `<incidentId>:opened`/`resolved`, `<incidentId>:reminder:<n>`, `manual:<id>:opened`, `manual:<id>:update:<d>`, `manual:<id>:resolved` and tells receivers to treat the key as opaque | `rg -c -F 'opaque' docs/channels.md` ≥ 1; reviewer reads |
| P10 | notify | `docs/operation.md` says `pulse_notify_polls_total` is counted before detection and does not count delivery, and that `/readyz` fails only when the failed-poll streak reaches `PULSE_NOTIFY_HEALTH_MAX_FAILED_POLLS` | `rg -c -F 'pulse_notify_deliveries_total' docs/operation.md` ≥ 2 (table row plus the new text); reviewer reads the new W6 paragraph: it ties `/readyz` to the streak threshold (`failed >= threshold`), does not say one failed poll always fails readiness, and says the one-poll case holds only at the default threshold starting from zero failures (the existing line 142 already names the threshold, so no grep proves the new text) |
| P11 | contract | `AGENTS.md` boundary line names Zod schemas | `rg -c -F 'Zod' AGENTS.md` ≥ 2 |
| P12 | kit | `AGENTS.md` line points at `docs/index.md` as the reference of the existing exports | reviewer reads |

Scope and checks, per child PR:

- `git diff --name-only origin/main...HEAD` lists only files ending in `.md`; expected count of other
  files: 0.
- `git diff --check origin/main...HEAD` exits 0.
- `bun run check` passes (it runs the existing doc tests in api and notify).
- For contract and kit, `bun run check` runs `bun run build`; afterwards `git status --porcelain -- dist`
  prints nothing (expected: empty output).
- Each relative link added or changed points to an existing file and heading (reviewer opens it).
- The PR description holds the evidence table from "Required behavior".

## Performance impact

None expected. Only `*.md` files change. They are not copied into the images (api, probe and notify
`Dockerfile` copy only `package.json`, `node_modules` and `src`), so no runtime metric of
`bench/budgets.json` in api (`startup_cpu_ms`, `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`,
`test_cpu_s`, `startup_wall_ms`, the `p95_*` keys, `rps`, `image_mb`, the `cold_*` and `eod_*` keys)
can move. `test_cpu_s` reads a few doc files in `src/docs-claims.test.ts` and `src/tokens.test.ts`
already; a few hundred extra bytes do not move it measurably. No A/B run is needed.

## Security impact

Security impact: no
Documentation only: no admin route, auth, parser, probe client, file write, log text, dependency,
Dockerfile or CI changes. The added text is security guidance, so the review checks each warning
against the cited source (W1-W6), but there is no code surface for hostile inputs.

## Rollout order

Five repositories, all independent. No child needs a released change of another: each one changes only
its own Markdown, and no package pin moves. Cross-repository links point only to anchors that exist
on `main` at the baseline and that this spec forbids renaming, so any merge order works. Older
consumers (probes and services on old pins of contract or kit, status against an older api) are not
affected, because no code, type or published `dist/` changes.

## Counterexamples

- **WAL durability (F1).** An API process killed with `SIGKILL` right after a `204`: the committed
  result survives (WAL + NORMAL survives an application crash). A power loss right after a `204`: the
  last commits can be lost, and the probe does not re-send them because it removed the result on
  `204`. Text that says "probes re-send" or "mostly sent again" is wrong.
- **WAL fallback.** On a file system without WAL, `synchronous` stays `FULL`; text that says the API
  always runs `NORMAL` is wrong.
- **Removed check (F2).** Remove check `blog` (with `method: "POST"` and `headers`) from `checks.json`
  and send `SIGHUP`, without a restart: its request options are cleared and it is inactive at once;
  `POST /results` for it answers `404 unknown check`. Text that waits for "the next start" is wrong.
- **Maintenance (R2).** Delete an active window from the file; at the next applied reload the window
  ends at once. "Read at start only" is wrong.
- **Read auth (F4, R4).** `GET /probe/checks` without a token answers `401`; `GET /admin/config` with
  a token holding only `incidents` answers `403`; `GET /locations` and `GET /manual-incidents` need no
  token. A blanket "read routes are public" gets the first two wrong.
- **Admin config scopes.** A token with `admin` only gets `403` on `POST /admin/checks`; a token with
  `read` only gets `200` on `GET /admin/config` and `403` on every write.
- **Probe restart (F5).** 50 results buffered while the API is down, then `SIGTERM`: the log says
  `shutting down: 50 buffered result(s) lost` and they never reach the API.
- **Retries (W2).** `method: "POST"`, `retries: 3`, target answers `503`: one attempt, `attempts: 1`.
  `method: "GET"`, `retries: 3`, `503` each time: four attempts. `method: "POST"` answered by `303` to a
  `GET` URL that then fails: still one attempt, because the configured method decides. A `POST` check
  with `intervalMs: 60000` from 3 locations makes 3 attempts per minute even with `retries: 0`, so
  the target can see the side effect up to 3 times a minute (more with `307`/`308` hops). The attempts
  are not a floor on requests: a check with a header denial reports `attempts: 1` and sends nothing
  (probe `src/check.ts:111-127`), and an already-aborted run sends nothing (`:158-159`). Text that
  promises the target is reached "at least once" per run or location is wrong.
- **Attempt is not request (W2).** `method: "POST"`, body `payload`, `retries: 0`; the target answers
  `/` with `307 Location: /next` and `/next` with `200`. One run is one attempt (`attempts: 1`) but the
  target receives two `POST`s with the body (probe `src/check.redirect.test.ts:112-124`). Text that
  says a non-idempotent check sends "one request" per run, or acts "once per interval", is wrong.
- **Key format (F6).** Incident 12 with reminders every hour, 3 h after opening: key `12:reminder:3`,
  not `12:reminder`. Manual incident 4, second update: key `manual:4:update:<32 hex>`, not
  `4:update` or `manual:4:update:1`. A receiver that parses the key as `<number>:<event>` breaks on both.
- **Heartbeat ingress (W3).** A proxy that publishes the prefix `/heartbeat` without normalizing the
  path forwards `/heartbeat/../admin/config` or `/heartbeat/%2e%2e/admin/config`; the API's URL parser
  resolves the dot segments to `/admin/config`. The guidance must require matching on the normalized
  path (or rejecting dot segments). `GET /heartbeat/nightly-backup/<secret>` must pass;
  `GET /checks` and `GET /metrics` on that ingress must not.
- **Backup (W4).** `docker compose exec api bun run backup /data/backup.db` followed by deleting the
  `api-data` volume loses the live file and the backup. Only a copy moved off the volume and host
  survives.
- **URL credentials (W5).** `https://user:pw@svc.example/` is rejected; `https://svc.example/?token=abc`
  is accepted and shows up unchanged in public `GET /checks`, while status shows
  `https://svc.example/`. Text that says the API redacts the query is wrong.
- **Poll counter (W6).** All three feeds answer and detection throws: `pulse_notify_polls_total{outcome="ok"}`
  rises by 1 and `pulse_notify_consecutive_failed_polls` rises by 1; with the default
  `PULSE_NOTIFY_HEALTH_MAX_FAILED_POLLS=5`, starting from zero failures, `/readyz` still answers ready
  after that one poll and fails only after the fifth failed poll in a row (notify `src/index.ts:240-246`,
  `src/config.ts:402`). With `PULSE_NOTIFY_HEALTH_MAX_FAILED_POLLS=1` the first failed poll fails
  `/readyz`. Text that says a detection failure (or one `error` poll) always "fails `/readyz`" is wrong,
  and so is text that says one failed poll can never fail it. `/checks` fails but `/incidents`
  answers with a newly resolved incident: `outcome="error"` rises and the `resolved` event is still
  enqueued. Text that says `error` means "nothing processed" or that `ok` means "delivered" is wrong.
- **Statistics.** This spec defines no statistic. The status latency text (F9) keeps its existing
  rule: the page shows the highest daily p95 of the last 7 UTC days from the api's daily values and
  never averages percentiles.

## Contract fields

No new names. No field, key, route, metric or setting is added or renamed; the docs describe names
that already exist (for example `grep -n 'pulse_notify_polls_total' .repos/notify/src/metrics.ts` →
line 24; `grep -n 'ADMIN_ROUTE' .repos/api/src/server.ts` → line 198). The new api heading
"Network exposure" is a document anchor, not a contract name:
`grep -rn 'network-exposure\|Network exposure' .repos/api/docs .repos/contract/src .repos/config` finds
nothing at the baseline.

## Repository: api

Files:
- `docs/operation.md`
- `docs/configuration.md`
- `docs/install.md`
- `docs/rest-api.md`
- `docs/concepts.md`
- `docs/troubleshooting.md`

Behavior change: no
Documentation only; the code already has the behavior that the corrected text describes.

Behavior and edits:

- `docs/operation.md`
  - "Start and restart" (R1): environment change needs a recreate or restart of the process (say which
    Compose command applies a changed `environment:`); a checks file change needs no restart (hot reload
    or `SIGHUP`, link `#changing-checks`); token files are read only until their one-time import. Remove
    lines 7 and 11-15 in their current form; keep the pulse-deploy directory hint and "a restart loses
    no state".
  - "Database" (F1): keep WAL, `synchronous = NORMAL`, the FULL fallback and the EXTRA audit commits.
    State: an API process crash loses no committed transaction; a power loss or OS crash can lose the
    last committed transactions without corrupting the file; a probe does not re-send a result after a
    `204`, so such results are lost; idempotent `POST /results` makes a re-send safe but recovers nothing.
  - "Backup and restore" (W4): add the off-volume, off-host retention and the restore test; keep all
    existing bullets.
  - "Admin tokens and header secrets" (W1, W5): make the authority exact (`admin` and `checks`), keep
    the host-binding limit, add that a probe token reads literal header values and bodies, and add the
    URL credential warning or link it from here.
  - "Probe locations", line 288: add that the probe buffer is in memory, so a probe restart loses
    unsent results (link probe `docs/operation.md#result-buffer`).
- `docs/configuration.md`: line 94 (F2) says "when the changed file is applied (at start, at a reload
  or by an admin write)"; line 214 (R2) says windows change with every applied reload; `url` row and
  Secrets note get W5 and a link to W1; `retries` and `method` rows get W2 with a link to probe
  `docs/configuration.md#retries`.
- `docs/install.md`: new section "Network exposure" before "Next steps" with W3; F3 stays absent.
- `docs/rest-api.md`: overview table (F4) gets rows for `GET /locations`, `GET /manual-incidents[/:id]`,
  the manual writes (`POST /manual-incidents`, `POST /manual-incidents/:id/updates`,
  `POST /manual-incidents/:id/resolve`, `DELETE /manual-incidents/:id`), `GET /admin/config`, and
  `POST`/`PUT`/`DELETE` on `/admin/checks`, `/admin/components`, `/admin/maintenance`, each with its
  auth (scopes as in "Scopes") and a link to its section. Keep token and audit rows. Fix the token
  row's methods if needed (`GET`, `POST`). Replace line 36 with: public reads need no token;
  `/probe/checks`, `/results` and `/admin/*` and manual writes need one; link W3.
- `docs/concepts.md:63` (R4): the same distinction in one sentence.
- `docs/troubleshooting.md:139` (R3): the API reloads the file; a removed check has no secret.

Checks:
- `bun run check` passes (`package.json:20`: `bun run lint && bun run typecheck && bun run test`).
  CI runs `lorenzh/pulse-config/.github/workflows/check.yml@04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`
  (`.github/workflows/ci.yml:18`); at that ref its steps are install, `bun run lint`, `bun run typecheck`,
  build and dist check only with `inputs.build`, and `bun run test` (`check.yml:25-38`), identical to the
  config clone at `bc87049`. `biome.json` extends `@lorenzh/pulse-config/biome.json`; at the pin it has
  `files.ignoreUnknown: true` (line 9), identical to the clone.
- `src/docs-claims.test.ts` and `src/tokens.test.ts` keep passing without edits (see Risks).
- N1-N9 and P1-P6 of "Acceptance evidence".

Completion evidence: PR with the evidence table for F1-F4, R1-R4, W1-W5; the outputs of N1-N9; the
`bun run check` result; `git diff --name-only` with only `.md` files.

## Repository: probe

Files:
- `docs/operation.md`
- `docs/configuration.md`
- `docs/troubleshooting.md`

Behavior change: no
Documentation only; the buffer, retry and reload behavior already exist.

Behavior and edits:

- `docs/operation.md`
  - "State" (F5): the probe keeps no state on disk; results waiting in the buffer are lost on stop,
    restart or crash (shutdown logs the count); nothing is replayed after a restart.
  - "After the checks change" (R5): the API applies a changed checks file without a restart (link api
    `docs/operation.md#changing-checks`); the probe picks it up within `PULSE_CHECKS_RELOAD_MS`.
  - "Changing the token or location" (R6): keep "restart the probe after changing `PULSE_PROBE_TOKEN`,
    `PULSE_PROBE_TOKEN_FILE` or `PULSE_LOCATION`". Replace the three rotation steps with: rotate with
    `POST /admin/tokens/<id>/rotate` on the API, give the probe the new secret within the 10-minute
    overlap and restart the probe; link api `docs/operation.md#token-rotation`. State that editing the
    API's tokens file after its import changes nothing. Replace the "introduce tokens" sentence with
    current guidance or remove it.
  - The bullet "Only `GET` and `HEAD` HTTP checks retry" in "Result buffer" moves next to a link to
    `configuration.md#retries` or stays; it must not contradict W2.
- `docs/configuration.md`: line 75 (R8) names the reload; "Retries" (W2) adds the distinction between
  the checked request and the idempotent `POST /results` / at-least-once notify delivery, that each
  probe location makes its own attempt every run, so side effects may repeat across runs, locations
  and followed redirects (without promising that a run reaches the target), and that one attempt can send the request more than
  once when a `307`/`308` redirect keeps the method and body (attempts versus requests; cite
  `src/check.ts:410`, `:527-549`, `src/check.redirect.test.ts:112-124`).
- `docs/troubleshooting.md`: line 43 (R7) compares with the token's `location` in `GET /admin/tokens`;
  lines 72 and 90-91 (R5) drop the API restart.

Checks:
- `bun run check` passes (`package.json:19`). CI uses the same pinned `check.yml@04108fa…`
  (`.github/workflows/ci.yml:18`), steps as cited in the api section. `biome.json` extends the shared
  config at the same pin.
- N10-N16 and P7-P8.

Completion evidence: PR with the evidence table for F5, R5-R8, W2 (cite `src/buffer.ts`,
`src/check.ts:isRetryable`, `src/check.ts:111-127` and `:158-159` (attempts without a request), `src/check.ts:410` and `:527-549` (redirects), `src/check.redirect.test.ts:112-124`, api `src/token-routes.ts`); outputs of N10-N16; `bun run check` result;
only `.md` files changed.

## Repository: notify

Files:
- `docs/channels.md`
- `docs/operation.md`
- `docs/troubleshooting.md`

Behavior change: no
Documentation only; keys and the metric already behave as described.

Behavior and edits:

- `docs/channels.md` (F6): line 16 says the key of an automatic `opened` or `resolved` event is
  `<incidentId>:<event>` (keep `12:opened`) and links to Reminders and Manual incidents for the other
  forms; the payload table `key` row lists the forms or links to them; the "Delivery and retries"
  bullet tells receivers to deduplicate by the exact `idempotency-key` value and treat it as an
  opaque string (no parsing). Keep the payload example and the manual-incident paragraph.
- `docs/troubleshooting.md:73`: the same opaque-key wording without the `<incident id>:<event>` form.
- `docs/operation.md` (W6): after the metrics table, replace the first sentence of the paragraph with
  the full meaning of `pulse_notify_polls_total` and the signals to use instead (a detection failure
  adds to the failed-poll streak; `/readyz` fails only when the streak reaches
  `PULSE_NOTIFY_HEALTH_MAX_FAILED_POLLS`, as line 142 already says); add one bullet to
  "Upgrading" for alerts on `outcome="error"`.

Checks:
- `bun run check` passes (`package.json:17`). CI uses `check.yml@04108fa…` (`.github/workflows/ci.yml:18`).
  `test/config.test.ts:378-404` still loads every `channels` JSON example in the docs.
- N17-N19 and P9-P10.

Completion evidence: PR with the evidence table for F6 and W6 (cite `src/detector.ts`,
`src/channels/webhook.ts`, `src/notifier.ts:#poll`, `src/metrics.ts`, `src/index.ts:240-246`, `src/config.ts:402`); outputs of N17-N19;
`bun run check` result; only `.md` files changed.

## Repository: contract

Files:
- `AGENTS.md`

Behavior change: no
Documentation only; the validators are already Zod based.

Behavior and edits:

- `AGENTS.md:26` (F7): the boundary line says `pulse-contract` holds Zod schemas, the types inferred
  from them, validators on those schemas and the wire version; keep "only runtime dependency is `zod`
  (exact version)" and "depends on no other repo". Line 105 stays consistent.

Checks:
- `bun run check` passes (`package.json:28`: lint, build, typecheck, test). CI uses
  `check.yml@51e95b0eb463b27a196a33b428607bd92443e4f0` with `build: true`
  (`.github/workflows/ci.yml:17-19`); at that ref the dist step is `git diff --exit-code -- dist`
  (`check.yml:34-36`), identical to the config clone. After the build, `git status --porcelain -- dist`
  is empty.
- N20 and P11.

Completion evidence: PR with the evidence row for F7 (cite `src/schema.ts`, `src/validate.ts`,
`package.json:39`); output of N20; `bun run check` result; only `AGENTS.md` changed.

## Repository: kit

Files:
- `AGENTS.md`

Behavior change: no
Documentation only; the modules already exist.

Behavior and edits:

- `AGENTS.md:105` (F8): "Runtime helpers only, no service logic. The exported helpers are documented
  in `docs/index.md`." (or equivalent), without "Planned". No module list is duplicated.

Checks:
- `bun run check` passes (`package.json:39`: lint, build, typecheck, test). CI uses
  `check.yml@51e95b0…` with `build: true` (`.github/workflows/ci.yml:17-19`). After the build,
  `git status --porcelain -- dist` is empty.
- N21 and P12.

Completion evidence: PR with the evidence row for F8 (cite `src/index.ts`, `package.json` `exports`,
`docs/index.md` "Exports"); output of N21; `bun run check` result; only `AGENTS.md` changed.
