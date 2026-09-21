import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyze, bootstrap, CRITERIA, format } from './analyze.mjs';
import { rng, shuffled } from './run.mjs';

/**
 * The harness decides whether UI-GATES saves tokens and whether it learns, so the harness has to be
 * right before its answer means anything. These tests use a stand-in for `claude` (test/fake-claude.mjs)
 * to check the parts that do not depend on a real agent: that the control is a control, that a run is
 * never repeated to get a better number, that a treatment which did not happen is flagged, that the
 * verifier cannot drift, and that the verdicts follow the criteria fixed in advance.
 *
 * Run: node --test evaluations/token-ab/token-ab.test.mjs
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const run = path.join(here, 'run.mjs');
const suite = path.join(here, 'test/mini-suite.mjs');

function sandbox(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'token-ab-test-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, 'home'); fs.mkdirSync(home);
  const claude = path.join(dir, 'claude');
  fs.writeFileSync(claude, `#!/bin/sh\nexec node ${JSON.stringify(path.join(here, 'test/fake-claude.mjs'))} "$@"\n`, { mode: 0o755 });
  const log = path.join(dir, 'fake.log');
  const go = (extra = [], env = {}) => spawnSync(process.execPath, [run, '--suite', suite, '--out', path.join(dir, 'out'), '--claude', claude, '--home', home, '--tasks', 't1,t2,t3', ...extra], {
    encoding: 'utf8', env: { ...process.env, FAKE_LOG: log, ...env },
  });
  const rows = () => fs.existsSync(path.join(dir, 'out/results.jsonl')) ? fs.readFileSync(path.join(dir, 'out/results.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  const seen = () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  return { dir, go, rows, seen };
}

test('the order of arms is random but reproducible, and differs by seed', () => {
  const orders = seed => { const r = rng(seed); return ['t1', 't2', 't3', 't4', 't5', 't6'].map(() => shuffled(['control', 'ceremony', 'learned'], r).join('>')); };
  assert.deepEqual(orders(1), orders(1));
  assert.notDeepEqual(orders(1), orders(2));
  assert.ok(new Set(orders(1)).size > 1, 'not the same order every time');
  for (const o of orders(3)) assert.deepEqual(o.split('>').sort(), ['ceremony', 'control', 'learned']);
});

test('a dry run shows the plan and creates nothing', t => {
  const s = sandbox(t);
  const r = spawnSync(process.execPath, [run, '--suite', suite, '--dry-run', '--tasks', 't1,t2', '--seed', '7'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /learning phase: d1, d2/);
  assert.match(r.stdout, /t1 +\w+ > \w+ > \w+/);
  assert.ok(!fs.existsSync(path.join(s.dir, 'out')));
});

test('the verifier is pinned: if it differs from its recorded hash, nothing runs', t => {
  const s = sandbox(t);
  const r = s.go([], { MINI_PIN: '0'.repeat(64) });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /differs from its pinned hash/);
  assert.equal(s.rows().length, 0);
  assert.equal(s.seen().length, 0, 'the agent was never started');
});

test('the control is a control: none of UI-GATES is in its workspace, and the treatment arms have it', t => {
  const s = sandbox(t);
  const r = s.go();
  assert.equal(r.status, 0, r.stderr);
  const ev = s.rows().filter(x => x.phase === 'evaluation');
  assert.equal(ev.length, 9);
  for (const row of ev.filter(x => x.arm === 'control')) assert.deepEqual(row.workspaceContains, [], 'the control workspace holds nothing of UI-GATES');
  for (const row of ev.filter(x => x.arm !== 'control')) {
    assert.ok(row.workspaceContains.includes('.claude'), `${row.arm} has the skill`);
    assert.ok(row.workspaceContains.includes('node_modules/.bin/uigates'), `${row.arm} has the command`);
  }
  const seen = s.seen();
  for (const e of seen.filter(x => x.arm === 'control')) assert.equal(e.slash, false, 'the control is not asked to use the skill');
  for (const e of seen.filter(x => x.arm !== 'control')) assert.equal(e.slash, true);
});

test('only the learned arm sees the ledger, and it holds what the learning phase produced from both discovery tasks', t => {
  const s = sandbox(t);
  assert.equal(s.go().status, 0);
  const seen = s.seen().filter(e => !['d1', 'd2'].includes(e.task));
  for (const e of seen.filter(x => x.arm !== 'learned')) assert.deepEqual(e.ledger, [], `${e.arm} on ${e.task} starts with an empty ledger`);
  for (const e of seen.filter(x => x.arm === 'learned')) assert.deepEqual(e.ledger, ['lesson_d1.md', 'lesson_d2.md'], 'the two discovery lessons were merged, not overwritten');
  const learning = s.rows().filter(x => x.phase === 'learning');
  assert.deepEqual(learning.map(x => x.task), ['d1', 'd2']);
});

test('provider settings are removed from the agent\'s environment', t => {
  const s = sandbox(t);
  assert.equal(s.go(['--tasks', 't1'], { ANTHROPIC_BASE_URL: 'http://127.0.0.1:8787', ANTHROPIC_API_KEY: 'not-real' }).status, 0);
  assert.ok(s.seen().length > 0);
  for (const e of s.seen()) assert.equal(e.sawProviderEnv, false);
});

test('cost comes from the transcript, by the same meter for every arm', t => {
  const s = sandbox(t);
  const profile = { control: { calls: 4, cacheRead: 10000, out: 100 }, ceremony: { calls: 6, cacheRead: 12000, out: 150 }, learned: { calls: 3, cacheRead: 9000, out: 80 } };
  assert.equal(s.go(['--tasks', 't1'], { FAKE_PROFILE: JSON.stringify(profile) }).status, 0);
  const ev = Object.fromEntries(s.rows().filter(x => x.phase === 'evaluation').map(x => [x.arm, x]));
  for (const [arm, p] of Object.entries(profile)) {
    assert.equal(ev[arm].cost.modelCalls, p.calls, arm);
    assert.equal(ev[arm].cost.usage.cacheRead, p.calls * p.cacheRead);
    assert.equal(ev[arm].cost.weighted, Math.round(2 * p.calls + 3000 * 1.25 + p.calls * p.cacheRead * 0.1 + p.calls * p.out * 5));
  }
  assert.ok(ev.ceremony.cost.weighted > ev.control.cost.weighted, 'more turns cost more, and the meter shows it');
});

test('an agent that changed a file it was not allowed to change is not accepted', t => {
  const s = sandbox(t);
  assert.equal(s.go(['--tasks', 't1'], { FAKE_EXTRA: '1' }).status, 0);
  for (const row of s.rows().filter(x => x.phase === 'evaluation')) {
    assert.equal(row.accepted, false, row.arm);
    assert.deepEqual(row.unexpected, ['README.md']);
  }
});

test('a run that fails the independent verifier is recorded as failed, and never rerun', t => {
  const s = sandbox(t);
  assert.equal(s.go(['--tasks', 't1'], { FAKE_NO_WRITE: '1' }).status, 0);
  const first = s.rows();
  assert.ok(first.filter(x => x.phase === 'evaluation').every(x => !x.accepted));
  // The same command again, this time with an agent that would succeed. The failures must stand.
  assert.equal(s.go(['--tasks', 't1'], { FAKE_NO_WRITE: '0' }).status, 0);
  assert.deepEqual(s.rows(), first, 'nothing was rerun and nothing changed');
});

test('a treatment that did not happen is flagged, and per-protocol analysis leaves it out', t => {
  const s = sandbox(t);
  assert.equal(s.go(['--tasks', 't1'], { FAKE_NO_UIGATES: '1' }).status, 0);
  for (const row of s.rows().filter(x => x.phase === 'evaluation' && x.arm !== 'control')) assert.equal(row.compliance.uigatesCommands, 0, row.arm);
  const compliant = sandbox(t);
  assert.equal(compliant.go(['--tasks', 't1']).status, 0);
  for (const row of compliant.rows().filter(x => x.phase === 'evaluation' && x.arm !== 'control')) assert.ok(row.compliance.uigatesCommands >= 1, row.arm);
});

// --- the analysis ---------------------------------------------------------------------------

/** Records for `n` tasks with the given per-arm means and a little deterministic noise. */
function records({ control, ceremony, learned, n = 10, noise = 0.03, accept = () => true, learningCost = 250_000 }) {
  const r = rng(11);
  const jitter = base => Math.round(base * (1 + (r() - 0.5) * 2 * noise));
  const rows = [{ phase: 'learning', task: 'd1', arm: 'ceremony', accepted: true, cost: { weighted: learningCost / 2, modelCalls: 10 }, compliance: { uigatesCommands: 4 }, key: 'learning:d1:ceremony' },
    { phase: 'learning', task: 'd2', arm: 'ceremony', accepted: true, cost: { weighted: learningCost / 2, modelCalls: 10 }, compliance: { uigatesCommands: 4 }, key: 'learning:d2:ceremony' }];
  for (let i = 0; i < n; i++) {
    for (const [arm, base] of [['control', control], ['ceremony', ceremony], ['learned', learned]]) {
      rows.push({ phase: 'evaluation', task: `t${i}`, arm, key: `evaluation:t${i}:${arm}`, accepted: accept(arm, i), cost: { weighted: jitter(base), modelCalls: 20 }, compliance: { uigatesCommands: arm === 'control' ? 0 : 5 } });
    }
  }
  return rows;
}

