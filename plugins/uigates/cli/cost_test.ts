import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { claudeTranscriptDir, classifyBash, DEFAULT_WEIGHTS, parseTranscript, summarize, weighted, windowsFor } from './cost';

/**
 * A savings claim needs a meter that is fair to the control run, so these tests pin what it counts:
 * every model call (UI-GATES commands are turns too), the four token kinds, tool output by kind,
 * and discovery, meaning what the agent spent finding its way before its first edit.
 *
 * Run: npx tsx --test plugins/uigates/cli/cost_test.ts
 */

const bin = path.resolve(__dirname, '../../../bin/uigates.mjs');
const T0 = Date.parse('2026-09-21T19:00:00Z');
const at = (s: number) => new Date(T0 + s * 1000).toISOString();

interface Step { s: number; usage?: Partial<Record<'in' | 'out' | 'cw' | 'cr', number>>; id?: string; tool?: [name: string, input: Record<string, unknown>, resultChars: number] }

/** A transcript as Claude Code writes it: one line per content block, the model call repeated with the same message id. */
function transcript(steps: Step[]): string {
  const lines: string[] = [];
  steps.forEach((st, i) => {
    const id = st.id ?? `msg_${i}`;
    const u = st.usage ?? {};
    const usage = { input_tokens: u.in ?? 0, output_tokens: u.out ?? 0, cache_creation_input_tokens: u.cw ?? 0, cache_read_input_tokens: u.cr ?? 0 };
    const content: any[] = [{ type: 'text', text: 'ok' }];
    if (st.tool) content.push({ type: 'tool_use', id: `tu_${i}`, name: st.tool[0], input: st.tool[1] });
    lines.push(JSON.stringify({ type: 'assistant', timestamp: at(st.s), message: { role: 'assistant', id, model: 'x', usage: { ...usage, output_tokens: 1 }, content: content.slice(0, 1) } }));
    lines.push(JSON.stringify({ type: 'assistant', timestamp: at(st.s), message: { role: 'assistant', id, model: 'x', usage, content } }));
    if (st.tool) lines.push(JSON.stringify({ type: 'user', timestamp: at(st.s + 1), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `tu_${i}`, content: 'x'.repeat(st.tool[2]) }] } }));
  });
  lines.push('not json', '');
  return lines.join('\n');
}

test('shell commands are classified by what they do, and a uigates command is always ceremony', () => {
  const cases: [string, string][] = [
    ['npx --no-install uigates propose i1 --action "grep the code"', 'ceremony'],
    ['UIGATES_ENFORCE=1 npx uigates receipt a1 --run "pytest"', 'ceremony'],
    ['node /x/bin/uigates.mjs audit', 'ceremony'],
    ['npx --no-install uig help', 'ceremony'],
    ['grep -rn "validate" scripts/', 'search'],
    ['cat README.md | head -50', 'search'],
    ['git status --short', 'search'],
    ['cd sub && ls -la', 'search'],
    ['cat > scripts/x.py <<EOF\nprint(1)\nEOF', 'edit'],
    ['cat >> .gitlab-ci.yml <<EOF\nx\nEOF', 'edit'],
    ['sed -i "" "s/a/b/" file.txt', 'edit'],
    ['python3 -m pytest scripts -q', 'verify'],
    ['node --test scripts/*.test.mjs', 'verify'],
    ['echo hi', 'other'],
  ];
  for (const [command, kind] of cases) assert.equal(classifyBash(command), kind, command);
});

test('a streamed model call counts once, with its final usage', () => {
  const events = parseTranscript(transcript([{ s: 0, usage: { in: 10, out: 200, cw: 300, cr: 4000 } }]));
  const models = events.filter(e => e.kind === 'model');
  assert.equal(models.length, 1, 'two lines, one call');
  assert.deepEqual((models[0] as any).usage, { input: 10, output: 200, cacheWrite: 300, cacheRead: 4000 }, 'the last line, not the first');
});

test('the four token kinds are summed and weighted, and the weights can be changed', () => {
  const events = parseTranscript(transcript([
    { s: 0, usage: { in: 10, out: 100, cw: 1000, cr: 0 } },
    { s: 5, usage: { in: 0, out: 50, cw: 0, cr: 10_000 } },
  ]));
  const s = summarize(events);
  assert.equal(s.modelCalls, 2);
  assert.deepEqual(s.usage, { input: 10, output: 150, cacheWrite: 1000, cacheRead: 10_000 });
  assert.equal(s.weighted, Math.round(10 * 1 + 1000 * 1.25 + 10_000 * 0.1 + 150 * 5));
  assert.equal(weighted(s.usage, { ...DEFAULT_WEIGHTS, cacheRead: 0 }), 10 + 1250 + 750, 'cache re-reads can be priced at zero');
  assert.ok(weighted(s.usage, { ...DEFAULT_WEIGHTS, cacheRead: 1 }) > s.weighted);
});

