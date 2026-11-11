# Architecture decision records

This folder holds the architecture decisions that span several pulse repositories. One file per decision, numbered in order: `NNNN-short-title.md`. Copy [template.md](template.md) for a new one.

Rules:

- A decision record is short: context, decision, consequences. Details stay in the linked docs and issues.
- A record is never rewritten after it is accepted. A changed decision gets a new record, and the old one gets the status `Superseded by NNNN`.
- Status values: `Proposed`, `Accepted`, `Superseded by NNNN`, `Deprecated`.
- A record is added by pull request. Bot pull requests use the branch `bot/<role>/<topic>` and are merged by Lorenz.

| No. | Title | Status |
| --- | --- | --- |
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-one-release-line.md) | One release line, release on every merge | Accepted |
| [0003](0003-breaking-marker.md) | Mark breaking changes with a `Breaking:` line, not a label | Accepted |
| [0004](0004-protect-main.md) | Protect `main` in every repository | Superseded by 0005 |
| [0005](0005-require-one-approval.md) | Require one approval on `main` | Accepted |
