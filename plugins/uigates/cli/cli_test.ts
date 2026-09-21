import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * The CLI is how an agent makes /uig real, and every call is a fresh process. These tests drive it
 * exactly that way, so they prove the engine's rules survive across calls: authority is issued by
 * the engine, evidence is produced by the tool, a receipt spends its authorization once, a delta
 * forces a replan, cumulative risk persists, and synthesis follows the promotion ladder.
 *
 * Run: npx tsx --test plugins/uigates/cli/cli_test.ts
 */

const bin = path.resolve(__dirname, '../../../bin/uig.mjs');
const ok = 'node -e "process.exit(0)"';
const bad = 'node -e "process.exit(3)"';

interface Result { status: number | null; out: string; err: string }

function project(t: any): { root: string; uig: (...args: string[]) => Result; id: (r: Result, label: string) => string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uig-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, UIG_PRINCIPAL: 'gerardo', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const uig = (...args: string[]): Result => {
    const r = spawnSync(process.execPath, [bin, ...args], { cwd: root, env, encoding: 'utf8' });
    return { status: r.status, out: r.stdout, err: r.stderr };
  };
  const id = (r: Result, label: string) => {
    const m = new RegExp(`^${label}: (\\S+)`, 'm').exec(r.out);
    assert.ok(m, `no "${label}" in output:\n${r.out}\n${r.err}`);
    return m[1];
  };
  return { root, uig, id };
}

type P = ReturnType<typeof project>;

const startIntent = (p: P, ...extra: string[]) =>
  p.id(p.uig('start', 'add export', '--domain', 'src/', '--success', 'tests pass', ...extra), 'Intent');

const propose = (p: P, intent: string, over: Record<string, string> = {}) => {
  const f: Record<string, string> = { action: 'use transactions', resource: 'src/a.js', impact: 'low', rationale: 'consistency', risk: 'local', verify: 'run tests', ...over };
  return p.uig('propose', intent, ...Object.entries(f).flatMap(([k, val]) => [`--${k}`, val]));
};

/** One full delegated cycle for an action; returns the receipt result. */
function cycle(p: P, intent: string, command: string, over: Record<string, string> = {}) {
  const prop = p.id(propose(p, intent, over), 'Proposal');
  const auth = p.id(p.uig('authorize', prop), 'Authorization');
  return { prop, auth, receipt: p.uig('receipt', auth, '--run', command) };
}

test('a verified cycle across separate processes becomes a task-level lesson', t => {
  const p = project(t);
  const intent = startIntent(p);
  const { receipt } = cycle(p, intent, ok);
  assert.equal(receipt.status, 0, receipt.err);
  assert.match(receipt.out, /Verified success/);
  const logs = fs.readdirSync(path.join(p.root, '.uig/evidence'));
  assert.equal(logs.length, 1, 'the CLI, not the agent, wrote the evidence');
  assert.match(fs.readFileSync(path.join(p.root, '.uig/evidence', logs[0]), 'utf8'), /exit: 0/);

  const s = p.uig('synthesize', intent);
  assert.equal(s.status, 0, s.err);
  assert.match(s.out, /\[task\/verified\] use transactions/);
  assert.match(p.uig('knowledge').out, /\[task\/verified\]/);
  assert.match(p.uig('status').out, /receipts 1 \(1 delta-free\)/);
});

test('reuse across two intents makes a candidate; only the intent principal promotes it', t => {
  const p = project(t);
  for (let i = 0; i < 2; i++) {
    const intent = startIntent(p);
    assert.equal(cycle(p, intent, ok).receipt.status, 0);
    assert.equal(p.uig('synthesize', intent).status, 0);
  }
  const k = p.uig('knowledge').out;
  assert.match(k, /candidate for Knowledge/);
  assert.match(k, /needs principal/);

  assert.notEqual(p.uig('approve', 'knowledge', 'use transactions', '--principal', 'mallory').status, 0);
  assert.notEqual(p.uig('approve', 'canon', 'use transactions', '--principal', 'gerardo').status, 0, 'canon cannot skip knowledge');
  assert.equal(p.uig('approve', 'knowledge', 'use transactions', '--principal', 'gerardo').status, 0);
  assert.match(p.uig('knowledge').out, /\[knowledge\/verified\]/);
});

test('a single intent is never enough for Knowledge', t => {
  const p = project(t);
  const intent = startIntent(p);
  cycle(p, intent, ok);
  p.uig('synthesize', intent);
  const r = p.uig('approve', 'knowledge', 'use transactions', '--principal', 'gerardo');
  assert.notEqual(r.status, 0);
  assert.match(r.err, /more than one task/);
});

