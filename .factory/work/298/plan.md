# Plan: pulse-kit shared runtime helpers (#298)

Step S4 of #166. kit gets the shared runtime helpers; probe, status, notify and api adopt them and delete their copies.

## Goal

`lorenzh/pulse-kit` holds settings readers, `StartupError`, `runService`, the ops server, a metrics registry, one JSON logger, `formatDuration`, `escapeHtml`/`escapeLabel`, `sendJson`, `readJsonBody` and a safe `setTimeout`. The four services use them. External behavior stays, except the differences listed under "Accepted differences".

## Scope

- kit: new modules, tests, docs, committed `dist`.
- probe, status, notify, api: pin the merged kit SHA, replace local copies.
- Every target repo's `AGENTS.md` gets the use-kit-first rule (contract and config: that line only).

## Non-goals

- No config-file parsers on zod (S5): api and notify keep their config-file parsing; only their env reads move.
- No wire format or contract change. No new port for api/status ops (they keep serving ops on their main listener).
- zod is not added to kit: no helper needs it (the issue allows, not requires, it). The env readers are plain code.
- Services do not import `pulse-contract` into kit; kit imports nothing but Node built-ins.

## Facts checked in the clones

- `escapeLabel` (api, probe, notify) is identical: `\` → `\\`, `"` → `\"`, newline → `\n`. Kit uses exactly that.
- `formatDuration` exists twice: status `render.ts` ("2 h 5 min", "<1 min", "3 d 2 h") and notify `channels/message.ts` ("3h 5m", "<1m", "1d 2h"). Both server-side only; status browser code does not use it.
- Loggers: probe `{debug,info,warn,error}(msg, fields)` with injected `write(level,line)` (base keys win over fields); status a function `(level,msg,fields)` that sends warn/error to stderr, rest to stdout; api the same four methods with `LogLevelError`; notify `log(level,msg,fields)` to stderr. All emit `{time ISO, level, msg, ...fields}`. All parse `PULSE_LOG_LEVEL` the same way but with different error texts.
- Ops: probe has a dedicated listener (`PULSE_HEALTH_PORT`, `PULSE_HEALTH_HOST`; GET only, 404 otherwise); notify has a dedicated listener with `/healthz` (readiness-like, 503 plus reason) and `/metrics`, GET and HEAD, 405 otherwise; api and status serve `/healthz`, `/readyz`, `/metrics` inside the main server.
- Shutdown: status `shutdown.ts` exits 0 also on timeout; probe has its own wiring with a timeout log line; api `main.ts`, notify `index.ts` have theirs.
- Metrics: api and notify render from live state at scrape time; each service owns its metric names, help texts, labels and order.

## Kit API (binding for all children)

All exports are named exports of the package root `@lorenzh/pulse-kit` (`dist/index.js`, one `src/<module>.ts` per module re-exported from `src/index.ts`; the root file re-exports only, which is allowed for a package entry). Additionally, browser-safe modules are importable as subpaths: `@lorenzh/pulse-kit/format-duration` and `@lorenzh/pulse-kit/escape` (add to `package.json` `exports`; these two modules import nothing from Node).

### `settings.ts` – env readers and `StartupError`

```ts
export class StartupError extends Error {          // name = "StartupError"
  readonly setting: string | undefined;            // env var name
  constructor(message: string, opts?: { setting?: string; cause?: unknown });
}
export type Env = Readonly<Record<string, string | undefined>>;
export function readMs(env: Env, name: string, opts: { fallback: number; min: number; max?: number }): number;
export function readPort(env: Env, name: string, opts?: { fallback?: number; min?: number }): number | undefined; // integer 0..65535; unset/blank → fallback (default undefined)
export function readUrl(env: Env, name: string, opts?: { protocols?: readonly string[]; allowCredentials?: boolean; allowQueryOrFragment?: boolean }): string | undefined; // unset/blank → undefined; returns href without trailing "/"
export function readEnum<T extends string>(env: Env, name: string, values: readonly T[], fallback: T): T;
export function readBool(env: Env, name: string, fallback: boolean): boolean; // true/false/1/0
export function readString(env: Env, name: string): string | undefined;        // trimmed; blank → undefined
export function readLogLevel(env: Env): LogLevel;   // PULSE_LOG_LEVEL, default info; in logger.ts
```

