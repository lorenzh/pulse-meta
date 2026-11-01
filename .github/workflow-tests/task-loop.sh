# Sourced by test.sh: scripts/factory-tasks.mjs and .github/run/auto-restart.sh (factory-run.yml)
# against the stub `gh`. Uses $tmp, $R, key, check, step_script from test.sh.

comment() { # <login> <body> -> one issue comment as the API returns it
  jq -n --arg login "$1" --arg body "$2" '{user: {login: $login}, body: $body}'
}
record() { # <login> <message> <record json> -> a Factory comment with its record line
  comment "$1" "Factory ran x.

$2

Token usage: 1 total.
<!-- factory-record v3 $3 -->"
}
run_rec() { # <state> <reason> <next state or empty> [<run id>] -> the record of a finished build run
  jq -nc --arg s "$1" --arg r "$2" --arg n "$3" --arg run "${4:-1-1}" \
    '{kind: "run", claim: {run: $run, workflow: "build", state: $s}, done: {reason: $r, states: ([$n] - [""])}}'
}
comments() { # <issue> <comment json>... -> the comment pages of the issue
  local k; k="$(key "repos/$R/issues/$1/comments?per_page=100")"; shift
  rm -f "$FIXTURES/$k".*.json
  printf '%s\n' "$@" | jq -s . > "$FIXTURES/$k.0.json"
}

# --- scripts/factory-tasks.mjs ------------------------------------------------------------------
export FIXTURES="$tmp/tasks"; mkdir -p "$FIXTURES" "$tmp/meta/.factory/work/590/tasks"
SHA=0123456789abcdef0123456789abcdef01234567
cat > "$tmp/meta/.factory/work/590/tasks/api.json" <<'JSON'
{"version":1,"target":"api","tasks":[
 {"id":"T1","kind":"step","title":"Parser","files":["src/p.ts"],"behaviorChange":true,"spec":"item 1","acceptance":[{"command":"bun test src/p.test.ts","expected":"exit 0"}]},
 {"id":"T2","kind":"final","title":"Route and evidence","files":["src/r.ts"],"behaviorChange":true,"spec":"item 2","acceptance":[{"command":"bun run check","expected":"exit 0"}]}]}
JSON
echo '{"body":"Part of #590: a feature\n\nOpened by `factory fan-out`."}' > "$FIXTURES/$(key "repos/$R/issues/600").json"
echo '{"body":"No parent here."}' > "$FIXTURES/$(key "repos/$R/issues/601").json"
echo '{"login":"pulse-bot"}' > "$FIXTURES/user.json"
tasks() { # <issue> <target> [<extra args>...] -> "<exit code> <status> <next> <taskBase>" or the error
  local out code=0
  out="$(PATH="$tmp/bin:$PATH" FACTORY_GITHUB_ACTOR="${TASK_ACTOR:-}" GITHUB_REPOSITORY=$R node "$here/../../scripts/factory-tasks.mjs" \
    --issue "$1" --target "$2" --base base0 --root "$tmp/meta" "${@:3}" 2>&1)" || code=$?
  if jq -e . > /dev/null 2>&1 <<< "$out"; then echo "$code $(jq -r '[.status, .next // "-", .taskBase // "-"] | join(" ")' <<< "$out")"; else echo "$code $out"; fi
}
comments 600
check "tasks: no task file for the target is the legacy flow" "0 no-task-file - -" "$(tasks 600 web)"
check "tasks: no run yet starts T1 on the branch base" "0 open T1 base0" "$(tasks 600 api)"
comments 600 "$(record pulse-bot "ok
task-accepted: T1 @ $SHA" "$(run_rec task-review transition implement)")"
check "tasks: the bot's acceptance moves to the final task on the accepted commit" "0 final T2 $SHA" "$(tasks 600 api --author pulse-bot)"
check "tasks: the bot login comes from the gh token when no author is given" "0 final T2 $SHA" "$(tasks 600 api)"
check "tasks: another author's run record does not count" "0 open T1 base0" "$(tasks 600 api --author someone-else)"
comments 600 "$(record lorenzh-factory-bot "ok
task-accepted: T1 @ $SHA" "$(run_rec task-review transition implement)")"
# With an installation token /user fails. A configured actor must bypass that request.
echo 'null' > "$FIXTURES/user.json"
check "tasks: App actor accepts historical PAT records without /user" "0 final T2 $SHA" \
  "$(TASK_ACTOR='pulse-factory[bot]' tasks 600 api)"
comments 600 "$(record 'pulse-factory[bot]' "ok
task-accepted: T1 @ $SHA" "$(run_rec task-review transition implement)")"
check "tasks: App actor accepts its own REST login" "0 final T2 $SHA" \
  "$(TASK_ACTOR='pulse-factory[bot]' tasks 600 api)"
echo '{"login":"pulse-bot"}' > "$FIXTURES/user.json"
comments 600 "$(record pulse-bot "no
task-rejected: T1" "$(run_rec task-review transition implement)")"
check "tasks: a rejection makes a fix of the same task" "0 fix-task T1 base0" "$(tasks 600 api)"
check "tasks: a child without its feature line fails" "2 factory-tasks: #601 has no \"Part of #<feature>\" line" "$(tasks 601 api)"
echo '{"version":1,"target":"api","tasks":[]}' > "$tmp/meta/.factory/work/590/tasks/bad.json"
check "tasks: a broken task file fails instead of falling back to the legacy flow" \
  "2 factory-tasks: .factory/work/590/tasks/bad.json: target must be \"bad\"; tasks must be an array of 1 to 8 tasks" "$(tasks 600 bad)"
