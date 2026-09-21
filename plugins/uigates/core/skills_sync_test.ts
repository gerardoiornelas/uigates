import * as fs from 'fs';
import * as path from 'path';

/**
 * The docs call `skills/uig/SKILL.md` the portable source and the platform copies
 * "intentionally small". Small is fine; missing the essentials is not: an agent that
 * loads the .claude or .agents copy must still get the rules the canonical one states.
 * This checks each copy carries every essential, and that the two identical
 * platform copies stay identical. It does not check wording beyond the essentials.
 *
 * Run: npx tsx plugins/uigates/core/skills_sync_test.ts
 */

const repo = path.resolve(__dirname, '../../..');
const read = (p: string) => fs.readFileSync(path.join(repo, p), 'utf8');

const COPIES = [
  'skills/uig/SKILL.md',              // canonical, portable
  'skills/ui-gates/SKILL.md',         // formal, long-form
  '.claude/skills/uig/SKILL.md',      // Claude Code
  '.agents/skills/uig/SKILL.md',      // Gemini and other agents
  'plugins/uigates/skills/uig/SKILL.md', // Codex plugin
];

const ESSENTIALS: [name: string, test: RegExp][] = [
  ['core rule: reasoning proposes, authority decides, verified work synthesizes', /reasoning proposes\W+authority decides\W+verified work synthesizes into reusable knowledge/i],
  ['authority states: observe, delegated, gated, prohibited', /observe[\s\S]*delegated[\s\S]*gated[\s\S]*prohibited/i],
  ['Expected/Actual/Delta after each step', /Expected\/Actual\/Delta|\*\*Expected\*\*[\s\S]*\*\*Actual\*\*[\s\S]*\*\*Delta\*\*/],
  ['no retry on a delta without returning to planning', /(replan|return(ing)? to \**(plan|planning|Discover and plan))/i],
  ['promotion ladder, with the canonical spelling', /Ephemeral → Task → Decision → Knowledge → Canon/],
  ['stop and ask the principal on gated, prohibited, unknown or failing work', /Stop and ask the principal/],
  ['engine recording, with the no-self-approval rule', /npx --no-install uig help[\s\S]*(approved-by|approve)[\s\S]*(principal's|principal)/],
  ['honest fallback without the engine', /not engine-verified/],
  ['completion line', /UI-GATES COMPLETE — outcome verified, provenance recorded, next work grounded\./],
];
const FORBIDDEN: [name: string, test: RegExp][] = [
  ['the retired ladder spelling', /→ Pattern\b/],
];

let failed = 0;
const line = (ok: boolean, msg: string) => { if (!ok) failed++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

console.log('\n=== SKILL COPIES: every copy carries the essentials ===\n');
for (const file of COPIES) {
  const text = read(file);
  const missing = ESSENTIALS.filter(([, re]) => !re.test(text)).map(([n]) => n);
  const forbidden = FORBIDDEN.filter(([, re]) => re.test(text)).map(([n]) => n);
  line(!missing.length && !forbidden.length, `${file}${missing.length ? `  — missing: ${missing.join('; ')}` : ''}${forbidden.length ? `  — contains: ${forbidden.join('; ')}` : ''}`);
}
line(read('.claude/skills/uig/SKILL.md') === read('.agents/skills/uig/SKILL.md'), '.claude and .agents copies are identical');

console.log('\n=== PLUGIN MANIFESTS: the namespace is /uigates:uig, so the name must agree everywhere ===\n');
const codex = JSON.parse(read('plugins/uigates/.codex-plugin/plugin.json'));
const claudeCode = JSON.parse(read('plugins/uigates/.claude-plugin/plugin.json'));
line(claudeCode.name === 'uigates', 'the Claude Code manifest is named "uigates", which makes the skill /uigates:uig');
line(codex.name === claudeCode.name, 'the Codex and Claude Code manifests share one name');
line(codex.version === claudeCode.version, `the manifests share one version (${codex.version} / ${claudeCode.version})`);

console.log(`\n=== SUMMARY: ${failed ? `${failed} problem(s)` : 'all copies consistent'} ===`);
process.exit(failed ? 1 : 0);
