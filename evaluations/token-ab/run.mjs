#!/usr/bin/env node
// Runs the token A/B: the same tasks under three arms, each in its own fresh workspace.
//
//   control   a plain agent; the workspace contains nothing of UI-GATES
//   ceremony  the uigates skill and CLI, with an EMPTY lesson ledger
//   learned   the same, with the ledger a learning phase produced from earlier tasks
//
// Three arms, not two, because the question has two halves that a two-arm test would blur:
//   ceremony - control  is what UI-GATES costs; learned - ceremony is what learning saves.
// See PLAN.md for the hypotheses, the metric, and what counts as support, all fixed before any run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const UIGATES_BIN = path.join(REPO, 'bin/uigates.mjs');
const PLUGIN = path.join(REPO, 'plugins/uigates');
export const ARMS = ['control', 'ceremony', 'learned'];
export const SKILL_REQUEST = 'Use the uigates skill for this task.';
const IGNORED = new Set(['.git', 'node_modules', '.claude', '.uigates', '.uig']);
// The same for every arm. The agent's own configuration is not the thing under test: user-level MCP servers write files into the
// workspace (Serena created .serena/ in the first real run) and add tool definitions to the context of every call, and user-level
// settings add more. Removing both makes the fixed cost per call smaller, identical across arms, and repeatable.
const ISOLATION = ['--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', 'project'];
// A shell that exports a proxy or another provider's key would make the agent something other than Claude on Anthropic's API.
const PROVIDER_ENV = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_BASE_URL'];

const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const die = message => { console.error(`token-ab: ${message}`); process.exit(2); };

/** A small seeded generator, so the order of arms is random but reproducible and recorded. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function shuffled(items, random) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function snapshot(root) {
  const out = {};
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (IGNORED.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out[path.relative(root, full).split(path.sep).join('/')] = sha(fs.readFileSync(full));
    }
  };
  walk(root);
  return out;
}

/** What is in the workspace that belongs to UI-GATES. The control's must be empty: that is what makes it a control. */
function uigatesArtifacts(work) {
  return ['.claude', '.uigates', '.uig', 'node_modules/.bin/uigates', 'node_modules/.bin/uig'].filter(p => fs.existsSync(path.join(work, p)));
}

function prepareWorkspace(suite, arm, ledger) {
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'token-ab-')));
  fs.cpSync(suite.source, work, { recursive: true, filter: f => !['.git', 'node_modules'].includes(path.basename(f)) });
  spawnSync('git', ['init', '-q'], { cwd: work });
  let pluginDir = null;
  if (arm !== 'control') {
    // A skills-directory plugin under .claude/skills is not registered in headless mode ("Unknown skill": the first two real runs),
    // so the plugin is loaded explicitly with --plugin-dir, from outside the workspace where the agent cannot trip over it.
    pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-ab-plugin-'));
    fs.cpSync(path.join(PLUGIN, '.claude-plugin'), path.join(pluginDir, '.claude-plugin'), { recursive: true });
    fs.cpSync(path.join(PLUGIN, 'skills'), path.join(pluginDir, 'skills'), { recursive: true });
    const bin = path.join(work, 'node_modules/.bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'uigates'), `#!/bin/sh\nexec node ${JSON.stringify(UIGATES_BIN)} "$@"\n`, { mode: 0o755 });
  }
  if (arm === 'learned' && ledger && fs.existsSync(ledger)) fs.cpSync(ledger, path.join(work, '.uigates/knowledge'), { recursive: true });
  return { work, pluginDir };
}

export function promptFor(task, arm) {
  const body = [
    'Implement the requested feature in this local project. Work only in this workspace.',
    `Only these project files may change: ${task.allowedFiles.join(', ')}. Dot-directories that tools keep their own state in (such as .git) are not project files. Inspect project code as needed and run the project's local checks. Preserve existing behavior.`,
    task.prompt,
    'Finish with a concise description of what you did and any unresolved issues.',
  ].join('\n\n');
  // Headless mode does not expand slash commands: `/uigates:uigates ...` arrives as literal text and the agent ignores it
  // (the first real run did exactly that). The treatment is asked for in words, which is how a model-invoked skill is used.
  return arm === 'control' ? body : `${SKILL_REQUEST}\n\n${body}`;
}

function cleanEnv(extra) {
  const env = { ...process.env, ...extra };
  for (const key of PROVIDER_ENV) delete env[key];
  return env;
}

const encodeCwd = dir => fs.realpathSync(dir).replace(/[^a-zA-Z0-9]/g, '-');

