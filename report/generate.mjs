// Builds the Factory report site from the public GitHub data of the pulse repositories.
// Usage: node report/generate.mjs <out-dir>   (reads GH_TOKEN or GITHUB_TOKEN)
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const OWNER = 'lorenzh';
const META = 'pulse-meta';
const TARGETS = ['contract', 'probe', 'api', 'status', 'notify', 'config', 'kit', 'website'];
const out = process.argv[2] ?? '_site';
const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;

class GitHubError extends Error {
  name = 'GitHubError';
}

async function api(path) {
  const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com/${path}`, { headers });
  if (!res.ok) throw new GitHubError(`GET ${path}: ${res.status}`);
  return res.json();
}

// The pagination links of this API name repositories by numeric id; counting pages keeps the path readable.
async function all(path, pick = (x) => x) {
  const rows = [];
  for (let page = 1; ; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const got = pick(await api(`${path}${sep}per_page=100&page=${page}`));
    rows.push(...got);
    if (got.length < 100) return rows;
  }
}

async function pool(items, size, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }));
  return results;
}

const t = (s) => new Date(s).getTime();
const r2 = (x) => Math.round(x * 100) / 100;
const r1 = (x) => Math.round(x * 10) / 10;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const p90 = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.floor(0.9 * s.length) - 1)];
};
const issueOf = (c) => Number(c.issue_url.split('/').pop());

const [comments, issuesAll, wruns] = await Promise.all([
  all(`repos/${OWNER}/${META}/issues/comments?sort=created`),
  all(`repos/${OWNER}/${META}/issues?state=all`),
  all(`repos/${OWNER}/${META}/actions/workflows/factory-run.yml/runs`, (d) => d.workflow_runs),
]);
const issues = new Map(issuesAll.filter((i) => !i.pull_request).map((i) => [i.number, i]));
const workflowRuns = new Map(wruns.map((w) => [w.id, w]));

// One factory run record per finished state, written by the Factory bot at the end of its comment.
const recordRe = /<!-- factory-record v3 (\{.*\}) -->/s;
const runs = [];
for (const c of comments) {
  const m = recordRe.exec(c.body ?? '');
  if (!m) continue;
  let rec;
  try {
    rec = JSON.parse(m[1]);
  } catch {
    continue; // a hand-edited record is not a run we can count
  }
  if (rec.kind !== 'run' || !rec.claim) continue;
  const done = rec.done ?? {};
  const usage = done.usage ?? {};
  const cost = /Cost: ([\d.]+) USD/.exec(c.body);
  const w = workflowRuns.get(Number(String(rec.claim.run).split('-')[0]));
  runs.push({
    n: issueOf(c),
    wf: rec.claim.workflow,
    state: rec.claim.state,
    role: rec.claim.model,
    reason: done.reason,
    next: done.states ?? [],
    cost: cost ? Number(cost[1]) : 0,
    tok: usage.total ?? 0,
    cached: usage.cached ?? 0,
    out: usage.output ?? 0,
    start: w ? w.run_started_at : c.created_at,
    dur: w ? (t(w.updated_at) - t(w.run_started_at)) / 60000 : 0,
  });
}

const splitRe = /- #(\d+) (\w+) \((\w+)\)/g;
const features = new Map();
const childFeature = new Map();
const childTarget = new Map();
for (const c of comments) {
  if (!(c.body ?? '').startsWith('Factory split this feature')) continue;
  const f = issueOf(c);
  const children = [];
  for (const [, ch, target] of c.body.matchAll(splitRe)) {
    children.push(Number(ch));
    childFeature.set(Number(ch), f);
    childTarget.set(Number(ch), target);
  }
  features.set(f, children);
}

const prList = [];
for (const repo of TARGETS) {
  for (const p of await all(`repos/${OWNER}/pulse-${repo}/pulls?state=all`)) {
    if (p.head.ref.startsWith('factory/')) prList.push({ repo, p });
  }
}
const prs = await pool(prList, 8, async ({ repo, p }) => {
  const commits = await api(`repos/${OWNER}/pulse-${repo}/pulls/${p.number}/commits?per_page=100`);
  const human = commits.filter((c) => !(c.commit.author?.name ?? '').toLowerCase().includes('factory'));
  const m = /pulse-meta#(\d+)/.exec(p.body ?? '');
  return { repo, number: p.number, title: p.title, child: m ? Number(m[1]) : null, merged: p.merged_at, created: p.created_at, state: p.state, human };
});

const featureRows = [];
for (const [f, children] of features) {
  const own = runs.filter((r) => r.n === f);
  const kids = runs.filter((r) => children.includes(r.n));
  if (own.length + kids.length === 0) continue;
  const issue = issues.get(f) ?? {};
  const start = Math.min(...[...own, ...kids].map((r) => t(r.start)));
  const fprs = prs.filter((p) => children.includes(p.child));
  const merged = fprs.filter((p) => p.merged).map((p) => t(p.merged));
  let end = null;
  if (issue.state === 'closed') end = fprs.length && merged.length === fprs.length ? Math.max(...merged) : t(issue.closed_at);
  featureRows.push({
    issue: f,
    title: issue.title ?? '',
    targets: children.length,
    runs: own.length + kids.length,
    spec_usd: r2(sum(own.map((r) => r.cost))),
    build_usd: r2(sum(kids.map((r) => r.cost))),
    total_usd: r2(sum([...own, ...kids].map((r) => r.cost))),
    factory_min: r1(sum([...own, ...kids].map((r) => r.dur))),
    lead_h: end ? r2((end - start) / 3600000) : null,
    status: issue.state === 'closed' ? 'abgeschlossen' : 'offen',
    human_fixes: sum(fprs.map((p) => p.human.length)),
    started: new Date(start).toISOString().slice(0, 16).replace('T', ' '),
  });
}
featureRows.sort((a, b) => a.started.localeCompare(b.started));

const groupBy = (xs, key) => xs.reduce((m, x) => m.set(key(x), [...(m.get(key(x)) ?? []), x]), new Map());

const byStep = [...groupBy(runs, (r) => `${r.wf}/${r.state}`)].map(([step, v]) => ({
  step,
  role: v[0].role,
  runs: v.length,
  usd: r2(sum(v.map((r) => r.cost))),
  usd_median: Math.round(median(v.map((r) => r.cost)) * 1000) / 1000,
  usd_max: r2(Math.max(...v.map((r) => r.cost))),
  min_median: r1(median(v.map((r) => r.dur))),
  min_p90: r1(p90(v.map((r) => r.dur))),
  tokens_m: r1(sum(v.map((r) => r.tok)) / 1e6),
})).sort((a, b) => b.usd - a.usd);

const byTarget = [...groupBy(runs, (r) => childTarget.get(r.n) ?? 'meta (Spec)')].map(([target, v]) => {
  const n = new Set(v.map((r) => r.n)).size;
  const usd = sum(v.map((r) => r.cost));
  return {
    target,
    issues: n,
    runs: v.length,
    usd: r2(usd),
    usd_per_issue: r2(usd / n),
    prs_merged: prs.filter((p) => p.repo === target && p.merged).length,
    prs_human: prs.filter((p) => p.repo === target && p.human.length).length,
  };
}).sort((a, b) => b.usd - a.usd);

const byHour = [...groupBy(runs, (r) => `${r.start.slice(0, 13)}:00:00Z`)]
  .map(([hour, v]) => ({ hour, usd: r2(sum(v.map((r) => r.cost))), runs: v.length }))
  .sort((a, b) => a.hour.localeCompare(b.hour));

const eventKind = (r) => {
  if (r.state === 'review' && r.next.includes('implement')) return 'Review schickt zurück';
  if (r.state === 'plan-review' && r.next.includes('plan')) return 'Plan-Review schickt zurück';
  if (r.reason === 'hold') return 'Hold (needs-input)';
  if (r.reason === 'preparation-failed') return 'Vorbereitung fehlgeschlagen';
  if (r.wf === 'merge') return `Merge-Konflikt (${r.state})`;
  return null;
};
const events = runs.filter(eventKind).map((r) => ({
  key: `${r.n}-${r.state}-${r.start}`,
  issue: r.n,
  title: issues.get(r.n)?.title ?? '',
  kind: eventKind(r),
  step: `${r.wf}/${r.state}`,
  usd: r2(r.cost),
  at: r.start.slice(0, 16).replace('T', ' '),
}));

const humanFixes = prs.flatMap((p) => p.human.map((c, i) => ({
  key: `pulse-${p.repo}#${p.number}:${i}`,
  pr: `pulse-${p.repo}#${p.number}`,
  title: p.title,
  fix: c.commit.message.split('\n')[0],
  date: (c.commit.author?.date ?? '').slice(0, 10),
  feature: childFeature.get(p.child) ?? null,
})));

