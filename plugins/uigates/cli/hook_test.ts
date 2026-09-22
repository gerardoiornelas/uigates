import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * The hook exists because the audit can report a file written before it was authorized (trial task 2
 * did that twice, both through the Write and Edit tools) but cannot stop it. These tests drive the
 * real CLI with PreToolUse payloads on stdin, as Claude Code sends them. Exit 2 blocks the edit;
 * every other exit lets it through, so a bug in the hook must never exit 2.
 *
 * Run: npx tsx --test plugins/uigates/cli/hook_test.ts
 */

const bin = path.resolve(__dirname, '../../../bin/uigates.mjs');

interface Result { status: number | null; out: string; err: string }

function project(t: any) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'uigates-hook-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, UIGATES_PRINCIPAL: 'gerardo', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  delete (env as any).UIGATES_ENFORCE;
  delete (env as any).CLAUDE_PROJECT_DIR;
  const uigates = (args: string[], input?: string): Result => {
    const r = spawnSync(process.execPath, [bin, ...args], { cwd: root, env, encoding: 'utf8', input });
    return { status: r.status, out: r.stdout, err: r.stderr };
  };
  const id = (r: Result, label: string) => {
    const m = new RegExp(`^${label}: (\\S+)`, 'm').exec(r.out);
    assert.ok(m, `no "${label}" in output:\n${r.out}\n${r.err}`);
    return m[1];
  };
  /** A payload as Claude Code sends it: an absolute path under the project. */
  const write = (file: string, tool = 'Write') => JSON.stringify({
    session_id: 's', cwd: root, hook_event_name: 'PreToolUse', tool_name: tool,
    tool_input: tool === 'NotebookEdit' ? { notebook_path: path.join(root, file) } : { file_path: path.isAbsolute(file) ? file : path.join(root, file) },
  });
  const hook = (payload: string) => uigates(['hook', 'pre-write'], payload);
  const start = (domain = 'src/') => id(uigates(['start', 'work', '--domain', domain, '--success', 'tests pass']), 'Intent');
  const propose = (intent: string, resource: string, impact = 'low') => uigates(['propose', intent, '--action', `edit ${resource}`, '--resource', resource, '--impact', impact, '--rationale', 'needed', '--risk', 'local', '--verify', 'check']);
  return { root, uigates, id, write, hook, start, propose };
}

test('with enforcement off (the default) the hook allows everything, even with no intent', t => {
  const p = project(t);
  const r = p.hook(p.write('src/a.js'));
  assert.equal(r.status, 0);
  assert.equal(r.err, '');
});

test('enforce on and no active intent: an edit is refused', t => {
  const p = project(t);
  assert.match(p.uigates(['enforce', 'on']).out, /Enforcement: on/);
  const r = p.hook(p.write('src/a.js'));
  assert.equal(r.status, 2);
  assert.match(r.err, /no active intent.*uigates start/);
});

test('an edit before it is authorized is refused, and allowed once it is (the trial task 2 case)', t => {
  const p = project(t);
  p.uigates(['enforce', 'on']);
  const intent = p.start();
  const early = p.hook(p.write('src/a.js'));
  assert.equal(early.status, 2, 'written before any proposal');
  assert.match(early.err, /not covered by an unspent authorization.*uigates propose/);

  const prop = p.id(p.propose(intent, 'src/a.js'), 'Proposal');
  p.uigates(['authorize', prop]);
  assert.equal(p.hook(p.write('src/a.js')).status, 0, 'authorized, so the same edit is allowed');
  assert.equal(p.hook(p.write('src/b.js')).status, 2, 'but only the file it covers');
});

test('a receipt spends the authorization: a further edit needs a new proposal', t => {
  const p = project(t);
  p.uigates(['enforce', 'on']);
  const intent = p.start();
  const auth = p.id(p.uigates(['authorize', p.id(p.propose(intent, 'src/a.js'), 'Proposal')]), 'Authorization');
  assert.equal(p.hook(p.write('src/a.js')).status, 0);
  p.uigates(['receipt', auth, '--run', 'node -e "process.exit(require(\'fs\').existsSync(\'.uigates\') ? 0 : 1)"']);
  const r = p.hook(p.write('src/a.js', 'Edit'));
  assert.equal(r.status, 2);
  assert.match(r.err, /already has a receipt; a further edit needs a new proposal/);
});

