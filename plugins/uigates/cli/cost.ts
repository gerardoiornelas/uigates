import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { stateDir } from '../core/names';

/**
 * `uigates cost`: where a session's tokens went, read from the agent host's own transcript.
 *
 * It exists because savings that are not measured are a claim, not a result. Every tool that
 * advertises token savings ships a meter; this is ours, and it is written to be fair to a
 * control run: it counts every model call, so the cost of UI-GATES' own commands (each one is a
 * tool call, and each tool call is another turn that re-reads the whole context) is not hidden.
 *
 * The transcript format is the host's (Claude Code writes JSON lines with per-call `usage`).
 * Parsing is isolated in `parseTranscript`, so another host means another parser, not another meter.
 */

export interface Usage { input: number; output: number; cacheWrite: number; cacheRead: number }
export type ToolKind = 'search' | 'read' | 'edit' | 'verify' | 'ceremony' | 'other';
export const TOOL_KINDS: ToolKind[] = ['search', 'read', 'edit', 'verify', 'ceremony', 'other'];

/**
 * Relative prices of the four token kinds, as multiples of a fresh input token. These are the
 * published ratios for Claude models at the time of writing (cache read 0.1x, 5-minute cache write
 * 1.25x, output 5x); they are an assumption and can be overridden. Raw counts are always reported too.
 */
export const DEFAULT_WEIGHTS: Usage = { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 };

export type Event =
  | { kind: 'model'; ts: number; id: string; usage: Usage }
  | { kind: 'tool_call'; ts: number; id: string; tool: string; input: Record<string, unknown>; toolKind: ToolKind }
  | { kind: 'tool_result'; ts: number; forId: string; chars: number };

const zero = (): Usage => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });
const add = (a: Usage, b: Usage): Usage => ({ input: a.input + b.input, output: a.output + b.output, cacheWrite: a.cacheWrite + b.cacheWrite, cacheRead: a.cacheRead + b.cacheRead });

export function weighted(u: Usage, w: Usage = DEFAULT_WEIGHTS): number {
  return u.input * w.input + u.cacheWrite * w.cacheWrite + u.cacheRead * w.cacheRead + u.output * w.output;
}

/** Tokens from characters: the common 3.5 to 4 characters per token; a stated approximation, used only for tool output. */
export const tokensFromChars = (chars: number) => Math.round(chars / 3.5);

const UIGATES_CMD = /(?:^|[\s;&|(])(?:npx\s+(?:--no-install\s+)?)?(?:uigates|uig)(?=\s|$)|bin\/uigates?\.mjs/;
const BASH_WRITE = /(?:^|[^\w>])(?:cat\s*>>?|tee\s|sed\s+-i|cp\s+\S+\s+\S+|mv\s+\S+\s+\S+|rm\s+-?\w*\s*\S+|install\s+-)|(?:^|\s)>>?\s*[\w./~-]+/;
const BASH_SEARCH = /^\s*(?:cd\s+[^;&|]+(?:&&|;)\s*)?(?:git\s+(?:log|status|diff|show|ls-files|grep|blame)|ls|tree|cat|head|tail|wc|grep|rg|ag|find|fd|sed\s+-n|pwd|stat|file|awk|sort|uniq)\b|\b(?:grep|rg|find)\b/;
const BASH_VERIFY = /\b(?:pytest|python3?\s|node\s|npm\s+(?:test|run)|npx\s+tsx|tsc\b|make\b|cargo\s+test|go\s+test|jest|vitest|bash\s+\S)/;

/** What kind of work a shell command is. Order matters: a UI-GATES command that mentions grep is still ceremony. */
export function classifyBash(command: string): ToolKind {
  if (UIGATES_CMD.test(command)) return 'ceremony';
  if (BASH_WRITE.test(command)) return 'edit';
  if (BASH_SEARCH.test(command)) return 'search';
  if (BASH_VERIFY.test(command)) return 'verify';
  return 'other';
}

export function classifyTool(name: string, input: Record<string, unknown>): ToolKind {
  if (name === 'Bash') return classifyBash(String(input.command ?? ''));
  if (name === 'Read' || name === 'NotebookRead') return 'read';
  if (name === 'Grep' || name === 'Glob' || name === 'LS') return 'search';
  if (name === 'Edit' || name === 'Write' || name === 'MultiEdit' || name === 'NotebookEdit') return 'edit';
  return 'other';
}

const textOf = (content: unknown): string =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.map(c => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : '')).join(' ') : '';

