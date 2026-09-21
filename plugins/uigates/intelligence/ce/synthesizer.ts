import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { AuthorityLedger } from '../../core/AuthorityLedger';
import { ReceiptStore } from '../../core/ReceiptStore';
import { Receipt } from '../../core/types/primitives';
import { stateDir } from '../../core/names';

const MAX_FIELD = 500;
const POSITIVE_OUTCOME = /\bsucc(?:ess(?:ful(?:ly)?)?|eed(?:s|ed)?)\b/i;
// Deliberately conservative: a false negative loses a lesson, a false positive teaches a wrong one.
const NEGATIVE_OUTCOME = /\b(?:unsuccess\w*|not|no|never|fail\w*|error\w*|unmet|cannot|can't|didn't)\b/i;

/**
 * Promotion ladder (docs/knowledge-model.md; the portfolio's ui-gates-canon.md).
 * Ephemeral observations are never written. A verified receipt earns Task.
 * Promotion beyond that is never automatic and never self-awarded: reuse across
 * distinct tasks only makes a lesson a *candidate*, and a principal promotes it to
 * Knowledge, then to Canon (which alters how authority is evaluated). Decision needs
 * a human's tradeoff analysis, so receipts alone never produce it.
 */
export type Level = 'task' | 'knowledge' | 'canon';
/** verified: latest evidence supports it. conflicted: a newer receipt contradicts it. retired: a principal withdrew it. */
export type PackStatus = 'verified' | 'conflicted' | 'retired';

/** Verified in this many distinct intents = a candidate for Knowledge. Never promoted by count alone. */
export const CANDIDATE_INTENTS = 2;

interface PackState {
  latestAt: number;
  action: string;
  expected: string;
  evidence: string;
  intent: string; // where it was first verified
  actor: string;
  intents: string[]; // every distinct intent that verified it
  principals: string[]; // principals of those intents (needs an authority ledger)
  verified: string[]; // receipt ids that proved the action
  contradicted: string[]; // receipt ids where the action later failed
  failureModes: string[]; // what went wrong, most recent last
  lessons: string[]; // what agents said the next agent should know, most recent last; the agent's claim, not verified
  latest: 'verified' | 'contradicted'; // most recent evidence decides the status
  knowledgeApprovedBy: string;
  canonApprovedBy: string;
  retiredBy: string;
}

export interface KnowledgePack {
  file: string;
  action: string;
  status: PackStatus;
  level: Level;
  expected: string;
  evidence: string;
  intents: string[];
  failureModes: string[];
  /** What the agents who did the work said the next agent should know. Their claim; the receipt does not verify it. */
  lessons: string[];
  /** Verified across enough distinct intents to be proposed for Knowledge, but not yet approved. */
  candidate: boolean;
  /** Something is waiting on a principal: a candidate to approve, or a conflicted Knowledge/Canon. */
  needsPrincipal: boolean;
}

/** Pack content is read back into agent context, so user text must stay on one line and never open a heading. */
function flat(text: string, max = MAX_FIELD): string {
  return text.replace(/\s+/g, ' ').replace(/^[#>*\-\s]+/, '').slice(0, max);
}

function safeId(id: string): string {
  return id.replace(/[^\w.:-]/g, '_');
}

function levelOf(s: PackState): Level {
  if (s.canonApprovedBy) return 'canon';
  if (s.knowledgeApprovedBy) return 'knowledge';
  return 'task';
}

function isCandidate(s: PackState): boolean {
  return levelOf(s) === 'task' && s.intents.length >= CANDIDATE_INTENTS;
}

function statusOf(s: PackState): PackStatus {
  if (s.retiredBy) return 'retired';
  return s.latest === 'verified' ? 'verified' : 'conflicted';
}

/** Markdown is a projection, not an approval record. A modified projection is withheld. */
function trustedState(projectRoot: string, file: string): PackState | undefined {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(stateDir(projectRoot), 'knowledge', 'pack_state', file + '.json'), 'utf8'));
    const markdown = path.join(stateDir(projectRoot), 'knowledge', 'compound_packs', file);
    if (state.markdownSha256 && (!fs.existsSync(markdown) || crypto.createHash('sha256').update(Uint8Array.from(fs.readFileSync(markdown))).digest('hex') !== state.markdownSha256)) return undefined;
    return state.state;
  } catch { return undefined; }
}

