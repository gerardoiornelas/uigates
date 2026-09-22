import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { locationOf } from '../intelligence/ce/synthesizer';
import { overlap } from '../intelligence/ce/brief';

/**
 * The brief is the piece meant to save tokens: an agent is told where earlier verified work happened,
 * so it starts there instead of searching. It has to be selected by location, capped by a budget that
 * does not grow with the ledger, honest about what a lesson is, and cheap when there is nothing to say.
 *
 * Run: npx tsx --test plugins/uigates/cli/brief_test.ts
 */

const bin = path.resolve(__dirname, '../../../bin/uigates.mjs');
interface Result { status: number | null; out: string; err: string }

function project(t: any) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'uigates-brief-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, UIGATES_PRINCIPAL: 'me', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const uig = (...args: string[]): Result => {
    const r = spawnSync(process.execPath, [bin, ...args], { cwd: root, env, encoding: 'utf8' });
    return { status: r.status, out: r.stdout, err: r.stderr };
  };
  const id = (r: Result, label: string) => {
    const m = new RegExp(`^${label}: (\\S+)`, 'm').exec(r.out);
    assert.ok(m, `no "${label}" in output:\n${r.out}\n${r.err}`);
    return m[1];
  };
  const write = (file: string, text = 'x\n') => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };
  const verifier = (file: string) => `node -e "process.exit(require('fs').existsSync('${file}') ? 0 : 1)"`;
  const intent = () => id(uig('start', 'work', '--domain', '/', '--success', 'done', '--no-brief'), 'Intent');
  /** One verified action on one file, with a stated lesson. Call `synthesize` once afterwards. */
  const learn = (inIntent: string, resource: string, action: string, lesson: string, command = verifier(resource)) => {
    write(resource);
    const prop = id(uig('propose', inIntent, '--action', action, '--resource', resource, '--impact', 'low', '--rationale', 'r', '--risk', 'r', '--verify', 'check'), 'Proposal');
    const auth = id(uig('authorize', prop), 'Authorization');
    return uig('receipt', auth, '--run', command, '--lesson', lesson);
  };
  const synth = (i: string) => assert.equal(uig('synthesize', i).status, 0);
  const brief = (paths: string, ...extra: string[]) => uig('brief', '--paths', paths, ...extra);
  return { root, uig, id, write, intent, learn, synth, brief };
}

test('a location is a specific project-relative path, or nothing', () => {
  assert.equal(locationOf('src/a.js'), 'src/a.js');
  assert.equal(locationOf('./src//a.js/'), 'src/a.js');
  assert.equal(locationOf('src\\a.js'), 'src/a.js');
  for (const not of ['.', '/', '', '..', '../x', '/etc/hosts', 'C:/x', '.uigates/receipts/r.json', 'a/.uig/x']) assert.equal(locationOf(not), null, not);
});

test('two locations overlap by being the same, nested, or side by side', () => {
  assert.equal(overlap('src/a.js', 'src/a.js'), 3);
  assert.equal(overlap('src', 'src/a.js'), 2);
  assert.equal(overlap('src/a/b.js', 'src/a'), 2);
  assert.equal(overlap('src/a.js', 'src/b.js'), 1);
  assert.equal(overlap('src/a.js', 'docs/a.js'), 0);
  assert.equal(overlap('srcx/a.js', 'src/a.js'), 0, 'a shared prefix is not a shared directory');
});

test('a verified lesson remembers where the work happened; a project-wide resource says nothing about where', t => {
  const p = project(t);
  const i = p.intent();
  assert.equal(p.learn(i, 'src/a.js', 'edit a', 'Keep the parser and the printer in this one file so tests see both.').status, 0);
  const wide = p.uig('propose', i, '--action', 'edit everything', '--resource', '.', '--impact', 'low', '--rationale', 'r', '--risk', 'r', '--verify', 'check');
  assert.equal(p.uig('receipt', p.id(p.uig('authorize', p.id(wide, 'Proposal')), 'Authorization'), '--run', 'node -e "process.exit(0)"', '--lesson', 'A project-wide change has no single place worth remembering.').status, 0);
  p.synth(i);
  const k = p.uig('knowledge').out;
  assert.match(k, /files: src\/a\.js/);
  const wideBlock = k.split('\n').filter(l => /edit everything|files:/.test(l));
  assert.equal(wideBlock.filter(l => /files:/.test(l)).length, 1, 'only the specific file was recorded');
});

