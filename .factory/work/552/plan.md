# Spec #552: bind probe header secrets to hosts and tighten check validation

## Goal

A probe sends a header secret only to the hosts that the probe's operator bound it to. Every
value the contract accepts for the affected fields is one the api and the probe can handle.

Today (contract `ebcbbb6`, probe `50ec9ca`, api `c00a375`, status `2e3067d`, notify `c090a07`):

1. Any admin can point a check that has `{ "env": "PULSE_HEADER_X" }` at any URL. The probe then
   sends that secret there. Nothing binds a variable to hosts. contract `src/schema.ts:96`
   accepts any env name. The probe checks the prefix (probe `src/client.ts:117`, `:136`) but has
   no host rule.
2. Probe reasons have no length cap. probe `src/check.ts:370`, `:433`, `:449` and
   `src/check-domain.ts:183`, `:185` interpolate a scheme, origin or host of any length. The DNS
   list (`src/check-dns.ts:118`), the keyword (`src/check.ts:305`) and `errorReason`
   (`src/attempt.ts:37`) have no cap either. The api rejects a reason over 1000 characters
   (api `src/server.ts:41`, `:114`), so the `down` result is lost and the outage shows as a gap.
3. contract `isHttpUrl` (`src/schema.ts:13-21`) checks only the protocol. So
   `https://user:pw@host/` is stored, and the public `GET /checks` lists it.
4. contract `warnDays` (`src/schema.ts:303`, `:431`) has no upper bound. `resultSchema.latencyMs`
   (`:479`) accepts `-1` and fractions. `postResultRequestSchema.latencyMs` (`:498-500`) accepts
   fractions and has no upper bound. `typescript7` is `npm:typescript@^7.0.2`
   (`package.json:36`).

This spec builds on #384, which is already on `main`. #384 added the `PULSE_HEADER_` prefix check
in the probe and the same-origin redirect rule for checks with secrets. This work extends both
and does not redo them. #460 decision 3 asks for env-only secrets and for host binding. This spec
implements the probe side of that decision.

## Scope

- contract: schema bounds, exported constants, docs, the built `dist/`, an exact `typescript7` pin.
- probe: host binding setting and its enforcement, one reason cap for every result, integer
  latency, contract pin.
- api: contract pin, compatible intake of old probe results, normalized served history, TLS
  `warnDays` bound in its own parser, `MAX_LATENCY_MS` aligned, e2e binding fixture, docs (admin
  token sensitivity, migration).
- status, notify: contract pin and lockfile, plus one test each for the stricter validation.

## Non-goals

- Secrets stay in the probe environment only. They are not stored anywhere new. There is no
  console UI, no secret store, no hot reload of the binding (it is read at start), and no
  private-network or SSRF policy.
- `WIRE_VERSION` stays `1`. A bump would make every mixed-version `fetchJson` client reject the
  other side's responses (`wire-mismatch`). The rollout below keeps mixed versions working without
  a bump.
- The contract package `version` stays `1.6.0`. This follows the precedent of the URL tightening
  `43e0037`, which also left it at `1.6.0`. Consumers pin by SHA.
- `Incident.reason` and `CheckStateFields.lastReason` get no new bound. Older api databases can
  hold longer values: api `78faa6d` (the first `src/server.ts`) had no reason cap. Both fields
  keep `text.nullable()`.
- Other static differences between the api and the contract stay as they are. Examples are
  `MAX_ATTEMPTS = 100` (api) against `attempts >= 1` (contract), and the api `MAX_CERT_DAYS`.
  This issue only aligns the fields named here.
- Deploy, console, kit, config and website do not change.

## Decisions on the open points of the issue review

1. **Where the binding lives.** It lives in one probe setting, `PULSE_PROBE_HEADER_HOSTS`, read
   once by `loadSettings` at start. It is never in checks, the api, the database or the contract,
   so an admin token cannot change it. Its name does not start with `PULSE_HEADER_`, so it can
   never be referenced as a header value.
2. **Format.** The value is a JSON object. Each key is a variable name matching
   `^PULSE_HEADER_[A-Za-z0-9_]{1,115}$`. Each value is an array of 0..100 host entries.
   Example: `{"PULSE_HEADER_SVC_TOKEN":["svc.example.com","10.0.0.7","[fd00::7]"]}`.
   - The JSON text is at most 65536 bytes (UTF-8).
   - A host entry is a string of 1..253 characters. It must not contain whitespace or any of
     `/ ? # @ \ * %`. A `:` may appear only inside an IPv6 literal in brackets
     (`^\[[0-9A-Fa-f:.]+\]$`). The entry must parse as `new URL("http://" + entry + "/")`, and the
     result must have an empty `port`.
   - The canonical form of an entry is that URL's `hostname` with one trailing `.` removed. The
     WHATWG parser lowercases, turns IDNs into punycode and normalizes IPv4 (`127.1` becomes
     `127.0.0.1`). An IPv6 entry keeps its brackets (`[::1]`).
3. **Matching.** The check URL's host is `new URL(check.url).hostname` with one trailing `.`
   removed. It matches when it equals a canonical entry of the variable as an exact string. There
   is no wildcard, suffix, subdomain or substring match and no DNS lookup. The binding is by
   hostname, so it covers every port and both `http:` and `https:` on that host. The #384 rule
   that checks with headers or a body follow redirects only within the origin is unchanged. It
   applies even when the redirect target is also bound, so a secret never reaches a second host.
4. **Fail closed.** If the setting is unset or empty, the policy is empty. If a variable has no
   key, or its array is empty, it is bound to no host. A malformed setting stops the start with
   exit code 2. The probe does not start without the setting being valid.
