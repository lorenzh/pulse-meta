# Issue review #455: Factory workflows without persisted credentials, actions pinned by SHA, SRI for d3

Reviewed on `main` of pulse-meta with `@paragondata/factory-cli` 0.8.0 (the version in `node_modules`).
No earlier decisions in the issue comments (only the claim of this run).

## Verdict

The feature can be specified. No blocking question. It is a meta-only change that a person applies
after the spec merges (as in #352). The points below are things the spec has to settle or say plainly.

## Verified current state

- **Persisted checkout credentials.** In this run the outer meta checkout
  (`/home/runner/work/pulse-meta/pulse-meta/.git/config`) holds
  `http.https://github.com/.extraheader` with the bot PAT. That comes from `actions/checkout@v5` in
  `factory-run.yml` 113-117 (`token: FACTORY_GITHUB_TOKEN`, no `persist-credentials: false`). The agent
  read it with `git config --get-regexp`. The value is not recorded here. H1 is confirmed.
- **`gh auth setup-git`** (`factory-run.yml` 111) writes
  `credential.https://github.com.helper !/usr/bin/gh auth git-credential` (and the same for
  gist.github.com) into `~/.gitconfig`. That line holds no token: the helper resolves `GH_TOKEN` from the
  environment of the calling process.
- **Where Factory clones and pushes.** `@paragondata/factory-workspace-multigit` clones the target with
  plain `git clone <url>` from `tmpdir()`. The comment at `multigit-workspace.js` ~221 says it does this
  on purpose, so that the extraheader of the meta checkout does not reach the target.
  `@paragondata/factory-workspace-git` (`git-workspace.js` 174) pushes with
  `git push --set-upstream origin <branch>`. Both run inside the single `factory run` process of the step
  "Run one factory state", which also starts the agent. So git needs credentials in that step.
- **The agent inherits the step's environment.** `factory-harness-claude` passes the
  `process.env` it inherits to the SDK (`options.js` 107-117). In this run `GH_TOKEN` is set in the
  agent's environment. `CLAUDE_CODE_OAUTH_TOKEN` is there too, and the Claude CLI itself needs it. The
  prompts also need `GH_TOKEN`: they read issues, open PRs, `gh api -X PATCH` the PR body and run
  `gh pr checks`.
- **`FACTORY_TARGET_LOGINS` is not set** (`gh secret list` shows only `FACTORY_CLAUDE_OAUTH_TOKEN`,
  `FACTORY_GITHUB_TOKEN` and `FACTORY_PACKAGES_TOKEN`). So the `gh auth login` loop at 99-109 is a
  no-op today and `~/.config/gh/hosts.yml` does not exist. If someone sets that secret, `gh auth login`
  would store those tokens in plain text in `hosts.yml`, where the agent can read them.
- **`FACTORY_CLAUDE_VERSION` is currently set to `latest`** (repository variable, updated
  2026-10-30T22:16:26Z). The pin therefore falls back to `latest` today. That contradicts
  `docs/factory.md` 27 and the comment at `factory-run.yml` 141-143. `FACTORY_CODEX_VERSION` is unset,
  so it defaults to `skip`.
- **`uses:` lines** (the whole list; `factory.yml`, `factory-sweep.yml`, `factory-security-audit.yml`
  and `factory-check.yml` have none):
  - `factory-run.yml`: 113 `actions/checkout@v5`, 125 `actions/setup-node@v6`, 132 `oven-sh/setup-bun@0c5077e…` (already pinned, `# v2.2.0`).
  - `factory-fan-out.yml`: 31 `actions/checkout@v5`, 41 `actions/setup-node@v6`.
  - `factory-unblock.yml`: 24 `actions/checkout@v5`, 34 `actions/setup-node@v6`.
  - `factory-report.yml`: 29 `actions/checkout@v5`, 31 `actions/setup-node@v6`, 41 `actions/upload-pages-artifact@v4`, 56 `actions/deploy-pages@v4`.
  - Checkouts: factory-run 113, fan-out 31, unblock 24, report 29. None sets `persist-credentials`.
- **`report/index.html` 40:**
  `<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>` has no
  `integrity` and no `crossorigin`. `report/generate.mjs` 283 copies only `index.html` into `_site`.
- **Fan-out with no targets:** `factory fan-out` rejects an empty `targets.json`
  (`fan-out/plan.js` 70, "must be a nonempty JSON array"). For a missing file it raises
  `FAN_OUT_PLAN_MISSING` ("a meta-only change"). `factory-fan-out.yml` 79-80 turns that into a notice
  and exits 0.
- **Label admission:** `factory.yml` admits a `factory/…` label from any sender except the bot. It does
  not check who the sender is.

## Open points for the spec

1. **The PAT stays in the agent's environment. Removing it from git config does not take it away from
   the agent.** Factory clones, pushes and runs the agent in one process, and the harness passes on that
   process's environment. So `GH_TOKEN` can only be scoped to "the push" with a Factory change. Two such
   changes would work: Factory publishes with a token it does not pass to the harness, or the harness
   gets an env allow/deny list. The spec has to say this plainly and link it to paragondata/factory#292,
   or to a new upstream issue if #292 covers only author filtering. What this repository can do is
   remove every *stored* copy of a credential: the extraheader, any token in git config, and any
   `hosts.yml`.
2. **The acceptance check conflicts with keeping `gh auth setup-git`.** "`git config --get-regexp
   'credential|extraheader'` empty in the agent step" and "still pushes its branch" can't both hold if
   the gh helper stays in `~/.gitconfig`, because the check would print the helper line. That line holds
   no secret. The plan picks one of these:
   - (a) Drop `gh auth setup-git` and give git its credential through an environment variable that is
     not git config, only on the step "Run one factory state". For example, `GIT_ASKPASS` pointing at a
     script outside the workspace that prints `x-access-token` and `$GH_TOKEN`. This meets the check
     literally. Note that `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_*` would show up in `git config` output, so
     they don't meet it.
   - (b) Keep the helper and restate the check as "no token value and no extraheader in any git config".
   - Recommendation: (a). Either way the spec states that the security effect is limited (point 1).
3. **Is the token needed on `actions/checkout` in `factory-run.yml`?** pulse-meta is public, and
   Factory clones the target itself, so the meta checkout needs no PAT. With
   `persist-credentials: false` the PAT is used only for the fetch. The plan decides whether to keep
   `token:` or drop it in favour of the default job token. Dropping it is the smaller exposure.
4. **The `FACTORY_TARGET_LOGINS` step.** It is a no-op today, but it would persist tokens in `hosts.yml`.
   The plan either removes the step or makes it pass the tokens without storing them, and says which.
   The cancel step and any other step that uses git must still work.
5. **The CLI version guard and rollout order.** The variable is `latest` right now. The spec should:
   - add a guard to "Install agent CLIs" that accepts only an exact `MAJOR.MINOR.PATCH` (or `skip`) and
     fails otherwise;
   - have the person delete or set `FACTORY_CLAUDE_VERSION` to an exact version *before or with* the
     workflow change, because otherwise every Factory run fails at that guard;
   - name the version to use (the default `2.1.314`, or the version that the green runs use when the
     change is applied).
6. **Pins to resolve.** For each action the plan resolves the full 40-character commit SHA of a
   concrete release tag. An annotated tag must be dereferenced to its commit
   (`gh api repos/<owner>/<repo>/git/ref/tags/<tag>`, then `git/tags/<sha>` if the type is `tag`). The
   plan stays on the current majors (checkout v5, setup-node v6, upload-pages-artifact v4,
   deploy-pages v4) and writes the exact version in the comment. Re-pin `oven-sh/setup-bun` only if its
   SHA is wrong. Keeping pins current (Dependabot or a manual cadence) is out of scope; the spec may
   mention it as a follow-up. Optional: list the pinned actions in `docs/approved-packages.md`, which
   already records `oven-sh/setup-bun` by SHA. The plan decides.
7. **SRI or vendoring.** The issue lets the plan choose.
   - SRI: compute the sha384 from the exact bytes served at the URL
     (`curl -s … | openssl dgst -sha384 -binary | openssl base64 -A`) and cross-check it against the
     SRI value that cdnjs publishes. cdnjs sends `Access-Control-Allow-Origin: *`, which
     `crossorigin="anonymous"` needs.
   - Vendoring: add `report/d3.min.js` with its ISC license header, and extend `generate.mjs` to copy it
     next to `index.html` in `_site`. The `push` trigger on `report/**` already covers it.
   - Either is acceptable. SRI is the smaller diff.
8. **Debug output must not leak.** The temporary debug step must not print credential values: GitHub
   masks the raw secret, but not its base64 form inside an extraheader. Print only the key names, for
   example `git config --get-regexp --name-only 'credential|extraheader' || true`, run in both the outer
   checkout and `$HOME`. A step cannot run "inside" the agent session, so the debug step runs right
   before "Run one factory state" with the same `env`, and in the same working directory. The step is
   removed afterwards.
9. **A build run on a test issue needs a child issue in a target repository**, because meta has no
   `build` workflow. The spec names how the person does it. For example: a throwaway docs-only child
   issue on one target, whose PR is closed without merging. A child of a real pending feature also
   works.
10. **`docs/factory.md`** gets a section on prompt-injection risk. It says:
    - any commenter's text reaches an agent that holds the bot PAT and the Claude OAuth token in its
      environment, with `permissionMode: auto`;
    - author filtering waits for paragondata/factory#292;
    - the interim rule: only the owner applies `factory/` labels, and a person reads new comments before
      starting or restarting a run.

    It should also correct line 27 (the variable override must be an exact version, and the guard
    rejects `latest`). Enforcing the label rule in `factory.yml` (`sender == repository_owner`) would be
    cheap, but the issue asks only for the documented rule. If the plan adds it, it must keep the bot's
    own dispatches (continuation, fan-out, unblock) working; those use `workflow_dispatch`, not labels.
11. **No `targets.json`.** No target repository changes. The plan must *not* write `targets.json`: an
    empty array makes fan-out fail, while a missing file gives the meta-only notice. The spec states why
    the file is absent, so that `plan-review` does not ask for it. The person applies the exact changes
    (full replacement lines or a diff) from the spec.

## Assumptions

- "Credentials do not stay in the git config" means no token value and no credential mechanism that
  `git config` shows. The token in the step's environment is accepted as residual risk until Factory
  can scope it (point 1).
- Major versions of the actions stay the same; only the pinning changes.
- `CLAUDE_CODE_OAUTH_TOKEN` stays in the run step. The Claude CLI needs it, and scoping it is part of the
  same upstream limitation.
- The person who applies the spec also fixes the `FACTORY_CLAUDE_VERSION` repository variable.

## Derived acceptance check

1. `grep -nE 'uses: [^@]+@v[0-9]' .github/workflows/*.yml` prints nothing.
   `grep -nE 'uses: ' .github/workflows/*.yml | grep -vE 'uses: [^ @]+@[0-9a-f]{40} # v[0-9]+\.[0-9]+\.[0-9]+$'`
   also prints nothing.
2. Every `actions/checkout` has `persist-credentials: false`: the count of
   `persist-credentials: false` equals the count of `actions/checkout@` (4 and 4).
3. On a test issue, a temporary step right before "Run one factory state", with the same env, prints
   *names only*. `git config --get-regexp --name-only 'credential|extraheader'` in the outer checkout
   and globally prints nothing (or, if the plan picks option 2(b), only the gh helper key and no
   extraheader). `ls ~/.config/gh/hosts.yml` does not exist. The same run then pushes its branch and
   opens or updates its PR. The debug step is removed afterwards.
4. "Install agent CLIs" fails on `FACTORY_CLAUDE_VERSION=latest` and passes on an exact version or
   `skip`. The repository variable is no longer `latest`.
5. SRI: the report page renders its charts with the correct `integrity`. Changing one character of it
   gives an integrity console error and no d3 charts. Screenshots of both go in the PR (agent-browser or
   Playwright). With vendoring: `_site/d3.min.js` exists and the page renders without a request to
   cdnjs.
6. `docs/factory.md` contains the prompt-injection section (residual risk, paragondata/factory#292,
   interim label/comment rule) and the corrected version-override text.
7. `npx factory validate` passes. A full `spec` run and a `build` run on a target child issue finish
   after the change.
