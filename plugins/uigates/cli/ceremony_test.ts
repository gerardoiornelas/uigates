import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * Every uigates command is a tool call, and every tool call is another turn that re-reads the whole
 * context, so fewer calls is fewer tokens. `propose --authorize` folds two calls into one for delegated
 * work. It must not weaken the gate: it authorizes only what the engine says is delegated, never speaks
 * for the principal, and leaves the proposal on record before the authorization, as two calls would.
 *
 * Run: npx tsx --test plugins/uigates/cli/ceremony_test.ts
 */

const bin = path.resolve(__dirname, '../../../bin/uigates.mjs');
interface Result { status: number | null; out: string; err: string }

function project(t: any) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'uigates-ceremony-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, UIGATES_PRINCIPAL: 'me', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const uig = (args: string[], input?: string): Result => {
    const r = spawnSync(process.execPath, [bin, ...args], { cwd: root, env, encoding: 'utf8', input });
    return { status: r.status, out: r.stdout, err: r.stderr };
  };
  const id = (r: Result, label: string) => {
    const m = new RegExp(`^${label}: (\\S+)`, 'm').exec(r.out);
    assert.ok(m, `no "${label}" in output:\n${r.out}\n${r.err}`);
    return m[1];
  };
  const intent = (domain = 'src/') => id(uig(['start', 'work', '--domain', domain, '--success', 'done', '--no-brief']), 'Intent');
  const propose = (i: string, resource: string, impact: string, ...extra: string[]) =>
    uig(['propose', i, '--action', `edit ${resource}`, '--resource', resource, '--impact', impact, '--rationale', 'needed', '--risk', 'local', '--verify', 'check', ...extra]);
  const records = (dir: string) => fs.readdirSync(path.join(root, '.uigates', dir)).map(f => JSON.parse(fs.readFileSync(path.join(root, '.uigates', dir, f), 'utf8')));
  return { root, uig, id, intent, propose, records };
}

test('a delegated action is proposed and authorized in one call, and the receipt can follow', t => {
  const p = project(t);
  const i = p.intent();
  const r = p.propose(i, 'src/a.js', 'low', '--authorize');
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /^Authority: delegated/m);
  const auth = p.id(r, 'Authorization');
  assert.match(r.out, /State: delegated \(delegated by the intent\)/);
  assert.match(r.out, /Scope: edit src\/a\.js -> src\/a\.js/);
  assert.equal(p.uig(['receipt', auth, '--run', 'node -e "process.exit(0)"']).status, 0);
});

test('the proposal is on record before the authorization, as with two calls', t => {
  const p = project(t);
  const i = p.intent();
  assert.equal(p.propose(i, 'src/a.js', 'low', '--authorize').status, 0);
  const [proposal] = p.records('proposals');
  const [authorization] = p.records('authorizations');
  assert.equal(authorization.proposalId, proposal.id);
  assert.ok(Date.parse(proposal.proposedAt) <= Date.parse(authorization.authorizedAt));
});

test('a gated action is never authorized by --authorize: it waits for the principal', t => {
  const p = project(t);
  const i = p.intent('.gitlab-ci.yml');
  const r = p.propose(i, '.gitlab-ci.yml', 'low', '--authorize');
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /^Authority: gated/m);
  assert.match(r.out, /Next: ask the principal/);
  assert.doesNotMatch(r.out, /^Authorization:/m);
  assert.equal(p.records('authorizations').length, 0, 'nothing was authorized');
  const prop = p.id(r, 'Proposal');
  assert.equal(p.uig(['authorize', prop]).status, 1, 'the agent still cannot approve it itself');
});

test('a medium-impact action is gated too, so --authorize cannot be used to skip the principal', t => {
  const p = project(t);
  const i = p.intent();
  const r = p.propose(i, 'src/a.js', 'medium', '--authorize');
  assert.match(r.out, /^Authority: gated/m);
  assert.equal(p.records('authorizations').length, 0);
});

