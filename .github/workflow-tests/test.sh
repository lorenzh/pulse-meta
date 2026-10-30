#!/usr/bin/env bash
# Runs the scripts of factory-sweep.yml and factory-security-audit.yml against fixtures, with a
# stub `gh` that serves canned API answers and records every write. Needs bash, jq, and python3
# with PyYAML. Usage: .github/workflow-tests/test.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
workflows="$here/../workflows"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin"
fail=0

step_script() { # <workflow file> <job> -> the run script of the job's first step
  python3 -c 'import sys, yaml; print(yaml.safe_load(open(sys.argv[1]))["jobs"][sys.argv[2]]["steps"][0]["run"])' "$1" "$2"
}

# Stub gh: `gh api [--paginate] <url> [--jq <expr>] [-f k=v ...]`. A read returns
# $FIXTURES/<key>.json (each page file <key>.<n>.json for --paginate); a write is logged.
cat > "$tmp/bin/gh" <<'STUB'
#!/usr/bin/env bash
shift # api
paginate=false; [[ "$1" == --paginate ]] && { paginate=true; shift; }
url="$1"; shift
jq_expr="."; writes=()
while (($#)); do
  case "$1" in
    --jq) jq_expr="$2"; shift 2 ;;
    -f) writes+=("$2"); shift 2 ;;
    *) shift ;;
  esac
