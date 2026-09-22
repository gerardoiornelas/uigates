#!/usr/bin/env node
// A stand-in for `claude -p`, for testing the harness without an agent. It does what the harness relies on:
// edits files in its working directory, writes a transcript where Claude Code writes one, prints JSON.
// Behaviour is steered by environment variables so a test can ask for a specific situation.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const prompt = args[args.indexOf('-p') + 1] ?? '';
const cwd = fs.realpathSync(process.cwd());
const has = p => fs.existsSync(path.join(cwd, p));
const arm = args.includes('--plugin-dir') ? (has('.uigates/knowledge') ? 'learned' : 'ceremony') : 'control';
const file = /features\/([\w-]+)\.mjs/.exec(prompt)?.[1] ?? 'unknown';
const env = process.env;

if (env.FAKE_LOG) {
  const ledger = has('.uigates/knowledge/compound_packs') ? fs.readdirSync(path.join(cwd, '.uigates/knowledge/compound_packs')).sort() : [];
  fs.appendFileSync(env.FAKE_LOG, `${JSON.stringify({ arm, task: file, seed: has('features/seed.mjs'), sawProviderEnv: !!(env.ANTHROPIC_BASE_URL || env.ANTHROPIC_API_KEY), ledger, asksForSkill: /Use the uigates skill/.test(prompt), literalSlash: prompt.startsWith('/'), args: args.filter(a => a.startsWith('--')) })}\n`);
}

if (env.FAKE_NO_WRITE !== '1') {
  fs.mkdirSync(path.join(cwd, 'features'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'features', `${file}.mjs`), 'export const run = () => 1;\n');
}
if (env.FAKE_EXTRA === '1') fs.writeFileSync(path.join(cwd, 'README.md'), 'changed outside the allowed files\n');
// A ceremony arm that starts an intent leaves a lesson pack behind, as the real skill would.
if (arm !== 'control' && env.FAKE_NO_UIGATES !== '1') {
  const dir = path.join(cwd, '.uigates/knowledge/compound_packs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `lesson_${file}.md`), `pack for ${file}\n`);
}

const profile = JSON.parse(env.FAKE_PROFILE ?? '{}')[arm] ?? { calls: 5, cacheRead: 40000, out: 500 };
const session = crypto.randomUUID();
const dir = path.join(env.HOME, '.claude/projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
fs.mkdirSync(dir, { recursive: true });
const t0 = Date.now();
const lines = [];
for (let i = 0; i < profile.calls; i++) {
  const id = `msg_${session}_${i}`;
  const content = [{ type: 'text', text: 'ok' }];
  const doesCeremony = arm !== 'control' && env.FAKE_NO_UIGATES !== '1' && i === 0;
  if (doesCeremony) content.push({ type: 'tool_use', id: `tu_${i}`, name: 'Bash', input: { command: 'npx --no-install uigates start "g" --domain features/ --success ok' } });
  const usage = { input_tokens: 2, output_tokens: profile.out, cache_creation_input_tokens: i === 0 ? 3000 : 0, cache_read_input_tokens: profile.cacheRead };
  lines.push(JSON.stringify({ type: 'assistant', timestamp: new Date(t0 + i * 1000).toISOString(), message: { role: 'assistant', id, model: 'fake', usage, content } }));
  if (doesCeremony) lines.push(JSON.stringify({ type: 'user', timestamp: new Date(t0 + i * 1000 + 500).toISOString(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `tu_${i}`, content: 'Intent: intent_x' }] } }));
}
fs.writeFileSync(path.join(dir, `${session}.jsonl`), `${lines.join('\n')}\n`);
console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: session, num_turns: profile.calls, total_cost_usd: 0.1, usage: { input_tokens: 2 } }));