test('a denied proposal is denied, and --authorize authorizes nothing', t => {
  const p = project(t);
  const i = p.intent('src/');
  const r = p.propose(i, 'docs/x.md', 'low', '--authorize');
  assert.equal(r.status, 1);
  assert.match(r.out, /DENIED \(outside the authorized domain\)/);
  assert.equal(p.records('authorizations').length, 0);
});

test('without --authorize nothing changes: the proposal stops at "Next: uigates authorize"', t => {
  const p = project(t);
  const i = p.intent();
  const r = p.propose(i, 'src/a.js', 'low');
  assert.match(r.out, /Next: uigates authorize prop_/);
  assert.equal(p.records('authorizations').length, 0);
});

test('one call is enough for the write-time hook, so batching stays safe', t => {
  const p = project(t);
  p.uig(['enforce', 'on']);
  const i = p.intent();
  const payload = JSON.stringify({ cwd: p.root, tool_name: 'Write', tool_input: { file_path: path.join(p.root, 'src/a.js') } });
  assert.equal(p.uig(['hook', 'pre-write'], payload).status, 2, 'refused before anything is authorized');
  assert.equal(p.propose(i, 'src/a.js', 'low', '--authorize').status, 0);
  assert.equal(p.uig(['hook', 'pre-write'], payload).status, 0, 'allowed straight after the single call');
});

// --- begin: start and propose --authorize in one call ---------------------------------------

const beginArgs = (over: Record<string, string> = {}) => {
  const f: Record<string, string> = { domain: 'src/', success: 'file exists', action: 'edit a', resource: 'src/a.js', impact: 'low', rationale: 'needed', risk: 'local', verify: 'check', ...over };
  return ['begin', 'work', ...Object.entries(f).flatMap(([k, val]) => [`--${k}`, val])];
};

test('begin starts the intent, proposes and authorizes a delegated action, in one call, in that order', t => {
  const p = project(t);
  const r = p.uig(beginArgs());
  assert.equal(r.status, 0, r.err);
  p.id(r, 'Intent'); p.id(r, 'Proposal');
  const auth = p.id(r, 'Authorization');
  assert.match(r.out, /^Authority: delegated/m);
  const [intent] = p.records('intents'), [proposal] = p.records('proposals'), [authorization] = p.records('authorizations');
  assert.equal(proposal.intentId, intent.id);
  assert.equal(authorization.proposalId, proposal.id);
  assert.ok(Date.parse(intent.createdAt) <= Date.parse(proposal.proposedAt) && Date.parse(proposal.proposedAt) <= Date.parse(authorization.authorizedAt), 'intent, then proposal, then authorization');
  assert.equal(p.uig(['receipt', auth, '--run', 'node -e "process.exit(0)"']).status, 0);
});

test('a missing flag creates nothing: no orphan intent is left behind', t => {
  const p = project(t);
  for (const missing of ['domain', 'success', 'action', 'resource', 'impact', 'rationale', 'risk', 'verify']) {
    const args = beginArgs();
    const i = args.indexOf(`--${missing}`);
    args.splice(i, 2);
    const r = p.uig(args);
    assert.equal(r.status, 2, `without --${missing}`);
    assert.match(r.err, new RegExp(`--${missing}`));
  }
  assert.equal(p.uig(['begin', '--domain', 'src/']).status, 2, 'no goal');
  assert.ok(!fs.existsSync(path.join(p.root, '.uigates/intents')) || p.records('intents').length === 0, 'nothing was written');
  assert.equal(p.uig(beginArgs({ impact: 'huge' })).status, 2);
  assert.ok(!fs.existsSync(path.join(p.root, '.uigates/intents')) || p.records('intents').length === 0, 'a bad impact writes nothing either');
});

test('begin never authorizes gated work: a medium-impact action or a CI file waits for the principal', t => {
  const p = project(t);
  const medium = p.uig(beginArgs({ impact: 'medium' }));
  assert.equal(medium.status, 0, medium.err);
  assert.match(medium.out, /^Authority: gated/m);
  assert.match(medium.out, /Next: ask the principal/);
  const ci = project(t);
  const r = ci.uig(beginArgs({ domain: '.gitlab-ci.yml', resource: '.gitlab-ci.yml' }));
  assert.match(r.out, /^Authority: gated/m);
  for (const x of [p, ci]) assert.equal(x.records('authorizations').length, 0, 'nothing authorized');
});