test('the brief is selected by location: the same file first, the same directory next, the rest left out', t => {
  const p = project(t);
  const i = p.intent();
  p.learn(i, 'src/a.js', 'edit a', 'Lesson about a: the entry point reads its config before anything else.');
  p.learn(i, 'src/b.js', 'edit b', 'Lesson about b: it is only ever called through the entry point.');
  p.learn(i, 'docs/x.md', 'edit x', 'Lesson about x: the docs build fails on a bare link.');
  p.synth(i);
  const r = p.brief('src/a.js');
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /Lesson about a/);
  assert.match(r.out, /Lesson about b/);
  assert.doesNotMatch(r.out, /Lesson about x/, 'docs/ is unrelated to src/a.js');
  assert.ok(r.out.indexOf('Lesson about a') < r.out.indexOf('Lesson about b'), 'the same file outranks the same directory');
  assert.match(r.out, /the agent's claim/, 'advice is labelled as a claim, not a fact');
  assert.match(r.out, /A receipt proves the action worked, not that its advice is right/);
});

test('when nothing is relevant the brief is one short line, and does not dump the ledger', t => {
  const p = project(t);
  const i = p.intent();
  for (const f of ['docs/a.md', 'docs/b.md', 'docs/c.md']) p.learn(i, f, `edit ${f}`, `Lesson for ${f}: this text must not appear in an unrelated brief.`);
  p.synth(i);
  const r = p.brief('src/a.js', '--json');
  const brief = JSON.parse(r.out);
  assert.equal(brief.relevant, 0);
  assert.equal(brief.total, 3);
  assert.match(brief.text, /No verified lessons yet for src\/a\.js \(3 elsewhere\)/);
  assert.doesNotMatch(brief.text, /must not appear/);
  assert.ok(brief.tokens < 40, `${brief.tokens} tokens`);
});

test('the budget holds however large the ledger grows', t => {
  const p = project(t);
  const size = () => JSON.parse(p.brief('src/a.js', '--budget', '160', '--json').out);
  // Several intents, as a real ledger has: one intent's cumulative risk escalates to gated after 15 points of work.
  const add = (from: number, to: number) => {
    for (let n = from; n < to; n += 6) {
      const i = p.intent();
      for (let k = n; k < Math.min(n + 6, to); k++) p.learn(i, `src/f${k}.js`, `edit f${k}`, `Lesson ${k}: something specific about file ${k} that a later agent would want to know first.`);
      p.synth(i);
    }
  };
  add(0, 8);
  const small = size();
  add(8, 20);
  const large = size();
  assert.equal(small.relevant, 8);
  assert.equal(large.relevant, 20);
  for (const b of [small, large]) {
    assert.ok(b.tokens <= 160, `${b.tokens} tokens against a budget of 160`);
    assert.ok(b.included < b.relevant, 'not everything fits');
    assert.match(b.text, /more relevant; `uigates knowledge` lists all/);
  }
  assert.ok(large.tokens <= small.tokens + 25, `12 more lessons must not make the brief bigger (${small.tokens} to ${large.tokens})`);
});

test('every budget is respected, including ones too small for a second lesson', t => {
  const p = project(t);
  for (let n = 0; n < 12; n += 6) {
    const i = p.intent();
    for (let k = n; k < n + 6; k++) p.learn(i, `src/f${k}.js`, `edit f${k}`, `Lesson ${k}: something specific about file ${k} that a later agent would want to know first.`);
    p.synth(i);
  }
  for (const budget of [70, 100, 140, 200, 300]) {
    const b = JSON.parse(p.brief('src/f0.js', '--budget', String(budget), '--json').out);
    assert.ok(b.tokens <= budget, `${b.tokens} tokens against a budget of ${budget}`);
    assert.ok(b.included >= 1, 'a brief with room for one lesson gives one');
  }
});

