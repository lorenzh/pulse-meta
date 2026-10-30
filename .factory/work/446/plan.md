# Spec #446: Small review leftovers (P3), round 6

## Goal

Fix two small leftovers from the reviews after #433:

1. **api docs.** `docs/install.md` and the comment in `compose.yaml` say that the admin routes
   answer `503` on the read-only Compose mount. That is wrong for reads: an authenticated
   `GET /admin/config` answers `200`. Only a config write that passes the request checks answers
   `503`. The text must say that.
2. **contract validator.** `validateAdminCheckInput` reads `type` with plain property access and
   `secret` with `Reflect.get`. Both run a getter and read inherited values. Read them as own data
   properties, like the other validators do (`ownValue` in `src/validate.ts`).

## Scope

- `api`: only text changes in `docs/install.md` and in the comment above the `./compose:/config:ro`
  mount in `compose.yaml`. No code, no behavior change.
- `contract`: `src/validate-admin.ts` (`checkInputProblem`), `src/validate.ts` (export
  `ownValue`), tests in `test/admin.test.ts`, rebuilt `dist/`.

## Non-goals

- **meta README.** `README.md:71` in this repository already has the right wording (off by default
  `404`, authenticated `GET /admin/config` `200`, a write that passes the request checks `503`), and
  the single-file mount limit sentence is gone (commit `80e0248`). No meta change apart from this
  spec. `meta` is not a target.
- No change to api behavior, status codes, their order, the Compose mount line
  (`./compose:/config:ro`), `docs/operation.md`, or `docs/rest-api.md` (both are already right:
  `docs/operation.md:126` says a write answers `503`; `docs/rest-api.md:325` documents the status
  order).
- No public API change in contract: `ownValue` is not added to `src/index.ts`. No schema change,
  no wire version change, no contract pin bump in api.
