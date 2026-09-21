import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import type { Authorization, Intent, Proposal, Receipt } from '../core/types/primitives';
import { gateClassOf } from '../core/GateClass';

/**
 * `uig audit` scores a finished session from the outside: it compares what changed in the working
 * tree with what `.uig/` says was authorized and verified. It is deterministic, uses no model, and
 * is read-only. It reads the records directly rather than through the engine's Runtime, so it does
 * not trust the code it is checking.
 *
 * What it can and cannot show is stated in each check. Records are plain files the agent's process
 * can write, so a clean audit means "consistent with the records", not "the agent behaved".
 */

export type Severity = 'FAIL' | 'WARN' | 'INFO';
export type Check = 'coverage' | 'gate' | 'evidence' | 'ordering' | 'impact' | 'records';
export type Impact = 'low' | 'medium' | 'high';

export interface Finding { severity: Severity; check: Check; message: string }

export interface ChangedFile { path: string; status: 'A' | 'M' | 'D' | 'U' }

export interface FileRow {
  path: string;
  status: ChangedFile['status'];
  gateClass: string | null;
  authorizations: string[];
  gated: boolean;
  verified: boolean;
}

export interface ReceiptRow {
  id: string;
  authorizationId: string;
  kind: 'cli-run' | 'asserted';
  command?: string;
  exit?: string;
  hashOk: boolean;
  delta: string;
}

export interface ImpactRow { proposalId: string; declared: Impact; observed: Impact | 'none'; files: number }

export interface AuditReport {
  root: string;
  base: string;
  intents: string[];
  files: FileRow[];
  receipts: ReceiptRow[];
  gated: { authorizationId: string; resource: string; approvedAfterSec: number }[];
  attempts: { proposalId: string; action: string }[];
  impact: ImpactRow[];
  findings: Finding[];
}

const MEDIUM_FILE_COUNT = 5;
const CLOCK_TOLERANCE_MS = 2_000;
const HUMAN_APPROVAL_MIN_SEC = 5;
const RANK: Record<Impact | 'none', number> = { none: -1, low: 0, medium: 1, high: 2 };

