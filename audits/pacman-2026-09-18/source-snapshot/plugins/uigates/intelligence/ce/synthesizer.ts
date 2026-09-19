import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { AuthorityLedger } from '../../core/AuthorityLedger';
import { ReceiptStore } from '../../core/ReceiptStore';
import { Receipt } from '../../core/types/primitives';

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

/** Reads state from the frontmatter only; the body is derived and never trusted. */
function parsePack(text: string): PackState | undefined {
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1];
  if (!fm) return undefined; // legacy pack without provenance: rebuilt from the next receipt
  const get = (k: string) => new RegExp(`^${k}: ?(.*)$`, 'm').exec(fm)?.[1] ?? '';
  const list = (k: string, sep = ',') => get(k).split(sep).map(x => x.trim()).filter(Boolean);
  const intent = get('intent');
  return {
    action: get('action'),
    expected: get('expected'),
    evidence: get('evidence'),
    intent,
    actor: get('actor'),
    intents: list('intents').length ? list('intents') : intent ? [intent] : [],
    principals: list('principals'),
    verified: list('verified'),
    contradicted: list('contradicted'),
    failureModes: list('failure_modes', ' | '),
    latest: get('latest') === 'contradicted' ? 'contradicted' : 'verified',
    knowledgeApprovedBy: get('knowledge_approved_by'),
    canonApprovedBy: get('canon_approved_by'),
    retiredBy: get('retired_by'),
  };
}

/**
 * Retrieval. Returns each pack with its level, status, evidence and known failures
 * so a consumer can weigh a recommendation instead of trusting it blindly.
 * Only `status === 'verified'` packs are recommendations.
 */
export function loadKnowledge(projectRoot: string): KnowledgePack[] {
  const dir = path.join(projectRoot, '.uig', 'knowledge', 'compound_packs');
  if (!fs.existsSync(dir)) return [];
  const out: KnowledgePack[] = [];
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort()) {
    const s = parsePack(fs.readFileSync(path.join(dir, file), 'utf8'));
    if (!s) continue;
    const level = levelOf(s), status = statusOf(s), candidate = isCandidate(s);
    out.push({
      file, action: s.action, status, level, expected: s.expected, evidence: s.evidence,
      intents: s.intents, failureModes: s.failureModes, candidate,
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

  /**
   * `authority` is required. Knowledge is only as trustworthy as the authority
   * behind the receipts it came from, so a synthesizer has to be handed the ledger
   * that issued them. `'unverified'` is an explicit opt-out for demos and unit tests.
   */
  constructor(store: ReceiptStore, projectRoot: string = process.cwd(), authority?: AuthorityLedger | 'unverified') {
    if (!authority) {
      throw new Error('CESynthesizer needs an AuthorityLedger (or the explicit "unverified" opt-out): receipts must be traceable to issued authority.');
    }
    this.store = store;
    this.authority = authority;
    this.projectRoot = projectRoot;
    this.knowledgeDir = path.join(projectRoot, '.uig', 'knowledge', 'compound_packs');
    this.ensureDir();
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.knowledgeDir)) {
      fs.mkdirSync(this.knowledgeDir, { recursive: true });
    }
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
          this.recordSupport(receipt, 'verified');
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
    return this.claimsSuccess(r) && this.hasNoDelta(r) && r.evidence.some(e => e.trim().length > 0);
  }

  /** A claimed success without evidence is unverified, not contradictory. */
  private isContradiction(r: Receipt): boolean {
    return !this.claimsSuccess(r) || !this.hasNoDelta(r);
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
    return fs.existsSync(filePath) ? parsePack(fs.readFileSync(filePath, 'utf8')) : undefined;
  }

  private recordSupport(receipt: Receipt, kind: 'verified' | 'contradicted'): void {
    const filePath = this.packPath(receipt.actionPerformed);
    const existing = this.read(filePath);

    // Failures only matter to actions we have already promoted.
    if (kind === 'contradicted' && !existing) return;

    const state: PackState = existing ?? {
      action: flat(receipt.actionPerformed),
      expected: flat(receipt.expectedOutcome),
      evidence: flat(receipt.evidence.filter(e => e.trim()).join(', ')),
      intent: flat(receipt.intentId),
      actor: flat(receipt.actorId),
      intents: [], principals: [], verified: [], contradicted: [], failureModes: [],
      latest: kind, knowledgeApprovedBy: '', canonApprovedBy: '', retiredBy: '',
    };

    // Replaying a receipt already counted must not change the pack (idempotence).
    const id = safeId(receipt.id);
    if (state.verified.includes(id) || state.contradicted.includes(id)) return;
    state[kind].push(id);
    state.latest = kind;

    if (kind === 'verified') {
      const intent = flat(receipt.intentId);
      if (!state.intents.includes(intent)) state.intents.push(intent);
      const principal = this.authority === 'unverified' ? undefined : this.authority.lookup(receipt.authorizationId)?.intent.principalId;
      if (principal && !state.principals.includes(principal)) state.principals.push(safeId(principal));
    } else {
      state.failureModes.push(flat(receipt.delta, 120));
      state.failureModes = state.failureModes.slice(-3);
    }

    fs.writeFileSync(filePath, this.render(state));
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
    fs.writeFileSync(filePath, this.render(state));
  }

  /** Canon by principal approval, through the gate, and only from Knowledge. Never by volume of reuse. */
  approveCanon(action: string, principalId: string): void {
    const { filePath, state } = this.forPrincipal(action, principalId);
    if (statusOf(state) !== 'verified') throw new Error(`Cannot make a ${statusOf(state)} pack canon.`);
    if (levelOf(state) !== 'knowledge') throw new Error('Canon must first be Knowledge: it is earned rung by rung, never skipped.');
    state.canonApprovedBy = safeId(principalId);
    fs.writeFileSync(filePath, this.render(state));
  }

  /** Withdraw a pack. Final: later successes do not revive a retired pack. */
  retire(action: string, principalId: string): void {
    const { filePath, state } = this.forPrincipal(action, principalId);
    state.retiredBy = safeId(principalId);
    fs.writeFileSync(filePath, this.render(state));
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
knowledge_approved_by: ${s.knowledgeApprovedBy}
canon_approved_by: ${s.canonApprovedBy}
retired_by: ${s.retiredBy}
---
# Knowledge Pack: ${s.action}
**${this.headline(s)}**

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
