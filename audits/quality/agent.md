# Quality audit: pulse-agent (2026-11-23)

## Scope

- Issue: lorenzh/pulse-meta#982, periodic code quality audit of `main` of pulse-agent. The issue comments hold only the Factory claim. They contain no decisions and no review feedback. This is the first quality audit of pulse-agent, so no earlier report exists at this path.
- Audit date: 2026-11-23 (UTC).
- Examined commits:

| Repository | Commit | What was read |
| --- | --- | --- |
| pulse-agent | `8e48f5cb2aea56cdcd8792673222a5110dc0ee1b` | `main` (all three files: `AGENTS.md`, `LICENSE`, `README.md`) and its full history (2 commits). `git ls-remote origin HEAD refs/heads/main` gives the same SHA for both. The last commit is from 2026-11-09. |
| pulse-meta | `65b03892e525f495b338965dee780f35a440e0f7` | `README.md`, `docs/architecture.md`, `docs/releasing.md`, `.factory/config.yaml`, `.factory/prompts/preamble.md`, `.factory/work/927/plan.md`, `.github/audits/open-issue.sh`, `.github/audits/quality.md`; issues #836, #839, #939. |
| pulse-config | `88996cb46fe723c4f7f395477e049029cd847c81` | All files, to find shared configuration that applies to a Rust crate. |
| pulse-contract | `baf6aece0df479986511df8a7c9ef3e7e39ddc49` | `src/schema.ts` and `src/validate*.ts`, for the check types the README refers to. |
| pulse-api | `8959e0469a7b7a16e2329e968a7c42e176d287c6` | `src/`, for a host push route. |
| pulse-probe | `92f55df473d2032f8d7cc0ab8e393d84d108d9ba` | `AGENTS.md`, `CLAUDE.md`, `LICENSE` and the repository layout only, for the consistency item (same for the rows below). |
| pulse-notify | `6f4efe1fc776f43e1ead8e0f24b688cc4aa56faa` | as above |
| pulse-status | `f220fbc27a2d733e583aba63e5949062f29d9861` | as above |
| pulse-console | `b6c737d49ba7e3fe734c332304cb908d7f820804` | as above |
| pulse-kit | `ece6a8990350deed4e6b780adbdc4ee75b09a07b` | as above |
| pulse-deploy | `d47d8b90146601f97dad7de3dcf625a14e4bf018` | as above |
| pulse-website | `a3077ad6b5ae9c680c8032501c0320b7765da6e8` | as above |

- Method: `rsync` of the pulse-agent clone into `mktemp -d`. In that copy the audit ran `git fetch --unshallow`, the four script names of the checklist through `npm run` and `bun run` (Bun 1.4.0), and `cargo` 1.100.0 (already on the runner), each under `timeout 600`. Everything else used `grep`, `git` and `gh` reads. No package or tool was installed, no service was started, and nothing was contacted except GitHub. The copy was removed at the end.
- Surface: none. `main` has no source file, no build manifest (`package.json`, `Cargo.toml`), no `tsconfig.json`, no test, no `docs/` and no `.github/`. pulse-meta records this state: `README.md:23` and `docs/architecture.md:13` call the agent "planned" with "no code yet", and `docs/releasing.md:17` says "No CI." The agent is specified in the open feature lorenzh/pulse-meta#836 ("Host resource checks with a push agent"; no Factory label, so no spec yet), and #839 builds on it.
- Result: 2 findings, both `P3` notes, 0 `P1`, 0 `P2`. No issue candidates. No item is blocked. Six code items are `not applicable` because there is no code. Consistency and docs against code are `checked`.

Commands that apply to every item (run in the copy):

