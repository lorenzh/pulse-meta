# Spec #297: status proxy forwards the wire header on every answer

## Goal
Fix the P2 error from the review of lorenzh/pulse-status#38 (spec #288, decision 8): the status proxy must forward the upstream `x-pulse-contract` header unchanged on every proxied answer, also non-2xx and error answers.

## Scope
Target `status` only (`src/server.ts`, `fetchUpstream`; README; tests). No contract, API or poller change.

## Non-goals
- No change of status codes or bodies: 503 stays 503 with `{"error":"API error"}`; the upstream body is never forwarded.
- `wire-mismatch` keeps answering 200 with the header. A non-2xx upstream with a mismatching header stays an `http` error (status before wire order), now carrying the header.
- No change to the page poller or the cache key.

## Required behavior
- `fetchUpstream` already records `wireHeader` for each upstream response. Pass it to `answer()` in all error branches: `http`, `too-large`, `invalid-json`, `validation`, `timeout`, `aborted`, `network` and the non-`application/json` media type branch (502).
- The raw header string is forwarded as received (no trim, no validation). If upstream sent none, or no response arrived (network error, timeout before headers), the answer carries no header.
- A timeout/abort during the body read, after headers arrived, forwards the recorded header ("where an upstream header exists").
- `proxyApi` and cached answers already emit/keep `wireVersion`; no change there.

## Risks
- Low. Cached error answers now carry the header; that is intended.

## Acceptance evidence
- Regression test: upstream 503 with `x-pulse-contract: 99` and a body -> proxy 503, body `{"error":"API error"}`, header `x-pulse-contract: 99`. Fails on current code.
- Same for invalid JSON, too-large body and wrong media type (502 `invalid API response`) with header forwarded; timeout after headers if testable.
- Upstream without header: no header on the error answer; network error: no header.
- Existing tests (200 mismatch, success path) pass; `npm test`/lint/typecheck of status are green.

## Repository: status
Files: `src/server.ts` (pass `wireHeader` in every `answer()` of `fetchUpstream`; update the "never forwarded" comment to say only the body is withheld), `src/server.test.ts` (or `server.contract-modules.test.ts`, where the wire header tests live) for the tests above, `README.md` (state that the header is forwarded on non-2xx and error answers too, when upstream sent it).
Checks: the status repo's standard test, lint and typecheck commands from its `AGENTS.md`.
Completion evidence: the new tests fail before the change and pass after; PR closes the child issue.
