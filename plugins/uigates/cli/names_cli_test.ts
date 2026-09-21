import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * One name across the CLI: the command is `uigates`, records go to `.uigates/`, and settings are
 * `UIGATES_*`. The earlier names (`uig`, `.uig/`, `UIG_*`) still work for one release, and an older
 * project keeps its `.uig/` directory because evidence references embed the path.
 *
 * Run: npx tsx --test plugins/uigates/cli/names_cli_test.ts
 */

const repoRoot = path.resolve(__dirname, '../../..');
const bin = path.join(repoRoot, 'bin/uigates.mjs');
const verifier = (file: string) => `node -e "process.exit(require('fs').existsSync('${file}') ? 0 : 1)"`;
const LESSON = 'wrap the writes in one transaction so a failure rolls the whole change back';

interface Result { status: number | null; out: string; err: string }

/** A project directory. `legacy` starts it with an older `.uig/`; `git` gives it a base commit for the audit. */
function project(t: any, opts: { legacy?: boolean; git?: boolean; env?: Record<string, string | undefined> } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'uigates-names-cli-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const clean = { ...process.env };
  for (const k of Object.keys(clean)) if (/^UIG(ATES)?_/.test(k)) delete clean[k];
  delete clean.CLAUDE_PROJECT_DIR;
  const baseEnv = { ...clean, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', UIGATES_PRINCIPAL: 'gerardo' };
  const run = (cmd: string, args: string[], extra: Record<string, string | undefined> = {}, input?: string, cwd = root): Result => {
    const env: Record<string, string | undefined> = { ...baseEnv, ...opts.env, ...extra };
    for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
    const r = spawnSync(cmd, args, { cwd, env: env as NodeJS.ProcessEnv, encoding: 'utf8', input });
    return { status: r.status, out: r.stdout, err: r.stderr };
  };
  const uigates = (args: string[], extra: Record<string, string | undefined> = {}, input?: string) => run(process.execPath, [bin, ...args], extra, input);
  const id = (r: Result, label: string) => {
    const m = new RegExp(`^${label}: (\\S+)`, 'm').exec(r.out);
    assert.ok(m, `no "${label}" in output:\n${r.out}\n${r.err}`);
    return m[1];
  };
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };
  const exists = (rel: string) => fs.existsSync(path.join(root, rel));
  const count = (rel: string) => (exists(rel) ? fs.readdirSync(path.join(root, rel)).length : 0);

  if (opts.legacy) fs.mkdirSync(path.join(root, '.uig'));
  let base = '';
  if (opts.git) {
    run('git', ['init', '-q']);
    write('src/a.js', 'a\n');
    run('git', ['add', '-A', '--', 'src']);
    run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'base']);
    base = run('git', ['rev-parse', 'HEAD']).out.trim();
  }

  const start = (domain = 'src/') => id(uigates(['start', 'work', '--domain', domain, '--success', 'verifier passes']), 'Intent');
  const propose = (intent: string, resource: string, over: Record<string, string> = {}) => {
    const f: Record<string, string> = { action: `edit ${resource}`, resource, impact: 'low', rationale: 'needed', risk: 'local', verify: 'check the file exists', ...over };
    return uigates(['propose', intent, ...Object.entries(f).flatMap(([k, v]) => [`--${k}`, v])]);
  };
  /** propose, authorize, write the file, verify: the proper order. */
  const cycle = (intent: string, resource = 'src/a.js') => {
    const auth = id(uigates(['authorize', id(propose(intent, resource), 'Proposal')]), 'Authorization');
    write(resource, 'changed\n');
    return uigates(['receipt', auth, '--run', verifier(resource), '--lesson', LESSON]);
  };
  return { root, run, uigates, id, write, exists, count, base, start, propose, cycle };
}

const readJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'));

// --- which directory a project uses ---

test('a new project records to .uigates and never creates .uig', t => {
  const p = project(t);
  p.start();
  assert.equal(p.count('.uigates/intents'), 1);
  assert.equal(p.exists('.uig'), false);
});

test('an older project keeps recording to .uig, through synthesis and knowledge, and never creates .uigates', t => {
  const p = project(t, { legacy: true });
  const intent = p.start();
  const receipt = p.cycle(intent);
  assert.equal(receipt.status, 0, receipt.err);

  assert.equal(p.count('.uig/intents'), 1);
  assert.equal(p.count('.uig/receipts'), 1);
  const [rec] = fs.readdirSync(path.join(p.root, '.uig/receipts')).map(f => readJson(path.join(p.root, '.uig/receipts', f)));
  assert.match(rec.evidence[0], /^sha256:[0-9a-f]{64}:\.uig\/evidence\/rec_/, 'the evidence reference names the directory the project uses');

  const s = p.uigates(['synthesize', intent]);
  assert.equal(s.status, 0, s.err);
  assert.match(s.out, /\[task\/verified\]/);
  assert.equal(p.count('.uig/knowledge/compound_packs'), 1);
  assert.match(p.uigates(['knowledge']).out, /\[task\/verified\]/);
  assert.match(p.uigates(['status']).out, /receipts 1/);
  assert.equal(p.exists('.uigates'), false, 'the new directory must not appear beside the old one');
});

