# Spec #574: probe setting that blocks private ranges

## Goal
Self-hosted operators can stop a probe from checking private networks. A new setting, `PULSE_PROBE_BLOCK_PRIVATE_RANGES`, makes the probe refuse every connection that a check would open to a loopback, private, link-local, unspecified, reserved or cloud metadata address. The probe checks this for every check type. It checks the address the connection actually uses, after DNS resolution and on every redirect hop. The default stays "allowed", as decided in #460 (decision 9) for self-hosted installs. Hosted mode, which must always block, is a later integration and not part of this spec.

Sources: issue #574, #460 decision 9, the issue review `.factory/work/574/issue-review.md`, and the plan-review feedback of the previous run (issue comments). Clones that were read: probe `50ec9ca`, contract `ebcbbb6`, kit `6a06ec2` (main), config `dc69a12` (main, the same commit as the probe's pin), api `main` (`bench/`). The probe, api, status, notify and console all pin kit `fa79ba8`. Compared through `gh api .../compare/fa79ba8...6a06ec2`, kit main is 2 commits ahead, and they change only `package.json` and `bun.lock` (exact pins for `@types/node` 26.6.6 and `typescript7` 7.0.2). `src/` and `dist/` are the same.

## Current behavior (probe `50ec9ca`)
- `src/settings.ts` has no network-restriction setting. `docs/configuration.md:189-208` ("Network reach of checks") lists RFC 1918, loopback, link-local (including `169.254.169.254`) and unique-local IPv6 as reachable, and says "There is no deny list in the code". `README.md:36` links that section.
- HTTP checks: `src/check.ts:382-421` (`fetchFollowing`) calls `deps.fetch(url, { redirect: "manual", ... })` once per hop (`:395`) with the hostname URL. Bun's fetch resolves the name itself. Nothing checks addresses. The next hop is computed from the probe's own `url` variable (`hopTarget(location, url)`), never from `res.url`.
- TCP: `src/check-tcp.ts:14-32` calls `net.connect({ host, port })`. TLS: `src/check.ts:40-67` calls `tls.connect({ host, port, servername })`, where `servername` is the host when it is not an IP (`:46`). Both resolve inside the socket call.
- DNS: `src/check-dns.ts:41-57`. A check `resolver` (an IP literal without port, contract `src/schema.ts:415`) is passed to `Resolver.setServers`.
- Domain: `src/check-domain.ts:110-215`. It fetches the bootstrap (`:115`) and the RDAP service (`fetchRdap`, `:189-215`) through `deps.fetch`, and follows up to 3 https redirects to hosts in the bootstrap file. The bootstrap cache and the single-flight map are module-level (`:45`, `:108`). `attemptDomain` maps errors at `:264-269`.
- Wiring: `src/main.ts` passes the global `fetch` to the API client (`:116`, `:143`, `:162`) and to `startCheckScheduler` (`:193-205`). `src/check-scheduler.ts:7-17` (`CheckSchedulerDeps`) has only `fetch`, and `:29` calls `runCheck` with it. The default API URL is loopback (`src/settings.ts:15`). So blocking at the global `fetch` would break normal operation.
- The contract forbids a `host` request header on checks (contract `src/schema.ts:81-82`).
- Heartbeat checks are dropped before scheduling (`src/client.ts`). They open no connection.

## Runtime facts checked for this spec (Bun 1.4.0)
Bun 1.4.0 is the runtime of both targets (probe `package.json:8-10`, kit `package.json:8`, `:45`). Facts 1-3 were checked again in this run with a scratch script outside the repositories: a `node:https` server on `127.0.0.1:0`, a self-signed certificate with `subjectAltName=DNS:pinned.test` made by one `openssl req -x509` call (OpenSSL 3.0.13), and the real `fetch` to `https://127.0.0.1:<port>/`, each case also in a fresh process. The server read SNI from `req.socket.servername`. In Bun, `SNICallback` on a `node:https` server was not called, so the tests must not rely on it.
1. **HTTPS name rules.**
   - `headers: { host: "pinned.test:<port>" }` with `tls: { serverName: "pinned.test", ca: <cert> }` answers 200. The server sees SNI `pinned.test` and `Host: pinned.test:<port>`.
   - `serverName: "other.test"` with the same `ca` rejects with code `ERR_TLS_CERT_ALTNAME_INVALID`. This also happens when it comes right after a successful `pinned.test` request to the same IP and port (pooled). A third `pinned.test` request then answers 200 on the pooled socket: 3 requests opened 2 server sockets. So the pool is keyed by `serverName`.
   - `serverName: "127.0.0.1"` (the pinned IP) rejects with `ERR_TLS_CERT_ALTNAME_INVALID`.
   - `serverName` takes precedence over `Host`: `Host: other.test`, `serverName: "pinned.test"` answers 200, and the reverse rejects.
   - Without `serverName`, Bun takes the SNI and the verification name from the `Host` header (200 for `Host: pinned.test`). With neither, the IP is used and the request rejects with `ERR_TLS_CERT_ALTNAME_INVALID`. The earlier version of this spec said "without `serverName` the certificate is checked against the IP". That is wrong when a `Host` header is set. The guard still sets `serverName` explicitly, because it takes precedence.
   - Without `ca`, the request rejects with `DEPTH_ZERO_SELF_SIGNED_CERT`. Certificate verification stays on.
   - Types: `BunFetchRequestInit.tls` (`bun-types@1.4.0` `globals.d.ts:1930-1934`), `TLSOptions.serverName` (`bun.d.ts:4305`). `BunFetchRequestInit` extends `RequestInit` with optional fields only.
2. `fetch("http://127.0.0.1:<port>/", { headers: { host: "a.test" } })` sends `Host: a.test`.
3. Bun's fetch uses `HTTP_PROXY` and `HTTPS_PROXY` from the environment. `proxy: ""` and `proxy: undefined` do not turn this off. Only `NO_PROXY` does. (Previous run.)
4. `node:net` `BlockList`: `addSubnet("127.0.0.0", 8, "ipv4")` also matches `check("::ffff:127.0.0.1", "ipv6")` and `check("::ffff:7f00:1", "ipv6")`. `fd00::1` matches `fc00::/7`, and `fe00::1` does not. (Previous run.)
5. WHATWG `new URL(...).hostname`: `http://2130706433/`, `http://0x7f.1/`, `http://017700000001/` and `http://127.1/` all give `127.0.0.1`. `http://0/` gives `0.0.0.0`. `http://[::ffff:127.0.0.1]/` gives `[::ffff:7f00:1]`. `http://[0:0:0:0:0:0:0:1]/` gives `[::1]`. (Previous run.)
6. `node:dns/promises` `lookup(host, { all: true })`: `localhost` gives `::1` and `127.0.0.1`. `2130706433`, `0x7f.1` and `127.1` give `127.0.0.1`. `nonexistent.invalid` rejects with code `ENOTFOUND`. (Previous run.)
7. `net.connect` to `0.0.0.0` and to `::` reaches a server that listens on `::` on the same host, so unspecified addresses must be blocked. `::7f00:1` (IPv4-compatible) answered `ECONNREFUSED` instead of a routing error, so the deprecated `::/96` block is blocked too. (Previous run.)

