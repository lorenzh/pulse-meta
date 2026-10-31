// Builds report/data.json, the numbers of the Factory report, from the public GitHub data of the
// pulse repositories. The agent of the `report` workflow reads this file; it holds numbers,
// controlled names (steps, profiles, targets) and references only, never free text such as issue
// titles or commit messages.
//
// Usage: node report/data.mjs <out.json> [--previous <data.json of the last merged report>]
// Environment: GH_TOKEN or GITHUB_TOKEN; FACTORY_GITHUB_ACTOR (default lorenzh-factory-bot);
// GITHUB_RUN_ID (recorded as meta.source_run).
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export const OWNER = 'lorenzh';
const META = 'pulse-meta';
export const TARGETS = ['contract', 'probe', 'api', 'status', 'notify', 'config', 'kit', 'website', 'console', 'deploy'];
export const WINDOW_DAYS = 30;
// Issues of the report workflow carry this label; their runs, Actions runs and the issues
// themselves stay out of every number, so a report does not change the next one's data.
export const REPORT_LABEL = 'report';

class GitHubError extends Error {
  name = 'GitHubError';
}

const t = (s) => new Date(s).getTime();
const r2 = (x) => Math.round(x * 100) / 100;
const r1 = (x) => Math.round(x * 10) / 10;
const r3 = (x) => Math.round(x * 1000) / 1000;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const p90 = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.floor(0.9 * s.length) - 1)];
};
const orNull = (x, f) => (x === null || !Number.isFinite(x) ? null : f(x));
const ratio = (a, b) => (b ? r3(a / b) : null);
// Known costs only: Codex reports no cost, so a missing cost is unknown, not 0.
const known = (xs) => xs.filter((r) => r.cost !== null).map((r) => r.cost);
const usdOrNull = (xs) => (known(xs).length ? r2(sum(known(xs))) : null);
const groupBy = (xs, key) => xs.reduce((m, x) => m.set(key(x), [...(m.get(key(x)) ?? []), x]), new Map());
const issueOf = (c) => Number(c.issue_url.split('/').pop());
const fmtUtc = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

// Fields of summary that the fingerprint leaves out: they move with the clock, the window or the
// report runs themselves, not with new Factory activity.
const UNSTABLE = /^(period$|win_|d_|report_)/;

/** Fingerprint of the numbers: sha256 over the all-time numeric summary fields, sorted by name. */
export function fingerprint(summary) {
  const nums = Object.keys(summary).sort()
    .filter((k) => !UNSTABLE.test(k) && (typeof summary[k] === 'number' || summary[k] === null))
    .map((k) => [k, summary[k]]);
  return createHash('sha256').update(JSON.stringify(nums)).digest('hex');
}

/**
 * Computes data.json from the raw API answers. Pure: no network, no clock (now is passed in).
 * raw: { comments, issues, wruns, prs } where prs are { repo, number, child, merged, created,
 * state, commits: [{ sha, author, committer, date }] } with author and committer as logins.
 */
