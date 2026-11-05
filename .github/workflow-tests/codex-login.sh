# Sourced by test.sh: the step "Write the Codex login" of factory-run.yml and the CODEX_HOME of the
# run step. Uses $tmp, $workflows, check from test.sh.

codex_home_expr="\${{ runner.environment == 'self-hosted' && '/home/runner/.codex-factory' || format('{0}/codex', runner.temp) }}"
codex_step() { # <field> <step name> -> the field of that step of run-state
  python3 -c 'import sys, yaml
steps = yaml.safe_load(open(sys.argv[1]))["jobs"]["run-state"]["steps"]
s = next(s for s in steps if s.get("name") == sys.argv[3])
print(s["env"]["CODEX_HOME"] if sys.argv[2] == "home" else s["run"])' "$workflows/factory-run.yml" "$1" "$2"
}
check "codex login: the write step picks the persistent home only on self-hosted runners" "$codex_home_expr" "$(codex_step home "Write the Codex login")"
check "codex login: the run step uses the same home" "$codex_home_expr" "$(codex_step home "Run one factory state")"

codexscript="$(codex_step run "Write the Codex login")"
codex_write() { # <CODEX_HOME> <secret> -> "<exit code>" and the step output
  local code=0 out
  out="$(CODEX_HOME="$1" FACTORY_CODEX_AUTH_JSON="$2" "$BASH" -e -c "$codexscript" 2>&1)" || code=$?
  printf '%s\n%s' "$code" "$out"
}
mode() { stat -c %a "$1"; }
secret='{"tokens":"seed-secret"}'

home="$tmp/codex/fresh/home"
out="$(codex_write "$home" "$secret")"
check "codex login: seeds when absent" "0 $secret 700 600" "$(head -1 <<< "$out") $(cat "$home/auth.json") $(mode "$home") $(mode "$home/auth.json")"
check "codex login: never prints the secret" "" "$(grep -F seed-secret <<< "$out" || true)"

home="$tmp/codex/empty"; mkdir -p "$home"; : > "$home/auth.json"; chmod 0755 "$home"
out="$(codex_write "$home" "$secret")"
check "codex login: seeds when empty and tightens the directory" "0 $secret 700" "$(head -1 <<< "$out") $(cat "$home/auth.json") $(mode "$home")"

home="$tmp/codex/kept"; mkdir -p "$home"; printf '%s' '{"tokens":"refreshed"}' > "$home/auth.json"
out="$(codex_write "$home" "$secret")"
check "codex login: keeps an existing login" '0 ::notice::using the persistent Codex login {"tokens":"refreshed"}' "$(tr '\n' ' ' <<< "$out")$(cat "$home/auth.json")"

out="$(codex_write "$tmp/codex/fresh2" "")"
check "codex login: an empty secret warns and still writes the file" "0 1 0" "$(head -1 <<< "$out") $(grep -c '::warning::The repository secret FACTORY_CODEX_AUTH_JSON is empty' <<< "$out") $(stat -c %s "$tmp/codex/fresh2/auth.json")"

mkdir -p "$tmp/codex/locked"; chmod 0500 "$tmp/codex/locked"
out="$(codex_write "$tmp/codex/locked/home" "$secret")"
check "codex login: an unwritable home fails" "1 1" "$(head -1 <<< "$out") $(grep -c '::error::The Codex home .*/locked/home is not writable' <<< "$out")"
chmod 0700 "$tmp/codex/locked"

# Two jobs seed one shared home at once while a reader polls auth.json: the reader must never see a
# non-empty file that is not valid JSON, and one complete login (0600) must remain. 20 fresh rounds.
codex_reader='import json, os, sys
path, done, ready = sys.argv[1:]
open(ready, "w").close()
bad = 0
while not os.path.exists(done):
    try:
        data = open(path, "rb").read()
    except FileNotFoundError:
        continue
    if data:
        try: json.loads(data)
        except ValueError: bad += 1