export interface SynthesisOptions {
  /** An independently controlled verifier can supply evidence validation. Fixture tests must opt in explicitly. */
  evidenceVerifier?: (receipt: Receipt) => boolean;
  /**
   * Promote a verified receipt only if it carries a stated lesson. Off by default, so existing callers
   * are unchanged; the `uigates` CLI turns it on. Without it every verified action becomes a lesson named
   * after the action, and a ledger fills with "delete the temporary harness".
   */
  requireLesson?: boolean;
}

const MIN_LESSON = 20;

const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Why a lesson would not teach anything, or null if it is acceptable. The check is deterministic and
 * deliberately shallow: it catches the lessons that only restate the action or the verification plan,
 * placeholders and text too short to carry advice. It cannot tell good advice from confident nonsense.
 */
export function lessonProblem(lesson: string, action: string, verificationPlan: string): string | null {
  const text = normalize(lesson);
  if (text.length < MIN_LESSON) return `a lesson needs at least ${MIN_LESSON} characters of advice for the next agent`;
  if (/^(todo|tbd|none|n a|na|nothing|see above|as above)\b/.test(text)) return 'a placeholder is not a lesson';
  if (lesson.replace(/\s+/g, ' ').trim().length > MAX_FIELD) return `a lesson is at most ${MAX_FIELD} characters; say the one thing that matters`;
  for (const [what, source] of [['the action', action], ['the verification plan', verificationPlan]] as const) {
    const s = normalize(source);
    if (s && (text === s || s.includes(text))) return `that only restates ${what}; say what the next agent should know that the title does not`;
  }
  return null;
}

/** Default evidence references bind existing project-local bytes: sha256:<hex>:<relative path>. */
export function verifyEvidenceFiles(root: string, receipt: Receipt): boolean {
  if (!receipt.evidence.length) return false;
  return receipt.evidence.every(ref => {
    const match = /^sha256:([a-f0-9]{64}):(.+)$/.exec(ref);
    if (!match) return false;
    try {
      const base = fs.realpathSync(root), file = fs.realpathSync(path.resolve(base, match[2]));
      return file.startsWith(base + path.sep) && crypto.createHash('sha256').update(Uint8Array.from(fs.readFileSync(file))).digest('hex') === match[1];
    } catch { return false; }
  });
}

/**
 * Retrieval. Returns each pack with its level, status, evidence and known failures
 * so a consumer can weigh a recommendation instead of trusting it blindly.
 * Only `status === 'verified'` packs are recommendations.
 */
export function loadKnowledge(projectRoot: string): KnowledgePack[] {
  const dir = path.join(stateDir(projectRoot), 'knowledge', 'compound_packs');
  if (!fs.existsSync(dir)) return [];
  const out: KnowledgePack[] = [];
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort()) {
    const s = trustedState(projectRoot, file);
    if (!s) continue;
    const level = levelOf(s), status = statusOf(s), candidate = isCandidate(s);
    out.push({
      file, action: s.action, status, level, expected: s.expected, evidence: s.evidence,
      intents: s.intents, failureModes: s.failureModes, lessons: s.lessons ?? [], candidate,
      needsPrincipal: (status === 'verified' && candidate) || (status === 'conflicted' && level !== 'task'),
    });
  }
  return out;
}

export class CESynthesizer {
  private store: ReceiptStore;
  private knowledgeDir: string;
  private projectRoot: string;
  private authority: AuthorityLedger | 'unverified';
  private rejected = new Map<string, string>();
  private unpromoted = new Map<string, string>();
  private requireLesson: boolean;
  private evidenceVerifier: (receipt: Receipt) => boolean;

