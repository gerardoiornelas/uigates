import * as fs from 'fs';
import type { Runtime } from '../core/Runtime';
import type { Authorization, Intent, Proposal, Receipt } from '../core/types/primitives';
import { loadKnowledge, type KnowledgePack } from '../intelligence/ce/synthesizer';
import { claudeTranscriptDir, DEFAULT_WEIGHTS, reportFor, type SessionReport, type Usage } from './cost';

/**
 * `uigates dashboard`: one read-only view of what a working session has to show for itself —
 * gates still open, gates cleared, what got promoted to a lesson, and what it cost. Each number
 * already exists behind its own command (`status`, `knowledge`, `cost`); this composes them so a
 * person working in a real repo does not have to run four commands and hold the picture in their
 * head. It writes nothing and calls only read operations (`gov.evaluate` memoizes in memory for the
 * lifetime of this process, which ends with it; nothing on disk changes).
 */

export interface GateRow {
  intentId: string;
  proposalId: string;
  /** Set only once a proposal has been authorized: it identifies what `receipt` needs. */
  authorizationId?: string;
  action: string;
  resource: string;
  /** What is standing between this proposal and a receipt. */
  status: 'awaiting-authorize' | 'awaiting-principal' | 'awaiting-receipt' | 'denied';
  /** Why, for 'denied' and 'awaiting-principal'. */
  reason?: string;
}

export interface ClearedRow {
  intentId: string;
  authorizationId: string;
  action: string;
  resource: string;
  authority: 'delegated' | 'gated';
  lesson: boolean;
}

export interface FailedRow {
  intentId: string;
  authorizationId: string;
  action: string;
  resource: string;
  delta: string;
}

export interface DashboardReport {
  generatedAt: string;
  root: string;
  intents: { id: string; goal: string; principal: string; active: boolean; expiry: string }[];
  gates: {
    remaining: GateRow[];
    accomplished: ClearedRow[];
    /** A receipt exists, but its verification ended in a delta: the authorization is spent and the
     * work is unfinished. Not 'remaining' (nothing pending clears it by itself; a new proposal with
     * `--replan-after` would be its own row above) and not 'accomplished' (it did not succeed). */
    failures: FailedRow[];
    /** Convenience counts; derivable from the rows above, kept so a consumer need not recompute them. */
    counts: { remaining: number; awaitingPrincipal: number; accomplished: number; gatedGranted: number; failures: number };
  };
  knowledge: {
    packs: KnowledgePack[];
    counts: { total: number; verified: number; conflicted: number; retired: number; candidates: number; needsPrincipal: number };
  };
  cost?: { sessions: SessionReport[]; totalWeighted: number; totalModelCalls: number; ceremonyShare: number; transcriptsUsed: string[] };
}

/**
 * Every proposal that has not yet produced a receipt, classified by what it is actually waiting
 * on: authorization, the principal's yes on a gated action, or (already authorized) the work and
 * its verification. A proposal the engine would deny outright (an expired intent, an out-of-domain
 * resource) is 'denied': nothing pending will clear it, and it is not counted toward 'remaining'
 * work a person still has to act on, only reported so it does not vanish silently.
 */
function classifyOpenGates(
  rt: Runtime, proposals: Proposal[], intentById: Map<string, Intent>,
  authByProposal: Map<string, Authorization>, receiptedAuthIds: Set<string>,
): GateRow[] {
  return proposals
    .map((p): GateRow | null => {
      const base = { intentId: p.intentId, proposalId: p.id, action: p.action, resource: p.resource };
      const auth = authByProposal.get(p.id);
      if (auth) {
        if (receiptedAuthIds.has(auth.id)) return null; // has a receipt: not open, see classifyClearedGates
        return { ...base, authorizationId: auth.id, status: 'awaiting-receipt' };
      }
      const intent = intentById.get(p.intentId);
      if (!intent) return { ...base, status: 'denied', reason: 'its intent no longer exists' };
      const evaluation = rt.gov.evaluate(p, intent);
      if (evaluation.denied) return { ...base, status: 'denied', reason: evaluation.rationale };
      if (evaluation.suggestedState === 'gated') return { ...base, status: 'awaiting-principal', reason: evaluation.rationale };
      return { ...base, status: 'awaiting-authorize' };
    })
    .filter((row): row is GateRow => row !== null);
}

