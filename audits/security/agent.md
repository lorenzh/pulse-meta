# Security audit: pulse-agent (2026-11-10)

## Scope

- Issue: lorenzh/pulse-meta#952 (periodic security audit of `main` in pulse-agent). Audit date: 2026-11-10.
- Repositories and examined commits:
  - agent `8e48f5cb2aea56cdcd8792673222a5110dc0ee1b` (newest `main`, clone in `.repos/agent`; `git ls-remote` gives the same SHA for `HEAD` and `refs/heads/main`).
  - meta `6a09e6e9a0e5724b232a34312075b67068007dcc` (`docs/approved-packages.md`, `docs/architecture.md`, `README.md`, `.factory/config.yaml`).
  - config `88996cb46fe723c4f7f395477e049029cd847c81`: read only, to see whether its workflow and action policy covers pulse-agent (note N2).
- Method: a full clone of pulse-agent (both commits, plus `refs/pull/1/head`) in `mktemp -d`, outside the repository. The GitHub API for workflows, releases, tags and rulesets of the repository. `cargo 1.99.1` was on the runner to try a build.
- Surface: none yet. `main` holds three files: `AGENTS.md`, `LICENSE` (MIT) and `README.md`. The repository has no source code, no build manifest (`Cargo.toml`, `Cargo.lock`), no Dockerfile, no CI workflow, no release and no tag. `docs/architecture.md:13` and `README.md:23` in pulse-meta say the same: the agent is "planned" and "has no code yet". The planned agent is specified in the open feature lorenzh/pulse-meta#836 (and #839 builds on it). That code is not on `main`, so this audit does not cover it (note N4).
- Result: 0 findings, 0 issue candidates. Every runtime item of the checklist is `not applicable` because there is no code to run or attack. The two items that apply to repository content (secrets, and dependencies, images and CI) are `checked`.

Commands and output used for every item (tree listings summarized by commit):

```text
$ git rev-list main --count
2
$ for c in $(git rev-list main); do git ls-tree -r --name-only $c; done
8e48f5c…: AGENTS.md LICENSE README.md
e72ddb2…: LICENSE README.md
$ git log --all --name-only --format= | sort -u
AGENTS.md
LICENSE
README.md
$ find . -path ./.git -prune -o -type f \( -name Cargo.toml -o -name Cargo.lock -o -iname 'Dockerfile*' -o -name '*.yml' -o -name '*.yaml' -o -name package.json -o -name 'rust-toolchain*' \) -print
(no output, exit 0)
$ cargo build
error: could not find `Cargo.toml` in `/tmp/…/agent` or any parent directory
exit 101
```

## Checklist

