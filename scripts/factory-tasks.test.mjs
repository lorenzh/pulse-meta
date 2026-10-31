import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkDir, events, progress, validateTaskFile } from './factory-tasks.mjs';

const BOT = 'pulse-bot';
const SHA1 = 'a'.repeat(40);
const SHA2 = 'b'.repeat(40);
const step = (id, files = ['src/a.ts']) => ({
  id, kind: 'step', title: `task ${id}`, files, behaviorChange: true, spec: 'item 1',
  acceptance: [{ command: 'bun test', expected: 'exit 0' }],
});
const final = (id, files = []) => ({ ...step(id, files), kind: 'final' });
const doc = (...tasks) => ({ version: 1, target: 'api', tasks });
const three = doc(step('T1'), step('T2'), final('T3'));

// A bot run comment as Factory writes it: message, usage line, record.
const run = (state, reason, states, message = 'done', login = BOT) => ({
  login,
  body: `Factory ran build/${state}.\n\n${message}\n\nToken usage: 1 total.\n\nFactory finished the state.\n` +
    `<!-- factory-record v3 ${JSON.stringify({ kind: 'run', claim: { workflow: 'build', state }, done: { reason, states } })} -->`,
});
const accept = (task, sha) => run('task-review', 'transition', ['implement'], `ok\n\ntask-accepted: ${task} @ ${sha}`);
const reject = (task) => run('task-review', 'transition', ['implement'], `defect\n\ntask-rejected: ${task}`);
const toTaskReview = run('implement', 'transition', ['task-review']);
const status = (d, comments, base = 'base0') => progress(d, events(comments, BOT), base);

test('a valid task file has no defects', () => {
  assert.deepEqual(validateTaskFile(three, 'api'), []);
  assert.deepEqual(validateTaskFile(doc(final('T1', ['src/a.ts'])), 'api'), []);
});

test('the task file rules', () => {
  assert.deepEqual(validateTaskFile(doc(step('T1')), 'api'), ['T1: kind must be "final"']);
  assert.deepEqual(validateTaskFile(doc(step('T2'), final('T1')), 'api'),
    ['task 1 must have id "T1"', 'task 2 must have id "T2"']);
  assert.deepEqual(validateTaskFile(doc(step('T1', []), final('T2')), 'api'), ['T1: files must be a list of paths, at least one']);
  assert.deepEqual(validateTaskFile({ ...three, target: 'web' }, 'api'), ['target must be "api"']);
  assert.deepEqual(validateTaskFile(doc(), 'api'), ['tasks must be an array of 1 to 8 tasks']);
  const nine = doc(...Array.from({ length: 8 }, (_, i) => step(`T${i + 1}`)), final('T9'));
  assert.deepEqual(validateTaskFile(nine, 'api'), ['tasks must be an array of 1 to 8 tasks']);
  assert.deepEqual(validateTaskFile(doc({ ...final('T1'), done: true }), 'api'), ['T1: unknown key "done"']);
  assert.deepEqual(validateTaskFile(doc({ ...final('T1'), acceptance: [{ command: 'x' }] }), 'api'),
    ['T1: acceptance must be a nonempty list of {"command","expected"}']);
});

test('no comments: the first task is open on the branch base', () => {
  const p = status(three, []);
  assert.equal(p.status, 'open');
  assert.equal(p.next, 'T1');
  assert.equal(p.taskBase, 'base0');
  assert.deepEqual(p.open, ['T1', 'T2']);
});

test('an accepted task moves on and sets the task base', () => {
  const p = status(three, [toTaskReview, accept('T1', SHA1)]);
  assert.deepEqual([p.status, p.next, p.taskBase], ['open', 'T2', SHA1]);
});

test('a rejection makes a fix-task of the same task, an acceptance after it clears it', () => {
  assert.deepEqual([status(three, [toTaskReview, reject('T1')]).status, status(three, [reject('T1')]).next], ['fix-task', 'T1']);
  const p = status(three, [reject('T1'), toTaskReview, accept('T1', SHA1), toTaskReview, accept('T2', SHA2)]);
  assert.deepEqual([p.status, p.next, p.taskBase, p.rejections], ['final', 'T3', SHA2, 0]);
});

