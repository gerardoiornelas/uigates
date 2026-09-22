import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import type { Authorization, Intent, Proposal, Receipt } from '../core/types/primitives';
import { gateClassOf } from '../core/GateClass';
import { hasBothStateDirs, ROOT_STATE_PATH, STATE_DIRS, stateDir, stateDirName } from '../core/names';

/**
 * `uigates audit` scores a finished session from the outside: it compares what changed in the working
 * tree with what the state directory (`.uigates/`, or `.uig/` in an older project) says was authorized and verified. It is deterministic, uses no model, and
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
// `git diff`/`git diff --stat`/`git show` without `--exit-code` always exits 0, whether or not there are
// changes: it proves a diff exists, never that the change is correct. Seen in real use: a receipt
// citing it as evidence is functionally the same as `echo` (WUN pressure test, 2026-09-22).
const VACUOUS = [
  /^(true|:|exit 0)$/, /^echo\b/, /^sleep\b/, /process\.exit\(0\)/, /^python3? -c ['"]pass['"]$/,
  /^git\s+(diff|show|log)\b(?!.*--exit-code)/,
];

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

/** Everything that differs from `base`: staged, unstaged, committed since, and untracked. The state directory is the record, not a change. */
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
  return [...out.values()].filter(f => !ROOT_STATE_PATH.test(f.path)).sort((a, b) => a.path.localeCompare(b.path));
}

export function readRecords<T>(root: string, dir: string, findings: Finding[]): T[] {
  const full = path.join(stateDir(root), dir);
  if (!fs.existsSync(full)) return [];
  const out: T[] = [];
  for (const file of fs.readdirSync(full).filter(f => f.endsWith('.json')).sort()) {
    try { out.push(JSON.parse(fs.readFileSync(path.join(full, file), 'utf8')) as T); }
    catch { findings.push({ severity: 'FAIL', check: 'records', message: `Unreadable record ${stateDirName(root)}/${dir}/${file}.` }); }
  }
  return out;
}

const ms = (iso: unknown) => Date.parse(String(iso));
const isDeltaFree = (r: Receipt) => r.delta.trim().toLowerCase() === 'none';

/** A script a verification command runs. `receipt --run` hashes the command's output, never the script. */
export interface ScriptRef { path: string; cwd: string }

const INTERPRETERS = new Set(['bash', 'sh', 'zsh', 'python', 'python3', 'node', 'tsx', 'ts-node', 'ruby', 'perl', 'php', 'deno', 'bun']);
// With one of these the code is in the command itself, so the record already holds it.
const INLINE_FLAGS = new Set(['-c', '-e', '-m', '-p', '--eval', '--print']);
const SYSTEM_PATH = /^\/(usr|bin|sbin|opt|dev|etc|System|Library|nix)\//;

/** Split a shell command into simple commands. Enough shell to find what runs, not a shell parser. */
function segments(command: string): string[][] {
  // A heredoc body is code, not commands: read up to the line that opens it.
  const src = /<<-?\s*['"]?\w+/.test(command) ? command.split('\n')[0] : command;
  const out: string[][] = [[]];
  let cur = '', has = false, quote: string | null = null;
  const word = () => { if (has) out[out.length - 1].push(cur); cur = ''; has = false; };
  const sep = () => { word(); if (out[out.length - 1].length) out.push([]); };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) { if (c === quote) quote = null; else cur += c; continue; }
    if (c === "'" || c === '"') { quote = c; has = true; continue; }
    if (c === '\n') { sep(); continue; }
    if (/\s/.test(c)) { word(); continue; }
    if ((c === '&' && src[i + 1] === '&') || (c === '|' && src[i + 1] === '|')) { sep(); i++; continue; }
    if (c === ';' || c === '|' || c === '(' || c === ')') { sep(); continue; }
    cur += c; has = true;
  }
  word();
  return out.filter(words => words.length);
}

/** The script files a verification command runs, with the directory each runs from. Inline code (`node -e`) is not listed: it is already in the command. */
export function referencedScripts(command: string): ScriptRef[] {
  const refs: ScriptRef[] = [];
  let cwd = '.';
  for (const words of segments(command)) {
    const w = words.filter(word => !/^\d*[<>]/.test(word)); // redirections and heredoc markers are not arguments
    while (w.length && (/^\w+=/.test(w[0]) || ['env', 'npx', 'exec'].includes(w[0]))) w.shift();
    if (!w.length) continue;
    if (w[0] === 'cd') {
      if (w[1]) cwd = w[1].startsWith('/') || w[1].startsWith('~') ? w[1] : path.posix.normalize(path.posix.join(cwd, w[1]));
      continue;
    }
    const head = w[0];
    if (INTERPRETERS.has(path.posix.basename(head))) {
      const args = w.slice(1);
      if (args.some(a => INLINE_FLAGS.has(a))) continue;
      const script = args.find(a => !a.startsWith('-'));
      if (script && !/[*?${}]/.test(script)) refs.push({ path: script, cwd });
    } else if (head.includes('/') && !/[*?${}]/.test(head)) {
      refs.push({ path: head, cwd });
    }
  }
  return refs;
}

