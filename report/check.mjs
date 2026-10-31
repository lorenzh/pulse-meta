// Checks the report text (report/narrative.json) against its numbers (report/data.json). The
// agent of the `report` workflow writes only narrative.json; every number in it is a placeholder
// {field|fmt} that the page fills from data.json, so the text cannot disagree with the data.
//
//   C1  only report/data.json and report/narrative.json changed since --base (the template lock)
//   C2  sha256 of data.json equals --sha; meta.schema is 2; meta.as_of equals --as-of
//   C3  narrative keys, template version, item counts and lengths; issue and as_of match
//   C4  every placeholder names a numeric, non-null field of summary[0] and a known format
//   C5  no digit outside placeholders, references and code spans (digits in code spans and
//       quantity words are warnings for the reviewer)
//   C6  every #N is an issue in the data, every pulse-<repo>#N a pull request in human_fixes
//   C7  no HTML, links or token patterns
//
// Usage: node report/check.mjs [--dir report] [--sha <sha256>] [--as-of <iso>] [--issue <n>] [--base <git ref>]
// Exit 0 when no check fails; warnings do not fail.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ALLOWED_FILES = ['report/data.json', 'report/narrative.json'];
export const FORMATS = ['int', 'usd', 'dec1', 'dec2', 'pct', 'pct0', 'hm'];
const TEMPLATE = 1;

