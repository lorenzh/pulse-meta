# Issue review #361: hosted commitments not marked as placeholders

Only target: `website` (`src/content/hosted.tsx`, `src/content/hosted.test.ts`). `design/website/README.md` (meta) line 19 lists the placeholder categories and may need a line for the new ones.

## Current state (read in `.repos/website`)
- `PLACEHOLDERS` is a fixed list of 8 names (PRICE, REGIONS, TRIAL, DATA_LOCATION, OSS_TERMS, STATUS_URL, AVAILABILITY, LIMIT). `<Placeholder name>` renders `<mark class="placeholder">[NAME]</mark>`.
- Comparison table, Hosted column: "We do" (servers), "Included" (upgrades and backups), `[REGIONS], plus your own`, "No, it runs elsewhere", "Same" (checks file and API), `[PRICE]`.
- Other unmarked hosted promises outside the table: `INCLUDED` cards ("backups and upgrades, run for you", "Notifications included ... sent from our side", "White-labelled, with TLS"), plan items ("Status page on a pulse subdomain", "Hosted regions plus your own probes", "Your domain, logo, colours and fonts", "Slack, Teams, reminders and heartbeats", "Several status pages, private pages", "Data processing agreement and invoice").
- `hosted.test.ts` only checks that each placeholder name appears somewhere on the page. It does not inspect table cells, so unmarked promises pass.

## Open points (none block the spec)
1. **Which placeholder name marks a promise with no number or place?** No existing name fits "Included" or "No, it runs elsewhere". Assumption: add new names to `PLACEHOLDERS`, e.g. `BACKUPS` and `NETWORK_INDEPENDENCE` (plan may pick better names), and update the existing placeholder test list and the legend text if it lists names. Alternative: reuse `AVAILABILITY`; rejected because it would hide the distinct claims.
2. **Wording of the marked cells.** Assumption: the claim stays readable with the marker, e.g. "`[BACKUPS]`" or "Included: `[BACKUPS]`". The plan chooses; the cell must contain a `mark.placeholder` and no bare promise text.
3. **"We do", "Same" in the hosted column.** "Who runs the servers: We do" and "Checks file and API: Same" are also statements about the unbuilt offer. The issue says every row that promises something about hosted is marked. Assumption: treat them as promises and mark them too (or word them as intent, like the FAQ "That is the plan"). Plan decides per row and records it; the test must have no exceptions list except self-hosted column cells and the Price row, which is already a placeholder.
4. **Scope of "other hosted sections".** Assumption: the test also covers the `INCLUDED` cards, the plan cards (Starter, Team, Business, not Self-hosted) and the FAQ answers about hosted. Promises there listed above need markers or intent wording so the test passes. The FAQ answer "Run a pulse-probe inside your network" is a self-hosted fact and stays.
5. **How the test detects "a promise".** Cannot judge prose automatically. Assumption: the rule is structural: every hosted-column cell, every hosted plan item and every `INCLUDED` card must contain a `<mark class="placeholder">`. Self-hosted cells and the Self-hosted plan are excluded. This fails on current code ("Included", "No, it runs elsewhere") and on any new unmarked cell.
6. The site is not deployed, so no live content to fix beyond the repo.

## Constraints to keep
- Existing no-price/currency/percent/status-URL/form-action tests still pass.
- Self-hosted facts unchanged. No new runtime dependency.

## Acceptance check
`npm test` in `website`:
- On current `main` the new hosted-content test fails (cells "Included" and "No, it runs elsewhere" have no placeholder mark).
- After the change, every hosted-column cell of the comparison table, each hosted plan item and each `INCLUDED` card contains `<mark class="placeholder">[NAME]</mark>` with a name from `PLACEHOLDERS`, and the page build renders the new names.
- Adding an unmarked row to the hosted column makes the test fail.
