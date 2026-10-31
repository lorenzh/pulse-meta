// node --test report/: check.mjs against the committed report and altered copies of it.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { check } from './check.mjs';
import { build } from './data.mjs';

const dataBytes = readFileSync(new URL('data.json', import.meta.url));
const data = JSON.parse(dataBytes);
const narrative = JSON.parse(readFileSync(new URL('narrative.json', import.meta.url), 'utf8'));
const sha = createHash('sha256').update(dataBytes).digest('hex');
const clone = (x) => structuredClone(x);
const run = (over = {}) => check({ data, narrative, dataBytes, sha, asOf: data.meta.as_of, changed: ['report/data.json', 'report/narrative.json'], ...over });
const failsWith = (res, code, text) => assert.ok(res.errors.some((e) => e.startsWith(code) && e.includes(text)), `expected ${code} with "${text}", got ${JSON.stringify(res.errors)}`);
const withText = (path, text) => { const n = clone(narrative); const keys = path.split('.'); keys.slice(0, -1).reduce((o, k) => o[k], n)[keys.at(-1)] = text; return n; };

test('the committed report passes', () => {
  assert.deepEqual(run().errors, []);
});

test('C1: a change to the template fails', () => {
  failsWith(run({ changed: ['report/narrative.json', 'report/index.html'] }), 'C1', 'report/index.html');
  failsWith(run({ changed: ['report/check.mjs'] }), 'C1', 'report/check.mjs');
  failsWith(run({ changed: ['report/narrative.json', '.github/workflows/report-check.yml'] }), 'C1', '.github/workflows/report-check.yml');
});

test('C2: data.json altered after the opener hashed it fails', () => {
  const altered = Buffer.from(dataBytes.toString().replace(`"runs":${data.summary[0].runs},`, `"runs":${data.summary[0].runs + 1},`));
  assert.notEqual(altered.toString(), dataBytes.toString());
  failsWith(run({ dataBytes: altered }), 'C2', 'sha256');
  failsWith(run({ asOf: '2020-01-01T00:00:00.000Z' }), 'C2', 'meta.as_of');
});

test('C3: shape, counts, ids, issue and as_of', () => {
  failsWith(run({ narrative: { ...clone(narrative), extra: 'x' } }), 'C3', 'keys must be exactly');
  const n = clone(narrative); n.findings = n.findings.slice(0, 2);
  failsWith(run({ narrative: n }), 'C3', 'needs 3 to 6');
  const r = clone(narrative); r.recommendations[0].findings = ['F9'];
  failsWith(run({ narrative: r }), 'C3', 'F9, which is no finding');
  failsWith(run({ narrative: withText('findings.0.title', 'x'.repeat(61)) }), 'C3', 'at most 60');
  failsWith(run({ issue: 4711 }), 'C3', 'the run is for #4711');
  failsWith(run({ narrative: { ...clone(narrative), as_of: 'gestern' } }), 'C3', 'as_of');
});

test('C4: unknown field, unknown format and a missing cost fail', () => {
  failsWith(run({ narrative: withText('lead', 'Kosten {usd_total|usd}.') }), 'C4', 'no field usd_total');
  failsWith(run({ narrative: withText('lead', 'Kosten {usd|eur}.') }), 'C4', 'unknown format');
  // Codex reports no cost: a placeholder on an unknown (null) cost must not render as a number.
  const d = clone(data); d.summary[0].feature_usd_median = null;
  failsWith(run({ data: d }), 'C4', 'feature_usd_median is null');
});

test('C5: an altered number typed into the text fails', () => {
  failsWith(run({ narrative: withText('findings.0.text', 'Ein Feature kostet im Median 1,57 $.') }), 'C5', 'digit outside a placeholder');
  failsWith(run({ narrative: withText('notes.days', 'Am 31.10. lief am meisten.') }), 'C5', 'digit');
  failsWith(run({ narrative: withText('lead', 'Kosten {usd|usd.') }), 'C5', 'unbalanced');
  const ok = run({ narrative: withText('lead', 'Die Hälfte lief über `TypeScript 7`, Kosten {usd|usd}.') });
  assert.deepEqual(ok.errors, []);
  assert.ok(ok.warnings.some((w) => w.includes('Hälfte')) && ok.warnings.some((w) => w.includes('TypeScript 7')));
});

test('C5: digits of any script and other numeric characters fail', () => {
  for (const text of ['Kosten ９９９ Dollar.', 'Kosten ٣ Dollar.', 'Ein ½ Feature.', 'Kapitel Ⅻ.', 'Fehler ² mal.']) {
    failsWith(run({ narrative: withText('lead', text) }), 'C5', 'digit outside a placeholder');
  }
});

test('C4: a placeholder inside a code span fails, because the page renders code literally', () => {
  failsWith(run({ narrative: withText('lead', 'Kosten `{usd|usd}`.') }), 'C4', 'inside a code span');
});

test('C6: references outside the data fail', () => {
  failsWith(run({ narrative: withText('findings.1.text', 'Siehe #999999.') }), 'C6', '#999999');
  failsWith(run({ narrative: withText('findings.1.text', 'Siehe pulse-api#9999.') }), 'C6', 'pulse-api#9999');
  failsWith(run({ narrative: withText('findings.1.text', 'Siehe pulse-meta#999999.') }), 'C6', 'pulse-meta#999999');
});

test('C7: HTML, links and tokens fail', () => {
  failsWith(run({ narrative: withText('lead', '<img src=x onerror=alert(document.cookie)>') }), 'C7', 'HTML');
  failsWith(run({ narrative: withText('lead', 'Mehr unter [hier](https://example.test).') }), 'C7', 'link');
  failsWith(run({ narrative: withText('lead', 'Token ghp_abcdefghijklmnop im Text.') }), 'C7', 'token');
});

test('empty data: build() survives no runs, and a text that cites its numbers fails', () => {
  const empty = build({ comments: [], issues: [], wruns: [], prs: [] }, { bot: 'bot', now: Date.parse('2026-11-01T00:00:00Z') });
  assert.equal(empty.summary[0].runs, 0);
  assert.equal(empty.summary[0].feature_usd_median, null);
  assert.equal(empty.summary[0].case_issue, null);
  const res = check({ data: empty, narrative: { ...clone(narrative), as_of: empty.meta.as_of } });
  failsWith(res, 'C3', 'case_study');
  failsWith(res, 'C4', 'is null');
  failsWith(res, 'C6', 'is not in the data');
});
