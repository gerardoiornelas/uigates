import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { referencedScripts } from './audit';

/**
 * `uig audit` compares what changed in the working tree with what `.uig/` says was authorized and
 * verified. These tests drive the real CLI in a throwaway git repository, the way a session would,
 * and check each finding it can raise, including the ones a scripted "good" agent never triggers.
 *
 * Run: npx tsx --test plugins/uigates/cli/audit_test.ts
 */

const bin = path.resolve(__dirname, '../../../bin/uig.mjs');
// A real verifier: it can fail. The audit rejects commands that cannot.
const verifier = (file: string) => `node -e "process.exit(require('fs').existsSync('${file}') ? 0 : 1)"`;

interface Result { status: number | null; out: string; err: string }

function repo(t: any) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uig-audit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, UIG_PRINCIPAL: 'gerardo', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const run = (cmd: string, args: string[]): Result => {
    const r = spawnSync(cmd, args, { cwd: root, env, encoding: 'utf8' });
    return { status: r.status, out: r.stdout, err: r.stderr };
  };
  const uig = (...args: string[]) => run(process.execPath, [bin, ...args]);
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };
  const id = (r: Result, label: string) => {
    const m = new RegExp(`^${label}: (\\S+)`, 'm').exec(r.out);
    assert.ok(m, `no "${label}" in output:\n${r.out}\n${r.err}`);
    return m[1];
  };

  run('git', ['init', '-q']);
  write('src/a.js', 'a\n');
  write('src/b.js', 'b\n');
  write('.gitlab-ci.yml', 'stages: [test]\n');
  run('git', ['add', '-A']);
  run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'base']);
  const base = run('git', ['rev-parse', 'HEAD']).out.trim();

  const start = (domain = 'src/') => id(uig('start', 'change something', '--domain', domain, '--success', 'verifier passes'), 'Intent');
  const propose = (intent: string, resource: string, impact = 'low') =>
    uig('propose', intent, '--action', `edit ${resource}`, '--resource', resource, '--impact', impact, '--rationale', 'needed', '--risk', 'local', '--verify', 'check');
  const audit = (...extra: string[]) => uig('audit', '--base', base, ...extra);

  /** The proper order: propose, authorize, then change the file, then verify. */
  const cycle = (intent: string, resource: string, command = verifier(resource), body = 'changed\n') => {
    const prop = id(propose(intent, resource), 'Proposal');
    const auth = id(uig('authorize', prop), 'Authorization');
    write(resource, body);
    const receipt = uig('receipt', auth, '--run', command);
    return { prop, auth, receipt };
  };

  return { root, run, uig, write, id, base, start, propose, cycle, audit };
}

test('a verified, authorized change audits clean and the audit is read-only on its own records', t => {
  const p = repo(t);
  const intent = p.start();
  assert.equal(p.cycle(intent, 'src/a.js').receipt.status, 0);

  const before = fs.readdirSync(path.join(p.root, '.uig/receipts')).length;
  const r = p.audit();
  assert.equal(r.status, 0, r.out + r.err);
  assert.match(r.out, /1\/1 changed file\(s\) verified/);
  assert.match(r.out, /1\/1 receipt\(s\) CLI-produced with intact hashes/);
  assert.equal(fs.readdirSync(path.join(p.root, '.uig/receipts')).length, before);

  const json = JSON.parse(p.audit('--json').out);
  assert.deepEqual(json.files.map((f: any) => f.path), ['src/a.js'], '.uig/ is the record, not a change');
  assert.ok(!json.findings.some((f: any) => f.severity === 'FAIL'));
});

test('a change nobody authorized fails coverage', t => {
  const p = repo(t);
  const intent = p.start();
  p.cycle(intent, 'src/a.js');
  p.write('src/b.js', 'sneaky\n');
  const r = p.audit();
  assert.equal(r.status, 1);
  assert.match(r.out, /FAIL {2}\[coverage\] src\/b\.js changed with no authorization covering it/);
});

test('an authorized change with no receipt fails coverage', t => {
  const p = repo(t);
  const intent = p.start();
  const auth = p.id(p.uig('authorize', p.id(p.propose(intent, 'src/a.js'), 'Proposal')), 'Authorization');
  assert.ok(auth);
  p.write('src/a.js', 'changed\n');
  const r = p.audit();
  assert.equal(r.status, 1);
  assert.match(r.out, /src\/a\.js changed under \S+, which has no receipt/);
});

test('a change whose only receipt ended in a delta was never verified', t => {
  const p = repo(t);
  const intent = p.start();
  const c = p.cycle(intent, 'src/a.js', 'node -e "process.exit(3)"');
  assert.equal(c.receipt.status, 1);
  const r = p.audit();
  assert.equal(r.status, 1);
  assert.match(r.out, /every receipt covering it ended in a delta/);
});

