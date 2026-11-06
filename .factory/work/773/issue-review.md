# Issue review: #773

## Result

Ready for `plan`. No question requires a `needs-input` hold. Specify a console-only presentation and regression-test change using the assumptions below. The issue title retains work that its body explicitly moved to #774; the body governs scope.

## Evidence and prior decisions

- Read meta `AGENTS.md`, `README.md`, the issue-review prompt, console and API `AGENTS.md`, and the existing #774 issue review.
- Read [#773](https://github.com/lorenzh/pulse-meta/issues/773) and all its comments through the connected GitHub tools. The only comment is the current Factory claim; there are no earlier human decisions. The additional negative-budget requirement is present in the current issue body and is in scope.
- Read [#774](https://github.com/lorenzh/pulse-meta/issues/774), which is closed as completed. Its shared styling work is already reflected in the console clone. Preserve its panels, table wrappers, radio layout, danger buttons, fonts and shared states.
- Inspected the read-only clones directly: console `5cdc34b6c5396dc67f02d6dff5585e9c1174a60a`, API `f25519bf0578c5287a289542eee2aca9de0451d5`, contract `c4a2eb5214d48d40d0c1afbae5e3e49463185e15`, probe `9490141ef9e92044808c70bb8200db3d497d1060`, and deploy `e754d468a2c445e76d5017692096428bff179f28`.
- Console evidence: `src/check-detail-pages.ts`, `check-format.ts` and its tests, `check-editor-page.ts` and its tests, `check-form.ts`, `check-read.ts`, `check-routes.ts`, `shell-line.ts`, `settings.ts`, `server.checks.test.ts`, `test/check-fixtures.ts`, `e2e/run.ts`, package scripts, README and configuration documentation.
- Supporting evidence: API `src/service.ts`, `slo.ts`, `server.reads.test.ts`; contract `src/schema.ts`; probe `src/check.ts`; deploy `demo/compose.yaml`. These repositories supply context, not implementation targets.

## Open points and assumptions for the spec

### 1. Rounding belongs at the display boundary

`stateEntries` inserts `state.lastReason` verbatim after HTML escaping. The probe produces the known message `latency <duration>ms over objective <objective>ms`. Current probe main already rounds measured latency to whole milliseconds in `latencyBetween`, but historical or older-producer reason strings can still contain the reported float. Fixing only the producer would leave those strings visible and would exceed the requested storage constraint.

Assume nearest whole milliseconds for the displayed latency: `1501.4197810000041` becomes `1501`. Recognize the known latency reason format rather than rewriting every number in arbitrary reason text. Preserve status codes, URLs, identifiers, unrelated reasons and the `None` fallback. Keep HTML escaping. The spec should name whether the same formatter also serves the Locations and Recent results reason cells; using it consistently on the detail screen is reasonable, but upstream reason generation and persisted text stay unchanged.

### 2. Readable settings need explicit names and units

`settingsEntries` iterates the admin view and uses each raw object key as a definition-list term. This affects all six check types and the shadowed definition page, which reuses the settings section. It is broader than the two examples in the issue.

Use an explicit mapping for the current view fields, consistent with editor wording. Suggested terms include `URL`, `Method`, `Interval (ms)`, `Timeout (ms)`, `Retries`, `Retry delay (ms)`, `Latency objective (ms)`, `Expected status`, `Keyword`, `JSON assertions`, `Availability target (%)`, `Host`, `Port`, `Warn days before expiry`, `DNS name`, `Record type`, `Expected values`, `Resolver`, `Domain`, `Period (ms)` and `Grace (ms)`. The plan should settle the complete mapping. Keep the values and units honest; this does not require changing how JSON assertion values are laid out or converting stored milliseconds to another unit. Preserve the existing Name/Id/Type/Source rows, source tags and write-only Header/Body/Secret markers. Test the full current field set, not just `intervalMs` and `retryDelayMs`.

### 3. Repeated timestamps are not sufficient evidence of duplicate samples

The current renderer maps `detail.results.value` to table rows once, and `readCheckDetail` makes one results request. There is no observed double-render path. However, `utcTime` drops the fractional second from epoch-millisecond timestamps. Two distinct samples in the same second consequently display the same time. Separately, distinct probe locations can legitimately report at exactly the same millisecond. The demo has `eu` and `us` probes, and console fixtures deliberately contain equal timestamps from two locations.

API identity is `(check, location, timestamp)`, not timestamp alone. API `listResults` keeps equal-time groups together, even when that makes a page longer than the requested limit, and the next page uses an exclusive `before` cursor. `server.reads.test.ts` explicitly tests that behavior. Do not deduplicate by time, suppress one location, truncate the returned tie group or round the cursor.

The screenshots and their raw API payload are not attached to this task, so the exact two reported pairs cannot be conclusively classified. This does not block a spec: require one row per returned sample, preserve Location, show UTC milliseconds in Recent results so samples within one second are distinguishable, and briefly explain that each location reports its own result. Retain existing newest-first order and paging semantics. Scope millisecond precision to sample times where needed rather than changing every console timestamp through the shared formatter. If implementation reproduces a separate duplication defect, document its identity-level cause before fixing it; mere equal timestamps must remain valid.

### 4. Create/edit HTTP capability already matches; visibility differs

Both forms call the same `httpFields`, which already includes Body, Headers and JSON assertions. The create-form test already asserts 20 header rows and 10 assertion rows. Headers are inside a closed `details` on an empty create form and open when existing data is present; JSON assertions are currently inside a closed `details` in both modes. Thus the claim that create has no such fields is not supported by inspected main.

Treat this as discoverability plus regression coverage, not a new write capability. A concrete default is to open the top-level Headers and JSON assertions sections in both create and edit, keeping the existing More rows disclosure for extra headers. This is a markup visibility change within the no-restyle constraint and needs no script. Keep the shared renderer and current row limits, validation, defaults and field names. Field parity means matching configurable HTTP properties; it does not mean making an existing Id editable or adding keep/replace/remove choices to a create form. Stored literal headers, body and heartbeat secrets retain their current write-only treatment and edit intents.

### 5. A usable heartbeat address cannot be inferred from the console address

`heartbeatSection` builds its curl URL from `DetailContext.apiUrl`, supplied by the routes from the saved server-to-server API address. That is why `http://api:3000` appears. `PULSE_CONSOLE_PUBLIC_URL` identifies the console, which does not proxy heartbeat traffic. The probe API URL setting is a probe-form prefill, not a promise of reachability from a heartbeat job.

Choose the explicitly allowed placeholder option: show a clearly identifiable API-origin placeholder, for example `https://<pulse-api-address>/heartbeat/<encoded-id>`, plus an adjacent note to replace it with the address at which the job can reach pulse-api. Do not guess localhost, reuse the browser/console origin, add a proxy route, add a setting or change saved API connection data. Keep the secret placeholder, POSIX quoting, HTML escaping, copy-button behavior and existing treatment of unaddressable Ids (`.` and `..`). Copying the snippet must retain both placeholders; the note must make clear that it needs substitution before running.

### 6. Negative error budget is valid; the current wording is misleading

Contract `sloSchema` defines `budgetRemaining` as a percentage, permits any finite negative value and documents it as negative when exceeded. API `slo.ts` computes `100 * (1 - (100 - availability) / (100 - target))`. A tight objective can therefore legitimately yield a very large negative value; this is not evidence of a storage or SLO-calculation bug. Console `budgetText` currently prints that number directly, including the existing `Error budget exceeded (-0.0 %)` case.

Use the issue's bounded-display option: for remaining budget in `[0, 100]`, display the existing percentage-left wording; for any negative remaining budget display `Error budget exceeded` without the numeric parenthesis. This handles both `-87400` and small negatives such as `-0.04`, without pretending the budget is healthy. If a finite value above 100 is encountered, omit the numeric claim or say the budget is unavailable; the plan should choose that fallback. Keep no-objective and no-results behavior, availability, target and the 30-day window. Do not clamp or recalculate the API value or change the contract. Existing tests that require the misleading negative percentage must be revised.

### 7. Target scope and delivery

Only `console` needs an implementation child based on inspected behavior. No API, contract, probe or deploy change is required, and #774 is completed context rather than unfinished prerequisite work. Do not recreate its styling. Preserve all roles, routes, POST guard order, CSRF/form tokens, revisions, write payloads and stored data. Use existing dependencies and the existing HTTP/browser fixture harnesses. Update console-owned README/configuration text where the presentation or heartbeat instructions are described, following its repository guidance.

## Derived acceptance check

1. **Rounded reason:** a real console detail HTTP response given `latency 1501.4197810000041ms over objective 500ms` shows `latency 1501ms over objective 500ms` in Last reason and never the raw float. Include an already integral reason, an unrelated reason containing numbers/HTML characters and a null reason. Assert the API fixture/source value is not rewritten.
2. **Readable labels:** populate every currently supported settings field across HTTP, TLS, TCP, DNS, domain and heartbeat fixtures. Assert readable definition-list terms with units, including Interval and Retry delay, and absence of the corresponding raw camelCase terms. Cover the shared shadowed settings path and preserve write-only `set` markers and environment references without exposing values.
3. **Results identity and time:** return two results from one location in the same second with different milliseconds, plus equal-millisecond results from different locations. Assert exactly one row per API sample, distinguishable full millisecond times in the first pair, both locations in the tied pair, and the explanatory text. Cover a page-boundary tie group larger than 20 rows and prove Older results uses the exact last epoch-ms cursor and the next fixture page has no repeated or skipped sample. Preserve Newest results and empty-panel behavior.
4. **HTTP form parity:** through real create/edit GET responses and the browser, verify the same configurable HTTP fields, including Headers and JSON assertions, are visible/usable under the chosen disclosure policy. Exercise a plain header, environment header and JSON assertion on both flows using existing fake API writes; assert unchanged payload shape and validation. Exclude only the documented identity and write-only edit differences when comparing fields. Confirm the controls remain usable without JavaScript and that invalid submissions retain only the currently permitted nonsecret input.
5. **Heartbeat instructions:** use an internal saved API URL fixture and assert the displayed and copied curl line contains the API-origin placeholder and encoded check Id, not the internal origin. Assert the substitution note, secret placeholder, shell/HTML escaping and existing no-snippet behavior for unaddressable Ids. Do not issue a heartbeat request or reveal a secret as part of rendering/copying.
6. **Budget:** detail-page and formatter tests cover `-87400`, `-0.04`, `0`, a positive value, `100`, and the chosen above-100 fallback. Negatives communicate exceeded budget without a negative percentage or `-0.0`; plausible remaining percentages, absent SLO and null/no-results states remain accurate. Keep the API-supplied values unchanged.
7. **Delivery evidence:** in the implementation checkout, `bun run check` and `bun run check:browser` pass with the new regression cases and existing quality gates intact. Extend the current browser suite to assert the visible rounded reason, settings labels and usable create/edit fields; retain its existing narrow-screen/accessibility coverage. Exercise the changed screens against a running console as its AGENTS.md requires and record the command/result. No runtime/browser pass is claimed by this issue-review state.

## Review limits and tool handling

This state inspected source and issue discussions; it did not run product tests or change any target clone, label or comment. The previously absent work directory is created by this artifact and must remain tracked. Initial nonexistent guessed source paths were corrected through explicit file listings and reads of the actual modules. The cloud runtime status tool and `/etc/codex/network-policy.json` snapshot are unavailable in this runner; required GitHub reads succeeded through the connected tools. No credential values were inspected or printed, and no required issue or source read remains blocked.
