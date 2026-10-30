# Spec #455: Factory workflows: no persisted credentials, actions pinned by SHA, SRI for d3

## Goal

The Factory workflows of pulse-meta keep no credential in any git config or `gh` file that the agent session can read, run only actions pinned by commit SHA, install agent CLIs only at an exact version or `latest` (no ranges or other strings), and the report page loads d3 only when it passes a Subresource Integrity check. `docs/factory.md` states the remaining prompt-injection risk and the interim rule.

## Scope

Only pulse-meta: `.github/workflows/factory-run.yml`, `factory-fan-out.yml`, `factory-unblock.yml`, `factory-report.yml`, `report/index.html`, `docs/factory.md`, `docs/approved-packages.md`, plus a temporary debug step for the check. The repository variable `FACTORY_CLAUDE_VERSION` stays `latest`.

**No target repository changes, so there is no `## Repository:` section and `targets.json` is the empty array `[]`.** The meta target has no `build` workflow. A person applies the exact changes in "Changes in meta" after the spec merges, as in #352.

**Fan-out:** `factory fan-out` rejects an empty array ("must be a nonempty JSON array"). A missing file gives the `FAN_OUT_PLAN_MISSING` notice ("Nothing to fan out", exit 0). So the person who merges the spec PR **deletes `.factory/work/455/targets.json` from the spec branch before the merge**. Then fan-out ends with that notice and opens no child. If the person forgets, the only effect is one failed fan-out run and its failure comment on #455. No child issue is opened.

**Non-goals:** no author filtering in the prompt or preamble; no change to `permissionMode`; no enforcement of the label rule in `factory.yml` (documented only; a possible follow-up); no Dependabot or pin-update automation (follow-up); no change to the CI of other repositories; no change to the action majors.

## Decisions

1. **Git credentials come through `GIT_ASKPASS`, not git config (issue review point 2, option a).**
   - `gh auth setup-git` is removed.
   - A step writes the script `$RUNNER_TEMP/factory-git-askpass`. It holds no secret: it prints `x-access-token` for a `Username` prompt and `$GH_TOKEN` of the calling process for a `Password` prompt.
   - Only the steps that run Factory set `GIT_ASKPASS: ${{ runner.temp }}/factory-git-askpass`: "Cancel the interruption" and "Run one factory state".
   - `git config --get-regexp 'credential|extraheader'` therefore prints nothing, and pushes still work: the Factory publish, and the agent's own first `git push` in `implement.md` 79, which inherits the step environment.
   - `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_*` were rejected: `git config` shows those values.
2. **Scoping the token to the push is not possible from this repository.**
   - Factory clones (`factory-workspace-multigit`), pushes (`factory-workspace-git`, `git push --set-upstream origin <branch>`) and starts the agent in the one `factory run` process of the step "Run one factory state".
   - `factory-harness-claude` passes that `process.env` to the agent (`options.js` 117).
   - The prompts also need `GH_TOKEN` for `gh` (issues, PRs, `gh api -X PATCH`, `gh pr checks`), and the Claude CLI needs `CLAUDE_CODE_OAUTH_TOKEN`.
   - So both tokens stay readable in the agent's environment. This spec removes every *stored* copy (the checkout extraheader, the gh credential helper entry, any `hosts.yml`), not the environment copy. Removing the environment copy needs one of two Factory features: publishing with a token that is not passed to the harness, or an env allow/deny list for the harness. That work belongs with paragondata/factory#292.
   - The person who applies the spec checks whether #292 covers env scoping. If it covers only author filtering, they open a new upstream issue in paragondata/factory ("harness: do not pass the publish token to the agent; env allow-list") and link it from `docs/factory.md` and from #455. This repository cannot read paragondata/factory, so the plan could not check this.