test('with both directories the CLI warns, reads .uigates, and says the other is ignored', t => {
  const p = project(t, { legacy: true });
  fs.mkdirSync(path.join(p.root, '.uigates'));
  const r = p.uigates(['status']);
  assert.match(r.err, /both \.uigates\/ and \.uig\/ exist.*read from \.uigates\/.*ignored/);
  p.start();
  assert.equal(p.count('.uigates/intents'), 1);
  assert.equal(p.count('.uig/intents'), 0);
});

// --- protection of both directories ---

test('a proposal to edit either directory\'s records is a prohibition, in a new and in an older project', t => {
  for (const legacy of [false, true]) {
    const p = project(t, { legacy });
    const intent = p.start('/');
    for (const resource of ['.uigates/receipts/x.json', '.uig/receipts/x.json', '.uig/authorizations/x.json', '.uigates/intents/x.json']) {
      const r = p.propose(intent, resource);
      assert.equal(r.status, 1, `${resource} (legacy project: ${legacy})`);
      assert.match(r.out, /DENIED \(prohibited: protected record\)/, resource);
    }
  }
});

// --- the command ---

test('the help names the command uigates and nothing else', t => {
  const r = project(t).uigates(['help']);
  assert.equal(r.status, 0);
  assert.match(r.out, /^  uigates start /m);
  assert.match(r.out, /^  uigates audit /m);
  assert.doesNotMatch(r.out, /(?<![.\w/~-])uig(?![\w/.-])/, 'the bare earlier command name must not appear');
  assert.match(r.out, /\.uigates\//);
});

test('the earlier command name is an alias for the same program, and both bin entries exist', () => {
  const pkg = readJson(path.join(repoRoot, 'package.json'));
  assert.equal(pkg.bin.uigates, 'bin/uigates.mjs');
  assert.equal(pkg.bin.uig, 'bin/uigates.mjs', 'the alias points at the same file, not a copy');
  assert.ok(fs.existsSync(path.join(repoRoot, pkg.bin.uigates)));
  assert.equal(fs.existsSync(path.join(repoRoot, 'bin/uig.mjs')), false, 'there is one launcher');
});

test('errors are prefixed with the command name', t => {
  const p = project(t);
  const r = p.uigates(['nonsense']);
  assert.equal(r.status, 2);
  assert.match(r.err, /^uigates: Unknown command "nonsense"\. Run: uigates help/);
});

// --- settings ---

test('the principal comes from UIGATES_PRINCIPAL, then from the older UIG_PRINCIPAL', t => {
  const args = ['start', 'g', '--domain', 'src/', '--success', 'x'];
  const p = project(t);
  assert.match(p.uigates(args, { UIGATES_PRINCIPAL: 'new-name' }).out, /Principal: new-name/);
  assert.match(p.uigates(args, { UIGATES_PRINCIPAL: undefined, UIG_PRINCIPAL: 'old-name' }).out, /Principal: old-name/);
  assert.match(p.uigates(args, { UIGATES_PRINCIPAL: 'new-name', UIG_PRINCIPAL: 'old-name' }).out, /Principal: new-name/);
  const none = p.uigates(args, { UIGATES_PRINCIPAL: undefined });
  assert.notEqual(none.status, 0);
  assert.match(none.err, /No principal.*UIGATES_PRINCIPAL/);
});

test('the project root comes from UIGATES_ROOT, or the older UIG_ROOT', t => {
  for (const name of ['UIGATES_ROOT', 'UIG_ROOT']) {
    const p = project(t);
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'uigates-cwd-'));
    t.after(() => fs.rmSync(elsewhere, { recursive: true, force: true }));
    const r = p.run(process.execPath, [bin, 'start', 'g', '--domain', 'src/', '--success', 'x'], { [name]: p.root }, undefined, elsewhere);
    assert.equal(r.status, 0, `${name}: ${r.err}`);
    assert.equal(p.count('.uigates/intents'), 1, name);
    assert.equal(fs.existsSync(path.join(elsewhere, '.uigates')), false, `${name}: nothing written in the working directory`);
  }
});

// --- the write-time hook ---

