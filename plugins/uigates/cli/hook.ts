import * as fs from 'fs';
import * as path from 'path';
import type { Authorization, Intent, Proposal, Receipt } from '../core/types/primitives';
import { covers, readRecords, type Finding } from './audit';

/**
 * `uig hook pre-write`: a Claude Code PreToolUse hook that refuses a Write, Edit, MultiEdit or
 * NotebookEdit unless an authorization already covers the file. It exists because the audit can
 * report a file written before it was authorized (trial task 2 did that twice) but cannot stop it.
 *
 * Limits, stated because they decide what this is worth:
 *  - It sees only the file-editing tools. A write made through Bash (`cat >> file`, `sed -i`) is
 *    invisible to it, and so is anything an agent does outside the harness.
 *  - It is opt-in (`uig enforce on` or UIG_ENFORCE=1). An active intent lasts 24 hours by default,
 *    and a hook that locks the project for that long during ordinary work would be worse than none.
 *  - It fails open. Only a definite refusal exits 2, which is what blocks the tool call; every
 *    internal error exits 1, which does not.
 */

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

export interface HookPayload {
  tool_name?: string;
  tool_input?: { file_path?: string; notebook_path?: string };
  cwd?: string;
}

export interface HookDecision { allow: boolean; message?: string }

const allow = (): HookDecision => ({ allow: true });
const refuse = (message: string): HookDecision => ({ allow: false, message: `uig: ${message}` });

export function enforcementOn(root: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return env.UIG_ENFORCE === '1' || fs.existsSync(path.join(root, '.uig', 'enforce'));
}

/** Resolve symlinks through the deepest part of the path that exists, so /tmp and /private/tmp agree. */
function realish(p: string): string {
  let cur = p;
  const tail: string[] = [];
  while (!fs.existsSync(cur)) {
    const up = path.dirname(cur);
    if (up === cur) return p;
    tail.unshift(path.basename(cur));
    cur = up;
  }
  return path.join(fs.realpathSync(cur), ...tail);
}

export function decideWrite(root: string, payload: HookPayload, now = Date.now()): HookDecision {
  if (!payload.tool_name || !EDIT_TOOLS.has(payload.tool_name)) return allow();
  const target = payload.tool_input?.file_path ?? payload.tool_input?.notebook_path;
  if (!target) return allow();

  const realRoot = fs.realpathSync(root);
  const rel = path.relative(realRoot, realish(path.resolve(payload.cwd ?? root, target))).split(path.sep).join('/');
  // Outside the project there is no authorization to check; the host's own permissions govern that.
  if (rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) return allow();

  if (rel === '.uig' || rel.startsWith('.uig/')) {
    return refuse(`${rel} is UI-GATES state. It is written only by the uig CLI and cannot be edited through a file tool.`);
  }

  const sink: Finding[] = [];
  const intents = readRecords<Intent>(root, 'intents', sink);
  const active = intents.filter(i => Date.parse(String(i.expiry)) > now);
  if (!active.length) {
    return refuse(`no active intent, so nothing authorizes editing ${rel}. Start one with: uig start "<goal>" --domain <path> --success <evidence>`);
  }
  const activeIds = new Set(active.map(i => i.id));
  const latest = [...active].sort((a, b) => Date.parse(String(b.createdAt)) - Date.parse(String(a.createdAt)))[0];

  const authorizations = readRecords<Authorization>(root, 'authorizations', sink);
  const spent = new Set(readRecords<Receipt>(root, 'receipts', sink).map(r => r.authorizationId));
  const live = authorizations.filter(a =>
    activeIds.has(a.intentId) && (a.state === 'delegated' || a.state === 'gated') && !spent.has(a.id) &&
    (a.expiry === undefined || Date.parse(String(a.expiry)) > now));
  if (live.some(a => covers(a.resource, rel))) return allow();

  // A record the hook cannot read is an internal error, not a verdict: fail open and say so. The audit fails it.
  if (sink.length) throw new Error(`${sink[0].message} Run uig audit.`);

  const proposals = readRecords<Proposal>(root, 'proposals', sink);
  const authorized = new Set(authorizations.map(a => a.proposalId));
  const waiting = proposals.find(p => activeIds.has(p.intentId) && !authorized.has(p.id) && covers(p.resource, rel));
  const wasSpent = authorizations.some(a => activeIds.has(a.intentId) && spent.has(a.id) && covers(a.resource, rel));

  if (waiting) {
    return refuse(`${rel} is covered by proposal ${waiting.id}, which is not authorized yet. Authorize it (a gated one needs the principal's approval in conversation first), then edit.`);
  }
  return refuse(`${rel} is not covered by an unspent authorization. ${wasSpent
    ? 'The one that covered it already has a receipt; a further edit needs a new proposal (after a delta, with a replan).'
    : `Propose it, then authorize it, before editing: uig propose ${latest.id} --action ... --resource ${rel} --impact ... --rationale ... --risk ... --verify ...`}`);
}

/** Entry point for the CLI: reads the hook payload from stdin. Never lets an internal error block an edit. */
export function runHook(root: string, stdin: string): { exit: 0 | 1 | 2; stderr?: string } {
  try {
    if (!enforcementOn(root)) return { exit: 0 };
    const payload = JSON.parse(stdin) as HookPayload;
    const decision = decideWrite(root, payload);
    return decision.allow ? { exit: 0 } : { exit: 2, stderr: decision.message };
  } catch (error) {
    return { exit: 1, stderr: `uig hook: ${error instanceof Error ? error.message : String(error)} (edit allowed)` };
  }
}