test('a failed verification records a delta and forces a replan before any retry', t => {
  const p = project(t);
  const intent = startIntent(p);
  const first = cycle(p, intent, bad, { task: 'export' });
  assert.equal(first.receipt.status, 1, 'a delta must not look like success');
  assert.match(first.receipt.out, /exit code 3/);
  const receiptId = p.id(first.receipt, 'Receipt');

  const naive = propose(p, intent, { task: 'export' });
  assert.equal(naive.status, 1);
  assert.match(naive.out, /Return to planning/);

  const replanned = p.uig('propose', intent, '--action', 'use transactions', '--resource', 'src/a.js', '--impact', 'low', '--rationale', 'retry', '--risk', 'local',
    '--verify', 'run tests', '--task', 'export', '--replan-after', receiptId, '--root-cause', 'test fixture was stale', '--revision', 'regenerate the fixture first');
  assert.equal(replanned.status, 0, replanned.out + replanned.err);
  assert.match(replanned.out, /Authority: delegated/);

  const wrongCitation = p.uig('propose', intent, '--action', 'use transactions', '--resource', 'src/a.js', '--impact', 'low', '--rationale', 'retry', '--risk', 'local',
    '--verify', 'run tests', '--task', 'export', '--replan-after', 'rec_other', '--root-cause', 'x'.repeat(5), '--revision', 'y'.repeat(5));
  assert.equal(wrongCitation.status, 1, 'a replan must cite the failing receipt');
});

test('a later failure conflicts a verified lesson and withholds the recommendation', async t => {
  const p = project(t);
  const a = startIntent(p);
  cycle(p, a, ok);
  p.uig('synthesize', a);
  await new Promise(r => setTimeout(r, 15));
  const b = startIntent(p);
  cycle(p, b, bad);
  const s = p.uig('synthesize', b);
  assert.match(s.out, /\[task\/conflicted\] use transactions/);
  assert.match(s.out, /failures: exit code 3/);
});

test('gated actions cannot be self-approved', t => {
  const p = project(t);
  const intent = startIntent(p);
  const prop = p.id(propose(p, intent, { impact: 'medium' }), 'Proposal');
  assert.match(p.uig('propose', intent, '--action', 'x', '--resource', 'src/a.js', '--impact', 'medium', '--rationale', 'r', '--risk', 'r', '--verify', 'v').out, /Authority: gated/);

  const none = p.uig('authorize', prop);
  assert.equal(none.status, 1);
  assert.match(none.err, /may not approve its own gated action/);
  assert.equal(p.uig('authorize', prop, '--approved-by', 'mallory').status, 1);
  assert.equal(fs.readdirSync(path.join(p.root, '.uig/authorizations')).length, 0);

  const approved = p.uig('authorize', prop, '--approved-by', 'gerardo');
  assert.equal(approved.status, 0, approved.err);
  assert.match(approved.out, /State: gated \(approved by gerardo\)/);
  assert.match(p.uig('authorize', prop).out, /Already authorized/, 'authorizing twice does not issue a second authority');
});

test('scope, audit records and traversal are refused', t => {
  const p = project(t);
  const intent = startIntent(p);
  for (const resource of ['docs/readme.md', '../outside', '/etc/hosts', 'src/../../escape', '.uig/receipts/x.json']) {
    const r = propose(p, intent, { resource });
    assert.equal(r.status, 1, `${resource} should be denied`);
    assert.match(r.out, /DENIED/);
  }
  const bogus = p.uig('propose', '../../etc/passwd', '--action', 'a', '--resource', 'src/a', '--impact', 'low', '--rationale', 'r', '--risk', 'r', '--verify', 'v');
  assert.notEqual(bogus.status, 0);
  assert.match(bogus.err, /Invalid record id/);
});

test('an expired intent grants nothing', t => {
  const p = project(t);
  const intent = p.id(p.uig('start', 'short', '--domain', 'src/', '--success', 'x', '--expires-in-hours', '0.0000001'), 'Intent');
  const r = propose(p, intent);
  assert.equal(r.status, 1);
  assert.match(r.out, /expired/);
});

test('an authorization is spent by one receipt', t => {
  const p = project(t);
  const intent = startIntent(p);
  const { auth } = cycle(p, intent, ok);
  const again = p.uig('receipt', auth, '--run', ok);
  assert.notEqual(again.status, 0);
  assert.match(again.err, /already has a receipt/);
});