/** Claude Code JSON lines to events. A model call is streamed as several lines with the same message id; the last one holds the final usage. */
export function parseTranscript(text: string): Event[] {
  const events: Event[] = [];
  const modelAt = new Map<string, number>();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let d: any;
    try { d = JSON.parse(line); } catch { continue; }
    const ts = Date.parse(d.timestamp ?? '') || 0;
    const m = d.message;
    if (!m || typeof m !== 'object') continue;
    const blocks: any[] = Array.isArray(m.content) ? m.content : [];
    if (m.role === 'assistant') {
      const u = m.usage;
      if (u && m.id) {
        const usage: Usage = { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0 };
        const at = modelAt.get(m.id);
        if (at === undefined) { modelAt.set(m.id, events.length); events.push({ kind: 'model', ts, id: m.id, usage }); }
        else (events[at] as Extract<Event, { kind: 'model' }>).usage = usage;
      }
      for (const b of blocks) {
        if (b?.type === 'tool_use') events.push({ kind: 'tool_call', ts, id: b.id, tool: b.name, input: b.input ?? {}, toolKind: classifyTool(b.name, b.input ?? {}) });
      }
    } else if (m.role === 'user') {
      for (const b of blocks) {
        if (b?.type === 'tool_result') events.push({ kind: 'tool_result', ts, forId: b.tool_use_id, chars: textOf(b.content).length });
      }
    }
  }
  return events;
}

export interface Stats {
  modelCalls: number;
  usage: Usage;
  /** Cost-weighted tokens, in fresh-input-token equivalents. The number two runs are compared on. */
  weighted: number;
  toolCalls: Record<ToolKind, number>;
  /** Approximate tokens of tool output that entered the context, by kind. */
  toolOutputTokens: Record<ToolKind, number>;
  /** Tool calls made before the first edit or write. Null if the window never edits. */
  callsBeforeFirstEdit: number | null;
  /** Search and read output before the first edit: what the agent spent finding its way. */
  discoveryTokens: number | null;
  /** Share of tool calls that were UI-GATES commands: the turns the ceremony added. */
  ceremonyShare: number;
  /** Times the agent looked at the lesson ledger. */
  ledgerReads: number;
}

const kindsRecord = <T,>(v: T): Record<ToolKind, T> => Object.fromEntries(TOOL_KINDS.map(k => [k, v])) as Record<ToolKind, T>;
const LEDGER = /(?:uigates|uig)\s+(?:knowledge|brief)\b|(?:\.uigates|\.uig)\/knowledge|compound_packs/;

export function summarize(events: Event[], from = -Infinity, to = Infinity, weights: Usage = DEFAULT_WEIGHTS): Stats {
  const inWindow = events.filter(e => e.ts >= from && e.ts < to);
  let usage = zero(), modelCalls = 0;
  const toolCalls = kindsRecord(0), out = kindsRecord(0);
  const kindOf = new Map<string, ToolKind>();
  let seen = 0, firstEdit: number | null = null, discovery = 0, ledgerReads = 0;
  for (const e of inWindow) {
    if (e.kind === 'model') { usage = add(usage, e.usage); modelCalls++; }
    else if (e.kind === 'tool_call') {
      toolCalls[e.toolKind]++; kindOf.set(e.id, e.toolKind);
      if (LEDGER.test(JSON.stringify(e.input))) ledgerReads++;
      if (e.toolKind === 'edit' && firstEdit === null) firstEdit = seen;
      seen++;
    } else {
      const k = kindOf.get(e.forId) ?? 'other';
      const t = tokensFromChars(e.chars);
      out[k] += t;
      if (firstEdit === null && (k === 'search' || k === 'read')) discovery += t;
    }
  }
  const calls = TOOL_KINDS.reduce((n, k) => n + toolCalls[k], 0);
  return {
    modelCalls, usage, weighted: Math.round(weighted(usage, weights)), toolCalls, toolOutputTokens: out,
    callsBeforeFirstEdit: firstEdit, discoveryTokens: firstEdit === null ? null : discovery,
    ceremonyShare: calls ? toolCalls.ceremony / calls : 0, ledgerReads,
  };
}

export interface IntentWindow { id: string; goal: string; from: number; to: number }