// One inline syntax for every text slot; index.html renders the same tokens.
const PLACEHOLDER = /\{([a-z][a-z0-9_]*)\|([a-z0-9]+)\}/g;
const CODE = /`([^`\n]+)`/g;
const PR_REF = /(?<![\w-])pulse-([a-z]+)#(\d+)\b/g;
const ISSUE_REF = /(?<![\w#-])#(\d+)\b/g;
const FORBIDDEN = [
  [/[<>]/, 'HTML characters < or >'],
  [/https?:|www\./i, 'a link'],
  [/\]\(/, 'a Markdown link'],
  [/\b(ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{6,}|github_pat_|\bsk-[A-Za-z0-9_-]{8,}|\bxox[abprs]-/, 'a token pattern'],
];
const QUANTITY = /\b(Hälfte|halb|doppelt|dreifach|Drittel|Viertel|meisten|Mehrheit|fast alle|fast nie|kaum|selten|häufiger|seltener)\b/i;

// slot shape: [path, max length]; lists carry [min, max] counts.
const SHAPE = {
  lead: 600,
  notes: { duration: 300, steps: 300, days: 300, targets: 300, human_fixes: 300 },
  changes: { count: [0, 4], item: { title: 60, text: 300 } },
  case_study: { note: 300, items: { count: [2, 5], item: { label: 40, text: 400 } } },
  findings: { count: [3, 6], item: { id: 4, title: 60, text: 500 } },
  recommendations: { count: [3, 6], item: { title: 60, text: 500, findings: 'ids' } },
};

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const sameKeys = (obj, keys) => {
  const got = Object.keys(obj ?? {}).sort();
  const want = [...keys].sort();
  return got.length === want.length && got.every((k, i) => k === want[i]);
};

/** Every text slot of the narrative as [path, text]. */
function texts(n) {
  const out = [];
  const add = (path, v) => typeof v === 'string' && out.push([path, v]);
  add('lead', n.lead);
  for (const k of Object.keys(SHAPE.notes)) add(`notes.${k}`, n.notes?.[k]);
  (Array.isArray(n.changes) ? n.changes : []).forEach((c, i) => { add(`changes[${i}].title`, c?.title); add(`changes[${i}].text`, c?.text); });
  if (n.case_study) {
    add('case_study.note', n.case_study.note);
    (Array.isArray(n.case_study.items) ? n.case_study.items : []).forEach((c, i) => { add(`case_study.items[${i}].label`, c?.label); add(`case_study.items[${i}].text`, c?.text); });
  }
  (Array.isArray(n.findings) ? n.findings : []).forEach((f, i) => { add(`findings[${i}].title`, f?.title); add(`findings[${i}].text`, f?.text); });
  (Array.isArray(n.recommendations) ? n.recommendations : []).forEach((r, i) => { add(`recommendations[${i}].title`, r?.title); add(`recommendations[${i}].text`, r?.text); });
  return out;
}

function checkShape(n, data, opts, err) {
  const keys = ['template', 'issue', 'as_of', 'lead', 'notes', 'changes', 'case_study', 'findings', 'recommendations'];
  if (!n || typeof n !== 'object' || Array.isArray(n)) return err('C3', 'narrative', 'is not an object');
  if (!sameKeys(n, keys)) err('C3', 'narrative', `keys must be exactly ${keys.join(', ')}`);
  if (n.template !== TEMPLATE) err('C3', 'template', `must be ${TEMPLATE}`);
  if (n.issue !== null && !(Number.isInteger(n.issue) && n.issue > 0)) err('C3', 'issue', 'must be an issue number or null');
  if (opts.issue !== undefined && n.issue !== opts.issue) err('C3', 'issue', `is ${n.issue}, the run is for #${opts.issue}`);
  if (n.as_of !== data?.meta?.as_of) err('C3', 'as_of', `is ${n.as_of}, data.json says ${data?.meta?.as_of}`);
  const str = (path, v, max) => {
    if (typeof v !== 'string' || !v.trim()) return err('C3', path, 'must be a non-empty string');
    if (v.length > max) err('C3', path, `is ${v.length} characters, at most ${max}`);
  };
  const list = (path, v, [min, max]) => {
    if (!Array.isArray(v)) { err('C3', path, 'must be a list'); return []; }
    if (v.length < min || v.length > max) err('C3', path, `has ${v.length} items, needs ${min} to ${max}`);
    return v;
  };
  const item = (path, v, shape) => {
    if (!v || typeof v !== 'object' || !sameKeys(v, Object.keys(shape))) return err('C3', path, `keys must be exactly ${Object.keys(shape).join(', ')}`);
    for (const [k, max] of Object.entries(shape)) if (typeof max === 'number') str(`${path}.${k}`, v[k], max);
  };
  str('lead', n.lead, SHAPE.lead);
  if (!n.notes || !sameKeys(n.notes, Object.keys(SHAPE.notes))) err('C3', 'notes', `keys must be exactly ${Object.keys(SHAPE.notes).join(', ')}`);
  for (const [k, max] of Object.entries(SHAPE.notes)) str(`notes.${k}`, n.notes?.[k], max);
  list('changes', n.changes, SHAPE.changes.count).forEach((c, i) => item(`changes[${i}]`, c, SHAPE.changes.item));

  const caseIssue = data?.summary?.[0]?.case_issue ?? null;
  if (caseIssue === null && n.case_study !== null) err('C3', 'case_study', 'must be null: the data has no case study');
  if (caseIssue !== null) {
    if (!n.case_study || !sameKeys(n.case_study, ['note', 'items'])) err('C3', 'case_study', 'must have exactly note and items');
    else {
      str('case_study.note', n.case_study.note, SHAPE.case_study.note);
      list('case_study.items', n.case_study.items, SHAPE.case_study.items.count).forEach((c, i) => item(`case_study.items[${i}]`, c, SHAPE.case_study.items.item));
    }
  }

  const ids = list('findings', n.findings, SHAPE.findings.count).map((f, i) => {
    item(`findings[${i}]`, f, SHAPE.findings.item);
    if (f?.id !== `F${i + 1}`) err('C3', `findings[${i}].id`, `must be F${i + 1}`);
    return f?.id;
  });
  list('recommendations', n.recommendations, SHAPE.recommendations.count).forEach((r, i) => {
    item(`recommendations[${i}]`, r, SHAPE.recommendations.item);
    const refs = r?.findings;
    if (!Array.isArray(refs) || !refs.length) err('C3', `recommendations[${i}].findings`, 'must name at least one finding');
    else for (const id of refs) if (!ids.includes(id)) err('C3', `recommendations[${i}].findings`, `names ${id}, which is no finding`);
  });
}

/**
 * Runs C1 to C7. data and narrative are parsed JSON; dataBytes the raw data.json (for C2);
 * changed the changed paths (C1, skipped when undefined); opts { sha, asOf, issue }.
 * Returns { errors, warnings }, each a list of strings "Cn path: message".
 */