3. **The `factory-run.yml` checkout drops `token:`.** pulse-meta is public, and Factory clones the target itself, so the default job token is enough for the fetch. With `persist-credentials: false` it is not stored either.
4. **The step "Log in to the target hosts" is removed.** `FACTORY_TARGET_LOGINS` is not set (it is a no-op today). If it were set, `gh auth login` would store tokens in plain text in `~/.config/gh/hosts.yml`. A future target on another host needs its own spec, with an askpass that scopes per host.
5. **Pins: stay on the current majors, at the release that the major tag points to today.** Every major tag below resolves to the same commit as the named release, so the pins change no behavior. The commits were resolved with `gh api repos/<r>/git/ref/tags/<tag>`; every object is of type `commit` (no annotated tag):

   | Action | Release | Commit |
   | --- | --- | --- |
   | actions/checkout | v5.1.0 (= `v5`) | `fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09` |
   | actions/setup-node | v6.5.0 (= `v6`) | `249970729cb0ef3589644e2896645e5dc5ba9c38` |
   | actions/upload-pages-artifact | v4.0.0 (= `v4`) | `7b1f4a764d45c48632c6b24a0339c27f5614fb0b` |
   | actions/deploy-pages | v4.0.5 (= `v4`) | `d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e` |
   | oven-sh/setup-bun | v2.2.0 (unchanged, verified) | `0c5077e51419868618aeaa5fe8019c62421857d6` |

   The implementer re-runs the lookup when applying the spec. If a tag has moved, they use the new commit and the comment for that release; the comment always names the exact release (`# v5.1.0`), never a bare major.
6. **SRI, not vendoring** (the smaller diff; `generate.mjs` stays unchanged).
   - The value is `sha384-CjloA8y00+1SDAUkjs099PVfnY2KmDC2BZnws9kh8D/lX1s46w6EPhpXdqMfjK6i`. It was computed from the bytes cdnjs serves (279706 bytes, header `// https://d3js.org v7.9.0`) and cross-checked against `dist/d3.min.js` of the npm tarball `d3-7.9.0.tgz`, which hashes the same. cdnjs publishes only a sha512 for this file (`sha512-vc58qvvBdrDR4etbxMdlTt4GBQk1qjvyORR2nrsPsFPyrs+/u5c3+1Ct6upOgdZoIl7eq6k3a1UPDSNAQi/32A==`); the issue asks for sha384.
   - cdnjs answers with `Access-Control-Allow-Origin: *`, which `crossorigin="anonymous"` needs.
7. **The CLI version guard accepts `skip`, an exact `MAJOR.MINOR.PATCH`, or `latest`.** It rejects ranges and every other string (`2.1`, `^2.1.314`, `v2.1.314`). The repository variable `FACTORY_CLAUDE_VERSION` stays `latest`: the owner decided on 30 Oct to run the latest Claude Code. The default `2.1.314` applies only when the variable is unset. `FACTORY_CODEX_VERSION` is unset, so it is `skip`.
8. **`docs/approved-packages.md`** lists the four GitHub actions next to `oven-sh/setup-bun`, by SHA, because target reviews read that list.

## Required behavior

- Every `actions/checkout` in `.github/workflows/*.yml` has `persist-credentials: false`. There are 4: factory-run, fan-out, unblock, report.
- No step runs `gh auth setup-git` or `gh auth login`. No git config at any scope (system, global, local of the outer checkout, local of the `.target` clone) contains a `credential.*` or `http.*.extraheader` key during the agent step. `~/.config/gh/hosts.yml` does not exist.
- Factory still pushes the branch and opens or updates the PR, in a `spec` run on meta and in a `build` run on a target. The agent's own `git push` in `implement` still works.
- Every `uses:` is `<owner>/<repo>@<40 hex> # vX.Y.Z`.
- "Install agent CLIs" fails before any install when either version is not `skip`, not `latest` and not an exact `MAJOR.MINOR.PATCH`. The error names the variable and the bad value.
- `report/index.html` loads d3 with the `integrity` value above and `crossorigin="anonymous"`.
- `docs/factory.md` has the section "Prompt injection and credentials" and the corrected version-override text.

## Risks

- **Residual H1:** any commenter's text still reaches an agent that holds `GH_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN` in its environment, with `permissionMode: auto`. This spec documents it; the upstream issue fixes it.
- **The askpass script inside the agent sandbox.** git must be able to run `$RUNNER_TEMP/factory-git-askpass` inside the bubblewrap containment. Today git runs `/usr/bin/gh` there the same way, and the containment check binds `/`. If the agent's own push fails with "could not read Username", the acceptance run shows it. The fallback is to write the script under `$HOME` (for example `$HOME/.factory-git-askpass`, still no secret) and point `GIT_ASKPASS` there. No credential helper comes back.
- **Pins go stale.** Security fixes in v5.x and v6.x are no longer picked up automatically. Follow-up: Dependabot for `github-actions` or a manual cadence.
- **cdnjs changes the bytes of d3 7.9.0** (unlikely for a versioned path). The report then stops drawing charts and shows the integrity error in the console. That is the intended fail-closed behavior; the fix is a new hash after review, or vendoring.
- **`latest` can pick up a broken Claude Code release.** The variable stays `latest` by owner decision, so a bad release reaches the next run. The run then fails, and the failure comment on the issue makes it visible; setting the variable to an exact version pins a known good release until a fix ships.
- **Debug output.** GitHub masks the raw secret but not its base64 form inside an extraheader. So the debug step prints key names only (`--name-only`), never values.