test('tool calls and their output are counted by kind, and only search and read before the first edit are discovery', () => {
  const events = parseTranscript(transcript([
    { s: 0, tool: ['Bash', { command: 'grep -rn foo .' }, 7000] },          // search, 2000 tokens
    { s: 2, tool: ['Read', { file_path: 'a.py' }, 3500] },                  // read, 1000 tokens
    { s: 4, tool: ['Bash', { command: 'npx --no-install uigates start g' }, 700] },
    { s: 6, tool: ['Edit', { file_path: 'a.py' }, 100] },
    { s: 8, tool: ['Grep', { pattern: 'x' }, 35_000] },                     // after the first edit: not discovery
  ]));
  const s = summarize(events);
  assert.deepEqual({ ...s.toolCalls }, { search: 2, read: 1, edit: 1, verify: 0, ceremony: 1, other: 0 });
  assert.equal(s.callsBeforeFirstEdit, 3);
  assert.equal(s.discoveryTokens, 2000 + 1000, 'the second grep came after the edit');
  assert.equal(s.toolOutputTokens.search, 2000 + 10_000);
  assert.equal(s.ceremonyShare, 1 / 5);
});

test('a session that never edits has no discovery figure, not a zero', () => {
  const s = summarize(parseTranscript(transcript([{ s: 0, tool: ['Read', { file_path: 'a' }, 350] }])));
  assert.equal(s.callsBeforeFirstEdit, null);
  assert.equal(s.discoveryTokens, null);
});

test('looking at the lesson ledger is counted, by command or by path', () => {
  const s = summarize(parseTranscript(transcript([
    { s: 0, tool: ['Bash', { command: 'npx --no-install uigates knowledge' }, 100] },
    { s: 1, tool: ['Bash', { command: 'cat .uigates/knowledge/compound_packs/*.md | head -60' }, 100] },
    { s: 2, tool: ['Bash', { command: 'npx uigates brief --paths src/' }, 100] },
    { s: 3, tool: ['Bash', { command: 'ls src' }, 100] },
  ])));
  assert.equal(s.ledgerReads, 3);
});

test('a session is split at each intent, and the reading done before the first intent is its own window', () => {
  const events = parseTranscript(transcript([
    { s: 0, usage: { out: 1 }, tool: ['Read', { file_path: 'a' }, 100] },
    { s: 20, usage: { out: 2 } },
    { s: 40, usage: { out: 4 } },
    { s: 60, usage: { out: 8 } },
  ]));
  const windows = windowsFor(events, [
    { id: 'intent_b', goal: 'second', createdAt: at(50) },
    { id: 'intent_a', goal: 'first', createdAt: at(10) },
    { id: 'intent_old', goal: 'a different session', createdAt: '2020-01-01T00:00:00Z' },
  ]);
  assert.deepEqual(windows.map(w => w.id), ['before-intent', 'intent_a', 'intent_b']);
  const out = windows.map(w => summarize(events, w.from, w.to).usage.output);
  assert.deepEqual(out, [1, 2 + 4, 8]);
  assert.equal(out.reduce((a, b) => a + b, 0), 15, 'the windows add up to the session');
});

test('the transcript directory name follows how Claude Code encodes a working directory', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'uigates-home-'));
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'my.proj-x-')));
  try {
    const dir = claudeTranscriptDir(root, home);
    assert.equal(path.dirname(dir), path.join(home, '.claude', 'projects'));
    assert.match(path.basename(dir), /^-[A-Za-z0-9-]+$/, 'slashes and dots become dashes');
    assert.ok(path.basename(dir).includes('my-proj-x-'));
  } finally { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true }); }
});

test('the command reads a transcript, attributes it to intents, and writes nothing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uigates-cost-'));
  try {
    const env = { ...process.env, UIGATES_PRINCIPAL: 'me', GIT_CONFIG_GLOBAL: '/dev/null' };
    const run = (...args: string[]) => spawnSync(process.execPath, [bin, ...args], { cwd: root, env, encoding: 'utf8' });
    const missing = run('cost', '--transcripts', path.join(root, 'nope.jsonl'));
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /No transcripts found/);
    assert.ok(!fs.existsSync(path.join(root, '.uigates')), 'a failed cost run creates nothing');

    fs.writeFileSync(path.join(root, 't.jsonl'), transcript([
      { s: 0, usage: { in: 5, out: 100, cw: 500, cr: 2000 }, tool: ['Bash', { command: 'ls' }, 700] },
      { s: 30, usage: { out: 100, cr: 3000 }, tool: ['Edit', { file_path: 'a' }, 10] },
    ]));
    const before = fs.readdirSync(root).sort();
    const r = run('cost', '--transcripts', path.join(root, 't.jsonl'), '--json');
    assert.equal(r.status, 0, r.stderr);
    const [report] = JSON.parse(r.stdout);
    assert.equal(report.total.modelCalls, 2);
    assert.equal(report.total.usage.cacheRead, 5000);
    assert.deepEqual(fs.readdirSync(root).sort(), before, 'read-only');

    const bad = run('cost', '--transcripts', path.join(root, 't.jsonl'), '--weights', 'output=abc');
    assert.equal(bad.status, 2);
    const changed = JSON.parse(run('cost', '--transcripts', path.join(root, 't.jsonl'), '--weights', 'cacheRead=0,output=0', '--json').stdout)[0];
    assert.equal(changed.total.weighted, Math.round(5 + 500 * 1.25), 'weights are applied');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
