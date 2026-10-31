// node --test 'report/*.test.mjs': page helpers of index.html, run in a VM without a browser.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
// The helper block defines functions only; it touches no DOM until one is called.
const helpers = scripts.find((s) => s.includes('window.frFmt ='));
const page = { window: {} };
vm.runInNewContext(helpers, page);
const { frCaseTip, frFmt } = page.window;

test('a Codex run without cost shows "unbekannt", never 0,00 $', () => {
  assert.equal(typeof frCaseTip, 'function', 'index.html defines window.frCaseTip');
  const codex = { issue: 471, step: 'build/review', usd: null, minutes: 5.5, tokens: 292984 };
  const lines = frCaseTip(codex, '23:36').map((l) => l.join(': '));
  assert.ok(lines.includes('Kosten: unbekannt'), lines.join(' | '));
  assert.ok(!lines.some((l) => l.includes(frFmt(0, 'usd'))), lines.join(' | '));
  const claude = { ...codex, step: 'build/implement', usd: 2.2454 };
  assert.ok(frCaseTip(claude, '23:23').map((l) => l.join(': ')).includes(`Kosten: ${frFmt(2.2454, 'usd')}`));
});

test('the case chart keeps an unknown cost unknown', () => {
  // Number(null) is 0: the case chart must not convert usd before the tooltip reads it.
  const drawer = /dash\.draw\('case',[\s\S]*?\n {2}\}\);/.exec(html)?.[0];
  assert.ok(drawer, 'index.html draws the case chart');
  assert.doesNotMatch(drawer, /Number\(r\.usd\)/);
  assert.match(drawer, /frCaseTip/);
});
