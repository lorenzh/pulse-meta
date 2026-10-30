# Issue review: #456 Only http/https check URLs in contract and probe; RDAP redirects only over https

State `issue-review`, workflow `spec`. No earlier decisions in the issue comments (only the Factory claim).
Checked against `main` of the clones in `.repos/` (contract `d0b8fca`, probe `ef7d3c0`, api `352ec49`).

## Verdict

The feature can be specified. Nothing blocks the spec. The issue hands three choices to the plan
(redirect strategy for HTTP checks, the RDAP same-registry rule, whether api is a target). The facts
and recommendations for each are below.

## Current behavior (verified)

### contract
- `httpCheckSchema` (`src/schema.ts` ~228-279): `url: nonEmpty`, so any non-empty string passes.
- `httpCheckSchema` is used by `validateCheck` (`src/validate.ts` ~384) and by `src/admin.ts`
  (~70 `httpCheckSchema.shape` for the admin view without headers/body, ~103 `httpCheckSchema.strict()`).
  So the rule has to sit on the `url` field itself, not in the `superRefine(refineHttpCheck)`. A rule
  in `superRefine` would not reach the shapes derived from `.shape`.
- The contract docs live in `docs/index.md`. Contract has no `docs/configuration.md`, although the issue
  names that file for both repos. Contract docs go into `docs/index.md`, and probe docs go into
  `docs/configuration.md`.
- `file:///etc/passwd`, `data:text/plain,x`, `ftp://h/` and `javascript:alert(1)` all parse with
  `new URL`. The protocol check alone rejects them, so the mutation check (remove the protocol rule, the
  test fails) is meaningful.

### api
- `src/config.ts` ~70-86 has its own `URL_TEXT`: non-blank, `new URL` parses (`is not a valid URL`),
  protocol `http:`/`https:` (`must be http or https`).
- `parseHttp` (~240-260) already calls the contract's `validateCheck` on the candidate after its own
  schema. Once the contract pin is bumped, the contract rule applies in the api automatically.
- The api pins the contract by git SHA (`9fe5e80…`), and the probe pins a different SHA (`6401721…`).
  Both need a bump to get the rule.
- Tests that touch the rule: `src/config.test.ts` ~27-29 (`"nope"`, `"ftp://x/"` only assert that a
  `ConfigError` is thrown) and `src/config-admin.test.ts` ~200 (`file:///x`, asserts the message
  contains `checks[0].url`). `docs/troubleshooting.md` ~44 quotes `checks[0].url is not a valid URL`.
  `docs/configuration.md` ~67 says "`http` or `https` URL to probe."

### probe
- `src/check.ts` `fetchFollowing` (~360-394) calls `deps.fetch(check.url, …)` without a scheme check.
  Checks with headers or a body use `redirect: "manual"` and go through `nextHop` (same origin only,
  20 hops). All other checks use `redirect: "follow"`.
- `nextHop` sends a redirect to `file:` to the origin check. That origin is `"null"`, so the code
  already refuses it with the reason `redirect to null not followed`. That reason does not name the
  scheme.
- Verified locally with Bun 1.4.0, the version the probe pins in `package.json` and `Dockerfile`:
  `fetch("file:///etc/hostname")` reads the file (M2 confirmed). A `302 Location: file:///…` under
  `redirect: "follow"` is **refused by Bun** with `UnsupportedRedirectProtocol`, so the probe today ends
  `down` with that error code. The real hole is the **first request** (`check.url`). Today the redirect
  case is only a missing guarantee. It depends on Bun's behavior and has no scheme-naming reason.
- `src/client.ts` ~260 already runs the contract's `validateCheck` on each served check and skips an
  invalid one (`skipping invalid check <id>: …`). After the contract bump, a `file://` check from an
  older api is **skipped** there and stays `unknown`. The runtime check in `runCheck` is the second
  layer. The acceptance test for that layer has to call `runCheck` directly (bypassing the client), as
  the issue intends.