Unset or blank gives the fallback. An invalid value throws `StartupError` with `setting` set and a message `"<NAME>: <rule>"` that never contains the raw value. Every reader accepts an optional `describe?: string` in its options that replaces `<rule>`, so a service keeps today's asserted message text (`"<NAME>: must be an integer >= 1000"` is the default for `readMs`; `"<NAME>: must be an integer from <min> to <max>"` when `max` is set; `"<NAME>: must be one of a, b"`, `"<NAME>: must be true, false, 1 or 0"`, `"<NAME>: must be an integer from 0 to 65535"`, `"<NAME>: must be an http(s) URL without credentials, query or fragment"`). `StartupError` is the only startup/config error class of the services; services delete their own (`SettingsError`, `LogLevelError`, health settings errors, notify config-env errors).

### `run-service.ts`

```ts
export interface RunServiceOptions {
  service: string;                       // "probe" etc.; prefixes startup error lines
  start: () => Promise<void>;            // starts everything; may throw
  stop: (signal: string) => Promise<void>; // idempotent graceful stop
  timeoutMs: number;                     // bound on stop
  log?: Logger;                          // for "shutting down" and timeout lines
  proc?: { on(sig: "SIGINT" | "SIGTERM", fn: () => void): void; exit(code: number): void; stderr: { write(s: string): void } }; // default `process`
  setTimeout?: typeof setTimeout; clearTimeout?: typeof clearTimeout; // injectable for tests
}
export function runService(opts: RunServiceOptions): Promise<void>;
```