  /**
   * `authority` is required. Knowledge is only as trustworthy as the authority
   * behind the receipts it came from, so a synthesizer has to be handed the ledger
   * that issued them. `'unverified'` is an explicit opt-out for demos and unit tests.
   */
  constructor(store: ReceiptStore, projectRoot: string = process.cwd(), authority?: AuthorityLedger | 'unverified', options: SynthesisOptions = {}) {
    if (!authority) {
      throw new Error('CESynthesizer needs an AuthorityLedger (or the explicit "unverified" opt-out): receipts must be traceable to issued authority.');
    }
    this.store = store;
    this.authority = authority;
    this.projectRoot = projectRoot;
    this.evidenceVerifier = options.evidenceVerifier ?? (r => verifyEvidenceFiles(projectRoot, r));
    this.requireLesson = options.requireLesson ?? false;
    this.knowledgeDir = path.join(stateDir(projectRoot), 'knowledge', 'compound_packs');
    this.ensureDir();
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.knowledgeDir)) {
      fs.mkdirSync(this.knowledgeDir, { recursive: true });
    }
  }

  /** Verified receipts that were not promoted because they stated no lesson. Only when `requireLesson` is on. */
  getUnpromoted(): { receiptId: string; action: string }[] {
    return [...this.unpromoted].map(([receiptId, action]) => ({ receiptId, action }));
  }

  /** Receipts that were refused, with the reason. */
  getRejections(): { receiptId: string; reason: string }[] {
    return [...this.rejected].map(([receiptId, reason]) => ({ receiptId, reason }));
  }

  /**
   * Scans receipts and synthesizes knowledge packs for successful approaches.
   * Only receipts backed by issued authority are considered, failures included:
   * otherwise a forged failure could push good knowledge into conflict.
   *
   * A verified success promotes a pack. A later failure marks it conflicted, which
   * withholds the recommendation without deleting the evidence; a newer verified
   * success resolves the conflict, and only a principal can retire a pack.
   * Recency, not a vote: a stale pack with many old successes must not outlive one fresh failure.
   */
  async synthesize(intentId: string): Promise<void> {
    const receipts = this.store.getByIntent(intentId);
    console.log(`[CE] Synthesizing knowledge from ${receipts.length} receipts...`);

    for (const receipt of receipts) {
      try {
        const verdict = this.authenticate(receipt);
        if (!verdict.ok) {
          if (!this.rejected.has(receipt.id)) console.warn(`[CE] Rejected receipt ${receipt.id}: ${verdict.reason}`);
          this.rejected.set(receipt.id, verdict.reason);
          continue;
        }
        if (this.isVerifiedSuccess(receipt)) {
          if (this.requireLesson && !receipt.lesson?.trim()) this.unpromoted.set(receipt.id, receipt.actionPerformed);
          else this.recordSupport(receipt, 'verified');
        } else if (this.isContradiction(receipt)) {
          this.recordSupport(receipt, 'contradicted');
        }
      } catch (e) {
        console.warn(`[CE] Skipping receipt ${receipt.id}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  private authenticate(r: Receipt): { ok: boolean; reason: string } {
    if (this.authority === 'unverified') return { ok: true, reason: 'unverified mode' };
    if (!this.store.verifyIntegrity(r.id)) return { ok: false, reason: 'receipt no longer matches what was recorded' };
    return this.authority.admitReceipt(r);
  }

  private claimsSuccess(r: Receipt): boolean {
    return POSITIVE_OUTCOME.test(r.actualOutcome) && !NEGATIVE_OUTCOME.test(r.actualOutcome);
  }

  private hasNoDelta(r: Receipt): boolean {
    return r.delta.trim().toLowerCase() === 'none';
  }

  /** A claimed success only counts when it carries evidence (the "mirage" guard). */
  private isVerifiedSuccess(r: Receipt): boolean {
    return Number.isFinite(new Date(r.verifiedAt).getTime()) && this.claimsSuccess(r) && this.hasNoDelta(r)
      && r.evidence.some(e => e.trim().length > 0) && (this.authority === 'unverified' || this.evidenceVerifier(r));
  }

  /** A claimed success without evidence is unverified, not contradictory. */
  private isContradiction(r: Receipt): boolean {
    return Number.isFinite(new Date(r.verifiedAt).getTime()) && (!this.hasNoDelta(r)
      || (!/\b(pending|unknown|inconclusive)\b/i.test(r.actualOutcome) && NEGATIVE_OUTCOME.test(r.actualOutcome)));
  }

  private packPath(action: string): string {
    const key = action.trim().replace(/\s+/g, ' ').toLowerCase();
    const slug = key.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'action';
    const hash = crypto.createHash('sha256').update(key).digest('hex').slice(0, 8);
    const filePath = path.join(this.knowledgeDir, `lesson_${slug}_${hash}.md`);
    if (path.dirname(path.resolve(filePath)) !== path.resolve(this.knowledgeDir)) {
      throw new Error(`pack path escapes knowledge dir: ${filePath}`);
    }
    return filePath;
  }

  private read(filePath: string): PackState | undefined {
    return trustedState(this.projectRoot, path.basename(filePath));
  }

  private write(filePath: string, state: PackState): void {
    const markdown = this.render(state);
    const packStateDir = path.join(stateDir(this.projectRoot), 'knowledge', 'pack_state');
    fs.mkdirSync(packStateDir, { recursive: true });
    // Preserve failures before the first success without publishing a recommendation.
    if (state.verified.length) fs.writeFileSync(filePath, markdown);
    fs.writeFileSync(path.join(packStateDir, path.basename(filePath) + '.json'), JSON.stringify({
      state, markdownSha256: state.verified.length ? crypto.createHash('sha256').update(markdown).digest('hex') : null,
    }));
  }

  private recordSupport(receipt: Receipt, kind: 'verified' | 'contradicted'): void {
    const filePath = this.packPath(receipt.actionPerformed);
    const existing = this.read(filePath);

    const state: PackState = existing ?? {
      latestAt: 0,
      action: flat(receipt.actionPerformed),
      expected: flat(receipt.expectedOutcome),
      evidence: flat(receipt.evidence.filter(e => e.trim()).join(', ')),
      intent: flat(receipt.intentId),
      actor: flat(receipt.actorId),
      intents: [], principals: [], verified: [], contradicted: [], failureModes: [], lessons: [],
      latest: kind, knowledgeApprovedBy: '', canonApprovedBy: '', retiredBy: '',
    };

    state.lessons ??= []; // a pack written before lessons existed
    // Replaying a receipt already counted must not change the pack (idempotence).
    const id = safeId(receipt.id);
    if (state.verified.includes(id) || state.contradicted.includes(id)) return;
    state[kind].push(id);
    const at = new Date(receipt.verifiedAt).getTime();
    if (at >= state.latestAt) { state.latest = kind; state.latestAt = at; }

    if (kind === 'verified') {
      const evidence = flat(receipt.evidence.filter(e => e.trim()).join(', '));
      if (evidence && !state.evidence.includes(evidence)) state.evidence = `${state.evidence}; ${evidence}`.slice(-4000);
      const lesson = receipt.lesson ? flat(receipt.lesson) : '';
      if (lesson && !state.lessons.includes(lesson)) state.lessons = [...state.lessons, lesson].slice(-3);
      const intent = flat(receipt.intentId);
      if (!state.intents.includes(intent)) state.intents.push(intent);
      const principal = this.authority === 'unverified' ? undefined : this.authority.lookup(receipt.authorizationId)?.intent.principalId;
      if (principal && !state.principals.includes(principal)) state.principals.push(safeId(principal));
    } else {
      state.failureModes.push(flat(receipt.delta, 120));
      state.failureModes = state.failureModes.slice(-3);
    }

    this.write(filePath, state);
    console.log(`[CE] ${kind === 'verified' ? 'Promoted' : 'Contradicted'} lesson (${levelOf(state)}/${statusOf(state)}): ${path.basename(filePath)}`);
  }

  /** What is waiting on a principal right now. The engine cannot ask; it can make the question explicit. */
  getEscalations(): { action: string; level: Level; kind: 'candidate' | 'conflict' }[] {
    return loadKnowledge(this.projectRoot)
      .filter(p => p.needsPrincipal)
      .map(p => ({ action: p.action, level: p.level, kind: p.status === 'conflicted' ? 'conflict' as const : 'candidate' as const }));
  }

  /**
   * Knowledge by principal approval. Reuse across distinct tasks only makes a candidate;
   * promotion is never automatic and never self-awarded. Only a principal of an intent
   * that verified the pack may approve it.
   */
  approveKnowledge(action: string, principalId: string): void {
    const { filePath, state } = this.forPrincipal(action, principalId);
    if (statusOf(state) !== 'verified') throw new Error(`Cannot promote a ${statusOf(state)} lesson to Knowledge.`);
    if (levelOf(state) !== 'task') throw new Error(`Already ${levelOf(state)}.`);
    if (!isCandidate(state)) throw new Error('Knowledge needs reuse across more than one task: this lesson is verified in a single intent.');
    state.knowledgeApprovedBy = safeId(principalId);
    this.write(filePath, state);
  }

  /** Canon by principal approval, through the gate, and only from Knowledge. Never by volume of reuse. */
  approveCanon(action: string, principalId: string): void {
    const { filePath, state } = this.forPrincipal(action, principalId);
    if (statusOf(state) !== 'verified') throw new Error(`Cannot make a ${statusOf(state)} pack canon.`);
    if (levelOf(state) !== 'knowledge') throw new Error('Canon must first be Knowledge: it is earned rung by rung, never skipped.');
    state.canonApprovedBy = safeId(principalId);
    this.write(filePath, state);
  }

  /** Withdraw a pack. Final: later successes do not revive a retired pack. */
  retire(action: string, principalId: string): void {
    const { filePath, state } = this.forPrincipal(action, principalId);
    state.retiredBy = safeId(principalId);
    this.write(filePath, state);
  }

  private forPrincipal(action: string, principalId: string): { filePath: string; state: PackState } {
    if (this.authority === 'unverified') throw new Error('Principal decisions need an authority ledger to identify principals.');
    const filePath = this.packPath(action);
    const state = this.read(filePath);
    if (!state) throw new Error(`No knowledge pack for "${action}".`);
    if (!state.principals.includes(safeId(principalId))) {
      throw new Error(`${principalId} is not a principal of any intent that verified "${action}".`);
    }
    return { filePath, state };
  }

  private headline(s: PackState): string {
    const status = statusOf(s), level = levelOf(s), n = s.intents.length;
    if (status === 'retired') return `RETIRED by ${s.retiredBy}. Do not apply.`;
    if (status === 'conflicted') {
      return `CONFLICTED: a newer receipt contradicts this ${level}. Do not apply until re-verified${level === 'task' ? '' : ' or resolved by the principal'}.`;
    }
    if (level === 'canon') return `Canon: approved by ${s.canonApprovedBy} through the gate.`;
    if (level === 'knowledge') return `Knowledge: approved by ${s.knowledgeApprovedBy}; verified across ${n} distinct intents.`;
    if (isCandidate(s)) return `Candidate: verified across ${n} distinct intents. Not yet Knowledge: promotion is never automatic, and a principal must approve it.`;
    return 'Task-level lesson: verified in 1 intent. Reuse across tasks is not confirmed yet; try it, and verify.';
  }

  private render(s: PackState): string {
    const status = statusOf(s), level = levelOf(s);
    const failures = s.failureModes.length
      ? s.failureModes.map(f => `a later attempt failed with: ${f}`).join('; ')
      : 'no failure observed yet (absence of failure is not proof)';
    return `---
status: ${status}
level: ${level}
action: ${s.action}
expected: ${s.expected}
evidence: ${s.evidence}
intent: ${s.intent}
actor: ${s.actor}
intents: ${s.intents.join(',')}
principals: ${s.principals.join(',')}
verified: ${s.verified.join(',')}
contradicted: ${s.contradicted.join(',')}
failure_modes: ${s.failureModes.join(' | ')}
latest: ${s.latest}
latest_at: ${s.latestAt}
knowledge_approved_by: ${s.knowledgeApprovedBy}
canon_approved_by: ${s.canonApprovedBy}
retired_by: ${s.retiredBy}
---
# Knowledge Pack: ${s.action}
**${this.headline(s)}**

## Lesson
${(s.lessons ?? []).length
  ? `${(s.lessons ?? []).map(l => `- ${l}`).join('\n')}\n\n_Stated by the agent that did the work. The receipt proves the action succeeded; it does not prove this advice is right._`
  : '_None stated: this pack records that the action was verified, not what it teaches._'}

## Context
- Intent: ${s.intent}
- Actor: ${s.actor}

## Verified Action
${s.action}

## Expected Outcome
${s.expected}

## Evidence of Success
${s.evidence}

## Reuse guidance
- Confidence: ${level}${isCandidate(s) ? ' (candidate for Knowledge, awaiting a principal)' : ''}, verified in ${s.intents.length} distinct intent(s): ${s.intents.join(', ') || 'none'}.
- Apply when: the verification plan matches "${s.expected}".
- Do NOT apply when: ${failures}; or the context differs from the intents above, unless you re-verify.
- Limits: the evidence above was checked in those intents only.

## Provenance
- Verified by receipts: ${s.verified.join(', ') || 'none'}
- Contradicted by receipts: ${s.contradicted.join(', ') || 'none'}
`;
  }
}