test('enforce on puts its marker in the directory the project uses', t => {
  const fresh = project(t);
  assert.match(fresh.uigates(['enforce', 'on']).out, /Enforcement: on/);
  assert.ok(fresh.exists('.uigates/enforce'));
  assert.equal(fresh.exists('.uig'), false);

  const older = project(t, { legacy: true });
  older.uigates(['enforce', 'on']);
  assert.ok(older.exists('.uig/enforce'));
  assert.equal(older.exists('.uigates'), false);
  assert.match(older.uigates(['enforce', 'off']).out, /Enforcement: off/);
  assert.equal(older.exists('.uig/enforce'), false);
});

test('UIGATES_ENFORCE=1 and the older UIG_ENFORCE=1 both turn enforcement on without a marker', t => {
  const p = project(t);
  const payload = JSON.stringify({ tool_name: 'Write', cwd: p.root, tool_input: { file_path: path.join(p.root, 'src/a.js') } });
  assert.equal(p.uigates(['hook', 'pre-write'], {}, payload).status, 0, 'off by default');
  for (const name of ['UIGATES_ENFORCE', 'UIG_ENFORCE']) {
    const r = p.uigates(['hook', 'pre-write'], { [name]: '1' }, payload);
    assert.equal(r.status, 2, name);
    assert.match(r.err, /^uigates: no active intent/, name);
    assert.match(p.uigates(['enforce'], { [name]: '1' }).out, new RegExp(`Enforcement: on \\(${name}=1`), name);
  }
});

test('the hook refuses a file-tool edit to either directory, in a new and in an older project', t => {
  for (const legacy of [false, true]) {
    const p = project(t, { legacy });
    p.uigates(['enforce', 'on']);
    const intent = p.start('.');
    assert.equal(p.uigates(['authorize', p.id(p.propose(intent, '.'), 'Proposal')]).status, 0, 'a project-wide authorization is in place');
    for (const file of ['.uigates/receipts/r.json', '.uig/receipts/r.json', '.uig/knowledge/x.md', '.uigates']) {
      const payload = JSON.stringify({ tool_name: 'Write', cwd: p.root, tool_input: { file_path: path.join(p.root, file) } });
      const r = p.uigates(['hook', 'pre-write'], {}, payload);
      assert.equal(r.status, 2, `${file} (legacy project: ${legacy})`);
      assert.match(r.err, /is UI-GATES state.*uigates CLI/, file);
    }
  }
});

// --- the audit ---

test('the audit scores a project from its records, in a new and in an older project, and treats its CLI evidence as CLI evidence', t => {
  for (const legacy of [false, true]) {
    const dir = legacy ? '.uig' : '.uigates';
    const p = project(t, { legacy, git: true });
    const intent = p.start();
    assert.equal(p.cycle(intent).status, 0);
    const r = p.uigates(['audit', '--base', p.base, '--json']);
    assert.equal(r.status, 0, r.out + r.err);
    const report = JSON.parse(r.out);
    assert.deepEqual(report.files.map((f: any) => f.path), ['src/a.js'], `${dir}/ is the record, not a change`);
    assert.equal(report.findings.filter((f: any) => f.severity === 'FAIL').length, 0, dir);
    assert.equal(report.findings.some((f: any) => /asserted by the agent/.test(f.message)), false, `the log under ${dir}/evidence is recognised as CLI-produced`);
    assert.equal(p.exists(legacy ? '.uigates' : '.uig'), false, 'the audit is read-only and creates nothing');
  }
});

test('the audit warns when both directories exist, and excludes both from the change list', t => {
  const p = project(t, { legacy: true, git: true });
  fs.mkdirSync(path.join(p.root, '.uigates'));
  p.write('.uig/stray.txt', 'x');
  p.write('.uigates/stray.txt', 'x');
  const r = p.uigates(['audit', '--base', p.base, '--json']);
  const report = JSON.parse(r.out);
  assert.deepEqual(report.files, [], 'neither state directory shows up as a change');
  assert.ok(report.findings.some((f: any) => f.severity === 'WARN' && /Both \.uigates\/ and \.uig\/ exist.*read from \.uigates\//.test(f.message)), r.out);
});

test('the audit names the directory in its errors', t => {
  const p = project(t, { legacy: true, git: true });
  p.start();
  const r = p.uigates(['audit', '--base', p.base, '--intent', 'intent_nope']);
  assert.notEqual(r.status, 0);
  assert.match(r.err, /not found in \.uig\/intents/);
  const fresh = project(t, { git: true });
  fresh.start();
  assert.match(fresh.uigates(['audit', '--base', fresh.base, '--intent', 'intent_nope']).err, /not found in \.uigates\/intents/);
});