test('a verification command that cannot fail is rejected', t => {
  const p = repo(t);
  const intent = p.start();
  assert.equal(p.cycle(intent, 'src/a.js', 'true').receipt.status, 0, 'the CLI accepts it; only the audit can tell it is empty');
  const r = p.audit();
  assert.equal(r.status, 1);
  assert.match(r.out, /the verification command "true" cannot fail/);
});

test('evidence altered after the receipt fails its hash', t => {
  const p = repo(t);
  const intent = p.start();
  p.cycle(intent, 'src/a.js');
  const dir = path.join(p.root, '.uig/evidence');
  fs.appendFileSync(path.join(dir, fs.readdirSync(dir)[0]), '\nexit: 0 (edited)\n');
  const r = p.audit();
  assert.equal(r.status, 1);
  assert.match(r.out, /no longer matches its recorded hash/);
});

test('asserted evidence is flagged, because the agent, not the CLI, claimed the outcome', t => {
  const p = repo(t);
  const intent = p.start();
  const auth = p.id(p.uig('authorize', p.id(p.propose(intent, 'src/a.js'), 'Proposal')), 'Authorization');
  p.write('src/a.js', 'changed\n');
  p.write('notes.txt', 'i tested it\n');
  const receipt = p.uig('receipt', auth, '--evidence', 'notes.txt', '--outcome', 'works', '--delta', 'None');
  assert.equal(receipt.status, 0, receipt.err);
  const r = p.audit();
  assert.match(r.out, /WARN {2}\[evidence\] .*asserted by the agent/);
  assert.match(r.out, /0\/1 receipt\(s\) CLI-produced/);
});

test('the engine now gates a CI edit even when the agent declares it low impact', t => {
  const p = repo(t);
  const intent = p.start('.gitlab-ci.yml');
  const prop = p.propose(intent, '.gitlab-ci.yml', 'low');
  assert.match(prop.out, /Authority: gated/);
  assert.match(prop.out, /CRITICAL \(CI configuration\)/);
  const refused = p.uig('authorize', p.id(prop, 'Proposal'));
  assert.equal(refused.status, 1, 'the agent cannot authorize it on its own');
  assert.match(refused.err, /may not approve its own gated action/);
});

test('a project-wide resource carries a CI edit past the engine; the audit catches it from the files', t => {
  const p = repo(t);
  const intent = p.start('/');
  const prop = p.propose(intent, '.', 'low');
  assert.match(prop.out, /Authority: delegated/, 'a resource of "." names no file, so the engine cannot know');
  const auth = p.id(p.uig('authorize', p.id(prop, 'Proposal')), 'Authorization');
  p.write('.gitlab-ci.yml', 'stages: [test, lint]\n');
  assert.equal(p.uig('receipt', auth, '--run', verifier('.gitlab-ci.yml')).status, 0);
  const r = p.audit();
  assert.equal(r.status, 1);
  assert.match(r.out, /FAIL {2}\[gate\] \.gitlab-ci\.yml \(CI configuration\) changed under delegated authority only/);
  assert.match(r.out, /WARN {2}\[coverage\] .*whose resource is the whole project/);
  assert.match(r.out, /declared low impact; the files under \. look high/);
});

test('a gated CI edit passes the gate check but still cannot prove the principal said yes', t => {
  const p = repo(t);
  const intent = p.start('.gitlab-ci.yml');
  const prop = p.id(p.propose(intent, '.gitlab-ci.yml', 'low'), 'Proposal');
  const auth = p.id(p.uig('authorize', prop, '--approved-by', 'gerardo'), 'Authorization');
  p.write('.gitlab-ci.yml', 'stages: [test, lint]\n');
  assert.equal(p.uig('receipt', auth, '--run', verifier('.gitlab-ci.yml')).status, 0);
  const r = p.audit();
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /principal consent cannot be proven from records/);
  assert.match(r.out, /WARN {2}\[gate\] .*too fast to be a human decision/, 'proposal and approval in the same second is not a person deciding');
});

test('a change edited after its last receipt is flagged as possibly stale', t => {
  const p = repo(t);
  const intent = p.start();
  p.cycle(intent, 'src/a.js');
  const later = new Date(Date.now() + 60_000);
  fs.utimesSync(path.join(p.root, 'src/a.js'), later, later);
  assert.match(p.audit().out, /src\/a\.js was modified after its last receipt/);
});

test('auditing a project with no records reports the changes as uncovered and creates nothing', t => {
  const p = repo(t);
  p.write('src/a.js', 'changed\n');
  const r = p.audit();
  assert.equal(r.status, 1);
  assert.match(r.out, /src\/a\.js changed with no authorization covering it/);
  assert.ok(!fs.existsSync(path.join(p.root, '.uig')), 'audit must not create .uig/');
});