test('a real learning effect is reported as supported, and so is what it costs to get it', () => {
  const a = analyze(records({ control: 100_000, ceremony: 130_000, learned: 90_000 }));
  assert.equal(a.pairs, 10);
  assert.ok(a.overhead.mean > 0, 'UI-GATES costs something');
  assert.equal(a.learning.verdict, 'SUPPORTED');
  assert.equal(a.net.verdict, 'SUPPORTED', 'learned is cheaper than the plain control too');
  assert.equal(a.net.afterOverheadVerdict, 'NOT SUPPORTED after the cost of learning', '10k saved per task does not repay 250k of learning in 10 tasks');
  assert.ok(a.net.afterOverhead.breakEvenTasks > 10);
});

test('learning that repays its cost is supported after overhead', () => {
  const a = analyze(records({ control: 100_000, ceremony: 110_000, learned: 60_000, learningCost: 100_000 }));
  assert.equal(a.net.afterOverheadVerdict, 'SUPPORTED');
  assert.ok(a.net.afterOverhead.total > 0);
});

test('no difference is not support', () => {
  // Deterministic, so the test does not depend on a lucky draw: learned is 5% above or below the others on alternate tasks.
  const rows = records({ control: 100_000, ceremony: 100_000, learned: 100_000, noise: 0 });
  for (const r of rows.filter(x => x.phase === 'evaluation' && x.arm === 'learned')) r.cost.weighted *= Number(r.task.slice(1)) % 2 ? 1.05 : 0.95;
  const a = analyze(rows);
  assert.equal(a.learning.verdict, 'NOT SUPPORTED (inconclusive)');
  assert.equal(a.net.verdict, 'NOT SUPPORTED (inconclusive)');
});