5. **Order per `{ env }` header**, in the header object's key order. The first failure ends the
   processing of that check:
   1. Prefix (existing, kept as a defense). The check is skipped and logged, as today.
   2. Binding. If the check URL's host is not bound, the check is **denied**. The variable is not
      read, and no later reference is read either.
   3. Unset or empty variable (existing): skip and log, as today.
   4. Invalid header value (existing): skip and log, as today.

   Only the binding failure is new. It produces a result and not a skip, so the outage is visible.
6. **Denied check.** `loadChecks` returns the check with a probe-internal field `headerDenial`
   (the reason text) and **without any `headers`**. A header resolved before the denied one is
   dropped too, so the object never holds a secret. `runCheck` sees `headerDenial` and makes no
   request, no retry and no sleep. It returns
   `{ status: "down", statusCode: null, latencyMs: 0, attempts: 1, reason: <headerDenial> }` with
   the usual `checkId`, `timestamp` and `location`. The reason is
   `header <Name> env <VAR> is not bound to host <host>`, where `<host>` is the canonical host
   passed through `quote()`. Each load logs one warn line:
   `check <id>: header <Name> env <VAR> is not bound to host <host>; reporting down`. Neither text
   holds a header value, the URL path, the query or userinfo.
7. **Reload and retarget.** `loadChecks` gets the parsed policy as a dependency (`headerHosts`)
   on start and on every reload. It resolves headers fresh on each load, as today, so an admin URL
   edit is checked against the same policy. A changed URL gives a different check object, so the
   scheduler (`src/scheduler.ts:68`, `isDeepStrictEqual`) replaces the entry, and no old resolved
   secret is reused. The wire contract gets no internal field.
8. **Reason bound.** The contract adds `MAX_REASON_LENGTH = 1000`, counted in JavaScript string
   length (UTF-16 code units, like api `b.reason.length`). It applies to `resultSchema.reason` and
   `postResultRequestSchema.reason`, and `null` stays valid. The probe moves `quote()` (80
   characters plus `…`) into a new module `src/reason.ts` and uses it for every interpolated
   fragment from outside the check: the URL scheme, redirect scheme, origin and host, the RDAP
   redirect scheme and host, the DNS expected and received lists, and the keyword. It adds
   `capReason(text)`: unchanged when `length <= 1000`, else `text.slice(0, 999) + "…"` (length
   exactly 1000). `runCheck` applies `capReason` to the reason of every result it returns: every
   check type, retries, the degraded latency reason and denials. A cut can split a surrogate pair.
   This is accepted, because JSON carries a lone surrogate and the api counts the same units.
9. **`warnDays`.** The range is an integer `0..3650` (ten years) for TLS and domain checks. The
   contract exports `MAX_WARN_DAYS = 3650`. The defaults stay the same (api TLS 14). Values out of
   range are rejected and never clamped. The migration note tells operators to fix them before
   they upgrade the api.
10. **Latency.**
    - The contract makes `latencyMs` an integer `0..2147483647` (`MAX_TIMER_MS`) in both
      `resultSchema` and `postResultRequestSchema`.
    - The probe sends `Math.min(MAX_TIMER_MS, Math.round(Math.max(0, end - start)))`. So readings
      `100.25` and `101.75` give `2`.
    - The api raises `MAX_LATENCY_MS` from `86_400_000` to `MAX_TIMER_MS`, so it accepts every
      latency the contract accepts. A check's `timeoutMs` may already be up to `MAX_TIMER_MS`.
    - The api's intake rounds an old probe's fraction (see the api section).
    - The api's `toResult` rounds stored history when it serves it. There is no database
      migration.
    - Contract validators still return the input unchanged and do not coerce.
11. **URL userinfo.** HTTP check URLs whose parsed `username` or `password` is non-empty are
    rejected with `<path>.url: must not contain a username or password`. The message never
    echoes the URL. `http://@host/` and `http://:@host/` parse to empty userinfo and stay valid.
12. **Env names in the contract.** `headerValueSchema`'s `env` must match
    `^PULSE_HEADER_[A-Za-z0-9_]{1,115}$` (128 characters at most, as before). The error is
    `must match ^PULSE_HEADER_[A-Za-z0-9_]{1,115}$`. The contract exports
    `HEADER_ENV_PREFIX = "PULSE_HEADER_"`. The probe imports it and drops its local copy.
13. **Compose e2e.** The api's `compose.e2e.yaml` gets
    `PULSE_PROBE_HEADER_HOSTS: '{"PULSE_HEADER_SVC_TOKEN":["e2e-target"]}'` on `probe`. An old
    probe ignores the unknown variable, so the api child can merge first. No new denial scenario
    is added to `scripts/compose-e2e.sh`. A check that stays down would change the incident and
    notify expectations of that script. Denial is proven by probe tests.

## Required behavior

- **contract.**
  - `env` references need the `PULSE_HEADER_` prefix and at least one more character.
  - `reason` is at most 1000 characters in `Result` and `PostResultRequest`.
  - HTTP check URLs must have no username or password.
  - TLS and domain `warnDays` must be an integer `0..3650`.
  - `latencyMs` must be an integer `0..2147483647` in `Result` and `PostResultRequest`.
  - New exports: `HEADER_ENV_PREFIX`, `MAX_REASON_LENGTH`, `MAX_WARN_DAYS`.
  - `typescript7` is pinned to `npm:typescript@7.0.2`.
  - The admin schemas that reuse these shapes inherit the rules.
- **probe.**
  - It reads `PULSE_PROBE_HEADER_HOSTS` at start.
  - It denies unbound references with a `down` result and never sends the secret.
  - It caps every reason at 1000 and quotes outside fragments at 80.
  - It posts integer latency.
  - It pins the new contract.