test('where the work happened outranks how established a lesson is', t => {
  const p = project(t);
  // Knowledge level needs the same action verified in two intents and a principal's approval.
  for (let n = 0; n < 2; n++) { const i = p.intent(); p.learn(i, 'src/b.js', 'edit b', 'Established lesson about b: verified twice and approved by the principal.'); p.synth(i); }
  assert.equal(p.uig('approve', 'knowledge', 'edit b', '--principal', 'me').status, 0);
  const only = p.intent();
  p.learn(only, 'src/a.js', 'edit a', 'Exact-file lesson about a: only verified once, at task level.');
  p.synth(only);
  const r = p.brief('src/a.js').out;
  assert.match(r, /\[knowledge\] edit b/, 'the level is shown');
  assert.ok(r.indexOf('Exact-file lesson about a') < r.indexOf('Established lesson about b'), 'the file the agent is about to touch comes first');
});

test('a lesson that later failed is a warning where it is close, and is left out where it is only nearby', t => {
  const p = project(t);
  const first = p.intent();
  p.learn(first, 'src/a.js', 'edit a', 'Lesson that later turned out wrong: do it this way every time.');
  p.synth(first);
  const second = p.intent();
  assert.equal(p.learn(second, 'src/a.js', 'edit a', 'Second attempt at the same action, which fails this time.', 'node -e "process.exit(3)"').status, 1);
  p.synth(second);
  const close = p.brief('src/a.js').out;
  assert.match(close, /DO NOT APPLY, a later attempt failed/);
  assert.doesNotMatch(p.brief('src/b.js').out, /DO NOT APPLY/, 'same directory is not close enough to warn about');
});

test('a retired lesson is never briefed', t => {
  const p = project(t);
  const i = p.intent();
  p.learn(i, 'src/a.js', 'edit a', 'Lesson that the principal has withdrawn from use.');
  p.synth(i);
  assert.match(p.brief('src/a.js').out, /withdrawn/);
  assert.equal(p.uig('retire', 'edit a', '--principal', 'me').status, 0);
  assert.doesNotMatch(p.brief('src/a.js').out, /withdrawn/);
});

test('a lesson whose files are gone says so instead of being trusted', t => {
  const p = project(t);
  const i = p.intent();
  p.learn(i, 'src/a.js', 'edit a', 'Lesson about a file that is about to be deleted or moved.');
  p.synth(i);
  assert.doesNotMatch(p.brief('src/a.js').out, /have since changed/);
  fs.rmSync(path.join(p.root, 'src/a.js'));
  assert.match(p.brief('src/a.js').out, /\[worked once; its files have since changed, re-verify\]/);
});

test('start prints the brief for its own domain, so the agent gets it without asking', t => {
  const p = project(t);
  const fresh = p.uig('start', 'first', '--domain', 'src/', '--success', 'done');
  assert.match(fresh.out, /No verified lessons yet for src/);
  const i = p.intent();
  p.learn(i, 'src/a.js', 'edit a', 'Lesson about a that the next intent in src/ should see at once.');
  p.synth(i);
  const next = p.uig('start', 'second', '--domain', 'src/', '--success', 'done');
  assert.match(next.out, /Earlier verified work near src/);
  assert.match(next.out, /Lesson about a that the next intent/);
  assert.match(next.out, /^Intent: \S+/m, 'the lines a script reads are unchanged');
  assert.doesNotMatch(p.uig('start', 'third', '--domain', 'src/', '--success', 'done', '--no-brief').out, /Earlier verified work|No verified lessons/);
});

test('the command needs files to look near, and a sensible budget', t => {
  const p = project(t);
  assert.equal(p.uig('brief').status, 2);
  assert.match(p.uig('brief').err, /Name the files/);
  assert.equal(p.uig('brief', '--paths', 'src/', '--budget', '5').status, 2);
  assert.equal(p.uig('brief', '--intent', 'intent_nope').status, 2);
  const i = p.id(p.uig('start', 'g', '--domain', 'src/', '--success', 's', '--no-brief'), 'Intent');
  assert.equal(p.uig('brief', '--intent', i).status, 0, 'the domain of an intent names the files');
  assert.ok(!fs.existsSync(path.join(p.root, 'knowledge')), 'read-only');
});