test('a positive average with a wide interval is not support', () => {
  // Learned is cheaper on average, but by 30% more on some tasks and 30% less on others: the average is not to be trusted.
  const rows = records({ control: 100_000, ceremony: 100_000, learned: 100_000, noise: 0 });
  for (const r of rows.filter(x => x.phase === 'evaluation' && x.arm === 'learned')) r.cost.weighted *= [0.5, 1.3, 0.6, 1.25, 0.7, 1.2, 0.65, 1.3, 0.55, 1.15][Number(r.task.slice(1))];
  const a = analyze(rows);
  assert.ok(a.learning.mean > 0, 'the average does favour learning');
  assert.ok(a.learning.ci.lo <= 0, 'but the interval reaches zero');
  assert.equal(a.learning.verdict, 'NOT SUPPORTED (inconclusive)');
});

test('the average and the win rate can both look good while the interval says not to trust them', () => {
  // Seven tasks save 10k; three cost 20k more. Mean +1k, learned cheaper in 70% of pairs, and yet one bad draw of the
  // three losses wipes out the saving. Only the interval catches it, so the interval is required and the mean is not enough.
  const rows = records({ control: 100_000, ceremony: 100_000, learned: 100_000, noise: 0 });
  for (const r of rows.filter(x => x.phase === 'evaluation' && x.arm === 'learned')) r.cost.weighted = Number(r.task.slice(1)) < 7 ? 90_000 : 120_000;
  const a = analyze(rows);
  assert.ok(a.learning.mean > 0);
  assert.ok(a.learning.winRate >= CRITERIA.winRate, 'the win-rate bar is met');
  assert.ok(a.learning.ci.lo <= 0, `the interval reaches zero: [${a.learning.ci.lo}, ${a.learning.ci.hi}]`);
  assert.equal(a.learning.verdict, 'NOT SUPPORTED (inconclusive)');
});