- **api.**
  - It pins the new contract.
  - It accepts an old probe's fractional, finite, non-negative latency by rounding before
    validation.
  - It serves stored latency rounded and stored reasons capped.
  - It bounds TLS `warnDays` in its own parser and validates TLS checks with the contract.
  - `MAX_LATENCY_MS = MAX_TIMER_MS`.
  - It has the e2e binding fixture.
  - Its docs say that an admin token is as sensitive as every header secret it can address, and
    they carry the migration notes.
- **status, notify.** They pin the new contract and keep working against the new api.

## Risks

- **Checks that become invalid.** These are checks files with unprefixed `env` names, userinfo
  URLs or `warnDays > 3650`. The new api refuses them at start and on reload, as it does any
  invalid file. Probes already skip unprefixed references since #384. Mitigation: rollout step 2
  and the migration notes.
- **Probes without the setting.** After the upgrade, every check with an `{ env }` header reports
  `down` with the denial reason. This is intended (fail closed). Mitigation: provision the setting
  before the upgrade (rollout step 2). Old probes ignore it.
- **Rounding changes the latency objective edge.** `500.4` ms against objective 500 becomes 500,
  which is `up` and not `degraded`. This is accepted and documented.
- **#545 is in flight on api `src/server.ts`.** It changes the `POST /results` bound tests to
  literal values. A later merge conflict goes through `factory start --issue <child> --workflow
  merge`. The literal latency bound becomes `2147483647` in whichever change lands second.
- **Bounded is not redacted.** Denial and redirect reasons must still never hold a header value,
  URL userinfo, the path or the query. The tests check this with sentinels.

## Performance impact

Expected: none above noise. Keys from api `bench/budgets.json`:

- api `p95_post_results_ms`, `rps`, `load_cpu_s`: one shallow object copy and one `Math.round`
  per `POST /results`. That is far below 1 %, so no measurable change.
- api `p95_get_checks_ms`, `cold_get_checks_ms`, `cold_read_cpu_ms`: `toResult` adds one
  `Math.round`, one `Math.min`/`Math.max` and one length check per served row. Expect under 1 %.
  `p95_get_latency_ms` and `p95_get_check_latency_ms` read rollups and do not change.
- api `startup_cpu_ms`, `startup_wall_ms`, `idle_rss_mib`, `peak_rss_mib`: these do not change,
  because there is no migration and no new state.
- probe `startup_cpu_ms`: one `JSON.parse` of a small env value, under 1 ms. Probe
  `load_cpu_s`: one length check per result and one `new URL` per check with `{ env }` per load.
  No change is expected.
- `test_cpu_s` of contract, probe, api, status and notify: a few more tests, under 0.2 s each.
  Contract `build_cpu_s` does not change, because the compiler version is the same (`7.0.2` is
  already in `bun.lock:311`).
- `image_mb`: no change, because there is no new dependency.

How to measure: the api implementer runs
`bun bench/run.ts --a c00a375a1d78e17e9d01b8c25b5ae69b4fc3860e --b <api branch sha> --rounds 3`.
The probe implementer runs it with `--others-ref <probe branch sha>` on both sides of an api A = B
run, against `--others-ref main`. Each attaches the table, and no gating row may fail.

## Security impact

Security impact: yes
It touches contract validators at a trust boundary, probe HTTP headers, reason and log texts with external data, a probe env setting, and a compiler pin.

Checklist items that apply:

- **Secrets in errors, logs and responses.** Denial reasons and log lines name the header,
  variable and host, never a value. The `PULSE_PROBE_HEADER_HOSTS` errors never print the JSON
  text, an invalid key or a host. URL userinfo is rejected without being echoed. The api docs say
  that an admin token is as sensitive as every header secret it can address.
- **Input validation.** `env` prefix, URL userinfo, `warnDays`, `latencyMs` and `reason` bounds
  in the contract. The probe parses its setting strictly. The api validates the raw latency
  before rounding.
- **Body and size limits.** The setting is at most 65536 bytes, 100 hosts per variable, 253
  characters per host. Reasons are at most 1000.
- **SSRF and redirects.** The secret is bound to the check host. The #384 same-origin rule stays.
  The binding is not an SSRF policy (non-goal).
- **Auth order and status codes.** An admin write of an invalid check still answers `422` after
  authentication. Nothing else changes.
- **Dependency pins.** `typescript7` is exact. Contract pins are full SHAs.

## Rollout order

The merge order follows `targets.json`: contract, then api, then probe, status and notify.

Why probe and status depend on api: the api `compose-e2e` job builds both of them from `main`
(api `compose.yaml:28`, `:41`).

- If probe merges before api, the api `main` e2e runs a probe that enforces the binding but has no
  fixture. Then `e2e-post` goes `down`. The probe's completion evidence (its local api
  `compose-e2e` run) also needs the merged fixture.
- If status merges before api, the e2e runs a strict status against an api that still serves
  fractional latency from the old probe.

Notify has no such constraint.

Release and operator order:

1. **Merge contract.** It has no runtime effect until a consumer bumps its pin.
2. **Operators prepare** (documented in api `docs/operation.md`, "Upgrades", and probe
   `docs/configuration.md`, "Migration"):
   - In every checks file, rename `env` references to `PULSE_HEADER_*`.
   - Remove userinfo from check URLs and move credentials to an `Authorization` header with
     `{ env }`.
   - Set TLS and domain `warnDays` to `0..3650`.
   - Set `PULSE_PROBE_HEADER_HOSTS` at every probe location.
   - Old probes (pin `ebcbbb6`) ignore the unknown variable and keep working.
3. **Release api** (pin = new contract).
   - Old probes keep working. Their fractional latency is rounded at intake. Their reasons over
     1000 are rejected exactly as today. The checks they fetch are valid under the new contract,
     which is a subset of what they accept.
   - Old status (`9fe5e80`) and old notify (`61f7bf8`) keep working. The new api serves integer
     latency and reasons of 1000 characters or fewer, which their looser validators accept.
   - Rollback to the old api is safe. It accepts everything a new probe sends, except latency
     over 86400000, which it already rejects today.