done
key="$(printf '%s' "$url" | tr -c 'A-Za-z0-9=_.-' '_')"
if ((${#writes[@]})); then
  { echo "WRITE $url"; for w in "${writes[@]}"; do echo "  ${w%%=*}"; done; } >> "$FIXTURES/writes.log"
  [[ "$jq_expr" == .html_url ]] && echo "https://example.test/new-issue"
  exit 0
fi
files=("$FIXTURES/$key.json")
$paginate && files=("$FIXTURES/$key".[0-9].json)
[[ -e "${files[0]}" ]] || { echo "[]" > "$FIXTURES/empty.json"; files=("$FIXTURES/empty.json"); }
for f in "${files[@]}"; do jq -r "$jq_expr" "$f"; done
STUB
chmod +x "$tmp/bin/gh"
key() { printf '%s' "$1" | tr -c 'A-Za-z0-9=_.-' '_'; }

check() { # <name> <expected> <actual>
  if [[ "$2" == "$3" ]]; then echo "ok   $1"; else
    echo "FAIL $1"; diff <(printf '%s\n' "$2") <(printf '%s\n' "$3") | sed 's/^/     /'; fail=1; fi
}

# --- factory-sweep.yml --------------------------------------------------------------------------
export FIXTURES="$tmp/sweep"; mkdir -p "$FIXTURES"
R=lorenzh/pulse-meta
runs="repos/$R/actions/workflows/factory-run.yml/runs"
cat > "$FIXTURES/$(key "repos/$R/issues?state=open&per_page=100").json" <<'JSON'
[
 {"number":1,"updated_at":"2026-10-30T10:00:00Z","comments":3,"issue_dependencies_summary":{"blocked_by":0},"labels":[{"name":"target/api"},{"name":"factory/build/review"}]},
 {"number":2,"updated_at":"2026-10-30T10:00:00Z","comments":2,"issue_dependencies_summary":{"blocked_by":0},"labels":[{"name":"factory/build/implement"}]},
 {"number":3,"updated_at":"2026-10-30T10:00:00Z","comments":1,"issue_dependencies_summary":{"blocked_by":1},"labels":[{"name":"factory/build/implement"}]},
 {"number":4,"updated_at":"2026-10-30T10:00:00Z","comments":1,"issue_dependencies_summary":{"blocked_by":0},"labels":[{"name":"factory/build/implement"},{"name":"factory/build/status/needs-input"}]},
 {"number":5,"updated_at":"2026-10-30T10:00:00Z","comments":1,"issue_dependencies_summary":{"blocked_by":0},"labels":[{"name":"factory/complete"}]},
 {"number":6,"updated_at":"2099-01-01T00:00:00Z","comments":1,"issue_dependencies_summary":{"blocked_by":0},"labels":[{"name":"factory/build/implement"}]},
 {"number":7,"updated_at":"2026-10-30T10:00:00Z","comments":4,"issue_dependencies_summary":{"blocked_by":0},"labels":[{"name":"factory/spec/plan"}]},
 {"number":8,"pull_request":{"url":"x"},"updated_at":"2026-10-30T10:00:00Z","comments":0,"labels":[{"name":"factory/build/implement"}]},
 {"number":9,"updated_at":"2026-10-30T10:00:00Z","comments":0,"issue_dependencies_summary":{"blocked_by":0},"labels":[{"name":"factory/merge/resolve"},{"name":"factory/complete"}]},
 {"number":10,"updated_at":"2026-10-30T10:00:00Z","comments":2,"issue_dependencies_summary":{"blocked_by":0},"labels":[{"name":"factory/build/security"}]},
 {"number":11,"updated_at":"2026-10-30T10:00:00Z","comments":1,"issue_dependencies_summary":{"blocked_by":0},"labels":[{"name":"factory/build/implement"}]}
]
JSON
# #2 runs now. #10 has an old queued run on the second page of queued runs. #11 waits for approval.
echo '{"workflow_runs":[{"display_title":"Factory run #2 label"}]}' > "$FIXTURES/$(key "$runs?status=in_progress&per_page=100").0.json"
echo '{"workflow_runs":[{"display_title":"Factory run #12 label"}]}' > "$FIXTURES/$(key "$runs?status=queued&per_page=100").0.json"
echo '{"workflow_runs":[{"display_title":"Factory run #10 continuation"}]}' > "$FIXTURES/$(key "$runs?status=queued&per_page=100").1.json"
echo '{"workflow_runs":[{"display_title":"Factory run #11 restart"}]}' > "$FIXTURES/$(key "$runs?status=waiting&per_page=100").0.json"
# The newest 100 runs, as the unfiltered list returns them: #10's old queued run is not among them.
echo '{"workflow_runs":[{"status":"in_progress","display_title":"Factory run #2 label"},{"status":"completed","display_title":"Factory run #10 label"}]}' \
  > "$FIXTURES/$(key "$runs?per_page=100").json"
for status in requested pending; do
  echo '{"total_count":0,"workflow_runs":[]}' > "$FIXTURES/$(key "$runs?status=$status&per_page=100").0.json"
done
echo '[{"body":"Factory ran build/implement."}]' > "$FIXTURES/$(key "repos/$R/issues/1/comments?per_page=1&page=3").json"
printf '%s\n' '[{"body":"stalled\n<!-- pulse-factory-alert -->"}]' > "$FIXTURES/$(key "repos/$R/issues/7/comments?per_page=1&page=4").json"

out="$(PATH="$tmp/bin:$PATH" GITHUB_REPOSITORY=$R GITHUB_SERVER_URL=https://github.com FACTORY_STALL_MINUTES=60 \
  bash -e <(step_script "$workflows/factory-sweep.yml" sweep))"
check "sweep: reports only stalled issues without an active run" "#1: reported (factory/build/review since 2026-10-30T10:00:00Z).
#2: a run is active.
#7: already reported.
#9: reported (factory/merge/resolve since 2026-10-30T10:00:00Z).
#10: a run is active.
#11: a run is active." "$out"
check "sweep: writes one comment per reported issue" "WRITE repos/$R/issues/1/comments
  body
WRITE repos/$R/issues/9/comments
  body" "$(cat "$FIXTURES/writes.log")"

# --- factory-security-audit.yml -----------------------------------------------------------------
audit() { # <target input> -> output; writes go to $FIXTURES/writes.log
  PATH="$tmp/bin:$PATH" GITHUB_REPOSITORY=$R AUDIT_TARGET="$1" \
    bash -e <(step_script "$workflows/factory-security-audit.yml" open-issue) 2>&1
}
export FIXTURES="$tmp/audit"; mkdir -p "$FIXTURES"
echo '[{"number":50,"title":"Security audit: pulse-probe (2026-10-26)"}]' \
  > "$FIXTURES/$(key "repos/$R/issues?state=open&labels=security,target/probe&per_page=100").json"
echo '[{"number":51,"title":"Probe leaks a header","pull_request":null}]' \
  > "$FIXTURES/$(key "repos/$R/issues?state=open&labels=security,target/api&per_page=100").json"

check "audit: an open audit issue blocks a second one" "#50 is still open for probe. No new issue." "$(audit probe)"
check "audit: another security issue does not block" "Opened https://example.test/new-issue" "$(audit api)"
check "audit: the issue gets title, body, and both labels" "WRITE repos/$R/issues
  title
  body
  labels[]
  labels[]" "$(cat "$FIXTURES/writes.log")"
check "audit: an unknown target fails" "::error::Unknown target: nope" "$(audit nope || true)"
week="$(date -u +%V)"; targets=(contract probe api status notify config kit website)
expected="${targets[$((10#$week % 8))]}"
rm -f "$FIXTURES/writes.log"
out="$(audit "")"
[[ "$expected" == probe ]] && want="#50 is still open for probe. No new issue." || want="Opened https://example.test/new-issue"
check "audit: rotation picks $expected in ISO week $week" "$want" "$out"
rm -f "$FIXTURES/writes.log"
check "audit: the dispatch input rotation picks the same target" "$want" "$(audit rotation)"

exit "$fail"
