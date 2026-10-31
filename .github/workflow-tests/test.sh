#!/usr/bin/env bash
# Runs the script of factory-sweep.yml, .github/audits/open-issue.sh (factory-audit.yml) and the
# scripts of the Factory report (.github/report/*.sh) against fixtures, with a stub `gh` that serves
# canned API answers and records every write. Needs bash, jq, git, node, and python3 with PyYAML.
# Usage: .github/workflow-tests/test.sh
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
# $FIXTURES/<key>.json (each page file <key>.<n>.json for --paginate); a write is logged and answers
# with $FIXTURES/created.json. `gh workflow run ...` is logged as DISPATCH.
cat > "$tmp/bin/gh" <<'STUB'
#!/usr/bin/env bash
[[ "$1" == workflow ]] && { echo "DISPATCH $*" >> "$FIXTURES/writes.log"; exit 0; }
shift # api
method=""; [[ "$1" == -X ]] && { method="$2"; shift 2; }
paginate=false; [[ "$1" == --paginate ]] && { paginate=true; shift; }
url="$1"; shift
jq_expr="."; writes=()
while (($#)); do
  case "$1" in
    --jq) jq_expr="$2"; shift 2 ;;
    -f) writes+=("$2"); shift 2 ;;
    --silent) jq_expr=empty; shift ;;
    *) shift ;;
  esac