export function build(raw, { bot, now, previous = null, sourceRun = null }) {
  const reportIssues = new Set(raw.issues.filter((i) => (i.labels ?? []).some((l) => (l.name ?? l) === REPORT_LABEL)).map((i) => i.number));
  const issues = new Map(raw.issues.filter((i) => !i.pull_request && !reportIssues.has(i.number)).map((i) => [i.number, i]));
  const runIssue = (w) => Number(/^Factory run #(\d+) /.exec(w.display_title ?? '')?.[1]);
  const wruns = raw.wruns.filter((w) => !reportIssues.has(runIssue(w)));
  const workflowRuns = new Map(wruns.map((w) => [w.id, w]));

  // Only the Factory bot's comments count: on a public repository anyone can post a comment that
  // looks like a run record. factory fan-out posts the split comment with the job token
  // (github-actions[bot]); the owner ran it by hand twice. A stranger can write neither.
  const botComments = raw.comments.filter((c) => c.user?.login === bot);
  const splitAuthors = new Set([bot, 'github-actions[bot]', OWNER]);
  const splitComments = raw.comments.filter((c) => splitAuthors.has(c.user?.login));

  // One factory run record per finished state, written by the Factory bot at the end of its comment.
  const recordRe = /<!-- factory-record v3 (\{.*\}) -->/s;
  const allRuns = [];
  for (const c of botComments) {
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
    allRuns.push({
      n: issueOf(c),
      wf: rec.claim.workflow,
      state: rec.claim.state,
      role: rec.claim.model,
      harness: rec.claim.harness ?? 'claude',
      reason: done.reason,
      next: done.states ?? [],
      cost: cost ? Number(cost[1]) : null,
      verdict: [...c.body.matchAll(/^task-(accepted|rejected): T\d+/gm)].at(-1)?.[1],
      tok: usage.total ?? 0,
      cached: usage.cached ?? 0,
      start: w ? w.run_started_at : c.created_at,
      dur: w ? (t(w.updated_at) - t(w.run_started_at)) / 60000 : 0,
    });
  }
  const isReport = (r) => r.wf === 'report' || reportIssues.has(r.n);
  const reportRuns = allRuns.filter(isReport);
  const runs = allRuns.filter((r) => !isReport(r));

  const splitRe = /- #(\d+) (\w+) \((\w+)\)/g;
  const features = new Map();
  const childFeature = new Map();
  const childTarget = new Map();
  for (const c of splitComments) {
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

  // A commit is a person's when a GitHub account other than the bot wrote or committed it. The
  // Factory's git identity (paragon-factory[bot]) maps to no account, so its commits carry no login;
  // web-flow commits only what a person did in the GitHub UI, whose author then counts.
  const prs = raw.prs.map((p) => ({
    ...p,
    human: p.commits.filter((c) => [c.author, c.committer].some((l) => l && l !== bot && l !== 'web-flow')),
  }));

  const featureRows = [];
  for (const [f, children] of features) {
    const own = runs.filter((r) => r.n === f);
    const kids = runs.filter((r) => children.includes(r.n));
    const all = [...own, ...kids];
    if (all.length === 0) continue;
    const issue = issues.get(f) ?? {};
    const start = Math.min(...all.map((r) => t(r.start)));
    const fprs = prs.filter((p) => children.includes(p.child));
    const merged = fprs.filter((p) => p.merged).map((p) => t(p.merged));
    let end = null;
    if (issue.state === 'closed') end = fprs.length && merged.length === fprs.length ? Math.max(...merged) : t(issue.closed_at);
    featureRows.push({
      issue: f,
      children,
      targets: children.length,
      runs: all.length,
      runs_cost_unknown: all.filter((r) => r.cost === null).length,
      spec_usd: r2(sum(known(own))),
      build_usd: r2(sum(known(kids))),
      total_usd: r2(sum(known(all))),
      factory_min: r1(sum(all.map((r) => r.dur))),
      lead_h: end ? r2((end - start) / 3600000) : null,
      status: issue.state === 'closed' ? 'abgeschlossen' : 'offen',
      human_fixes: sum(fprs.map((p) => p.human.length)),
      started: new Date(start).toISOString().slice(0, 16).replace('T', ' '),
      last: Math.max(...all.map((r) => t(r.start)), end ?? 0),
      end,
    });
  }
  featureRows.sort((a, b) => a.started.localeCompare(b.started));

  const eventKind = (r) => {
    if (r.state === 'review' && r.next.includes('implement')) return 'Review schickt zurück';
    if (r.state === 'task-review' && r.reason === 'transition' && r.verdict === 'rejected') return 'Task-Review schickt zurück';
    if (r.state === 'plan-review' && r.next.some((s) => s === 'plan' || s === 'breakdown')) return 'Plan-Review schickt zurück';
    if (r.reason === 'hold') return 'Hold (needs-input)';
    if (r.reason === 'preparation-failed') return 'Vorbereitung fehlgeschlagen';
    if (r.wf === 'merge') return `Merge-Konflikt (${r.state})`;
    return null;
  };
  const allEvents = runs.filter(eventKind).map((r) => ({
    key: `${r.n}-${r.state}-${r.start}`,
    issue: r.n,
    kind: eventKind(r),
    step: `${r.wf}/${r.state}`,
    usd: r.cost === null ? null : r2(r.cost),
    at: r.start.slice(0, 16).replace('T', ' '),
    t: t(r.start),
  }));
  const countKind = (evs, kind) => evs.filter((e) => e.kind.startsWith(kind)).length;

  // --- the window: detail tables keep the last WINDOW_DAYS days -------------------------------
  const cutoff = now - WINDOW_DAYS * 86400000;
  const inWin = (ms) => ms >= cutoff;
  const winRuns = runs.filter((r) => inWin(t(r.start)));
  const winEvents = allEvents.filter((e) => inWin(e.t));
  const winFeatures = featureRows.filter((f) => inWin(f.last));
  const humanFixes = prs.flatMap((p) => p.human.map((c, i) => ({
    key: `pulse-${p.repo}#${p.number}:${i}`,
    pr: `pulse-${p.repo}#${p.number}`,
    sha: (c.sha ?? '').slice(0, 7),
    date: (c.date ?? '').slice(0, 10),
    feature: childFeature.get(p.child) ?? null,
  })));
  const winHumanFixes = humanFixes.filter((h) => h.date && inWin(t(h.date)));
  const humanInWin = (p) => p.human.some((c) => c.date && inWin(t(c.date)));
  const mergedInWin = (p) => p.merged && inWin(t(p.merged));

  const byStep = [...groupBy(winRuns, (r) => `${r.wf}/${r.state}`)].map(([step, v]) => ({
    step,
    harness: [...new Set(v.map((r) => r.harness))].join(', '),
    profiles: [...new Set(v.map((r) => r.role))],
    runs: v.length,
    runs_cost_unknown: v.filter((r) => r.cost === null).length,
    usd: usdOrNull(v),
    usd_median: orNull(median(known(v)), r3),
    usd_max: known(v).length ? r2(Math.max(...known(v))) : null,
    min_median: orNull(median(v.map((r) => r.dur)), r1),
    min_p90: orNull(p90(v.map((r) => r.dur)), r1),
    tokens_m: r1(sum(v.map((r) => r.tok)) / 1e6),
  })).sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1) || b.tokens_m - a.tokens_m);

  const byTarget = [...groupBy(winRuns, (r) => childTarget.get(r.n) ?? 'meta (Spec)')].map(([target, v]) => {
    const n = new Set(v.map((r) => r.n)).size;
    const usd = sum(known(v));
    return {
      target,
      issues: n,
      runs: v.length,
      runs_cost_unknown: v.filter((r) => r.cost === null).length,
      usd: r2(usd),
      usd_per_issue: r2(usd / n),
      prs_merged: prs.filter((p) => p.repo === target && mergedInWin(p)).length,
      prs_human: prs.filter((p) => p.repo === target && humanInWin(p)).length,
    };
  }).sort((a, b) => b.usd - a.usd);

  const byDay = [...groupBy(winRuns, (r) => r.start.slice(0, 10))]
    .map(([day, v]) => ({ day, usd: r2(sum(known(v))), runs: v.length, runs_cost_unknown: v.filter((r) => r.cost === null).length }))
    .sort((a, b) => a.day.localeCompare(b.day));

  // Case study: the most expensive feature finished in the window, so the pick follows the data.
  const caseRow = winFeatures.filter((f) => f.targets > 0 && f.end && inWin(f.end))
    .sort((a, b) => b.total_usd - a.total_usd || b.issue - a.issue)[0] ?? null;
  const CASE = caseRow?.issue ?? null;
  const inCase = (n) => CASE !== null && (n === CASE || childFeature.get(n) === CASE);
  const caseRuns = runs.filter((r) => inCase(r.n)).map((r) => ({
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
  const firstRun = runs.length ? Math.min(...runs.map((r) => t(r.start))) : now;
  const reviewRuns = runs.filter((r) => r.wf === 'build' && r.state === 'review').length;
  const planReviewRuns = runs.filter((r) => r.state === 'plan-review').length;
  const reviewBack = countKind(allEvents, 'Review schickt zurück');
  const planBack = countKind(allEvents, 'Plan-Review schickt zurück');
  const summary = {
    usd: r2(sum(known(runs))),
    runs: runs.length,
    runs_cost_unknown: runs.filter((r) => r.cost === null).length,
    tokens_m: r1(sum(runs.map((r) => r.tok)) / 1e6),
    tokens_m_codex: r1(sum(runs.filter((r) => r.harness === 'codex').map((r) => r.tok)) / 1e6),
    targets: TARGETS.length,
    cached_share: ratio(sum(runs.map((r) => r.cached)), sum(runs.map((r) => r.tok))),
    factory_h: r1(sum(runs.map((r) => r.dur)) / 60),
    features: built.length,
    features_done: built.filter((r) => r.status === 'abgeschlossen').length,
    issues_total: issues.size,
    issues_open: [...issues.values()].filter((i) => i.state === 'open').length,
    prs: prs.length,
    prs_merged: mergedPrs.length,
    prs_open: prs.filter((p) => p.state === 'open').length,
    prs_human: prs.filter((p) => p.human.length).length,
    human_share: ratio(prs.filter((p) => p.human.length).length, prs.length),
    first_pass: ratio(prs.filter((p) => !p.human.length).length, prs.length),
    review_runs: reviewRuns,
    review_back: reviewBack,
    review_back_rate: ratio(reviewBack, reviewRuns),
    plan_review_runs: planReviewRuns,
    plan_back: planBack,
    plan_back_rate: ratio(planBack, planReviewRuns),
    holds: countKind(allEvents, 'Hold'),
    merge_runs: runs.filter((r) => r.wf === 'merge').length,
    feature_usd_median: orNull(median(built.map((r) => r.total_usd)), r2),
    feature_usd_max: built.length ? r2(Math.max(...built.map((r) => r.total_usd))) : null,
    lead_h_median: orNull(median(finished.map((r) => r.lead_h)), r2),
    lead_h_p90: orNull(p90(finished.map((r) => r.lead_h)), r2),
    pr_usd: prs.length ? r2(sum(known(runs)) / prs.length) : null,
    pr_merge_min_median: orNull(median(mergedPrs.map((p) => (t(p.merged) - t(p.created)) / 60000)), Math.round),
    period: `${fmtUtc(firstRun)} bis ${fmtUtc(now)} UTC`,
    actions_failed: wruns.filter((w) => w.conclusion === 'failure').length,
    actions_total: wruns.length,
    report_runs: reportRuns.length,
    report_usd: r2(sum(known(reportRuns))),
    win_days: WINDOW_DAYS,
    win_runs: winRuns.length,
    win_usd: r2(sum(known(winRuns))),
    win_runs_cost_unknown: winRuns.filter((r) => r.cost === null).length,
    win_tokens_m: r1(sum(winRuns.map((r) => r.tok)) / 1e6),
    win_features_done: winFeatures.filter((f) => f.targets > 0 && f.end && inWin(f.end)).length,
    win_prs_merged: prs.filter(mergedInWin).length,
    win_prs_human: prs.filter(humanInWin).length,
    win_review_back: countKind(winEvents, 'Review schickt zurück'),
    win_plan_back: countKind(winEvents, 'Plan-Review schickt zurück'),
    win_holds: countKind(winEvents, 'Hold'),
    case_issue: CASE,
    case_targets: caseRow?.targets ?? null,
    case_runs: CASE === null ? null : caseRuns.length,
    case_usd: CASE === null ? null : r2(sum(caseRuns.filter((r) => r.usd !== null).map((r) => r.usd))),
    case_tokens_m: CASE === null ? null : r2(sum(caseRuns.map((r) => r.tokens)) / 1e6),
    case_lead_h: caseRow?.lead_h ?? null,
    case_human_fixes: caseRow?.human_fixes ?? null,
    case_review_back: CASE === null ? null : allEvents.filter((e) => e.kind === 'Review schickt zurück' && inCase(e.issue)).length,
  };
  // Change since the last merged report, from its all-time numbers.
  const prev = previous?.summary?.[0] ?? null;
  for (const k of ['runs', 'usd', 'features_done', 'prs_merged', 'prs_human', 'holds', 'review_back', 'plan_back', 'actions_failed', 'runs_cost_unknown']) {
    summary[`d_${k}`] = prev && typeof prev[k] === 'number' && typeof summary[k] === 'number' ? r2(summary[k] - prev[k]) : null;
  }

  return {
    meta: {
      schema: 2,
      as_of: new Date(now).toISOString(),
      previous_as_of: previous?.meta?.as_of ?? null,
      source_run: sourceRun,
      fingerprint: fingerprint(summary),
      bot,
      window_days: WINDOW_DAYS,
    },
    summary: [summary],
    by_step: byStep,
    by_target: byTarget,
    by_day: byDay,
    features: winFeatures.map(({ last: _last, end: _end, ...f }) => f),
    events: winEvents.map(({ t: _t, ...e }) => e),
    human_fixes: winHumanFixes,
    case: caseRuns,
  };
}

// --- network ---------------------------------------------------------------------------------

async function fetchRaw(token) {
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

  const [comments, issues, wruns] = await Promise.all([
    all(`repos/${OWNER}/${META}/issues/comments?sort=created`),
    all(`repos/${OWNER}/${META}/issues?state=all`),
    all(`repos/${OWNER}/${META}/actions/workflows/factory-run.yml/runs`, (d) => d.workflow_runs),
  ]);
  const prList = [];
  for (const repo of TARGETS) {
    for (const p of await all(`repos/${OWNER}/pulse-${repo}/pulls?state=all`)) {
      // A fork can name its branch factory/* too; only branches of the repository itself count.
      if (p.head.ref.startsWith('factory/') && p.head.repo?.full_name === `${OWNER}/pulse-${repo}`) prList.push({ repo, p });
    }
  }
  const prs = await pool(prList, 8, async ({ repo, p }) => {
    const commits = await api(`repos/${OWNER}/pulse-${repo}/pulls/${p.number}/commits?per_page=100`);
    const m = /pulse-meta#(\d+)/.exec(p.body ?? '');
    return {
      repo,
      number: p.number,
      child: m ? Number(m[1]) : null,
      merged: p.merged_at,
      created: p.created_at,
      state: p.state,
      commits: commits.map((c) => ({ sha: c.sha, author: c.author?.login ?? null, committer: c.committer?.login ?? null, date: c.commit.author?.date ?? '' })),
    };
  });
  return { comments, issues, wruns, prs };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const out = args[0];
  if (!out || out.startsWith('--')) {
    console.error('usage: node report/data.mjs <out.json> [--previous <data.json>]');
    process.exit(2);
  }
  const prevPath = args.includes('--previous') ? args[args.indexOf('--previous') + 1] : null;
  let previous = null;
  if (prevPath) {
    try {
      previous = JSON.parse(await readFile(prevPath, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err; // no earlier report yet
    }
  }
  const raw = await fetchRaw(process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN);
  const data = build(raw, {
    bot: process.env.FACTORY_GITHUB_ACTOR || 'lorenzh-factory-bot',
    now: Date.now(),
    previous,
    sourceRun: process.env.GITHUB_RUN_ID ?? null,
  });
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(data)}\n`);
  const s = data.summary[0];
  console.log(`report data: ${s.runs} runs, ${data.features.length} features in the window, ${s.prs} PRs, ${s.usd} USD known, ${s.runs_cost_unknown} runs without cost -> ${out}`);
  console.log(`fingerprint ${data.meta.fingerprint}`);
}