test('begin refuses an out-of-domain action, and says so', t => {
  const p = project(t);
  const r = p.uig(beginArgs({ resource: 'docs/x.md' }));
  assert.equal(r.status, 1);
  assert.match(r.out, /DENIED \(outside the authorized domain\)/);
  assert.equal(p.records('authorizations').length, 0);
});

test('begin prints the brief for its domain unless told not to', t => {
  const p = project(t);
  assert.match(p.uig(beginArgs()).out, /No verified lessons yet for src/);
  assert.doesNotMatch(p.uig([...beginArgs(), '--no-brief']).out, /No verified lessons yet/);
});

test('begin is enough for the write-time hook', t => {
  const p = project(t);
  p.uig(['enforce', 'on']);
  const payload = JSON.stringify({ cwd: p.root, tool_name: 'Write', tool_input: { file_path: path.join(p.root, 'src/a.js') } });
  assert.equal(p.uig(['hook', 'pre-write'], payload).status, 2);
  assert.equal(p.uig(beginArgs()).status, 0);
  assert.equal(p.uig(['hook', 'pre-write'], payload).status, 0);
});

// --- receipt --synthesize: record and promote in one call ------------------------------------

test('receipt --synthesize records the lesson and promotes it, printing only what changed', t => {
  const p = project(t);
  for (const n of ['x', 'y', 'z']) {
    const i = p.intent();
    const auth = p.id(p.propose(i, `src/${n}.js`, 'low', '--authorize'), 'Authorization');
    assert.equal(p.uig(['receipt', auth, '--run', 'node -e "process.exit(0)"', '--lesson', `Unrelated lesson about ${n} that must not be printed again later.`, '--synthesize']).status, 0);
  }
  const i = p.intent();
  const auth = p.id(p.propose(i, 'src/a.js', 'low', '--authorize'), 'Authorization');
  const r = p.uig(['receipt', auth, '--run', 'node -e "process.exit(0)"', '--lesson', 'Lesson about a: the entry point reads its config first.', '--synthesize']);
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /Promoted lesson/);
  assert.match(r.out, /Knowledge: 4 lesson\(s\) on record/);
  assert.match(r.out, /Done: recorded and synthesized/);
  assert.doesNotMatch(r.out, /Unrelated lesson about/, 'the earlier lessons are not dumped again');
  assert.doesNotMatch(r.out, /Next: uigates synthesize/, 'no separate synthesize call is needed');
  assert.match(p.uig(['knowledge']).out, /Lesson about a/);
});

test('receipt --synthesize on a receipt with no lesson says nothing was promoted, and how to fix it next time', t => {
  const p = project(t);
  const i = p.intent();
  const auth = p.id(p.propose(i, 'src/a.js', 'low', '--authorize'), 'Authorization');
  const r = p.uig(['receipt', auth, '--run', 'node -e "process.exit(0)"', '--synthesize']);
  assert.equal(r.status, 0);
  assert.match(r.out, /Not promoted: .* stated no lesson/);
  assert.match(r.out, /Knowledge: 0 lesson\(s\) on record/);
});

test('receipt --synthesize on a failing receipt still records the failure and still says to replan', t => {
  const p = project(t);
  const i = p.intent();
  const auth = p.id(p.propose(i, 'src/a.js', 'low', '--authorize'), 'Authorization');
  const r = p.uig(['receipt', auth, '--run', 'node -e "process.exit(3)"', '--synthesize']);
  assert.equal(r.status, 1, 'a delta is not success');
  assert.match(r.out, /Next: return to planning/);
  assert.equal(p.records('receipts').length, 1);
});

test('without --synthesize the receipt still points at the separate synthesize call', t => {
  const p = project(t);
  const i = p.intent();
  const auth = p.id(p.propose(i, 'src/a.js', 'low', '--authorize'), 'Authorization');
  assert.match(p.uig(['receipt', auth, '--run', 'node -e "process.exit(0)"', '--lesson', 'A lesson that says something specific about this file.']).out, /Next: uigates synthesize intent_/);
});
