# Factory guide: Project manager (PM)

Written from real experience on Pulse. Only things we actually did or ran into
are listed here; extend it after each new lesson. Last update: 2026-11-11.

## What the PM owns

- The backlog: creating and editing issues so the factory can pick them up.
- Enrolling issues into the factory, one meta issue at a time.
- Unblocking the factory when it stops for backlog or issue reasons
  (`needs-input`, missing decisions, missing releases).
- Checking factory PRs against their issue and its acceptance criteria.

## Writing issues the factory can work on

- Follow the format in `AGENTS.md`: a short intro, then `## What it must do`,
  `## Constraints`, `## Done when`, written in English.
- Use native GitHub "blocked by" links for dependencies. The unblock workflow
  closes a parent automatically once its blockers close; that is how #571 and
  #922 got closed, so don't close them by hand.
- Search for duplicates first. Audits often re-report what an open issue
  already covers.
- When a later decision changes an issue (for example "the release workflow
  must read the `Breaking:` line", #943), note it on the issue right away and
  fold it into `## Done when` before enrolling.

## Enrolling and WIP

- Opening an issue does not start the factory. Enrolling means `factory start`
  or a `factory/*` label.
- One meta/feature issue at a time; its children and fan-outs may run in
  parallel. Audits and reports don't count.
- Finish legacy work in the agreed order before enrolling anything new.
- Never enroll issues that would change `.factory/`; the Architect and AI Ops
  change it via `bot/<role>/<topic>` PRs that the owner merges.
- When two running issues touch the same files (for example image pins in
  pulse-deploy), watch for conflicts and pause one with `needs-input` if needed.

## When the factory stops on `needs-input`

- Read the factory's decision comment on the issue. It usually lists options
  (D1-A, D2-A, ...) plus its assumptions.
- Get the owner's decision, then comment it on the issue in one place:
  the chosen options, accepted assumptions, and concrete facts the factory
  needs (versions, SHAs).
- Remove the label (for example `factory/spec/status/needs-input`); this
  resumes the issue.

## Releases as an unblocker

- Some issues (#692, #530) wait for released images. A `vX.Y.Z` tag on a
  commit on `main` starts the service's `ci.yml` release job, which publishes
  `ghcr.io/lorenzh/pulse-<svc>:X.Y.Z`. See `docs/releasing.md`.
- Check that `release / publish` succeeded before telling the factory the
  version exists. Never move a tag.

## Reviewing and merging factory PRs

- Factory PRs come from `app/lorenzh-factory` on `factory/<issue>-<slug>`.
- Merge only after PM, Architect and AI Ops all approve (review or comment);
  any objection blocks. The PM checks the change against the issue and its
  `## Done when`.
- PRs from our own bots (`bot/<role>/<topic>`) follow the same three-approval rule; since 2026-11-11 the bots merge them themselves after agreement.

## Documentation

- Log every relevant action in the Pulse Team Log (#955): who, what, why,
  link, observed result.