const isDeltaFree = (r: Receipt) => r.delta.trim().toLowerCase() === 'none';

/** Authorization + receipt pairs, split into what succeeded and what did not. */
function classifyReceiptedGates(authorizations: Authorization[], receipts: Receipt[]): { accomplished: ClearedRow[]; failures: FailedRow[] } {
  const receiptByAuth = new Map(receipts.map(r => [r.authorizationId, r]));
  const pairs = authorizations
    .filter(a => a.state === 'delegated' || a.state === 'gated')
    .map(a => ({ authorization: a, receipt: receiptByAuth.get(a.id) }))
    .filter((x): x is { authorization: Authorization; receipt: Receipt } => !!x.receipt);
  const accomplished = pairs.filter(({ receipt }) => isDeltaFree(receipt)).map(({ authorization: a, receipt: r }) => ({
    intentId: a.intentId, authorizationId: a.id, action: a.action, resource: a.resource,
    authority: a.state as 'delegated' | 'gated', lesson: !!r.lesson?.trim(),
  }));
  const failures = pairs.filter(({ receipt }) => !isDeltaFree(receipt)).map(({ authorization: a, receipt: r }) => ({
    intentId: a.intentId, authorizationId: a.id, action: a.action, resource: a.resource, delta: r.delta,
  }));
  return { accomplished, failures };
}

export function buildDashboard(root: string, rt: Runtime, options: { transcripts?: string[]; weights?: Usage } = {}): DashboardReport {
  const intents = rt.state.listIntents();
  const intentById = new Map(intents.map(i => [i.id, i]));
  const proposals = rt.state.listProposals();
  const authorizations = rt.state.listAuthorizations();
  const receipts = rt.state.listReceipts();
  const authByProposal = new Map(authorizations.map(a => [a.proposalId, a]));
  const receiptedAuthIds = new Set(receipts.map(r => r.authorizationId));

  const remaining = classifyOpenGates(rt, proposals, intentById, authByProposal, receiptedAuthIds);
  const { accomplished, failures } = classifyReceiptedGates(authorizations, receipts);

  const packs = loadKnowledge(root);

  const report: DashboardReport = {
    generatedAt: new Date().toISOString(),
    root,
    intents: intents.map(i => ({ id: i.id, goal: i.goal, principal: i.principalId, active: new Date(i.expiry).getTime() > Date.now(), expiry: new Date(i.expiry).toISOString() })),
    gates: {
      remaining,
      accomplished,
      failures,
      counts: {
        remaining: remaining.filter(g => g.status !== 'denied').length,
        awaitingPrincipal: remaining.filter(g => g.status === 'awaiting-principal').length,
        accomplished: accomplished.length,
        gatedGranted: accomplished.filter(a => a.authority === 'gated').length,
        failures: failures.length,
      },
    },
    knowledge: {
      packs,
      counts: {
        total: packs.length,
        verified: packs.filter(p => p.status === 'verified').length,
        conflicted: packs.filter(p => p.status === 'conflicted').length,
        retired: packs.filter(p => p.status === 'retired').length,
        candidates: packs.filter(p => p.candidate).length,
        needsPrincipal: packs.filter(p => p.needsPrincipal).length,
      },
    },
  };

  const dir = options.transcripts ?? [claudeTranscriptDir(root)];
  const files = dir
    .flatMap(p => (fs.existsSync(p) && fs.statSync(p).isDirectory() ? fs.readdirSync(p).filter(f => f.endsWith('.jsonl')).map(f => `${p}/${f}`) : [p]))
    .filter(f => fs.existsSync(f))
    .sort();
  if (files.length) {
    const sessions = reportFor(root, files, options.weights ?? DEFAULT_WEIGHTS);
    const totalWeighted = sessions.reduce((sum, s) => sum + s.total.weighted, 0);
    const totalModelCalls = sessions.reduce((sum, s) => sum + s.total.modelCalls, 0);
    const totalToolCalls = sessions.reduce((sum, s) => sum + Object.values(s.total.toolCalls).reduce((a, b) => a + b, 0), 0);
    const ceremonyCalls = sessions.reduce((sum, s) => sum + s.total.toolCalls.ceremony, 0);
    report.cost = { sessions, totalWeighted, totalModelCalls, ceremonyShare: totalToolCalls ? ceremonyCalls / totalToolCalls : 0, transcriptsUsed: files };
  }

  return report;
}

