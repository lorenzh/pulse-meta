#!/usr/bin/env bash
# Publishes the self-hosted runner state for .github/workflows/runner-pick.yml. Run every minute on the
# runner host (cron), with a gh login that may write repository variables. Idle = online, not busy and carrying every label that runner-pick.yml requires.
set -euo pipefail
repo="${1:-lorenzh/pulse-meta}"
idle="$(gh api "repos/$repo/actions/runners" --jq '[.runners[] | select(.status=="online" and .busy==false and (.labels | map(.name)) as $l | (["self-hosted","pulse-meta","bwrap"] - $l | length == 0))] | length')"
for kv in "RUNNERS_IDLE=$idle" "RUNNERS_BEAT=$(date +%s)"; do
  gh variable set "${kv%%=*}" --repo "$repo" --body "${kv#*=}"
done
