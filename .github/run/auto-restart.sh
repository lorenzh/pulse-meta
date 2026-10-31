#!/usr/bin/env bash
# factory-run.yml, step "Restart once after a harness timeout". When the run step stopped with
# HARNESS_TIMEOUT, it comments on the issue and dispatches admission=restart, once: a state that times
# out again before a run of it finishes is left to a person (the failure comment of the next step).
# Env: FACTORY_ISSUE, FACTORY_RUN_ID, FACTORY_GITHUB_ACTOR, FACTORY_RUN_ERR (stderr of the run step),
# FACTORY_DEFAULT_BRANCH, GITHUB_REPOSITORY, GITHUB_SERVER_URL, GITHUB_RUN_ID, GITHUB_OUTPUT.
set -euo pipefail
issue="$FACTORY_ISSUE"
[[ "$issue" =~ ^[1-9][0-9]{0,9}$ ]] || { echo "No issue to restart."; exit 0; }
grep -qx '  code: HARNESS_TIMEOUT' "$FACTORY_RUN_ERR" 2> /dev/null || { echo "No harness timeout."; exit 0; }

# One JSON object per comment, oldest first. Run records and markers count only from the bot; anyone
# can comment.
comments="$(gh api --paginate "repos/$GITHUB_REPOSITORY/issues/$issue/comments?per_page=100" \
  --jq '.[] | {login: .user.login, body} | @json')"
state="$(jq -rs --arg bot "$FACTORY_GITHUB_ACTOR" --arg run "$FACTORY_RUN_ID" '
  def rec: select(.login == $bot) | (.body | capture("<!-- factory-record v3 (?<r>\\{.*\\}) -->").r | fromjson?) // empty;
  [.[] | rec | (.claim // .) | select(.run == $run) | "\(.workflow)/\(.state)"] | last // empty' <<< "$comments")"
[[ -n "$state" ]] || { echo "No claim of run $FACTORY_RUN_ID."; exit 0; }

marker="<!-- pulse-factory-auto-restart $state -->"
again="$(jq -rs --arg bot "$FACTORY_GITHUB_ACTOR" --arg marker "$marker" --arg state "$state" '
  def rec: select(.login == $bot) | (.body | capture("<!-- factory-record v3 (?<r>\\{.*\\}) -->").r | fromjson?) // empty;
  (to_entries | map(select(.value.login == $bot and (.value.body | contains($marker))) | .key) | last) as $m
  | if $m == null then "no"
    elif [.[$m + 1:][] | rec | select(.kind == "run" and "\(.claim.workflow)/\(.claim.state)" == $state)] | length > 0 then "no"
    else "yes" end' <<< "$comments")"
if [[ "$again" == yes ]]; then
  echo "$state was restarted after a timeout already and has not finished since. A person decides."
  exit 0
fi

body="Factory: [run $GITHUB_RUN_ID]($GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID) of \`$state\` stopped with \`HARNESS_TIMEOUT\`. The work it published stays on the branch. The workflow restarted the issue once by itself (\`admission=restart\`). If \`$state\` times out again before a run of it finishes, it waits for a person.

$marker"
gh api "repos/$GITHUB_REPOSITORY/issues/$issue/comments" -f body="$body" > /dev/null
gh workflow run factory-run.yml --repo "$GITHUB_REPOSITORY" --ref "$FACTORY_DEFAULT_BRANCH" -f issue="$issue" -f admission=restart
echo "restarted=true" >> "$GITHUB_OUTPUT"
echo "Restarted #$issue after a timeout of $state."