export function check({ data, narrative, dataBytes, changed, sha, asOf, issue } = {}) {
  const errors = [];
  const warnings = [];
  const err = (c, path, msg) => errors.push(`${c} ${path}: ${msg}`);
  const warn = (c, path, msg) => warnings.push(`${c} ${path}: ${msg}`);

  if (changed !== undefined) {
    for (const f of changed) if (!ALLOWED_FILES.includes(f)) err('C1', f, `changed, but a report run may change only ${ALLOWED_FILES.join(' and ')}`);
  }

  if (sha !== undefined && sha256(dataBytes ?? '') !== sha) err('C2', 'report/data.json', `sha256 is ${sha256(dataBytes ?? '')}, the issue says ${sha}`);
  if (data?.meta?.schema !== 2) err('C2', 'meta.schema', 'must be 2');
  if (asOf !== undefined && data?.meta?.as_of !== asOf) err('C2', 'meta.as_of', `is ${data?.meta?.as_of}, the issue says ${asOf}`);
  const summary = Array.isArray(data?.summary) && data.summary.length === 1 ? data.summary[0] : null;
  if (!summary) err('C2', 'summary', 'must be a list with one row');

  checkShape(narrative, data, { issue }, err);

  const issues = new Set();
  for (const f of data?.features ?? []) { issues.add(f.issue); for (const c of f.children ?? []) issues.add(c); }
  for (const e of data?.events ?? []) issues.add(e.issue);
  for (const c of data?.case ?? []) issues.add(c.issue);
  for (const h of data?.human_fixes ?? []) if (h.feature !== null) issues.add(h.feature);
  if (summary?.case_issue != null) issues.add(summary.case_issue);
  const prRefs = new Set((data?.human_fixes ?? []).map((h) => h.pr));

  for (const [path, text] of narrative && typeof narrative === 'object' ? texts(narrative) : []) {
    for (const [re, what] of FORBIDDEN) if (re.test(text)) err('C7', path, `contains ${what}`);

    let rest = text;
    for (const [, field, fmt] of text.matchAll(PLACEHOLDER)) {
      if (!FORMATS.includes(fmt)) err('C4', path, `{${field}|${fmt}}: unknown format, use ${FORMATS.join(', ')}`);
      if (!summary || !(field in summary)) err('C4', path, `{${field}|${fmt}}: summary has no field ${field}`);
      else if (summary[field] === null) err('C4', path, `{${field}|${fmt}}: ${field} is null in this data (unknown or empty)`);
      else if (typeof summary[field] !== 'number') err('C4', path, `{${field}|${fmt}}: ${field} is not a number`);
    }
    rest = rest.replace(PLACEHOLDER, ' ');
    for (const [, code] of rest.matchAll(CODE)) if (/\d/.test(code)) warn('C5', path, `digits in code span \`${code}\``);
    rest = rest.replace(CODE, ' ');
    for (const [ref, repo, num] of rest.matchAll(PR_REF)) {
      if (repo === 'meta' ? !issues.has(Number(num)) : !prRefs.has(ref)) err('C6', path, `${ref} is not in the data`);
    }
    rest = rest.replace(PR_REF, ' ');
    for (const [ref, num] of rest.matchAll(ISSUE_REF)) if (!issues.has(Number(num))) err('C6', path, `${ref} is not in the data`);
    rest = rest.replace(ISSUE_REF, ' ');
    if (/\d/.test(rest)) err('C5', path, `digit outside a placeholder: "${rest.match(/\S*\d\S*/)[0]}"; write numbers as {field|fmt}`);
    if (/[{}`]/.test(rest)) err('C5', path, 'unbalanced { } or ` (a placeholder must be {field|fmt})');
    const q = QUANTITY.exec(rest);
    if (q) warn('C5', path, `quantity word "${q[0]}": check it against the data`);
  }
  return { errors, warnings };
}

function changedSince(base) {
  const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).split('\n').filter(Boolean);
  const mergeBase = git('merge-base', base, 'HEAD')[0];
  // Committed and uncommitted changes, plus new files: the agent runs this before Factory commits.
  return [...new Set([...git('diff', '--name-only', mergeBase), ...git('ls-files', '--others', '--exclude-standard')])];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const dir = opt('--dir') ?? 'report';
  const dataBytes = await readFile(join(dir, 'data.json'));
  const parse = (what, s) => {
    try {
      return JSON.parse(s);
    } catch (e) {
      console.error(`C3 ${what}: does not parse: ${e.message}`);
      process.exit(1);
    }
  };
  const data = parse('report/data.json', dataBytes.toString('utf8'));
  const narrative = parse('report/narrative.json', await readFile(join(dir, 'narrative.json'), 'utf8'));
  const issueArg = opt('--issue');
  const base = opt('--base');
  const { errors, warnings } = check({
    data,
    narrative,
    dataBytes,
    changed: base ? changedSince(base) : undefined,
    sha: opt('--sha'),
    asOf: opt('--as-of'),
    issue: issueArg === undefined ? undefined : Number(issueArg),
  });
  for (const w of warnings) console.log(`warn ${w}`);
  for (const e of errors) console.log(`FAIL ${e}`);
  console.log(errors.length ? `check: ${errors.length} failed, ${warnings.length} warnings` : `check: ok, ${warnings.length} warnings${base ? '' : ' (C1 skipped: no --base)'}`);
  process.exit(errors.length ? 1 : 0);
}