function runOne({ suite, task, arm, phase, out, options, ledger, order }) {
  const { work, pluginDir } = prepareWorkspace(suite, arm, ledger);
  const before = snapshot(work);
  const artifacts = [...uigatesArtifacts(work), ...(pluginDir ? ['--plugin-dir'] : [])];
  const prompt = promptFor(task, arm);
  const args = ['-p', prompt, '--output-format', 'json', '--max-turns', String(options.maxTurns), '--allowedTools', 'Bash,Edit,Write,Read,Grep,Glob', ...ISOLATION, ...(pluginDir ? ['--plugin-dir', pluginDir] : []), ...(options.model ? ['--model', options.model] : []), ...options.claudeArgs];
  const startedAt = new Date().toISOString();
  const run = spawnSync(options.claude, args, {
    cwd: work, encoding: 'utf8', timeout: options.timeoutSec * 1000, maxBuffer: 256 * 1024 * 1024,
    env: cleanEnv({ HOME: options.home, UIGATES_PRINCIPAL: 'token-ab', GIT_CONFIG_GLOBAL: '/dev/null', PATH: `${path.join(work, 'node_modules/.bin')}${path.delimiter}${process.env.PATH}` }),
  });
  let result = {};
  try { result = JSON.parse(run.stdout); } catch { /* not JSON: recorded as a failed run below */ }

  // The transcript is what the meter reads: the same file, the same parser, for every arm.
  const dir = path.join(options.home, '.claude/projects', encodeCwd(work));
  let transcript = null, cost = null;
  if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'));
    const wanted = result.session_id && files.includes(`${result.session_id}.jsonl`) ? `${result.session_id}.jsonl` : files.sort().at(-1);
    if (wanted) {
      transcript = path.join(out, 'transcripts', `${phase}.${task.id}.${arm}.jsonl`);
      fs.mkdirSync(path.dirname(transcript), { recursive: true });
      fs.copyFileSync(path.join(dir, wanted), transcript);
      const metered = spawnSync(process.execPath, [UIGATES_BIN, 'cost', '--transcripts', transcript, '--json', '--root', work], { encoding: 'utf8' });
      try { cost = JSON.parse(metered.stdout)[0].total; } catch { /* left null: the run is recorded without a cost, and analysis refuses it */ }
    }
  }

  const verifierBefore = sha(fs.readFileSync(suite.verifier));
  const verified = spawnSync(process.execPath, [suite.verifier, ...task.args, work], { encoding: 'utf8', timeout: 60_000 });
  const verifierAfter = sha(fs.readFileSync(suite.verifier));
  const after = snapshot(work);
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(f => before[f] !== after[f]);
  const unexpected = changed.filter(f => !task.allowedFiles.includes(f));

  // Did the treatment actually happen? A ceremony or learned run in which the agent never used UI-GATES is not evidence about UI-GATES.
  const compliance = { uigatesCommands: cost ? cost.toolCalls.ceremony : 0, ledgerReads: cost ? cost.ledgerReads : 0 };
  if (pluginDir) fs.rmSync(pluginDir, { recursive: true, force: true });
  const record = {
    key: `${phase}:${task.id}:${arm}`, phase, task: task.id, family: task.family, arm, order,
    accepted: run.status === 0 && !result.is_error && verified.status === 0 && !unexpected.length && verifierBefore === verifierAfter,
    verifierExit: verified.status, changed, unexpected, exit: run.status, timedOut: !!run.error && run.error.code === 'ETIMEDOUT',
    workspaceContains: artifacts, compliance, cost, hostReported: { turns: result.num_turns ?? null, usd: result.total_cost_usd ?? null, usage: result.usage ?? null },
    transcript: transcript && path.relative(out, transcript), startedAt, finishedAt: new Date().toISOString(),
  };
  const ledgerOut = arm === 'control' ? null : path.join(work, '.uigates/knowledge');
  return { record, work, ledgerOut };
}

function loadRecords(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
}

