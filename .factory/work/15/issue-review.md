# Issue review: READMEs for every pulse repository

## Current state (checked in the clones)
- All four repos (contract, probe, api, status) already have a short README with a "Part of pulse — issues and specs live in pulse-meta" line. None says pulse is built by Paragon Factory agents. None has a consistent "what pulse is / dependencies" intro. The meta repo has no README.
- Settings actually read (`process.env` in `src/main.ts`):
  - api: `PORT` (3000), `PULSE_DB` (`./pulse.db`), `PULSE_CHECKS_FILE` (`./checks.json`)
  - probe: `PULSE_API_URL` (`http://localhost:3000`)
  - status: `PORT` (8080), `PULSE_API_URL` (`http://localhost:3000`), `POLL_MS` (5000)
  - contract: none (types only, no runtime code)
- api routes (`api/src/server.ts`): `POST /results`, `GET /checks`, `GET /checks/:id/results?limit=N`, `GET /incidents?status=open|resolved`. Other methods on known paths give 405, unknown paths 404; the api README does not mention 405 or 413 (body over 1,000,000 bytes).
- Dependencies: api, probe and status depend on contract (Git dependency pinned to a commit). Runtime coupling: probe -> api (GET /checks, POST /results); status -> api (proxies `/api/*`). contract depends on nothing.
- `api/checks.example.json` exists (one check, `http://localhost:9000/`, 1000 ms interval).
- Existing README defects to fix: probe README repeats its first sentence and has no install step (`npm ci`) or a test command beside run; status README has no dependency statement and no test step wording beyond `npm run check`; api README says "SQLite" accurately but does not list its dependency on contract in prose; contract README has no "what pulse is" lines.

## Open points (none block the spec)
1. **"Install, test and run" for contract.** It is a library: install and test apply, run does not. Assumption: README says so and shows `npm ci`, `npm run check`, and the settings section states "none".
2. **Factory statement wording.** Not specified. Assumption: one identical sentence in every README, e.g. "pulse is built by Paragon Factory agents from the issues in lorenzh/pulse-meta." Link to the meta repo.
3. **Meta repo link targets.** The issue asks for links to the repositories. Assumption: `https://github.com/lorenzh/pulse-<name>` (taken from `.factory/config.yaml`).
4. **Local run in the meta README must really work.** Constraints to document, all verified from code:
   - Node >= 24 (`engines`), `npm ci` in each of api, probe, status (contract is fetched as a Git dependency, so network/git access to GitHub is needed).
   - Start order: api first (loads and upserts checks at startup; fails if the checks file is invalid). The probe retries `GET /checks` until the api answers, so order is not strict, but api first is simplest. Status polls the api and shows an error banner until it is up.
   - The probe takes its checks from the api, not from a file. The checks file is read only by the api (`PULSE_CHECKS_FILE`, default `./checks.json` relative to the api working directory).
   - The example check targets `http://localhost:9000/`. To see it `up`, something must listen on 9000. To keep the meta README self-contained, assumption: use a one-liner that exists on a bare Node 24 (a `node -e` http server, or `npx`-free equivalent) and verify it by running. A down check also shows on the status page, so the acceptance check works either way; the README should say which state to expect.
   - All three services run in separate terminals; ports 3000 (api), 8080 (status). Open `http://localhost:8080`.
   - `node:sqlite` prints an experimental warning (already in the api README); mention it is harmless.
   - The check appears on the status page after the api starts (state `unknown` until the first result, then up/down within about one interval).
5. **Example checks file in meta.** The issue wants an example checks file in the meta README. Assumption: inline it in the README as a JSON block (identical to `api/checks.example.json`, optionally with a second check), not as a new file, because only README files may change.
6. **Feature flow description.** Derive from `.factory/config.yaml` and the `.github/workflows`: issue in pulse-meta -> `spec` workflow (issue-review, plan, plan-review) in the meta repo, producing a spec PR; merging it approves the spec -> fan-out creates issues/branches per target repo with `build` workflow (implement, review) -> one PR per repository whose body says `Closes lorenzh/pulse-meta#<id>` -> merge workflow resolves base conflicts. The plan state must read the workflows and the prompts to describe this accurately (the order contract first, then probe/api/status, was the convention in issue #1; check `.factory/work/1/plan.md`). Do not describe labels or commands that the workflow files do not contain.
7. **api README accuracy.** The statement "timeoutMs defaults to 5000 in the probe" is true for probe code (verify in `probe/src/check.ts`). Plan should check each existing claim (state rules, limit cap, status codes) against `service.ts`/`state.ts`, not trust the current README.
8. **Four repos need pull requests, one per repo.** Each repo's change is README-only, so `npm run check` is unaffected. contract's `dist/` freshness test must not be touched.
9. **"Every setting named in a README exists in the code."** Includes `limit`, `status` query parameters and check fields; plan should verify them. Also settings named in the meta README (it should only reference the settings above).
10. **License/maintenance sections** are not requested; leave out.

## Assumptions to carry into the spec
All assumptions above. No contradiction found. No person's input is needed.

## Derived acceptance check
1. Each of the five READMEs (meta, contract, probe, api, status) states in a few lines: pulse is an uptime monitor with a status page; this repository's part; the pulse repositories it depends on; and that pulse is built by Paragon Factory agents from the issues in pulse-meta.
2. api, probe, status: README has install (`npm ci`), test (`npm run check`) and run (`npm start`) commands, and a settings table that matches exactly the `process.env` reads above, with the same defaults. contract documents install and test, and "no settings".
3. The api README lists all four routes with methods, parameters and status codes, matching `api/src/server.ts`.
4. The meta README has: product overview, a table of the five repos with roles and links, the local run steps with an example checks file, and the issue-to-PR flow.
5. Manual proof: on a clean machine with Node 24, following only the meta README, start api, probe and status, open `http://localhost:8080` and see the example check listed (with state `up` if the target on port 9000 is running, `down` otherwise).
6. `git diff --stat` in every repo shows only `README.md` files; no code, config or lockfile changes. Grep of each README for env-variable-like names finds none that are absent from the code.
