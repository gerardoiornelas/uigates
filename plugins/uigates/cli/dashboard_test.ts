import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * `uigates dashboard` composes status, knowledge and cost into one read-only view: gates a
 * proposal is still waiting on, gates cleared, knowledge packs, and (when transcripts are given)
 * token cost. It exists so a person working a real repository does not have to run four commands.
 *
 * Run: npx tsx --test plugins/uigates/cli/dashboard_test.ts
 */

const bin = path.resolve(__dirname, '../../../bin/uigates.mjs');
const ok = 'node -e "process.exit(0)"';

interface Result { status: number | null; out: string; err: string }

function project(t: any) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uigates-dash-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, UIGATES_PRINCIPAL: 'gerardo', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const uigates = (...args: string[]): Result => {
    const r = spawnSync(process.execPath, [bin, ...args], { cwd: root, env, encoding: 'utf8' });
    return { status: r.status, out: r.stdout, err: r.stderr };
  };
  const id = (r: Result, label: string) => {
    const m = new RegExp(`^${label}: (\\S+)`, 'm').exec(r.out);
    assert.ok(m, `no "${label}" in output:\n${r.out}\n${r.err}`);
    return m[1];
  };
  const dashboard = () => {
    const r = uigates('dashboard', '--json');
    assert.equal(r.status, 0, r.err);
    return JSON.parse(r.out);
  };
  return { root, uigates, id, dashboard };
}

const startIntent = (p: ReturnType<typeof project>, ...extra: string[]) =>
  p.id(p.uigates('start', 'add export', '--domain', 'src/', '--success', 'tests pass', '--no-brief', ...extra), 'Intent');

const propose = (p: ReturnType<typeof project>, intent: string, over: Record<string, string> = {}) => {
  const f: Record<string, string> = { action: 'use transactions', resource: 'src/a.js', impact: 'low', rationale: 'consistency', risk: 'local', verify: 'run tests', ...over };
  return p.uigates('propose', intent, ...Object.entries(f).flatMap(([k, val]) => [`--${k}`, val]));
};

test('an empty project has an empty dashboard, cleanly', t => {
  const p = project(t);
  const d = p.dashboard();
  assert.deepEqual(d.intents, []);
  assert.deepEqual(d.gates.remaining, []);
  assert.deepEqual(d.gates.accomplished, []);
  assert.equal(d.gates.counts.remaining, 0);
  assert.equal(d.knowledge.counts.total, 0);
  assert.match(p.uigates('dashboard').out, /Intents: 0/);
});

test('a fresh proposal with low impact is awaiting-authorize, not gated and not accomplished', t => {
  const p = project(t);
  const intent = startIntent(p);
  p.id(propose(p, intent), 'Proposal');
  const d = p.dashboard();
  assert.equal(d.gates.remaining.length, 1);
  assert.equal(d.gates.remaining[0].status, 'awaiting-authorize');
  assert.equal(d.gates.remaining[0].authorizationId, undefined);
  assert.equal(d.gates.counts.remaining, 1);
  assert.equal(d.gates.counts.awaitingPrincipal, 0);
  assert.deepEqual(d.gates.accomplished, []);
});

test('a medium-impact proposal not yet authorized is awaiting-principal, with a reason, and counted separately', t => {
  const p = project(t);
  const intent = startIntent(p);
  p.id(propose(p, intent, { impact: 'medium' }), 'Proposal');
  const d = p.dashboard();
  assert.equal(d.gates.remaining.length, 1);
  assert.equal(d.gates.remaining[0].status, 'awaiting-principal');
  assert.ok(d.gates.remaining[0].reason?.length > 0);
  assert.equal(d.gates.counts.remaining, 1);
  assert.equal(d.gates.counts.awaitingPrincipal, 1);
});