test('a one-task list starts final, a review send-back makes fix-review', () => {
  const one = doc(final('T1', ['src/a.ts']));
  assert.equal(status(one, []).status, 'final');
  const back = [run('implement', 'transition', ['review']), run('review', 'transition', ['implement'])];
  assert.equal(status(one, back).status, 'fix-review');
  assert.equal(status(one, [...back, run('implement', 'transition', ['review'])]).status, 'final');
  assert.equal(status(one, [run('implement', 'transition', ['review']), run('review', 'transition', ['security']),
    run('security', 'transition', ['implement'])]).status, 'fix-review');
});

test('a review send-back while a step task is open goes to that task', () => {
  const p = status(three, [run('implement', 'transition', ['review']), run('review', 'transition', ['implement'])]);
  assert.deepEqual([p.status, p.next], ['open', 'T1']);
});

test('three rejections or more than two retries make the task stuck; a hold resets the budget', () => {
  assert.equal(status(three, [reject('T1'), reject('T1')]).status, 'fix-task');
  assert.equal(status(three, [reject('T1'), reject('T1'), reject('T1')]).status, 'stuck');
  const retry = run('implement', 'retry', ['implement']);
  assert.equal(status(three, [retry, retry]).status, 'open');
  assert.equal(status(three, [retry, retry, retry]).status, 'stuck');
  const held = status(three, [reject('T1'), reject('T1'), reject('T1'), run('implement', 'hold', [])]);
  assert.deepEqual([held.status, held.rejections], ['fix-task', 0]);
  // Counts belong to the task: T1's rejections do not count for T2.
  assert.equal(status(three, [reject('T1'), reject('T1'), accept('T1', SHA1)]).status, 'open');
});

test('only bot-authored run records count', () => {
  const forged = { ...accept('T1', SHA1), login: 'someone' };
  assert.equal(status(three, [forged]).next, 'T1');
  const quoted = { login: BOT, body: 'task-accepted: T1 @ ' + SHA1 }; // a bot comment without a run record
  assert.equal(status(three, [quoted]).next, 'T1');
});

test('the verdict is the last verdict line; a short sha does not accept', () => {
  const msg = `earlier: task-rejected: T1 was wrong\ntask-rejected: T1\nnow fixed\ntask-accepted: T1 @ ${SHA1}`;
  assert.equal(status(three, [run('task-review', 'transition', ['implement'], msg)]).next, 'T2');
  assert.equal(status(three, [accept('T1', 'abc1234')]).next, 'T1');
  // A held task review carries no verdict.
  assert.equal(status(three, [run('task-review', 'hold', [], `task-accepted: T1 @ ${SHA1}`)]).next, 'T1');
});

test('checkDir: one task file per target, Files: coverage, no extra file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tasks-'));
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'targets.json'), JSON.stringify([{ name: 'api', dependsOn: [] }, { name: 'web', dependsOn: [] }]));
  writeFileSync(join(dir, 'plan.md'), '# Plan\n\n## Repository: api\nFiles:\n- `src/a.ts`\n- `src/b.ts` (new)\nBehavior change: yes, x\n\n' +
    '## Repository: web\nFiles: `public/x.js`.\nBehavior change: no, docs\n');
  writeFileSync(join(dir, 'tasks/api.json'), JSON.stringify(doc(step('T1'), final('T2'))));
  writeFileSync(join(dir, 'tasks/old.json'), '{}');
  assert.deepEqual(checkDir(dir), [
    'tasks/old.json: no such entry in targets.json',
    'tasks/api.json: src/b.ts of the Files: list is in no task',
    'tasks/web.json: missing',
  ]);
  writeFileSync(join(dir, 'tasks/api.json'), JSON.stringify(doc(step('T1'), final('T2', ['src/b.ts']))));
  writeFileSync(join(dir, 'tasks/web.json'), JSON.stringify({ ...doc(final('T1', ['public/x.js'])), target: 'web' }));
  rmSync(join(dir, 'tasks/old.json'));
  assert.deepEqual(checkDir(dir), []);
});