4. **Release probe.**
   - Against an old api: integer latency and capped reasons pass the old intake. Checks that only
     the old contract accepts are skipped with a log line, which step 2 avoids.
   - Without step 2's setting, `{ env }` checks report `down` with the denial reason (fail
     closed).
   - Rollback is safe, because the old probe ignores the setting.
   - After the probe merges, a person re-runs api CI on `main`. The api `compose.yaml` builds
     `probe` from `main`, so this run is the first e2e of the new probe with the merged fixture.
5. **Release status and notify, after the api.**
   - A new status against an old api would reject stored fractional latency. Its server poller
     validates API data with `validateChecksResponse` (status `src/poller.ts:12`, `:101`). So
     status goes after the api, and its child depends on api.
   - Notify only drops a check it cannot validate (notify `src/api.ts:174`) and has no ordering
     constraint beyond step 2.

## Counterexamples

- **Binding matching.** Policy `{"PULSE_HEADER_T":["api.example.com"]}`, and the check sends
  `Authorization: {env: PULSE_HEADER_T}`.
  - Allowed: `https://api.example.com/x`, `http://API.Example.COM:8443/`,
    `https://api.example.com./` (trailing dot).
  - Denied: `https://evil-api.example.com/`, `https://api.example.com.evil.net/`,
    `https://sub.api.example.com/`, `https://api.example.co/`, `https://127.0.0.1/` (no DNS
    expansion, even if it resolves there).
  - A variable without a key, or with `[]`, is denied on every host.
  - Policy `{"PULSE_HEADER_T":["127.1"]}` allows `http://127.0.0.1/` (same WHATWG normalization).
- **Invalid policy (exit 2, message literal).**
  - `{` and `[]` give `PULSE_PROBE_HEADER_HOSTS must be a JSON object of PULSE_HEADER_* names to
    host lists`.
  - `{"SVC_TOKEN":["a"]}` and `{"PULSE_HEADER_":["a"]}` give `PULSE_PROBE_HEADER_HOSTS: key 1
    must match ^PULSE_HEADER_[A-Za-z0-9_]{1,115}$`.
  - `{"PULSE_HEADER_T":"a"}` gives `PULSE_PROBE_HEADER_HOSTS.PULSE_HEADER_T must be an array of
    at most 100 hosts`. So does an array of 101 entries.
  - Each of `"api.example.com:443"`, `"https://a"`, `"a/b"`, `"*.example.com"`, `"u@a"`, `"::1"`
    (unbracketed), `""`, a 254-character entry and a non-string gives
    `PULSE_PROBE_HEADER_HOSTS.PULSE_HEADER_T[0] must be a host name or IP address without scheme,
    port or path`.
  - 65537 bytes give `PULSE_PROBE_HEADER_HOSTS must be at most 65536 bytes`.
  - No message contains the JSON text or the entry.
- **Wrong implementations.** A denial that only skips the check gives a gap and no result. A
  check that drops the denied header but still sends the request reports a misleading
  anonymous `up`. Reading the variable before the binding check reads a secret for a denied
  target. Checking the binding on `loadChecks` but reusing the scheduler's old resolved check
  after a URL change sends the secret to the new host.
- **Redirect with binding.** Policy binds `PULSE_HEADER_T` to `a.test` and `b.test`. A check on
  `http://a.test/` gets `302 Location: http://b.test/`. The result is `down`,
  `redirect to http://b.test not followed`, and `b.test` gets no request.
- **Reason cap.**
  - A 302 whose `Location` is `http://<2000 × "a">.test/` on a secret-bearing check gives
    `redirect to http://<80 × "a">… not followed`, and the reason length is at most 1000.
  - A `Location` with a 2000-character scheme `<2000 × "a">:x` gives
    `redirect to <80 characters>… not followed`.
  - A DNS check with 20 `expected` entries of 500 characters each gives a reason of length
    exactly 1000 that ends in `…`.
  - A TCP fake connect that throws an `Error` with a 5000-character message and no code gives a
    reason of length 1000.
  - Contract boundaries: `reason` of 1000 characters is valid, 1001 is rejected, `null` is valid,
    in both `validateResult` and `validatePostResultRequest`.
- **URL userinfo.** These are rejected: `http://user@h.test/`, `http://:pw@h.test/`,
  `https://u:p@h.test/`, `http://%75@h.test/` (encoded). The message is
  `check.url: must not contain a username or password` and contains neither `user` nor `pw`.
  These stay valid: `https://h.test/` and `http://@h.test/`. `ftp://u:p@h.test/` keeps the
  protocol error `must be an http: or https: URL`, because protocol is checked first.
- **`warnDays`.** TLS and domain: `0` and `3650` are valid. `3651`, `10000` (the current test at
  contract `test/validate.test.ts:398` expects valid, and that expectation changes), `-1`, `1.5`
  and `"14"` are rejected with `must be an integer 0..3650`. In the api TLS parser, absent becomes
  14, and `3651` is rejected with `checks[0].warnDays must be an integer from 0 to 3650 (days)`.
- **`latencyMs`.**
  - Contract (both schemas): `0`, `250` and `2147483647` are valid.
  - Contract rejects `-1`, `1.5`, `2147483648`, `NaN`, `Infinity` and `"5"` with
    `must be an integer 0..2147483647`.
  - Api intake: `3.7` is stored as `4`; `0.4` as `0`; `2.5` as `3` (`Math.round`). These are
    rejected with `400`: `-0.4` (raw `< 0` stays unrounded, so the contract rejects it, never
    `0`), `-1`, `NaN`, `"5"`, `2147483647.6` (rounds to `2147483648`).
  - Probe: monotonic readings `100.25` then `101.75` give `2`. `0` then `-3` (a clock that steps
    back) gives `0`.
  - Latency objective 500: a measured `500.4` gives `up`, and `500.5` gives `degraded` with
    `latency 501ms over objective 500ms`.
