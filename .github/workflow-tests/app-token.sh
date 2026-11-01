# Sourced by test.sh. Check token scope, fallback and the App/PAT identity paths locally.
python3 - "$workflows" "$here/../../.factory/config.yaml" <<'PY'
import json, os, pathlib, re, subprocess, sys, tempfile, yaml

workflows = pathlib.Path(sys.argv[1])
config = yaml.safe_load(open(sys.argv[2]))
targets = config['workspaces']['multigit']['options']['targets']
repos = {t['provider']['options']['repository'].split('/')[1] for t in targets.values()}
pin = 'actions/create-github-app-token@fee1f7d63c2ff003460e3d139729b119787bc349'
consumers = 0
for name in ('factory.yml', 'factory-run.yml', 'factory-unblock.yml'):
    workflow = yaml.safe_load((workflows / name).read_text())
    for job in workflow['jobs'].values():
        minted = set()
        for step in job['steps']:
            if step.get('uses', '').startswith('actions/create-github-app-token@'):
                assert step['uses'] == pin
                assert "vars.FACTORY_APP_ID != ''" in step['if']
                inputs = step['with']
                assert inputs['app-id'] == '${{ vars.FACTORY_APP_ID }}'
                assert inputs['private-key'] == '${{ secrets.FACTORY_APP_PRIVATE_KEY }}'
                assert inputs['owner'] == 'lorenzh'
                assert set(inputs['repositories'].split()) == repos
                assert len(inputs['repositories'].split()) == len(repos)
                assert not inputs.get('skip-token-revoke', False)
                minted.add(step['id'])
            for value in step.get('env', {}).values():
                if 'secrets.FACTORY_GITHUB_TOKEN' not in str(value):
                    continue
                consumers += 1
                assert value.startswith("${{ vars.FACTORY_APP_ID == '' && secrets.FACTORY_GITHUB_TOKEN || steps.")
                token_id = re.search(r'steps\.([\w-]+)\.outputs\.token', value)[1]
                assert token_id in minted, (name, step['name'])
                # Exercise the fallback expression, including a failed App mint with a PAT present.
                for app_id, token, pat, expected in (
                    ('', '', 'pat', 'pat'), ('123', 'installation', 'pat', 'installation'),
                    ('123', '', 'pat', ''), ('', '', '', ''),
                ):
                    expression = value[3:-2].replace('&&', ' and ').replace('||', ' or ')
                    for key, val in {'vars.FACTORY_APP_ID': app_id, 'secrets.FACTORY_GITHUB_TOKEN': pat,
                                     f'steps.{token_id}.outputs.token': token}.items():
                        expression = expression.replace(key, repr(val))
                    assert eval(expression, {'__builtins__': {}}, {}) == expected
assert consumers == 7, consumers
print('ok   App tokens: pinned action, all configured repositories, conditional mint, PAT fallback, no fallback on App failure')

workflow = yaml.safe_load((workflows / 'factory-run.yml').read_text())
steps = workflow['jobs']['run-state']['steps']
identity = next(s['run'] for s in steps if s.get('name') == 'Check the bot account')
with tempfile.TemporaryDirectory() as directory:
    directory = pathlib.Path(directory)
    gh = directory / 'gh'
    gh.write_text('#!/bin/sh\necho "$*" >> "$CALLS"\n[ "$*" = "api user --jq .login" ] || exit 1\nprintf "%s\\n" "$PAT_LOGIN"\n')
    gh.chmod(0o755)
    calls = directory / 'calls'
    base = {**os.environ, 'PATH': f'{directory}:{os.environ["PATH"]}', 'CALLS': str(calls),
            'GH_TOKEN': 'test-token', 'FACTORY_APP_ID': '123', 'FACTORY_APP_SLUG': 'pulse-factory',
            'FACTORY_GITHUB_ACTOR': 'pulse-factory[bot]', 'PAT_LOGIN': 'lorenzh-factory-bot'}
    def check_identity(overrides, success, user_call=False):
        calls.unlink(missing_ok=True)
        result = subprocess.run(['bash', '-e', '-c', identity], env={**base, **overrides}, capture_output=True, text=True)
        assert (result.returncode == 0) == success, result.stderr
        assert calls.exists() == user_call
    check_identity({}, True)
    check_identity({'FACTORY_GITHUB_ACTOR': 'wrong[bot]'}, False)
    check_identity({'FACTORY_APP_SLUG': ''}, False)
    check_identity({'FACTORY_GITHUB_ACTOR': ''}, False)
    check_identity({'GH_TOKEN': ''}, False)
    check_identity({'FACTORY_APP_ID': '', 'FACTORY_GITHUB_ACTOR': 'lorenzh-factory-bot'}, True, True)
    check_identity({'FACTORY_APP_ID': '', 'FACTORY_GITHUB_ACTOR': 'other'}, False, True)
    print('ok   App identity: no /user call; PAT identity and mismatch checks preserved')

    # Run the real workflow commands with only node stubbed; check Factory's GraphQL author.
    node = directory / 'node'
    node.write_text('#!/usr/bin/env python3\nimport json, os, sys\nopen(os.environ["CALLS"], "w").write(json.dumps(sys.argv[1:]))\n')
    node.chmod(0o755)
    for step_name in ('Cancel the interruption', 'Run one factory state'):
        command = next(s['run'] for s in steps if s.get('name') == step_name)
        for actor, author in [('pulse-factory[bot]', 'pulse-factory'), ('lorenzh-factory-bot', 'lorenzh-factory-bot')]:
            result = subprocess.run(['bash', '-e', '-c', command], env={**base,
                'FACTORY_GITHUB_ACTOR': actor, 'FACTORY_ISSUE': '1', 'FACTORY_RUN_ID': '1-1',
                'FACTORY_ADMISSION': 'restart', 'FACTORY_GENERATION': '', 'GITHUB_OUTPUT': str(directory / 'out'),
                'RUNNER_TEMP': str(directory)}, capture_output=True, text=True)
            assert result.returncode == 0, result.stderr
            args = json.loads(calls.read_text())
            assert args[args.index('--record-author') + 1] == author
    print('ok   Factory run and cancel: App record author uses GraphQL slug; PAT author unchanged')

admission = yaml.safe_load((workflows / 'factory.yml').read_text())['jobs']['admit']
assert "github.event.sender.login != vars.FACTORY_GITHUB_ACTOR" in admission['if']
assert "github.event.sender.login != 'lorenzh-factory-bot'" in admission['if']
print('ok   Admission ignores both current App and historical PAT label events')
PY