test('a gated proposal that is not authorized yet says it is waiting for the principal', t => {
  const p = project(t);
  p.uigates(['enforce', 'on']);
  const intent = p.start('.gitlab-ci.yml');
  p.id(p.propose(intent, '.gitlab-ci.yml', 'medium'), 'Proposal');
  const r = p.hook(p.write('.gitlab-ci.yml'));
  assert.equal(r.status, 2);
  assert.match(r.err, /not authorized yet.*principal's approval in conversation/);
});

test('UI-GATES records cannot be edited through a file tool', t => {
  const p = project(t);
  p.uigates(['enforce', 'on']);
  const intent = p.start('/');
  p.uigates(['authorize', p.id(p.propose(intent, '.'), 'Proposal')]);
  for (const file of ['.uigates/receipts/rec_1.json', '.uigates/knowledge/x.md', '.uigates']) {
    const r = p.hook(p.write(file));
    assert.equal(r.status, 2, file);
    assert.match(r.err, /UI-GATES state/);
  }
});

test('paths outside the project are not the hook\'s to judge', t => {
  const p = project(t);
  p.uigates(['enforce', 'on']);
  p.start();
  const outside = path.join(os.tmpdir(), 'somewhere-else', 'x.py');
  assert.equal(p.hook(p.write(outside)).status, 0);
});

test('every editing tool is covered, and other tools are not the hook\'s business', t => {
  const p = project(t);
  p.uigates(['enforce', 'on']);
  p.start();
  for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) assert.equal(p.hook(p.write('src/a.js', tool)).status, 2, tool);
  const bash = JSON.stringify({ cwd: p.root, tool_name: 'Bash', tool_input: { command: 'echo hi > src/a.js' } });
  assert.equal(p.hook(bash).status, 0, 'a write through Bash is invisible to this hook: a stated limit');
});

test('a relative path is resolved from the payload cwd', t => {
  const p = project(t);
  p.uigates(['enforce', 'on']);
  const intent = p.start();
  p.uigates(['authorize', p.id(p.propose(intent, 'src/a.js'), 'Proposal')]);
  const relative = JSON.stringify({ cwd: p.root, tool_name: 'Edit', tool_input: { file_path: 'src/a.js' } });
  assert.equal(p.hook(relative).status, 0);
});

test('an expired intent authorizes nothing', t => {
  const p = project(t);
  p.uigates(['enforce', 'on']);
  const intent = p.start();
  p.uigates(['authorize', p.id(p.propose(intent, 'src/a.js'), 'Proposal')]);
  const file = path.join(p.root, '.uigates/intents', `${intent}.json`);
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  record.expiry = new Date(Date.now() - 1000).toISOString();
  fs.writeFileSync(file, JSON.stringify(record));
  const r = p.hook(p.write('src/a.js'));
  assert.equal(r.status, 2);
  assert.match(r.err, /no active intent/);
});

test('an expired intent\'s authorization stays dead while another intent is active', t => {
  const p = project(t);
  p.uigates(['enforce', 'on']);
  const old = p.start('src/');
  p.uigates(['authorize', p.id(p.propose(old, 'src/a.js'), 'Proposal')]);
  assert.equal(p.hook(p.write('src/a.js')).status, 0, 'authorized while its intent lives');

  const file = path.join(p.root, '.uigates/intents', `${old}.json`);
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  record.expiry = new Date(Date.now() - 1000).toISOString();
  fs.writeFileSync(file, JSON.stringify(record));
  p.start('docs/'); // an unrelated, active intent, so "no active intent" is not what refuses this
  const r = p.hook(p.write('src/a.js'));
  assert.equal(r.status, 2);
  assert.match(r.err, /not covered by an unspent authorization/);
});

test('the suggested intent is the most recent one, not the oldest that is still active', t => {
  const p = project(t);
  p.uigates(['enforce', 'on']);
  const first = p.start('src/');
  const second = p.start('docs/');
  const r = p.hook(p.write('docs/x.md'));
  assert.equal(r.status, 2);
  assert.match(r.err, new RegExp(`uigates propose ${second} `));
  assert.doesNotMatch(r.err, new RegExp(first));
});

test('the hook fails open: a bad payload or unreadable records exit 1, never 2, so the edit proceeds', t => {
  const p = project(t);
  p.uigates(['enforce', 'on']);
  for (const junk of ['', 'not json', '{"tool_name":']) {
    const r = p.hook(junk);
    assert.equal(r.status, 1, `payload ${JSON.stringify(junk)}`);
    assert.match(r.err, /edit allowed/);
  }
  p.start();
  fs.writeFileSync(path.join(p.root, '.uigates/authorizations', 'auth_broken.json'), '{ not valid');
  const r = p.hook(p.write('src/a.js'));
  assert.equal(r.status, 1, 'a record the hook cannot read is an internal error, not a verdict');
  assert.match(r.err, /Unreadable record.*auth_broken\.json.*edit allowed/);
});

test('enforcement can be switched on by environment and turned off again', t => {
  const p = project(t);
  const viaEnv = spawnSync(process.execPath, [bin, 'hook', 'pre-write'], {
    cwd: p.root, encoding: 'utf8', input: p.write('src/a.js'), env: { ...process.env, UIGATES_ENFORCE: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  });
  assert.equal(viaEnv.status, 2, 'UIGATES_ENFORCE=1 enforces without a marker file');
  p.uigates(['enforce', 'on']);
  assert.equal(p.hook(p.write('src/a.js')).status, 2);
  assert.match(p.uigates(['enforce', 'off']).out, /Enforcement: off/);
  assert.equal(p.hook(p.write('src/a.js')).status, 0);
  assert.notEqual(p.uigates(['enforce', 'sideways']).status, 0);
});