/** Where the logic behind a script's output can be found: nowhere outside the project, or nowhere at all. */
function whereIsScript(root: string, base: string, ref: ScriptRef): 'outside' | 'missing' | null {
  if (ref.path.startsWith('~')) return 'outside';
  const real = fs.realpathSync(root);
  let resolved = path.posix.isAbsolute(ref.path) ? path.posix.normalize(ref.path) : path.posix.normalize(path.posix.join(ref.cwd, ref.path));
  if (ref.cwd.startsWith('~')) return 'outside';
  if (path.posix.isAbsolute(resolved)) {
    if (SYSTEM_PATH.test(resolved)) return null;
    const rel = path.relative(real, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return 'outside';
    resolved = rel.split(path.sep).join('/');
  }
  if (resolved === '..' || resolved.startsWith('../')) return 'outside';
  if (fs.existsSync(path.join(root, resolved))) return null;
  const inBase = spawnSync('git', ['cat-file', '-e', `${base}:${resolved}`], { cwd: root });
  return inBase.status === 0 ? null : 'missing';
}

function checkEvidence(root: string, baseRef: string, receipt: Receipt, findings: Finding[]): ReceiptRow {
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

  // Evidence the CLI produced lives at <state directory>/evidence/<receiptId>.log and starts with the command it ran.
  // Either directory name counts: the reference is hash-bound, and a project's records may predate the rename.
  const logRef = receipt.evidence.map(ref => /^sha256:[0-9a-f]{64}:(.+)$/.exec(ref)?.[1]).find(p => STATE_DIRS.some(d => p === `${d}/evidence/${receipt.id}.log`));
  const logFile = logRef ? path.join(base, logRef) : undefined;
  if (logFile && fs.existsSync(logFile)) {
    const log = fs.readFileSync(logFile, 'utf8');
    row.kind = 'cli-run';
    row.command = /^command: (.*)$/m.exec(log)?.[1]?.trim();
    row.exit = /^exit: (.*)$/m.exec(log)?.[1]?.trim();
    if (row.command && VACUOUS.some(v => v.test(row.command!))) {
      findings.push({ severity: 'FAIL', check: 'evidence', message: `Receipt ${receipt.id}: the verification command "${row.command}" cannot fail, so it verifies nothing.` });
    }
    // The command's output is hashed; the script it runs is not. Where that script lives decides whether anyone can re-run the check.
    for (const ref of row.command ? referencedScripts(row.command) : []) {
      const where = whereIsScript(root, baseRef, ref);
      if (where === 'outside') {
        findings.push({ severity: 'WARN', check: 'evidence', message: `Receipt ${receipt.id}: its verification runs ${ref.path}, which is outside the project, so the logic behind this evidence is not in the record. Only its output is hashed.` });
      } else if (where === 'missing') {
        findings.push({ severity: 'WARN', check: 'evidence', message: `Receipt ${receipt.id}: its verification runs ${ref.path}, which is no longer in the working tree or the base commit, so the check behind this evidence cannot be re-run.` });
      }
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
  if (hasBothStateDirs(root)) {
    findings.push({ severity: 'WARN', check: 'records', message: `Both .uigates/ and .uig/ exist. Records are read from ${stateDirName(root)}/ and the other directory is ignored, so anything recorded there is not scored.` });
  }
  const intents = readRecords<Intent>(root, 'intents', findings).filter(i => !intentFilter || i.id === intentFilter);
  if (intentFilter && !intents.length) throw new AuditError(`Intent ${intentFilter} not found in ${stateDirName(root)}/intents.`);
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
    return checkEvidence(root, base, r, findings);
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
  //
  // authorize --jev (docs/compound-engineering/graph-jev-aar.md) is a different case: `authorizedBy`
  // is "jev:<backend>", a machine identity, not a claimed human one — asking "did a person consent?"
  // is the wrong question for it. What's still a real gap: the decision itself (verdict, confidence,
  // the six signals) is only ever printed to stdout, never persisted as hashed evidence the way a
  // receipt's evidence is, so this finding cannot yet verify the recorded judgment was real. That's
  // open question 4 in the doc, not solved here — the audit says so honestly instead of pretending.
  const gated = authorizations.filter(a => a.state === 'gated').map(a => {
    const proposal = proposalById.get(a.proposalId);
    const approvedAfterSec = proposal ? Math.round((ms(a.authorizedAt) - ms(proposal.proposedAt)) / 1000) : NaN;
    if (a.authorizedBy.startsWith('jev:')) {
      findings.push({ severity: 'INFO', check: 'gate', message: `Gated authorization ${a.id} for ${a.resource} was approved by ${a.authorizedBy} — a machine judgment, not the principal. Its decision (verdict, confidence, signals) is not yet persisted as hashed evidence, so this cannot verify the judgment was real, only that this is the path it claims to have taken.` });
    } else {
      findings.push({ severity: 'INFO', check: 'gate', message: `Gated authorization ${a.id} for ${a.resource}: principal consent cannot be proven from records. Confirm a user message approved it before it was issued.` });
      if (Number.isFinite(approvedAfterSec) && approvedAfterSec < HUMAN_APPROVAL_MIN_SEC) {
        findings.push({ severity: 'WARN', check: 'gate', message: `Gated authorization ${a.id} was issued ${approvedAfterSec}s after its proposal: too fast to be a human decision unless approval was given in advance.` });
      }
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