check "tasks: --check exits 1 on a defect" "1" \
  "$(node "$here/../../scripts/factory-tasks.mjs" --check "$tmp/meta/.factory/work/590" > /dev/null 2>&1; echo $?)"

# --- factory-run.yml (.github/run/auto-restart.sh) ------------------------------------------------
export FIXTURES="$tmp/restart"; mkdir -p "$FIXTURES"
printf 'factory: Harness run exceeded 3600000 ms.\n  code: HARNESS_TIMEOUT\n' > "$tmp/timeout.err"
printf 'factory: Agent failed.\n  code: HARNESS_FAILED\n' > "$tmp/other.err"
claim="$(record pulse-bot "Factory claimed state implement." '{"kind":"claim","run":"900-1","workflow":"build","state":"implement"}')"
marker="$(comment pulse-bot "restarted
<!-- pulse-factory-auto-restart build/implement -->")"
restart() { # <stderr file> -> output, then the writes and the step output
  rm -f "$FIXTURES/writes.log" "$FIXTURES/last-body.md" "$tmp/out"
  PATH="$tmp/bin:$PATH" GITHUB_REPOSITORY=$R GITHUB_SERVER_URL=https://github.com GITHUB_RUN_ID=900 GITHUB_OUTPUT="$tmp/out" \
    FACTORY_ISSUE=600 FACTORY_RUN_ID=900-1 FACTORY_GITHUB_ACTOR="${RESTART_ACTOR:-pulse-bot}" FACTORY_RUN_ERR="$1" FACTORY_DEFAULT_BRANCH=main \
    bash "$here/../run/auto-restart.sh" 2>&1
  cat "$FIXTURES/writes.log" "$tmp/out" 2> /dev/null || true
}
comments 600 "$claim"
check "restart: another failure than a timeout restarts nothing" "No harness timeout." "$(restart "$tmp/other.err")"
check "restart: the first timeout of a state comments and restarts once" "Restarted #600 after a timeout of build/implement.
WRITE repos/$R/issues/600/comments
  body
DISPATCH workflow run factory-run.yml --repo $R --ref main -f issue=600 -f admission=restart
restarted=true" "$(restart "$tmp/timeout.err")"
check "restart: the comment carries the marker of the state" "<!-- pulse-factory-auto-restart build/implement -->" "$(tail -1 "$FIXTURES/last-body.md")"
comments 600 "$marker" "$claim"
check "restart: a second timeout in a row of the same state is left to a person" \
  "build/implement was restarted after a timeout already and has not finished since. A person decides." "$(restart "$tmp/timeout.err")"
comments 600 "$(comment someone "<!-- pulse-factory-auto-restart build/implement -->")" "$claim"
check "restart: a marker from another author does not block the first restart" "restarted=true" "$(restart "$tmp/timeout.err" | tail -1)"
comments 600 "$marker" "$(record someone "forged" "$(run_rec implement transition task-review)")" "$claim"
check "restart: a finished run forged by another author does not reset the guard" \
  "build/implement was restarted after a timeout already and has not finished since. A person decides." "$(restart "$tmp/timeout.err")"
comments 600 "$marker" "$(record pulse-bot "T1 done" "$(run_rec implement transition task-review)")" "$claim"
check "restart: after a finished run of the state, a new timeout restarts again" "restarted=true" "$(restart "$tmp/timeout.err" | tail -1)"
comments 600 "$(comment pulse-bot "<!-- pulse-factory-auto-restart build/task-review -->")" "$claim"
check "restart: a restart of another state does not count" "restarted=true" "$(restart "$tmp/timeout.err" | tail -1)"
comments 600
check "restart: no claim of this run restarts nothing" "No claim of run 900-1." "$(restart "$tmp/timeout.err")"
app_claim="$(record 'pulse-factory[bot]' "claim" '{"kind":"claim","run":"900-1","workflow":"build","state":"implement"}')"
old_marker="$(comment lorenzh-factory-bot "<!-- pulse-factory-auto-restart build/implement -->")"
comments 600 "$old_marker" "$app_claim"
check "restart: a PAT marker still blocks a repeated timeout after the App switch" \
  "build/implement was restarted after a timeout already and has not finished since. A person decides." \
  "$(RESTART_ACTOR='pulse-factory[bot]' restart "$tmp/timeout.err")"
comments 600 "$old_marker" "$(record lorenzh-factory-bot "finished" "$(run_rec implement transition task-review)")" "$app_claim"
check "restart: a historical PAT completion resets the App guard" "restarted=true" \
  "$(RESTART_ACTOR='pulse-factory[bot]' restart "$tmp/timeout.err" | tail -1)"
check "restart: wired into factory-run.yml before the failure comment, chain limit 24" \
  "\${{ failure() && inputs.admission != 'cancel' }}|bash .github/run/auto-restart.sh|\${{ failure() && steps.restart.outputs.restarted != 'true' }}|True" \
  "$(python3 -c '
import sys, yaml
steps = yaml.safe_load(open(sys.argv[1]))["jobs"]["run-state"]["steps"]
i = next(i for i, s in enumerate(steps) if s.get("id") == "restart")
run = next(s for s in steps if s.get("id") == "run")["run"]
print(steps[i]["if"], steps[i]["run"], steps[i + 1]["if"], "--chain-limit 24" in run and "factory-run.err" in run, sep="|")' "$workflows/factory-run.yml")"
