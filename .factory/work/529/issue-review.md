# Issue review #529: pulse CLI setup wizard

## Disposition

Ready for `plan`. The remaining choices are specification decisions with reasonable defaults;
none requires an owner decision before writing the spec. Implementation belongs to **deploy only**.
Build on #528 rather than rebuilding its setups, image release machinery or end-to-end suite.
Do not implement the day-2 commands of #530 or depend on other features still in flight.

## Evidence inspected

- Read meta `AGENTS.md`, `README.md`, `docs/approved-packages.md`, the issue-review prompt,
  and `.factory/work/528/{issue-review,plan}.md`.
- Read [#529 and its comments](https://github.com/lorenzh/pulse-meta/issues/529) and
  [#460 and its comments](https://github.com/lorenzh/pulse-meta/issues/460) using `gh issue view`.
  The only substantive #529 comment says #528 is closed. There is no earlier owner choice
  about flags, overwrite semantics or CLI defaults. #460 decision 3 concerns probe header
  references and host binding; decision 7 separately requires env references for channel secrets.
- Inspected deploy main `f9d9eb39ac8d859b545153d5d33bc7589ee14d1c`: `AGENTS.md`, README,
  all four Compose files, common services, demo scripts/config/docs, full config/docs,
  secret initialization, readiness, static checks, e2e overlay and CI.
- Inspected api main `9307271` configuration docs, notify main `793d65d` channel schemas,
  configuration parser and email/webhook docs, console settings/docs, status settings,
  kit ops server, contract main `41dfbc8` check schemas, and config main `04108fa`
  tooling, strict tsconfig and workflow policy. These are read-only clones.
- `gh release list --repo lorenzh/pulse-deploy --limit 5` returned no releases at review time.
  This is not a missing prerequisite: the #528 source is merged and can be embedded in the
  CLI; #529 creates the binary release path. Docker Compose v2.38.2 is installed locally.
  No containers were started and no implementation tests were run for this review.

## Current behavior and integration gaps

1. **No CLI toolchain yet.** deploy contains Compose, shell, JSON and `.mjs` helpers, with no
   `package.json`, Bun lockfile, TypeScript config or binary release workflow. Its instructions
   explicitly describe that state. This feature authorizes adding the Bun/strict TypeScript
   toolchain and updating those instructions. Retain the existing shell/setup CI checks.
   No prompt library is approved in meta. Use Bun/Node built-ins for flags and prompts unless
   a separate package approval is obtained; do not silently introduce a YAML or prompt dependency.

2. **Templates need to become portable outputs.** Every setup extends `../common/services.yaml`
   and mounts scripts/config outside its directory. Copying just `compose.yaml` will fail in an
   empty directory. Images are version-and-digest pinned only in `common/services.yaml`;
   dev overrides them with local builds from sibling source checkouts. Binary generation must
   embed the required assets and produce a complete output tree without requiring a deploy
   checkout, Bun installation or download of mutable `main` templates at runtime. Keep that
   common file as the repository's sole source of image pins; generated installations are copies.

3. **Optional services are new.** minimal is api/probe; full and dev add status, notify and
   console. Demo adds two probe locations, seeded checks, targets, TLS and mailpit. Full/dev
   probes currently depend on status being healthy, and the full sample checks target status.
   Removing status must also repair dependencies and default checks. Disabling notify should
   remove its now-unused mail catcher where appropriate. `scripts/check-setup.sh` guards fixed
   service/port layouts, root Compose files and one pin source; generated fixture coverage must
   account for those rules without weakening checks of the existing setups.

4. **Tokens need real wiring.** The current host secret is only `secrets/probe-token` (32 random
   bytes encoded as 64 hex characters). `secrets-init.mjs` copies it into API/probe-specific
   volumes owned by uid 1000, mode `0400`; host files stay `0600` in a `0700` directory.
   API expects probe `tokens.json` with location/token entries and admin `admin-tokens.json`
   with name/token entries. Admin and probe tokens must differ. Console accepts
   `PULSE_CONSOLE_ADMIN_TOKEN_FILE`. Full does not enable admin tokens automatically, and
   its default checks mount is read-only. The e2e overlay's inline admin token is test-only
   and must never become the wizard template. Extend the secret-copy mechanism so generated
   admin and probe tokens are consumed by the intended services, readable by `bun`, and
   isolated from unrelated containers. Generating an unused admin file is insufficient.
   Do not implement the future hashed/scoped token store or Console management in this issue;
   generated files must work with the selected pinned images, not only current source main.

5. **Demo differs from ordinary initialization.** Existing demo generates two probe tokens
   inside volumes, has no host `secrets/`, and writes checks into a named volume at startup
   with maintenance windows relative to that startup. The new requirement asks init to write
   host tokens and `checks.json` for every setup. The plan must reconcile those paths and
   ensure the generated checks file is actually consumed. Do not leave a decorative host file
   while `demo-init` silently replaces its contents elsewhere. Keep standalone demo behavior
   and its existing CI assertion of no host secrets working; wizard outputs may use host secrets.

6. **Notification support already exists, with limits.** Email uses `smtp.passwordEnv`;
   generic webhooks use a non-secret inline `url` plus optional `secretEnv` for signing.
   Generic webhooks do not accept `urlEnv`; Slack/Teams do, but are separate channel types.
   Channel parsers reject unknown keys. The wizard needs a generated notify configuration
   in addition to the four named output paths. Pass referenced env names into the notify
   container; Compose's project `.env` alone does not do that. Do not invent service settings.

7. **Readiness cannot be copied unchanged.** `wait-ready.sh` selects a fixed service list from
   the parent directory name (`minimal/full/demo/dev`) and calls `/readyz` inside the containers.
   It cannot handle an arbitrary generated directory or a disabled service. Ops endpoints
   return status/text, not a version object. Most pulse ops ports are not published, and a
   healthy Docker liveness check does not prove readiness. Demo also has one-shot jobs and
   helpers without pulse `/readyz`; not every container can answer that endpoint.

## Open points for the plan and proposed assumptions

1. **Presets and overrides.** Treat setups as defaults: api/probe are mandatory, while console,
   status and notify can each be enabled/disabled, including additions to minimal. Demo defaults
   to all its existing services and checks. Dev retains local builds as the explicit exception
   to pinned service images and needs a source-directory question/flag, resolved relative to
   the generated installation. Validate required source directories before attempting a build.
   Define combinations of demo checks and non-demo presets: either include their supporting
   demo services or reject the combination clearly before writing files.

2. **Flags, defaults and CI.** Define one documented flag per answer, including repeated checks,
   all type-specific fields, optional-service booleans, notification details, env reference names,
   source path and start choice. Specify flag/prompt precedence, units, validation, help and
   exit codes. Proposed default: `--yes` supplies documented defaults and never prompts;
   `pulse init --setup demo --yes` writes files without starting Docker, matching the explicit
   init/up acceptance sequence. An explicit start flag answers “Start now?” affirmatively.
   Non-TTY input without sufficient answers/default authorization fails promptly, never hangs.
   Init without starting should work without Docker; Docker/daemon/Compose checks belong to
   commands that actually need them. Bad flags or invalid answers must not leave partial output.

3. **Ports and public URLs.** “For each chosen service” cannot mean publishing notify: it is
   a worker with an internal ops listener, not a public web application. Proposed interpretation:
   ask host port/public URL for the selected web UIs, plus the API port in minimal/dev and the
   mailpit port in demo; keep notify ops internal. Only status currently has a public-URL service
   setting; an email channel can use `statusUrl`, but generic webhooks cannot. Console public URL
   can be installation metadata/documentation, not an invented runtime variable. The plan must
   explain each answer's effect, validate URLs/ports and reject duplicate published bindings.
   Preserve #528 exposure defaults: Console and exposed API loopback only, demo loopback only,
   full/dev status as documented. A public URL does not configure DNS, TLS or a reverse proxy.

4. **Check types and defaults.** A single URL question does not describe TCP/DNS/TLS/domain
   inputs. Enumerate the wizard's supported types instead of leaving “…” to implementation.
   Proposed scope is the existing probed types (`http`, `tcp`, `dns`, `tls`, `domain`), with
   host/port, DNS name/record type and domain/warning threshold questions as required by the
   selected type; heartbeat needs different period/grace and a secret, so document it as manual
   configuration unless explicitly designed here. Define IDs/names, interval units and bounds,
   timeout defaults, multiple-check entry and CI representation. Default ordinary checks must
   target available services. Demo checks retain their useful seeded behavior; define when their
   maintenance timestamps are computed/refreshed so waiting between init and up is supported.
   Validate against formats understood by the pinned API/probe, not a guessed URL-only schema.

5. **“No secret values” exception.** Interpret this as no notification credentials or tokens in
   generated Compose, `.env`, checks, notify config, metadata, CLI output or logs. The explicitly
   required `secrets/` token files necessarily contain token values; exclude them and protected
   secret backups from the grep assertion and scan their modes separately. Generate independent
   admin/probe tokens with a cryptographic RNG, at least 32 random bytes each, length/encoding
   documented. Demo needs distinct tokens for both locations. Accept notification secret *names*,
   not values, and write no supplied env values into any output. Forward only the required names
   to the appropriate container through Compose environment references. Unset required variables
   fail at start with names only. Credential-bearing webhook URLs are outside this generic
   webhook flow: reject URL userinfo and credential query forms, explain that inline URLs must
   be non-secret, and offer signing via `secretEnv`. Never promise `urlEnv` support for that type.
   If accepting secret URLs becomes required, that needs a separately scoped notify change.
   Header-secret prompting is not required; if added, preserve #460 host-binding rules rather
   than offering an unrestricted secret-header feature.

6. **Overwrite, backup and secret preservation.** Preflight every managed destination before
   writing anything. A second init without `--force` must leave bytes, modes and file set intact.
   `--force` must make a collision-safe backup of each file it replaces before replacement;
   backups containing secrets require the same directory/file protections. Preserve existing
   valid tokens by default even with force: reinitialization must not become implicit rotation
   (#530). Define behavior for invalid existing tokens, unrelated files, symlinks, interrupted
   writes, backup failure and concurrent init. Refuse symlink/non-regular managed destinations;
   do not follow links to outside files. Validate before publishing generated output and keep
   failure recovery bounded. Do not mount the whole generated directory (including secrets)
   into every service just to expose checks/config. Specify mount/reload semantics for the
   required top-level `checks.json`, including replacement by a normal editor.

7. **Compose lifecycle contract.** Operate on the installation's plain Compose files; identify
   the file/directory and project name consistently in all commands and in documented direct
   Docker commands. Define a project-name policy that avoids accidentally controlling another
   installation; preserve existing standalone project names. Default up is detached, idempotent
   and builds dev as needed. Require Compose >=2.23, matching the templates, not merely any v2.
   Distinguish missing Docker, inaccessible daemon and missing/old Compose with useful remedies.
   Spawn argument arrays, never shell-concatenate user input. Set a finite configurable readiness
   deadline (300 seconds is the existing ordinary default), bound each request/subprocess, and
   name pending/failed services on timeout. Exclude disabled services; fail early on unsuccessful
   one-shot jobs. Do not expose internal ports to make readiness easier. A failed up should leave
   the stack available for diagnosis rather than deleting data automatically.

8. **Status and teardown.** Define one row per configured service, including stopped/missing
   services. Show pulse readiness from `/readyz`, one-shots as completed/failed, and helpers via
   appropriate health/running checks. Report their version from the actual image reference or
   available image metadata; label local dev builds and unknown versions honestly. Do not add a
   version HTTP API to other targets. Define status exit semantics for an unready/stopped stack
   and deterministic output for acceptance assertions. Default down stops/removes project
   containers and networks while retaining data, tokens and generated files. “Cleans up” does
   not authorize deleting user databases by default; CI can explicitly clean its disposable
   volumes after the assertion. No new reset/log/upgrade/rotation command is required.

9. **Distribution, tooling and measurement.** Specify release tags, asset names, target triples,
   install/uninstall steps and a checksum file for linux x64/arm64 and macOS arm64 compiled
   binaries. Ship all templates/helpers in each binary; users need Docker, not host Bun or the
   old shell helper dependencies. Use approved tool versions and actions, least-privilege release
   permissions and GitHub CLI/API if that avoids an unapproved release action. Add the shared
   strict toolchain at a pinned config SHA without dropping existing deploy checks. Decide how
   all three targets are built and checked, distinguishing native execution from cross-compilation;
   do not claim a cross-built binary was run on its target OS. No signing/notarization requirement
   was requested. Report uncompressed binary size per target and repeatable init timing for a
   compiled binary in a fresh temporary directory, excluding start/pulls and naming the host,
   repetitions and summary statistic. There is no requested hard size/time budget.

## Derived acceptance check

The plan should turn the following into deploy CI/release checks and review evidence:

1. Compile the release executable, copy it away from the repository into an empty working
   directory, and run `pulse init --setup demo --yes` with stdin closed. It exits successfully
   without a prompt/start/network template fetch and writes `compose.yaml`, `.env`, `checks.json`,
   `secrets/` and every helper/notify asset its Compose file references. Host Bun and a deploy
   checkout are not required. `docker compose config --quiet` succeeds there.
2. In that generated directory run `pulse up` with the documented finite timeout. Every selected
   pulse service, including both demo probes, answers `/readyz`; one-shots complete successfully,
   and demo helpers meet their defined checks. `pulse status` enumerates the expected services,
   shows versions and the corresponding ready/completed/helper states. Demo checks actually
   reach the API and retain the open-incident/mail behavior when notify is selected; reuse the
   existing demo assertions where applicable. `pulse down` removes project containers/networks
   and retains generated files/secrets/data. CI then explicitly removes disposable test volumes.
3. Validate rendered files for all four presets, disabled optional services and representative
   additions to minimal. Include status disabled while probe remains enabled, notify disabled in
   demo, custom ports/public URLs, and custom checks for every promised type. Run real readiness
   coverage for generated minimal/full/demo and dev with prepared source checkouts, or explain
   precisely how existing integration coverage is reused for identical generated assets.
4. Use sentinel SMTP/signing secrets in the caller's environment. The notify file contains only
   env names and the generated Compose forwards them correctly; verify actual delivery/signing
   using a controlled receiver. Search every generated non-secret file and captured CLI output
   for those sentinels and generated token values: none appear. Run config validation quietly;
   do not print resolved Compose environments containing runtime secret values into CI logs.
   Every token file is mode `0600`, `secrets/` is `0700`, and runtime copies have correct ownership,
   restricted mode and per-consumer visibility. Admin authentication and probe submission work
   using the generated files, not test-overlay literals.
5. Snapshot generated bytes, modes and paths. Repeat init without force: non-zero, actionable
   conflict message, snapshot unchanged, no partial backup. With force, replaced files have
   recoverable backups, secrets remain protected and existing valid tokens are preserved.
   Exercise a pre-existing nested conflict, symlink destination and backup failure without
   modifying unrelated files. Cover validation/cancellation before commit of generated files.
6. Drive the real prompt sequence through a pseudo-TTY or injected input, covering service
   choices, a non-HTTP check, notification env references and both start answers. Equivalent
   flags yield equivalent non-secret config. Cover invalid answers/retry, EOF/cancellation,
   missing CI inputs and help without hanging or leaking values.
7. With controlled Docker/Compose responses test missing Docker, daemon failure, old/missing
   Compose, failed one-shots, stopped services, disabled services and a healthy-but-not-ready
   pulse container. A hanging readiness request cannot outlive the configured deadline materially;
   errors name the affected service and never dump credentials. Repeat up is safe.
8. Use the documented direct `docker compose` commands on the generated files without the CLI,
   including env-reference provisioning. Stop/start and readiness still work; editing the checks
   file affects the running API as documented. This is a portable installation, not CLI-only state.
9. Keep #528's standalone setup/static/secret/e2e checks green. New strict typecheck/lint/tests and
   compile jobs pass. The release workflow attaches all three platform binaries and checksums;
   record platform execution evidence separately from compile evidence. Documentation covers
   installation, the walkthrough, every flag/default, prerequisites, backups, secret provisioning,
   dev sources, readiness errors, persistence and continuing without the CLI. Report binary sizes
   and measured init time with the method above.
