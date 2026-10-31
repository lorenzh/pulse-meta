#!/usr/bin/env bash
# Opens the daily Factory report issue with the labels report and factory/report/report, and starts
# its Factory run. Like .github/audits/open-issue.sh, the script dispatches factory-run.yml itself,
# because a label set with the job token triggers no workflow.
#
# It opens nothing when the fingerprint of the new data equals the one of the last merged report
# (report/data.json on the default branch): no new Factory activity, no report. An open report
# issue also blocks a new one. The fingerprint covers the all-time numbers only; the report's own
# issues and runs are not in it (report/data.mjs).
#
# Environment: GITHUB_REPOSITORY and GH_TOKEN (issues: write, actions: write); REPORT_DATA, the new
# data.json; REPORT_PREVIOUS, the merged one (may be missing); REPORT_RUN_ID, the run that uploaded
# the artifact report-data; REPORT_TODAY (YYYY-MM-DD, for tests; default today in UTC).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
today="${REPORT_TODAY:-$(date -u +%Y-%m-%d)}"
R="$GITHUB_REPOSITORY"
title="Factory report"

fingerprint="$(jq -r '.meta.fingerprint // empty' "$REPORT_DATA")"
[[ "$fingerprint" =~ ^[0-9a-f]{64}$ ]] || { echo "::error::$REPORT_DATA has no fingerprint." >&2; exit 1; }
previous="$(jq -r '.meta.fingerprint // empty' "$REPORT_PREVIOUS" 2> /dev/null || true)"
if [[ "$previous" == "$fingerprint" ]]; then
  echo "The numbers have not changed since the last merged report ($fingerprint). No new issue."; exit 0
fi

# Every page: an open report can sit behind 100 other issues with the label.
open="$(gh api --paginate "repos/$R/issues?state=open&labels=report&per_page=100" \
  --jq ".[] | select(.pull_request == null) | select(.title | startswith(\"$title:\")) | .number")"
open="${open%%$'\n'*}"
if [[ -n "$open" ]]; then
  echo "#$open is still open. No new issue."; exit 0
fi

if ! gh api "repos/$R/labels/report" --silent 2> /dev/null; then
  gh api "repos/$R/labels" -f name=report -f color=1d76db -f description="Factory report of pulse; its runs stay out of the report numbers" --silent
  echo "Created the label report."
fi

# The schedule event carries no repository object, so ask for the default branch.
branch="$(gh api "repos/$R" --jq .default_branch)"

sha="$(sha256sum "$REPORT_DATA" | cut -d' ' -f1)"
body="$(< "$here/issue.md")"
body="${body//\{as_of\}/$(jq -r .meta.as_of "$REPORT_DATA")}"
body="${body//\{run_id\}/$REPORT_RUN_ID}"
body="${body//\{sha256\}/$sha}"
body="${body//\{fingerprint\}/$fingerprint}"
body="${body//\{previous_as_of\}/$(jq -r '.meta.previous_as_of // "none"' "$REPORT_DATA")}"
created="$(gh api "repos/$R/issues" -f title="$title: pulse ($today)" -f body="$body" \
  -f "labels[]=report" -f "labels[]=factory/report/report" --jq '"\(.number) \(.html_url)"')"
read -r number url <<< "$created"
echo "Opened $url"
[[ "$number" =~ ^[1-9][0-9]{0,9}$ ]] || { echo "::error::Not a canonical issue number: $number" >&2; exit 1; }
gh workflow run factory-run.yml --repo "$R" --ref "$branch" -f issue="$number" -f admission=label
echo "Started the report run of #$number."