test('authorized but not yet receipted is its own state, awaiting-receipt, with the authorization id', t => {
  const p = project(t);
  const intent = startIntent(p);
  const prop = p.id(propose(p, intent), 'Proposal');
  const auth = p.id(p.uigates('authorize', prop), 'Authorization');
  const d = p.dashboard();
  assert.equal(d.gates.remaining.length, 1);
  assert.equal(d.gates.remaining[0].status, 'awaiting-receipt');
  assert.equal(d.gates.remaining[0].authorizationId, auth);
  assert.equal(d.gates.counts.remaining, 1);
  assert.deepEqual(d.gates.accomplished, [], 'not accomplished until a receipt exists');
});

test('a receipt clears the gate into accomplished, and it leaves remaining', t => {
  const p = project(t);
  const intent = startIntent(p);
  const prop = p.id(propose(p, intent), 'Proposal');
  const auth = p.id(p.uigates('authorize', prop), 'Authorization');
  assert.equal(p.uigates('receipt', auth, '--run', ok, '--lesson', 'wrap the writes in one transaction so a failure rolls the whole change back').status, 0);
  const d = p.dashboard();
  assert.deepEqual(d.gates.remaining, []);
  assert.equal(d.gates.accomplished.length, 1);
  const row = d.gates.accomplished[0];
  assert.equal(row.authorizationId, auth);
  assert.equal(row.authority, 'delegated');
  assert.equal(row.lesson, true);
  assert.equal(d.gates.counts.accomplished, 1);
  assert.equal(d.gates.counts.gatedGranted, 0);
  assert.deepEqual(d.gates.failures, []);
});

test('a receipt with no lesson is accomplished but marked lesson: false, and is not knowledge', t => {
  const p = project(t);
  const intent = startIntent(p);
  const prop = p.id(propose(p, intent), 'Proposal');
  const auth = p.id(p.uigates('authorize', prop), 'Authorization');
  assert.equal(p.uigates('receipt', auth, '--run', ok, '--synthesize').status, 0);
  const d = p.dashboard();
  assert.equal(d.gates.accomplished[0].lesson, false);
  assert.equal(d.knowledge.counts.total, 0);
});

test('a failed verification is a delta: its own bucket, not accomplished, and not remaining either (it needs a replan, not a receipt)', t => {
  const p = project(t);
  const intent = startIntent(p);
  const prop = p.id(propose(p, intent, { task: 'export' }), 'Proposal');
  const auth = p.id(p.uigates('authorize', prop), 'Authorization');
  p.uigates('receipt', auth, '--run', 'node -e "process.exit(3)"');
  const d = p.dashboard();
  assert.deepEqual(d.gates.remaining, []);
  assert.deepEqual(d.gates.accomplished, [], 'a delta receipt exists but is not a clean clearance');
  assert.equal(d.gates.failures.length, 1);
  assert.equal(d.gates.failures[0].authorizationId, auth);
  assert.match(d.gates.failures[0].delta, /exit code 3/);
  assert.equal(d.gates.counts.failures, 1);
  assert.match(p.uigates('dashboard').out, /Gates failed.*: 1/);
});

test('a gated authorization, once granted, is marked gated in accomplished', t => {
  const p = project(t);
  const intent = startIntent(p);
  const prop = p.id(propose(p, intent, { impact: 'medium' }), 'Proposal');
  const auth = p.id(p.uigates('authorize', prop, '--approved-by', 'gerardo'), 'Authorization');
  p.uigates('receipt', auth, '--run', ok, '--lesson', 'wrap the writes in one transaction so a failure rolls the whole change back');
  const d = p.dashboard();
  assert.equal(d.gates.accomplished[0].authority, 'gated');
  assert.equal(d.gates.counts.gatedGranted, 1);
});

test('an out-of-domain proposal is denied, reported but excluded from the remaining count', t => {
  const p = project(t);
  const intent = startIntent(p);
  propose(p, intent, { resource: 'docs/readme.md' });
  const d = p.dashboard();
  assert.equal(d.gates.remaining.length, 1);
  assert.equal(d.gates.remaining[0].status, 'denied');
  assert.match(d.gates.remaining[0].reason, /outside the authorized domain/);
  assert.equal(d.gates.counts.remaining, 0, 'a denied proposal is not open work waiting on anyone');
});

