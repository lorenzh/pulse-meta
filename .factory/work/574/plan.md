# Spec #574: probe setting that blocks private ranges

## Goal
Self-hosted operators can stop a probe from checking private networks. A new setting, `PULSE_PROBE_BLOCK_PRIVATE_RANGES`, makes the probe refuse every connection that a check would open to a loopback, private, link-local, unspecified, reserved or cloud metadata address. The probe checks this for every check type. It checks the address the connection actually uses, after DNS resolution and on every redirect hop. The default stays "allowed", as decided in #460 (decision 9) for self-hosted installs. Hosted mode, which must always block, is a later integration and not part of this spec.

Sources: issue #574, #460 decision 9, and the issue review `.factory/work/574/issue-review.md`. Clones that were read: probe `50ec9ca`, contract `ebcbbb6`, kit `6a06ec2` (main; the probe pins kit `fa79ba8`, read through `gh api`), config `main`, api `main` (`bench/`).

## Current behavior (probe `50ec9ca`)
- `src/settings.ts:27-36` has no network-restriction setting. `docs/configuration.md:189-208` lists RFC 1918, loopback, link-local (including `169.254.169.254`) and unique-local IPv6 as reachable, and says "There is no deny list in the code".
- HTTP checks: `src/check.ts:382-421` (`fetchFollowing`) calls `deps.fetch(url, { redirect: "manual", ... })` once per hop with the hostname URL. Bun's fetch resolves the name itself. Nothing checks addresses.
- TCP: `src/check-tcp.ts:14-32` calls `net.connect({ host, port })`. TLS: `src/check.ts:40-67` calls `tls.connect({ host, port, servername })`. Both resolve inside the socket call.
- DNS: `src/check-dns.ts:96-112`. A check `resolver` (an IP literal without port, contract `src/schema.ts:357`, `:415`) is passed to `Resolver.setServers`.
- Domain: `src/check-domain.ts:110-215`. It fetches the bootstrap and the RDAP service through `deps.fetch`, and follows up to 3 https redirects to hosts in the bootstrap file. The bootstrap cache and the single-flight map are module-level (`:45`, `:108`).
- Wiring: `src/main.ts:113-205`. The API client (`fetchChecks`, `loadChecks`, `postResult`) and the check scheduler (`startCheckScheduler`, `src/check-scheduler.ts:263-281`) both get the global `fetch`. The default API URL is loopback (`src/settings.ts:15`). So blocking at the global `fetch` would break normal operation.
- Heartbeat checks are dropped before scheduling (`src/client.ts`). They open no connection.

## Runtime facts checked for this spec (Bun 1.4.0, the version pinned in probe `package.json:8-10`)
These were checked with scratch scripts against local servers on `127.0.0.1` in this run:
1. `fetch("https://127.0.0.1:<port>/", { headers: { host: "a.test:<port>" }, tls: { serverName: "a.test" } })`: the server sees SNI `a.test` and `Host: a.test:<port>`. The certificate is verified against `a.test`. Without a trusted CA the request fails with `DEPTH_ZERO_SELF_SIGNED_CERT`. With a CA but `serverName: "b.test"` it fails with `ERR_TLS_CERT_ALTNAME_INVALID`, also when a connection with `serverName: "a.test"` to the same IP and port was pooled just before. Without `serverName`, the certificate is checked against the IP and fails. Types: `BunFetchRequestInit.tls` (`bun-types@1.4.0` `globals.d.ts:1930-1934`), `TLSOptions.serverName` (`bun.d.ts:4305`).
2. `fetch("http://127.0.0.1:<port>/", { headers: { host: "a.test" } })` sends `Host: a.test`.
3. Bun's fetch uses `HTTP_PROXY` and `HTTPS_PROXY` from the environment. `proxy: ""` and `proxy: undefined` do not turn this off. Only `NO_PROXY` does.
4. `node:net` `BlockList`: `addSubnet("127.0.0.0", 8, "ipv4")` also matches `check("::ffff:127.0.0.1", "ipv6")` and `check("::ffff:7f00:1", "ipv6")`. `fd00::1` matches `fc00::/7`, and `fe00::1` does not.
5. WHATWG `new URL(...).hostname`: `http://2130706433/`, `http://0x7f.1/`, `http://017700000001/` and `http://127.1/` all give `127.0.0.1`. `http://0/` gives `0.0.0.0`. `http://[::ffff:127.0.0.1]/` gives `[::ffff:7f00:1]`. `http://[0:0:0:0:0:0:0:1]/` gives `[::1]`.
6. `node:dns/promises` `lookup(host, { all: true })`: `localhost` gives `::1` and `127.0.0.1`. `2130706433`, `0x7f.1` and `127.1` give `127.0.0.1`. `nonexistent.invalid` rejects with code `ENOTFOUND`.
7. `net.connect` to `0.0.0.0` and to `::` reaches a server that listens on `::` on the same host, so unspecified addresses must be blocked. `::7f00:1` (IPv4-compatible) answered `ECONNREFUSED` instead of a routing error, so the deprecated `::/96` block is blocked too.