- **Env names.** Valid: `PULSE_HEADER_SVC_TOKEN`, and `PULSE_HEADER_` plus 115 characters.
  Rejected: `SVC_TOKEN`, `TOKEN`, `PULSE_HEADER_` (no suffix), `pulse_header_x`, and
  `PULSE_HEADER_` plus 116 characters.
- **Served history (api).** A stored `latency_ms` of `12.5` is served as `13`. A stored reason of
  1500 characters is served with length 1000 and ends in `…`. A stored reason of 1000 characters
  is served unchanged.

No statistics are defined or changed. The latency rollups (nearest-rank p50 and p95 per UTC day)
keep reading the stored values.

## Contract fields

New names: `HEADER_ENV_PREFIX`, `MAX_REASON_LENGTH`, `MAX_WARN_DAYS` (contract exports), the probe
setting `PULSE_PROBE_HEADER_HOSTS`, and the probe-internal field `headerDenial` (not on the
wire). No field is renamed. No route changes.

Searches in the clones (contract `ebcbbb6`, config `dc69a126`, kit), each with no match:

```
grep -rn 'HEADER_ENV_PREFIX' .repos/contract/src .repos/config .repos/kit/src         # no match
grep -rn 'MAX_REASON_LENGTH' .repos/contract/src .repos/config .repos/kit/src         # no match
grep -rn 'MAX_WARN_DAYS' .repos/contract/src .repos/config .repos/kit/src             # no match
grep -rn 'PULSE_PROBE_HEADER_HOSTS' .repos/contract/src .repos/config .repos/kit/src  # no match
grep -rn 'headerDenial' .repos/contract/src .repos/config .repos/probe/src            # no match
```

Existing local names that the new exports replace or must not shadow:

- probe `src/client.ts:117`, `const HEADER_ENV_PREFIX`: replaced by the import.
- api `src/server.ts:41`, `export const MAX_REASON_LENGTH = 1000`: the api keeps its export and
  sets it from the contract constant.

## Repository: contract

Files:
- `src/schema.ts`
- `src/index.ts`
- `test/validate.test.ts`
- `test/http-options.test.ts`
- `test/check-types.test.ts`
- `test/admin.test.ts`
- `test/types.fixture.ts`
- `docs/index.md`
- `AGENTS.md`
- `package.json`
- `bun.lock`
- `dist/schema.js`
- `dist/schema.d.ts`
- `dist/index.js`
- `dist/index.d.ts`

Behavior change: yes
Validators reject unprefixed env names, userinfo URLs, `warnDays > 3650`, non-integer or negative latency, and reasons over 1000.

Tool facts:
- `check` is `lint && build && typecheck && test` (`package.json:28`).
- `build` and `typecheck` use `node_modules/typescript7/bin/tsc` (`package.json:22-23`).
- Biome is `2.6.3` (`package.json:31`). `biome.json` extends `@lorenzh/pulse-config/biome.json`,
  which is identical at the pin `51e95b0` and in the clone.
- CI uses `pulse-config/.github/workflows/check.yml@51e95b0` with `build: true`
  (`.github/workflows/ci.yml:17`). At that ref, `check.yml:25-38` runs
  `bun install --frozen-lockfile`, lint, typecheck, build, `git diff --exit-code -- dist` and test
  with Bun `1.4.0` (`:24`). The file is identical to the clone's `main`.
- `bunfig.toml` `[test]` has line coverage 0.8.

Work:
- `src/schema.ts`:
  - `ENV_NAME` becomes `/^PULSE_HEADER_[A-Za-z0-9_]{1,115}$/` with the message from decision 12.
    Export `HEADER_ENV_PREFIX`.
  - The `httpUrl` refine keeps the protocol message. A second refine runs only when the URL
    parses with an http(s) protocol: `must not contain a username or password` when
    `username !== "" || password !== ""`.
  - TLS and domain `warnDays` use `intBetween(0, MAX_WARN_DAYS)`. Update the JSDoc.
  - `resultSchema` and `postResultRequestSchema`: `latencyMs` uses `intBetween(0, MAX_TIMER_MS)`.
    `reason` uses `text.max(MAX_REASON_LENGTH, "must be null or a string of at most 1000
    characters").nullable()`.
  - Export `MAX_REASON_LENGTH = 1000` and `MAX_WARN_DAYS = 3650`, and re-export the three
    constants in `src/index.ts`.
- `package.json:36` becomes `"typescript7": "npm:typescript@7.0.2"`. Run `bun install` so that
  `bun.lock:16` matches. Line 311 already resolves `7.0.2`. Fix the `AGENTS.md` line that calls
  the alias `typescript@^7`.
- Tests:
  - Each counterexample of the contract bullets above (env names, URL userinfo, `warnDays`,
    `latencyMs`, reason boundaries) with the literal messages.
  - Change the existing expectations that encode the old rules: `validate.test.ts:398`
    (`warnDays` 10000), `:399` and `:82` messages, `:149-150`, `:184` latency messages, `{ env:
    "TOKEN" }` at `:565-637`, `http-options.test.ts:66` `MY_TOKEN_1`, `admin.test.ts:36`, `:78`
    `KEY`, `types.fixture.ts:68`.
  - Admin create and replace inputs reject a userinfo URL and an unprefixed env name, through
    `validate-admin`.
- Docs: `docs/index.md` lines 16, 102-104, 123, 178, 190-193, 219 (`SVC_TOKEN` becomes
  `PULSE_HEADER_SVC_TOKEN`), 368 and 383. State the new rules, the three constants, that the
  probe binds `PULSE_HEADER_*` variables to hosts (`PULSE_PROBE_HEADER_HOSTS`, see the probe
  docs), and that the api rounds older probes' fractional latency.
