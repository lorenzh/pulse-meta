#!/usr/bin/env bash
# The report check of a pull request (report-check.yml, pull_request_target). It runs from a
# checkout of the BASE commit and never runs code of the pull request: it fetches the pull
# request's report/data.json and report/narrative.json through the API as data and runs the base
# commit's report/check.mjs on them. So neither the check nor this workflow can be changed by the
# pull request it checks. On a Factory branch (factory/<issue>-...) it also locks the template
# (C1, against the pull request's changed-file list, .github/ included) and compares issue, as-of
# and data sha256 with the issue body.
#
# Environment: GITHUB_REPOSITORY, GH_TOKEN (contents: read, pull-requests: read, issues: read),
# PR_NUMBER, HEAD_REPO, HEAD_SHA, HEAD_REF. Runs in the base checkout.
set -euo pipefail
R="$GITHUB_REPOSITORY"
if [[ ! -f report/check.mjs ]]; then
  echo "::notice::The base commit has no report/check.mjs. Nothing to check."; exit 0
fi
d="$(mktemp -d)"
for f in data.json narrative.json; do
  gh api "repos/$HEAD_REPO/contents/report/$f?ref=$HEAD_SHA" -H 'Accept: application/vnd.github.raw' > "$d/$f" \
    || { echo "::error::The pull request has no report/$f." >&2; exit 1; }
done
args=(--dir "$d")
if [[ "$HEAD_REF" =~ ^factory/([1-9][0-9]{0,9})- ]]; then
  n="${BASH_REMATCH[1]}"
  gh api --paginate "repos/$R/pulls/$PR_NUMBER/files?per_page=100" --jq '.[] | .filename, (.previous_filename // empty)' > "$d/changed.txt"
  body="$(gh api "repos/$R/issues/$n" --jq .body)"
  sha="$(sed -n 's/^data-sha256: \([0-9a-f]\{64\}\)$/\1/p' <<< "$body" | head -1)"
  as_of="$(sed -n 's/^as-of: \(.*\)$/\1/p' <<< "$body" | head -1)"
  [[ -n "$sha" && -n "$as_of" ]] || { echo "::error::Issue #$n names no data-sha256 or as-of." >&2; exit 1; }
  args+=(--changed "$d/changed.txt" --issue "$n" --sha "$sha" --as-of "$as_of")
fi
node report/check.mjs "${args[@]}"