## Acceptance evidence

1. `grep -nE 'uses: [^@]+@v[0-9]' .github/workflows/*.yml` prints nothing.
   `grep -nE 'uses: ' .github/workflows/*.yml | grep -vE 'uses: [^ @]+@[0-9a-f]{40} # v[0-9]+\.[0-9]+\.[0-9]+$'` prints nothing.
   `grep -c 'uses: ' .github/workflows/*.yml` gives 11 in total.
2. `grep -c 'persist-credentials: false' .github/workflows/*.yml` sums to 4, which equals the count of `actions/checkout@`. `grep -rn 'setup-git\|gh auth login\|FACTORY_TARGET_LOGINS' .github/workflows` prints nothing.
3. **Credential check on a test issue.**
   - The person adds the temporary debug step (below) to `factory-run.yml` on `main`, directly before "Run one factory state".
   - They start a `spec` run on a throwaway meta test issue (for example "Factory test: no-op spec for #455", owner-labelled).
   - The step prints `(none)` for every scope, `hosts.yml absent` and `askpass ready`.
   - The same run then pushes its branch and opens or updates the draft spec PR.
   - The log lines and the run link go into a comment on #455. Afterwards the debug step is removed, and the test issue and its PR are closed without merge.
4. **Build check.**
   - The person opens a throwaway child issue for one target, for example `config`: a docs-only change "add a sentence to docs/development.md", with the `target/config` label and the build start label as the fan-out sets them. They start it with `gh workflow run factory-run.yml -f issue=<n> -f admission=restart`.
   - `implement` runs its first `git push` and opens the draft PR, and `review` completes.
   - The run link goes into #455. The PR is closed without merge, and the child issue is closed.
   - A child of a real pending feature works just as well.
5. **Version guard.**
   - In a scratch shell, run the guard script with `FACTORY_CLAUDE_VERSION=2.1`, `^2.1.314` and `v2.1.314`: each exits 1 with the error. With `2.1.314`, `latest` and `skip` it exits 0.
6. **SRI regression check.**
   - Run `GH_TOKEN=<token> node report/generate.mjs _site`, then `python3 -m http.server -d _site 8099`. In Playwright or agent-browser, open `http://localhost:8099/`: the charts render. Take screenshot 1.
   - Copy `_site/index.html`. Change one character inside the base64 digest, for example the first `C` after `sha384-` to `D`. Do not touch the `sha384-` prefix. Reload: the console shows "Failed to find a valid digest in the 'integrity' attribute", `typeof d3 === 'undefined'`, and no chart SVG is drawn. Take screenshot 2.
   - Restore the file. Both screenshots and the console line go into the PR or the commit comment.
7. `npx factory validate` passes. After the change a full `spec` run (item 3) and a `build` run (item 4) finish.
8. `docs/factory.md` contains the new section with `paragondata/factory#292` and the interim rule, and line 27 no longer says that any override is accepted.

## Performance impact

None expected. Only CI workflow pins, git credential plumbing, docs and one script attribute change. Every pin resolves to the commit the floating tag uses today. No api code, image or bench path changes, so no metric in `bench/budgets.json` of pulse-api (startup or load CPU, idle or peak RSS, test or build CPU, wall-clock startup, p95 latency, requests per second, image size) can move. The report page gains one SHA-384 check of 280 kB in the browser (under 1 ms).

## Security impact

Security impact: yes. It changes CI (GitHub Actions workflows), credential handling of the Factory runner, dependency pins (actions, Claude Code CLI) and a third-party script on the report page.

Checklist items that apply:

- **Secrets in errors, logs and responses.**
  - No token value is stored in git config or `hosts.yml`.
  - The debug step prints key names only.
  - The guard's error message prints the variable name and value. Variables are not secrets, but the guard never prints a secret.
  - The askpass script prints the token only to git on its stdout, never to the log.
- **Dependency pins.**
  - Every action is pinned by a 40-character commit with an exact version comment.
  - Claude Code and Codex only at an exact version, `latest`, or `skip`.
  - d3 is pinned by version path plus SRI.
- **Input validation.** The version guard validates the repository variables with an anchored regex before they reach `npm install` (`latest` is the only dist-tag allowed; no range, no dist-tag, no `v` prefix, no spec such as `file:` or `git+`).

