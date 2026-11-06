# Issue review: #772

## Result

Ready for `plan`. No question requires a `needs-input` hold. This is a documentation correction in `contract`, limited to `docs/index.md`.

## Evidence and prior decisions

- Read meta `AGENTS.md`, `README.md` and the issue-review prompt, plus contract `AGENTS.md`, package scripts, the relevant documentation and maintenance schemas/exports.
- Read [#772](https://github.com/lorenzh/pulse-meta/issues/772) and all issue comments through the connected GitHub tools. The only comment is the current Factory claim; there are no earlier decisions to reconcile.
- Inspected the read-only contract clone directly at `c4a2eb5214d48d40d0c1afbae5e3e49463185e15`. Its latest commit merges contract PR #50, so the prerequisite from #765 is already present. Do not reimplement that feature or add consumer work.
- `docs/index.md:65` groups `AdminMaintenanceInput` and `AdminMaintenanceView` and incorrectly calls the former a request shape. Lines 330–331 still advertise `PUT|DELETE /admin/maintenance/{index}`.
- The existing “Database maintenance windows” section (lines 390–413) already identifies `AdminMaintenanceWindowInput` as the strict `{ id, checkIds, start, end, note }` body for POST and ID-based PUT, and explicitly says the API no longer accepts `AdminMaintenanceInput` as a body.
- `src/admin.ts:191` onward confirms that `AdminMaintenanceInput` is the retained file-window shape. `adminMaintenanceWindowInputSchema` defines the new body; `adminMaintenanceWindowSchema` retains a file-window index as response metadata. `adminConfigResponseSchema` still uses `AdminMaintenanceView[]` for `maintenance`.
- `src/index.ts` still exports both old and new shapes/validators. `AdminWriteResponse` in `src/admin.ts` still includes both view types. The request expressly forbids changing those exports or schemas.

## Open points and assumptions for the spec

1. **Meaning of “no sentence describes the old request shape.”** Interpret this as no text presenting the old file-window shape as an accepted HTTP write body. It does not require deleting valid descriptions of exported file types, public `MaintenanceWindow`, or file-window indices. Retain the explicit retirement note and accurate file/config response descriptions. A suitable correction for the type table is to describe `AdminMaintenanceInput` as a file-window shape, `AdminMaintenanceView` as that shape with its file index in `GET /admin/config`, and point current write callers to `AdminMaintenanceWindowInput`.
2. **Correct or remove the duplicate route entry.** Both satisfy the issue. Prefer updating the existing route list to `PUT|DELETE /admin/maintenance/{id}` and removing the explanation that an index addresses a write. The existing database section remains the detailed reference; avoid creating a second, divergent body description.
3. **Nearby status wording.** The same document says “Unknown id or index” in its admin status table (line 380). Remove or clarify the index wording so it cannot imply an index-addressed window write. This is within the requested document-wide consistency check. Legitimate references to indices as file/response metadata remain.
4. **Retained legacy exports are not a new write promise.** Preserve accurate documentation of `AdminConfigResponse`, the validator names and the declared `AdminWriteResponse` union. Where necessary, distinguish a retained exported type from the body returned by a current maintenance write (`AdminMaintenanceWindow`). Do not narrow a union or remove a validator to make the prose easier to edit.
5. **Scope boundary.** Only `contract` needs an implementation child, with no unfinished target dependency. Correct related prose in `docs/index.md` only; no README, source, tests, dependencies, generated files, package version or wire-version changes are needed. A stale index-address comment also exists beside `adminMaintenanceViewSchema` in `src/admin.ts`; it is outside this docs-only request and must not expand this change into source cleanup.
6. **Verification stage.** `bun run check` includes lint, build, typecheck and tests. Run it in the writable contract implementation checkout, using the repository's pinned toolchain and lockfile. Do not run it against this read-only context clone: the build writes `dist/`. A prose correction needs a document review, not a new test that merely matches wording.

## Derived acceptance check

1. Review every maintenance-related occurrence in `contract/docs/index.md`, using a search such as `rg -n 'maintenance|AdminMaintenance|index' docs/index.md` and reading each match in context. No passage presents `AdminMaintenanceInput`/the single-check file shape as a current POST or PUT body, and no passage advertises index-based PUT or DELETE window writes. The table and route overview agree with the database section.
2. The document identifies `AdminMaintenanceWindowInput` and `{ id, checkIds, start, end, note }` as the current POST/PUT body, with `PUT|DELETE /admin/maintenance/{id}` for existing database windows. It continues to explain that the old input is a file shape no longer accepted as a write body. Valid file-window indices and unchanged config/public response documentation remain accurate.
3. In the contract implementation checkout, `bun run check` exits successfully. Review the final diff after the build: only `docs/index.md` changes. Schemas, validators, exports, tests, `dist/`, package metadata, dependency pins, lockfile and wire version remain unchanged.

## Review limits and tool handling

This issue-review state did not edit any target clone or run product checks. It created this artifact for later states; the work directory must remain tracked. Initial reads of the not-yet-created artifact directory and a guessed `admin-schema.ts` path were corrected by listing the clone and reading the actual `src/admin.ts`; no required repository read remains blocked. The cloud environment status tool and `/etc/codex/network-policy.json` are unavailable in this runner. Required GitHub reads succeeded through connected tools; no credentials were inspected or printed, and no provider label or comment was changed.