- `src/check-domain.ts`:
  - `fetchRdap` (~146-165) follows any `Location` (any scheme, any host), up to `MAX_REDIRECTS = 3`.
  - `parseBootstrap` keeps only the first `https://` service URL per TLD. The cache stores only the
    TLD-to-URL map, not the set of hosts.
  - `fetchBootstrap` (~90-100) calls `fetch` with the default `redirect: "follow"`, so redirects of the
    bootstrap file are not limited either. The issue does not mention this (see open point 4).
  - A failed lookup throws `RdapError(reason)`, and `attemptDomain` turns it into `down` with that
    reason and `certDaysLeft: null`. `runCheck` retries `down` up to `retries`.
- `src/check.domain.test.ts` uses a local **http** stub server. The bootstrap lists
  `https://127.0.0.1:<port>/`, and `localFetch` rewrites `https:` to `http:` just before the real fetch.
  The scheme checks in the probe see the `https:` URLs, so the existing harness can drive the new RDAP
  tests. A redirect `Location` built from the stub's own `http://` URL is the "redirect to http" case.
  A relative `Location` (as in the existing 3-redirect test) stays `https:` and is the "within the rule"
  case. The test bootstrap URL itself is `http://…/dns.json` (test hook `rdapBootstrapUrl`).
- `docs/configuration.md` ~85 describes the redirect rules of #384, and ~136-142 describes domain
  checks (3 redirects, reasons).

## Open points for the plan (not blocking)

1. **Targets and order.** The required behavior says the api "then reuses the contract rule instead of
   its own copy". Recommendation: targets `contract`, `api`, `probe`. `api` and `probe` each depend on
   `contract` only and can run in parallel after it.
   - api: bump the contract pin and drop the protocol refines from `URL_TEXT` (keep the non-blank /
     required message or rely on the contract). Update `docs/troubleshooting.md` and the message
     examples to the contract's text. `config.test.ts` and `config-admin.test.ts` stay green as long as
     the contract message keeps the `checks[0].url` path.
2. **HTTP redirects in the probe (the plan picks).** The facts above matter here:
   - Option A: keep `redirect: "follow"` for checks without secrets, check the initial URL, and check
     the final `res.url`. Bun 1.4.0 already refuses non-http(s) redirect targets
     (`UnsupportedRedirectProtocol`), but its error does not carry the scheme. So the reason cannot name
     the scheme unless that error is mapped to a fixed text (for example
     `redirect to unsupported scheme`). A test of "http → file ends down" with real Bun fetch passes on
     the old code, which conflicts with "each test fails on the old code" unless the test asserts the
     new reason text.
   - Option B: manual redirects for every HTTP check, with the scheme check on each hop. This
     guarantees the behavior without relying on Bun and always names the scheme. The probe then has to
     reproduce fetch's follow semantics for checks without secrets: cross-origin allowed, at most 20
     hops, 303 → GET, 301/302 POST → GET, dropping the body on a method change, and the final status
     judged.
   - Recommendation: B, for a deterministic, scheme-naming guarantee. The secret-bearing rules of #384
     (same origin, the method rule) stay exactly as they are. Keep the scheme check **before** the
     origin check in `nextHop`, so `file:` gets the scheme reason instead of `redirect to null not followed`.
     If the plan picks A, it must state the exact reason for Bun's refusal and how the redirect test
     fails on the old code.
3. **RDAP same-registry rule (the spec decides).** No public-suffix package is approved
   (`docs/approved-packages.md`), so "same registrable domain" cannot be computed reliably.
   Recommendation: a redirect is followed only when (a) the target protocol is `https:` and (b) the
   target host (hostname and port) equals the host of an `https:` service URL listed anywhere in the
   current IANA bootstrap file. The bootstrap service of the TLD counts too. The cache then also keeps
   the set of listed hosts. The hop limit stays at 3. Reasons name the scheme or the host only, for
   example `RDAP redirect to http: not followed` and `RDAP redirect to <host> not followed`. They never
   name the path or the full URL.
