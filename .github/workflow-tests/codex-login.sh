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
  out="$(CODEX_HOME="$1" FACTORY_CODEX_AUTH_JSON="$2" bash -e -c "$codexscript" 2>&1)" || code=$?
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
