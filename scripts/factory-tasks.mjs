#!/usr/bin/env node
// Task list of a child issue: which task comes next, from the task file of the approved spec and the
// run comments of the Factory bot. See docs/factory.md, "Task loop".
//
//   node scripts/factory-tasks.mjs --issue <child> --target <name> [--base <sha>]
//     Prints the progress as JSON. Reads the issue and its comments with `gh api`.
//   node scripts/factory-tasks.mjs --check <work dir of a feature>
//     Checks tasks/<target>.json against targets.json and plan.md. Exit 1 on a defect.
//
// Options: --repo <owner/name> (default $GITHUB_REPOSITORY or lorenzh/pulse-meta), --author <login>
// (the bot; default $FACTORY_GITHUB_ACTOR or the login of the gh token), --root <meta checkout>
// (default the parent of this script's directory).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const MAX_TASKS = 8;
export const MAX_REJECTIONS = 3; // the third rejection of one task becomes a hold
export const MAX_RETRIES = 2; // more retries of one task make it stuck
const TASK_KEYS = ['id', 'kind', 'title', 'files', 'behaviorChange', 'acceptance', 'spec'];
const RECORD = /<!-- factory-record v3 (\{.*\}) -->/;
const VERDICT = /^task-(accepted|rejected): (T[1-9]\d*)(?: @ ([0-9a-f]{40}))?\s*$/;

const isText = (v) => typeof v === 'string' && v.trim() !== '';

/** Returns the defects of a parsed task file; an empty list means valid. */
export function validateTaskFile(doc, target) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return ['the file is not a JSON object'];
  const errors = [];
  if (doc.version !== 1) errors.push('version must be 1');
  if (doc.target !== target) errors.push(`target must be "${target}"`);
  const tasks = doc.tasks;
  if (!Array.isArray(tasks) || tasks.length < 1 || tasks.length > MAX_TASKS) {
    return [...errors, `tasks must be an array of 1 to ${MAX_TASKS} tasks`];
  }
  tasks.forEach((t, i) => {
    const id = `T${i + 1}`;
    if (!t || typeof t !== 'object' || Array.isArray(t)) return errors.push(`task ${i + 1} is not an object`);
    if (t.id !== id) errors.push(`task ${i + 1} must have id "${id}"`);
    for (const key of Object.keys(t)) if (!TASK_KEYS.includes(key)) errors.push(`${id}: unknown key "${key}"`);
    const last = i === tasks.length - 1;
    if (t.kind !== (last ? 'final' : 'step')) errors.push(`${id}: kind must be "${last ? 'final' : 'step'}"`);
    if (!isText(t.title)) errors.push(`${id}: title must be a nonempty string`);
    if (!isText(t.spec)) errors.push(`${id}: spec must name the part of the section`);
    if (typeof t.behaviorChange !== 'boolean') errors.push(`${id}: behaviorChange must be true or false`);
    if (!Array.isArray(t.files) || !t.files.every(isText) || (!last && t.files.length === 0)) {
      errors.push(`${id}: files must be a list of paths${last ? '' : ', at least one'}`);
    }
    const okAcceptance = Array.isArray(t.acceptance) && t.acceptance.length > 0 &&
      t.acceptance.every((a) => a && isText(a.command) && isText(a.expected) && Object.keys(a).length === 2);
    if (!okAcceptance) errors.push(`${id}: acceptance must be a nonempty list of {"command","expected"}`);
  });
  return errors;
}

/** The backticked paths of the `Files:` list of `## Repository: <target>` in plan.md, or null. */
export function sectionFiles(plan, target) {
  const start = plan.indexOf(`\n## Repository: ${target}\n`);
  if (start < 0) return null;
  const section = plan.slice(start + 1).split(/\n## /)[0];
  const m = /^Files:([\s\S]*?)^Behavior change:/m.exec(section);
  if (!m) return null;
  return [...m[1].matchAll(/`([^`\s]+)`/g)].map((x) => x[1]);
}

/** Checks the task files of one feature work directory. Returns a list of defects. */
export function checkDir(dir) {
  let targets;
  try {
    targets = JSON.parse(readFileSync(join(dir, 'targets.json'), 'utf8')).map((t) => t.name);
  } catch (e) {
    return [`targets.json: ${e.message}`];
  }
  const plan = existsSync(join(dir, 'plan.md')) ? readFileSync(join(dir, 'plan.md'), 'utf8') : null;
  const errors = [];
  const tasksDir = join(dir, 'tasks');
  const present = existsSync(tasksDir) ? readdirSync(tasksDir) : [];
  for (const f of present) if (!targets.includes(f.replace(/\.json$/, ''))) errors.push(`tasks/${f}: no such entry in targets.json`);
  for (const target of targets) {
    const file = `tasks/${target}.json`;
    if (!present.includes(`${target}.json`)) {
      errors.push(`${file}: missing`);
      continue;
    }
    let doc;
    try {
      doc = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    } catch (e) {
      errors.push(`${file}: ${e.message}`);
      continue;
    }
    const defects = validateTaskFile(doc, target);
    errors.push(...defects.map((d) => `${file}: ${d}`));
    if (defects.length || plan === null) continue;
    const listed = sectionFiles(plan, target);
    if (listed === null) {
      errors.push(`plan.md: no "Files:" list followed by "Behavior change:" in ## Repository: ${target}`);
      continue;
    }
    const covered = new Set(doc.tasks.flatMap((t) => t.files));
    for (const f of listed) if (!covered.has(f)) errors.push(`${file}: ${f} of the Files: list is in no task`);
  }
  return errors;
}