```text
$ git rev-list main --count
2
$ for c in $(git rev-list main); do echo "$c: $(git ls-tree -r --name-only $c | tr '\n' ' ')"; done
8e48f5cb2aea56cdcd8792673222a5110dc0ee1b: AGENTS.md LICENSE README.md
e72ddb2e3f706f2beaf30093f50a4f4dd37b28e6: LICENSE README.md
$ git ls-files | grep -vxE 'AGENTS.md|LICENSE|README.md'
(no output)  exit 1
$ git ls-files | grep -E '\.(rs|ts|js|mjs|toml|json|ya?ml|sh)$'
(no output)  exit 1
$ timeout 600 npm run lint        # same for typecheck, test, check
npm error enoent Could not read package.json: Error: ENOENT: no such file or directory, open '…/agent/package.json'
exit 254
$ timeout 600 bun run lint ; bun run typecheck ; bun run check
error: Script not found "lint"        exit 1
error: Script not found "typecheck"   exit 1
error: Script not found "check"       exit 1
$ timeout 600 bun run test
error: "/usr/bin/test" exited with code 1
note: a package.json script "test" was not found
exit 1
$ timeout 600 cargo clippy ; cargo test
error: could not find `Cargo.toml` in `…/agent` or any parent directory
exit 101 (both)
$ timeout 600 cargo fmt --check
`cargo metadata` exited with an error: error: could not find `Cargo.toml` in `…/agent` or any parent directory
exit 1
```

## Checklist

### 1. Lint and typecheck: `not applicable`