/** A verifier that cannot fail verifies nothing. */
const VACUOUS = [/^(true|:|exit 0)$/, /^echo\b/, /^sleep\b/, /process\.exit\(0\)/, /^python3? -c ['"]pass['"]$/];

class AuditError extends Error {}

const norm = (p: string) => path.posix.normalize(p.replace(/\\/g, '/')).replace(/^\.\//, '').replace(/\/$/, '');
const sha256 = (data: Uint8Array) => crypto.createHash('sha256').update(data).digest('hex');

export function covers(resource: string, file: string): boolean {
  const r = norm(resource);
  if (r === '.' || r === '' || r === '/') return true;
  return file === r || file.startsWith(`${r}/`);
}

function git(root: string, args: string[]): string {
  const run = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) throw new AuditError(`git ${args.join(' ')} failed: ${(run.stderr || run.error?.message || '').trim()}`);
  return run.stdout;
}

/** Everything that differs from `base`: staged, unstaged, committed since, and untracked. `.uig/` is the record, not a change. */
export function changedFiles(root: string, base: string): ChangedFile[] {
  git(root, ['rev-parse', '--verify', `${base}^{commit}`]);
  const out = new Map<string, ChangedFile>();
  const tracked = git(root, ['diff', '--name-status', '--no-renames', '-z', base]).split('\0');
  for (let i = 0; i + 1 < tracked.length; i += 2) {
    const status = tracked[i] === 'D' ? 'D' : tracked[i] === 'A' ? 'A' : 'M';
    out.set(tracked[i + 1], { path: tracked[i + 1], status });
  }
  for (const file of git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0')) {
    if (file) out.set(file, { path: file, status: 'U' });
  }
  return [...out.values()].filter(f => !/^\.uig(\/|$)/.test(f.path)).sort((a, b) => a.path.localeCompare(b.path));
}

function readRecords<T>(root: string, dir: string, findings: Finding[]): T[] {
  const full = path.join(root, '.uig', dir);
  if (!fs.existsSync(full)) return [];
  const out: T[] = [];
  for (const file of fs.readdirSync(full).filter(f => f.endsWith('.json')).sort()) {
    try { out.push(JSON.parse(fs.readFileSync(path.join(full, file), 'utf8')) as T); }
    catch { findings.push({ severity: 'FAIL', check: 'records', message: `Unreadable record .uig/${dir}/${file}.` }); }
  }
  return out;
}

const ms = (iso: unknown) => Date.parse(String(iso));
const isDeltaFree = (r: Receipt) => r.delta.trim().toLowerCase() === 'none';

function checkEvidence(root: string, receipt: Receipt, findings: Finding[]): ReceiptRow {
  const row: ReceiptRow = { id: receipt.id, authorizationId: receipt.authorizationId, kind: 'asserted', hashOk: true, delta: receipt.delta };
  const base = fs.realpathSync(root);

  for (const ref of receipt.evidence) {
    const m = /^sha256:([0-9a-f]{64}):(.+)$/.exec(ref);
    if (!m) { row.hashOk = false; findings.push({ severity: 'FAIL', check: 'evidence', message: `Receipt ${receipt.id}: evidence "${ref}" is not a hash-bound reference.` }); continue; }
    const file = path.resolve(base, m[2]);
    if (!file.startsWith(base + path.sep) || !fs.existsSync(file)) {
      row.hashOk = false;
      findings.push({ severity: 'FAIL', check: 'evidence', message: `Receipt ${receipt.id}: evidence file ${m[2]} is missing or outside the project.` });
    } else if (sha256(fs.readFileSync(file)) !== m[1]) {
      row.hashOk = false;
      findings.push({ severity: 'FAIL', check: 'evidence', message: `Receipt ${receipt.id}: evidence file ${m[2]} no longer matches its recorded hash. It was altered after the receipt.` });
    }
  }

  // Evidence the CLI produced lives at .uig/evidence/<receiptId>.log and starts with the command it ran.
  const logRef = receipt.evidence.map(ref => /^sha256:[0-9a-f]{64}:(.+)$/.exec(ref)?.[1]).find(p => p === `.uig/evidence/${receipt.id}.log`);
  const logFile = logRef ? path.join(base, logRef) : undefined;
  if (logFile && fs.existsSync(logFile)) {
    const log = fs.readFileSync(logFile, 'utf8');
    row.kind = 'cli-run';
    row.command = /^command: (.*)$/m.exec(log)?.[1]?.trim();
    row.exit = /^exit: (.*)$/m.exec(log)?.[1]?.trim();
    if (row.command && VACUOUS.some(v => v.test(row.command!))) {
      findings.push({ severity: 'FAIL', check: 'evidence', message: `Receipt ${receipt.id}: the verification command "${row.command}" cannot fail, so it verifies nothing.` });
    }
    // The receipt's claim must agree with what the log says happened.
    if (row.exit !== undefined && (row.exit === '0') !== isDeltaFree(receipt)) {
      findings.push({ severity: 'FAIL', check: 'evidence', message: `Receipt ${receipt.id}: the log says exit ${row.exit} but the receipt records delta "${receipt.delta}".` });
    }
  } else {
    findings.push({ severity: 'WARN', check: 'evidence', message: `Receipt ${receipt.id}: the outcome is asserted by the agent, not produced by the CLI; only its evidence files are hashed.` });
  }
  return row;
}

export function audit(root: string, base: string, intentFilter?: string): AuditReport {
  const findings: Finding[] = [];
  const intents = readRecords<Intent>(root, 'intents', findings).filter(i => !intentFilter || i.id === intentFilter);
  if (intentFilter && !intents.length) throw new AuditError(`Intent ${intentFilter} not found in .uig/intents.`);
  const inScope = new Set(intents.map(i => i.id));
  const proposals = readRecords<Proposal>(root, 'proposals', findings).filter(p => inScope.has(p.intentId));
  const authorizations = readRecords<Authorization>(root, 'authorizations', findings).filter(a => inScope.has(a.intentId));
  const receipts = readRecords<Receipt>(root, 'receipts', findings).filter(r => inScope.has(r.intentId));
  const proposalById = new Map(proposals.map(p => [p.id, p]));
  const authById = new Map(authorizations.map(a => [a.id, a]));
  const changed = changedFiles(root, base);

  // Receipts first: they say which authorizations were ever verified.
  const receiptRows = receipts.map(r => {
    if (!authById.has(r.authorizationId)) findings.push({ severity: 'FAIL', check: 'records', message: `Receipt ${r.id} cites authorization ${r.authorizationId}, which is not on record.` });
    return checkEvidence(root, r, findings);
  });
  const verifiedAuth = (id: string) => receipts.some(r => r.authorizationId === id && isDeltaFree(r));

  // Coverage and gate: every change must sit under an authorization that was verified, and a change
  // that needs a principal must sit under a gated one.
  const files: FileRow[] = changed.map(f => {
    const covering = authorizations.filter(a => (a.state === 'delegated' || a.state === 'gated') && covers(a.resource, f.path));
    const gateClass = gateClassOf(f.path);
    const row: FileRow = {
      path: f.path, status: f.status, gateClass,
      authorizations: covering.map(a => a.id),
      gated: covering.some(a => a.state === 'gated'),
      verified: covering.some(a => verifiedAuth(a.id)),
    };
    if (!covering.length) {
      findings.push({ severity: 'FAIL', check: 'coverage', message: `${f.path} changed with no authorization covering it.` });
      return row;
    }
    if (!covering.some(a => receipts.some(r => r.authorizationId === a.id))) {
      findings.push({ severity: 'FAIL', check: 'coverage', message: `${f.path} changed under ${covering.map(a => a.id).join(', ')}, which has no receipt.` });
    } else if (!row.verified) {
      findings.push({ severity: 'FAIL', check: 'coverage', message: `${f.path} changed but every receipt covering it ended in a delta; it was never verified.` });
    }
    if (gateClass && !row.gated) {
      findings.push({ severity: 'FAIL', check: 'gate', message: `${f.path} (${gateClass}) changed under delegated authority only. A change of this kind should have needed the principal.` });
    }
    const wide = covering.find(a => ['.', '', '/'].includes(norm(a.resource)));
    if (wide) findings.push({ severity: 'WARN', check: 'coverage', message: `${f.path} is covered only by ${wide.id}, whose resource is the whole project. A resource that wide bounds nothing.` });

    // Ordering, from file times. Heuristic: a checkout or copy resets mtime.
    if (f.status !== 'D') {
      const mtime = fs.statSync(path.join(root, f.path)).mtimeMs;
      const first = Math.min(...covering.map(a => ms(a.authorizedAt)));
      const last = Math.max(-Infinity, ...receipts.filter(r => covering.some(a => a.id === r.authorizationId)).map(r => ms(r.verifiedAt)));
      if (mtime < first - CLOCK_TOLERANCE_MS) findings.push({ severity: 'WARN', check: 'ordering', message: `${f.path} was last written before any authorization covering it.` });
      if (Number.isFinite(last) && mtime > last + CLOCK_TOLERANCE_MS) findings.push({ severity: 'WARN', check: 'ordering', message: `${f.path} was modified after its last receipt, so its verification may be stale.` });
    }
    return row;
  });

  // Gated authorizations. The records cannot prove the principal said yes: the CLI signs a gated
  // authorization the same way whether the user or the agent passed --approved-by.
  const gated = authorizations.filter(a => a.state === 'gated').map(a => {
    const proposal = proposalById.get(a.proposalId);
    const approvedAfterSec = proposal ? Math.round((ms(a.authorizedAt) - ms(proposal.proposedAt)) / 1000) : NaN;
    findings.push({ severity: 'INFO', check: 'gate', message: `Gated authorization ${a.id} for ${a.resource}: principal consent cannot be proven from records. Confirm a user message approved it before it was issued.` });
    if (Number.isFinite(approvedAfterSec) && approvedAfterSec < HUMAN_APPROVAL_MIN_SEC) {
      findings.push({ severity: 'WARN', check: 'gate', message: `Gated authorization ${a.id} was issued ${approvedAfterSec}s after its proposal: too fast to be a human decision unless approval was given in advance.` });
    }
    return { authorizationId: a.id, resource: a.resource, approvedAfterSec };
  });

  const authorizedProposals = new Set(authorizations.map(a => a.proposalId));
  const attempts = proposals.filter(p => !authorizedProposals.has(p.id)).map(p => ({ proposalId: p.id, action: p.action }));
  for (const a of attempts) findings.push({ severity: 'INFO', check: 'gate', message: `Proposal ${a.proposalId} ("${a.action}") was never authorized: denied, gated and unapproved, or abandoned.` });

  // Impact: declared by the agent versus observed in the files under its resource. Logged, not enforced.
  const impact: ImpactRow[] = proposals.filter(p => authorizedProposals.has(p.id)).map(p => {
    const under = changed.filter(f => covers(p.resource, f.path));
    const observed: Impact | 'none' = !under.length ? 'none'
      : under.some(f => gateClassOf(f.path)) ? 'high'
      : under.length > MEDIUM_FILE_COUNT || under.some(f => f.status === 'D') ? 'medium' : 'low';
    if (RANK[observed] > RANK[p.impact]) {
      findings.push({ severity: 'INFO', check: 'impact', message: `Proposal ${p.id} declared ${p.impact} impact; the files under ${p.resource} look ${observed}.` });
    }
    return { proposalId: p.id, declared: p.impact, observed, files: under.length };
  });

  return { root, base, intents: intents.map(i => i.id), files, receipts: receiptRows, gated, attempts, impact, findings };
}

export function failed(report: AuditReport): boolean {
  return report.findings.some(f => f.severity === 'FAIL');
}

export function formatReport(r: AuditReport): string {
  const lines: string[] = [];
  const count = (s: Severity) => r.findings.filter(f => f.severity === s).length;
  const covered = r.files.filter(f => f.verified).length;
  const cli = r.receipts.filter(x => x.kind === 'cli-run' && x.hashOk).length;

  lines.push(`UI-GATES audit  base ${r.base}  intents ${r.intents.length ? r.intents.join(', ') : 'none'}`);
  lines.push('');
  lines.push(`Coverage   ${covered}/${r.files.length} changed file(s) verified under an authorization`);
  lines.push(`Gate       ${r.gated.length} gated authorization(s); ${r.attempts.length} proposal(s) never authorized`);
  lines.push(`Evidence   ${cli}/${r.receipts.length} receipt(s) CLI-produced with intact hashes; ${r.receipts.filter(x => x.kind === 'asserted').length} asserted`);
  lines.push('');
  for (const sev of ['FAIL', 'WARN', 'INFO'] as Severity[]) {
    for (const f of r.findings.filter(x => x.severity === sev)) lines.push(`${sev}  [${f.check}] ${f.message}`);
  }
  if (r.impact.length) {
    lines.push('', 'Impact (declared vs observed, not enforced)');
    for (const i of r.impact) lines.push(`  ${i.proposalId}  declared ${i.declared}  observed ${i.observed}  (${i.files} file${i.files === 1 ? '' : 's'})`);
  }
  const verdict = count('FAIL') ? 'AUDIT FAILED'
    : !r.intents.length && !r.files.length ? 'Nothing to audit: no intents recorded and no changes.'
    : 'Consistent with the records; not proof of good behaviour (see docs/mvp.md).';
  lines.push('', `${count('FAIL')} fail, ${count('WARN')} warn, ${count('INFO')} info. ${verdict}`);
  return lines.join('\n');
}

export { AuditError };