The other items (auth order and status codes, body and size limits, accessor execution, SSRF and redirects, atomic writes) do not apply: no service code changes.

Because the meta target has no `build` workflow, the hostile-input checks of the security state are done by the person as acceptance items 2, 3, 5 and 6. In the counterexamples below, each guard case is a hostile input.

## Rollout order

One repository (pulse-meta). No target, and no consumer of contract, kit or config, is affected. The order of the steps inside it matters:

1. **Merge the spec PR**, after deleting `.factory/work/455/targets.json` from it (see Scope). Fan-out prints the meta-only notice.
2. **Apply "Changes in meta"** in one commit on a branch, as a PR by the person, and merge it. Runs already in progress keep their old workflow file and their stored credentials until they end. Runs started after the merge use the new file. Fan-out and unblock need no git credentials (they use `gh` with `GH_TOKEN` only), so they keep working with `persist-credentials: false`. The report needs none either; the merge triggers a report publish through `push` on `report/**`, which checks SRI in production.
3. **Temporarily add the debug step**, run acceptance items 3 and 4, then remove the step in a second commit.
4. **Upstream:** link or open the paragondata/factory issue for env scoping (Decision 2).

## Counterexamples

- **Pin regex.** A wrong implementation lets each of these through, and the check must reject every one:
  - `actions/checkout@v5`, which acceptance check 1 catches;
  - `actions/checkout@fbc6f39 # v5.1.0` (short SHA);
  - `actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09` (no comment);
  - `actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5` (major only);
  - the SHA of an annotated **tag object** instead of its commit. GitHub fails such a `uses:` or resolves it differently, and the `git/ref` lookup must show `type: commit`.
- **Checkout count.** A fifth checkout added later without `persist-credentials: false` makes the counts 4 vs 5 differ, and check 2 fails.
- **Credential check.**
  - Keeping `gh auth setup-git` makes the debug step print `credential.https://github.com.helper`. That fails, even though the line holds no token.
  - Setting the token through `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.extraheader` makes `git config --get-regexp extraheader` print a key, which also fails.
  - Writing the token into the askpass file (`printf 'echo ghp_…'`) leaves a stored copy. The script must reference `$GH_TOKEN` and only that; `grep -c 'GH_TOKEN' "$RUNNER_TEMP/factory-git-askpass"` is 1, and it contains no `gh[pousr]_` literal.
- **Version guard.** These are rejected:
  - `next`, `stable`, `Latest`;
  - `2`, `2.1`, `2.1.x`;
  - `^2.1.314`, `~2.1.314`, `>=2.1.314`;
  - `v2.1.314`;
  - `02.1.314` (leading zero);
  - `2.1.314-beta.1` (prerelease: rejected on purpose; use an exact release);
  - ` 2.1.314` (leading space);
  - `2.1.314\n` (trailing newline: bash `=~` with `^…$` rejects an embedded newline);
  - `file:../x`, `git+https://…`;
  - the empty string. It cannot occur, because `vars.X || 'default'` maps empty to the default, but the guard must still reject it.

  These are accepted: `skip`, `latest`, `2.1.314`, `0.0.0`, `10.20.30`. The regex is `^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`.
- **SRI.**
  - Changing the prefix to `sha385-…` makes browsers *ignore* the unknown algorithm and load d3 unchecked. So the regression test changes a digest character, never the prefix, and the value must start with exactly `sha384-`.
  - Without `crossorigin="anonymous"`, the cross-origin script is fetched no-cors, and the integrity check always fails: the page never renders. Both attributes are required.
  - A truncated digest (43 base64 characters instead of 64) must fail to load.
- **Statistics:** none defined by this change.

## Contract fields

No new names in contract or config. The only new identifiers are CI-local: the environment variable `GIT_ASKPASS` (a standard git variable, set only on two steps), the file `$RUNNER_TEMP/factory-git-askpass`, and the step name "Write the Git askpass helper" (the guard goes into the existing step "Install agent CLIs"). Search:
`grep -rn "GIT_ASKPASS\|factory-git-askpass" .repos/contract/src .repos/config .github` finds nothing.

## Changes in meta (applied by a person after the spec merges)

Files:
- `.github/workflows/factory-run.yml`
- `.github/workflows/factory-fan-out.yml`
- `.github/workflows/factory-unblock.yml`
- `.github/workflows/factory-report.yml`
- `report/index.html`
- `docs/factory.md`
- `docs/approved-packages.md`
- repository variable `FACTORY_CLAUDE_VERSION`: unchanged, stays `latest`