test('an expired intent\'s pending proposal is denied, not silently dropped', t => {
  const p = project(t);
  const intent = p.id(p.uigates('start', 'short', '--domain', 'src/', '--success', 'x', '--expires-in-hours', '0.0000001', '--no-brief'), 'Intent');
  propose(p, intent);
  const d = p.dashboard();
  assert.equal(d.gates.remaining.length, 1);
  assert.equal(d.gates.remaining[0].status, 'denied');
  assert.match(d.gates.remaining[0].reason, /expired/);
});

test('a proposal whose intent record has vanished is reported as denied, not treated as awaiting anything', t => {
  const p = project(t);
  const intent = startIntent(p);
  propose(p, intent);
  fs.rmSync(path.join(p.root, '.uigates', 'intents', `${intent}.json`));
  const d = p.dashboard();
  assert.equal(d.gates.remaining.length, 1);
  assert.equal(d.gates.remaining[0].status, 'denied');
  assert.match(d.gates.remaining[0].reason, /intent no longer exists/);
  assert.equal(d.gates.counts.remaining, 0);
});

test('an authorization outside delegated/gated (a forged or corrupted record) is never counted as accomplished', t => {
  const p = project(t);
  const intent = startIntent(p);
  const authId = 'auth_forged1';
  fs.writeFileSync(path.join(p.root, '.uigates', 'authorizations', `${authId}.json`), JSON.stringify({
    id: authId, proposalId: 'prop_none', authorizedBy: 'gerardo', state: 'observe',
    authorizedAt: new Date(), actorId: 'agent', intentId: intent, action: 'peek', resource: 'src/a.js',
  }));
  fs.writeFileSync(path.join(p.root, '.uigates', 'receipts', 'rec_forged1.json'), JSON.stringify({
    id: 'rec_forged1', authorizationId: authId, intentId: intent, actorId: 'agent', actionPerformed: 'peek',
    expectedOutcome: 'x', actualOutcome: 'Verified success', delta: 'None', evidence: ['sha256:x:x'], verifiedAt: new Date(),
  }));
  const d = p.dashboard();
  assert.deepEqual(d.gates.accomplished, [], 'observe is not a state the CLI ever authorizes real work under');
  assert.deepEqual(d.gates.failures, []);
});

test('a receipt with a whitespace-only lesson does not count as having a lesson', t => {
  const p = project(t);
  const intent = startIntent(p);
  const prop = p.id(propose(p, intent), 'Proposal');
  const auth = p.id(p.uigates('authorize', prop), 'Authorization');
  const [receiptFile] = fs.readdirSync(path.join(p.root, '.uigates', 'receipts'));
  assert.equal(p.uigates('receipt', auth, '--run', ok).status, 0);
  const [file] = fs.readdirSync(path.join(p.root, '.uigates', 'receipts'));
  const recordPath = path.join(p.root, '.uigates', 'receipts', file);
  const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  record.lesson = '   ';
  fs.writeFileSync(recordPath, JSON.stringify(record));
  const d = p.dashboard();
  assert.equal(d.gates.accomplished[0].lesson, false);
});

