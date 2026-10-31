#!/usr/bin/env bash
# Opens one audit issue from the template <kind>.md next to this script. It adds no factory/ label,
# so no Factory run starts; the lead decides how the audit runs. An open issue of the same kind (and
# the same repository for per-repository kinds) blocks a new one.
#
#   security      one target repository per run, in rotation by day
#   performance   one service or library repository per run, two slots per week (Mon-Thu, Fri-Sun)
#   architecture  one issue for the whole system
#
# The schedules in factory-audit.yml decide how often each kind runs; each cron line maps to one kind.
#
# Environment: GITHUB_REPOSITORY and GH_TOKEN; AUDIT_KIND and AUDIT_TARGET, the dispatch inputs
# (empty on a scheduled run); AUDIT_SCHEDULE, the cron of a scheduled run; AUDIT_TODAY (YYYY-MM-DD,
# for tests; default today in UTC).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
today="${AUDIT_TODAY:-$(date -u +%Y-%m-%d)}"

kind="${AUDIT_KIND:-}"
if [[ -z "$kind" ]]; then
  # Keep these in step with the cron lines and the concurrency group of factory-audit.yml.
  case "${AUDIT_SCHEDULE:-}" in
    '17 6 * * *') kind=security ;;
    '17 6 * * 2,5') kind=performance ;;
    '17 6 * * 4') kind=architecture ;;
    *) echo "::error::No audit kind for the schedule '${AUDIT_SCHEDULE:-}'." >&2; exit 1 ;;
  esac
fi

# Rotation slots: days since 1970-01-01, and two slots per Monday-based week.
days=$(( $(date -u -d "$today" +%s) / 86400 ))
weeks=$(( (days + 3) / 7 ))
half=$(( $(date -u -d "$today" +%u) >= 5 ? 1 : 0 ))

case "$kind" in
  security)
    targets=(contract probe api status notify config kit website)
    slot=$days title="Security audit"
    color=b60205 description="Security weakness or hardening" ;;
  performance)
    targets=(contract probe api status notify kit website)
    slot=$(( 2 * weeks + half )) title="Performance audit"
    color=fbca04 description="Measured cost: queries, startup, memory, test or page budgets" ;;
  architecture)
    targets=() slot=0 title="Architecture audit"
    color=5319e7 description="Structure across repositories: pins, size, duplication, docs, dependency direction" ;;
  *) echo "::error::Unknown audit kind: $kind" >&2; exit 1 ;;
esac

target="${AUDIT_TARGET:-rotation}"
if ((${#targets[@]} == 0)); then
  [[ "$target" == rotation ]] || echo "::notice::The $kind audit covers the whole system; target $target is ignored."
  target=""
else
  [[ "$target" == rotation ]] && target="${targets[$((slot % ${#targets[@]}))]}"
  [[ " ${targets[*]} " == *" $target "* ]] || { echo "::error::Unknown target: $target" >&2; exit 1; }
fi

R="$GITHUB_REPOSITORY"
# Every page: an open audit can sit behind 100 other issues with the same labels.
open="$(gh api --paginate "repos/$R/issues?state=open&labels=$kind${target:+,target/$target}&per_page=100" \
  --jq ".[] | select(.pull_request == null) | select(.title | startswith(\"$title:\")) | .number")"
open="${open%%$'\n'*}"
if [[ -n "$open" ]]; then
  echo "#$open is still open for ${target:-the whole system}. No new issue."; exit 0
fi

if ! gh api "repos/$R/labels/$kind" --silent 2> /dev/null; then
  gh api "repos/$R/labels" -f name="$kind" -f color="$color" -f description="$description" --silent
  echo "Created the label $kind."
fi

body="$(< "$here/$kind.md")"
body="${body//\{repo\}/$target}"
args=(-f "labels[]=$kind")
[[ -n "$target" ]] && args+=(-f "labels[]=target/$target")
url="$(gh api "repos/$R/issues" -f title="$title: pulse${target:+-$target} ($today)" -f body="$body" \
  "${args[@]}" --jq .html_url)"
echo "Opened $url"