- Build: `bun run build` and commit `dist/`.

Completion evidence:
- `bun run check` is green, and CI is green.
- The diff lists the tests that fail on `ebcbbb6`: userinfo, `warnDays` 3651, result `latencyMs`
  `-1`, `1.5` in both schemas, reason 1001 in both, env `TOKEN`.
- `git diff --exit-code -- dist` is clean after a fresh `bun run build`, so the dist matches an
  independent build.

## Repository: api

Files:
- `package.json`
- `bun.lock`
- `src/server.ts`
- `src/service.ts`
- `src/config.ts`
- `compose.e2e.yaml`
- `src/server.validation.test.ts`
- `src/config.bounds.test.ts`
- `src/config.request.test.ts`
- `src/config-admin.test.ts`
- `src/service.test.ts`
- `src/db.migrations.test.ts` (only if a fixture needs fractional history)
- `docs/configuration.md`
- `docs/rest-api.md`
- `docs/operation.md`
- `docs/troubleshooting.md`
- `README.md`

Behavior change: yes
The intake rounds latency up to `MAX_TIMER_MS`, served history is normalized, TLS `warnDays` is bounded, the contract rules reach checks files and admin writes, and the e2e probe gets a binding.

Tool facts:
- `check` is `lint && typecheck && test` (`package.json:20`). `typecheck` uses `typescript7`
  `7.0.2` (`package.json:14`, `:27`).
- The contract pin is at `package.json:31`.
- CI `check` uses `pulse-config/.github/workflows/check.yml@dc69a126` (`.github/workflows/ci.yml:18`),
  which is identical to `51e95b0` and to the clone (steps as in the contract section, without
  build).
- The `compose-e2e` job runs `bash scripts/compose-e2e.sh` (`ci.yml:66-73`). That script sets
  `COMPOSE_FILE=compose.yaml:compose.e2e.yaml` (`scripts/compose-e2e.sh:13`) and runs
  `docker compose up -d --build` (`:321`). `compose.yaml:28` builds `probe` from
  `pulse-probe.git#main`, and `:41` builds `status` from `#main`.

Work:
- Bump `@lorenzh/pulse-contract` to the merged contract SHA and refresh `bun.lock`.
- `src/server.ts`:
  - `MAX_LATENCY_MS = MAX_TIMER_MS` (imported from the contract).
  - `MAX_REASON_LENGTH` re-exports the contract value.
  - In `validateResult`, before `validatePostResultRequest`: if the body is a plain object whose
    `latencyMs` is a finite number `>= 0`, validate a shallow copy with `latencyMs:
    Math.round(raw)`. Otherwise validate the body as it is. The later checks and the built
    `Result` use the copy. The message for a rejected latency becomes the contract's
    (`latencyMs: must be an integer 0..2147483647`, with the path the api already prefixes).
- `src/service.ts` `toResult` (`:606-619`):
  - `latencyMs: Math.min(MAX_TIMER_MS, Math.max(0, Math.round(r.latency_ms)))`.
  - `reason` over `MAX_REASON_LENGTH` becomes `slice(0, 999) + "…"`.
  - This covers `GET /checks/:id/results` and every `locations[].result`. Rows are not rewritten.
- `src/config.ts`:
  - `TLS_SCHEMA.warnDays` gets `.max(MAX_WARN_DAYS)`. The message becomes
    `must be an integer from 0 to 3650 (days)` for every failure of the field.
  - `parseTls` validates the built check with `validateCheck` and throws `ConfigError` like
    `parseHttp` (`:249-250`). The contract then owns the rule for file reload and admin writes
    too (`src/config-write.ts` reuses these parsers).
- `compose.e2e.yaml` `probe.environment`: add
  `PULSE_PROBE_HEADER_HOSTS: '{"PULSE_HEADER_SVC_TOKEN":["e2e-target"]}'`, with a comment that
  binds the e2e secret to the e2e target only. The e2e-post check URL `http://e2e-target:8000/svc`
  (`compose/e2e/ro/checks.json:13`) has hostname `e2e-target`.
- Docs:
  - `docs/operation.md`: a section on admin tokens: an admin token can point any check that
    references `{ "env": NAME }` at a URL, and the probe sends the secret there if the probe binds
    `NAME` to that host. So an admin token is as sensitive as every header secret it can address,
    and the probe's `PULSE_PROBE_HEADER_HOSTS` is the limit. Add an upgrade note with the
    operator steps of rollout step 2.
  - `docs/configuration.md`: `warnDays` 0..3650, URL without userinfo, env names
    `PULSE_HEADER_[A-Za-z0-9_]{1,115}`.
  - `docs/rest-api.md:46`: `latencyMs` is an integer 0..2147483647. A finite fraction `>= 0` is
    rounded to the nearest integer before validation, for older probes. Served results carry
    integers.
  - `docs/troubleshooting.md:83`: the new message.
  - `README.md` where it summarizes these limits.
- Tests, with literal expectations:
  - `POST /results` with `latencyMs` `3.7` gives `204`, and the stored result reads back `4`.
    `2.5` reads back `3`.
  - `-0.4`, `-1`, `2147483647.6`, `"5"` and `NaN` (sent as a JSON string body that the test
    builds) give `400`.
  - `2147483647` gives `204`.
  - A reason of 1000 characters gives `204`, and one of 1001 gives `400`.
  - A database seeded by direct `INSERT` with `latency_ms = 12.5` and a 1500-character reason:
    `GET /checks/<id>/results` and `GET /checks` serve `13` and a reason of length 1000. The
    response passes `validateResultsResponse` and `validateChecksResponse` of the new contract.
  - Checks file and admin `POST`/`PUT /admin/checks`: a userinfo URL, TLS `warnDays: 3651`,
    domain `warnDays: 3651` and an `env` of `SVC_TOKEN` are rejected. Admin answers `422`, and the
    file bytes do not change.
  - TLS `warnDays` absent is 14, and `3650` is accepted.
  - Update the tests that use unprefixed env names (`config.request.test.ts:52` keeps `1BAD` as
    an invalid name).