### `.github/workflows/factory-run.yml`

Replace lines 92-117 (the step "Log in to the target hosts" and the checkout) with:

```yaml
      # Git gets the bot token only through GIT_ASKPASS, on the steps that run Factory. The helper
      # prints the GH_TOKEN of the calling process and stores nothing, so no git config and no gh
      # file holds a credential, and the checkout keeps none. The agent still inherits GH_TOKEN
      # from the run step: see docs/factory.md, "Prompt injection and credentials".
      - name: Write the Git askpass helper
        run: |
          cat > "$RUNNER_TEMP/factory-git-askpass" <<'ASKPASS'
          #!/bin/sh
          case "$1" in
            Username*) printf '%s\n' x-access-token ;;
            Password*) printf '%s\n' "$GH_TOKEN" ;;
          esac
          ASKPASS
          chmod 0755 "$RUNNER_TEMP/factory-git-askpass"

      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5.1.0
        with:
          ref: ${{ github.event.repository.default_branch }}
          fetch-depth: 0
          persist-credentials: false
```

Line 125: `      - uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6.5.0`
Line 132 stays the same: `oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0`.

Replace lines 141-154 (comment and "Install agent CLIs") with:

```yaml
      # Claude Code defaults to the version of the green runs on 2026-10-30 when the variable is
      # unset; the variable is `latest` by owner decision. Codex defaults to `skip`: no model
      # in the loop uses it. A repository variable overrides either default with an exact
      # MAJOR.MINOR.PATCH, `latest` or `skip`; anything else (a range, another tag) fails here.
      - name: Install agent CLIs
        env:
          FACTORY_CODEX_VERSION: ${{ vars.FACTORY_CODEX_VERSION || 'skip' }}
          FACTORY_CLAUDE_VERSION: ${{ vars.FACTORY_CLAUDE_VERSION || '2.1.314' }}
        run: |
          exact='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
          for name in FACTORY_CODEX_VERSION FACTORY_CLAUDE_VERSION; do
            value="${!name}"
            [[ "$value" == skip || "$value" == latest || "$value" =~ $exact ]] || { echo "::error::$name must be an exact MAJOR.MINOR.PATCH version, latest or skip, not '$value'." >&2; exit 1; }
          done
          if [ "$FACTORY_CODEX_VERSION" != skip ]; then
            npm install --global --no-audit --no-fund "@openai/codex@$FACTORY_CODEX_VERSION"
          fi
          if [ "$FACTORY_CLAUDE_VERSION" != skip ]; then
            npm install --global --no-audit --no-fund "@anthropic-ai/claude-code@$FACTORY_CLAUDE_VERSION"
          fi
```

In "Cancel the interruption" and in "Run one factory state", add under `env:` after `GH_TOKEN`:

```yaml
          GIT_ASKPASS: ${{ runner.temp }}/factory-git-askpass
```

Everything else stays: "Check the bot account" (it still checks `FACTORY_GITHUB_TOKEN`), "Configure Git author" (name and email, no credential), the `continue` job and the failure reports.

**Temporary debug step (acceptance item 3 only, removed afterwards).** Insert it directly before "Run one factory state":

```yaml
      - name: Show credential keys (temporary, #455)
        if: ${{ inputs.admission != 'cancel' }}
        env:
          GH_TOKEN: ${{ secrets.FACTORY_GITHUB_TOKEN }}
          CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.FACTORY_CLAUDE_OAUTH_TOKEN }}
          GIT_ASKPASS: ${{ runner.temp }}/factory-git-askpass
        run: |
          # Key names only: GitHub does not mask a token inside a base64 extraheader value.
          echo "all scopes in the checkout:"; git config --show-scope --name-only --get-regexp 'credential|extraheader' || echo "(none)"
          echo "global:"; git config --global --name-only --get-regexp 'credential|extraheader' || echo "(none)"
          echo "system:"; git config --system --name-only --get-regexp 'credential|extraheader' 2>/dev/null || echo "(none)"
          if [ -e "$HOME/.config/gh/hosts.yml" ]; then echo "hosts.yml present"; else echo "hosts.yml absent"; fi
          [ -x "$GIT_ASKPASS" ] && [ "$(grep -c 'GH_TOKEN' "$GIT_ASKPASS")" = 1 ] && echo "askpass ready"
```

### `.github/workflows/factory-fan-out.yml`

Lines 31-33 become:

