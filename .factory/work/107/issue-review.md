# Issue review: probe tokens for result ingest (#107)

Verdict: specifiable. No blocking question; the open points below get a default from the plan.

## Current behavior (inspected)
- api `src/server.ts`: `POST /results` is validated by `validateResult` and passed to `service.ingest`. There is no auth. Missing `location` becomes `default` (`DEFAULT_LOCATION`); location is trimmed and at most 64 chars. Unknown check → 404, bad body → 400. Errors use `{error}` (`ErrorResponse`).
- api `src/main.ts` reads `PORT`, `PULSE_DB`, `PULSE_CHECKS_FILE`. `checks.json` has `checks` and `maintenance`; there is no token config.
- probe `src/client.ts`: `postResult` sends only `content-type`. `main.ts` reads `PULSE_API_URL` and `PULSE_LOCATION` (default `default`). Failed posts are logged as `API answered HTTP <status>` and dropped, so a 401 would be logged and results silently lost (not fatal).
- contract: `Result.location` already exists. No contract change is needed, since the token is an HTTP header, not part of the data model.
- status and notify only read, so they stay unchanged.

## Open points and assumptions
1. **Token source (assumption).** A separate env var or file, not `checks.json`: `checks.json` is committed or shared and public-ish, so secrets do not belong in it. Proposal: `PULSE_TOKENS_FILE` (JSON `{"tokens": [{"location": "...", "token": "..."}]}`, kept outside git) and/or `PULSE_PROBE_TOKENS` (`location=token,location2=token2`). The plan picks one, and should prefer one mechanism. Add `tokens.example.json` or doc if a file is chosen, with a `.gitignore` entry.
2. **API with no tokens configured (assumption).** Fail at startup with a clear message, because an unauthenticated ingest by default is the problem this feature fixes. Alternative (reject all posts, start anyway) is worse for operators. Tests and docs must say so.
3. **Token validation at load.** Reject empty tokens, duplicate tokens (they would be ambiguous between locations), duplicate locations, and locations over 64 chars or empty. Suggest a minimum length (for example 16 chars) and say so in the README. Error messages name the location or entry, never the token value.
4. **Location binding.** The token fixes the location. Rules to specify:
   - Body `location` present and different from the token's location → 403 (the issue says a probe cannot report for another location; 401 vs 403 is not fixed). Assumption: 403 for a valid token with a mismatching location, 401 for missing or unknown tokens. Nothing stored either way.
   - Body `location` omitted → the result is stored under the token's location, not `default`. This differs from the current default; document it.
   - Compare after the same trim/normalisation as `validateResult`.
5. **Order of checks.** Authenticate before reading or parsing the body so unauthenticated requests cannot cause work or learn validation or check-id details (401 beats 400/404). Still enforce the body limit. Method check (405 for non-POST) can stay first. Answer 401 with `WWW-Authenticate: Bearer` and the body `{error: "unauthorized"}`; same message for missing and unknown tokens.
6. **Constant-time comparison.** Use `crypto.timingSafeEqual` on equal-length digests (hash both sides with SHA-256 first, so length does not leak) and check all configured tokens without early exit. Parse `Authorization` strictly: scheme `Bearer` (case-insensitive), a single space, a non-empty token; anything else is 401.
7. **No leaks.** Tokens never appear in logs, errors, responses or startup output. Test: wrong-token response and captured logs do not contain the token or the configured tokens.
8. **Probe.** Read `PULSE_PROBE_TOKEN`, trim it. If it is missing or empty, `main.ts` exits non-zero at startup with a clear message that does not print the value. Send `authorization: Bearer <token>` on `POST /results` only. `GET /checks` stays unauthenticated, since the read routes are public. A 401/403 reply should be logged distinctly ("token rejected, check PULSE_PROBE_TOKEN and PULSE_LOCATION") instead of the generic drop message. The probe keeps running and does not exit (assumption: the API may be fixed later). The probe's `PULSE_LOCATION` must match its token's location; if `PULSE_LOCATION` is unset the location is `default`, so the API entry must be `default`.
9. **Rollout order and dependency.** The api and probe changes are independent in code, but deploying api first stops all existing probes. Probe sending an `Authorization` header to an old API is harmless. Recommend `targets.json`: api `dependsOn` probe is not needed for code, but the README should say "roll out probes with tokens first, then enable the API". Plan decides; no contract dependency expected, so targets are `api` and `probe` only.
10. **Rotation.** Must support rotation without losing results. Suggest allowing several tokens per location (overlap period): add the new token, switch the probe, remove the old one. This conflicts with "one per probe location" in the issue wording; assumption: one or more per location, at least one. The API reads tokens at startup, so rotation means an API restart (document; no hot reload needed).
11. **Other clients of `POST /results`.** The existing tests of api (`server.test.ts` and others posting through the server) must pass a token or use a test helper; the plan must keep "existing tests keep passing" by updating the test fixtures only and not weakening assertions. `service.ingest` stays unauthenticated at the unit level.
12. **Transport.** Bearer tokens over plain HTTP are readable on the network. Out of scope (no TLS in the api); mention in README: put the API behind TLS or a private network.
13. **Rate limiting or brute force.** Out of scope; tokens are 32 random bytes (`openssl rand -hex 32`).
14. **README scope.** api: settings table, token creation, config format, rotation, 401/403 semantics. probe: `PULSE_PROBE_TOKEN`, startup failure, location match. The meta README is not affected unless it lists env vars (check it in the plan).

## Derived acceptance check
Start the api with a tokens config (`east` → token A, `west` → token B), plus a check `c1`:
1. `POST /results` without `Authorization` → 401, nothing stored (`GET /checks/c1/results` stays empty, state unchanged).
2. With `Bearer wrong`, a malformed header, or an empty token → 401, nothing stored, response and logs do not contain the submitted token.
3. With token A and `location: "west"` → 403 (mismatch), nothing stored.
4. With token A and `location: "east"` or no location → 204, stored with location `east`.
5. `GET /checks`, `/incidents`, `/uptime`, `/maintenance`, `/checks/:id/results` work without a token.
6. API without any configured token (or with an invalid token config) → exits at startup with a clear message without token values.
7. Probe without `PULSE_PROBE_TOKEN` → exits at startup with a clear message; with it, every `POST /results` carries `Authorization: Bearer <token>` and results are accepted (204); `GET /checks` carries none.
8. A rotation walk-through in the README works: add the new token, restart the api, switch the probe, remove the old token, restart.
9. `npm run check` passes in api and probe (and the new tests cover missing, wrong, other-location and valid tokens).