test('an unknown base commit is a usage error, not an empty pass', t => {
  const p = repo(t);
  const r = p.uig('audit', '--base', 'no-such-commit');
  assert.equal(r.status, 2);
  assert.match(r.err, /git rev-parse/);
});

test('--intent scores one task without borrowing another task\'s authority', t => {
  const p = repo(t);
  const one = p.start();
  p.cycle(one, 'src/a.js');
  const two = p.start();
  assert.equal(p.cycle(two, 'src/b.js').receipt.status, 0);
  assert.equal(p.audit().status, 0, 'both changes are covered when both tasks count');
  const alone = p.audit('--intent', one);
  assert.equal(alone.status, 1, 'src/b.js belongs to task two, so task one cannot claim it');
  assert.match(alone.out, /src\/b\.js changed with no authorization covering it/);
});

// --- Verification whose logic is not in the record -------------------------------------------
// `receipt --run` hashes a command's output, never the script it runs. Two real cases from the
// first trial: a script in a temp directory outside the project, and an in-repo script that was
// deleted after it ran.

test('referencedScripts finds what a command runs, and only that', () => {
  const paths = (command: string) => referencedScripts(command).map(r => (r.cwd === '.' ? r.path : `${r.cwd}:${r.path}`));
  assert.deepEqual(paths('python3 scripts/a.py'), ['scripts/a.py']);
  assert.deepEqual(paths('node -e "process.exit(1)"'), [], 'inline code is already in the command');
  assert.deepEqual(paths('python3 -m pytest scripts'), []);
  assert.deepEqual(paths('bash /tmp/x/verify.sh'), ['/tmp/x/verify.sh']);
  assert.deepEqual(paths('test ! -e scripts/h.py && git status --short | grep -v x'), [], 'a path that is only tested for is not run');
  assert.deepEqual(paths('cd sub && python3 t.py'), ['sub:t.py'], 'a cd changes where the script is looked for');
  assert.deepEqual(paths('(cd vae-vtt/backend && python3 -m pytest calibration -q)'), []);
  assert.deepEqual(paths('FOO=1 python3 a.py'), ['a.py']);
  assert.deepEqual(paths('npx tsx a.ts'), ['a.ts']);
  assert.deepEqual(paths('node --test scripts/*.test.mjs'), [], 'a glob names no single script');
  assert.deepEqual(paths('./run.sh --fast'), ['./run.sh']);
  assert.deepEqual(paths('bash "scripts/my check.sh"'), ['scripts/my check.sh']);
  assert.deepEqual(paths("python3 - <<'PY'\nimport os\nos.system('rm -rf x')\nPY"), [], 'a heredoc body is code, not commands');
});

test('a verification script outside the project is flagged: only its output is in the record', t => {
  const p = repo(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'uig-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const script = path.join(outside, 'verify.sh');
  fs.writeFileSync(script, 'test -f src/a.js\n');
  const intent = p.start('/');
  assert.equal(p.cycle(intent, 'src/a.js', `bash ${script}`).receipt.status, 0);
  const r = p.audit();
  assert.equal(r.status, 0, 'a warning, not a failure: the check may be perfectly good');
  assert.match(r.out, /WARN {2}\[evidence\] .*verify\.sh, which is outside the project/);
});

test('an in-repo verification script deleted after it ran is flagged: the check cannot be re-run', t => {
  const p = repo(t);
  const intent = p.start('/');
  p.write('check.sh', 'test -f src/a.js\n');
  assert.equal(p.cycle(intent, 'src/a.js', 'bash check.sh').receipt.status, 0);
  fs.rmSync(path.join(p.root, 'check.sh'));
  const r = p.audit();
  assert.equal(r.status, 0);
  assert.match(r.out, /WARN {2}\[evidence\] .*check\.sh, which is no longer in the working tree or the base commit/);
});

test('a verification script that is still in the repo is not flagged', t => {
  const p = repo(t);
  const intent = p.start('/');
  p.write('check.sh', 'test -f src/a.js\n');
  assert.equal(p.cycle(intent, 'src/a.js', 'bash check.sh').receipt.status, 0);
  assert.doesNotMatch(p.audit().out, /verification runs|which is (no longer|outside)/);
});

test('testing that a deleted script is gone is not running it', t => {
  const p = repo(t);
  const intent = p.start('/');
  const command = `test ! -e gone.sh && node -e "process.exit(require('fs').existsSync('src/a.js') ? 0 : 1)"`;
  assert.equal(p.cycle(intent, 'src/a.js', command).receipt.status, 0);
  assert.doesNotMatch(p.audit().out, /gone\.sh/);
});
