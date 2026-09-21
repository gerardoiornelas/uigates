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