pulse-agent has no `package.json` and no `lint` or `typecheck` script, so biome, SonarJS and `tsc` have nothing to run on: `npm run lint` and `npm run typecheck` exit 254 (`ENOENT … package.json`), `bun run lint` and `bun run typecheck` exit 1 (`Script not found`). The repository has no `tsconfig.json` and no `.ts` file. Called without a project, `bunx --no-install tsc --noEmit` (TypeScript 7.0.2 from the runner) prints its usage and exits 1. The agent is planned in Rust (#836), and its Rust tools have no manifest yet either: `cargo clippy` exits 101 and `cargo fmt --check` exits 1 (`could not find Cargo.toml`). No `eslint-disable`, `biome-ignore`, `@ts-ignore` or `#[allow(` exists to check, because there is no source file (`git ls-files | grep -E '\.(rs|ts|js|mjs|toml|json|ya?ml|sh)$'`, no output, exit 1).

### 2. Complexity: `not applicable`

There are no functions. The shared budget of pulse-config is `"sonarjs/cognitive-complexity": ["error", 15]` (`eslint.config.js:16`, config `88996cb`), and it covers TypeScript and JavaScript (`eslint.config.js:11`). pulse-config has no Rust configuration: `grep -rnwiE "rust|cargo|clippy|rustfmt" .repos/config --exclude-dir=.git` finds nothing (exit 1). So a future Rust crate has no shared complexity budget to measure against (note N3).

### 3. Duplicated logic: `not applicable`

The repository has no logic: its only files are `AGENTS.md`, `LICENSE` and `README.md` (`git ls-files | grep -vxE 'AGENTS.md|LICENSE|README.md'`, no output, exit 1). Nothing can duplicate a file in the same repository or in another pulse repository. Only documentation is duplicated: the one-line agent description is written three times and the copies already differ (finding 1 and note N5).

### 4. Dead code: `not applicable`

There are no exports, no modules and no files that could be unreachable. `grep` finds no source file (item 1), and `tsc` has no project to check (no `tsconfig.json`; `bunx --no-install tsc --noEmit` prints its usage, exit 1).

### 5. Test quality: `not applicable`

There is no test script and no test: `bun run test` exits 1 (`a package.json script "test" was not found`), `npm run test` exits 254, `cargo test` exits 101 (no `Cargo.toml`). No coverage is reported. There is no code, so there is no risky branch.

### 6. Error handling: `not applicable`

There is no code, so there is no `catch`, no promise, no `Result`, no `unwrap` and no error type that could be swallowed or shaped differently (`git ls-files` lists only `AGENTS.md`, `LICENSE`, `README.md`). For the planned agent, #836 requires that "a failed send is logged and retried on the next interval; the agent never exits on a network error". The first audit after #836 lands should check this (note N7).

### 7. Consistency: `checked`

Compared with the ten other targets (clones at newest `main`):

```text
$ for r in agent api config console contract deploy kit notify probe status website; do
    printf "%-9s CLAUDE.md:%s\n" $r "$(grep -c '^@AGENTS.md$' $r/CLAUDE.md 2>/dev/null || echo 'no file')"; done
agent     CLAUDE.md:no file
api       CLAUDE.md:1
config    CLAUDE.md:1
console   CLAUDE.md:1
contract  CLAUDE.md:1
deploy    CLAUDE.md:1
kit       CLAUDE.md:1
notify    CLAUDE.md:1
probe     CLAUDE.md:1
status    CLAUDE.md:1
website   CLAUDE.md:1
exit 0
```

- pulse-agent is the only target without a `CLAUDE.md` that imports `AGENTS.md`. Finding 2.
- `AGENTS.md` has 9 lines and one section (`## Code conventions`). The other ten have 73 to 141 lines, and each has a `## Commands` section (`grep -n "^## Commands" */AGENTS.md`: 10 hits, none in agent). pulse-agent therefore names no check command and no done gate. That matches a repository without code, and #836 asks for "its own `AGENTS.md`, CI (rustfmt, clippy with warnings as errors, tests)". Note N1.
- There is no `.github/` (no CI) and no `docs/development.md`. pulse-meta `docs/releasing.md:17` (`` | `agent` | none | No CI. | ``) and `:71` (`agent` is skipped until it has CI) say the same, so this is no contradiction. Note N2.
- `AGENTS.md:9` keeps metric parsing and formatting in small pure functions and I/O at the edge. That matches the other targets (`api/AGENTS.md:52` "Keep logic pure. I/O … stays in `main.ts` and the server or client modules", the same line in contract, probe and kit, and `deploy/AGENTS.md:34` "Docker, files and the network stay at the edge") and `docs/code-conventions.md` rule 3. No deviation.
- Naming and configuration handling: there is no code and no configuration to compare.

### 8. Docs against code: `checked`

The repository has no `docs/`. `README.md` has two lines. `AGENTS.md` describes the repository too.

- `README.md:2`: "pulse: Linux host agent in Rust that pushes CPU, memory, swap, disk and network values to pulse-api for host checks." No code does this, and no `host` check type exists for it to feed: no Rust or other source file in the repository, no `host` type in pulse-contract, no host route in pulse-api. Finding 1.
- `AGENTS.md:5` ("pulse-agent is the Linux host agent of pulse, written in Rust") and `AGENTS.md:9` ("Search the crate for an existing function or module") refer to a crate that does not exist yet. These are instructions for the build that #836 will start, so they are part of finding 1, not a separate finding.
- `LICENSE`: MIT, which matches #836 ("MIT, Rust") and the README of pulse-meta.

## Findings

| Id | Severity | Candidate | Location | Title |
| --- | --- | --- | --- | --- |
| quality-agent-2026-11-23-1 | P3 | no | `README.md:2` | README says the agent pushes host values for host checks; there is no code and no `host` check type |
| quality-agent-2026-11-23-2 | P3 | no | `AGENTS.md:1` (no `CLAUDE.md` imports it) | pulse-agent is the only target without a `CLAUDE.md` that imports `AGENTS.md` |

### quality-agent-2026-11-23-1 (P3, note): README describes an agent that does not exist

- Location: `README.md:2` (agent `8e48f5c`).
- Claim: "pulse: Linux host agent in Rust that pushes CPU, memory, swap, disk and network values to pulse-api for host checks."
- Contradicting code: the repository has no code. pulse-contract has six check types and none is `host`. pulse-api has no route or handler for host samples.

```text
$ git -C agent ls-files | grep -vxE 'AGENTS.md|LICENSE|README.md'
(no output)  exit 1
$ git -C agent ls-files | grep -E '\.(rs|ts|js|mjs|toml|json|ya?ml|sh)$'
(no output)  exit 1
$ grep -nE 'type: oneOf\(\["' contract/src/schema.ts            # contract baf6aec
273:      type: oneOf(["http"]).optional(),
326:    type: oneOf(["tls"]),
424:    type: oneOf(["tcp"]),
438:    type: oneOf(["dns"]),
456:      type: oneOf(["domain"]),
480:    type: oneOf(["heartbeat"]),
exit 0
$ grep -n 'must be "http"' contract/src/validate.ts
138:      return `${path}.type: must be "http", "tls", "tcp", "dns", "domain" or "heartbeat"`;
$ grep -rlniE 'hostSample|host ?sample|"host"' api/src --include=*.ts --exclude='*.test.ts'   # api 8959e04
(no output)  exit 1
```

(The only `"host"` in `contract/src/schema.ts` is line 107, the forbidden `Host` request header of the probe. It is not a check type.)

- Why it matters: a reader of the repository is told about behavior that does not exist. The description is written three times, and the copies already differ. pulse-meta `README.md:23` and `docs/architecture.md:13` say "planned" and "no code yet", but the agent's own README does not.
- Not a candidate: the claim becomes true when #836 lands, and #836 already sets up the repository ("Set it up as a Rust crate with its own `AGENTS.md`…"). Until then the fix is the word "planned" and a link to #836, which can be added when #836 is specced.

### quality-agent-2026-11-23-2 (P3, note): no `CLAUDE.md` imports `AGENTS.md` in pulse-agent

- Location: repository root of pulse-agent (agent `8e48f5c`). `AGENTS.md:1` exists, but no `CLAUDE.md` imports it.
- Evidence: the table in item 7 (exit 0). Every other target has a `CLAUDE.md` whose last line is `@AGENTS.md`. api, for example, says: "Claude Code instructions for this repository. Everything harness-neutral lives in `AGENTS.md`, imported below." pulse-agent has no `CLAUDE.md` in any commit (`git log --all --name-only --format= | sort -u` lists `AGENTS.md`, `LICENSE`, `README.md`).
- Context: spec #927 created this `AGENTS.md` (`.factory/work/927/plan.md:15-16`). Although its general non-goal at `plan.md:26` says "No change to `CLAUDE.md` (each one imports `AGENTS.md`)", its agent section explicitly acknowledges the missing file: `plan.md:503-504` says "Do not add commands, toolchain versions, Rust tooling, a `CLAUDE.md` or code: the repository has none yet, and inventing them is out of scope." The omission therefore followed an explicit scope decision.
- Impact limit: Factory builds use the Claude harness (`.factory/config.yaml:180-181,285`), but the common preamble already instructs them to "Read and follow the repository instructions before you edit files." (`.factory/prompts/preamble.md:14`). The comparison proves a missing import, not a build that ignored `AGENTS.md` or broke documented behavior. No such failure was reproduced.
- Not a candidate: this is a consistency note. The owner can consider the standard `CLAUDE.md` import when #836 sets up the crate, but the available evidence does not establish an operational defect.

## Issue candidates

None. Both P3 observations are notes; no operational failure was demonstrated.

## Notes

- N1 (consistency): `AGENTS.md` names no check command and no done gate. Spec #927 says "each task runs the gate its `AGENTS.md` already names" (`plan.md:29-30`), and for pulse-agent there is none. #836 asks for rustfmt, clippy with warnings as errors, and tests in CI. The `## Commands` section with those commands belongs in the same change.
- N2 (consistency): no CI workflow, no `docs/development.md`. This is consistent with pulse-meta `docs/releasing.md:17,71`. api, probe, notify, status and console have `docs/development.md`; contract, kit, config, deploy and website do not.
- N3 (meta, audit template): the quality checklist (`.github/audits/quality.md`) names `package.json` scripts, biome, SonarJS, `tsc` and "the shared configuration of pulse-config". These configurations target JavaScript and TypeScript rather than Rust. pulse-config has no Rust configuration (`grep -rnwiE "rust|cargo|clippy|rustfmt"`, exit 1). Once #836 lands, the general checklist still applies, but its named commands need Rust equivalents such as `cargo fmt --check`, `cargo clippy` with warnings as errors, and `cargo test`. Coverage reporting and a complexity budget need separate decisions; `cargo test` alone does not report coverage. Neither pulse-config nor the template has these yet.
- N4 (meta, rotation): `.github/audits/open-issue.sh:43` (security, daily rotation over 11 targets) and `:54` (quality, weekly rotation over 11 targets) include `agent`. The performance rotation (`:47`) leaves it out. pulse-agent `main` has not changed since 2026-11-09 (`git log -1 --format=%ad`: `2026-11-09 01:53:25 +0100`). The security audit #952 (2026-11-10), the open security audit #981 (2026-11-21) and this audit all examine the same commit `8e48f5c`, which has no code. Leaving `agent` out of the security and quality rotations until #836 lands, as the performance rotation already does, would save those runs.
- N5 (docs duplication): the one-line agent description exists in pulse-agent `README.md:2`, pulse-meta `README.md:23` and pulse-meta `docs/architecture.md:13`. The two pulse-meta copies say "planned" and "no code yet"; the pulse-agent copy does not (finding 1).
- N6 (not agent-specific): the copyright holder in `LICENSE:3` is "lorenzh" in agent, console, deploy, kit and website, and "Lorenz Hilpert" in api, config, contract, notify, probe and status (`sed -n 3p */LICENSE`). Both forms are used, so agent does not deviate from a single convention. Style only.
- N7 (next audit): what to check once #836 lands. Every checklist item then applies to the crate. Look for `unwrap`, `expect` and panics in the `/proc` and `statfs` parsers (#836 keeps them as small pure functions, `AGENTS.md:9`). Check that a failed send is logged and the loop goes on (#836), that rate computation from counters has tests for counter wrap and reset, that the sample shape is tested against the JSON Schema of pulse-contract (#836 requires this in CI), and that no logic duplicates a pulse-api threshold evaluation.

## Audit review (2026-11-23)

- Started at 18:18:35 UTC. All eleven target clone HEADs match the examined commits. The meta checkout is `374798332ab314e64168633ae673ba5329f5d39a`, which adds the original audit report after baseline `65b03892e525f495b338965dee780f35a440e0f7`. `git diff 65b03892e525f495b338965dee780f35a440e0f7 HEAD -- .factory/config.yaml .factory/prompts/preamble.md .factory/work/927/plan.md README.md docs .github/audits` exits 0 with no output; the cited meta evidence is unchanged.
- Structure: `jq . audits/quality/agent.json` exits 0. Both report files have the same two P3 ids, no candidates, required finding fields and eight checklist statuses: six `not applicable`, two `checked`. There are no P1/P2 findings to reproduce, missing checks or audit gates.
- In an `rsync -a` copy under `mktemp -d`, checked out at agent `8e48f5c`, `npm run lint`, `npm run typecheck`, `npm run test` and `npm run check` each exit 254 with `ENOENT` for `package.json`. The corresponding four `bun run` commands each exit 1 (missing script; `test` additionally invokes `/usr/bin/test`). `cargo clippy` and `cargo test` each exit 101 because `Cargo.toml` is absent; `cargo fmt --check` exits 1 for the same reason. These confirm the absence of runnable checks rather than code failures.
- Finding 1 reproduced: both `git -C .repos/agent ls-files` filters from its command exit 1 with no output; `grep -nE 'type: oneOf\(\["' .repos/contract/src/schema.ts` exits 0 with the same six types and lines 273, 326, 424, 438, 456 and 480; the host-sample grep of `.repos/api/src` exits 1 with no output. `README.md:2` contains the quoted claim.
- Finding 2's comparison loop exits 0: agent has no `CLAUDE.md`, all ten other targets have one `@AGENTS.md` import. Changed its candidate flag to false and narrowed its rationale to a consistency note: `git show 65b03892e525f495b338965dee780f35a440e0f7:.factory/work/927/plan.md | nl -ba | sed -n '503,504p'` exits 0 and explicitly forbids adding that file. The common preamble also requires reading repository instructions. The evidence does not show rules being missed. No finding was removed or assigned a different severity. Corrected the shared complexity scope to TypeScript and JavaScript and clarified note N3.

Limitations: no runtime behavior, coverage or complexity can be measured before source and manifests exist. The original audit's standalone `tsc` usage output and historical/GitHub rotation notes were not independently rerun; they do not affect the retained observations or checklist applicability. No packages were installed, services started, issues opened or read-only clones changed. The temporary copy was removed.