print(bad)'
codex_race() { # <step script> [empty] -> one line per failed round, nothing when every round is clean
  local big round dir p1 p2 r c1 c2
  big="$(python3 -c 'import json; print(json.dumps({"tokens": "x" * 12000}))')"
  for round in $(seq 1 20); do
    dir="$tmp/codex/race-${2:-absent}-$round"; mkdir -p "$dir"
    [[ -z "${2:-}" ]] || { mkdir -p "$dir/home"; : > "$dir/home/auth.json"; }
    python3 -c "$codex_reader" "$dir/home/auth.json" "$dir/done" "$dir/ready" > "$dir/bad" & r=$!
    until [[ -e "$dir/ready" ]]; do :; done
    CODEX_HOME="$dir/home" FACTORY_CODEX_AUTH_JSON="$big" bash -e -c "$1" > /dev/null 2>&1 & p1=$!
    CODEX_HOME="$dir/home" FACTORY_CODEX_AUTH_JSON="$big" bash -e -c "$1" > /dev/null 2>&1 & p2=$!
    c1=0; wait "$p1" || c1=$?; c2=0; wait "$p2" || c2=$?
    touch "$dir/done"; wait "$r"
    [[ "$(cat "$dir/bad") $c1 $c2" == "0 0 0" ]] || echo "round $round: $(cat "$dir/bad") partial reads, exits $c1 $c2"
    [[ "$(cat "$dir/home/auth.json")" == "$big" && "$(mode "$dir/home/auth.json")" == 600 ]] || echo "round $round: auth.json is not the complete login with mode 0600"
    ! compgen -G "$dir/home/.auth.json.*" > /dev/null || echo "round $round: a temporary login file is left over"
  done
}
check "codex login: two jobs seeding at once never publish a partial login" "" "$(codex_race "$codexscript")"
check "codex login: two jobs replacing an empty login at once never publish a partial one" "" "$(codex_race "$codexscript" empty)"

# Self-hosted only: warn (never fail) when the Codex home is not its own mount. A stub mountpoint
# answers yes or no; a PATH without mountpoint uses the device comparison.
mkdir -p "$tmp/codex/mount-yes" "$tmp/codex/mount-no" "$tmp/codex/no-mountpoint"
printf '#!/bin/sh\nexit 0\n' > "$tmp/codex/mount-yes/mountpoint"; printf '#!/bin/sh\nexit 1\n' > "$tmp/codex/mount-no/mountpoint"
chmod +x "$tmp/codex/mount-yes/mountpoint" "$tmp/codex/mount-no/mountpoint"
for c in mkdir chmod stat mktemp flock ln rm id; do ln -s "$(command -v "$c")" "$tmp/codex/no-mountpoint/$c"; done
nomount='::warning::The Codex home is not a mounted volume'
mount_case() { # <runner environment> <PATH> <home> -> "<exit code> <warnings> <auth.json size>"
  local out; out="$(RUNNER_ENVIRONMENT="$1" PATH="$2" codex_write "$3" "$secret")"
  echo "$(head -1 <<< "$out") $(grep -c "$nomount" <<< "$out") $(stat -c %s "$3/auth.json")"
}
check "codex login: self-hosted, mounted volume: no warning" "0 0 ${#secret}" "$(mount_case self-hosted "$tmp/codex/mount-yes:$PATH" "$tmp/codex/m1")"
check "codex login: self-hosted, no mounted volume: warns and still seeds" "0 1 ${#secret}" "$(mount_case self-hosted "$tmp/codex/mount-no:$PATH" "$tmp/codex/m2")"
check "codex login: self-hosted without mountpoint: same device as the parent warns" "0 1 ${#secret}" "$(mount_case self-hosted "$tmp/codex/no-mountpoint" "$tmp/codex/m3")"
check "codex login: hosted: no mount check" "0 0 ${#secret}" "$(mount_case github-hosted "$tmp/codex/mount-no:$PATH" "$tmp/codex/m4")"
