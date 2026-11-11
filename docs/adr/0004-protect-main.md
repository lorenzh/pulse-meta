# 0004. Protect `main` in every repository

- Status: Superseded by 0005
- Date: 2026-11-11
- Decided by: Lorenz
- Links: [Pulse Team Log #955](https://github.com/lorenzh/pulse-meta/issues/955), [#943](https://github.com/lorenzh/pulse-meta/issues/943)

## Context

No repository had branch protection. Releasing on every merge ([0002](0002-one-release-line.md)) means everything on `main` ships. The Factory pushes only to `factory/*` branches, and `main` changes only through merged pull requests.

## Decision

Every `lorenzh/pulse-*` repository has the ruleset `main-protection` on its default branch:

- deleting the branch and force pushes are blocked;
- changes need a pull request;
- no approval is required, because all bot reviews run as the account `lorenzh`, and GitHub does not allow approving your own pull request;
- repository admins may bypass only through a pull request, never with a direct push.

Required status checks follow as a second step, per repository, using only checks that run on every pull request.

## Consequences

- Nobody, bot or person, pushes to `main` directly.
- Reviews by the three Pulse bots are recorded as pull request comments, not as required approvals.
- Release tags are not affected.
