# Spec #456: Only http/https check URLs in contract and probe; RDAP redirects only over https

## Goal
A probe only ever requests `http:` and `https:` URLs for HTTP checks: the first request and every
redirect hop. RDAP lookups of `domain` checks follow redirects only to `https:` URLs on hosts listed
in the IANA bootstrap file. This closes the local file read through check URLs (audit M2) and the
redirect-based spoofing and internal requests through RDAP (audit L1).

Checked against `main` of the clones: contract `61f7bf8`, api `352ec49`, probe `ef7d3c0`. The issue
review (`.factory/work/456/issue-review.md`) is the source of the current-behavior facts below.

## Scope
- contract: the `url` field of `httpCheckSchema` gets the http/https rule.
- api: bumps the contract pin and drops its own copy of the protocol rule from `URL_TEXT`.
- probe: a scheme check before every HTTP request, with redirects of every HTTP check handled in
  the probe. The RDAP redirect rule and a bootstrap-fetch redirect rule. The contract pin bump.

## Non-goals
- No deny list for private address ranges (audit L2). No change to TCP, DNS, TLS or heartbeat checks.
- No change to the redirect rules of #384 for checks with headers or a body (same origin, method
  rule, `expectedStatus` judged as it is, 20 hops). Only the scheme check is added in front of them.
- No rule on credentials, ports or hosts in check URLs.
- No new status: a refused RDAP redirect is `down` after retries, like every failed RDAP lookup today.
  The issue's "unknown after retries" rule does not exist in the code (see the review). No change there.
- No `WIRE_VERSION` bump: the api never stored or served other schemes, so the wire format does not
  change for any real data.
- status, kit, notify, config and website do not change. They pick up the rule on their next
  contract pin bump.

## Decisions
1. **Targets:** `contract`, then `api` and `probe` in parallel. Both depend on the contract only.
2. **One rule, no new export.** The rule is: `new URL(value)` parses and its `protocol` is `http:` or
   `https:`. URL parsing lowercases the scheme (`HTTP://h/` passes). No extra trimming beyond what
   `new URL` does. This is the api's current rule. The contract keeps the predicate private. The probe
   has its own copy of the same rule, because its runtime check must work without the contract (an
   older api, a check that bypasses the client).
3. **HTTP redirects (option B of the review):** the probe handles redirects of **every** HTTP check
   with `redirect: "manual"`. Only then can each hop be checked and a reason name the scheme, without
   relying on Bun. Bun 1.4.0 refuses a `file:` redirect under `redirect: "follow"` today, but its
   error (`UnsupportedRedirectProtocol`) does not name the scheme. Checks without headers and body
   keep the semantics of fetch's follow mode (see Required behavior 2.3).
4. **RDAP rule:** a redirect is followed only when the target protocol is `https:` and the target
   `host` (hostname and port, as `URL.host` gives them: lowercase, default port omitted) equals the
   `host` of an `https:` service URL listed anywhere in the current bootstrap file (any TLD entry,
   any position in its URL list). No public-suffix package is approved, so "same registrable domain"
   is not used. The hop limit stays 3.
5. **Bootstrap fetch:** it uses `redirect: "manual"`. Any 3xx answer fails the bootstrap with reason
   `RDAP bootstrap redirect not followed`. The configured bootstrap URL itself is not
   scheme-checked: the default is `https://data.iana.org/rdap/dns.json`, and the only override is the
   test hook `rdapBootstrapUrl`.

## Required behavior

### 1. contract
1. `httpCheckSchema.url` is `nonEmpty` plus a refinement with the rule of decision 2, on the field
   itself, not in `refineHttpCheck`. The admin schemas are built from `httpCheckSchema.shape` and
   `httpCheckSchema.strict()` (`src/admin.ts`), so they get the rule with it.
2. Message: `must be an http: or https: URL`, so `validateCheck` reports
   `check.url: must be an http: or https: URL` and a checks list reports
   `checks[<i>].url: must be an http: or https: URL`. One message for "does not parse" and for
   "wrong scheme". The message never quotes the value.
3. An empty string still reports `must be a non-empty string` (the first issue wins, as today).
   A missing `url` still reports `is required`.
4. `docs/index.md`: the `HttpCheck` row and the `HttpCheck` paragraph say that `url` must be an
   `http:` or `https:` URL, with the message.