test('evidence must exist, live inside the project, and stay unmodified', t => {
  const p = project(t);
  const intent = startIntent(p);
  const prop = p.id(propose(p, intent), 'Proposal');
  const auth = p.id(p.uig('authorize', prop), 'Authorization');

  assert.match(p.uig('receipt', auth, '--evidence', 'nope.log', '--outcome', 'Verified success', '--delta', 'None').err, /not found/);
  const outside = path.join(os.tmpdir(), `uig-outside-${process.pid}.log`);
  fs.writeFileSync(outside, 'x');
  t.after(() => fs.rmSync(outside, { force: true }));
  assert.match(p.uig('receipt', auth, '--evidence', outside, '--outcome', 'Verified success', '--delta', 'None').err, /inside the project root/);

  fs.writeFileSync(path.join(p.root, 'proof.txt'), 'all checks passed');
  const manual = p.uig('receipt', auth, '--evidence', 'proof.txt', '--outcome', 'Verified success', '--delta', 'None');
  assert.equal(manual.status, 0, manual.err);
  assert.match(manual.out, /asserted by the agent/);

  fs.writeFileSync(path.join(p.root, 'proof.txt'), 'tampered after the fact');
  const s = p.uig('synthesize', intent);
  assert.match(s.out, /Knowledge: none yet/, 'modified evidence must not become a lesson');
});

test('a forged authorization file cannot back a receipt', t => {
  const p = project(t);
  const intent = startIntent(p);
  const prop = p.id(propose(p, intent, { impact: 'medium' }), 'Proposal');
  const forged = { id: 'auth_forged', proposalId: prop, authorizedBy: 'mallory', state: 'gated', authorizedAt: new Date(), actorId: 'agent', intentId: intent, action: 'use transactions', resource: 'src/a.js' };
  fs.writeFileSync(path.join(p.root, '.uig/authorizations/auth_forged.json'), JSON.stringify(forged));
  const r = p.uig('receipt', 'auth_forged', '--run', ok);
  assert.notEqual(r.status, 0);
  assert.match(r.err, /not signed by the intent's principal/);
});

test('cumulative risk persists across processes and escalates later work', t => {
  const p = project(t);
  const intent = startIntent(p);
  for (const action of ['a1', 'a2']) {
    const prop = p.id(propose(p, intent, { action, impact: 'high' }), 'Proposal');
    assert.equal(p.uig('authorize', prop, '--approved-by', 'gerardo').status, 0);
  }
  const low = propose(p, intent, { action: 'tiny', impact: 'low' });
  assert.match(low.out, /Authority: gated/);
  assert.match(low.out, /Cumulative risk/);
});

test('an intent needs a principal, a domain and success evidence', t => {
  const p = project(t);
  const noPrincipal = spawnSync(process.execPath, [bin, 'start', 'g', '--domain', 'src/', '--success', 'x'], {
    cwd: p.root, encoding: 'utf8', env: { ...process.env, UIG_PRINCIPAL: '', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  });
  assert.notEqual(noPrincipal.status, 0);
  assert.match(noPrincipal.stderr, /No principal/);
  assert.match(p.uig('start', 'g', '--success', 'x').err, /Missing --domain/);
  assert.match(p.uig('start', 'g', '--domain', 'src/').err, /Missing --success/);
});

test('an out-of-domain proposal is DENIED with what to do next, not just called prohibited', t => {
  const p = project(t);
  const intent = startIntent(p);
  const r = propose(p, intent, { resource: 'docs/readme.md' });
  assert.equal(r.status, 1);
  assert.match(r.out, /Authority: DENIED \(outside the authorized domain\)/);
  assert.match(r.out, /Next: This is not a prohibition\. Propose a project-relative path inside the intent's domain/);
  assert.doesNotMatch(r.out, /Authority: prohibited/);
});

test('an absolute scratch path is refused with the reason it can never be in a domain', t => {
  const p = project(t);
  const intent = startIntent(p);
  const r = propose(p, intent, { resource: '/private/tmp/scratch/verify.py' });
  assert.equal(r.status, 1);
  assert.match(r.out, /DENIED \(outside the authorized domain\)/);
  assert.match(r.out, /not a project-relative path: absolute paths and '\.\.' escapes are never inside a domain/);
});

test('a protected record is the one denial still called a prohibition', t => {
  const p = project(t);
  const intent = p.id(p.uig('start', 'x', '--domain', '/', '--success', 'y'), 'Intent');
  const r = propose(p, intent, { resource: '.uig/receipts/rec_1.json' });
  assert.equal(r.status, 1);
  assert.match(r.out, /DENIED \(prohibited: protected record\)/);
  assert.match(r.out, /Do not retry/);
});
