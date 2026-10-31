#!/usr/bin/env bash
# After the deploy of a merged report: closes the report issue that report/narrative.json names, so
# the next day's opener is not blocked. Only an open issue with the label report is closed.
#
# Environment: GITHUB_REPOSITORY and GH_TOKEN (issues: write); REPORT_NARRATIVE (default
# report/narrative.json); REPORT_URL, the page URL for the comment.
set -euo pipefail
R="$GITHUB_REPOSITORY"
n="$(jq -r '.issue // empty' "${REPORT_NARRATIVE:-report/narrative.json}")"
[[ -n "$n" ]] || { echo "The report names no issue. Nothing to close."; exit 0; }
[[ "$n" =~ ^[1-9][0-9]{0,9}$ ]] || { echo "::error::Not a canonical issue number: $n" >&2; exit 1; }
read -r state is_report < <(gh api "repos/$R/issues/$n" --jq '"\(.state) \([.labels[].name] | index("report") != null)"')
if [[ "$state" != open || "$is_report" != true ]]; then
  echo "#$n is $state$([[ "$is_report" == true ]] || echo ', without the label report'). Nothing to close."; exit 0
fi
gh api "repos/$R/issues/$n/comments" -f body="The merged report is published at ${REPORT_URL:-the Factory report page}. factory-report.yml closes this issue." --silent
gh api -X PATCH "repos/$R/issues/$n" -f state=closed -f state_reason=completed --silent
echo "Closed #$n."