### 2. probe
1. **First request.** Before `fetch`, `attemptHttp` parses `check.url`. A URL that does not parse
   ends the attempt `down` with reason `invalid URL` and `statusCode: null`. A protocol other than
   `http:`/`https:` ends it `down` with reason `unsupported URL scheme "<protocol>"` (for example
   `unsupported URL scheme "file:"`). `fetch` is not called. The reason never holds the URL, so no
   credentials can leak. After `new URL`, a protocol matches `[a-z][a-z0-9+.-]*:`, so quoting it is
   safe. These failures follow `retries` like every `down` attempt.
2. **Every hop.** `fetchFollowing` calls `fetch` with `redirect: "manual"` for every HTTP check. For a
   3xx answer (301, 302, 303, 307, 308) with a `Location`, the next URL is `new URL(location, url)`.
   A `Location` that does not parse is `down` with `redirect to invalid location`. Then the scheme is
   checked, **before** the origin check: a protocol other than `http:`/`https:` is `down` with
   reason `redirect to <protocol> not followed` (for example `redirect to file: not followed`),
   `statusCode` is the redirect status, and the target gets no request.
3. **Checks without headers and body** (`isSecretBearing` false) keep the semantics of fetch's
   follow mode:
   - They follow every redirect status with a `Location`, across origins and between http and https,
     even when the redirect status is in `expectedStatus` (as today, where fetch follows it).
   - At most 20 redirects: the 21st redirect answer is `down` with `too many redirects`, after 21
     requests.
   - Method: a 303 changes any method except HEAD to GET; a 301 or 302 changes POST to GET; otherwise
     the method stays. Such checks have no body, so nothing is dropped.
   - A 3xx without `Location` is the final answer and is judged as today.
   - The final answer is judged as today (status, keyword, jsonAssert, latency).
4. **Checks with headers or a body** keep the #384 rules unchanged: the method rule
   (`HTTP <status> redirect not followed for <METHOD>`) first, then the parse, then the new scheme
   check, then the same-origin rule (`redirect to <origin> not followed`), then 20 hops. A redirect
   status in `expectedStatus` is judged, not followed.
5. **RDAP redirects.** In `fetchRdap`, a 3xx with `Location`:
   - more than 3 hops: `too many redirects` (unchanged, checked first);
   - `Location` that does not parse: `RDAP redirect to invalid location`;
   - protocol other than `https:`: `RDAP redirect to <protocol> not followed` (for example
     `RDAP redirect to http: not followed`);
   - `host` not in the bootstrap host set (decision 4): `RDAP redirect to <host> not followed`;
   - otherwise followed.
   A refused redirect throws `RdapError(reason)`, so `attemptDomain` ends `down` with that reason and
   `certDaysLeft: null`, retried by `retries` (existing rule). The target gets no request. Reasons name
   the scheme or the host only, never the path or the full URL.
6. **Bootstrap host set.** `parseBootstrap` also collects the `host` of every string URL in every
   entry's URL list that starts with `https://` and parses. The cache entry stores the TLD map and
   this host set together, refreshed and kept stale together. A redirect is checked against the set of
   the bootstrap map used for that lookup.
7. **Bootstrap fetch.** `fetchBootstrap` sends `redirect: "manual"`. A 3xx answer is
   `RDAP bootstrap redirect not followed` (body cancelled). The existing stale-map rule applies: a
   cached map stays on failure.
8. **Contract pin.** Bump `@lorenzh/pulse-contract` to the contract `main` commit with the rule. Then
   the client (`src/client.ts`, `validateCheck` on each served check) skips a check served with
   `file:…` and logs `skipping invalid check <id>: check.url: must be an http: or https: URL` (the
   path prefix as the client builds it). The runtime checks of 2.1 to 2.7 stay as the second layer.
9. **Docs** (`docs/configuration.md`): the `url` field allows only `http:` and `https:`; the reasons
   of 2.1 and 2.2; that every HTTP check follows redirects in the probe (rules of 2.3 and 2.4); the
   RDAP redirect rule with its reasons and the bootstrap rule.

### 3. api
1. Bump `@lorenzh/pulse-contract` to the contract `main` commit with the rule.
2. `src/config.ts`: `URL_TEXT` keeps only its blank check (`REQUIRED_TEXT`, stricter than the contract's
   `nonEmpty`). Drop `protocolOf` and the two refinements `is not a valid URL` and
   `must be http or https`. `parseHttp` already runs the contract's `validateCheck`, which now
   reports `checks[<i>].url: must be an http: or https: URL`.
