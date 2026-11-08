// Checks that the Factory CLI renders the prompt of every workflow state in .factory/config.yaml.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const cli = resolve(root, process.env.FACTORY_CLI ?? 'node_modules/@paragondata/factory-cli/dist/bin.js');
const factory = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });

test('every Factory prompt renders', { skip: !existsSync(cli) && `Factory CLI not found at ${cli}; run npm ci or set FACTORY_CLI` }, async (t) => {
  const input = join(mkdtempSync(join(tmpdir(), 'prompts-test-')), 'issue.md');
  writeFileSync(input, 'Part of #1\n\nA test issue.\n');
  const rendered = new Set(['preamble.md']);
  for (const { workflow } of JSON.parse(factory('state')).catalogs) {
    const { states } = JSON.parse(factory('graph', '--workflow', workflow, '--format', 'json'));
    for (const [state, { prompt }] of Object.entries(states)) {
      rendered.add(basename(prompt));
      await t.test(`${workflow}/${state}`, () => {
        const run = spawnSync(process.execPath, [cli, 'prompt', '--input', input, '--workflow', workflow, '--state', state], { cwd: root, encoding: 'utf8' });
        const output = run.stdout + run.stderr;
        assert.equal(run.status, 0, output);
        assert.doesNotMatch(output, /PROMPT_INVALID|not defined/);
      });
    }
  }
  assert.deepEqual([...rendered].sort(), readdirSync(join(root, '.factory/prompts')).filter((f) => f.endsWith('.md')).sort());
});