Behavior: registers SIGINT and SIGTERM first, before `start`. A signal while `start` still runs waits for `start` to settle, then stops (a signal before anything started exits 0). `start` throwing `StartupError` writes one line `pulse-<service>: <message>\n` to stderr and exits 2; any other throw logs `startup failed` (error fields via the logger when given, else a stderr line `pulse-<service>: <message>`) and exits 1. On signal: log `shutting down` with `{signal}`, run `stop`, exit 0 when it finishes; if `stop` does not finish within `timeoutMs`, log warn `shutdown did not finish within <timeoutMs>ms; exiting anyway` (fields `{timeoutMs}`) and exit 0 as today (probe and status exit 0 on timeout; if a service exits otherwise today, the child keeps today's code via an optional `timeoutExitCode`, default 0). `stop` throwing exits 1. A second signal does nothing extra. The timer is cleared on a clean stop.

### `ops-server.ts`

```ts
export type Readiness = { ready: true } | { ready: false; reason: string };
export interface OpsHandlers {
  live?: () => Readiness;                // default always ready; /healthz
  ready: () => Readiness;                // /readyz
  metrics: () => string;                 // /metrics, Prometheus text
  allowHead?: boolean;                   // default false
}
export function handleOps(req: IncomingMessage, res: ServerResponse, handlers: OpsHandlers): boolean; // true when the path was an ops path (answered), false otherwise so the caller continues
export function startOpsServer(opts: OpsHandlers & { host: string; port: number }): Promise<OpsServer>;
export interface OpsServer { port: number; close(): Promise<void> }
```

`/healthz`: 200 `ok\n`, or 503 `<reason>\n` when `live` says not ready; `/readyz`: 200 `ok\n` or 503 `<reason>\n`; `/metrics`: 200, `content-type: text/plain; version=0.0.4; charset=utf-8`. Plain bodies use `content-type: text/plain`. Other path in `startOpsServer`: 404 `not found\n`; wrong method: 405 `method not allowed\n` (both for probe and notify the services keep today's choice via the option `methodNotAllowed: "404" | "405"`, default `"405"`; probe passes `"404"`). A bind failure (`EADDRINUSE`, `EACCES`, `EADDRNOTAVAIL`) rejects with `StartupError` naming `opts.setting` (optional `setting` option, e.g. `PULSE_HEALTH_PORT`). `close()` closes the listener and all connections. `handleOps` leaves methods and unknown paths to the caller (returns false for non-ops paths; for an ops path with a non-GET/HEAD method it answers 405 and returns true; api/status check what they do today and pass `methodNotAllowed`).

### `metrics.ts`

```ts
export const DURATION_BUCKETS_SECONDS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const;
export type Labels = Readonly<Record<string, string>>;
export interface Counter { inc(labels?: Labels, by?: number): void; remove(match: Labels): void; }
export interface Gauge { set(value: number, labels?: Labels): void; remove(match: Labels): void; }
export interface Histogram { observe(value: number, labels?: Labels): void; remove(match: Labels): void; }
export interface Registry {
  counter(name: string, help: string): Counter;
  gauge(name: string, help: string): Gauge;
  histogram(name: string, help: string, buckets?: readonly number[]): Histogram; // default DURATION_BUCKETS_SECONDS
  collect(fn: () => void): void;   // runs before every render, to set gauges from live state
  render(): string;                // Prometheus text format
}
export function createRegistry(): Registry;
```

Render: metrics in registration order; per metric `# HELP`, `# TYPE`, then series in insertion order, label order as given; label values escaped with `escapeLabel`; histogram lines `_bucket{...,le="<bound>"}`, `le="+Inf"`, `_sum`, `_count`; a metric with no series still prints HELP and TYPE; output ends with one `\n`. Number formatting equals `String(n)`, as today. A series set via `gauge.set` with no labels renders `name value`. Registering the same name twice throws. `remove(match)` deletes the series whose labels contain every pair of `match` (for probe's `setChecks`).

### `logger.ts`

```ts
export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogFields = Record<string, unknown>;
export interface Logger { debug/info/warn/error(msg: string, fields?: LogFields): void }
export interface LoggerOptions {
  level?: LogLevel;                        // default info
  now?: () => number;                      // default Date.now
  write?: (level: LogLevel, line: string) => void; // line has no newline; default: warn/error → stderr, others → stdout, plus "\n"
}
export function createLogger(opts?: LoggerOptions): Logger;
export function readLogLevel(env: Env): LogLevel;  // PULSE_LOG_LEVEL → StartupError("PULSE_LOG_LEVEL: must be one of debug, info, warn, error")
```

Line: `JSON.stringify({ time: <ISO>, level, msg, ...fields })` with `time`, `level`, `msg` first and not overridable by a field (probe's behavior). A service whose log goes to one stream today passes `write` (notify and api: stderr; probe: its current routing; status: stdout/stderr split which is the kit default). A service with a function- or `log(level,…)`-style logger adapts its call sites to the four methods.

### `format-duration.ts` (browser-safe, no imports)

`export function formatDuration(ms: number): string` — whole minutes, units days, hours, minutes, no seconds; at most two units, the second dropped when 0; negative or NaN counts as 0. Uses `Intl.DurationFormat("en", { style: "narrow" })`. Output: `"<1m"` under 60 000 ms, `"12m"`, `"3h 5m"`, `"3h"`, `"1d 2h"`, `"2d"`. This is notify's current text exactly. If the runtime lacks `Intl.DurationFormat` (older browser), it falls back to the same strings built by hand, so one format everywhere.

### `escape.ts` (browser-safe, no imports)

`escapeHtml(s)` (`& < > " '` → `&amp; &lt; &gt; &quot; &#39;`; each child checks the existing copy in status and keeps that mapping, adjusting the kit mapping if status's tests demand another), `escapeLabel(s)` (as above).

### `http.ts`

```ts
export class BodyError extends Error { readonly status: 400 | 413; readonly code: "too-large" | "invalid-json" | "aborted" }
export function sendJson(res: ServerResponse, status: number, body: unknown, headers?: Record<string, string>): void; // content-type: application/json; charset=utf-8? — keep today's header value of api and status; the child that finds the two differ lists it. Body JSON.stringify(body); content-length set.
export function readBody(req: IncomingMessage, maxBytes: number): Promise<string>;   // throws BodyError("too-large", 413) over limit, stops reading
export function readJsonBody(req: IncomingMessage, opts: { maxBytes: number }): Promise<unknown>; // BodyError invalid-json → 400
```

Services map `BodyError.status` to their existing error body (api `HttpError`, status's responses). `readBody` is exported because api reads a ping body without parsing.

### `timer.ts`

`MAX_TIMER_DELAY_MS` (kept) and `safeSetTimeout(fn, ms, setTimeoutImpl = setTimeout): ReturnType<typeof setTimeout>` — throws `RangeError("timer delay must be an integer from 0 to 2147483647 ms")` for NaN, negative, non-integer or `> MAX_TIMER_DELAY_MS`; no clamping. Existing callers that `Math.min(MAX_TIMER_MS, …)` keep capping before the call and may switch to it; this is optional for children.

## Accepted differences (documented per repo in its docs/README changelog section)

- `formatDuration`: status now prints `"2h 5m"`, `"<1m"`, `"3d 2h"` instead of `"2 h 5 min"`, `"<1 min"`, `"3 d 2 h"`; status tests and golden pages update. notify output is unchanged. Relative-time text ("5 min ago") in status is not touched.
- Error texts: where a test asserts today's startup message, the child passes `describe` so the text stays. A message that changes only by the `pulse-<service>: ` prefix on stderr is accepted. Startup failures now all exit 2 (a service that exited 1 for bad env changes; the child lists it).
- notify gains `/readyz` (same body and status rule as `/healthz` today); notify `/healthz` keeps today's readiness-like status and body through `live`. Documented in notify's docs.
- Logger: a logger writing JSON with `time`, `level`, `msg` first and fields after; a field named `time`, `level` or `msg` no longer overrides the base key in status, api and notify (it did not in probe). Any field that does this today is renamed by the child and listed.

## Risks

- A dependency on a SHA: kit `dist` must be committed on `main` before the children pin. Each service Dockerfile (`probe`, `status`, `notify`, `api`) must still `npm ci` a git dependency (probe's already installs `pulse-contract` the same way, with `git` and `.npmrc`); children verify and adapt the Dockerfile only where it lacks `git`.
- A child must not assume kit exports beyond this spec. If the merged kit differs from this API, the child follows the merged kit and states the difference in its PR.
- `compose-e2e` builds other services from `main`, so api goes last.

## Acceptance evidence

1. kit: `npm run check` passes; one test file per module; `docs/index.md` lists every export with signature; `dist` committed and current (build output equals the commit).
2. api, probe, status, notify: `package.json` pins `@lorenzh/pulse-kit` to the merged kit SHA; grep shows no local `escapeLabel`, `sendJson`, `readBody`, `formatDuration`, settings error class, shutdown wiring, health listener, metrics registry or logger implementation.
3. `npm run check` passes in each with only the documented test changes; every repo's `AGENTS.md` carries the rule.
4. `compose-e2e` is green on the api PR; `/healthz`, `/readyz`, `/metrics` answer as before; a bad env value exits 2 with `pulse-<service>: <message>`; SIGTERM stops each service within its timeout.

## Repository: kit

Files: `src/settings.ts`, `src/run-service.ts`, `src/ops-server.ts`, `src/metrics.ts`, `src/logger.ts`, `src/format-duration.ts`, `src/escape.ts`, `src/http.ts`, `src/timer.ts` (move `MAX_TIMER_DELAY_MS` here, re-export from `src/index.ts`), each with `src/<module>.test.ts` or `test/<module>.test.ts` next to the existing `test/` files; `package.json` `exports` (root plus `./format-duration` and `./escape`; no runtime dependencies); `docs/index.md` (every export, signature, behavior, the accepted formats); `README.md`; `AGENTS.md` (rule: use pulse-kit, pulse-contract or an approved package before writing infrastructure code; propose an addition to pulse-kit rather than a local helper); committed `dist` rebuilt with `npm run build`.

Behavior: the API above exactly. Tests use fakes (injected `proc`, timers, `now`), real servers on `127.0.0.1:0` for the ops server and body helpers, a bind-error test (port in use → `StartupError`), a test that the two browser-safe modules contain no `node:` import (read the source), histogram bucket list test, `escapeLabel` test for `\`, `"`, newline.

Checks: `npm run check` (80 % coverage gate holds).

Done when: the kit PR is merged on `main` with current `dist`; its merge commit SHA is what the children pin.

## Repository: probe

Depends on kit. Files: `package.json`/`package-lock.json` (pin kit SHA), `Dockerfile` (only if the install needs a change), `src/settings.ts` (use `readPort`/`readString`, `StartupError`; keep `PULSE_HEALTH_PORT`/`PULSE_HEALTH_HOST`, default host `127.0.0.1`, same message texts via `describe`), `src/health.ts` (delete; use `startOpsServer` with `methodNotAllowed: "404"`, `live` always ready, `ready` from today's readiness), `src/metrics.ts` (build on `createRegistry`: same names, help, labels, bucket list, order; `setChecks` uses `remove`; `collect` where needed; delete local `escapeLabel`), `src/log.ts` (use kit logger and `readLogLevel`; same routing of lines), `src/main.ts` (use `runService`; `timeoutMs` as today; keep today's timeout log text and exit codes), `AGENTS.md` (rule), README/docs (accepted differences). Update `settings.test.ts`, `health.test.ts`, `metrics.test.ts`, `log.test.ts`, `main.test.ts` only for moved code; the behavior assertions stay.

Done when: `npm run check` passes; `/metrics` output is byte-identical to before for the same input (tests assert it); no local copy of the listed helpers remains.

## Repository: status

Depends on kit. Files: `package.json`/lockfile, `Dockerfile` if needed, `src/settings.ts` (kit readers; keep `PULSE_STATUS_*` names, texts via `describe`, `parsePublicUrl` via `readUrl`), `src/shutdown.ts` (delete; `runService`, exit 0 on timeout), `src/log.ts` (kit logger; stdout/stderr split kept), `src/metrics.ts` (registry; same metric output), `src/server.ts` (use `handleOps` for `/healthz`, `/readyz`, `/metrics` on the main listener, kit `sendJson`, `escapeHtml`), `src/render.ts` (use kit `formatDuration` and `escapeHtml`; delete local ones), `src/main.ts`, `AGENTS.md`, docs. `formatDuration` is server-side only today, so no browser use of kit and no change to the contract-module serving; if `public/` code carries its own `escapeHtml` it stays and a comment says so. Update `render.test.ts` and any golden page for the new duration text, and `settings.test.ts`, `shutdown.test.ts` (delete or move to the `runService` wiring test), `log.test.ts`, `metrics.test.ts`.

Done when: `npm run check` passes; the duration change is listed in docs; health and metrics responses unchanged.

## Repository: notify

Depends on kit. Files: `package.json`/lockfile, `Dockerfile` if needed, `src/health.ts` (delete; `startOpsServer` with `allowHead: true`, `live` = today's readiness (`/healthz` keeps 503 plus reason), `ready` = the same check, so `/readyz` is added), `src/metrics.ts` (registry with `collect`; same names, labels, order), `src/log.ts` (kit logger writing to stderr; call sites move from `log(level, …)` to the four methods; `errorFields` stays in `errors.ts`), env reads in `src/config.ts` and `src/index.ts` via kit readers (config-file parsing untouched, S5), `src/index.ts` via `runService`, `src/timeout.ts` (use kit timer helper where it caps; keep behavior), `src/channels/message.ts` (delete local `formatDuration`; kit's output is identical), `AGENTS.md`, docs (`/readyz` added). Existing tests under `test/` keep passing.

Done when: `npm run check` passes; message texts unchanged; `/readyz` documented and tested.

## Repository: api

Depends on kit, probe, status and notify (last; its `compose-e2e` builds the others from `main`, so their kit migration must be merged). Files: `package.json`/lockfile, `Dockerfile` if needed, `src/config.ts` (env reads via kit readers, `StartupError`; config-file parsing stays; texts asserted in `config*.test.ts` kept via `describe`), `src/log.ts` (kit logger, writes to the stream it uses today; delete `LogLevelError`), `src/metrics.ts` (registry with `collect` from `listCheckStates()`; same output), `src/server.ts` (`handleOps` on the main API listener, kit `sendJson`, `readBody`/`readJsonBody` mapped to `HttpError` 413/400 with today's bodies), `src/main.ts` and `src/start.ts` (`runService`; today's timeout), `AGENTS.md`, docs and compose files (`compose-e2e` adjusts only if a Dockerfile change is needed). Update the moved-code tests; behavior tests (`server*.test.ts`, `main.test.ts`, `start.test.ts`) keep their assertions.

Done when: `npm run check` passes and `compose-e2e` is green: the services start, `/healthz`, `/readyz`, `/metrics` answer, a bad env value exits 2 with `pulse-<service>: <message>`, SIGTERM stops each service within its timeout.

## Repository: contract

No dependency. Only `AGENTS.md`: add the rule "use pulse-kit, pulse-contract or an approved package before writing infrastructure code; propose an addition to pulse-kit instead of a local helper". No code change; `npm run check` passes.

## Repository: config

No dependency. Only `AGENTS.md`: the same rule. No code change; `npm run check` passes.