3. Tests: `src/config.test.ts` keeps `"nope"` and `"ftp://x/"` as rejected and adds an assertion of the
   exact contract message for both and for `file:///x`. `src/config-admin.test.ts` (reload with
   `file:///x`, message contains `checks[0].url`) stays green unchanged. An admin write of an HTTP
   check with `url` `file:///x` is rejected with 400 and the contract message (it goes through the
   same parser; add the test if none covers it).
4. Docs: `docs/troubleshooting.md` quotes `checks[0].url: must be an http: or https: URL` instead of
   `checks[0].url is not a valid URL`. `docs/configuration.md` keeps "`http` or `https` URL", plus the
   message.

## Risks
- **Follow semantics in the probe.** Moving checks without headers and body from fetch's follow mode
  to manual hops can change edge behavior: Bun's follow mode errors after 20 redirects with its own
  error code; the new reason is `too many redirects`. An unparsable `Location` used to be a fetch
  error code; it is now `redirect to invalid location`. The existing compat tests ("a check without
  headers and body still lets fetch follow redirects", "redirect is followed to 200", "a redirect is
  judged on the final status") must stay green. The compat test that names fetch in its title keeps
  its assertions; rename it only if the title is wrong (it may say "follows redirects").
- **Bootstrap redirect refusal.** If IANA ever redirects `data.iana.org/rdap/dns.json`, a probe with no
  cached map ends domain checks `down` with `RDAP bootstrap redirect not followed`. A probe with a
  cached map keeps it. The reason makes the cause visible. Accepted for a fixed IANA URL.
- **Probe contract pin.** The probe pins an older contract (`6401721…`) than the api (`9fe5e80…`).
  The bump brings every contract change in between. The implementer runs the full probe check and
  fixes type changes in place, without behavior changes beyond this spec.
- **status on its next pin bump.** `status/src/server.privacy.test.ts` ~194 feeds a check with
  `url: "not a url://u:p@h"` to the status server. If that path validates with the contract, that test
  may need a fixture change on status's next bump. status is not a target here.

## Performance impact
None expected: one `new URL` per HTTP check in contract validation, one per request and per hop in
the probe, one per RDAP redirect. Metrics of `bench/budgets.json` that could move, all by well under
1 %: contract `test_cpu_s` (new tests), api `load_cpu_s` and `test_cpu_s`, probe `test_cpu_s`. No
change to RSS, startup, image size, p95 latency or requests per second. The redirect handling in the
probe adds no request for a check without redirects. If a reviewer asks, the implementer measures the
api with `bun bench/run.ts --a <old main> --b <branch>` in the api repo.

## Security impact
Security impact: yes
The change touches a validator at a trust boundary (contract), the probe HTTP client and its redirects,
the RDAP client and its redirects, and error texts that carry external data (schemes, hosts).

Checklist items that apply:
- **Input validation:** the contract rule on `url`; the probe's own runtime check that does not trust
  `GET /probe/checks`.
- **SSRF and redirects:** scheme checks on the first request and every hop; RDAP redirects only to
  `https:` hosts listed in the bootstrap file; bootstrap redirects refused. Private address ranges stay
  out of scope (L2).
- **Secrets in errors, logs and responses:** reasons name only the scheme or the host, never the URL,
  path, query or userinfo. The #384 header and body rules stay intact (no header value or body in a
  reason).
- **Body and size limits:** unchanged (RDAP 1 MiB, bootstrap 2 MiB, probe body limit); every refused
  hop cancels the body.

## Rollout order
1. **contract** merges first. Nobody runs a new pin yet. api and probe on old pins keep working: the
   api still has its own rule, the probe still trusts the served checks.
2. **api** and **probe** in any order after the contract, each bumping its pin.
   - New api with an old probe: the api serves only http/https URLs (as before), so nothing changes
     for the old probe.
   - Old api with a new probe: an old api already rejects other schemes in its parser. A compromised
     or older api that serves `file:` anyway gets the check skipped by the new probe client and, if it
     bypasses the client, refused at the runtime check.
   - Old checks files: the api has rejected non-http(s) URLs since its parser had the rule, so no stored
     check becomes invalid on upgrade.
3. status, kit and the other contract consumers are unchanged and keep their old pins. They read
   `GET /checks`, whose URLs were always http/https.

## Counterexamples
- contract `url`: rejected `file:///etc/passwd`, `data:text/plain,x`, `ftp://h/`, `javascript:alert(1)`,
  `nope` (does not parse), `//h/` (relative, does not parse), `http//h` (does not parse). Each reports
  `check.url: must be an http: or https: URL`. Accepted `http://h/`, `https://h/`, `HTTP://h/`
  (lowercased by the parser), `https://u:p@h:8443/x?y`. `""` reports `must be a non-empty string`, not
  the URL message. A wrong implementation that checks `value.startsWith("http")` accepts `httpx://h/`
  and `http-foo:x`; both must be rejected.
