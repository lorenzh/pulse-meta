# Issue review: Keyword check for HTTP checks (#151)

Verdict: specifiable. No blocking question.

## Current state (inspected in the clones)
- contract: `HttpCheck` has no `keyword`. `Result.reason` documents examples only.
- probe: `attemptHttp` in `src/check.ts` cancels the body (`res.body?.cancel()`) and returns `up` for 2xx, else `down` with `HTTP <code>`. Retries and the latency objective wrap this (`runCheck`); a down result retries until `retries` is used.
- api: `src/config.ts` validates and builds the HTTP check field by field (unknown fields are dropped). Checks are persisted in SQLite (`db.ts`, `service.ts` upsert and read-back, columns added by `addCheckColumn`). `GET /checks` serves the stored row, so `keyword` needs a new column plus a migration, upsert and read-back, not only config validation.
- status: `render.ts` `renderLatency` shows the objective only for up/degraded checks. The reason of a down check already renders; the check detail has no place yet for the keyword.
- Pins differ today: probe and notify use contract `c78f73b`, api and status use `78c8...`. All three consumers must move to the same new merged contract commit.

## Dependencies
contract first; probe, api and status depend on contract (`dependsOn: contract`). notify is not affected (it reads results, not the keyword) and needs no change.

## Open points (resolved as assumptions below)
1. Body size limit: the issue says "a fixed size limit that the docs name" but gives no number. Assumption: 1 MiB (1,048,576 bytes), a constant in probe, named in the probe docs (and mentioned in api/status docs where the field is described).
2. Decoding and matching across the limit: the body is read as a stream up to the limit and decoded as UTF-8; a multibyte character cut at the limit is irrelevant. A keyword straddling the limit is not found. Match stops early once the keyword is found (the rest is cancelled).
3. Precedence with latency objective: keyword failure makes the attempt `down` (reason `keyword "<text>" not found`), so no `degraded` evaluation. A found keyword leaves `up`, which may still become `degraded` by latency. Latency of the attempt includes reading the body (assumption; document it).
4. Timeout covers body reading: the existing `AbortSignal.timeout` stays active while the body is read; a timeout or read error during the body is `down` with the existing timeout / error reason, not "keyword not found".
5. `statusCode` of a keyword failure is the 2xx code received (not null); `reason` as above. The contract comment must say this. Reason text uses the keyword verbatim; long keywords: assumption that no truncation is done, but api limits length (see 6).
6. Keyword validation in api: non-empty string, rejected on TLS checks (even if empty) and for non-strings, error `ConfigError` naming the check (use the existing `checks[i]` `where` prefix plus the id, as other errors do; confirm the prefix names the check by id). Assumption: no trimming (whitespace-only keyword is allowed as a plain string, since match is exact) and a maximum length is not required; propose 1024 chars to keep reason and DB bounded, only if the plan wants it. Keyword is not required to be a single line.
7. Persistence: new nullable `keyword` column on `checks` (migration via `addCheckColumn`), cleared when the check is removed from the file; `GET /checks` serves it only for HTTP checks and omits it when unset (as for `latencyObjectiveMs`).
8. Status: "the check detail names the keyword" is interpreted as a text next to the latency in the check detail, e.g. `keyword "<text>"`, HTML-escaped, shown for HTTP checks with a keyword regardless of state (also when down, where the reason already shows `keyword "x" not found`). Exact placement is left to the plan; the status poller must pass the field through from `GET /checks` (check `validate.ts`).
9. Redirects: the body matched is that of the final response after fetch follows redirects (current behavior); unchanged.
10. Content type / compression: no filtering by content type; fetch decompresses transparently. Binary bodies decode with replacement characters and simply do not match.
11. HEAD is not used; the probe already uses GET.

## Acceptance check (derived)
- contract: `HttpCheck.keyword?: string` exists with a comment on down condition and reason text; merged to main, commit SHA known.
- probe: with a fake fetch, (a) 2xx body containing the keyword -> `up`; (b) 2xx body without it -> `down`, `statusCode` 200, reason `keyword "<text>" not found`, retried `retries` times with `attempts` counted; (c) 503 -> `HTTP 503` unchanged; (d) case differs -> not found; (e) keyword placed beyond the limit -> not found; (f) no `keyword` -> body is not read (cancelled as today); (g) TLS checks ignore it.
- api: a checks file with `keyword` on an HTTP check loads and `GET /checks` returns it (also after restart, from the DB, and after a DB created before this change); `keyword` on a TLS check, `""`, and a number each throw `ConfigError` naming the check.
- status: a page with a keyword check shows the keyword in the check detail; a down check still shows its reason; checks without keyword render unchanged.
- Each of probe, api, status pins `@lorenzh/pulse-contract` to the merged contract commit SHA (not a branch), with the lockfile updated.
- Docs: probe, api, status `docs/configuration.md` (or matching page) describe `keyword`, give an example, and name the size limit (1 MiB); contract docs describe the field.
- Whole flow: an HTTP check with a keyword against a server returning 200 with a maintenance page shows `down` with the reason on the status page; with the keyword present it shows `up`.
