#!/usr/bin/env bash
# Opens one audit issue from the template <kind>.md next to this script, with the label
# factory/audit/audit, and starts its Factory run. A label set with the job token triggers no
# workflow (GitHub suppresses events of GITHUB_TOKEN except workflow_dispatch), so the script
# dispatches factory-run.yml itself, as factory-fan-out.yml does. An open issue of the same kind (and
# the same repository for per-repository kinds) blocks a new one and starts nothing.
# Per-repository kinds get audit/<repo>, not target/<repo>: the audit runs on the meta target and
# only reads the repository.
#
#   security      one target repository per run, in rotation by day
#   performance   one service or library repository per run, two slots per week (Mon-Thu, Fri-Sun)
#   architecture  one issue for the whole system
#   quality       one target repository per run, in rotation by week
#
# The schedules in factory-audit.yml decide how often each kind runs; each cron line maps to one kind.
#
# Environment: GITHUB_REPOSITORY and GH_TOKEN (issues: write, actions: write); AUDIT_KIND and AUDIT_TARGET, the dispatch inputs
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
    '17 6 * * 1') kind=quality ;;
    *) echo "::error::No audit kind for the schedule '${AUDIT_SCHEDULE:-}'." >&2; exit 1 ;;
  esac
fi

# Rotation slots: days since 1970-01-01, and two slots per Monday-based week.
days=$(( $(date -u -d "$today" +%s) / 86400 ))
weeks=$(( (days + 3) / 7 ))
half=$(( $(date -u -d "$today" +%u) >= 5 ? 1 : 0 ))

case "$kind" in
  security)
    targets=(contract probe api status notify config kit website console)
    slot=$days title="Security audit"
    color=b60205 description="Security weakness or hardening" ;;
  performance)
    targets=(contract probe api status notify kit website console)
    slot=$(( 2 * weeks + half )) title="Performance audit"
    color=fbca04 description="Measured cost: queries, startup, memory, test or page budgets" ;;
  architecture)
    targets=() slot=0 title="Architecture audit"
    color=5319e7 description="Structure across repositories: pins, size, duplication, docs, dependency direction" ;;
  quality)
    targets=(contract probe api status notify config kit website console)
    slot=$weeks title="Quality audit"
    color=0e8a16 description="Code quality: lint, complexity, duplication, dead code, tests, error handling" ;;
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
open="$(gh api --paginate "repos/$R/issues?state=open&labels=$kind${target:+,audit/$target}&per_page=100" \
  --jq ".[] | select(.pull_request == null) | select(.title | startswith(\"$title:\")) | .number")"
open="${open%%$'\n'*}"
if [[ -n "$open" ]]; then
  echo "#$open is still open for ${target:-the whole system}. No new issue."; exit 0
fi

if ! gh api "repos/$R/labels/$kind" --silent 2> /dev/null; then
  gh api "repos/$R/labels" -f name="$kind" -f color="$color" -f description="$description" --silent
  echo "Created the label $kind."
fi
if [[ -n "$target" ]] && ! gh api "repos/$R/labels/audit%2F$target" --silent 2> /dev/null; then
  gh api "repos/$R/labels" -f name="audit/$target" -f color=c5def5 \
    -f description="Audit of lorenzh/pulse-$target, run on the meta target" --silent
  echo "Created the label audit/$target."
fi

# The schedule event carries no repository object, so ask for the default branch.
branch="$(gh api "repos/$R" --jq .default_branch)"

body="$(< "$here/$kind.md")"
body="${body//\{repo\}/$target}"
args=(-f "labels[]=$kind" -f "labels[]=factory/audit/audit")
[[ -n "$target" ]] && args+=(-f "labels[]=audit/$target")
created="$(gh api "repos/$R/issues" -f title="$title: pulse${target:+-$target} ($today)" -f body="$body" \
  "${args[@]}" --jq '"\(.number) \(.html_url)"')"
read -r number url <<< "$created"
echo "Opened $url"
[[ "$number" =~ ^[1-9][0-9]{0,9}$ ]] || { echo "::error::Not a canonical issue number: $number" >&2; exit 1; }
gh workflow run factory-run.yml --repo "$R" --ref "$branch" -f issue="$number" -f admission=label
echo "Started the audit run of #$number."