test('a few large savings are not enough: learned must be cheaper in most pairs', () => {
  const rows = records({ control: 100_000, ceremony: 100_000, learned: 100_000, noise: 0 });
  // Six tasks save a lot, four cost a hair more: the interval clears zero but only 60% of pairs improved.
  for (const r of rows.filter(x => x.phase === 'evaluation' && x.arm === 'learned')) r.cost.weighted = Number(r.task.slice(1)) < 6 ? 60_000 : 101_000;
  const a = analyze(rows);
  assert.ok(a.learning.ci.lo > 0, 'the interval clears zero');
  assert.ok(a.learning.winRate < CRITERIA.winRate, `${a.learning.winRate} of pairs improved`);
  assert.equal(a.learning.verdict, 'NOT SUPPORTED (inconclusive)');
});

test('a learned arm that costs more is reported as contradicted, not as inconclusive', () => {
  const a = analyze(records({ control: 100_000, ceremony: 100_000, learned: 140_000 }));
  assert.match(a.learning.verdict, /^CONTRADICTED/);
});

test('too few pairs gives no verdict, however good the numbers look', () => {
  const a = analyze(records({ control: 100_000, ceremony: 130_000, learned: 50_000, n: CRITERIA.minPairs - 1 }));
  assert.match(a.learning.verdict, /^no verdict: 7 complete pairs, at least 8 needed/);
});

test('arms that got different numbers of tasks right are not comparable on cost', () => {
  const a = analyze(records({ control: 100_000, ceremony: 130_000, learned: 60_000, accept: (arm, i) => !(arm === 'learned' && i < 3) }));
  assert.match(a.learning.verdict, /^no verdict: the arms differ in how many tasks they got right/);
  assert.equal(a.acceptance.learned, '7/10');
  assert.equal(a.pairs, 7, 'only tasks all three arms got right are compared');
});

test('the intention-to-treat verdict counts runs where the agent ignored UI-GATES; per-protocol does not', () => {
  const rows = records({ control: 100_000, ceremony: 130_000, learned: 90_000 });
  for (const r of rows.filter(x => x.phase === 'evaluation' && x.arm === 'learned' && Number(x.task.slice(1)) < 4)) r.compliance.uigatesCommands = 0;
  assert.equal(analyze(rows, { protocol: 'itt' }).pairs, 10);
  assert.equal(analyze(rows, { protocol: 'per-protocol' }).pairs, 6);
  assert.equal(analyze(rows, { protocol: 'itt' }).noncompliant.length, 4);
});

test('the interval is reproducible, brackets the mean, and the criteria cannot be changed at run time', () => {
  const diffs = [10, 12, 9, 15, 11, 8, 14, 10, 13, 12];
  assert.deepEqual(bootstrap(diffs), bootstrap(diffs));
  const ci = bootstrap(diffs);
  const m = diffs.reduce((a, b) => a + b) / diffs.length;
  assert.ok(ci.lo < m && m < ci.hi);
  for (const seed of [1, 2, 3]) { const c = bootstrap(diffs, { seed }); assert.ok(c.lo < m && m < c.hi, `seed ${seed}`); }
  assert.ok(Object.isFrozen(CRITERIA));
  assert.throws(() => { 'use strict'; CRITERIA.minPairs = 1; });
});

test('the report says what each number is and states the verdicts', () => {
  const text = format(analyze(records({ control: 100_000, ceremony: 130_000, learned: 90_000 })));
  assert.match(text, /1\. What UI-GATES costs/);
  assert.match(text, /2\. What learning saves/);
  assert.match(text, /3\. Net for the user/);
  assert.match(text, /verdict after learning cost: NOT SUPPORTED after the cost of learning/);
});
