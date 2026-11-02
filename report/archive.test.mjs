// node --test report/: build() merges the frozen archive (report/archive.json) with the live data.
// The fixture: the archive is build() of the old bot's records up to CUT; GitHub now hides those
// records and PRs, so the live data holds only what came after. The merge must equal one build
// over everything wherever the archive's aggregates allow it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from './data.mjs';

const OLD = 'lorenzh-factory-bot';
const BOT = 'lorenzh-factory[bot]';
const CUT = '2026-11-20T00:00:00.000Z';
const NOW = Date.parse('2026-11-30T12:00:00Z');
let id = 0;
const record = (issue, at, { wf = 'build', state = 'implement', harness = 'claude', cost, next = [], reason = 'transition', user = BOT } = {}) => ({
  user: { login: user },
  issue_url: `https://api.github.com/repos/lorenzh/pulse-meta/issues/${issue}`,
  created_at: at,
  body: `Factory ran ${wf}/${state}.\n${cost === undefined ? '' : `Cost: ${cost} USD.\n`}<!-- factory-record v3 ${JSON.stringify({
    kind: 'run',
    claim: { run: `${++id}-1`, workflow: wf, state, harness, model: 'm' },
    done: { states: next, reason, usage: { total: 2e6, cached: 1e6 } },
  })} -->`,
});
const old = (issue, at, o = {}) => record(issue, at, { ...o, user: OLD });
const split = (issue, children) => ({
  user: { login: 'github-actions[bot]' },
  issue_url: `https://api.github.com/repos/lorenzh/pulse-meta/issues/${issue}`,
  created_at: '2026-10-01T00:00:00Z',
  body: `Factory split this feature into one issue per repository.\n\n${children.map(([n, t]) => `- #${n} ${t} (build)`).join('\n')}`,
});
const issue = (number, closedAt = null) => ({ number, state: closedAt ? 'closed' : 'open', closed_at: closedAt, labels: [] });
const pr = (repo, number, child, created, merged, human) => ({
  repo, number, child, created, merged, state: merged ? 'closed' : 'open',
  commits: [{ sha: `${number}`.repeat(40).slice(0, 40), author: human ? 'lorenzh' : null, committer: human ? 'lorenzh' : null, date: created }],
});

const SPLITS = [split(10, [[11, 'api']]), split(20, [[21, 'probe']]), split(30, [[31, 'kit']]), split(40, [[41, 'api']])];
// The old bot's records: feature 40 (out of the merged window), 20 (finished), 10 (goes on after CUT).
const OLD_RECORDS = [
  old(40, '2026-10-25T09:00:00Z', { wf: 'spec', state: 'plan', cost: 0.4 }),
  old(41, '2026-10-25T10:00:00Z', { cost: 0.6 }),
  old(20, '2026-11-15T08:00:00Z', { wf: 'spec', state: 'plan', cost: 1 }),
  old(20, '2026-11-15T08:30:00Z', { wf: 'spec', state: 'plan-review', next: ['plan'], cost: 0.2 }),
  old(21, '2026-11-15T09:00:00Z', { cost: 2 }),
  old(21, '2026-11-15T10:00:00Z', { state: 'review', harness: 'codex' }),
  old(10, '2026-11-19T08:00:00Z', { wf: 'spec', state: 'plan', cost: 1.5 }),
  old(11, '2026-11-19T09:00:00Z', { cost: 3 }),
  old(11, '2026-11-19T10:00:00Z', { state: 'review', harness: 'codex', next: ['implement'] }),
  old(11, CUT, { reason: 'hold', cost: 0.1 }), // exactly at CUT: the archive has it
];
const OLD_PRS = [
  pr('probe', 3, 21, '2026-11-15T09:30:00Z', '2026-11-15T11:00:00Z', false),
  pr('api', 5, 11, '2026-11-19T09:30:00Z', '2026-11-19T11:00:00Z', true),
];
const NEW_RECORDS = [
  record(30, '2026-11-28T08:00:00Z', { wf: 'spec', state: 'plan', cost: 0.5 }),
  record(11, '2026-11-28T09:00:00Z', { cost: 1 }),
  record(31, '2026-11-28T09:00:00Z', { cost: 0.7 }),
  record(11, '2026-11-28T10:00:00Z', { state: 'review', harness: 'codex' }),
];
const NEW_PRS = [
  pr('api', 7, 11, '2026-11-28T10:30:00Z', '2026-11-28T11:00:00Z', false),
  pr('kit', 2, 31, '2026-11-28T09:30:00Z', null, true),
];
const ISSUES = [issue(10, '2026-11-28T12:00:00Z'), issue(11, '2026-11-28T11:00:00Z'), issue(20, '2026-11-15T12:00:00Z'), issue(21, '2026-11-15T11:00:00Z'), issue(30), issue(31), issue(40), issue(41)];
const WRUNS = [{ id: 999, display_title: 'Factory run #31 label', run_started_at: '2026-11-28T09:00:00Z', updated_at: '2026-11-28T09:00:00Z', conclusion: 'failure' }];

