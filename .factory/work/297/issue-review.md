# Issue review: #297 status proxy drops the wire header on upstream HTTP errors

Target: `status` only (`src/server.ts`, `fetchUpstream`, README). No contract or API change.

## Findings in current code (`.repos/status/src/server.ts`)
- `fetchUpstream` records `wireHeader` in `recordingFetch` for every upstream response, so the value is already available in every branch.
- Only `wire-mismatch` (200) and the success path pass `wireHeader` to `answer()`. The `http` branch (~l.237) and the `too-large`/`invalid-json`/`validation` (502) branches do not. The non-`application/json` media type branch (~l.256, 502) does not either.
- `proxyApi` already writes `x-pulse-contract` when `result.wireVersion` is set, and cached answers carry it, so no change is needed there.
- Branches without an upstream response (`timeout`, `aborted`, `network`) have no header; none can be forwarded.
- README (status) says the proxy "forwards the `x-pulse-contract` header of pulse-api"; spec #288 decision 8 says to forward it also for non-OK statuses.

## Open points (none blocks the spec)
- "Unchanged": forward the raw header string as received, without trimming or validation. Assumption: yes.
- Absent header: send none (do not invent one). Assumption: yes.
- Status and body of the error branches stay as they are (503 stays 503 with `{"error":"API error"}`; the upstream body is still never forwarded). Only the header is added.
- `wire-mismatch` keeps answering 200 with the original header (decision 8). A non-2xx with a mismatching header stays an `http` error (status before wire order), now with the header.
- Timeout caveat: `wireHeader` is set when headers arrive. A timeout during the body read (`timeout`/`aborted` after headers) technically has a header. Assumption: forward it whenever recorded, since the requirement says "where an upstream header exists". The planner may also keep these branches without it; choose one and test it.
- Other consumers (page poller) already read the header on any proxied answer; check whether the poller maps a non-2xx with a mismatching header to `version` or `unreachable`. The issue only asks the proxy to forward it. Poller change is out of scope unless the spec decides otherwise (assumption: out of scope).
- Cache: answers are cached including `wireVersion`; no key change needed.

## Assumptions
- Single target `status`, no `dependsOn`.
- README wording is updated to say non-2xx and error answers carry the header too.

## Acceptance check
- Test: upstream answers 503 with `x-pulse-contract: 99` and a body; the proxy answers 503, body `{"error":"API error"}`, header `x-pulse-contract: 99`. It fails on current code (no header).
- Same check for other error branches with an upstream header (502 `invalid API response` for invalid JSON, too-large body, wrong media type): header forwarded unchanged.
- Upstream without header: no header on the error answer. Network/timeout before headers: no header.
- Existing tests (200 mismatch, success path) still pass.