## Scope
Only `pulse-probe`: the setting, a pure address classifier, guarded check transports that connect only to validated addresses, wiring them into check execution, tests, `README.md` and `docs/`.

## Non-goals
- No per-check override, allow-list, Console control, API field or hosted-mode switch. Hosted enforcement (#460) comes later.
- No change to contract, kit, api, status, notify, console, config, deploy or website. `Result.reason` already exists (contract `src/schema.ts:481`).
- No validation of a DNS check's answers. An A or AAAA record with a private address is data, not a connection.
- No restriction on the pulse-api connection (load, reload, `POST /results`, the buffer), on the system DNS resolver or on the health listener.
- No change when the setting is off: same transports, same reasons, same redirects, byte for byte.
- No new runtime dependency (only `node:net`, `node:dns/promises`, and Bun's `fetch`).

## Decisions on the open points of the issue review
1. **Setting.** One environment variable, `PULSE_PROBE_BLOCK_PRIVATE_RANGES`, read once at startup with kit's `readBool(env, name, false)` (kit `src/settings.ts:119-125` at the pinned `fa79ba8`, exported from `src/index.ts:32`; identical in the kit clone). Accepted values: `true`, `1`, `false`, `0`, after trim. Unset or blank means `false`. Any other value (for example `TRUE`, `yes` or `on`) stops the start with exit code 2 and the line `pulse-probe: PULSE_PROBE_BLOCK_PRIVATE_RANGES: must be true, false, 1 or 0` (kit `invalid()` at `src/settings.ts:19-21`, and kit `runService` exits 2 on a `StartupError`). A change needs a restart. The setting applies to every scheduled check, including checks added or changed by a reload.
2. **Where it lives.** Probe only. The classifier is a few lines on top of the `node:net` built-in `BlockList`. The address list is probe policy, and no second consumer exists today. So no kit change is needed. If the hosted integration later needs the classifier in api, that spec moves it to kit.
3. **Blocked address set.** This exact set, no more. Every address is first normalized: brackets removed, a `%zone` suffix removed, IPv4-mapped IPv6 (`::ffff:a.b.c.d`) classified as its IPv4 address (BlockList does this, fact 4). The first matching category in this order wins:

   | Category (reason word) | IPv4 | IPv6 |
   | --- | --- | --- |
   | `metadata` | `169.254.169.254` (AWS, Azure, GCP, OCI and others), `100.100.100.200` (Alibaba Cloud), `168.63.129.16` (Azure platform/WireServer) | `fd00:ec2::254` (AWS IMDS IPv6) |
   | `unspecified` | `0.0.0.0/8` | `::/128` |
   | `loopback` | `127.0.0.0/8` | `::1/128` |
   | `link-local` | `169.254.0.0/16` | `fe80::/10` |
   | `private` | `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10` (shared address space, RFC 6598: CGNAT, also used by overlay VPNs) | `fc00::/7` (unique local), `fec0::/10` (deprecated site-local) |
   | `reserved` | none | `::/96` without `::` and `::1` (deprecated IPv4-compatible) |

   Provider references for the metadata literals (the implementer links them in the docs): AWS "Access instance metadata" (`docs.aws.amazon.com/AWSEC2/latest/UserGuide/instancedata-data-retrieval.html`), Azure Instance Metadata Service (`learn.microsoft.com/azure/virtual-machines/instance-metadata-service`), Azure "What is IP address 168.63.129.16" (`learn.microsoft.com/azure/virtual-network/what-is-ip-address-168-63-129-16`), Google Cloud "Query VM metadata" (`cloud.google.com/compute/docs/metadata/querying-metadata`), Oracle Cloud "Getting instance metadata" (`docs.oracle.com/iaas/Content/Compute/Tasks/gettingmetadata.htm`), Alibaba Cloud "Instance metadata" (`alibabacloud.com/help/ecs/user-guide/view-instance-metadata`). The list names these endpoints. It does not claim to cover every provider. A metadata service on another address is blocked only when it falls in one of the ranges above. Most do, because they sit in `169.254.0.0/16` or `fc00::/7`.

   **Not blocked** (documented as such): multicast (`224.0.0.0/4`, `ff00::/8`), broadcast and reserved `240.0.0.0/4`, the documentation ranges (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`, `2001:db8::/32`), benchmarking `198.18.0.0/15`, `192.0.0.0/24`, NAT64 `64:ff9b::/96` (RFC 6052 §3.1 forbids gateways to translate the well-known prefix to non-global IPv4), 6to4 `2002::/16` and Teredo `2001::/32`. These are not private networks in the sense of this issue. TCP checks to them fail or leave the host as today. The tests use `203.0.113.0/24` and `2001:db8::/32` as "public" fixtures for this reason.
4. **Resolution constrains the connection.** With the setting on, each check connection works like this:
   - If the host is an IP literal (after URL normalization, fact 5), it is classified.
   - Otherwise it is resolved with `lookup(host, { all: true })` (system resolver, `/etc/hosts` included, fact 6), and every returned address is classified. If any address is blocked, the whole target is blocked (a mixed answer is blocked). An empty answer gives `ENOTFOUND`. An address that `net.isIP` does not recognize blocks the target with the category `unrecognized` (fail closed).
   - The connection is opened to a validated IP literal, never to the name, so no second lookup inside fetch or the socket can return a different address. The original name is kept for the HTTP `Host` header (`URL.host`, with the port when it is not the default), for HTTPS `tls.serverName` (fact 1: SNI and certificate verification against the name stay as today) and for the TLS check `servername`.
   - The addresses are tried in lookup order. The next address is tried only when connecting failed with `ECONNREFUSED`, `EHOSTUNREACH`, `ENETUNREACH` or `EADDRNOTAVAIL` (after the existing `errorCode` mapping in `src/attempt.ts:14-22`, so Bun's `ConnectionRefused` counts), so no request was sent. The last error is reported. All tries share the attempt's deadline.
   - A pooled connection can only be one to the same validated IP, port and `serverName` (fact 1). The policy never sees a connection it did not validate.
   - Proxy: Bun's fetch still honors `HTTP_PROXY`/`HTTPS_PROXY` (fact 3). This is unchanged and treated as operator infrastructure, like the system resolver. The proxy only receives the validated IP literal as the target, so it cannot resolve a name to a private address. A side effect when the setting is on: `NO_PROXY` entries that name hosts no longer match, because the URL holds an IP. This is documented.
   - The lookup runs within the attempt's deadline: it races the attempt's abort signal, and an abort gives the existing `timeout after <n>ms` reason. The TLS check's connect gets the remaining time (`timeoutMs` minus the lookup time on the injected monotonic clock, at least 1 ms).
5. **Meaning per check type** (setting on):

   | Check | Subject to the policy |
   | --- | --- |
   | HTTP (`type` `http` or omitted) | The initial URL and every hop that the existing redirect rules would follow. Same-origin hops are resolved again. |
   | TLS | `host` of the certificate connection. |
   | TCP | `host` of the connection. |
   | DNS | An explicit `resolver` literal, before any query is sent. The system resolver (no `resolver`) is not checked. The queried name and the answers are not checked. |
   | Domain | The bootstrap URL, the RDAP service URL and every RDAP redirect hop that the existing rules allow. Background bootstrap refreshes included, because they use the same guarded fetch. |
   | Heartbeat | Nothing. It is still dropped before scheduling. |
6. **Other traffic.** Only the check scheduler gets the guarded transports. The API client, the result buffer and the health listener keep the raw `fetch` and their sockets. With the setting off, `main.ts` passes exactly what it passes today.
7. **Redirects and shared state.** The existing rules stay first and unchanged: scheme, secret-bearing same-origin rule, method rule, the 20-hop limit, `expectedStatus` judging, RDAP https and bootstrap-host rule, the 3-hop RDAP limit. The policy can only reject further. A hop that the existing rules refuse is not resolved. Each hop calls the guarded fetch, which resolves and validates again. The bootstrap cache holds parsed URLs, not connections, and every fetch of a cached service URL is validated again. The setting is process-wide, so no unguarded caller in the same process can fill the single-flight bootstrap fetch.
8. **Blocked result.**
   - The result is `status: "down"`, as a normal failed attempt. The scheduler goes on, nothing crashes, and the check is never `up`.
   - The reason is `blocked: <category> address (PULSE_PROBE_BLOCK_PRIVATE_RANGES)`. On an HTTP redirect hop (hop 1 or later) and on an RDAP redirect hop it is `redirect blocked: <category> address (PULSE_PROBE_BLOCK_PRIVATE_RANGES)`. `<category>` is one of `metadata`, `unspecified`, `loopback`, `link-local`, `private`, `reserved`, `unrecognized`.
   - The reason holds no host, IP, URL, path, query, header or body. The resolved address of an internal name is network detail that should not reach the status page.
   - `statusCode`: `null` for a blocked initial HTTP target. For a blocked HTTP redirect hop it is the 3xx status of the answer that redirected, as for the existing `redirect to … not followed` stops. It is `null` for TCP, TLS, DNS and domain (unchanged convention).
   - `certDaysLeft` is `null` for TLS and domain.
   - These reasons are set where the transport is called: `fetchFollowing` and `fetchRdap` know the hop number, and the TCP, TLS, DNS and domain catch paths match the typed error. The generic `errorCode(err) ?? "request error"` and RDAP catch paths must not swallow them.
   - Retries stay as they are (`retries`, interval budget). Every attempt runs the policy again and sends nothing to the blocked address.
   - No new per-check log line. One `info` line at startup when the setting is on: `blocking check connections to private addresses (PULSE_PROBE_BLOCK_PRIVATE_RANGES)`.

## Required behavior (summary)
1. Setting off (unset, blank, `false`, `0`): identical to `50ec9ca` for every check type, reason and redirect rule. Existing tests pass unchanged.
2. Setting on: no TCP connection, TLS handshake, HTTP request or DNS query reaches an address in the blocked set (decision 3), whether the address comes from a literal, from DNS or from a redirect. Allowed (public) destinations still work: same Host, SNI and certificate verification as today.
3. A blocked target gives a `down` result with the reason and `statusCode` from decision 8.
4. API traffic, results and reload still work over loopback with the setting on.
5. A bad value exits 2 with the line from decision 1.
6. `README.md` and `docs/configuration.md` document the setting (see the repository section).

## Risks
- **Lost multi-address behavior.** Fetch to an IP literal cannot use Bun's own address selection. Decision 4 tries the next validated address only on connection errors. A host whose first address times out (no `ECONNREFUSED`) can be reported down when the setting is on. This is documented as a known limit.
- **DNS cost and threads.** `lookup` uses getaddrinfo in the libuv thread pool and skips Bun's fetch DNS cache, so with the setting on each attempt resolves once. The lookup is in the check's measured `latencyMs`, as fetch's own lookup is today. An abandoned slow lookup (deadline passed) keeps a pool thread until the system resolver times out. This is bounded by `/etc/resolv.conf` and documented.
- **Reason changes when on.** A failed name gives the `lookup` error code (`ENOTFOUND`) instead of whatever Bun's fetch reported. This happens only with the setting on.
- **`NO_PROXY` by host name** stops matching when the setting is on (decision 4).
- **Azure DNS at `168.63.129.16`** as an explicit DNS-check `resolver` is blocked when the setting is on. The system resolver is not affected. This is documented.
- **Module-level bootstrap cache in tests.** Each new domain test must use its own bootstrap URL so that cached maps do not leak between tests.

## Performance impact
`bench/budgets.json` exists in pulse-api `main` and has a `probe` section: `startup_cpu_ms` (377), `load_cpu_s` (0.5), `idle_rss_mib` (79), `peak_rss_mib` (83), `test_cpu_s` (2.3), and the reported `startup_wall_ms` and `image_mb`. The bench stack (`api/bench/compose.bench.yaml:27-43`) does not set the new variable, so it runs the off path.
- `startup_cpu_ms`, `startup_wall_ms`, `idle_rss_mib`, `peak_rss_mib`, `load_cpu_s`: none expected. The off path adds one env read and loads two small modules. No per-check work changes.
- `image_mb`: none expected. No dependency, only a few kB of source.
- `test_cpu_s` (probe, gating, 2.3 s): it rises from the new tests. Most use fakes. A few real-socket tests run on `127.0.0.1:0`, plus at most one new child-process test in `src/main.test.ts` (one spawned probe, which costs most). Target: under +0.3 s. The HTTPS test generates its certificate with the existing `openssl` helper pattern of `src/tls.test.ts:15-27`. Generate it once per file.
- API metrics (`p95_*`, `rps`, cold reads): not touched. api does not change.
- When the setting is on (not benchmarked), each check attempt costs one `getaddrinfo` instead of Bun's cached lookup, a sub-millisecond to few-millisecond cost per attempt.
- Measure: in the probe checkout, run `bun run test` on `50ec9ca` and on the branch head under `/usr/bin/time -f "%U %S"`, three times each. Report the median user+sys of each and the difference, against the 2.3 s budget. `bun bench/run.ts` A/B takes api refs (`api/bench/README.md:54-59`), so it does not isolate a probe branch. A full-stack run is not required, because the bench runs the off path.

## Security impact
Security impact: yes. The change touches the probe HTTP client and its redirects, the probe's TCP/TLS/DNS connections, error texts built from external data (resolved addresses), and the env validation at startup.

Checklist items that apply:
- **SSRF and redirects.** This is the purpose of the change. Hostile inputs for the security state: decimal, hex, octal and short IPv4 spellings in URLs and TCP hosts; bracketed and IPv4-mapped IPv6; `%zone` suffixes; `0.0.0.0`, `::`, `[::]`; names that resolve to a mixed public/private set; a name whose answer changes between hops (DNS rebinding); a redirect chain public → public → private; a 307 POST same-origin redirect after a DNS change; an RDAP redirect to a bootstrap-listed host that resolves to `10.x`; a redirect `Location` with credentials; `localhost.` with a trailing dot; `HTTP(S)_PROXY` set. In every case the blocked address receives zero bytes.
- **Secrets in errors, logs and responses.** Blocked reasons hold only a fixed category word (decision 8): no URL, query, userinfo, header value, body, host or IP. A test uses sentinel values in the URL query, userinfo, a header and the body, and asserts that none of them shows up in the reason or the probe's stdout/stderr.
- **Input validation.** The env value is parsed by kit `readBool`, which fails closed with exit 2 on unknown spellings. Check fields are already validated by the contract. The probe still does not trust them: addresses are classified after normalization.
- **Dependency pins.** No new dependency and no pin change.

Not applicable: admin routes and auth (no route), body and size limits (unchanged), accessor execution (none), file writes (none).

## Rollout order
One repository: only pulse-probe changes. No contract, kit or config pin moves. No wire shape changes: a blocked check posts a normal `Result` with `status: "down"` and a `reason` of fewer than 80 characters, which any api version accepts (reason limit 1000). The default is off, so a probe image built from this change behaves as today until an operator sets the variable. Older probes ignore the unknown variable. Deploy and website need no change. The website renders the probe's docs from its repository when it builds.

## Counterexamples
- **Classifier boundaries** (literal fixtures in the test, never computed by the classifier):
  - `9.255.255.255` allowed, `10.0.0.0` private, `10.255.255.255` private, `11.0.0.0` allowed.
  - `172.15.255.255` allowed, `172.16.0.0` private, `172.31.255.255` private, `172.32.0.0` allowed.
  - `192.167.255.255` allowed, `192.168.0.1` private, `192.169.0.0` allowed.
  - `100.63.255.255` allowed, `100.64.0.0` private, `100.127.255.255` private, `100.128.0.0` allowed. `100.100.100.200` metadata.
  - `126.255.255.255` allowed, `127.0.0.1` loopback, `127.255.255.254` loopback, `128.0.0.0` allowed.
  - `169.253.255.255` allowed, `169.254.0.1` link-local, `169.254.169.254` metadata (not link-local: precedence), `169.255.0.0` allowed.
  - `0.0.0.0` unspecified, `0.255.255.255` unspecified, `1.0.0.0` allowed.
  - `168.63.129.15` allowed, `168.63.129.16` metadata, `168.63.129.17` allowed.
  - `::` unspecified, `::1` loopback, `::2` reserved, `::ffff:ffff` reserved, `::1:0:0` allowed.
  - `::ffff:127.0.0.1` loopback, `::ffff:7f00:1` loopback, `::ffff:10.0.0.1` private, `::ffff:169.254.169.254` metadata, `::ffff:8.8.8.8` allowed.
  - `fbff:ffff:ffff:ffff:ffff:ffff:ffff:ffff` allowed, `fc00::1` private, `fdff:ffff::1` private, `fd00:ec2::254` metadata.
  - `fe7f:ffff::1` allowed, `fe80::1` link-local, `fe80::1%eth0` link-local, `febf:ffff::1` link-local, `fec0::1` private, `feff::1` private, `ff02::1` allowed.
  - `203.0.113.10`, `8.8.8.8`, `2001:db8::1`, `2606:4700::1111` allowed.
  - A wrong implementation that compares strings (`startsWith("10.")`) fails `::ffff:10.0.0.1`. One that only checks `fc00::/8` fails `fd00::1`. One that blocks `0.0.0.0` but not `0.255.255.255` fails the `0.0.0.0/8` case.
- **URL spellings** with the setting on, a real `fetch` and a local server on `127.0.0.1:<port>`, where the server must see zero requests: `http://2130706433:<port>/`, `http://0x7f.1:<port>/`, `http://127.1:<port>/`, `http://[::ffff:127.0.0.1]:<port>/` all give `blocked: loopback address (PULSE_PROBE_BLOCK_PRIVATE_RANGES)`. `http://0:<port>/` gives `blocked: unspecified address (...)`.
- **Mixed answer.** `lookup("mixed.test")` returns `203.0.113.10` and `10.0.0.5`. Result: `blocked: private address (...)`, and the underlying fetch is called 0 times. A wrong implementation that picks the first public address and connects passes a "reachable" test but fails this one.
- **DNS change between hops.** `lookup("flip.test")` returns `203.0.113.10` on the first call and `127.0.0.1` on the second. The first fetch (to `http://203.0.113.10/` with `Host: flip.test`) answers `302 Location: /next`. Result: `redirect blocked: loopback address (...)`, `statusCode` 302, the underlying fetch is called exactly once and `lookup` exactly twice. A wrong implementation that validates once per check fails this.
- **Validation vs connection.** The underlying fetch receives a URL whose hostname is the validated literal (`203.0.113.10`), with `host` header `flip.test` and, for https, `tls.serverName` `flip.test`. A wrong implementation that validates and then passes the hostname URL to fetch (second lookup inside fetch) fails this assertion.
- **Fallback.** `lookup` returns `2001:db8::1` and `203.0.113.10`. The fetch to the first address rejects with an error whose code is `ECONNREFUSED`, and the second answers 200. Result `up`, 2 fetch calls, both to validated literals. If the first rejects with a `TimeoutError` instead, there is no second call and the reason is `timeout after <n>ms`. If `lookup` returns `203.0.113.10` and `10.0.0.5`, nothing is tried (mixed rule), not even the public one.
- **Existing rules stay first.** A check with a header, redirected cross-origin to `http://10.0.0.5/`, keeps today's reason `redirect to http://10.0.0.5 not followed`. The policy does not run and `lookup` is not called for the hop. A redirect to `file:///etc/passwd` keeps `redirect to file: not followed`.
- **Setting off.** The same fixtures as the three acceptance cases (loopback literal, name resolving to private, redirect to private) behave as today: a local target answering 200 gives `up`, the redirect is followed to the local server, which records 1 hit.
- **Env parsing.** `true`, `1`, ` true ` mean on. `false`, `0`, unset and `""` mean off. `TRUE`, `yes`, `on` and `2` exit 2 with `pulse-probe: PULSE_PROBE_BLOCK_PRIVATE_RANGES: must be true, false, 1 or 0`.
- **DNS check.** `resolver: "127.0.0.53"` gives `blocked: loopback address (...)`, and the injected `resolve` is called 0 times. `resolver: "8.8.8.8"` calls `resolve` once. No `resolver` calls `resolve` once (system DNS is trusted). An answer `A 10.0.0.1` with `expected: ["10.0.0.1"]` is still `up`.
- **Domain.** A bootstrap URL that resolves to `127.0.0.1` gives `blocked: loopback address (...)` with 0 fetch calls. An allowed bootstrap whose service host resolves to `192.168.1.1` gives `blocked: private address (...)`, with exactly 1 fetch call (the bootstrap). An allowed service that answers `302` to a bootstrap-listed host that resolves to `10.1.1.1` gives `redirect blocked: private address (...)`. The redirect host must be bootstrap-listed so that the host allow-list is not what stops it.

There is no statistic in this change.

## Contract fields
No new field, key or route in the contract or config. The new names are internal to pulse-probe:
- Environment variable `PULSE_PROBE_BLOCK_PRIVATE_RANGES`. `grep -rn 'PULSE_PROBE_BLOCK_PRIVATE_RANGES\|BLOCK_PRIVATE' .repos/contract/src .repos/config .repos/kit/src .repos/probe/src .repos/api/src .repos/deploy` gives no hit.
- Settings field `blockPrivateRanges`. `grep -rn 'blockPrivateRanges' .repos/contract/src .repos/config .repos/kit/src .repos/probe/src` gives no hit.
- Error class `BlockedTargetError`, modules `address-policy.ts`, `guarded-transport.ts` and `pinned-fetch.ts`. `grep -rn 'BlockedTargetError\|address-policy\|guarded-transport\|pinned-fetch' .repos/contract/src .repos/kit/src .repos/probe/src` gives no hit.
- Reason prefixes `blocked:` and `redirect blocked:`. `grep -rn 'blocked:' .repos/contract/src .repos/kit/src .repos/probe/src .repos/api/src` gives no hit.

## Repository: probe
Files:
- `src/settings.ts`: `blockPrivateRanges: boolean` via kit `readBool(env, "PULSE_PROBE_BLOCK_PRIVATE_RANGES", false)`.
- `src/settings.test.ts`: the env parsing cases from Counterexamples.
- `src/address-policy.ts` (new): `BlockedCategory` union, `blockedCategory(address: string): BlockedCategory | null` (pure, built on per-category `BlockList`s in the decision-3 order, with normalization), `BlockedTargetError` (`name = "BlockedTargetError"`, carries `category`), `blockedReason(category, isRedirect): string`.
- `src/address-policy.test.ts` (new): the classifier boundary table with literal expected categories.
- `src/pinned-fetch.ts` (new): sends one request to a given validated IP literal and keeps the name. It sets the URL hostname to the literal (bracketed for IPv6), the `host` header to the original `URL.host`, and `tls.serverName` to the original hostname for `https:` when the hostname is not a literal. For a literal URL it changes nothing. The other `init` fields pass through. The underlying fetch is typed `(input: string, init: BunFetchRequestInit) => Promise<Response>`.
- `src/pinned-fetch.test.ts` (new): real sockets on `127.0.0.1:0`. HTTP: the server sees `Host: pinned.test:<port>`. HTTPS: a server whose certificate (from `openssl`, SAN `DNS:pinned.test`) is self-signed records the SNI it receives in `SNICallback` as `pinned.test`, and the real fetch rejects with a certificate verification error. This proves that SNI is kept and that verification is still on.
- `src/guarded-transport.ts` (new): `createGuardedTransport(deps)` with `deps = { fetch, lookup, tcpConnect, tlsConnect, resolve, monotonic }` returns `{ fetch, tcpConnect, tlsConnect, resolve }` with the same types as `CheckDeps`. It does the resolve, classify, mixed-reject, fallback and deadline steps of decision 4, and throws `BlockedTargetError`. The real `lookup` (`systemLookup`, `node:dns/promises` `lookup(host, { all: true })`) is exported beside it.
- `src/guarded-transport.test.ts` (new): fakes for `lookup` and the underlying transports. It covers the mixed answer, the DNS change between calls, fallback rules, IPv6 literals, zone ids, the lookup deadline (an abort signal fired before `lookup` settles gives the timeout error, with no transport call), the DNS `resolver` rule, and the TLS remaining-time rule.
- `src/check.ts`: `TlsConnectOptions` gets an optional `servername`. `tlsConnect` uses it when given, else today's rule (`:46`). `fetchFollowing` maps `BlockedTargetError` to the stop of decision 8 (`blocked:` on hop 0 with `statusCode: null`, `redirect blocked:` with the previous 3xx status after). `runTlsCheck` maps it in its catch.
- `src/check-tcp.ts`, `src/check-dns.ts`, `src/check-domain.ts`: map `BlockedTargetError` to its reason in the catch paths (`fetchRdap` marks redirect hops). Nothing else changes in their off path.
- `src/check-scheduler.ts`: `CheckSchedulerDeps` gets optional `tcpConnect`, `tlsConnect` and `resolve`, passed through to `runCheck`.
- `src/main.ts`: when `settings.blockPrivateRanges` is on, it builds the guarded transport from the real `fetch`, `systemLookup`, `tcpConnect`, `tlsConnect`, `resolveRecords` and `monotonic`, passes it only to `startCheckScheduler`, and logs the `info` line. When the setting is off, it passes the same arguments as today. API calls keep the raw `fetch`.
- `src/check.private-ranges.test.ts` (new): the three acceptance cases and the per-type cases through `runCheck` (see Checks).
- `src/main.test.ts`: a bad value exits 2 (add to the table at `:65-72`). One new end-to-end test (see Checks).
- `README.md`: the line at `:36` names the setting and links the docs.
- `docs/configuration.md`: a row in the env table (`:7-18`). Rewrite "Network reach of checks" (`:189-208`): replace "There is no deny list in the code" with a subsection on the setting (default, values, restart, address table with categories and the not-blocked list, what each check type checks, the DNS/system-resolver/API/proxy exceptions, the reason texts and `statusCode`, the known limits from Risks, and the provider references).
- `docs/troubleshooting.md`: an entry for a check that is down with `blocked: … (PULSE_PROBE_BLOCK_PRIVATE_RANGES)`.

Behavior change: yes. A new setting changes which connections checks may open. With the setting off, behavior stays as today.

### Tool facts (verified)
- Bun 1.4.0: probe `package.json:8` (`packageManager`), `:10` (`engines.bun`). CI installs it: pinned `lorenzh/pulse-config/.github/workflows/check.yml@dc69a126` lines 22-24 (`setup-bun` with `bun-version: 1.4.0`), used by probe `.github/workflows/ci.yml:18`. The pinned file is identical to the config clone.
- CI steps (pinned `check.yml` above): `bun install --frozen-lockfile` (:26), `bun run lint` (:28), `bun run typecheck` (:30), `bun run test` (:38). Probe `bun run check` = lint, typecheck, test (`package.json:19`). Lint is `biome check . && pulse-eslint .` (`package.json:16`).
- Biome: probe `biome.json` extends `@lorenzh/pulse-config/biome.json`. In the pinned `dc69a126` copy (identical to the clone), `files.includes` (lines 10-17) covers all of `src/`, and `noExplicitAny` and `noNonNullAssertion` are errors (lines 45-50). The latter is off for `**/*.test.ts` (lines 53-60). Biome is `2.6.3` (`package.json:22`).
- Coverage: `bunfig.toml:1-4`, `[test]` `coverage = true`, `coverageThreshold = { lines = 0.8 }`. The new modules must keep the total at 80 % or more.
- `@types/bun` `1.4.0` (`package.json:24`) declares `BunFetchRequestInit.tls.serverName` (bun-types 1.4.0 `globals.d.ts:1930-1934`, `bun.d.ts:4305`).

### Checks
Write the tests first and record that they fail on `50ec9ca` for the intended reason: the target is reached or the result is `up`, not just a missing export. For the record, the first failing run may import the new modules through a stub that does nothing (no blocking).

1. **Acceptance (`src/check.private-ranges.test.ts`, setting on through the guarded transport):**
   a. A real `fetch` to `http://127.0.0.1:<port>/` of a local server: `status` `down`, `reason` `blocked: loopback address (PULSE_PROBE_BLOCK_PRIVATE_RANGES)`, `statusCode` `null`, server hits `0`.
   b. `http://internal.test:<port>/`, where the fake `lookup` returns `10.0.0.5`: `down`, `blocked: private address (...)`, underlying fetch calls `0`.
   c. `http://public.test/`, where the fake `lookup` returns `203.0.113.10`, is answered by the fake transport with `302 Location: http://internal.test/` (lookup returns `192.168.1.20`). The check has no headers and no body, so the cross-origin rule does not stop it. Result: `down`, `redirect blocked: private address (...)`, `statusCode` `302`, exactly 1 fetch call (to `203.0.113.10`).
   d. The same three fixtures with the setting off (unguarded deps, as `main.ts` passes them today) and with the setting `false`: a. gives `up` with 1 server hit. For b. and c., use real local servers (the redirect goes to a second local server), which give `up` and 1 hit on the redirect target.
2. **Per type (setting on):**
   - TCP and TLS checks to `127.0.0.1:<port>` of real local servers: `down`, `blocked: loopback address (...)`, 0 connections accepted by the server. TLS `certDaysLeft` is `null`.
   - TCP and TLS checks to a name resolving to `10.0.0.5` (fake lookup, fake connect): 0 connect calls.
   - TLS to a name resolving to `203.0.113.10`: the fake `tlsConnect` gets `host: "203.0.113.10"` and `servername` set to the name.
   - DNS: the resolver cases from Counterexamples.
   - Domain: the three cases from Counterexamples, each with its own bootstrap URL.
   - An HTTP check to `http://public.test/` (lookup `203.0.113.10`) that answers 200 is `up`.
   - The heartbeat skip test in `client` stays green and unchanged.
3. **Secrets.** A check URL `http://user:pw-sentinel@internal.test/?q=query-sentinel` with header `x-k: header-sentinel` and body `body-sentinel` is blocked. Its reason contains none of the four sentinels, no `internal.test` and no `10.0.0.5`.
4. **End-to-end (`src/main.test.ts`):** spawn the real probe with `PULSE_PROBE_BLOCK_PRIVATE_RANGES=true`, `PULSE_CHECKS_RELOAD_MS=5000` and a fake API on `127.0.0.1:0`. The first `/probe/checks` answer is one HTTP check to a local target server `http://127.0.0.1:<port>/?secret=e2e-sentinel`. Assert that a posted result has `status: "down"` and `reason: "blocked: loopback address (PULSE_PROBE_BLOCK_PRIVATE_RANGES)"`, and that the target has 0 hits. Then the fake API answers the next load with an added TCP check to the target's port. Assert that this check also posts `down` with the same reason, and that the target still has 0 hits and 0 connections. Assert that `e2e-sentinel` is not in stdout/stderr, and that the startup `info` line is present. The API calls themselves succeed over loopback, so the policy does not touch them. The test sets an explicit timeout above the 5 s reload (for example `{ timeout: 20_000 }`). It waits with the existing `until` helper, extended by a deadline parameter. Add `PULSE_PROBE_BLOCK_PRIVATE_RANGES: "yes"` to the bad-value table.
5. **Regression.** Every existing test passes unchanged, among them `src/check.redirect.test.ts` (secret-bearing redirect rules), `src/tls.test.ts` (SNI), `src/check.domain.test.ts` and `src/check.dns.resolver.test.ts`.
6. `bun run check` passes, coverage at 80 % or more (`bunfig.toml:3`), cognitive complexity at 15 or less, with no new disable comment.
7. Manual run before handoff (AGENTS.md "End-to-end checks"): `PULSE_PROBE_BLOCK_PRIVATE_RANGES=true bun run start` against a local fake API serving a check to `http://127.0.0.1:<port>/`. Report the posted result and the startup line.

### Completion evidence
- The red run of the tests in Checks 1–4 on `50ec9ca` with its failure reasons (target reached or `up`). Then the green run.
- Full `bun run check` output and green CI on the PR.
- The `test_cpu_s` measurement from Performance impact (median user+sys on `50ec9ca` and on the branch, and the difference).
- The docs diff: the setting row, the rewritten network-reach section without "There is no deny list in the code", and the troubleshooting entry.
- The manual run from Check 7.
- Every expected value in the tests is a literal written in the test (status, reason text, status code, call and hit counts, category per address). No expected value is computed by calling `blockedCategory` or `blockedReason`.