// The archive as it was built at CUT: issues 10, 11 still open, 30 and 31 not there yet.
const archive = build({
  comments: [...SPLITS, ...OLD_RECORDS],
  issues: [issue(10), issue(11), issue(20, '2026-11-15T12:00:00Z'), issue(21, '2026-11-15T11:00:00Z'), issue(40), issue(41)],
  wruns: [],
  prs: OLD_PRS,
}, { bot: OLD, now: Date.parse(CUT) });
const live = () => ({ comments: [...SPLITS, ...NEW_RECORDS], issues: ISSUES, wruns: WRUNS, prs: NEW_PRS });
const full = build({ comments: [...SPLITS, ...OLD_RECORDS, ...NEW_RECORDS], issues: ISSUES, wruns: WRUNS, prs: [...OLD_PRS, ...NEW_PRS] }, { bot: BOT, now: NOW });
const liveOnly = build(live(), { bot: BOT, now: NOW });
const merged = build(live(), { bot: BOT, now: NOW, archive });
const s = merged.summary[0];

test('the fixture: the archive and the live data are disjoint parts of the full data', () => {
  assert.equal(archive.meta.as_of, CUT);
  assert.equal(archive.summary[0].runs, 10);
  assert.equal(liveOnly.summary[0].runs, 4);
  assert.equal(full.summary[0].runs, 14);
  assert.ok(merged.meta.carry);
});

test('(a) additive totals are archive + live, as one build over all data would count them', () => {
  for (const k of ['usd', 'runs', 'runs_cost_unknown', 'tokens_m', 'tokens_m_codex', 'factory_h', 'review_runs', 'review_back', 'plan_review_runs', 'plan_back', 'holds', 'merge_runs', 'report_runs', 'report_usd', 'prs', 'prs_merged', 'prs_human']) {
    assert.equal(s[k], full.summary[0][k], k);
  }
  assert.equal(s.usd, 11);
});

test('(b) old records and PRs that GitHub returns again are not counted twice', () => {
  const r = live();
  r.comments = [...SPLITS, ...OLD_RECORDS, ...NEW_RECORDS];
  r.prs = [...OLD_PRS, ...NEW_PRS];
  assert.deepEqual(build(r, { bot: BOT, now: NOW, archive }), merged);
});

test('(c) a feature in both: runs and money add up, lead time runs from the archive start', () => {
  const f = merged.features.find((x) => x.issue === 10);
  assert.deepEqual(f, full.features.find((x) => x.issue === 10));
  assert.equal(f.runs, 6);
  assert.equal(f.total_usd, 5.6);
  assert.equal(f.started, '2026-11-19 08:00');
  assert.equal(f.lead_h, 219); // 2026-11-19 08:00 to the merge on 2026-11-28 11:00
  assert.equal(f.human_fixes, 1);
  assert.deepEqual(merged.features.map((x) => x.issue), full.features.map((x) => x.issue));
  for (const k of ['features', 'features_done', 'feature_usd_median', 'feature_usd_max', 'lead_h_median', 'lead_h_p90']) assert.equal(s[k], full.summary[0][k], k);
});

test('(d) state fields come from the live data only', () => {
  assert.ok(merged.meta.carry);
  for (const k of ['targets', 'issues_total', 'issues_open', 'prs_open', 'actions_failed', 'actions_total']) {
    assert.equal(s[k], liveOnly.summary[0][k], k);
  }
  assert.notEqual(s.issues_total, archive.summary[0].issues_total);
});

test('(e) without an archive the output is unchanged', () => {
  const plain = build(live(), { bot: BOT, now: NOW });
  assert.deepEqual(build(live(), { bot: BOT, now: NOW, archive: null }), plain);
  assert.equal('carry' in plain.meta, false);
  assert.equal(plain.summary[0].runs, 4);
});

test('(f) rates are recomputed from the merged counts', () => {
  const rates = [
    ['human_share', s.prs_human / s.prs],
    ['first_pass', (s.prs - s.prs_human) / s.prs],
    ['review_back_rate', s.review_back / s.review_runs],
    ['plan_back_rate', s.plan_back / s.plan_review_runs],
    ['pr_usd', s.usd / s.prs],
  ];
  for (const [k, want] of rates) {
    assert.equal(s[k], Math.round(want * (k === 'pr_usd' ? 100 : 1000)) / (k === 'pr_usd' ? 100 : 1000), k);
    assert.equal(s[k], full.summary[0][k], k);
  }
  assert.equal(s.cached_share, 0.5);
  assert.equal(s.period, '2026-10-25 09:00 bis 2026-11-30 12:00 UTC');
});