## Scope
- **kit:** reusable mechanism without policy. An IP classifier built from caller-given CIDR rules, a resolve-and-validate step, a try-next-address step for connection errors, and a fetch that connects only to a validated address while it keeps the name for Host, SNI and certificate checks. Docs and tests.
- **probe:** the policy and its wiring. The setting, the blocked-address table (built with the kit classifier), the blocked reasons, the guarded check transports (composed from the kit pieces), result mapping in every check type, the kit pin bump, tests, `README.md` and `docs/`.

Probe `AGENTS.md:29` says: "Propose an addition to `pulse-kit` instead of a local helper." Kit `AGENTS.md:30-31` says the same. So everything that another service could reuse goes into kit. That is classification mechanics, resolution, address fallback and pinned fetch; notify webhooks are a likely second user. The probe keeps only what is probe policy: which ranges, which reasons, which check traffic is guarded, and the adapters to its own `CheckDeps` types.

## Non-goals
- No per-check override, allow-list, Console control, API field or hosted-mode switch. Hosted enforcement (#460) comes later.
- No change to contract, api, status, notify, console, config, deploy or website. `Result.reason` already exists (contract `src/schema.ts:481`). api, status, notify and console keep their kit pin `fa79ba8`.
- No validation of a DNS check's answers. An A or AAAA record with a private address is data, not a connection.
- No restriction on the pulse-api connection (load, reload, `POST /results`, the buffer), on the system DNS resolver or on the health listener.
- No change when the setting is off: same transports, same reasons, same redirects, byte for byte.
- No new runtime dependency. kit uses only `node:net`, `node:dns/promises` and Bun's `fetch`.

## Decisions on the open points of the issue review
1. **Setting.** One environment variable, `PULSE_PROBE_BLOCK_PRIVATE_RANGES`. It is read once at startup with kit's `readBool(env, name, false)` (kit `src/settings.ts:119-125`, the same at the pin `fa79ba8` and at main). Accepted values after trim: `true`, `1`, `false`, `0`. Unset or blank means `false`. Any other value (for example `TRUE`, `yes` or `on`) stops the start with exit code 2 and the line `pulse-probe: PULSE_PROBE_BLOCK_PRIVATE_RANGES: must be true, false, 1 or 0` (kit `invalid()`; kit `runService` exits 2 on a `StartupError`, kit `docs/index.md:44-46`). A change needs a restart. The setting applies to every scheduled check, including checks added or changed by a reload.
2. **Where it lives.** The kit/probe split is in Scope. kit has no fixed address list, no setting and no reason text. The probe has no CIDR parsing, no lookup racing, no fallback loop and no URL/Host/SNI rewriting of its own.
3. **Blocked address set (probe policy).** This exact set, no more. The kit classifier normalizes every address first: it removes brackets and a `%zone` suffix, and it classifies IPv4-mapped IPv6 (`::ffff:a.b.c.d`) as its IPv4 address (BlockList does this, fact 4). The first category in this order that matches wins:

   | Category (reason word) | IPv4 | IPv6 |
   | --- | --- | --- |
   | `metadata` | `169.254.169.254` (AWS, Azure, GCP, OCI and others), `100.100.100.200` (Alibaba Cloud), `168.63.129.16` (Azure platform/WireServer) | `fd00:ec2::254` (AWS IMDS IPv6) |
   | `unspecified` | `0.0.0.0/8` | `::/128` |
   | `loopback` | `127.0.0.0/8` | `::1/128` |
   | `link-local` | `169.254.0.0/16` | `fe80::/10` |
   | `private` | `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10` (shared address space, RFC 6598: CGNAT, also used by overlay VPNs) | `fc00::/7` (unique local), `fec0::/10` (deprecated site-local) |
   | `reserved` | none | `::/96` (deprecated IPv4-compatible). `::` and `::1` match earlier rows first. |

   Provider references for the metadata literals (the implementer links them in the docs): AWS "Access instance metadata" (`docs.aws.amazon.com/AWSEC2/latest/UserGuide/instancedata-data-retrieval.html`), Azure Instance Metadata Service (`learn.microsoft.com/azure/virtual-machines/instance-metadata-service`), Azure "What is IP address 168.63.129.16" (`learn.microsoft.com/azure/virtual-network/what-is-ip-address-168-63-129-16`), Google Cloud "Query VM metadata" (`cloud.google.com/compute/docs/metadata/querying-metadata`), Oracle Cloud "Getting instance metadata" (`docs.oracle.com/iaas/Content/Compute/Tasks/gettingmetadata.htm`), Alibaba Cloud "Instance metadata" (`alibabacloud.com/help/ecs/user-guide/view-instance-metadata`). These pages were not fetched again in this run. The list names these endpoints and does not claim to cover every provider. A metadata service on another address is blocked only when it falls in one of the ranges above. Most do, because they sit in `169.254.0.0/16` or `fc00::/7`.

   **Not blocked** (documented as such): multicast (`224.0.0.0/4`, `ff00::/8`), broadcast and reserved `240.0.0.0/4`, the documentation ranges (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`, `2001:db8::/32`), benchmarking `198.18.0.0/15`, `192.0.0.0/24`, NAT64 `64:ff9b::/96` (RFC 6052 §3.1 forbids gateways to translate the well-known prefix to non-global IPv4), 6to4 `2002::/16` and Teredo `2001::/32`. These are not private networks in the sense of this issue. TCP checks to them fail or leave the host as today. The tests use `203.0.113.0/24` and `2001:db8::/32` as "public" fixtures for this reason.
4. **Resolution constrains the connection (kit mechanism).** With the setting on, each check connection works like this:
   - If the host is an IP literal (after URL normalization, fact 5, and after brackets and zone are removed), it is classified.
   - Otherwise it is resolved with the injected lookup. The real one is `node:dns/promises` `lookup(host, { all: true })` (system resolver, `/etc/hosts` included, fact 6). Every returned address is classified. If any address is blocked, the whole target is blocked: a mixed answer is blocked. The error names the category of the first blocked address in answer order. An empty answer rejects with an error whose `code` is `ENOTFOUND`. An address that `net.isIP` does not recognize (after normalization) blocks the target with the category `unrecognized` (fail closed).
   - The connection is opened to a validated IP literal, never to the name, so no second lookup inside fetch or the socket can return a different address. The original name is kept for the HTTP `Host` header (`URL.host`, with the port when it is not the default), for HTTPS `tls.serverName` (fact 1: SNI and certificate checks stay against the name, and `serverName` takes precedence over `Host`), and for the TLS check `servername`.
   - The addresses are tried in lookup order. The next address is tried only when connecting failed with `ECONNREFUSED`, `EHOSTUNREACH`, `ENETUNREACH` or `EADDRNOTAVAIL`, or Bun's `ConnectionRefused`. The code is read from `err.cause.code`, else from `err.code`, like probe `src/attempt.ts:25-34`. In these cases no request was sent. Any other error (timeout, abort, `ECONNRESET`, TLS errors) is thrown at once. With several addresses the last error is reported. All tries share the attempt's signal and deadline.
   - A pooled connection can only be one to the same validated IP, port and `serverName` (fact 1). The guard never reaches a connection it did not validate.
   - Redirects: the guarded fetch accepts only `redirect: "manual"` or `"error"`. Any other value, including an absent one (fetch's default `follow`), is a `TypeError` before any lookup, because fetch would follow a redirect to an address nobody checked. A `Request` object as input, and `unix` or `proxy` in `init`, are also a `TypeError` before any lookup. They would bypass the pinned address.
   - Proxy: Bun's fetch still honors `HTTP_PROXY`/`HTTPS_PROXY` from the environment (fact 3). This is unchanged and treated as operator infrastructure, like the system resolver. The proxy only receives the validated IP literal as the target, so it cannot resolve a name to a private address. A side effect when the setting is on: `NO_PROXY` entries that name hosts no longer match, because the URL holds an IP. This is documented.
   - The lookup races the attempt's abort signal. An abort before the lookup settles rejects with `signal.reason` (a `TimeoutError` for `AbortSignal.timeout`), so the probe's existing `timeout after <n>ms` reason applies. The TLS check's connect gets the remaining time: `timeoutMs` minus the lookup time on the injected monotonic clock, at least 1 ms.
5. **Meaning per check type** (setting on):

   | Check | Subject to the policy |
   | --- | --- |
   | HTTP (`type` `http` or omitted) | The initial URL and every hop that the existing redirect rules would follow. Same-origin hops are resolved again. |
   | TLS | `host` of the certificate connection. |
   | TCP | `host` of the connection. |
   | DNS | An explicit `resolver` literal, before any query is sent. The system resolver (no `resolver`) is not checked. The queried name and the answers are not checked. |
   | Domain | The bootstrap URL, the RDAP service URL and every RDAP redirect hop that the existing rules allow. Background bootstrap refreshes are included, because they use the same guarded fetch. |
   | Heartbeat | Nothing. It is still dropped before scheduling. |
6. **Other traffic.** Only the check scheduler gets the guarded transports. The API client, the result buffer and the health listener keep the raw `fetch` and their sockets. With the setting off, `main.ts` passes exactly what it passes today.
7. **Redirects and shared state.** The existing rules stay first and unchanged: scheme, the secret-bearing same-origin rule, the method rule, the 20-hop limit, `expectedStatus` judging, the RDAP https and bootstrap-host rules, and the 3-hop RDAP limit. The policy can only reject further. A hop that the existing rules refuse is not resolved. Each hop calls the guarded fetch, which resolves and validates again. The bootstrap cache holds parsed URLs, not connections, and every fetch of a cached service URL is validated again. The setting is process-wide, so no unguarded caller in the same process can fill the single-flight bootstrap fetch.
8. **Blocked result (probe policy).**
   - The result is `status: "down"`, as a normal failed attempt. The scheduler goes on, nothing crashes, and the check is never `up`.
   - The reason is `blocked: <category> address (PULSE_PROBE_BLOCK_PRIVATE_RANGES)`. On an HTTP redirect hop (hop 1 or later) and on an RDAP redirect hop it is `redirect blocked: <category> address (PULSE_PROBE_BLOCK_PRIVATE_RANGES)`. `<category>` is one of `metadata`, `unspecified`, `loopback`, `link-local`, `private`, `reserved`, `unrecognized`.
   - The reason holds no host, IP, URL, path, query, header or body. The resolved address of an internal name is network detail that should not reach the status page. The kit error message is `blocked <category> address` and also holds no host or IP.
   - `statusCode`: `null` for a blocked initial HTTP target. For a blocked HTTP redirect hop it is the 3xx status of the answer that redirected, as for the existing `redirect to … not followed` stops. It is `null` for TCP, TLS, DNS and domain (unchanged convention).
   - `certDaysLeft` is `null` for TLS and domain.
   - These reasons are set where the transport is called. `fetchFollowing` and `fetchRdap` know the hop number, and the TCP, TLS, DNS and domain catch paths match `BlockedAddressError` by class. The generic `errorCode(err) ?? "request error"` and RDAP catch paths must not swallow them.
   - Retries stay as they are (`retries`, interval budget). Every attempt runs the policy again and sends nothing to the blocked address.
   - No new per-check log line. One `info` line at startup when the setting is on: `blocking check connections to private addresses (PULSE_PROBE_BLOCK_PRIVATE_RANGES)`.

## Required behavior (summary)
1. Setting off (unset, blank, `false`, `0`): identical to `50ec9ca` for every check type, reason and redirect rule. Existing tests pass unchanged.
2. Setting on: no TCP connection, TLS handshake, HTTP request or DNS query reaches an address in the blocked set (decision 3), whether the address comes from a literal, from DNS or from a redirect. Allowed (public) destinations still work, with the same Host, SNI and certificate checks as today.
3. A blocked target gives a `down` result with the reason and `statusCode` from decision 8.
4. API traffic, results and reload still work over loopback with the setting on.
5. A bad value exits 2 with the line from decision 1.
6. kit exports the primitives of the kit section, documented in kit `docs/index.md`. The probe uses them and pins the kit commit that has them.
7. Probe `README.md` and `docs/configuration.md` document the setting (see the probe section).

## Risks
- **Lost multi-address behavior.** Fetch to an IP literal cannot use Bun's own address selection. Decision 4 tries the next validated address only on connection errors. A host whose first address times out (no `ECONNREFUSED`) can be reported down when the setting is on. This is documented as a known limit.
- **DNS cost and threads.** `lookup` uses getaddrinfo in the libuv thread pool and skips Bun's fetch DNS cache. With the setting on, each attempt resolves once. The lookup counts in the check's measured `latencyMs`, as fetch's own lookup does today. An abandoned slow lookup (deadline passed) keeps a pool thread until the system resolver times out. This is bounded by `/etc/resolv.conf` and documented.
- **Reason changes when on.** A failed name gives the `lookup` error code (`ENOTFOUND`) instead of whatever Bun's fetch reported. This happens only with the setting on.
- **`NO_PROXY` by host name** stops matching when the setting is on (decision 4).
- **Azure DNS at `168.63.129.16`** as an explicit DNS-check `resolver` is blocked when the setting is on. The system resolver is not affected. This is documented.
- **Bun-specific kit module.** The pinned fetch relies on Bun's `tls.serverName` (fact 1). kit runs on Bun 1.4.0 only (kit `package.json:8`), and its docs say that this module needs Bun.
- **Kit pin bump in probe.** The bump also brings the two kit commits after `fa79ba8`, which change only devDependency pins in kit's own `package.json`. They do not reach the probe's install, because a Git dependency's devDependencies are not installed.
- **Module-level bootstrap cache in tests.** Each new domain test must use its own bootstrap URL, so that cached maps do not leak between tests.

## Performance impact
`bench/budgets.json` exists in pulse-api `main`. The bench stack (`api/bench/compose.bench.yaml:27-43`) does not set the new variable, so the probe runs the off path. A regression fails when `B - A > max(10 % of A, floor)`, with floor 0.2 s for `s` units (`api/bench/README.md`, "Reading a failure").
- **probe** `startup_cpu_ms` (budget 377), `startup_wall_ms`, `idle_rss_mib` (79), `peak_rss_mib` (83), `load_cpu_s` (0.5): none expected. The off path adds one env read and loads a few small modules (probe and kit). No per-check work changes.
- **probe** `image_mb`: none expected. No dependency, only a few kB of source and kit `dist/`.
- **probe** `test_cpu_s` (gating, 2.3 s): it rises from the new tests. Most use fakes. A few real-socket tests run on `127.0.0.1:0`, plus one new child-process test in `src/main.test.ts` (one spawned probe, which costs most). Target: under +0.3 s.
- **kit** `test_cpu_s` (gating, budget 0.7 s): measured in this run on a copy of kit `6a06ec2`, `bun run test` under `/usr/bin/time -f "%U %S"` took 0.43-0.44 s user+sys, three times. The new tests add one `openssl` call and a few local HTTPS requests. Target: at most +0.15 s, so the total stays under 0.6 s.
- **kit** `build_cpu_s` (gating, budget 0.6 s): measured at 0.33-0.37 s on the same copy. Three more small modules for `tsc`. Target: at most +0.05 s.
- API metrics (`p95_*`, `rps`, cold reads, `cold_read_cpu_ms`): not touched. api does not change.
- When the setting is on (not benchmarked), each check attempt costs one `getaddrinfo` instead of Bun's cached lookup: sub-millisecond to a few milliseconds per attempt.
- Measure: in each repository, run the command three times on the base commit (kit `6a06ec2`, probe `50ec9ca`) and three times on the branch head under `/usr/bin/time -f "%U %S"`. In kit that is `bun run test` and `bun run build`. In the probe it is `bun run test`. Report the median user+sys of each, the difference, and the budget. `bun bench/run.ts --a <ref> --b <ref>` takes api refs (`api/bench/README.md`, "Running it"), so it does not isolate a kit or probe branch. A full-stack run is not required, because the bench runs the off path.

## Security impact
Security impact: yes. The change touches the probe HTTP client and its redirects, the probe's TCP/TLS/DNS connections, a new kit fetch wrapper that sets `Host` and TLS `serverName`, error texts built from external data (resolved addresses), and the env validation at startup.

Checklist items that apply:
- **SSRF and redirects.** This is the purpose of the change. Hostile inputs for the security state:
  - decimal, hex, octal and short IPv4 spellings in URLs and TCP hosts;
  - bracketed and IPv4-mapped IPv6, and `%zone` suffixes;
  - `0.0.0.0`, `::` and `[::]`;
  - a name that resolves to a mixed public/private set;
  - a name whose answer changes between hops (DNS rebinding);
  - a redirect chain public → public → private;
  - a 307 POST same-origin redirect after a DNS change;
  - an RDAP redirect to a bootstrap-listed host that resolves to `10.x`;
  - a redirect `Location` with credentials, and `localhost.` with a trailing dot;
  - `HTTP(S)_PROXY` set;
  - a guarded fetch call with `redirect` left out or set to `"follow"`, with a `Request` object, or with `unix` or `proxy` in `init`.

  In every case the blocked address receives zero bytes.
- **TLS verification.** The pinned fetch must keep certificate checks against the original name: a trusted certificate for another name and an untrusted certificate are both rejected, also on a pooled connection (kit Checks 3).
- **Secrets in errors, logs and responses.** Blocked reasons and the kit error message hold only a fixed category word (decision 8): no URL, query, userinfo, header value, body, host or IP. A probe test uses sentinel values in the URL query, userinfo, a header and the body, and asserts that none of them shows up in the reason or in the probe's stdout/stderr.
- **Input validation.** The env value is parsed by kit `readBool`, which fails closed with exit 2 on unknown spellings. Check fields are already validated by the contract. The guard still does not trust them: addresses are classified after normalization, and unrecognized addresses are blocked.
- **Dependency pins.** No new dependency. The probe's kit pin moves from `fa79ba8` to the merged kit commit of this feature, a full SHA on kit `main`.

Not applicable: admin routes and auth (no route), body and size limits (unchanged), accessor execution (none), file writes (none).

## Rollout order
1. **kit** merges first. The change is additive: new modules and new named exports, with no existing export changed. Its merge commit on `main` (full SHA, called `K` here) is the pin for step 2. api, status, notify and console stay on `fa79ba8`. They keep working because nothing they import changes, and they do not move their pin in this feature.
2. **probe** bumps `@lorenzh/pulse-kit` from `fa79ba8` to `K` in `package.json:31` and `bun.lock`, and implements the policy. Its CI needs `K`, because it imports the new exports. No wire shape changes: a blocked check posts a normal `Result` with `status: "down"` and a `reason` of fewer than 80 characters, which any api version accepts (reason limit 1000). The default is off, so a probe image built from this change behaves as today until an operator sets the variable. Older probes ignore the unknown variable.

Deploy and website need no change. The website renders the probe's docs from its repository when it builds.

## Counterexamples
- **Classifier boundaries.** These run against the probe's table through the kit classifier. The fixtures are literals in the test, never computed by the classifier.
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
  - `fe7f:ffff::1` allowed, `fe80::1` link-local, `fe80::1%eth0` link-local, `[fe80::1]` link-local, `febf:ffff::1` link-local, `fec0::1` private, `feff::1` private, `ff02::1` allowed.
  - `203.0.113.10`, `8.8.8.8`, `2001:db8::1`, `2606:4700::1111` allowed.
  - Wrong implementations these catch: one that compares strings (`startsWith("10.")`) fails `::ffff:10.0.0.1`. One that only checks `fc00::/8` fails `fd00::1`. One that blocks `0.0.0.0` but not `0.255.255.255` fails the `0.0.0.0/8` case. One that does not strip the zone or the brackets fails `fe80::1%eth0` or `[fe80::1]`.
- **Kit classifier mechanics** (with test-local rules, not the probe table): rules `[{ category: "a", cidrs: ["10.0.0.0/8"] }, { category: "b", cidrs: ["10.1.0.0/16"] }]` give `a` for `10.1.2.3`, because the first rule wins. `createIpClassifier([{ category: "x", cidrs: ["10.0.0.0/33"] }])` and `["not-an-ip/8"]` throw a `TypeError` at creation. `"example.com"` classifies as `null` (not an IP). The guard, not the classifier, turns it into `unrecognized`.
- **URL spellings** with the setting on, a real `fetch` and a local server on `127.0.0.1:<port>`, where the server must see zero requests: `http://2130706433:<port>/`, `http://0x7f.1:<port>/`, `http://127.1:<port>/` and `http://[::ffff:127.0.0.1]:<port>/` all give `blocked: loopback address (PULSE_PROBE_BLOCK_PRIVATE_RANGES)`. `http://0:<port>/` gives `blocked: unspecified address (...)`.
- **Mixed answer.** `lookup("mixed.test")` returns `203.0.113.10` and `10.0.0.5`. Result: `blocked: private address (...)`, and the underlying fetch is called 0 times. A wrong implementation that picks the first public address and connects passes a "reachable" test but fails this one. `lookup` returning `10.0.0.5` then `127.0.0.1` gives category `private` (first blocked address in answer order).
- **DNS change between hops.** `lookup("flip.test")` returns `203.0.113.10` on the first call and `127.0.0.1` on the second. The first fetch (to `http://203.0.113.10/` with `Host: flip.test`) answers `302 Location: /next`. Result: `redirect blocked: loopback address (...)`, `statusCode` 302, the underlying fetch is called exactly once and `lookup` exactly twice. A wrong implementation that validates once per check fails this.
- **Validation vs connection.** The underlying fetch receives a URL whose hostname is the validated literal (`203.0.113.10`), the `host` header `flip.test`, and for https `tls.serverName` `flip.test`. For `https://[2001:db8::1]:8443/` (an IP literal URL) the URL, headers and `tls` pass unchanged, with no `host` header and no `serverName` added. A wrong implementation that validates and then passes the hostname URL to fetch (a second lookup inside fetch) fails the first assertion.
- **Redirect mode.** `guardedFetch("http://public.test/", {})` and `guardedFetch("http://public.test/", { redirect: "follow" })` reject with `TypeError`, and `lookup` is called 0 times. `{ redirect: "manual" }` calls `lookup` once. `guardedFetch(new Request("http://public.test/"), { redirect: "manual" })` and `{ redirect: "manual", unix: "/tmp/x.sock" }` reject with `TypeError` and 0 lookups. `guardedFetch("file:///etc/passwd", { redirect: "manual" })` rejects with `TypeError` and 0 lookups.
- **Fallback.** `lookup` returns `2001:db8::1` and `203.0.113.10`. The fetch to the first address rejects with an error whose `cause.code` is `ECONNREFUSED` (and, in a second case, whose `code` is `ConnectionRefused`), and the second answers 200. Result: `up`, 2 fetch calls, the first to `http://[2001:db8::1]/` and the second to `http://203.0.113.10/`. If the first rejects with a `TimeoutError`, or with `code` `ECONNRESET`, there is no second call and that error is thrown. If `lookup` returns `203.0.113.10` and `10.0.0.5`, nothing is tried (mixed rule), not even the public address.
- **Lookup deadline.** An abort signal fires while `lookup` is still pending. The guard rejects with the signal's reason (`TimeoutError`) and makes 0 transport calls. Through the probe this gives `timeout after <n>ms`.
- **TLS name.** Kit real-socket cases with a trusted self-signed certificate for `pinned.test` and a lookup that maps every name to `127.0.0.1`: `https://pinned.test:<port>/` answers 200. `https://other.test:<port>/` rejects with code `ERR_TLS_CERT_ALTNAME_INVALID`, also right after a pooled `pinned.test` request. Without the trusted `ca`, the request rejects with `DEPTH_ZERO_SELF_SIGNED_CERT`. Wrong implementations these catch: one that sets `serverName` to the pinned IP, or sets neither `Host` nor `serverName`, fails the 200 case (fact 1). One that drops the caller's `tls` fields (`ca`) also fails the 200 case. One that turns off verification passes the 200 case but fails both rejections.
- **Existing rules stay first.** A check with a header, redirected cross-origin to `http://10.0.0.5/`, keeps today's reason `redirect to http://10.0.0.5 not followed`. The policy does not run, and `lookup` is not called for the hop. A redirect to `file:///etc/passwd` keeps `redirect to file: not followed`.
- **Setting off.** The same fixtures as the three acceptance cases (loopback literal, name resolving to private, redirect to private) behave as today. A local target answering 200 gives `up`, and the redirect is followed to the local server, which records 1 hit.
- **Env parsing.** `true`, `1` and ` true ` mean on. `false`, `0`, unset and `""` mean off. `TRUE`, `yes`, `on` and `2` exit 2 with `pulse-probe: PULSE_PROBE_BLOCK_PRIVATE_RANGES: must be true, false, 1 or 0`.
- **DNS check.** `resolver: "127.0.0.53"` gives `blocked: loopback address (...)`, and the injected `resolve` is called 0 times. `resolver: "8.8.8.8"` calls `resolve` once. No `resolver` calls `resolve` once (system DNS is trusted). An answer `A 10.0.0.1` with `expected: ["10.0.0.1"]` is still `up`.
- **Domain.** A bootstrap URL that resolves to `127.0.0.1` gives `blocked: loopback address (...)` with 0 fetch calls. An allowed bootstrap whose service host resolves to `192.168.1.1` gives `blocked: private address (...)`, with exactly 1 fetch call (the bootstrap). An allowed service that answers `302` to a bootstrap-listed host that resolves to `10.1.1.1` gives `redirect blocked: private address (...)`. The redirect host must be bootstrap-listed, so that the host allow-list is not what stops it.

There is no statistic in this change.

## Contract fields
No new field, key or route in the contract or config. The new names are kit exports and probe-internal names. Each was searched with `grep -rn -- '<name>' .repos/contract/src .repos/config .repos/kit/src .repos/kit/test .repos/probe/src .repos/api/src .repos/notify/src .repos/status/src .repos/deploy`, and every search gave 0 hits:
- Environment variable `PULSE_PROBE_BLOCK_PRIVATE_RANGES`; settings field `blockPrivateRanges`.
- kit exports `createIpClassifier`, `IpRule`, `AddressClassifier`, `BlockedAddressError`, `LookupAll`, `lookupAll`, `resolveAllowed`, `connectFirst`, `createGuardedFetch`, `GuardedFetch`; kit modules `ip-classifier`, `address-guard`, `guarded-fetch`.
- probe modules `address-policy` and `check-guard`, function `createCheckGuard`.
- Reason prefixes `blocked:` and `redirect blocked:`.

## Repository: kit
Files:
- `src/ip-classifier.ts` (new): `interface IpRule<C extends string> { category: C; cidrs: readonly string[] }`, `type AddressClassifier = (address: string) => string | null`, and `createIpClassifier<C extends string>(rules: readonly IpRule<C>[]): (address: string) => C | null`. It builds one `node:net` `BlockList` per rule, keeps the given order and returns the first matching category. A CIDR is `<ip>/<prefix>`; a bare IP means one address. A bad CIDR (bad address, prefix out of range for the family) throws `TypeError` at creation, without the value in the message. Normalization before the check: trim, remove one pair of surrounding brackets, remove a `%zone` suffix. A value that `net.isIP` then does not recognize returns `null`. IPv4-mapped IPv6 matches IPv4 rules (fact 4).
- `src/address-guard.ts` (new):
  - `class BlockedAddressError extends Error`: `name` `"BlockedAddressError"`, readonly `category: string`, message `blocked <category> address`.
  - `type LookupAll = (host: string) => Promise<readonly string[]>`, and `lookupAll: LookupAll`: the real one, `node:dns/promises` `lookup(host, { all: true })` mapped to the addresses, in answer order.
  - `resolveAllowed(host, { lookup, classify, signal? }): Promise<readonly string[]>`. It returns the validated addresses in answer order, or rejects as in decision 4. For an IP literal it calls no lookup and returns the normalized literal. A non-IP answer is `unrecognized`, an empty answer is an error with `code` `ENOTFOUND`, and a signal that is already aborted, or aborts before the lookup settles, rejects with `signal.reason`.
  - `connectFirst<T>(addresses, attempt: (address: string) => Promise<T>, signal?): Promise<T>`. It tries in order and goes on only for the connection codes of decision 4, read from `cause.code` then `code`, and only while the signal is not aborted. It rethrows the last error, and with an empty list it throws `TypeError`.
- `src/guarded-fetch.ts` (new): `type GuardedFetch = (input: string | URL | Request, init?: BunFetchRequestInit) => Promise<Response>` and `createGuardedFetch({ fetch, lookup, classify }): GuardedFetch`, where `fetch: (input: string, init: BunFetchRequestInit) => Promise<Response>`.
  - Before any lookup, it rejects with `TypeError`: a `Request` input; `init.redirect` other than `"manual"` or `"error"` (absent included); `init.unix` or `init.proxy` set; a protocol other than `http:` or `https:`; a URL that does not parse.
  - Then `resolveAllowed(url.hostname, { lookup, classify, signal: init.signal })` and `connectFirst` over the addresses.
  - Each try calls the underlying fetch with the URL whose hostname is the address (bracketed for IPv6). Headers are copied through `new Headers(init.headers)`, with `host` set to the original `url.host`. For `https:`, `tls` is `{ ...init.tls, serverName: url.hostname }`. All other `init` fields pass unchanged.
  - When the original hostname is an IP literal, the URL and `init` pass unchanged after validation (no `host`, no `serverName`).
  - A comment states fact 1: `serverName` takes precedence over `Host` for SNI and verification, and the pool is keyed by it. The module doc says that it needs Bun.
- `src/index.ts`: export the values `createIpClassifier`, `BlockedAddressError`, `lookupAll`, `resolveAllowed`, `connectFirst`, `createGuardedFetch` and the types `IpRule`, `AddressClassifier`, `LookupAll`, `GuardedFetch`.
- `dist/`: `bun run build` output for the three new modules and the changed `index` (`.js` and `.d.ts`), committed (kit `AGENTS.md:108-110`).
- `test/ip-classifier.test.ts` (new): the "Kit classifier mechanics" cases from Counterexamples, plus brackets, zone and IPv4-mapped matching with test-local rules.
- `test/address-guard.test.ts` (new): with a fake `lookup` and fake attempts, the mixed answer (first blocked in answer order), empty answer `ENOTFOUND`, `unrecognized`, IP literal without lookup, the lookup deadline, and the fallback codes (`ECONNREFUSED` in `cause.code`, `ConnectionRefused` in `code`, `EHOSTUNREACH`, `ENETUNREACH`, `EADDRNOTAVAIL` go on; `ECONNRESET` and `TimeoutError` stop). Also the `BlockedAddressError` `name`, `category` and message.
- `test/guarded-fetch.test.ts` (new): with a fake underlying fetch, the "Redirect mode", "Validation vs connection", "DNS change" (two calls to the same guarded fetch see two lookups) and "Fallback" cases. Also: caller headers survive, a caller `host` header is replaced by `url.host`, `http:` gets no `tls`, and the caller's `tls` fields are kept beside `serverName`.
- `test/guarded-fetch.tls.test.ts` (new): the real-socket HTTPS cases of Checks 3.
- `test/smoke.test.ts`: add `ip-classifier`, `address-guard` and `guarded-fetch` to `ALL_MODULES` (`:8-19`). Add the six new value exports to the sorted list of the package entry test (`:47-74`).
- `docs/index.md`: a section "Address guard (`ip-classifier.ts`, `address-guard.ts`, `guarded-fetch.ts`)" in the format of the existing tables. It gives each export with its behavior from this section, the fallback codes, the `TypeError` cases, the proxy and `NO_PROXY` note, the Bun-only note, and that the kit has no fixed address list (callers bring their rules).
- `README.md`: the helper list in the first paragraph (`:5`) names the address-guarded fetch.

Behavior change: yes. New exported runtime helpers. Existing exports do not change.

### Tool facts (verified)
- Bun 1.4.0: kit `package.json:8` (`engines.bun`) and `:45` (`packageManager`). CI: kit `.github/workflows/ci.yml:17-19` uses `lorenzh/pulse-config/.github/workflows/check.yml@51e95b0eb463b27a196a33b428607bd92443e4f0` with `build: true`. In that pinned file (read through `gh api`, identical to the config clone and to the probe's pin `dc69a126`), `setup-bun` uses `bun-version: 1.4.0` (lines 22-24). The steps are `bun install --frozen-lockfile` (:26), `bun run lint` (:28), `bun run typecheck` (:30), `bun run build` (:33), `git diff --exit-code -- dist` (:36) and `bun run test` (:38).
- Scripts: `check` = lint, build, typecheck, test (`package.json:35`); `lint` = `biome check . && pulse-eslint .` (`:32`); `build` runs `typescript7` `tsc -p tsconfig.build.json` (`:29`). Biome `2.6.3` (`:38`), `@types/bun` `1.4.0` (`:43`).
- Biome: kit `biome.json` extends `@lorenzh/pulse-config/biome.json`. The pinned `51e95b0` copy is identical to the clone: `files.includes` (lines 10-17) covers `src/` and `test/`, `noNonNullAssertion` (:46) and `noExplicitAny` (:49) are errors, and `noNonNullAssertion` is off for `**/*.test.ts` and `**/test/**` (lines 55-59).
- ESLint: kit `eslint.config.js` spreads `@lorenzh/pulse-config/eslint.config.js`. At the pinned `51e95b0`, line 16 sets `"sonarjs/cognitive-complexity": ["error", 15]`. The file is identical at `51e95b0`, at `dc69a126` and in the clone.
- Types: pulse-config `tsconfig.base.json:7` sets `"types": ["node", "bun"]`, identical at `51e95b0` and in the clone, so `BunFetchRequestInit` is in scope in `src/`.
- Coverage: kit `bunfig.toml:2-3`, `coverage = true`, `coverageThreshold = { lines = 0.8, functions = 0 }`; `test/**` is ignored (`:4`).

### Checks
Write the tests first. On kit `6a06ec2` they fail because the modules and exports do not exist. That is the intended red for a new API. Record it, then the green run.
1. Classifier, guard and guarded fetch tests from the Files list pass, with every expected value written as a literal in the test.
2. `test/smoke.test.ts` passes. The dist test compares a fresh build with the committed `dist/` (an independent build), and the entry test lists the six new names as literals.
3. **HTTPS through the guarded path (real sockets, `test/guarded-fetch.tls.test.ts`).** Setup:
   - Once per file, in its own `mkdtemp` directory, one `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -subj /CN=pinned.test -addext subjectAltName=DNS:pinned.test -days 2` call. The `openssl` call carries the same `sonarjs/no-os-command-from-path` disable comment as probe `src/tls.test.ts:19`.
   - A `node:https` server on `127.0.0.1:0` with that key and certificate. It records each request's `host` header and `req.socket.servername` (not `SNICallback`, fact 1), and counts `secureConnection` events.
   - `createGuardedFetch({ fetch, lookup, classify })` with the real global `fetch`, a fake `lookup` that returns `["127.0.0.1"]` for every name and records the names, and `classify: () => null`. Every call passes `redirect: "manual"`.

   Expected values are literals from fact 1, which was verified on Bun 1.4.0 in this run:

   a. **Trusted, matching host:** `https://pinned.test:<port>/` with `tls: { ca: <cert> }` answers 200. The server saw `host` `pinned.test:<port>` and servername `pinned.test`, and `lookup` was called with `pinned.test`.

   b. **Trusted, wrong host:** on a fresh server, `https://other.test:<port>/` with the same `ca` rejects with an error whose `code` is `ERR_TLS_CERT_ALTNAME_INVALID`. The server handler saw 0 requests.

   c. **Pooled:** on one server, without closing connections between calls, the sequence a, b, a gives 200, then `ERR_TLS_CERT_ALTNAME_INVALID`, then 200. The handler saw exactly 2 requests, both with `host` `pinned.test:<port>`.

   d. **Untrusted:** `https://pinned.test:<port>/` without `ca` rejects with `code` `DEPTH_ZERO_SELF_SIGNED_CERT`. The handler saw 0 requests.

   Servers are closed with `closeAllConnections()` and `close()` in `afterAll`, and the temp directory is removed.
4. `bun run check` passes: lint, build, typecheck and test. Coverage stays at 80 % or more (`bunfig.toml:3`), and cognitive complexity stays at 15 or less (pinned pulse-config `51e95b0` `eslint.config.js:16`). The only new disable comment is the one in Check 3. After `bun run build`, `git diff --exit-code -- dist` is clean (the CI step at pinned `check.yml:36`).

### Completion evidence
- The red run on `6a06ec2` and the green run of the new tests.
- Full `bun run check` output and green CI on the PR, including the dist step.
- The `test_cpu_s` and `build_cpu_s` measurements from Performance impact (median user+sys on `6a06ec2` and on the branch, the differences, the budgets 0.7 s and 0.6 s).
- The `docs/index.md` diff with the new section.
- The merge commit SHA on kit `main`, for the probe pin.

## Repository: probe
Files:
- `package.json`, `bun.lock`: `@lorenzh/pulse-kit` from `github:lorenzh/pulse-kit#fa79ba8cd93949fc0cf87f7b41bdaf261dbe4dc6` (`package.json:31`) to the full SHA of the merged kit change on kit `main` (kit `docs/index.md:94-104`). Only this pin moves.
- `src/settings.ts`: `blockPrivateRanges: boolean` via kit `readBool(env, "PULSE_PROBE_BLOCK_PRIVATE_RANGES", false)`.
- `src/settings.test.ts`: the env parsing cases from Counterexamples.
- `src/address-policy.ts` (new): the decision-3 table as `IpRule` data in the decision-3 order, `blockedCategory = createIpClassifier(RULES)` (kit), and `blockedReason(category: string, isRedirect: boolean): string`, which builds the two reason texts of decision 8. No CIDR parsing or normalization of its own.
- `src/address-policy.test.ts` (new): the classifier boundary list from Counterexamples, with literal expected categories, and the two reason texts written out.
- `src/check-guard.ts` (new): `createCheckGuard(deps)` with `deps = { fetch, lookup, tcpConnect, tlsConnect, resolve, monotonic }` returns `{ fetch, tcpConnect, tlsConnect, resolve }` with the types of `CheckDeps`. It composes kit primitives with `blockedCategory` and adds no mechanism of its own:
  - `fetch` is kit `createGuardedFetch`. `GuardedFetch` is assignable to `CheckDeps["fetch"]`, because `RequestInit` is assignable to `BunFetchRequestInit` (fact 1, types).
  - `tcpConnect` is kit `resolveAllowed` on `host` with the attempt's signal, then kit `connectFirst` over the underlying `tcpConnect` with `host` set to each address.
  - `tlsConnect` is the same, with `servername` set to the original host when it is not an IP literal. It runs its lookup under `AbortSignal.timeout(timeoutMs)` and passes the remaining time (decision 4).
  - `resolve` runs `resolveAllowed` on an explicit `resolver` literal before it calls the underlying `resolve`. Without a resolver it calls the underlying `resolve` directly.
- `src/check-guard.test.ts` (new): fakes for `lookup` and the underlying transports. It covers the TCP and TLS fallback through the guard, IPv6 literals, the DNS `resolver` rule, the TLS remaining-time rule (fake monotonic clock: lookup takes 300 ms of a 1000 ms timeout, so the connect gets `timeoutMs: 700`), and the TLS `servername` and `host` passed to the underlying connect.
- `src/check.ts`: `TlsConnectOptions` gets an optional `servername`. `tlsConnect` uses it when it is given, else today's rule (`:46`). `fetchFollowing` maps `BlockedAddressError` to the stop of decision 8: `blocked:` on hop 0 with `statusCode: null`, and `redirect blocked:` with the previous 3xx status after hop 0. `runTlsCheck` maps it in its catch (`:495-500`).
- `src/check-tcp.ts`, `src/check-dns.ts`, `src/check-domain.ts`: map `BlockedAddressError` to its reason in the catch paths (`attemptTcp` `:47-54`, `attemptDns`/`failureReason`, `attemptDomain` `:264-269`). `fetchRdap` turns a `BlockedAddressError` on a hop after the first into an `RdapError` with the `redirect blocked:` text. Nothing else changes in their off path.
- `src/check-scheduler.ts`: `CheckSchedulerDeps` (`:7-17`) gets optional `tcpConnect`, `tlsConnect` and `resolve`, passed through to `runCheck` (`:29`) only when they are set.
- `src/main.ts`: when `settings.blockPrivateRanges` is on, it builds `createCheckGuard` from the real `fetch`, kit `lookupAll`, `tcpConnect`, `tlsConnect`, `resolveRecords` and `monotonic`. It passes the result only to `startCheckScheduler` (`:193-205`) and logs the `info` line. When the setting is off, it passes the same arguments as today. API calls keep the raw `fetch`.
- `src/check.private-ranges.test.ts` (new): the three acceptance cases and the per-type cases through `runCheck` (see Checks).
- `src/main.test.ts`: a bad value exits 2 (add a row to the table at `:65-72`). One new end-to-end test (see Checks).
- `README.md`: the line at `:36` names the setting and links the docs.
- `docs/configuration.md`: a row in the env table (`:7-18`). Rewrite "Network reach of checks" (`:189-208`): replace "There is no deny list in the code" with a subsection on the setting. It covers the default, values and restart; the address table with categories and the not-blocked list; what each check type checks; the DNS, system-resolver, API and proxy exceptions; the reason texts and `statusCode`; the known limits from Risks; and the provider references.
- `docs/troubleshooting.md`: an entry for a check that is down with `blocked: … (PULSE_PROBE_BLOCK_PRIVATE_RANGES)`.

Behavior change: yes. A new setting changes which connections checks may open. With the setting off, behavior stays as today.

### Tool facts (verified)
- Bun 1.4.0: probe `package.json:8` (`packageManager`), `:10` (`engines.bun`). CI installs it: probe `.github/workflows/ci.yml:18` uses the pinned `lorenzh/pulse-config/.github/workflows/check.yml@dc69a126bebbe50d8a7339ea1325d51b2ea43d7d`, lines 22-24 (`setup-bun`, `bun-version: 1.4.0`). The pinned file is identical to the config clone (which is at `dc69a12`).
- CI steps (pinned `check.yml`): `bun install --frozen-lockfile` (:26), `bun run lint` (:28), `bun run typecheck` (:30), `bun run test` (:38). There is no build step: the probe passes no `build` input. Probe `bun run check` = lint, typecheck, test (`package.json:19`). Lint is `biome check . && pulse-eslint .` (`package.json:16`).
- Biome: probe `biome.json` extends `@lorenzh/pulse-config/biome.json`. In the pinned `dc69a126` copy (identical to the clone), `files.includes` (lines 10-17) covers all of `src/`. `noNonNullAssertion` (:46) and `noExplicitAny` (:49) are errors, and `noNonNullAssertion` is off for `**/*.test.ts` (lines 55-59). Biome is `2.6.3` (`package.json:22`).
- ESLint: cognitive complexity limit 15, pinned pulse-config `dc69a126bebbe50d8a7339ea1325d51b2ea43d7d` `eslint.config.js:16` (`"sonarjs/cognitive-complexity": ["error", 15]`), identical to the clone.
- Coverage: `bunfig.toml:1-4`, `[test]` `coverage = true`, `coverageThreshold = { lines = 0.8, functions = 0 }`. The new modules must keep the total at 80 % or more.
- `@types/bun` `1.4.0` (`package.json:24`) declares `BunFetchRequestInit.tls.serverName` (bun-types 1.4.0 `globals.d.ts:1930-1934`, `bun.d.ts:4305`). pulse-config `tsconfig.base.json:7` sets `"types": ["node", "bun"]` (identical at `dc69a126`).

### Checks
Write the tests first, against the new kit pin. Record that they fail on `50ec9ca` plus the pin bump for the intended reason: the target is reached or the result is `up`, not just a missing export. For the record, the first failing run may wire a `createCheckGuard` stub that passes the underlying transports through unchanged (no blocking).

The real-socket HTTPS name cases (trusted matching host, trusted wrong host, pooled, untrusted) are kit Checks 3, on the same guarded fetch the probe uses. They cannot run through the probe policy, because the policy blocks every local address that a test server can bind to. The probe asserts the values it passes to that fetch (Check 2, HTTPS row).

1. **Acceptance (`src/check.private-ranges.test.ts`, setting on through `createCheckGuard`):**
   a. A real `fetch` to `http://127.0.0.1:<port>/` of a local server gives `status` `down`, `reason` `blocked: loopback address (PULSE_PROBE_BLOCK_PRIVATE_RANGES)`, `statusCode` `null`, and server hits `0`.
   b. `http://internal.test:<port>/`, where the fake `lookup` returns `10.0.0.5`, gives `down`, `blocked: private address (...)`, and 0 underlying fetch calls.
   c. `http://public.test/`: the fake `lookup` returns `203.0.113.10`, and the fake transport answers `302 Location: http://internal.test/` (for which `lookup` returns `192.168.1.20`). The check has no headers and no body, so the cross-origin rule does not stop it. Result: `down`, `redirect blocked: private address (...)`, `statusCode` `302`, and exactly 1 fetch call (to `203.0.113.10`).
   d. The same three fixtures with the setting off (unguarded deps, as `main.ts` passes them today) and with the setting `false`. Case a gives `up` with 1 server hit. Cases b and c use real local servers (the redirect goes to a second local server) and give `up` with 1 hit on the redirect target.
2. **Per type (setting on):**
   - TCP and TLS checks to `127.0.0.1:<port>` of real local servers give `down`, `blocked: loopback address (...)`, and 0 connections accepted by the server. TLS `certDaysLeft` is `null`.
   - TCP and TLS checks to a name resolving to `10.0.0.5` (fake lookup, fake connect) make 0 connect calls.
   - TLS to a name resolving to `203.0.113.10`: the fake `tlsConnect` gets `host: "203.0.113.10"` and `servername` set to the name.
   - HTTPS: `https://public.test/` with `lookup` `203.0.113.10` calls the fake underlying fetch with URL `https://203.0.113.10/`, `host` header `public.test` and `tls.serverName` `public.test`. A 200 answer gives `up`.
   - An HTTP check to `http://public.test/` (lookup `203.0.113.10`) that answers 200 is `up`.
   - DNS: the resolver cases from Counterexamples.
   - Domain: the three cases from Counterexamples, each with its own bootstrap URL.
   - The URL spellings from Counterexamples, with a real `fetch` and 0 server hits.
   - The heartbeat skip test in `client` stays green and unchanged.
3. **Secrets.** A check URL `http://user:pw-sentinel@internal.test/?q=query-sentinel`, with header `x-k: header-sentinel` and body `body-sentinel`, is blocked. Its reason contains none of the four sentinels, no `internal.test` and no `10.0.0.5`.
4. **End-to-end (`src/main.test.ts`):** spawn the real probe with `PULSE_PROBE_BLOCK_PRIVATE_RANGES=true`, `PULSE_CHECKS_RELOAD_MS=5000` and a fake API on `127.0.0.1:0`.
   - The first `/probe/checks` answer is one HTTP check to a local target server, `http://127.0.0.1:<port>/?secret=e2e-sentinel`. Assert that a posted result has `status: "down"` and `reason: "blocked: loopback address (PULSE_PROBE_BLOCK_PRIVATE_RANGES)"`, and that the target has 0 hits.
   - The fake API answers the next load with an added TCP check to the target's port. Assert that this check also posts `down` with the same reason, and that the target still has 0 hits and 0 connections.
   - Assert that `e2e-sentinel` is not in stdout/stderr, and that the startup `info` line is present.
   - The API calls themselves succeed over loopback, so the policy does not touch them.
   - The test sets an explicit timeout above the 5 s reload (for example `{ timeout: 20_000 }`). It waits with the existing `until` helper, extended by a deadline parameter. Add `PULSE_PROBE_BLOCK_PRIVATE_RANGES: "yes"` to the bad-value table.
5. **Regression.** Every existing test passes unchanged, among them `src/check.redirect.test.ts` (secret-bearing redirect rules), `src/tls.test.ts` (SNI), `src/check.domain.test.ts` and `src/check.dns.resolver.test.ts`.
6. `bun run check` passes. Coverage stays at 80 % or more (`bunfig.toml:3`). Cognitive complexity stays at 15 or less (pinned pulse-config `dc69a126bebbe50d8a7339ea1325d51b2ea43d7d` `eslint.config.js:16`), with no new disable comment.
7. Manual run before handoff (probe `AGENTS.md:82`): `PULSE_PROBE_BLOCK_PRIVATE_RANGES=true bun run start` against a local fake API that serves a check to `http://127.0.0.1:<port>/`. Report the posted result and the startup line.

### Completion evidence
- The red run of the tests in Checks 1-4 with their failure reasons (target reached or `up`). Then the green run.
- The `package.json` and `bun.lock` diff that moves only the kit pin, to a SHA on kit `main` that contains the kit section of this spec.
- Full `bun run check` output and green CI on the PR.
- The `test_cpu_s` measurement from Performance impact (median user+sys on `50ec9ca` and on the branch, and the difference).
- The docs diff: the setting row, the rewritten network-reach section without "There is no deny list in the code", and the troubleshooting entry.
- The manual run from Check 7.
- Every expected value in the tests is a literal written in the test: status, reason text, status code, call and hit counts, and the category per address. No expected value is computed by calling `blockedCategory` or `blockedReason`.
