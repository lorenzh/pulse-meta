# Issue review #530: pulse CLI day-2 commands

## Disposition

Ready for `plan`, with deploy as the only implementation target. No owner question
blocks specification. The choices below need explicit decisions in the plan; they
are not reasons to hold this issue. Extend the CLI from #529, without rebuilding
its wizard, project guards, binary distribution or Compose setups. No `pulse
backup` command is requested.

## Evidence and dependency status

- Read meta `AGENTS.md`, `README.md`, `docs/approved-packages.md`, the issue-review
  prompt and the prior #529 issue-review artifact. `.factory/.gitignore` ignores
  runs, not work artifacts.
- Read [#530 and its comments](https://github.com/lorenzh/pulse-meta/issues/530).
  Its only comment is this run's Factory claim, with no earlier decisions.
  The native blocked-by relation names #529, which is closed. Read #529 and its
  comments: its deploy child #622 completed. The prerequisite CLI is in the clone.
- Read [#460](https://github.com/lorenzh/pulse-meta/issues/460) and its comments.
  Decision 6 requires database tokens with overlapping rotation. The
  [2 November clarification, section 3](https://github.com/lorenzh/pulse-meta/issues/460#issuecomment-6589563362)
  fixes the overlap at **10 minutes**, using `previousValidUntil`.
- Inspected deploy clone `e754d468a2c445e76d5017692096428bff179f28`: its
  `AGENTS.md`, CLI parser/entry point, token generation, installation writer,
  renderers, Docker/project guards, lifecycle/readiness helpers, CLI docs and
  stack test; common pins, demo Compose, secrets initialization, image bump
  script, package scripts and release workflow.
- Inspected api clone `3b29fa0ce29890248ade4294a55812cc77ed951c`: token routes
  and store, configuration/import and operation docs, REST token contract,
  migrations and backup implementation. Also inspected probe startup settings,
  console settings/token reads/database migrations and config's reusable image
  release workflow. These clones are read-only.
- This is a source and requirements review. No containers or product tests were
  run. Registry availability and the contents of published releases have not
  been verified; a source feature on `main` is not proof it is in a released image.

## Current behavior and gaps to settle in the plan

### 1. Command scope and existing installations

The parser currently accepts only `init`, `up`, `down` and `status`. The lifecycle
commands resolve `pulse.json` format 1 and `compose.yaml`, include a local
`compose.override.yaml`, strip inherited `COMPOSE_*` selection variables and guard
the project directory and volume ownership. The generated manifest has service
names and readiness ports, but no image version map, probe token IDs or saved
wizard answers. Images are embedded from `common/services.yaml` at binary build
time and copied into each generated installation.

Assume the commands operate on #529-generated installations, with the same
default directory and `--dir` convention and the existing exit-code conventions.
Supporting arbitrary standalone Compose directories without `pulse.json` is not
implied. Preserve format-1 installations; any new metadata needs a compatible
initialization path. Token rotation and logs can work on dev installations when
the required API capability exists. Image upgrade should explicitly refuse dev
source builds rather than replace them with registry images.

### 2. Rotation requires an API capability absent from the documented baseline

`common/services.yaml` still pins all five pulse services to `0.1.0`. Deploy's CLI
docs distinguish that file-based API from the database token store on newer API
builds. API main imports token files once and thereafter ignores edits to them.
Replacing a host token and restarting the stack is therefore not rotation on
that API, and restarting the API is unnecessary.

The plan must name capability detection, a clear refusal on legacy APIs before
changing any token, and a supported API image/test fixture containing the store.
Do not assume the existing pins already satisfy rotation. A necessary deploy pin
bump must use `scripts/bump-images.sh` and verified published releases; keep pins
only in `common/services.yaml`. No new api/probe/console feature is authorized by
this deploy-only request.

### 3. Which token and which probe locations

The API rotates a **token ID**, not a role or a file. `GET /admin/tokens/self`
identifies the caller's admin token; the probe token cannot call that route.
`GET /admin/tokens` includes metadata, including location, scopes and source,
but no secret digest for matching a local file. Several active tokens can belong
to one location. Bootstrap probe names include the location and import position.

Assume `admin` means the installation's `secrets/admin-token`, also consumed by
its console when present. Assume bare `probe` means all locally managed probe
locations: the demo has `probe-eu` and `probe-us`, each with its own secret;
minimal/full normally have one `probe`. It does not mean every remote token in
the API. Determine locations from the actual installation configuration, not
just service-name guesses.

The plan must specify reliable ID discovery for existing installations. A unique
matching managed token may be sufficient for the bootstrap layout; ambiguous,
missing, expired or revoked candidates must fail before rotation rather than
guess. Decide whether an optional location/ID selector is needed, without
requiring one for the issue's demo command. Preserve scopes, location, expiry
and identity by using rotation, not revoke-and-create.

### 4. Secret delivery, overlap and restart order

`POST /admin/tokens/:id/rotate` returns `{token, secret, previousValidUntil}`;
the server generates a `pulse_` secret and will not disclose it again. The old
secret works for 10 minutes, bounded by token expiry. A second rotation during
an overlap returns 409. Do not reuse the init generator's hex-only expectation
to validate the returned secret or add a second overlap timer to the API.

CLI-generated installations bind the host `secrets/` directory into the one-shot
`secrets-init`. It copies host tokens into per-service volumes with ownership
1000:1000 and mode 0400; host secrets are 0600 under a 0700 directory. Probe and
console settings read their tokens at startup. Generated demo installs use these
host files too; the repository's standalone demo instead generates tokens in
volumes. State that distinction in the supported-installation docs.

The sequence must be: preflight the whole operation; request and durably save
the new secret; refresh the required runtime secret volume(s); restart/recreate
only consumers that need the new credential; verify authentication and readiness.
API, status and notify do not need restarting for these rotations. Admin rotation
updates the CLI's file and the console, when present; probe rotation updates each
managed probe. Define how the one-shot copier runs again without Compose starting
or recreating unrelated dependencies. Preserve the console encryption key.

Full/demo do not publish the API. Use the existing internal Compose access pattern
or another private transport; do not publish an admin port to implement rotation.
The current spawn seam ignores stdin, so secret-safe transport may need extending:
never put the bearer or returned secret into process arguments, emitted scripts,
Compose config, diagnostics or ordinary command output.

### 5. Partial rotation and command interruption

API mutation, host-file replacement and volume refresh are not one transaction.
Choose an installation mutation lock that also accounts for concurrent init,
upgrade and rotation; the existing lock covers only init. Preflight file modes,
symlinks, writability, token selection and required services before the API call.
Use atomic secret writes. Specify recovery for an HTTP response lost after the
server rotated, a failed write/copy/restart, Ctrl-C and a partial multi-location
rotation. Do not blindly retry the rotate POST, discard an already received new
secret, or restore the old file and claim success: that secret will expire.

Assume success means consumers have switched and are working; the CLI can report
the overlap deadline and return without waiting ten minutes. Expiration is the
API's job. A rerun within an overlap must explain the 409 or resume saved progress,
not rotate again. Keep any recovery material private and identify a recovery path
without printing a secret. Document that separately managed consumers of a shared
admin token also need updating during the overlap.

### 6. What an upgrade selects and edits

There is no inspected stack-wide release manifest. The existing bump script
handles independently versioned pulse images, obtains anonymous GHCR pull tokens,
resolves multi-arch index digests and compares stable numeric versions. It changes
the repository's common pins, not an installed Compose file, and does not verify
attestations. It is useful precedent, not an upgrade implementation.

Recommended interpretation: omitted `--to` selects the newest stable full SemVer
for each installed pulse image; `--to X.Y.Z` requests that exact version for each
installed pulse image, failing the entire preview if any required image is absent.
Choose and document whether to accept a leading `v`. Do not downgrade or select
prereleases implicitly. Repeated probe services share one probe image resolution.
Third-party helpers are not pulse releases and remain outside this command.

Assume `pulse upgrade` displays current/proposed versions and digests and performs
no installation writes or container changes without `--yes`. No CLI binary
self-update is requested. Decide how to handle an already-current version and
how a later apply resolves/checks a previously displayed candidate.

Update only supported installed image references. Preserve checks, secrets, ports,
URLs, project/install identity, helper scripts, volumes and user edits. Do not
rerun init or regenerate the complete Compose model. An override can mask a base
image edit; check the effective Compose model and refuse unsupported overridden,
custom or ambiguous image declarations before mutation. Do not silently report
an upgrade that Compose will ignore. Retain repository pin rules for build assets
and use fixture image references, not duplicated production pins, in tests.

### 7. Provenance is an apply precondition

The config release workflow publishes multi-arch GHCR indexes and an attestation
whose subject is the index digest. The issue permits `gh attestation verify` or
an equivalent; no new verifier library is approved. Prefer the existing verifier
unless the plan justifies another approved mechanism. Document its installation,
version/authentication requirements and behavior when unavailable.

Verify the exact immutable digest that will be applied, with the expected source
repository and trusted release workflow identity. A version tag, image label or
matching digest alone is not provenance. Do not accept an attestation for another
digest/repository or verify a mutable tag and later apply a separately resolved
digest. Missing/invalid provenance, registry errors and absent platform support
must fail before changing installed pins or stopping containers. Resolve and
verify every candidate, then pull by digest before the running stack is changed.

### 8. Rollback is more than restoring a text file

Record original pin-bearing files before mutation. On apply/start/readiness
failure restore the pins **and reapply the old images**, then wait for the old
stack's readiness. Restoring the YAML alone leaves failed new containers running.
Use bounded forward and rollback waits and report both outcomes; a failed upgrade
still exits nonzero when rollback succeeds. Keep recovery information when
rollback fails. Never delete data volumes as part of recovery.

There is a real persistence boundary: API main has numbered database migrations
and refuses a database newer than it supports; its docs explicitly require a
backup restore to downgrade across schema versions. Console also has migrations.
Thus restoring pins cannot universally make old images ready after a new service
has migrated its data and then another service fails.

The plan must define the supported rollback boundary before promising automatic
recovery: establish compatibility before apply, or provide a concrete internal
snapshot/restore procedure, using existing tools where possible. Unknown or
unsafe transitions must be refused before mutation. A safety snapshot used by
upgrade is distinct from the excluded public backup wrapper, but its consistency,
affected stores and possible loss of post-snapshot writes must be specified if
chosen. Do not silently weaken acceptance to "the pins were restored" or claim
that two same-schema fixtures prove arbitrary migration rollback.

### 9. Logs and the continuity measurement

`logs` should reuse guarded project resolution, pass an optional validated
service name and `--follow` as separate Compose arguments, stream stdout/stderr
without buffering the whole log, propagate failure and handle interruption/child
cleanup. Do not impose an operation timeout on a requested follow stream. Docs
should explain the selected install, service names and Ctrl-C behavior. This
command intentionally displays service logs, including the console's setup-code
message; command code must not add credentials to those logs.

The existing `e2e/outage-history.sh` permits gaps up to **1.5 intervals**. That
does not meet this issue's stated **one interval** limit. Readiness alone also
does not prove results are flowing. Define the monitored check, its fixed interval,
time window and per-location result measurement. Inspect the interval across the
handoff, including the last result before and first result after it. Another demo
location must not hide a stalled rotated location. Prefer a deterministic local
target and explicit scheduling/measurement control; do not increase the interval
or weaken the threshold after observing a failure. A simple stop-then-start probe
may need a different handoff to satisfy this bound. No jitter allowance beyond
the request is assumed; if one is necessary it needs an explicit decision.

## Derived acceptance check

The plan should turn the following into deploy tests and CI gates. It must name
the source of compatible API images and two test releases; do not invent public
tags or depend on an unmerged service change. Isolated test registries/verifier
seams can cover failures, but cannot replace the live demo acceptance or silently
disable provenance in the production command.

1. **Existing CLI and selection:** build the standalone binary, extend help/docs
   and parser tests, retain init/up/down/status behavior. Exercise an existing
   format-1 install and `--dir`. Wrong-project guards and missing Docker/Compose
   fail before mutation, with documented exit codes. Reject overlapping mutations.
2. **Probe rotation in a live demo:** initialize an isolated demo installation,
   run a token-store-capable API, reach ready and capture baseline results and old
   secrets privately. Run exactly `pulse token rotate probe`. Every managed probe
   adopts a different valid secret; results for each monitored location continue
   across the rotation with no gap greater than its configured interval. API,
   status, notify and console containers do not restart for probe rotation.
3. **Overlap and persistence:** both secrets authenticate during the real overlap;
   after the returned deadline the old secret gets 401 on a protected probe route
   and the new one still succeeds. Readiness and new results continue. Retained
   files have the required modes and a subsequent normal up uses the new secrets.
   A clock-controlled unit test covers expiry boundaries, but the live acceptance
   also observes actual expiry without modifying the production overlap.
4. **Admin rotation:** identify and rotate the local admin token; new credentials
   can call an admin route, the console's authenticated API access works after its
   targeted restart, and old credentials get 401 after overlap. Probes/API and
   unrelated services keep running. Cover no-console installations too.
5. **Rotation failures:** test ambiguous/missing tokens, legacy API, 401/403/409,
   bounded network failures, unsafe files, failed secret persistence/refresh,
   consumer startup failure and interruption. Verify no unintended token is
   rotated and that partial mutations have the specified recovery behavior.
   Capture output and inspect argv/config to assert no secret disclosure.
6. **Upgrade preview and successful apply:** start test release A; preview B and
   assert no installed file or running container changed. Apply B with `--yes`;
   assert expected immutable images actually run and every selected pulse service
   answers `/readyz`, with helpers/one-shots checked appropriately. Verify retained
   monitoring history, installation identity, configuration, secrets and volumes.
7. **Upgrade failures and recovery:** test missing/untrusted/mismatched provenance,
   missing images and registry/pull errors as pre-apply refusals with no stack
   mutation. Separately exercise an image that passes the resolution/provenance
   path but fails to start or become ready: restore A's exact pins, run A again,
   wait until ready and confirm monitoring resumes. Test a partial multi-service
   failure, interruption and rollback failure. Include a migration incompatibility
   case proving the chosen preflight refusal or actual data recovery procedure.
8. **Logs:** cover all services, one service, follow streaming, unknown service,
   Docker failure and Ctrl-C without a leftover child. Verify the same guarded
   project is selected and ordinary non-follow output matches Compose logs.
9. **Docs and checks:** document prerequisites, version selection, preview/apply,
   token selection and ten-minute overlap, safe recovery and unsupported upgrades,
   logs and manual Compose equivalents. Run deploy's relevant Bun checks, binary
   smoke checks and affected shell/static/CI checks. Every new command has tests;
   live assertions test behavior, not only expected subprocess arguments.