const n = (x: number) => Math.round(x).toLocaleString();
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function formatDashboard(r: DashboardReport): string {
  const lines: string[] = [];
  lines.push(`UI-GATES dashboard — ${r.root}`, `Generated ${r.generatedAt}`, '');

  lines.push(`Intents: ${r.intents.length} (${r.intents.filter(i => i.active).length} active)`);
  for (const i of r.intents) lines.push(`  ${i.id}  ${i.active ? 'active' : 'EXPIRED'}  principal ${i.principal}  "${i.goal}"`);
  lines.push('');

  lines.push(`Gates remaining: ${r.gates.counts.remaining} (${r.gates.counts.awaitingPrincipal} awaiting the principal)`);
  for (const g of r.gates.remaining) {
    const label = g.status === 'awaiting-principal' ? 'AWAITING PRINCIPAL' : g.status === 'awaiting-authorize' ? 'awaiting authorize' : g.status === 'awaiting-receipt' ? 'awaiting receipt' : 'DENIED';
    lines.push(`  [${label}] ${g.action} -> ${g.resource}${g.reason ? `  (${g.reason})` : ''}`);
  }
  lines.push('');

  lines.push(`Gates accomplished: ${r.gates.counts.accomplished} (${r.gates.counts.gatedGranted} were gated)`);
  for (const a of r.gates.accomplished) lines.push(`  [${a.authority}${a.lesson ? ', lesson' : ''}] ${a.action} -> ${a.resource}`);
  lines.push('');

  lines.push(`Gates failed (a receipt exists, but the verification ended in a delta): ${r.gates.counts.failures}`);
  for (const f of r.gates.failures) lines.push(`  ${f.action} -> ${f.resource}  (${f.delta})`);
  lines.push('');

  lines.push(`Knowledge: ${r.knowledge.counts.total} pack(s) — ${r.knowledge.counts.verified} verified, ${r.knowledge.counts.conflicted} conflicted, ${r.knowledge.counts.retired} retired, ${r.knowledge.counts.candidates} candidate(s), ${r.knowledge.counts.needsPrincipal} needing the principal`);
  for (const p of r.knowledge.packs) lines.push(`  [${p.level}/${p.status}] ${p.action}  (${p.intents.length} intent${p.intents.length === 1 ? '' : 's'})`);
  lines.push('');

  if (r.cost) {
    lines.push(`Cost: ${n(r.cost.totalWeighted)} weighted tokens, ${r.cost.totalModelCalls} model calls, ${pct(r.cost.ceremonyShare)} of tool calls were uigates commands`);
    lines.push(`  from: ${r.cost.transcriptsUsed.map(f => f.split('/').pop()).join(', ')}`);
  } else {
    lines.push('Cost: no transcripts found. Pass --transcripts <file|dir>, or run this from a Claude Code session in this project.');
  }
  return lines.join('\n');
}

const esc = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const bar = (share: number, cls = ''): string => `<div class="bar${cls ? ` ${cls}` : ''}"><div class="fill" style="width:${Math.max(0, Math.min(100, share * 100))}%"></div></div>`;

