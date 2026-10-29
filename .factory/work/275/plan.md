# Plan: status badge and feed answer 503 on invalid checks data (#275)

Follow-up to #268 (`.factory/work/268/plan.md`, decisions 5 and 7). Review: `.factory/work/275/issue-review.md`.

## Goal
Invalid cached `/api/checks` data never becomes a successful badge or feed. The test-only XML checker rejects malformed XML it now accepts.

## Scope
Only `status` (`src/syndication.ts`, `src/xml-parser.ts`, tests). No contract or api change.

## Non-goals
- No change to the 503 body/headers, to routes, caches, CSP or `ALLOWED_API_PATHS`.
- No closed set of states: per decision 7 an unknown non-empty state string still renders `unknown` with 200.
- Uptime stays as in decision 5: a missing check, failed `/api/uptime` or non-number `uptime` means "no data" (200). A number that is not finite or outside 0-100 is also treated as "no data"; it does not give 503.
- `reason` of an incident stays optional (non-string becomes null).
- No attribute well-formedness checks in the XML checker beyond duplicates.

## Decisions
1. Valid `state` = non-empty string. Missing, `null`, non-string and empty are invalid.
2. Badge and feed share `parseChecks`; one invalid item (also an unrelated one) makes the whole answer invalid, as for `id`/`name` today.
3. 503 stays `text/plain` `unavailable`, `Cache-Control: no-store`, no upstream text.

## Required behavior
- `parseChecks` requires `id`, `name` and `state` as strings, `state` non-empty; it no longer uses `String(item.state)`. Badge (`/badge/<id>.svg`, known or unknown id, after the label check) and `/feed.atom` answer 503 `unavailable` with `no-store` otherwise.
- `xml-parser.ts` rejects, with a controlled `Error` (no `RangeError`), numeric references whose decoded code point is not a legal XML 1.0 char (`&#0;`, `&#x1;`, `&#xD800;`, `&#xFFFE;`, `&#x110000;`), in text and attribute values; accepts `&#9;`, `&#xA;`, `&#x1F600;`. It rejects a duplicate attribute name in one start tag.

## Risks
- Stricter checks could break existing fixtures that lack `state`; update those to include it without changing assertions.
- Do not change the order of the label check, reads and 404/503 handling (existence leak, decisions 8, 9).

## Acceptance evidence
- Server test with fake API: `/api/checks` with a check lacking `state` (also `null`, `5`, `""`) gives 503, body `unavailable`, `no-store` for the badge (known and other id) and `/feed.atom`; it fails on current main (200, `max-age`, `aria-label="Web: unknown 99.95%"`). A valid unlisted state string still gives 200 `unknown`.
- New `src/xml-parser.test.ts` proves rejections and acceptances above.
- `npm run check` passes; existing decision 5/7 tests unchanged in meaning.

## Repository: status
Files: `src/syndication.ts`, `src/xml-parser.ts`, new `src/xml-parser.test.ts`, `src/server.syndication.test.ts` (and fixtures if needed).
Behavior and checks: as under Required behavior and Acceptance evidence.
Completion evidence: regression test shown failing before the fix and passing after; `npm run check` green.
