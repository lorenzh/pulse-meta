#!/usr/bin/env bash
# The report check of a pull request (report-check.yml). It runs report/check.mjs of the BASE
# commit against the pull request's report/data.json and report/narrative.json, so a report run
# cannot weaken the check it must pass. On a Factory branch (factory/<issue>-...) it also locks the
# template (C1, --base) and compares issue, as-of and data sha256 with the issue body.
#
# Environment: BASE_SHA, HEAD_REF; GITHUB_REPOSITORY and GH_TOKEN (issues: read) on a Factory branch.
set -euo pipefail
if ! git cat-file -e "$BASE_SHA:report/check.mjs" 2> /dev/null; then
  echo "::notice::The base commit has no report/check.mjs. Nothing to check."; exit 0
fi
d="$(mktemp -d)"
git show "$BASE_SHA:report/check.mjs" > "$d/check.mjs"
args=(--dir report)
if [[ "$HEAD_REF" =~ ^factory/([1-9][0-9]{0,9})- ]]; then
  n="${BASH_REMATCH[1]}"
  body="$(gh api "repos/$GITHUB_REPOSITORY/issues/$n" --jq .body)"
  sha="$(sed -n 's/^data-sha256: \([0-9a-f]\{64\}\)$/\1/p' <<< "$body" | head -1)"
  as_of="$(sed -n 's/^as-of: \(.*\)$/\1/p' <<< "$body" | head -1)"
  [[ -n "$sha" && -n "$as_of" ]] || { echo "::error::Issue #$n names no data-sha256 or as-of." >&2; exit 1; }
  args+=(--issue "$n" --base "$BASE_SHA" --sha "$sha" --as-of "$as_of")
fi
node "$d/check.mjs" "${args[@]}"