| Item | Status | Evidence |
| --- | --- | --- |
| Secrets and server texts (tokens, header values, SMTP or upstream replies, file contents) in errors, logs and responses | checked | Errors, logs and responses: there is no code that can emit them (no source file in any commit; `cargo build` exits 101 with "could not find `Cargo.toml`"). Repository content: `git grep -n -I -i -E` with patterns for GitHub tokens (`ghp_`, `gho_`, `ghs_`, `github_pat_`), Slack tokens, AWS keys (`AKIA…`), PEM blocks (`-----BEGIN`), `api_key`, `secret`, `token`, `password`, `passwd`, `bearer` and `PULSE_…=` assignments over every blob of both commits: no match, exit 1. The same pattern set over `refs/pull/1/head` (the only pull request ref): no match, exit 1. `grep -P '[^\x09\x0a\x20-\x7e]'` over the three files (hidden or control characters): no match, exit 1. |
| Authentication before any other check; status codes and their order on admin routes | not applicable | The repository has no code, so it has no server and no routes. The planned agent only pushes and "opens no port on the host" (#836, Constraints); it will authenticate to pulse-api as a client, which the api audits cover. |
| Body and size limits on every method, also before any write | not applicable | No code: no server that takes a body and no client that reads a response. `cargo build` exit 101 (no `Cargo.toml`). |
| Input validation at every trust boundary; validators never throw on any input type | not applicable | No code: there is no trust boundary yet (no environment parsing, no `/proc` or `statfs` reads, no API response handling). |
| No accessor or getter of untrusted input runs | not applicable | No code: no untrusted input is accessed or parsed. |
| SSRF: allowed targets, environment lookups, redirects (cross-origin, https to http), forwarded headers | not applicable | No code: no HTTP client and no environment lookups yet. What the next audit must check for the planned push client is in note N4. |
| File writes atomic and path-safe | not applicable | No code that writes files. The planned agent reads `/proc` and `statfs` and sends; #836 names no file it writes. |
| Dependencies, Docker base images and CI actions pinned and approved (`docs/approved-packages.md`) | checked | Dependencies: no `Cargo.toml`, `Cargo.lock`, `package.json` or toolchain file in any commit (`git log --all --name-only` lists only `AGENTS.md`, `LICENSE`, `README.md`). Nothing to pin; nothing unapproved. `docs/approved-packages.md` has no Rust section yet (`rg -n -i 'rust\|cargo\|crate' docs/approved-packages.md`: no match, exit 1), which matches the empty crate (note N1). Docker: no Dockerfile in any commit; the agent is planned as a static binary, not an image. CI: no `.github/` directory in any commit; `gh api repos/lorenzh/pulse-agent/actions/workflows --jq .total_count` gives `0`. Releases: `gh api …/releases --jq length` gives `0`, tags `0`. No action, image or release asset to pin. |

## Issue candidates

None. No command on the examined commit showed a problem, so this audit has no finding.

## Notes

- N1: `docs/approved-packages.md` (meta `6a09e6e`) lists only npm packages, GitHub actions, Docker images and runners. It has no Rust crate, no Rust toolchain pin and no Rust CI action. That is consistent with the empty repository today. #836 (Constraints) already requires a Rust section with licence, maintenance state and reason before the agent adds a crate. The first audit after the agent code lands should check `Cargo.lock` against that section and that the toolchain is pinned (for example a `rust-toolchain.toml` with an exact version).
- N2: the action policy check of pulse-config (`bin/pulse-workflows.js`, config `88996cb`) is invoked through its Bun `lint` script and reads `package.json`. Pulse-agent has no package manifest or workflow invoking it. When Rust CI is introduced, it must explicitly enforce the approved action pins and `persist-credentials: false`; the current Bun lint integration does not provide that enforcement in pulse-agent.
- N3: repository settings. `gh api repos/lorenzh/pulse-agent/rulesets` gives `[]` (no ruleset visible to this token). `gh api repos/lorenzh/pulse-agent/branches/main/protection` exits 1 with HTTP 403 "Resource not accessible by integration", so branch protection and required status checks of `main` could not be verified. This visibility limitation is outside the issue checklist.
- N4: what the next audit should attack once #836 lands (this is a list of checks, not a finding). The check secret comes from the environment: it must not appear in logs, panics, `Debug` output or error texts, also when a send fails (#836 says a failed send is logged). The push client must refuse redirects, or at least cross-origin and https-to-http ones, so that the secret never crosses to another host or to plain http. It needs a timeout and a cap on the response body it reads. An API URL with user info or a non-http(s) scheme should be refused. The values from `/proc` and `statfs`, and mount and interface names from the environment, are input to small pure parsers that must not panic on any content. The release builds need pinned actions, a pinned toolchain and, like the images, build provenance. The systemd unit should run the agent as an unprivileged user with the usual sandbox options, as #836 requires.
- N5: `refs/pull/1/head` (`f22861a`, pull request #1, merged) has the same tree as `main` (`git rev-parse main^{tree} pr1^{tree}`: both `a838256…`; `git diff --quiet main pr1`: exit 0). It was scanned with the same pattern set; no pattern matched.
- This is the first security audit of pulse-agent; there is no earlier report to compare.

## Independent review (2026-11-10)

Started at 15:06:08 UTC. Both report files parse and agree on all eight checklist items and statuses, the three examined commits, zero findings and zero candidates. There are no P1 or P2 findings to reproduce, and no findings were removed or regraded.

The supplied agent clone and remote `main` both remain at `8e48f5cb2aea56cdcd8792673222a5110dc0ee1b`; config remains at `88996cb46fe723c4f7f395477e049029cd847c81`. The review's meta checkout is `1bf8f1ef0a0a6c1ba4359696ee0210e812d3dd38`, whose parent is the examined meta commit `6a09e6e9a0e5724b232a34312075b67068007dcc`. Only the two audit files were added between those meta commits; the four examined context files are unchanged (`git diff --quiet 6a09e6e9a0e5724b232a34312075b67068007dcc HEAD -- docs/approved-packages.md docs/architecture.md README.md .factory/config.yaml`, exit 0, no output).

Repository-content and build commands ran in a temporary `rsync -a` copy of the supplied agent clone. Its shallow history was expanded there, and PR #1 was fetched as `origin/pr1`. Remote metadata and meta context checks ran from the review checkout. The source clones were unchanged. Outputs below normalize the temporary directory name.

```text
$ git ls-remote https://github.com/lorenzh/pulse-agent.git HEAD refs/heads/main refs/pull/1/head
8e48f5cb2aea56cdcd8792673222a5110dc0ee1b HEAD
8e48f5cb2aea56cdcd8792673222a5110dc0ee1b refs/heads/main
f22861a6424ae75a13f74db7195c6445f0cf14fa refs/pull/1/head
exit 0
$ git rev-list main --count
2
exit 0
$ git log --all --name-only --format= | sort -u
AGENTS.md
LICENSE
README.md
exit 0
$ git grep -n -I -i -E -e '(gh[pousr]_[[:alnum:]_]+|github_pat_[[:alnum:]_]+|xox[baprs]-[[:alnum:]-]+|AKIA[[:alnum:]]{16}|-----BEGIN|api[_-]?key|secret|token|password|passwd|bearer|PULSE_[[:alnum:]_]*=)' $(git rev-list main) origin/pr1 --
(no output)
exit 1
$ grep -n -P '[^\x09\x0a\x20-\x7e]' AGENTS.md LICENSE README.md
(no output)
exit 1
$ cargo build
error: could not find `Cargo.toml` in `/tmp/…/agent` or any parent directory
exit 101
$ git diff --quiet main origin/pr1
(no output)
exit 0
$ rg -n -i 'rust|cargo|crate' docs/approved-packages.md
(no output)
exit 1
$ gh api repos/lorenzh/pulse-agent/actions/workflows --jq .total_count
0
exit 0
$ gh api --paginate repos/lorenzh/pulse-agent/releases --jq length
0
exit 0
$ gh api --paginate repos/lorenzh/pulse-agent/tags --jq length
0
exit 0
$ gh api repos/lorenzh/pulse-agent/rulesets --jq .
[]
exit 0
$ gh api repos/lorenzh/pulse-agent/branches/main/protection
gh: Resource not accessible by integration (HTTP 403)
exit 1
```

The manifest, Dockerfile, workflow and toolchain `find` command above was also rerun: exit 0, no output. `jq . audits/security/agent.json` exited 0. Inline Python consistency assertions exited 0 with `PASS: JSON parses; all 8 checklist items/statuses and 3 examined SHAs match Markdown; no findings or candidates`.

Limitations: the secret scan is pattern-based; no executable service or package exists to exercise runtime behavior or hostile inputs. Planned code in #836 is excluded. Branch protection remains unreadable (N3). These do not invalidate the checklist reasons. The temporary copy was removed, no service was started, and no review gate remains.