test('an action or resource with HTML in it is escaped in the generated page, not injected raw', t => {
  const p = project(t);
  const intent = startIntent(p);
  propose(p, intent, { action: '<script>alert(1)</script>', impact: 'medium' });
  const out = path.join(p.root, 'report.html');
  assert.equal(p.uigates('dashboard', '--html', out).status, 0);
  const html = fs.readFileSync(out, 'utf8');
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/, 'the action text must not appear as a live script tag');
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('a promoted lesson shows up in knowledge, with the pack fields dashboard reads', t => {
  const p = project(t);
  const intent = startIntent(p);
  const prop = p.id(propose(p, intent), 'Proposal');
  const auth = p.id(p.uigates('authorize', prop), 'Authorization');
  p.uigates('receipt', auth, '--run', ok, '--lesson', 'wrap the writes in one transaction so a failure rolls the whole change back', '--synthesize');
  const d = p.dashboard();
  assert.equal(d.knowledge.counts.total, 1);
  assert.equal(d.knowledge.counts.verified, 1);
  assert.equal(d.knowledge.counts.candidates, 0);
  assert.equal(d.knowledge.packs[0].action, 'use transactions');
  assert.match(p.uigates('dashboard').out, /use transactions/);
});

test('two intents reusing an action make a knowledge candidate, and dashboard says so', t => {
  const p = project(t);
  for (let i = 0; i < 2; i++) {
    const intent = startIntent(p);
    const prop = p.id(propose(p, intent), 'Proposal');
    const auth = p.id(p.uigates('authorize', prop), 'Authorization');
    p.uigates('receipt', auth, '--run', ok, '--lesson', `advice number ${i} about wrapping writes in one transaction`, '--synthesize');
  }
  const d = p.dashboard();
  assert.equal(d.knowledge.counts.candidates, 1);
  assert.equal(d.knowledge.counts.needsPrincipal, 1);
});

test('with no transcripts to find, cost is omitted, and the text view says so plainly', t => {
  const p = project(t);
  const d = p.dashboard();
  assert.equal(d.cost, undefined);
  assert.match(p.uigates('dashboard').out, /no transcripts found/);
});

test('--transcripts points at a given file, and cost appears with it', t => {
  const p = project(t);
  const transcript = path.join(p.root, 'session.jsonl');
  const line = JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { role: 'assistant', id: 'msg_1', model: 'x', usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, content: [] } });
  fs.writeFileSync(transcript, `${line}\n`);
  const r = p.uigates('dashboard', '--json', '--transcripts', transcript);
  assert.equal(r.status, 0, r.err);
  const d = JSON.parse(r.out);
  assert.ok(d.cost, r.out);
  assert.equal(d.cost.transcriptsUsed.length, 1);
  assert.ok(d.cost.totalWeighted > 0);
});

test('--html writes a self-contained page with no external references, and prints where', t => {
  const p = project(t);
  const intent = startIntent(p);
  p.id(propose(p, intent, { impact: 'medium' }), 'Proposal');
  const out = path.join(p.root, 'report.html');
  const r = p.uigates('dashboard', '--html', out);
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, new RegExp(out.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const html = fs.readFileSync(out, 'utf8');
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /awaiting principal/);
  assert.doesNotMatch(html, /https?:\/\//, 'no external script, stylesheet or fetch');
  assert.doesNotMatch(html, /<script[^>]+src=/);
  assert.equal(fs.readdirSync(p.root).filter(f => f.endsWith('.html')).length, 1);
});

test('--html and --json together write the file and also print the JSON', t => {
  const p = project(t);
  const out = path.join(p.root, 'report.html');
  const r = p.uigates('dashboard', '--html', out, '--json');
  assert.equal(r.status, 0, r.err);
  assert.ok(fs.existsSync(out));
  assert.match(r.out, /^Wrote /m, 'the write confirmation still prints');
  const jsonLine = r.out.slice(r.out.indexOf('\n') + 1);
  JSON.parse(jsonLine); // does not throw
});

test('dashboard never writes to the state directory', t => {
  const p = project(t);
  const intent = startIntent(p);
  p.id(propose(p, intent), 'Proposal');
  const before = fs.readdirSync(path.join(p.root, '.uigates', 'proposals')).sort();
  p.uigates('dashboard', '--json');
  const after = fs.readdirSync(path.join(p.root, '.uigates', 'proposals')).sort();
  assert.deepEqual(before, after);
});