/**
 * A single, self-contained, offline HTML file: the data is embedded at generation time, there is
 * no fetch and no external stylesheet or script, so it opens as a plain local file and never goes
 * stale silently — it just stops matching reality until this command is run again. That trade
 * (rerun to refresh, instead of a live page) is deliberate: this may describe a private local
 * repository, and nothing here should assume a server or a network.
 */
export function renderDashboardHtml(r: DashboardReport): string {
  const statusLabel: Record<GateRow['status'], string> = {
    'awaiting-principal': 'awaiting principal', 'awaiting-authorize': 'awaiting authorize', 'awaiting-receipt': 'awaiting receipt', denied: 'denied',
  };
  const gateRows = r.gates.remaining.length
    ? r.gates.remaining.map(g => `<tr class="s-${g.status}"><td><span class="pill">${statusLabel[g.status]}</span></td><td>${esc(g.action)}</td><td><code>${esc(g.resource)}</code></td><td class="muted">${g.reason ? esc(g.reason) : ''}</td></tr>`).join('')
    : `<tr><td colspan="4" class="muted">Nothing open.</td></tr>`;
  const clearedRows = r.gates.accomplished.length
    ? r.gates.accomplished.map(a => `<tr><td><span class="pill pill-${a.authority}">${a.authority}</span></td><td>${esc(a.action)}</td><td><code>${esc(a.resource)}</code></td><td>${a.lesson ? '✓' : ''}</td></tr>`).join('')
    : `<tr><td colspan="4" class="muted">None yet.</td></tr>`;
  const failedRows = r.gates.failures.length
    ? r.gates.failures.map(f => `<tr><td>${esc(f.action)}</td><td><code>${esc(f.resource)}</code></td><td class="warn">${esc(f.delta)}</td></tr>`).join('')
    : `<tr><td colspan="3" class="muted">None.</td></tr>`;
  const knowledgeRows = r.knowledge.packs.length
    ? r.knowledge.packs.map(p => `<tr><td><span class="pill pill-${p.status}">${p.level}/${p.status}</span></td><td>${esc(p.action)}</td><td>${p.intents.length}</td><td>${p.candidate ? '✓' : ''}</td><td>${p.needsPrincipal ? '✓' : ''}</td></tr>`).join('')
    : `<tr><td colspan="5" class="muted">None yet.</td></tr>`;
  const costSection = r.cost ? `
    <div class="cards">
      <div class="card"><div class="num">${n(r.cost.totalWeighted)}</div><div class="label">weighted tokens</div></div>
      <div class="card"><div class="num">${r.cost.totalModelCalls}</div><div class="label">model calls</div></div>
      <div class="card"><div class="num">${pct(r.cost.ceremonyShare)}</div><div class="label">tool calls were uigates commands</div>${bar(r.cost.ceremonyShare, 'ceremony')}</div>
    </div>
    <p class="muted">from ${r.cost.transcriptsUsed.length} transcript(s): ${r.cost.transcriptsUsed.map(f => esc(f.split('/').pop() ?? f)).join(', ')}</p>`
    : `<p class="muted">No transcripts found. Pass --transcripts, or generate this from a Claude Code session in this project.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>UI-GATES dashboard</title>
<style>
  :root { --bg:#0b0d12; --panel:#12151c; --border:#242a35; --text:#e6e8ec; --muted:#8891a0; --accent:#5b8cff; --good:#3fbf7f; --warn:#e0a53f; --bad:#e05f5f; }
  @media (prefers-color-scheme: light) {
    :root { --bg:#f6f7fa; --panel:#ffffff; --border:#e1e4ea; --text:#1b1f27; --muted:#5b6472; --accent:#3660d6; --good:#1f9d63; --warn:#a86a10; --bad:#c03b3b; }
  }
  * { box-sizing: border-box; }
  body { margin:0; padding:24px; background:var(--bg); color:var(--text); font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
  h1 { font-size:18px; margin:0 0 2px; }
  .sub { color:var(--muted); font-size:12px; margin:0 0 24px; }
  h2 { font-size:14px; margin:28px 0 10px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; }
  .cards { display:flex; flex-wrap:wrap; gap:12px; }
  .card { background:var(--panel); border:1px solid var(--border); border-radius:10px; padding:14px 16px; min-width:140px; flex:1 1 140px; }
  .num { font-size:22px; font-weight:600; }
  .label { color:var(--muted); font-size:12px; margin-top:2px; }
  table { width:100%; border-collapse:collapse; background:var(--panel); border:1px solid var(--border); border-radius:10px; overflow:hidden; }
  th, td { text-align:left; padding:8px 12px; border-bottom:1px solid var(--border); font-size:13px; vertical-align:top; }
  th { color:var(--muted); font-weight:500; font-size:11px; text-transform:uppercase; letter-spacing:.03em; }
  tr:last-child td { border-bottom:none; }
  code { font-family:ui-monospace,Menlo,monospace; font-size:12px; }
  .muted { color:var(--muted); }
  .warn { color:var(--warn); }
  .pill { display:inline-block; padding:2px 8px; border-radius:999px; font-size:11px; background:var(--border); }
  .s-awaiting-principal .pill, .pill-gated { background:color-mix(in srgb, var(--warn) 25%, transparent); color:var(--warn); }
  .s-denied .pill, .pill-conflicted { background:color-mix(in srgb, var(--bad) 25%, transparent); color:var(--bad); }
  .pill-verified, .pill-delegated { background:color-mix(in srgb, var(--good) 25%, transparent); color:var(--good); }
  .bar { height:6px; border-radius:4px; background:var(--border); margin-top:8px; overflow:hidden; }
  .bar .fill { height:100%; background:var(--accent); }
  .bar.ceremony .fill { background:var(--warn); }
  footer { margin-top:32px; color:var(--muted); font-size:11px; }
</style>
</head>
<body>
  <h1>UI-GATES dashboard</h1>
  <p class="sub">${esc(r.root)} — generated ${esc(r.generatedAt)}</p>

  <div class="cards">
    <div class="card"><div class="num">${r.intents.filter(i => i.active).length}/${r.intents.length}</div><div class="label">active intents</div></div>
    <div class="card"><div class="num">${r.gates.counts.remaining}</div><div class="label">gates remaining (${r.gates.counts.awaitingPrincipal} awaiting principal)</div></div>
    <div class="card"><div class="num">${r.gates.counts.accomplished}</div><div class="label">gates accomplished (${r.gates.counts.gatedGranted} gated)</div></div>
    <div class="card"><div class="num">${r.knowledge.counts.total}</div><div class="label">knowledge packs (${r.knowledge.counts.candidates} candidate)</div></div>
  </div>

  <h2>Gates remaining</h2>
  <table><thead><tr><th>Status</th><th>Action</th><th>Resource</th><th>Why</th></tr></thead><tbody>${gateRows}</tbody></table>

  <h2>Gates accomplished</h2>
  <table><thead><tr><th>Authority</th><th>Action</th><th>Resource</th><th>Lesson</th></tr></thead><tbody>${clearedRows}</tbody></table>

  <h2>Gates failed (verified, but ended in a delta)</h2>
  <table><thead><tr><th>Action</th><th>Resource</th><th>Delta</th></tr></thead><tbody>${failedRows}</tbody></table>

  <h2>Knowledge</h2>
  <table><thead><tr><th>Level/status</th><th>Action</th><th>Intents</th><th>Candidate</th><th>Needs principal</th></tr></thead><tbody>${knowledgeRows}</tbody></table>

  <h2>Cost</h2>
  ${costSection}

  <footer>Static snapshot from <code>uigates dashboard --html</code>. Re-run it to refresh; this file does not update itself.</footer>
</body>
</html>
`;
}