/** Split a session at each intent's creation. Activity before the first intent (reading the repo, orienting) is its own window: it is often where the searching happens. */
export function windowsFor(events: Event[], intents: { id: string; goal: string; createdAt: string | Date }[]): IntentWindow[] {
  const ts = events.map(e => e.ts).filter(Boolean);
  if (!ts.length) return [];
  const start = Math.min(...ts), end = Math.max(...ts) + 1;
  const starts = intents.map(i => ({ id: i.id, goal: i.goal, at: Date.parse(String(i.createdAt)) })).filter(i => i.at >= start && i.at < end).sort((a, b) => a.at - b.at);
  const out: IntentWindow[] = [];
  if (!starts.length || starts[0].at > start) out.push({ id: 'before-intent', goal: 'reading the repo before an intent existed', from: start, to: starts[0]?.at ?? end });
  starts.forEach((s, i) => out.push({ id: s.id, goal: s.goal, from: s.at, to: starts[i + 1]?.at ?? end }));
  return out;
}

/** Where Claude Code keeps a project's transcripts: the working directory with every non-alphanumeric character as `-`. */
export function claudeTranscriptDir(root: string, home = os.homedir()): string {
  return path.join(home, '.claude', 'projects', fs.realpathSync(root).replace(/[^a-zA-Z0-9]/g, '-'));
}

export interface SessionReport { file: string; total: Stats; windows: { window: IntentWindow; stats: Stats }[] }

export function reportFor(root: string, files: string[], weights: Usage = DEFAULT_WEIGHTS): SessionReport[] {
  const intentDir = path.join(stateDir(root), 'intents');
  const intents = fs.existsSync(intentDir)
    ? fs.readdirSync(intentDir).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(intentDir, f), 'utf8')))
    : [];
  return files.map(file => {
    const events = parseTranscript(fs.readFileSync(file, 'utf8'));
    return {
      file: path.basename(file),
      total: summarize(events, -Infinity, Infinity, weights),
      windows: windowsFor(events, intents).map(window => ({ window, stats: summarize(events, window.from, window.to, weights) })),
    };
  });
}

const n = (x: number) => x.toLocaleString('en-US');
const pct = (x: number) => `${Math.round(x * 100)}%`;

export function formatCost(reports: SessionReport[]): string {
  const lines: string[] = [];
  for (const r of reports) {
    const s = r.total;
    lines.push(`Session ${r.file}`);
    lines.push(`  model calls ${s.modelCalls}   weighted ${n(s.weighted)}   (output ${n(s.usage.output)}, fresh input ${n(s.usage.input)}, cache written ${n(s.usage.cacheWrite)}, cache re-read ${n(s.usage.cacheRead)})`);
    lines.push(`  tool calls ${TOOL_KINDS.map(k => `${k} ${s.toolCalls[k]}`).join(', ')}; ${pct(s.ceremonyShare)} were uigates commands`);
    lines.push(`  tool output entering context (~tokens): ${TOOL_KINDS.map(k => `${k} ${n(s.toolOutputTokens[k])}`).join(', ')}`);
    lines.push(`  discovery: ${s.callsBeforeFirstEdit ?? 'no edit'} tool calls and ~${s.discoveryTokens === null ? '-' : n(s.discoveryTokens)} tokens of search/read output before the first edit; ledger looked at ${s.ledgerReads}x`);
    for (const { window, stats } of r.windows) {
      lines.push(`    ${window.id === 'before-intent' ? 'before any intent' : window.id.slice(-8)}: calls ${stats.modelCalls}, weighted ${n(stats.weighted)}, ceremony ${pct(stats.ceremonyShare)} of ${TOOL_KINDS.reduce((a, k) => a + stats.toolCalls[k], 0)} tool calls, discovery ~${stats.discoveryTokens === null ? '-' : n(stats.discoveryTokens)}  ${window.goal.slice(0, 60)}`);
    }
  }
  lines.push('', `Weighted = fresh input x${DEFAULT_WEIGHTS.input} + cache write x${DEFAULT_WEIGHTS.cacheWrite} + cache re-read x${DEFAULT_WEIGHTS.cacheRead} + output x${DEFAULT_WEIGHTS.output}: an assumption about relative prices, not a bill. Tool-output tokens are characters / 3.5.`);
  return lines.join('\n');
}