- `validateAdminCheckInput` keeps returning the same object it got (documented "Returns the same
  object"). Making a copy without accessors is out of scope; api only ever passes parsed JSON,
  which has no accessors.
- The heartbeat `secret` accessor case (an own accessor `secret` on a heartbeat check is treated as
  absent by `problem()` and accepted) stays as it is; it already matches how the other validators
  treat accessors.

## Required behavior

### api: wording

The new text in `docs/install.md` (replacing the sentence "The mount is read-only, so the
[admin routes](rest-api.md#admin-config-routes) answer `503`; see …") must state all of:

- The [admin config routes](rest-api.md#admin-config-routes) are off by default: without
  `PULSE_API_ADMIN_TOKENS_FILE` every admin route answers `404`.
- With admin tokens, an authenticated `GET /admin/config` answers `200` also on the read-only mount.
- A config write (`POST`/`PUT`/`DELETE` on checks, components or maintenance) that passes the
  request checks (token, body size, JSON, id, `If-Match`) answers `503` while the directory is
  mounted read-only.
- The link to [Operation](operation.md#changing-checks) for mounting the directory writable stays.

It must **not** say "otherwise valid" or "valid write": the `503` comes before the revision check
(`412`) and the body validation (`422`), so a write with an invalid body also gets `503`. It must
not say that "the admin routes answer `503`" without limiting it to writes.

A suggested sentence (the implementer may adjust style, not meaning):

> The [admin config routes](rest-api.md#admin-config-routes) are off by default (`404` without
> `PULSE_API_ADMIN_TOKENS_FILE`). With admin tokens, an authenticated `GET /admin/config` answers
> `200`, but the mount is read-only, so a config write that passes the request checks answers
> `503`; see [Operation](operation.md#changing-checks) to mount the directory writable.

The `compose.yaml` comment keeps its other content (directory not file and why; how to opt in to a
writable mount with `./compose:/config`; needs `PULSE_API_ADMIN_TOKENS_FILE`; directory writable by
the container user). Only "the admin routes cannot write it (they answer 503)" changes, to the same
meaning in comment form, for example: "Read-only: the API reloads checks.json when it changes;
`GET /admin/config` still works, but an admin write answers 503." The mount line
`- ./compose:/config:ro` and the commented `#   - ./compose:/config` line stay byte-identical.

### contract: own data properties

In `checkInputProblem` (`src/validate-admin.ts`):

- `type` is read with `ownValue(value, "type")`. An absent, accessor or inherited `type` counts as
  absent and selects `http` (the default), as today for an absent `type`.
- `secret` is read with `ownValue(value, "secret")` for the "only allowed on a heartbeat check"
  check. An accessor or inherited `secret` counts as absent there.
- No getter on `type` or `secret` runs inside `validateAdminCheckInput`, own or on the prototype.
- `ownValue` in `src/validate.ts` becomes a named export of that module (internal; not re-exported
  from `src/index.ts`), keeping its doc comment. The contract `AGENTS.md` rule "move a helper out
  when a second module needs it" applies; no copy of the helper in `validate-admin.ts`.
- The rest of `checkInputProblem` stays: the `typeof type === "string" && Object.hasOwn(...)` schema
  pick, the unknown-key check via `Object.keys`, `problem(schema, value, path)`, the `verdict`
  wrapper. The comment "`type` is unvalidated: `hasOwn` would coerce a non-string" stays true.
- For plain data objects every result is byte-identical to today (all existing tests in
  `test/admin.test.ts` pass unchanged).

## Performance impact

None expected. api: docs and a YAML comment only, no code; no metric of `bench/budgets.json`
(startup CPU, load CPU, idle/peak RSS, test CPU, build CPU, wall-clock startup, p95 latency,
requests per second, image size) can move; `compose.yaml` comments do not reach the image.
contract: two property reads become two `Object.getOwnPropertyDescriptor` calls per admin check
input, an admin-write-only path with no measurable cost; api does not bump its contract pin in this
feature, so no api metric moves. No A/B run needed.

## Security impact

Security impact: yes. The contract change touches a validator at a trust boundary (admin check
input, which carries the heartbeat `secret`), and the api docs describe admin route status codes.

Checklist items that apply:

- **Accessor execution** (contract): a getter on `type` or `secret`, own or inherited, must never
  run in `validateAdminCheckInput`. Tests count getter calls and assert zero; a throwing getter must
  give the same result as the property being absent, not a thrown error and not
  `check: is not a valid value`.
- **Input validation** (contract): an inherited or accessor `type: "heartbeat"` must not unlock
  `secret` or heartbeat fields on what is then an `http` check (see Counterexamples).
- **Secrets in errors** (contract): no error message quotes the value of `secret` or `type`; the
  messages stay the fixed texts listed below.
- **Auth order and status codes** (api, docs only): the text must match the real order
  (`404` feature off → `401`/`403` → `413` → `400` → `428` → `503` → `412` → `422` …,
  `docs/rest-api.md:325`). No code change.

## Rollout order

Two repositories, independent, any order, no `dependsOn`:

1. `contract`: merge the validator fix. api pins `@lorenzh/pulse-contract` by commit SHA
   (`9fe5e80…`) and keeps running the old validator until a later feature bumps the pin; the old
   validator gives the same results for parsed JSON (JSON has no accessors or prototype
   properties beyond `Object.prototype`), so api behavior is unchanged either way. No other target
   calls `validateAdminCheckInput`.
2. `api`: merge the docs and comment change. Text only; probe, status and notify are not affected.

## Counterexamples

Each must hold after the change (verified against a patched copy of `main` during planning).
`http = { id: "a", name: "A", url: "https://x", intervalMs: 1000 }`,
`hb = { id: "h", name: "H", type: "heartbeat", period: 1000, grace: 0 }`.

contract, `validateAdminCheckInput`:

| Input | Expected | Wrong implementation would |
|-------|----------|----------------------------|
| `http` plus an enumerable own accessor `type` returning `"heartbeat"` | `ok: true` (checked as `http`), getter calls `0` | run the getter and pick the heartbeat schema |
| `{ id: "h", name: "H", period: 1000, grace: 0 }` plus an enumerable own accessor `type` returning `"heartbeat"` | `{ ok: false, error: "check.period: is not allowed on this check" }`, getter calls `0` | accept it as a heartbeat check |
| `Object.assign(Object.create({ type: "heartbeat" }), { id: "h", name: "H", period: 1000, grace: 0 })` | `{ ok: false, error: "check.period: is not allowed on this check" }` | read inherited `type` and accept |
| `http` plus an enumerable own accessor `secret` returning `"x"` | `{ ok: false, error: "check.secret: is not allowed on this check" }` (from the unknown-key check), getter calls `0` | run the getter, or answer "is only allowed on a heartbeat check" |
| `http` plus a non-enumerable own accessor `secret` | `ok: true`, getter calls `0` | run the getter |
| `Object.assign(Object.create({ secret: "x" }), http)` | `ok: true` (inherited `secret` counts as absent) | answer "is only allowed on a heartbeat check" |
| `hb` plus an enumerable own accessor `secret` returning `"s"` | `ok: true`, getter calls `0` (unchanged non-goal) | run the getter |
| any of the accessor cases above with a getter that throws | the same result as listed, never a thrown error and never `check: is not a valid value` | turn the throw into `check: is not a valid value` (today's behavior) |
| `{ ...http, secret: "x" }` (data property) | `{ ok: false, error: "check.secret: is only allowed on a heartbeat check" }` (unchanged) | drop the secret check |
| `{ ...hb, secret: "" }` | `{ ok: false, error: "check.secret: must be a non-empty string" }` (unchanged) | — |
| `{ ...http, type: 5 }` and `{ ...http, type: Symbol() }` | `ok: false` with today's message from `validateCheck`, no throw | coerce the non-string type |

api docs:

| Text | Verdict |
|------|---------|
| "the admin routes answer `503`" (no limit to writes) | rejected: `GET /admin/config` answers `200` |
| "an otherwise valid write answers `503`" | rejected: an invalid body also gets `503`, before `422` |
| "a config write that passes the request checks answers `503`" | accepted |
| text that drops the `404` default | rejected: without admin tokens every admin route answers `404` |

No statistics are involved.

## Contract fields

No new names. `ownValue` already exists in `contract/src/validate.ts:64`; it only gains `export`
and stays out of `src/index.ts`. Search for a collision with an existing export:

- `grep -rn 'ownValue' .repos/contract/src` → only `src/validate.ts` (definition at line 64 and its
  uses at lines 90, 142, 156, 381).
- `grep -rn 'ownValue' .repos/config/src` → no match.

No route, key or field is added or renamed.

## Repository: contract

Files:
- `src/validate.ts` (export `ownValue`)
- `src/validate-admin.ts` (`checkInputProblem` reads `type` and `secret` through `ownValue`)
- `test/admin.test.ts` (new tests)
- `dist/` (rebuilt: at least `dist/validate.js`, `dist/validate.d.ts`, `dist/validate-admin.js`,
  whatever the build regenerates)

Behavior: as in "Required behavior → contract". Import `ownValue` beside the other names from
`./validate.ts`. Keep `isObject(value)` first so a non-object still gets `check: must be an object`.

Checks (new tests in `test/admin.test.ts`, one test per row group is fine):
- Every contract row of the Counterexamples table, with the exact `ok`/`error` values listed.
- Getters count their calls; assert the count is `0` after each call of `validateAdminCheckInput`.
- The same accessor inputs with a throwing getter give the same results (no throw, no
  `check: is not a valid value`).
- The existing tests in `test/admin.test.ts` stay unchanged and pass.

Completion evidence: `bun run check` passes (includes the `dist/` up-to-date test); the new tests
fail on current `main` (getter calls > 0, or the inherited-`secret` case answers
"is only allowed on a heartbeat check") and pass after the change. `src/index.ts` is unchanged.

## Repository: api

Files:
- `docs/install.md` (the sentence at ~line 85)
- `compose.yaml` (the comment above `- ./compose:/config:ro`, ~lines 17-22)

Behavior: as in "Required behavior → api". Text only.

Checks:
- `grep -n "admin routes.*503\|answer 503\|answer \`503\`" docs/install.md compose.yaml` shows no
  sentence that says the admin routes in general answer `503`; the new text names
  `GET /admin/config` → `200`, a config write that passes the request checks → `503`, and the
  `404` default.
- The words "otherwise valid" do not appear in either file.
- `git diff compose.yaml` touches only comment lines; `- ./compose:/config:ro` and
  `#   - ./compose:/config` are unchanged.
- Links `rest-api.md#admin-config-routes` and `operation.md#changing-checks` still resolve (the
  docs link test, if any, passes).

Completion evidence: `bun run check` passes, the Compose e2e job passes unchanged
(`scripts/compose-e2e.sh` still expects `503` for a write to the read-only mount), and the diff is
limited to the two files above.
