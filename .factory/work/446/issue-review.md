# Issue review: #446 Small review leftovers (P3), round 6

Two small, independent fixes: one docs fix in `api` and one validator fix in `contract`. The
issue comments have no decisions from earlier runs; only the Factory claim comment is there.

## Current state (checked on `main` of each clone)

### meta: already done, no target
- `README.md:71` already says: admin routes off by default (`404`), an authenticated
  `GET /admin/config` answers `200`, and "a write that passes the request checks answers `503`
  while the directory is mounted read-only". The single-file mount limit sentence is gone
  (commit `80e0248 Drop the single-file mount limit after the Compose directory mount`).
- `grep` over the meta Markdown files (outside `.repos/` and `.factory/work/`) finds no other
  "admin routes answer 503" or single-file mount wording.
- So the meta part of the issue ("done in the meta follow-up PR for #431") needs no work. The
  plan should not add a `meta` entry to `targets.json`.

### api
- `docs/install.md:85`: "The mount is read-only, so the [admin routes](rest-api.md#admin-config-routes)
  answer `503`". That is wrong for reads.
- `compose.yaml:17-22` (comment above `./compose:/config:ro`): "the admin routes cannot write it
  (they answer 503)". This is mostly right ("cannot write"), but it reads as if every admin
  route answers 503.
- Actual behavior (`src/admin-routes.ts`, `write`): the order is auth (`401`/`403`), body read
  (`413`, `400` bad JSON), `400` id mismatch, `428` missing `If-Match`, **then**
  `writer.assertWritable()` → `503`, and only after that `editOf`/`writer.apply` (`412`
  revision, `422` invalid body or file, `409`, `404`). `docs/rest-api.md:325` documents the same
  order. `GET /admin/config` does not write and answers `200` on a read-only mount.
- Admin routes are off by default (`404`, `PULSE_API_ADMIN_TOKENS_FILE` unset), also on the
  read-only mount.
- The manual-incidents write routes use the same admin tokens but write the database, not the
  checks file, so the read-only mount does not make them answer `503`.
- `docs/operation.md:126` (changing checks) is already right and is the link target. It says a
  read-only mount "answers `503`" for a write.
- `scripts/compose-e2e.sh:643` checks that a write to the read-only mount answers `503`; no docs
  test (`src/docs-claims.test.ts`) quotes the wording to be changed.

### contract
- `src/validate-admin.ts`, `checkInputProblem`: `value.type` (plain property access) and
  `Reflect.get(value, "secret")` both run a getter and read inherited values. Since round 5
  (#442, `verdict`) a throwing getter can no longer make the validator throw; it only turns into
  `check: is not a valid value`.
- The other validators read own data properties through `ownValue` in `src/validate.ts:64`
  (a getter never runs, an accessor or an inherited name counts as absent; used for example by
  `validateCheck` at `src/validate.ts:381`). `ownValue` is module-private today.
- `dist/` is committed and a test fails when it is out of date (contract `AGENTS.md`).
- `api` pins `@lorenzh/pulse-contract` by commit (`9fe5e80…`). The contract fix does not need a
  bump in `api`; the two children have no `dependsOn` between them.

## Open points for the spec (none blocks)

1. **Exact 503 wording in api.** The issue says "only otherwise valid writes answer 503". That
   is not exact: the `503` comes before the body validation (`422`) and the revision check
   (`412`), so a write with an invalid body also gets `503` on a read-only mount. The spec should
   use the README wording: an authenticated write that passes the request checks (size, JSON,
   id, `If-Match`) answers `503`, and an authenticated `GET /admin/config` answers `200`. Also
   say that without admin tokens every admin route answers `404`. Do not say "otherwise valid".
2. **Which routes.** Name the config write routes (checks, components, maintenance; link to
   `rest-api.md#admin-config-routes`) rather than "admin routes" in general, because the
   manual-incidents writes do not touch the checks file.
3. **Compose comment.** Change it to the same meaning in a short comment form: reads work, writes
   answer `503`. Keep the rest of the comment (directory not file, how to opt in to a writable
   mount, needs `PULSE_API_ADMIN_TOKENS_FILE`, directory writable by the container user) and keep
   the `./compose:/config:ro` mount line unchanged.
4. **contract helper.** Either export `ownValue` from `src/validate.ts` (internal module, not
   from `src/index.ts`) or use `Object.getOwnPropertyDescriptor` in place. The plan picks one;
   no public API change either way.
5. **contract semantics after the change** (should be stated in the spec and covered by tests):
   - `type` as an accessor or inherited counts as absent → treated as `http` (default), and the
     getter does not run.
   - `secret` as an accessor or inherited counts as absent for the "only allowed on a heartbeat
     check" check; the getter does not run. An enumerable own accessor `secret` on a non-heartbeat
     check is still rejected by the unknown-key check (`check.secret: is not allowed on this
     check`), because `Object.keys` lists it. On a heartbeat check, `problem()` already treats an
     accessor `secret` as absent (optional field), so the input is accepted; this matches how the
     other validators treat accessors and is not changed here.
   - All current outputs for plain data objects stay byte-identical (the existing tests in
     `test/admin.test.ts` keep passing).

## Assumptions

- No meta change is in scope; the spec PR itself is the only meta change.
- Targets: `api` (docs and the Compose comment only, no code) and `contract` (validator, tests,
  rebuilt `dist/`). No `dependsOn`.
- No wire version change in contract (no schema or wire change). No contract bump in api.
- Behavior of `api` stays the same; only the text changes. `docs/operation.md:126` and
  `docs/rest-api.md` stay as they are unless the plan finds them wrong.

## Derived acceptance check

- api: `docs/install.md` and the comment in `compose.yaml` no longer say the admin routes answer
  `503` on the read-only mount. They say that an authenticated `GET /admin/config` answers `200`
  and that a config write that passes the request checks answers `503`. `./compose:/config:ro`
  is unchanged and the api checks and Compose e2e pass.
- contract: in `validateAdminCheckInput`, a getter on `type` or on `secret` (own or on the
  prototype) never runs. A test with getters that count their calls (or throw) shows zero calls,
  the input is checked as if the property were absent, the existing admin tests pass unchanged,
  and `dist/` is up to date.