const CASE = 324;
const case324 = runs.filter((r) => r.n === CASE || childFeature.get(r.n) === CASE).map((r) => ({
  key: `${r.n}-${r.state}-${r.start}`,
  issue: r.n,
  target: childTarget.get(r.n) ?? 'Spec',
  step: `${r.wf}/${r.state}`,
  usd: r.cost,
  tokens: r.tok,
  start: r.start,
  minutes: r1(r.dur),
}));

const built = featureRows.filter((r) => r.targets > 0);
const finished = built.filter((r) => r.lead_h !== null);
const mergedPrs = prs.filter((p) => p.merged);
const fmtUtc = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
const firstRun = Math.min(...runs.map((r) => t(r.start)));
const now = Date.now();
const summary = {
  usd: r2(sum(runs.map((r) => r.cost))),
  runs: runs.length,
  tokens_m: r1(sum(runs.map((r) => r.tok)) / 1e6),
  cached_share: Math.round((sum(runs.map((r) => r.cached)) / sum(runs.map((r) => r.tok))) * 1000) / 1000,
  factory_h: r1(sum(runs.map((r) => r.dur)) / 60),
  features: built.length,
  features_done: built.filter((r) => r.status === 'abgeschlossen').length,
  issues_total: issues.size,
  issues_open: [...issues.values()].filter((i) => i.state === 'open').length,
  prs: prs.length,
  prs_merged: mergedPrs.length,
  prs_open: prs.filter((p) => p.state === 'open').length,
  prs_human: prs.filter((p) => p.human.length).length,
  human_share: Math.round((prs.filter((p) => p.human.length).length / prs.length) * 1000) / 1000,
  first_pass: Math.round((prs.filter((p) => !p.human.length).length / prs.length) * 1000) / 1000,
  review_back: events.filter((e) => e.kind === 'Review schickt zurück').length,
  plan_back: events.filter((e) => e.kind === 'Plan-Review schickt zurück').length,
  holds: events.filter((e) => e.kind.startsWith('Hold')).length,
  merge_runs: runs.filter((r) => r.wf === 'merge').length,
  feature_usd_median: r2(median(built.map((r) => r.total_usd))),
  feature_usd_max: r2(Math.max(...built.map((r) => r.total_usd))),
  lead_h_median: r2(median(finished.map((r) => r.lead_h))),
  lead_h_p90: r2(p90(finished.map((r) => r.lead_h))),
  pr_usd: r2(sum(runs.map((r) => r.cost)) / prs.length),
  pr_merge_min_median: Math.round(median(mergedPrs.map((p) => (t(p.merged) - t(p.created)) / 60000))),
  period: `${fmtUtc(firstRun)} bis ${fmtUtc(now)} UTC`,
  actions_failed: wruns.filter((w) => w.conclusion === 'failure').length,
  actions_total: wruns.length,
  c324_usd: r2(sum(case324.map((r) => r.usd))),
  c324_tokens_m: Math.round((sum(case324.map((r) => r.tokens)) / 1e6) * 100) / 100,
};

const data = {
  summary: [summary],
  by_step: byStep,
  by_target: byTarget,
  by_hour: byHour,
  features: featureRows,
  events,
  human_fixes: humanFixes,
  case324,
};

await mkdir(out, { recursive: true });
await writeFile(join(out, 'data.json'), JSON.stringify(data));
await writeFile(join(out, 'index.html'), await readFile(new URL('index.html', import.meta.url)));
console.log(`report: ${runs.length} runs, ${featureRows.length} features, ${prs.length} PRs, ${summary.usd} USD -> ${out}`);