/** Parses the bot's run comments of the build workflow into events, oldest first. */
export function events(comments, author) {
  const out = [];
  for (const c of comments) {
    if (c.login !== author) continue; // anyone can comment; only the bot writes run records
    const m = RECORD.exec(c.body ?? '');
    if (!m) continue;
    let rec;
    try {
      rec = JSON.parse(m[1]);
    } catch {
      continue;
    }
    if (rec.kind !== 'run' || rec.claim?.workflow !== 'build' || !rec.done) continue;
    const ev = { state: rec.claim.state, reason: rec.done.reason, to: rec.done.states ?? [] };
    if (ev.state === 'task-review' && ev.reason === 'transition') {
      const lines = c.body.slice(0, m.index).split('\n').map((l) => VERDICT.exec(l.trim())).filter(Boolean);
      const v = lines.at(-1);
      if (v && (v[1] === 'rejected' || v[3])) Object.assign(ev, { verdict: v[1], task: v[2], sha: v[3] ?? null });
    }
    out.push(ev);
  }
  return out;
}

/** The progress of a task list after the given events. */
export function progress(doc, evs, base = null) {
  const tasks = doc.tasks;
  const final = tasks.at(-1).id;
  const accepted = new Map();
  const rejected = new Set(); // the newest verdict of the task was a rejection
  const rejections = Object.fromEntries(tasks.map((t) => [t.id, 0]));
  const retries = Object.fromEntries(tasks.map((t) => [t.id, 0]));
  let taskBase = base;
  let lastToReview = -1;
  let lastReviewBack = -1;
  const current = () => tasks.find((t) => t.kind === 'step' && !accepted.has(t.id))?.id ?? final;
  evs.forEach((ev, i) => {
    const cur = current();
    if (ev.reason === 'hold') {
      // A person answers a hold; that answer starts a new budget for the task.
      rejections[cur] = 0;
      retries[cur] = 0;
    } else if (ev.state === 'implement' && ev.reason === 'retry') retries[cur]++;
    else if (ev.state === 'implement' && ev.to.includes('review')) lastToReview = i;
    else if ((ev.state === 'review' || ev.state === 'security') && ev.to.includes('implement')) lastReviewBack = i;
    else if (ev.verdict && ev.task in rejections) {
      if (ev.verdict === 'accepted') {
        accepted.set(ev.task, ev.sha);
        rejected.delete(ev.task);
        taskBase = ev.sha;
      } else {
        rejections[ev.task]++;
        rejected.add(ev.task);
      }
    }
  });
  const next = current();
  let status;
  if (rejections[next] >= MAX_REJECTIONS || retries[next] > MAX_RETRIES) status = 'stuck';
  else if (next !== final) status = rejected.has(next) ? 'fix-task' : 'open';
  else status = lastReviewBack > lastToReview ? 'fix-review' : 'final';
  return {
    status,
    next,
    task: tasks.find((t) => t.id === next),
    taskBase,
    rejections: rejections[next],
    retries: retries[next],
    open: tasks.filter((t) => t.kind === 'step' && !accepted.has(t.id)).map((t) => t.id),
    accepted: Object.fromEntries(accepted),
  };
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

function main(argv) {
  const { values: o } = parseArgs({
    args: argv,
    options: {
      issue: { type: 'string' },
      target: { type: 'string' },
      base: { type: 'string' },
      check: { type: 'string' },
      repo: { type: 'string', default: process.env.GITHUB_REPOSITORY || 'lorenzh/pulse-meta' },
      author: { type: 'string', default: process.env.FACTORY_GITHUB_ACTOR || '' },
      root: { type: 'string', default: fileURLToPath(new URL('..', import.meta.url)) },
    },
  });
  if (o.check) {
    const errors = checkDir(o.check);
    console.log(JSON.stringify({ ok: errors.length === 0, errors }, null, 2));
    return errors.length ? 1 : 0;
  }
  if (!/^[1-9]\d*$/.test(o.issue ?? '') || !/^[a-z][a-z0-9-]*$/.test(o.target ?? '')) {
    throw new Error('usage: factory-tasks.mjs --issue <n> --target <name> [--base <sha>] | --check <dir>');
  }
  const body = gh(['api', `repos/${o.repo}/issues/${o.issue}`, '--jq', '.body']);
  const feature = /^Part of #(\d+)/m.exec(body)?.[1];
  if (!feature) throw new Error(`#${o.issue} has no "Part of #<feature>" line`);
  const file = join('.factory/work', feature, 'tasks', `${o.target}.json`);
  const path = join(o.root, file);
  if (!existsSync(path)) {
    console.log(JSON.stringify({ status: 'no-task-file', feature: Number(feature), file }, null, 2));
    return 0;
  }
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  const defects = validateTaskFile(doc, o.target);
  if (defects.length) throw new Error(`${file}: ${defects.join('; ')}`);
  const author = o.author || gh(['api', 'user', '--jq', '.login']).trim();
  const comments = gh(['api', '--paginate', `repos/${o.repo}/issues/${o.issue}/comments?per_page=100`,
    '--jq', '.[] | {login: .user.login, body} | @json'])
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const result = progress(doc, events(comments, author), o.base ?? null);
  console.log(JSON.stringify({ status: result.status, feature: Number(feature), file, ...result }, null, 2));
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(`factory-tasks: ${e.message}`);
    process.exitCode = 2;
  }
}