- contract admin: `validateAdminCheckView` and the admin `http` input schema reject `file:///x` too.
  A rule placed only in the `superRefine` of `httpCheckSchema`, outside `refineHttpCheck`, would miss
  the admin view, which is built from `.shape`; the admin test catches that.
- probe first request: `file:///proc/self/environ` → `down`, `unsupported URL scheme "file:"`, no fetch
  call. `data:text/plain,x` → `unsupported URL scheme "data:"`. `not a url` → `invalid URL`.
  `https://user:secret@h/` with a 200 answer is `up`; with a `file:` redirect its reason is
  `redirect to file: not followed` and never contains `secret`.
- probe hops: `http://h/` → 302 `file:///etc/passwd` → `down`, `redirect to file: not followed`,
  `statusCode` 302, one fetch call. The same for a check with headers: the scheme reason, not
  `redirect to null not followed` (scheme before origin). A redirect from `https://a/` to
  `http://b/` without headers and body is followed (fetch's follow mode does that); with headers it is
  `redirect to http://b not followed` (unchanged).
- probe follow semantics without headers and body: POST + 302 → next request is GET; POST + 307 → next
  request is POST; HEAD + 303 → HEAD; GET + 303 → GET. `expectedStatus: [302]` and a 302 answer → the
  redirect is still followed (unchanged for these checks). 21 redirects in a row → `too many redirects`
  after 21 requests; 20 redirects then 200 → `up`.
- RDAP: bootstrap lists `https://127.0.0.1:<port>/` and `http://ignored.test/`. A redirect to
  `/domain/x` (relative, stays `https://127.0.0.1:<port>`) is followed. A redirect to
  `http://127.0.0.1:<port>/…` is `RDAP redirect to http: not followed`. A redirect to
  `https://ignored.test/…` is `RDAP redirect to ignored.test not followed` (listed only as http). A
  redirect to `https://127.0.0.1:<other port>/` is refused (host includes the port). A redirect to
  `https://evil.test/` is `RDAP redirect to evil.test not followed`. Four redirects within the rule
  stay `too many redirects` after 4 requests.
- RDAP bootstrap: a 302 on the bootstrap URL with nothing cached → `RDAP bootstrap redirect not
  followed`, the `Location` gets no request.
- No statistics are defined or changed by this spec.

## Contract fields
No new fields, keys, routes or exported names. The predicate stays private in the contract. New texts
only: the message `must be an http: or https: URL` and the probe reasons `invalid URL`,
`unsupported URL scheme "<p>"`, `redirect to <p> not followed`, `RDAP redirect to …`,
`RDAP bootstrap redirect not followed`. Searches that show no collision (each prints nothing):

```
grep -rn 'http: or https:' .repos/contract/src .repos/config .repos/api/src .repos/probe/src
grep -rn 'unsupported URL scheme' .repos/contract/src .repos/config .repos/probe/src
grep -rn 'invalid URL' .repos/contract/src .repos/config .repos/probe/src
grep -rn 'RDAP redirect' .repos/contract/src .repos/config .repos/probe/src
grep -rn 'RDAP bootstrap redirect' .repos/contract/src .repos/config .repos/probe/src
```

`redirect to <x> not followed` already exists in the probe for origins (`src/check.ts` `nextHop`); the
new scheme form `redirect to file: not followed` cannot collide with an origin, because an origin of an
http(s) URL always contains `://`.

## Acceptance evidence
- contract: the regression test, and the mutation output in the PR (removing the protocol refinement
  makes the test fail). CI green.
- api: config tests green on the bumped contract with the contract message; docs updated. CI green.
- probe: the regression tests below fail on the old code (the PR names how: on `main`, the `file:` check
  calls fetch, and a `file:` redirect ends with `UnsupportedRedirectProtocol` or
  `redirect to null not followed`; RDAP follows any `Location`). CI green.

## Repository: contract
Files: `src/schema.ts`, `test/validate.test.ts`, `test/admin.test.ts`, `docs/index.md`, `dist/` (rebuilt).

- `src/schema.ts`: a private `httpUrl` field schema (`nonEmpty` plus a refinement: `new URL(v)` parses
  and `protocol` is `http:` or `https:`; `try`/`catch` around the parse; message
  `must be an http: or https: URL`) used as `httpCheckSchema.url`. Update the field comment
  ("Non-empty." → "An `http:` or `https:` URL."). The code stays browser-safe (`URL` only).
- `test/validate.test.ts`: `validateCheck` rejects `file:///etc/passwd`, `data:text/plain,x`, `ftp://h/`,
  `javascript:alert(1)`, `httpx://h/` and `nope` with exactly `check.url: must be an http: or https: URL`,
  accepts `http://h/`, `https://h/` and `HTTP://h/`; `""` keeps `must be a non-empty string`;
  `validateChecksResponse` reports the `checks[0].url` path.
- `test/admin.test.ts`: the admin view schema and the admin `http` input schema reject `file:///x`.
- `docs/index.md`: the rule and the message in the `HttpCheck` row and paragraph.
- Run `bun run build` and commit `dist/`.
- Checks: `bun run check`.
- Completion evidence: PR with the tests green and the mutation output (refinement removed → named
  tests fail).

## Repository: api
Files: `package.json`, `bun.lock`, `src/config.ts`, `src/config.test.ts`, `src/config-admin.test.ts` (only
if an admin-write test is added there), `docs/troubleshooting.md`, `docs/configuration.md`.

- Bump the contract pin to the contract `main` commit with the rule.
- `src/config.ts`: `URL_TEXT` keeps the blank check only; remove `protocolOf` and the two URL
  refinements. Keep the comment that the contract owns the rule.
- Tests as in Required behavior 3.3: exact message for `nope`, `ftp://x/` and `file:///x`; `http://` and
  `https://` URLs still load; the reload test stays green; an admin write with `file:///x` gets 400 with
  the contract message.
- Docs as in Required behavior 3.4.
- Checks: `bun run check` (or the repo's full check script).
- Completion evidence: PR with the tests green on the bumped contract.

## Repository: probe
Files: `package.json`, `bun.lock`, `src/check.ts`, `src/check-domain.ts`, `src/check.redirect.test.ts`,
`src/check.test.ts`, `src/check.domain.test.ts`, `docs/configuration.md`.

- Bump the contract pin to the contract `main` commit with the rule; fix type fallout only.
- `src/check.ts`: a local `isHttpUrl`-style helper with the rule of decision 2; the first-request check
  in `attemptHttp` (or at the start of `fetchFollowing`, returning a `stop`) per 2.1; `redirect:
  "manual"` for every check; hop handling per 2.2 to 2.4, with the scheme check before the origin check.
  The `fetchFollowing` doc comment states the new rule.
- `src/check-domain.ts`: the host set in `parseBootstrap` and the cache entry (2.6); the redirect rule in
  `fetchRdap` (2.5), which therefore needs the host set from `lookupExpiry`; `redirect: "manual"` and
  the 3xx refusal in `fetchBootstrap` (2.7).
- Tests (each fails on `main`):
  - `runCheck` with `url: "file:///proc/self/environ"` and a stub `fetch` that records calls: `down`,
    reason `unsupported URL scheme "file:"`, zero calls. Same for `data:text/plain,x`; `not a url` →
    `invalid URL`.
  - `http://` server answering 302 `Location: file:///etc/passwd`: `down`, reason
    `redirect to file: not followed`, `statusCode` 302, for a check without headers and for one with
    headers.
  - A stub that records `init.redirect` sees `"manual"` for a check without headers and body.
  - Follow semantics: POST + 302 → GET, POST + 307 → POST, cross-origin redirect without headers followed,
    21 redirects → `too many redirects` after 21 requests, credentials never in a reason.
  - RDAP with the stub server of `check.domain.test.ts`: a redirect to `http://127.0.0.1:<port>/…` →
    `RDAP redirect to http: not followed` and the stub sees one domain request; a redirect to
    `https://evil.test/…` → `RDAP redirect to evil.test not followed`; a redirect to
    `https://ignored.test/…` is refused; a relative redirect within the rule is followed and yields the
    expiry (`up`); the existing 3-redirect test stays green; the refusal with `retries: 2` has
    `attempts` 3.
  - Bootstrap: a 302 on the bootstrap URL → `RDAP bootstrap redirect not followed`, the redirect target
    gets no request.
  - Existing compat tests stay green.
- `docs/configuration.md`: per Required behavior 2.9; replace "Checks without headers and body follow
  redirects as before" with the rules of 2.3; extend the domain section (~139) with the RDAP and
  bootstrap redirect rules and reasons.
- Checks: `bun run check` (or the repo's full check script).
- Completion evidence: PR with the tests green, and a note on how each new test fails on `main`.
