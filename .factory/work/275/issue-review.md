# Issue review: #275 status badge renders invalid data instead of 503

Single target: `status` (follow-up to #268, decision 5 of `.factory/work/268/plan.md`). No contract/api change.

## Current behavior (checked in `.repos/status/src`)
- `syndication.ts` `parseChecks`: requires `id` and `name` strings, then `state: String(item.state)`. A missing or non-string `state` becomes `"undefined"`, which the badge renders as `unknown` with 200 and `public, max-age`.
- `uptimeOf`: a non-number `uptime` falls to `undefined` ("no data"). Decision 5 explicitly allows this for a missing check or failed `/api/uptime`. Other malformed uptime shapes (e.g. a non-object entry, non-finite number, or a value outside 0-100) are not specified.
- `parseIncidents` already validates its fields. The feed does not use `state`, but it shares `parseChecks`, so a bad `state` currently makes nothing fail in the feed either.
- `xml-parser.ts` (test-only): `decode` uses `String.fromCodePoint` on numeric references without a legality check, and `assertLegalChars` runs only on the raw input, so `&#0;`, `&#1;`, `&#xD800;` and `&#xFFFE;` pass. Larger values like `&#x110000;` throw an uncontrolled `RangeError`. `parseAttributes` assigns into a plain object, so duplicate attributes overwrite silently. There is no `xml-parser.test.ts`, so the checker has no tests of its own.

## Assumptions
1. "Valid state": decision 7 says unknown future state strings render as `unknown`. So valid means a non-empty string; the badge keeps its fallback to `unknown` styling for unlisted strings. Missing, `null`, non-string and empty `state` are invalid and give 503. If a closed set is wanted, the plan must say so. This conflicts with decision 7 and is not assumed.
2. "Other fields the badge and feed use": `id` and `name` (strings; already checked), `state`. For incidents: `id`, `checkId`, `openedAt`, `resolvedAt` (already checked); `reason` is optional by design (non-string becomes null) and stays lenient.
3. Feed and badge share `parseChecks`, so one validation change covers both. The feed must also answer 503 when a listed check has an invalid `state`, as the issue says "badge and feed".
4. Uptime: keep decision 5 (missing, failed or non-number uptime means `no data`, 200). A present but malformed uptime entry (e.g. NaN-like, out of 0-100) is treated as `no data` unless the plan decides on 503. This is flagged for the plan; it is not blocking.
5. Invalid data in an unrelated check in the list also gives 503 (the whole checks answer is of the wrong shape), consistent with the current id/name handling and with not revealing existence.
6. The 503 responses stay `text/plain` `unavailable` with `Cache-Control: no-store`, with no upstream text.
7. XML checker: reject a numeric reference whose decoded code point is not a legal XML 1.0 char (including surrogates and > U+10FFFF), in text and attributes, with a controlled `Error`. Reject a duplicate attribute name within one start tag. Add `xml-parser.test.ts` covering accepted and rejected cases (`&#0;`, `&#x1;`, `&#xD800;`, `&#x110000;`, `&#xFFFE;`, `<a x="1" x="2"/>`, plus legal `&#9;`, `&#x1F600;`).

## Open points (non-blocking)
- Whether `state` should be restricted to the known set (see assumption 1). The default follows decision 7.
- Attribute-name-level well-formedness beyond duplicates (e.g. whitespace between attributes) is out of scope.

## Acceptance check
- Server test with a fake API: `/api/checks` containing a check without `state` (also `state: null`, `state: 5`, `state: ""`) gives `503`, body `unavailable`, `Cache-Control: no-store` for `/badge/<id>.svg` (known id and others) and for `/feed.atom`. The test fails on current `main` (200, `max-age`, `aria-label="Web: unknown 99.95%"`). A valid state string that is not known still renders `unknown` with 200.
- `xml-parser.test.ts` proves the checker rejects `&#0;`-type references and duplicate attributes and accepts legal references.
- `npm run check` passes in `status`; existing decision-5/7 tests are unchanged.
