# Spec #361: mark every hosted commitment as a placeholder

## Goal
Every statement about the unbuilt hosted offer on the hosted page of `pulse-website` is a visibly marked placeholder, and a test fails when an unmarked one appears. Fixes the P2 from the review of lorenzh/pulse-website#1 (#348).

## Scope
- `website` only: `src/content/hosted.tsx`, `src/content/hosted.test.ts`.
- `design/website/README.md` in this repository: one line on the new placeholder categories (done by the spec PR, not by the website task).

## Non-goals
- No change to self-hosted facts, docs pages, prices, layout or styling.
- No new dependency. No deployment.
- No automatic judgement of prose; the test is structural.

## Required behavior
1. Add two names to `PLACEHOLDERS`: `BACKUPS` (upgrades and backups promise) and `NETWORK_INDEPENDENCE` (monitor stays up when the customer's network is down). They render as `<mark class="placeholder">[NAME]</mark>` through `<Placeholder>`. Add `OPERATION` for "who runs the servers" and `PARITY` for "same checks file and API" so every hosted cell can carry a mark (implementer may pick better names but must record them in the PR).
2. Comparison table, Hosted column: each cell contains a `<Placeholder>`; no bare promise text remains. Cells stay readable, for example `<Placeholder name="BACKUPS" />` alone or after a neutral word. The Price and Probe locations cells already comply. Self-hosted column cells and row headers are unchanged.
3. Other hosted promises get a marker too: the `INCLUDED` cards ("backups and upgrades, run for you", "Notifications included ... sent from our side", "White-labelled, with TLS") and the unmarked items of the Starter, Team and Business plans ("Status page on a pulse subdomain", "Hosted regions plus your own probes", "Your domain, logo, colours and fonts", "Slack, Teams, reminders and heartbeats", "Several status pages, private pages", "Data processing agreement and invoice"). Either append a placeholder or word the item as intent ("planned") with a placeholder. The Self-hosted plan and the FAQ answer "Run a pulse-probe inside your network" stay as they are. FAQ answers about hosted already use intent wording ("That is the plan"); leave them unless they state a bare promise.
4. The hero lead and the notice keep their intent wording ("We plan to ...").

## Test (`hosted.test.ts`)
- Extend the existing placeholder name list with every name in `PLACEHOLDERS` (import it from `hosted.tsx` or keep the literal list in sync; prefer import so a new name must render).
- New test "every hosted promise carries a placeholder": from the rendered `hosted/index.html`, take (a) the third `<td>` of each `<tbody><tr>` of the comparison table, (b) each `<li>` of the Starter, Team and Business plans, (c) each `INCLUDED` card. Assert each contains `<mark class="placeholder">[`. No exception list; the Self-hosted column and Self-hosted plan are excluded by position/name. Assert the number of cells found is at least the current count (6 table rows) so the selector cannot silently match nothing.
- Must fail on current `main` ("Included", "No, it runs elsewhere") and pass after the change.
- All existing tests (no price, currency, percent, status URL, form action) still pass.

## Risks
- Heavy marking can make the page read as noise; keep wording short and put the marker in place of the claim.
- HTML slicing by regex is fragile; anchor on stable class names or table structure and keep the count guard.
- Placeholder names must not contain digits followed by `%` or currency characters (existing tests).

## Acceptance evidence
`npm test` (and the repository's lint/typecheck) in `website` passes; the new test fails when run against the old `hosted.tsx`; PR lists the chosen placeholder names; adding an unmarked `<td>` to the Hosted column makes the test fail.

## Repository: website
Files: `src/content/hosted.tsx`, `src/content/hosted.test.ts`.
Behavior: as in "Required behavior" and "Test" above.
Checks: `npm test`, lint and typecheck per `AGENTS.md` of the website.
Completion: PR with `Closes lorenzh/pulse-meta#<child>`, showing the test failing before and passing after.