- The literal of the `POST /results` latency bound test becomes `2147483647`. #545 rewrites the
  bound tests to literals; see Risks.

Completion evidence:
- `bun run check` is green, and CI is green, including `compose-e2e` with the authenticated
  `e2e-post` check `up`. That job runs against probe `main` before the probe child merges; record
  the probe and status SHAs built.
- A list of the new tests that fail on `c00a375`: fractional intake rounding (`3.7` → `204`),
  latency `2147483647` → `204`, served `12.5` → `13`, TLS `warnDays: 3651` rejected, and userinfo
  rejected after the pin.
- The bench table of the Performance impact section.

## Repository: probe

Files:
- `package.json`
- `bun.lock`
- `src/settings.ts`
- `src/header-hosts.ts` (new: parse and match the binding)
- `src/header-hosts.test.ts` (new)
- `src/reason.ts` (new: `quote`, `capReason`)
- `src/client.ts`
- `src/check.ts`
- `src/check-domain.ts`
- `src/check-dns.ts`
- `src/main.ts`
- `src/client.test.ts`
- `src/client.http-options.test.ts`
- `src/check.test.ts`
- `src/check.redirect.test.ts`
- `src/check.domain.test.ts`
- `src/check.dns.test.ts`
- `src/check.tcp.test.ts`
- `src/settings.test.ts`
- `src/main.test.ts`
- `README.md`
- `docs/configuration.md`
- `docs/operation.md`
- `docs/troubleshooting.md`

Behavior change: yes
A new setting, header host binding with denial results, reason caps and integer latency.

Tool facts:
- `check` is `lint && typecheck && test` (`package.json:19`). `typecheck` uses `typescript7`
  `7.0.2` (`package.json:14`, `:27`).
- The contract pin is at `package.json:30`.
- CI `check` uses `pulse-config/.github/workflows/check.yml@dc69a126` (`.github/workflows/ci.yml:18`),
  which is identical to the clone. `biome.json` extends the shared config, identical at
  `dc69a126`.
- Settings errors are `StartupError` from `loadSettings` (`src/settings.ts:58-83`) and stop the
  start with exit code 2 (`docs/configuration.md:56`).

Work:
- Bump `@lorenzh/pulse-contract` to the merged contract SHA and refresh `bun.lock`.
- `src/header-hosts.ts`:
  - `parseHeaderHosts(text: string | undefined): HeaderHosts`, where `HeaderHosts =
    ReadonlyMap<string, ReadonlySet<string>>`. It is pure and throws `StartupError` with the
    messages of the Counterexamples.
  - `canonicalHost(url: string): string | undefined` and `isBound(hosts, variable, url):
    boolean`, implementing decisions 2-4.
- `src/settings.ts`: `Settings.headerHosts` from `env.PULSE_PROBE_HEADER_HOSTS`. Log the start
  line `header host bindings for <n> variable(s)` with the count only.
- `src/client.ts`:
  - `ProbeCheck` becomes `Exclude<Check, HeartbeatCheck> & { headerDenial?: string }`.
  - `loadChecks`/`fetchChecks` take `headerHosts` (default: empty map, deny).
  - `resolveHeaders` follows decision 5. The binding is checked before `env[...]` is read.
  - A denial returns the check without `headers` and with `headerDenial` (decision 6), and logs
    the warn line once per load.
  - Import `HEADER_ENV_PREFIX` from the contract.
- `src/main.ts`: pass `settings.headerHosts` to both `fetchChecks` and the reloader's
  `loadChecks`.
- `src/reason.ts`: move `quote` there from `check.ts:220-225`, and add `capReason`.
  - `check.ts`: `urlFailure` (`:370`) quotes `parsed.protocol`, `hopTarget` (`:433`) quotes
    `target.protocol`, `secretHop` (`:449`) quotes `target.origin`, and `bodyFailure` (`:305`)
    quotes the keyword.
  - `check-domain.ts:183`, `:185` quote the protocol and host.
  - `check-dns.ts:118` quotes each joined list.
- `src/check.ts` `runCheck`:
  - If `check.headerDenial` is set, return the denial result before any attempt.
  - `finish` uses the rounded, clamped latency of decision 10.
  - Every returned result has `reason: capReason(reason)`, including the degraded override at
    `:163-168`. Put this at the single exit of `runCheck`.
- Docs: `README.md` settings table and `docs/configuration.md`:
  - The new variable, format, matching, examples and denial reason and log line.
  - That it is read only at start.
  - A "Migration" entry: set the variable before the upgrade, or `{ env }` checks report down.
    Integer latency. The 1000-character reason cap.
- Also in the docs: `docs/operation.md` and `docs/troubleshooting.md` for the denial reason and
  the startup errors.