```yaml
      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5.1.0
        with:
          ref: ${{ github.event.repository.default_branch }}
          persist-credentials: false
```

Line 41: `      - uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6.5.0`

### `.github/workflows/factory-unblock.yml`

Lines 24-26: the same checkout block as in fan-out (pinned, with `persist-credentials: false`). Line 34: the same setup-node line.

### `.github/workflows/factory-report.yml`

```yaml
      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5.1.0
        with:
          persist-credentials: false

      - uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6.5.0
      ...
      - uses: actions/upload-pages-artifact@7b1f4a764d45c48632c6b24a0339c27f5614fb0b # v4.0.0
      ...
      - id: deploy
        uses: actions/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e # v4.0.5
```

(The `with:` blocks of setup-node and upload-pages-artifact stay unchanged.)

### `report/index.html`

Line 40 becomes:

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js" integrity="sha384-CjloA8y00+1SDAUkjs099PVfnY2KmDC2BZnws9kh8D/lX1s46w6EPhpXdqMfjK6i" crossorigin="anonymous"></script>
```

Before applying, recompute it: `curl -s https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js | openssl dgst -sha384 -binary | openssl base64 -A`. It must equal the value above and the hash of `package/dist/d3.min.js` from `https://registry.npmjs.org/d3/-/d3-7.9.0.tgz`. If they differ, stop and comment on #455; do not take the cdnjs value alone.

### `docs/factory.md`

Replace line 27 with:

> **Agent CLI versions.** `factory-run.yml` installs Claude Code at the version in `FACTORY_CLAUDE_VERSION` (`latest` by owner decision; `2.1.314` when unset) and skips the Codex CLI, which no model in the loop uses. The repository variables `FACTORY_CLAUDE_VERSION` and `FACTORY_CODEX_VERSION` accept only an exact `MAJOR.MINOR.PATCH`, `latest` or `skip`. The step "Install agent CLIs" fails on anything else, such as a range or a `v` prefix.

Add after the "Workflow script tests" paragraph:

> ## Prompt injection and credentials
>
> **Remaining risk.** The issue title, body and every comment, from any author, reach the agent. The agent runs with `permissionMode: auto` and holds the bot token (`GH_TOKEN`, write access to every pulse repository) and the Claude OAuth token in its environment. A comment on an issue with a `factory/` label can therefore try to make the agent push code or leak a token. Filtering comments by author needs a Factory feature (paragondata/factory#292). Giving the token only to the Factory publish, not to the agent, needs another one (paragondata/factory#292 or the linked upstream issue). Both are open.
>
> **What the workflows do now.** No checkout keeps credentials (`persist-credentials: false`). No step runs `gh auth setup-git` or `gh auth login`. Git gets the token only through `GIT_ASKPASS` on the steps that run Factory, so no git config and no gh file stores one. Every action is pinned by commit SHA. The report loads d3 with Subresource Integrity.
>
> **Interim rule.** Only the repository owner applies `factory/` labels. Before a person starts or restarts a run (label, `factory start`, `admission=restart`), they read every comment that arrived since the last run, and they remove or answer any comment that asks the agent to do something outside the issue.

### `docs/approved-packages.md`

In the "Runtime and CI" table, after the `oven-sh/setup-bun` row, add:

```markdown
| [actions/checkout](https://github.com/actions/checkout) | `fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09` (v5.1.0) | Checkout in the pulse-meta workflows, always with `persist-credentials: false`. Pinned by commit SHA. |
| [actions/setup-node](https://github.com/actions/setup-node) | `249970729cb0ef3589644e2896645e5dc5ba9c38` (v6.5.0) | Node for the Factory CLI in the pulse-meta workflows. Pinned by commit SHA. |
| [actions/upload-pages-artifact](https://github.com/actions/upload-pages-artifact) | `7b1f4a764d45c48632c6b24a0339c27f5614fb0b` (v4.0.0) | Factory report build in pulse-meta. Pinned by commit SHA. |
| [actions/deploy-pages](https://github.com/actions/deploy-pages) | `d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e` (v4.0.5) | Factory report publish in pulse-meta. Pinned by commit SHA. |
```

### Checks and completion evidence

Acceptance items 1-8 above, run in this order: item 5 (guard script locally) and items 1, 2 and 6 on the change branch before the merge; items 3, 4 and 7 after it; item 8 by reading. The person records the results (commands, outputs, run links, the two screenshots) in the PR that applies these changes and links that PR from #455. #455 closes when that PR is merged and the debug step has been removed again.