async function main() {
  const { values: v } = parseArgs({
    options: {
      suite: { type: 'string', default: 'workboard' }, out: { type: 'string' }, arms: { type: 'string', default: ARMS.join(',') },
      tasks: { type: 'string', default: 'pilot' }, seed: { type: 'string', default: '20260921' }, claude: { type: 'string', default: 'claude' },
      model: { type: 'string' }, 'max-turns': { type: 'string', default: '40' }, 'timeout-sec': { type: 'string', default: '900' },
      home: { type: 'string', default: os.homedir() }, ledger: { type: 'string' }, 'skip-learning': { type: 'boolean' },
      'dry-run': { type: 'boolean' }, 'claude-args': { type: 'string', default: '' },
    },
  });
  const suiteFile = fs.existsSync(v.suite) ? path.resolve(v.suite) : path.join(HERE, 'suites', `${v.suite}.mjs`);
  if (!fs.existsSync(suiteFile)) die(`no such suite: ${v.suite}`);
  const suite = (await import(pathToFileURL(suiteFile).href)).default;

  // The verifier is frozen by hash. If it differs from the pin, nothing runs.
  const actual = sha(fs.readFileSync(suite.verifier));
  if (suite.verifierSha256 && actual !== suite.verifierSha256) die(`the verifier differs from its pinned hash (${actual} != ${suite.verifierSha256}); refusing to run`);

  const arms = v.arms.split(',').map(a => a.trim());
  for (const a of arms) if (!ARMS.includes(a)) die(`unknown arm "${a}"`);
  const chosen = v.tasks === 'all' ? suite.tasks : v.tasks === 'pilot' ? suite.tasks.filter(t => (suite.pilot ?? []).includes(t.id)) : suite.tasks.filter(t => v.tasks.split(',').includes(t.id));
  if (!chosen.length) die('no tasks selected');
  const seed = Number(v.seed);
  const random = rng(seed);
  const plan = chosen.map(t => ({ task: t, order: shuffled(arms, random) }));

  if (v['dry-run']) {
    console.log(`suite ${suite.id}, seed ${seed}, verifier ${actual.slice(0, 12)}`);
    console.log(`learning phase: ${v['skip-learning'] || v.ledger ? 'skipped' : suite.discovery.map(t => t.id).join(', ') + ' (ceremony arm, accumulating a ledger)'}`);
    for (const p of plan) console.log(`  ${p.task.id.padEnd(16)} ${p.order.join(' > ')}`);
    return;
  }
  if (!v.out) die('--out <dir> is required');
  const out = path.resolve(v.out);
  fs.mkdirSync(out, { recursive: true });
  const resultsFile = path.join(out, 'results.jsonl');
  const done = new Set(loadRecords(resultsFile).map(r => r.key));
  const options = { claude: v.claude, model: v.model, maxTurns: Number(v['max-turns']), timeoutSec: Number(v['timeout-sec']), home: path.resolve(v.home), claudeArgs: v['claude-args'].split(' ').filter(Boolean) };
  const append = record => fs.appendFileSync(resultsFile, `${JSON.stringify(record)}\n`);
  fs.writeFileSync(path.join(out, 'protocol.json'), JSON.stringify({ suite: suite.id, seed, arms, tasks: chosen.map(t => t.id), model: v.model ?? null, verifierSha256: actual, uigates: sha(fs.readFileSync(path.join(PLUGIN, 'skills/uigates/SKILL.md'))), plan: plan.map(p => ({ task: p.task.id, order: p.order })), startedAt: new Date().toISOString() }, null, 2));

  // Learning phase: the ceremony arm on the discovery tasks, the ledger accumulating as it would in real use.
  let ledger = v.ledger ? path.resolve(v.ledger) : path.join(out, 'ledger');
  if (!v['skip-learning'] && !v.ledger && arms.includes('learned')) {
    for (const task of suite.discovery) {
      const key = `learning:${task.id}:ceremony`;
      if (done.has(key)) continue;
      console.error(`[learning] ${task.id}`);
      const { record, work, ledgerOut } = runOne({ suite, task, arm: 'ceremony', phase: 'learning', out, options, ledger, order: 0 });
      // Each discovery run starts from an empty ledger, so their lessons are merged, never overwritten.
      if (ledgerOut && fs.existsSync(ledgerOut)) fs.cpSync(ledgerOut, ledger, { recursive: true, force: true });
      append(record); fs.rmSync(work, { recursive: true, force: true });
    }
  }

  for (const { task, order } of plan) {
    for (const arm of order) {
      const key = `evaluation:${task.id}:${arm}`;
      // Resume only completed records, failures included. Never rerun an arm to get a better number.
      if (done.has(key)) { console.error(`[skip] ${key}`); continue; }
      console.error(`[run] ${key}`);
      const { record, work } = runOne({ suite, task, arm, phase: 'evaluation', out, options, ledger, order: order.indexOf(arm) });
      append(record); fs.rmSync(work, { recursive: true, force: true });
    }
  }
  console.error(`done: ${resultsFile}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