- Tests (literals; fakes for `fetch`; no real network). Each of the first two fails on `50ec9ca`.
  1. **Unbound header not sent.** Policy `{"PULSE_HEADER_T":["a.test"]}`, env `PULSE_HEADER_T =
     "Bearer sentinel-552"`, and a fake API serving one check on `http://b.test/x` with
     `Authorization: {env: PULSE_HEADER_T}`.
     - After `loadChecks` and `runCheck`, the fake target `fetch` received 0 requests.
     - The result is `down`, `statusCode` null, `attempts` 1, `latencyMs` 0, and the reason is
       `header Authorization env PULSE_HEADER_T is not bound to host b.test`.
     - `JSON.stringify(result)` and every log line contain no `sentinel-552`.
     - The same check on `http://a.test/x` makes one request with
       `authorization: Bearer sentinel-552`.
     - A reload that changes the URL from `a.test` to `b.test` makes no request to `b.test`.
     - Repeat with no key in the policy, and with `[]`.
  2. **Long target, capped reason.** A secret-bearing check gets 302 to
     `http://<2000 × "a">.test/`. Then a 2000-character scheme.
     - The reasons equal `redirect to http://<80 × "a">… not followed` and
       `redirect to <80 × "a">… not followed`.
     - `validatePostResultRequest(result).ok` is `true` with the new contract.
     - `reason.length <= 1000`. 1000 is the api's literal limit at `src/server.ts:41`.
     - The RDAP redirect host case, the DNS 20 × 500 case (length exactly 1000) and the TCP
       5000-character error case come from the Counterexamples.
  3. Latency readings `100.25` → `101.75` give `latencyMs` `2`, and the objective edge cases
     `500.4` and `500.5`.
  4. The setting's valid and invalid cases of the Counterexamples, through `loadSettings`. Each
     error is a `StartupError` with the literal message, and no message contains the raw JSON.
  5. Kept as guards: same-origin redirects with an allowed header still work. Cross-origin and
     downgrade redirects stay blocked even when both hosts are bound. Checks with only literal
     headers or none behave as before. Unset or invalid variables still skip with today's log
     lines.

Completion evidence:
- `bun run check` is green, and CI is green.
- A list of the tests that fail on `50ec9ca` (tests 1-3).
- `bun start` with `PULSE_PROBE_HEADER_HOSTS='{'` exits 2 with the literal message. Report the
  command and output.
- Api `compose-e2e` run locally from api `main` (with the merged fixture). Edit `compose.yaml:28`
  only in a local, uncommitted copy so that it builds `pulse-probe.git#<probe branch sha>`. The
  run is green with `e2e-post` `up`. Record the api, probe and status SHAs.
- The bench table, if run.

## Repository: status

Files:
- `package.json`
- `bun.lock`
- `src/poller.test.ts` (or the existing poller test file that drives a fake API)

Behavior change: yes
The new pin makes the server poller reject API data with fractional or negative latency, reasons over 1000, userinfo URLs or `warnDays > 3650`.

Tool facts:
- `check` is `lint && typecheck && test` (`package.json:19`). `typecheck` runs `typescript7` on
  `.` and on `e2e` (`package.json:13`, pin `:29`).
- The contract pin is at `package.json:34` (`9fe5e80`).
- CI `check` uses `pulse-config/.github/workflows/check.yml@dc69a126` (`.github/workflows/ci.yml:18`),
  which is identical to the clone. CI also runs `bun run check:a11y` (`ci.yml:66`,
  `package.json:18`).

Work:
- Bump `@lorenzh/pulse-contract` to the merged contract SHA and refresh `bun.lock`.
- The placeholders in `src/poller.ts:112-124` (`warnDays: 0`, `https://hidden.invalid/`) stay
  valid. Verify and do not change them.
- Add one test: a fake API `/checks` whose nested result has `latencyMs: 13` and a 1000-character
  reason is accepted. The same with `latencyMs: 12.5` is reported as invalid data, the way the
  poller reports a validation failure today.

Completion evidence:
- `bun run check` and `check:a11y` are green, and CI is green.
- The new test fails on `2e3067d` for the `12.5` case.

## Repository: notify

Files:
- `package.json`
- `bun.lock`
- `test/api.test.ts` (or the existing test of `fetchChecks`)

Behavior change: yes
The new pin makes `fetchChecks` drop checks with userinfo URLs or `warnDays > 3650` (`src/api.ts:174`), and `validateIncident` follows the new contract.

Tool facts:
- `check` is `lint && typecheck && test` (`package.json:17`). `typecheck` uses `typescript7`
  `7.0.2` (`package.json:12`, `:27`).
- The contract pin is at `package.json:30` (`61f7bf8`).
- CI `check` uses `pulse-config/.github/workflows/check.yml@dc69a126` (`.github/workflows/ci.yml:18`),
  which is identical to the clone.

Work:
- Bump `@lorenzh/pulse-contract` to the merged contract SHA and refresh `bun.lock`.
- Add one test: a fake API `/checks` with `{ ..., url: "https://u:p@x.test/" }` at index 0. The
  check is dropped. `onInvalidCheck` receives exactly
  `checks[0].url: must not contain a username or password`, and the text has no `u:p`.

Completion evidence:
- `bun run check` is green, and CI is green.
- The new test fails on `c090a07`.

## Acceptance evidence

These are the issue's acceptance criteria and where their expected values come from:

| Criterion | Test | Expected value from |
| --- | --- | --- |
| An unbound header is not sent to another host | probe test 1 | Literal: 0 requests, the reason text above, no `sentinel-552` |
| A 2000-character target posts a capped reason that the api accepts | probe test 2, and the api test that 1000 characters give `204` | Literal 1000 (api `src/server.ts:41`, independent of the probe) and the quoted reason literal |
| A URL with userinfo is rejected | contract userinfo tests, api `422`, notify drop | Literal message, literal `422` |
| Out-of-range `warnDays` and negative `latencyMs` are rejected | contract tests (`3651`, `-1`), api TLS `3651` | Literal messages |
| CI green in every touched repo; `compose-e2e` green | CI of contract, api, probe, status and notify; api `compose-e2e` after the api merge and again after the probe merge (re-run on `main`) | CI conclusions; `e2e-post` `up` in the script |

No check compares a value with one read or regenerated from the file under test. The dist check
compares the committed `dist/` with an independent fresh build.