test('(g) medians that cannot be merged are weighted means, listed in meta.carry.approx', () => {
  const { carry } = merged.meta;
  assert.deepEqual({ ...carry, approx: undefined }, { archive_as_of: CUT, archive_bot: OLD, gap_from: CUT, gap_to: '2026-11-28T08:00:00.000Z', approx: undefined });
  for (const k of ['pr_merge_min_median', 'by_step.usd_median', 'by_step.min_median', 'by_step.min_p90', 'cached_share']) assert.ok(carry.approx.includes(k), k);
  const step = (d) => d.by_step.find((r) => r.step === 'build/implement');
  const [a, l] = [step(archive), step(liveOnly)];
  assert.equal(step(merged).usd_median, Math.round(((a.usd_median * a.runs + l.usd_median * l.runs) / (a.runs + l.runs)) * 1000) / 1000);
  assert.equal(step(merged).usd_max, 3);
  const [ap, lp] = [archive.summary[0], liveOnly.summary[0]];
  assert.equal(s.pr_merge_min_median, Math.round((ap.pr_merge_min_median * ap.prs_merged + lp.pr_merge_min_median * lp.prs_merged) / (ap.prs_merged + lp.prs_merged)));
});

test('(h) the 30-day window applies to archive rows', () => {
  assert.ok(archive.features.some((f) => f.issue === 40)); // in the archive's own window
  assert.ok(!merged.features.some((f) => f.issue === 40));
  assert.equal(s.features, 4); // the all-time count keeps it
  assert.ok(!merged.by_day.some((d) => d.day === '2026-10-25'));
  assert.deepEqual(merged.by_day, full.by_day);
  for (const k of ['win_runs', 'win_usd', 'win_runs_cost_unknown', 'win_tokens_m', 'win_features_done', 'win_prs_merged', 'win_prs_human', 'win_review_back', 'win_plan_back', 'win_holds']) {
    assert.equal(s[k], full.summary[0][k], k);
  }
  assert.deepEqual(merged.events, full.events);
  assert.deepEqual(merged.human_fixes, full.human_fixes);
});

test('(i) a bot record dated exactly at CUT is the archive\'s; one a millisecond later counts', () => {
  const at = live();
  at.comments = [...at.comments, record(11, CUT, { cost: 9 })];
  assert.deepEqual(build(at, { bot: BOT, now: NOW, archive }), merged);
  const after = live();
  after.comments = [...after.comments, record(11, '2026-11-20T00:00:00.001Z', { cost: 9 })];
  assert.equal(build(after, { bot: BOT, now: NOW, archive }).summary[0].runs, s.runs + 1);
});

test('case study: archive case runs join only when the merged pick is the archive\'s case', () => {
  const cases = [
    // the live data finishes feature 10: its archive runs are not in archive.case
    ['live feature wins', live(), 10, 2],
    // no new finished feature: the archive's case 20 stays with its runs
    ['archive case stays', { ...live(), comments: SPLITS, prs: [], issues: ISSUES.map((i) => (i.number === 10 || i.number === 11 ? issue(i.number) : i)) }, 20, 4],
  ];
  for (const [name, raw, caseIssue, caseRuns] of cases) {
    const d = build(raw, { bot: BOT, now: NOW, archive });
    assert.equal(d.summary[0].case_issue, caseIssue, name);
    assert.equal(d.summary[0].case_runs, caseRuns, name);
    assert.equal(d.case.length, caseRuns, name);
  }
});

test('a live-only previous report is no base for the deltas: the archive is', () => {
  const partial = { meta: { as_of: '2026-11-22T00:00:00.000Z' }, summary: [{ runs: 2, usd: 1 }] };
  const d = build(live(), { bot: BOT, now: NOW, archive, previous: partial });
  assert.equal(d.summary[0].d_runs, d.summary[0].runs - archive.summary[0].runs);
  assert.equal(d.meta.previous_as_of, archive.meta.as_of);
  const whole = build(live(), { bot: BOT, now: NOW, archive, previous: merged });
  assert.equal(whole.meta.previous_as_of, merged.meta.as_of);
  assert.equal(whole.summary[0].d_runs, 0);
});

test('review findings: open PR state, closed archive feature, run record posted after the cut', () => {
  // an open PR created before the cut is a live state, not accounting
  const open = { ...pr('api', 9, 11, '2026-11-19T12:00:00Z', null, false), state: 'open' };
  assert.equal(build({ ...live(), prs: [...NEW_PRS, open] }, { bot: BOT, now: NOW, archive }).summary[0].prs_open, merged.summary[0].prs_open + 1);
  assert.equal(merged.summary[0].prs, build({ ...live(), prs: [...NEW_PRS, open] }, { bot: BOT, now: NOW, archive }).summary[0].prs);
  // feature 40 has no run after the cut; closing its issue completes it
  const closed = build({ ...live(), issues: [...ISSUES.filter((i) => i.number !== 40), issue(40, '2026-11-28T12:00:00Z')] }, { bot: BOT, now: NOW, archive });
  assert.equal(closed.summary[0].features_done, merged.summary[0].features_done + 1);
  // a run that started before the cut and posted its record after it is counted once
  const crossing = record(11, '2026-11-20T00:01:00Z', { cost: 1 });
  const w = { id: 5, display_title: 'Factory run #11 label', run_started_at: '2026-11-19T23:59:00Z', updated_at: '2026-11-20T00:02:00Z', conclusion: 'success' };
  const c = build({ ...live(), comments: [...live().comments, crossing], wruns: [...WRUNS, w] }, { bot: BOT, now: NOW, archive });
  assert.equal(c.summary[0].runs, merged.summary[0].runs + 1);
});