4. **Bootstrap fetch redirects.** The issue goal says "RDAP requests only `https:` URLs", but the
   bootstrap fetch follows redirects without limits. Recommendation: put it in scope with a minimal
   rule. Either fetch the bootstrap with `redirect: "error"`, or check that a followed `res.url` is
   `https:`. The test bootstrap URL is `http://` (test hook), so the rule should apply to redirects of
   the bootstrap only, not to the configured URL. The plan may also leave this out explicitly. Either
   way it has to be stated.
5. **Reason texts.** The issue requires the scheme in the reason and never the URL. Proposed texts
   (the plan fixes them):
   - check URL: `unsupported URL scheme "file:"`
   - HTTP redirect hop: `redirect to file: not followed`
   - a check URL that does not parse at the probe: `invalid URL`

   After `new URL`, a scheme is limited to `[a-z][a-z0-9+.-]*`, so quoting it is safe.
6. **Contract error text.** It must name the field and the allowed schemes, for example
   `check.url must be an http: or https: URL` (the contract's path prefix plus the message). One message
   for both "does not parse" and "wrong scheme" is acceptable. Two messages work as well, as long as both
   name the schemes. The rule matches the api's: `new URL(v).protocol` is `http:` or `https:` (case
   normalized by URL parsing), with no trimming. Credentials in the URL, private addresses and ports
   stay out of scope.
7. **Shared helper.** The contract may export a small predicate (for example `isHttpUrl`) for the api
   and probe to reuse. The issue says the probe's runtime check must not depend on the contract
   release, so a local check in the probe is fine too. The plan picks one, and both must apply the same
   rule.

## Assumptions

- "The existing 'unknown after retries' rule" in the issue does not match the code. A failed RDAP
  lookup is `down` with the reason and `certDaysLeft: null`, retried by `retries`. A refused RDAP
  redirect follows that existing rule (`down` after retries). No new `unknown` status is introduced.
- Contract docs go into `docs/index.md` (contract has no `docs/configuration.md`). Probe docs go into
  `docs/configuration.md`, and api docs into `docs/troubleshooting.md` / `docs/configuration.md`
  if the message changes.
- The fan-out of #384 (secret-bearing redirect rules) stays unchanged. Only the scheme check is added in
  front of it.
- Non-goals hold: no private-address deny list (L2), no change to TCP, DNS or TLS checks.
- Consumers that already validate with the contract (status `poller.ts` on `GET /checks`) pick up the
  rule on their next pin bump. The api never stored non-http(s) URLs, so no existing data breaks.
  status and kit are not targets.

## Derived acceptance check

- contract: a regression test shows that `validateCheck` rejects an HTTP check with `url`
  `file:///etc/passwd`, `data:text/plain,x`, `ftp://h/` or `javascript:alert(1)` with a message that
  names `url` and the allowed schemes, and accepts `http://h/` and `https://h/`. The admin schemas
  derived from `httpCheckSchema` reject them too. The PR shows the mutation: removing the protocol rule
  fails the test. `docs/index.md` states the rule.
- api (if a target): `URL_TEXT` no longer has its own protocol rule. `config.test.ts` and
  `config-admin.test.ts` stay green on the bumped contract. The docs quote the contract's message.
- probe:
  - `runCheck` with an HTTP check whose `url` is `file:///proc/self/environ` (passed directly, bypassing
    the client) ends `down` with a reason that names `file:`, and the fetch stub records no call.
  - A redirect `http:` → `file:` ends `down` with the scheme reason, and no request goes to the target.
  - Both tests fail on the old code.
- probe RDAP (stub server):
  - A redirect to an `http:` URL is refused with a reason, and the target sees no request.
  - A redirect to an `https:` host outside the decided rule is refused.
  - A redirect within the rule is followed and yields the expiry.
  - The hop limit of 3 still holds.
- probe `docs/configuration.md` states the allowed schemes, the HTTP redirect scheme rule and the RDAP
  redirect rule.
- CI green in contract, api and probe.