done
key="$(printf '%s' "$url" | tr -c 'A-Za-z0-9=_.-' '_')"
if ((${#writes[@]})); then
  # Log each field; a body is logged by name only and kept in last-body.md.
  { echo "WRITE $url"; [[ -z "$method" ]] || echo "  -X $method"; for w in "${writes[@]}"; do
      if [[ "$w" == body=* ]]; then echo "  body"; printf '%s' "${w#body=}" > "$FIXTURES/last-body.md"; else echo "  $w"; fi
    done; } >> "$FIXTURES/writes.log"
  if [[ "$jq_expr" != empty && -e "$FIXTURES/created.json" ]]; then jq -r "$jq_expr" "$FIXTURES/created.json"; fi
  exit 0
fi
files=("$FIXTURES/$key.json")
$paginate && files=("$FIXTURES/$key".[0-9].json)
if [[ ! -e "${files[0]}" ]]; then
  # A missing single label is a 404; a missing list is empty.
  [[ "$url" == */labels/* ]] && { echo "gh: Not Found (HTTP 404)" >&2; exit 1; }
  echo "[]" > "$FIXTURES/empty.json"; files=("$FIXTURES/empty.json")
fi
for f in "${files[@]}"; do [[ "$jq_expr" == empty ]] || jq -r "$jq_expr" "$f"; done
STUB
chmod +x "$tmp/bin/gh"
key() { printf '%s' "$1" | tr -c 'A-Za-z0-9=_.-' '_'; }

check() { # <name> <expected> <actual>
  if [[ "$2" == "$3" ]]; then echo "ok   $1"; else
    # diff exits 1 on a difference; keep going so that every check reports.
    echo "FAIL $1"; diff <(printf '%s\n' "$2") <(printf '%s\n' "$3") | sed 's/^/     /' || true; fail=1; fi
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

# --- factory-audit.yml (.github/audits/open-issue.sh) ---------------------------------------------
audit() { # <kind input> <target input> <schedule> <today> -> output; writes go to $FIXTURES/writes.log
  rm -f "$FIXTURES/writes.log" "$FIXTURES/last-body.md"
  PATH="$tmp/bin:$PATH" GITHUB_REPOSITORY=$R AUDIT_KIND="$1" AUDIT_TARGET="$2" AUDIT_SCHEDULE="$3" \
    AUDIT_TODAY="$4" bash "$here/../audits/open-issue.sh" 2>&1
}
writes() { cat "$FIXTURES/writes.log" 2> /dev/null || true; }
open_issues() { # <labels> <page 1 json> [<page 2 json>]: a plain read sees page 1 only
  local k; k="$(key "repos/$R/issues?state=open&labels=$1&per_page=100")"
  echo "$2" > "$FIXTURES/$k.json"; echo "$2" > "$FIXTURES/$k.0.json"
  [[ -z "${3:-}" ]] || echo "$3" > "$FIXTURES/$k.1.json"
}
export FIXTURES="$tmp/audit"; mkdir -p "$FIXTURES"
echo '{"number":77,"html_url":"https://example.test/new-issue"}' > "$FIXTURES/created.json"
echo '{"default_branch":"main"}' > "$FIXTURES/$(key "repos/$R").json"
for label in security performance; do echo "{\"name\":\"$label\"}" > "$FIXTURES/$(key "repos/$R/labels/$label").json"; done
# Every audit/<repo> label exists except audit/deploy, which the first run creates.
for t in contract probe api status notify config kit website console; do echo "{\"name\":\"audit/$t\"}" > "$FIXTURES/$(key "repos/$R/labels/audit%2F$t").json"; done
open_issues security,audit/probe '[{"number":50,"title":"Security audit: pulse-probe (2026-10-26)"}]'
open_issues security,audit/api '[{"number":51,"title":"Probe leaks a header","pull_request":null}]'
open_issues performance,audit/api '[{"number":52,"title":"Performance audit: pulse-api (2026-10-07)"}]'
# The old target/<repo> label no longer counts: the audit runs on the meta target.
open_issues security,target/status '[{"number":53,"title":"Security audit: pulse-status (2026-10-20)"}]'
DAILY='17 6 * * *' TUEFRI='17 6 * * 2,5' THU='17 6 * * 4' MON='17 6 * * 1'

# Security, daily: 2026-11-02 is day 20759 since 1970-01-01; 20759 % 10 = 9 -> deploy.
# 2026-11-03 is day 20760; 20760 % 10 = 0 -> contract.
check "security: the daily schedule rotates by day, creating a missing audit/<repo> label" "Created the label audit/deploy.
Opened https://example.test/new-issue
Started the audit run of #77." "$(audit "" "" "$DAILY" 2026-11-02)"
check "security: title, factory/audit/audit and audit/<repo> labels, no target/<repo>, then the dispatch" "WRITE repos/$R/labels
  name=audit/deploy
  color=c5def5
  description=Audit of lorenzh/pulse-deploy, run on the meta target
WRITE repos/$R/issues
  title=Security audit: pulse-deploy (2026-11-02)
  body
  labels[]=security
  labels[]=factory/audit/audit
  labels[]=audit/deploy
DISPATCH workflow run factory-run.yml --repo $R --ref main -f issue=77 -f admission=label" "$(writes)"
check "security: the issue text names the repository" "Periodic security audit of \`main\` in [pulse-deploy](https://github.com/lorenzh/pulse-deploy). Opened by \`factory-audit.yml\`, which starts the \`audit\` workflow at once (label \`factory/audit/audit\`). To stop it, cancel its \`Factory run\` workflow run and remove the \`factory/audit/\` label." "$(head -1 "$FIXTURES/last-body.md")"
check "security: no placeholder is left" "0" "$(grep -c '{repo}' "$FIXTURES/last-body.md" || true)"
audit "" "" "$DAILY" 2026-11-03 > /dev/null
check "security: the next day takes the next repository" "  title=Security audit: pulse-contract (2026-11-03)" "$(grep title= "$FIXTURES/writes.log")"
audit security rotation "" 2026-11-03 > /dev/null
check "security: dispatch rotation picks the same target" "  title=Security audit: pulse-contract (2026-11-03)" "$(grep title= "$FIXTURES/writes.log")"
check "security: an open audit issue blocks a second one" "#50 is still open for probe. No new issue." "$(audit security probe "" 2026-11-02)"
check "security: another security issue does not block" "Opened https://example.test/new-issue
Started the audit run of #77." "$(audit security api "" 2026-11-02)"
check "security: an open issue with only target/<repo> does not block" "Opened https://example.test/new-issue
Started the audit run of #77." "$(audit security status "" 2026-11-02)"
audit security probe "" 2026-11-02 > /dev/null; hit="$(writes | grep -c DISPATCH || true)"
audit security api "" 2026-11-02 > /dev/null; miss="$(writes | grep -c DISPATCH || true)"
check "security: a dedupe hit writes nothing and starts nothing; a new issue starts one run" "0 0 1" \
  "$(audit security probe "" 2026-11-02 > /dev/null; writes | wc -l) $hit $miss"
echo '{"number":"077","html_url":"https://example.test/new-issue"}' > "$FIXTURES/created.json"
check "security: a non-canonical issue number fails before the dispatch" "Opened https://example.test/new-issue
::error::Not a canonical issue number: 077
no dispatch" "$(audit security api "" 2026-11-02 || true; writes | grep -q DISPATCH && echo dispatch || echo no dispatch)"
echo '{"number":77,"html_url":"https://example.test/new-issue"}' > "$FIXTURES/created.json"
check "security: an unknown target fails" "::error::Unknown target: nope" "$(audit security nope "" 2026-11-02 || true)"

# Performance, Tuesday and Friday: slot = 2 * week + (Friday or later), week = (day + 3) / 7.
# Tue 2026-11-03: week 2966, slot 5932 % 8 = 4 -> notify. Fri 2026-11-06: 5933 % 8 = 5 -> kit.
# Tue 2026-11-10: week 2967, slot 5934 % 8 = 6 -> website. (config is not in the list.)
audit "" "" "$TUEFRI" 2026-11-03 > /dev/null
check "performance: Tuesday, title and labels, no new label" "WRITE repos/$R/issues
  title=Performance audit: pulse-notify (2026-11-03)
  body
  labels[]=performance
  labels[]=factory/audit/audit
  labels[]=audit/notify
DISPATCH workflow run factory-run.yml --repo $R --ref main -f issue=77 -f admission=label" "$(writes)"
audit "" "" "$TUEFRI" 2026-11-06 > /dev/null
check "performance: Friday takes the next repository" "  title=Performance audit: pulse-kit (2026-11-06)" "$(grep title= "$FIXTURES/writes.log")"
audit "" "" "$TUEFRI" 2026-11-10 > /dev/null
check "performance: the next Tuesday takes the one after" "  title=Performance audit: pulse-website (2026-11-10)" "$(grep title= "$FIXTURES/writes.log")"
check "performance: an open performance audit of the repository blocks" "#52 is still open for api. No new issue." "$(audit performance api "" 2026-11-03)"
check "performance: an open security audit does not block" "Opened https://example.test/new-issue
Started the audit run of #77." "$(audit performance probe "" 2026-11-03)"
check "performance: config is not a performance target" "::error::Unknown target: config" "$(audit performance config "" 2026-11-03 || true)"
check "performance: deploy is not a performance target" "::error::Unknown target: deploy" "$(audit performance deploy "" 2026-11-03 || true)"

# Quality, Monday: slot = week, week = (day + 3) / 7, over the security list.
# Mon 2026-11-02: week 2966 % 10 = 6 -> kit. Mon 2026-11-09: 2967 % 10 = 7 -> website.
check "quality: the Monday schedule creates the label and the issue" "Created the label quality.
Opened https://example.test/new-issue
Started the audit run of #77." "$(audit "" "" "$MON" 2026-11-02)"
check "quality: label with description, title and labels, then the dispatch" "WRITE repos/$R/labels
  name=quality
  color=0e8a16
  description=Code quality: lint, complexity, duplication, dead code, tests, error handling
WRITE repos/$R/issues
  title=Quality audit: pulse-kit (2026-11-02)
  body
  labels[]=quality
  labels[]=factory/audit/audit
  labels[]=audit/kit
DISPATCH workflow run factory-run.yml --repo $R --ref main -f issue=77 -f admission=label" "$(writes)"
check "quality: the issue text names the repository and the report" "0 1" \
  "$(grep -c '{repo}' "$FIXTURES/last-body.md" || true) $(grep -c 'audits/quality/kit\.md' "$FIXTURES/last-body.md" || true)"
audit "" "" "$MON" 2026-11-09 > /dev/null
check "quality: the next Monday takes the next repository" "  title=Quality audit: pulse-website (2026-11-09)" "$(grep title= "$FIXTURES/writes.log")"
audit quality rotation "" 2026-11-05 > /dev/null
check "quality: dispatch rotation picks the week's target" "  title=Quality audit: pulse-kit (2026-11-05)" "$(grep title= "$FIXTURES/writes.log")"
audit quality config "" 2026-11-02 > /dev/null
check "quality: config is a quality target" "  title=Quality audit: pulse-config (2026-11-02)" "$(grep title= "$FIXTURES/writes.log")"
open_issues quality,audit/api '[{"number":54,"title":"Quality audit: pulse-api (2026-10-26)"}]'
check "quality: an open quality audit of the repository blocks" "#54 is still open for api. No new issue." "$(audit quality api "" 2026-11-02)"
check "quality: an open security or performance audit does not block" "Created the label quality.
Opened https://example.test/new-issue
Started the audit run of #77." "$(audit quality probe "" 2026-11-02)"

for k in security performance architecture quality; do
  check "$k: the issue text names the start label and the report, not one issue per finding" "1 1 0" \
    "$(grep -c 'factory/audit/audit' "$here/../audits/$k.md" || true) $(grep -c "audits/$k/" "$here/../audits/$k.md" || true) $(grep -c 'becomes its own issue' "$here/../audits/$k.md" || true)"
done

# Every cron line of the workflow maps to a kind in the script.
crons="$(python3 -c 'import sys, yaml; w = yaml.safe_load(open(sys.argv[1])); print("\n".join(c["cron"] for c in w[True]["schedule"]))' "$workflows/factory-audit.yml")"
kinds=""
while read -r cron; do
  audit "" "" "$cron" 2026-11-05 > /dev/null || true
  kinds+="$(writes | sed -n 's/^  labels\[\]=\([a-z]*\)$/\1/p' | head -1) "
done <<< "$crons"
check "schedule: the workflow's cron lines map to security, performance, architecture, quality" "security performance architecture quality " "$kinds"
# Scheduled and manual runs of one kind share one concurrency group, so they cannot both pass the
# dedupe. The group expression is evaluated with Python (|| -> or, && -> and).
groups="$(python3 - "$workflows/factory-audit.yml" "$crons" <<'PY'
import re, sys, yaml
w = yaml.safe_load(open(sys.argv[1]))
expr = re.fullmatch(r"factory-audit-\$\{\{(.*)\}\}", w["concurrency"]["group"]).group(1)
py = expr.replace("||", " or ").replace("&&", " and ").replace("inputs.kind", "kind").replace("github.event.schedule", "schedule")
group = lambda kind, schedule: "factory-audit-" + str(eval(py, {"__builtins__": {}}, {"kind": kind, "schedule": schedule}))
for cron in sys.argv[2].splitlines():
    print(group("", cron))
for kind in ("security", "performance", "architecture", "quality"):
    print(group(kind, ""))
PY
)"
check "concurrency: scheduled runs use the group of their kind" "factory-audit-security
factory-audit-performance
factory-audit-architecture
factory-audit-quality
factory-audit-security
factory-audit-performance
factory-audit-architecture
factory-audit-quality" "$groups"
# The job token dispatches factory-run.yml, so the job needs actions: write; nothing more.
check "permissions: the audit job may dispatch workflows" "{'actions': 'write', 'contents': 'read', 'issues': 'write'}" \
  "$(python3 -c 'import sys, yaml; print(dict(sorted(yaml.safe_load(open(sys.argv[1]))["jobs"]["open-issue"]["permissions"].items())))' "$workflows/factory-audit.yml")"
check "schedule: an unknown cron fails" "::error::No audit kind for the schedule '0 0 * * *'." "$(audit "" "" '0 0 * * *' 2026-11-11 || true)"
check "dispatch: an unknown kind fails" "::error::Unknown audit kind: style" "$(audit style "" "" 2026-11-11 || true)"

# Architecture, Thursday 2026-11-05: one issue, no target label; the label is created.
check "architecture: the Thursday schedule creates the label and the issue" "Created the label architecture.
Opened https://example.test/new-issue
Started the audit run of #77." "$(audit "" "" "$THU" 2026-11-05)"
check "architecture: label with description, issue without a target label" "WRITE repos/$R/labels
  name=architecture
  color=5319e7
  description=Structure across repositories: pins, size, duplication, docs, dependency direction
WRITE repos/$R/issues
  title=Architecture audit: pulse (2026-11-05)
  body
  labels[]=architecture
  labels[]=factory/audit/audit
DISPATCH workflow run factory-run.yml --repo $R --ref main -f issue=77 -f admission=label" "$(writes)"
echo '{"name":"architecture"}' > "$FIXTURES/$(key "repos/$R/labels/architecture").json"
check "architecture: a dispatch target is ignored" "::notice::The architecture audit covers the whole system; target api is ignored.
Opened https://example.test/new-issue
Started the audit run of #77." "$(audit architecture api "" 2026-11-05)"
# 100 other architecture issues fill page 1; the open audit is on page 2.
page1="$(python3 -c 'import json; print(json.dumps([{"number": 200 + i, "title": "Split the probe scheduler"} for i in range(100)]))')"
open_issues architecture "$page1" '[{"number":60,"title":"Architecture audit: pulse (2026-10-21)"}]'
check "architecture: an open audit on page 2 blocks" "#60 is still open for the whole system. No new issue." "$(audit architecture "" "" 2026-11-05)"
open_issues architecture '[{"number":60,"title":"Architecture audit: pulse (2026-10-21)"}]'
check "architecture: an open architecture audit blocks" "#60 is still open for the whole system. No new issue." "$(audit architecture "" "" 2026-11-05)"

# --- factory-report-open.yml (.github/report/open-issue.sh) ---------------------------------------
export FIXTURES="$tmp/report"; mkdir -p "$FIXTURES"
echo '{"number":77,"html_url":"https://example.test/new-issue"}' > "$FIXTURES/created.json"
echo '{"default_branch":"main"}' > "$FIXTURES/$(key "repos/$R").json"
A=$(printf 'a%.0s' {1..64}) B=$(printf 'b%.0s' {1..64})
echo "{\"meta\":{\"fingerprint\":\"$A\",\"as_of\":\"2026-11-02T05:41:00.000Z\",\"previous_as_of\":\"2026-11-01T05:41:00.000Z\"}}" > "$tmp/new.json"
echo "{\"meta\":{\"fingerprint\":\"$B\"}}" > "$tmp/prev.json"
echo "{\"meta\":{\"fingerprint\":\"$A\"}}" > "$tmp/same.json"
report() { # <previous data.json> [<new data.json>] -> output; writes go to $FIXTURES/writes.log
  rm -f "$FIXTURES/writes.log" "$FIXTURES/last-body.md"
  PATH="$tmp/bin:$PATH" GITHUB_REPOSITORY=$R REPORT_DATA="${2:-$tmp/new.json}" REPORT_PREVIOUS="$1" REPORT_RUN_ID=4242 \
    REPORT_TODAY=2026-11-02 bash "$here/../report/open-issue.sh" 2>&1
}
report_open() { # <page 1 json> [<page 2 json>]: the open report issues, as --paginate reads them
  local k; k="$(key "repos/$R/issues?state=open&labels=report&per_page=100")"
  echo "$1" > "$FIXTURES/$k.0.json"
  if [[ -n "${2:-}" ]]; then echo "$2" > "$FIXTURES/$k.1.json"; else echo '[]' > "$FIXTURES/$k.1.json"; fi
}
report_open '[]'
check "report: unchanged numbers open nothing and start nothing" "The numbers have not changed since the last merged report ($A). No new issue." "$(report "$tmp/same.json"; writes)"
check "report: changed numbers create the label, open the issue and start the run" "Created the label report.
Opened https://example.test/new-issue
Started the report run of #77." "$(report "$tmp/prev.json")"
check "report: label, title, start label, then the dispatch" "WRITE repos/$R/labels
  name=report
  color=1d76db
  description=Factory report of pulse; its runs stay out of the report numbers
WRITE repos/$R/issues
  title=Factory report: pulse (2026-11-02)
  body
  labels[]=report
  labels[]=factory/report/report
DISPATCH workflow run factory-run.yml --repo $R --ref main -f issue=77 -f admission=label" "$(writes)"
check "report: the issue body names as-of, run, data hash and fingerprint, no placeholder left" "as-of: 2026-11-02T05:41:00.000Z
data-run: 4242
data-sha256: $(sha256sum "$tmp/new.json" | cut -d' ' -f1)
fingerprint: $A
previous-as-of: 2026-11-01T05:41:00.000Z
0" "$(grep -E '^(as-of|data-run|data-sha256|fingerprint|previous-as-of): ' "$FIXTURES/last-body.md"; grep -c '{[a-z_]*}' "$FIXTURES/last-body.md" || true)"
echo '{"name":"report"}' > "$FIXTURES/$(key "repos/$R/labels/report").json"
check "report: without a merged report the first one opens" "Opened https://example.test/new-issue
Started the report run of #77." "$(report "$tmp/missing.json")"
page1="$(python3 -c 'import json; print(json.dumps([{"number": 300 + i, "title": "Report a broken probe"} for i in range(100)]))')"
report_open "$page1" '[{"number":61,"title":"Factory report: pulse (2026-11-01)"}]'
check "report: an open report issue on page 2 blocks and writes nothing" "#61 is still open. No new issue." "$(report "$tmp/prev.json"; writes)"
report_open '[{"number":62,"title":"Factory report: pulse (2026-11-01)","pull_request":{"url":"x"}}]'
check "report: a pull request with the title does not block" "Opened https://example.test/new-issue
Started the report run of #77." "$(report "$tmp/prev.json")"
echo '{"number":"077","html_url":"https://example.test/new-issue"}' > "$FIXTURES/created.json"
check "report: a non-canonical issue number fails before the dispatch" "Opened https://example.test/new-issue
::error::Not a canonical issue number: 077
no dispatch" "$(report "$tmp/prev.json" || true; writes | grep -q DISPATCH && echo dispatch || echo no dispatch)"
echo '{"number":77,"html_url":"https://example.test/new-issue"}' > "$FIXTURES/created.json"
echo '{"meta":{}}' > "$tmp/nofp.json"
check "report: data without a fingerprint fails" "::error::$tmp/nofp.json has no fingerprint." "$(report "$tmp/prev.json" "$tmp/nofp.json" || true)"
check "permissions: the report opener may dispatch workflows" "{'actions': 'write', 'contents': 'read', 'issues': 'write'}" \
  "$(python3 -c 'import sys, yaml; print(dict(sorted(yaml.safe_load(open(sys.argv[1]))["jobs"]["open-issue"]["permissions"].items())))' "$workflows/factory-report-open.yml")"
# The artifact the opener uploads is the one the report prompt downloads, and the build compares
# against the merged report.
opener_py='
import re, sys, yaml
w = yaml.safe_load(open(sys.argv[1]))
steps = w["jobs"]["open-issue"]["steps"]
upload = next(s for s in steps if s.get("uses", "").startswith("actions/upload-artifact@"))
build = next(s for s in steps if s.get("name") == "Build the report data")
opener = next(s for s in steps if s.get("name") == "Open the report issue")
prompt = re.search(r"--name (\S+)", open(sys.argv[2]).read()).group(1)
print(upload["with"]["name"], prompt, build["run"].split("--previous ")[1], opener["env"]["REPORT_PREVIOUS"], [c["cron"] for c in w[True]["schedule"]])
'
check "report: artifact name, previous data and schedule" "report-data report-data report/data.json report/data.json ['41 5 * * *']" \
  "$(python3 -c "$opener_py" "$workflows/factory-report-open.yml" "$here/../../.factory/prompts/report.md")"

# --- factory-report.yml (.github/report/close-issue.sh) ---------------------------------------------
close() { # <narrative json> -> output; writes go to $FIXTURES/writes.log
  rm -f "$FIXTURES/writes.log"; echo "$1" > "$tmp/narrative.json"
  PATH="$tmp/bin:$PATH" GITHUB_REPOSITORY=$R REPORT_NARRATIVE="$tmp/narrative.json" REPORT_URL=https://example.test/report \
    bash "$here/../report/close-issue.sh" 2>&1
}
echo '{"number":77,"state":"open","labels":[{"name":"report"},{"name":"factory/complete"}]}' > "$FIXTURES/$(key "repos/$R/issues/77").json"
echo '{"number":78,"state":"closed","labels":[{"name":"report"}]}' > "$FIXTURES/$(key "repos/$R/issues/78").json"
echo '{"number":79,"state":"open","labels":[{"name":"bug"}]}' > "$FIXTURES/$(key "repos/$R/issues/79").json"
check "close: the deploy closes the open report issue of the narrative" "Closed #77.
WRITE repos/$R/issues/77/comments
  body
WRITE repos/$R/issues/77
  -X PATCH
  state=closed
  state_reason=completed" "$(close '{"issue":77}'; writes)"
check "close: a closed report issue stays as it is" "#78 is closed. Nothing to close." "$(close '{"issue":78}'; writes)"
check "close: an issue without the label report stays open" "#79 is open, without the label report. Nothing to close." "$(close '{"issue":79}'; writes)"
check "close: a report without an issue closes nothing" "The report names no issue. Nothing to close." "$(close '{"issue":null}'; writes)"
check "close: only after a push, after the deploy, with issues: write" "\${{ github.event_name == 'push' }} deploy {'contents': 'read', 'issues': 'write'}" \
  "$(python3 -c 'import sys, yaml; j = yaml.safe_load(open(sys.argv[1]))["jobs"]["close-issue"]; print(j["if"], j["needs"], dict(sorted(j["permissions"].items())))' "$workflows/factory-report.yml")"
check "deploy: no schedule and no live data" "False False" \
  "$(python3 -c 'import sys, yaml; w = yaml.safe_load(open(sys.argv[1])); t = open(sys.argv[1]).read(); print("schedule" in w[True], "data.mjs" in t)' "$workflows/factory-report.yml")"

# --- report-check.yml (.github/report/check-pr.sh) ---------------------------------------------------
# A small repository: the base commit holds the report; each case is a branch on top of it.
repo="$tmp/repo"; mkdir -p "$repo/report"
cp "$here/../../report/"{check.mjs,data.json,narrative.json,index.html} "$repo/report/"
g() { git -C "$repo" -c user.name=t -c user.email=t@t "$@"; }
g init -q -b main && g add -A && g commit -qm base
base="$(g rev-parse HEAD)"
data_sha="$(sha256sum "$repo/report/data.json" | cut -d' ' -f1)"; as_of="$(jq -r .meta.as_of "$repo/report/data.json")"
jq -n --arg b "as-of: $as_of
data-sha256: $data_sha" '{body: $b}' > "$FIXTURES/$(key "repos/$R/issues/77").json"
prcheck() { # <branch> <change command> -> last line of the check output
  g checkout -q -B "$1" "$base"; (cd "$repo" && eval "$2"); g commit -qam "$1" --allow-empty
  (cd "$repo" && PATH="$tmp/bin:$PATH" GITHUB_REPOSITORY=$R BASE_SHA="$base" HEAD_REF="$1" bash "$here/../report/check-pr.sh" 2>&1 | tail -1)
}
text77="jq '.issue = 77' report/narrative.json > n && mv n report/narrative.json"
warns="$(cd "$repo" && node report/check.mjs | grep -c '^warn' || true)"
check "pr check: a Factory report run that changes only the text passes" "check: ok, $warns warnings" \
  "$(prcheck factory/77-factory-report-pulse "$text77")"
check "pr check: a Factory report run that changes the template fails" "check: 1 failed, $warns warnings" \
  "$(prcheck factory/77-factory-report-pulse "$text77 && echo x >> report/index.html")"
check "pr check: weakening check.mjs in the pull request does not help" "check: 2 failed, $warns warnings" \
  "$(prcheck factory/77-factory-report-pulse "$text77 && echo x >> report/index.html && echo 'process.exit(0)' > report/check.mjs")"
check "pr check: altered data fails the hash" "check: 1 failed, $warns warnings" \
  "$(prcheck factory/77-factory-report-pulse "$text77 && jq -c '.summary[0].runs += 1' report/data.json > d && mv d report/data.json")"
check "pr check: a typed number fails" "check: 1 failed, $warns warnings" \
  "$(prcheck factory/77-factory-report-pulse "jq '.issue = 77 | .changes[0].text = \"Es kamen 34 Läufe dazu.\"' report/narrative.json > n && mv n report/narrative.json")"
check "pr check: a template change by a person (not a Factory branch) is not locked" "check: ok, $warns warnings (C1 skipped: no --base)" \
  "$(prcheck design/dashboard "echo x >> report/index.html")"
g checkout -q -B nocheck "$base" && g rm -q report/check.mjs && g commit -qm nocheck
check "pr check: a base without check.mjs checks nothing" "::notice::The base commit has no report/check.mjs. Nothing to check." \
  "$(cd "$repo" && BASE_SHA="$(g rev-parse HEAD)" HEAD_REF=x bash "$here/../report/check-pr.sh" 2>&1)"

exit "$fail"
