import type { Intent, Proposal } from './types/primitives';
import type { Evaluation } from './GovernanceEngine';

/**
 * Spike for docs/compound-engineering/graph-jev-aar.md (gerardoiornelas-portfolio repo): a pluggable,
 * read-only advisory judge that sits *alongside* GovernanceEngine.evaluate(), not inside `authorize`.
 * It never grants authority — only a principal's --approved-by does that (see `authorize` in main.ts).
 * This interface exists so a real judge (e.g. a Jev-family backend) can be tried without touching the
 * authorization trust model until that's an explicit, separate decision.
 */
export type AdvisoryVerdict = 'APPROVE' | 'DENY' | 'ESCALATE';

export interface AdvisoryDecision {
  verdict: AdvisoryVerdict;
  rationale: string;
  /** Which backend produced this, for provenance — never omit when recording or printing a decision. */
  backend: string;
}

export interface DecisionBackend {
  readonly name: string;
  evaluate(proposal: Proposal, intent: Intent, evaluation: Evaluation): AdvisoryDecision;
}

/**
 * No external call, no credential, no real judgment. It exists to prove the integration point:
 * it defers every gated proposal to ESCALATE rather than guessing, because a local heuristic has no
 * basis to approve real risk. A delegated proposal already needs no gate, so APPROVE here is not
 * doing new work — it's the honest baseline a real backend (e.g. jev-approvals) should be measured against.
 */
export class LocalStubBackend implements DecisionBackend {
  readonly name = 'local-stub';

  evaluate(_proposal: Proposal, _intent: Intent, evaluation: Evaluation): AdvisoryDecision {
    if (evaluation.denied) {
      return { verdict: 'DENY', rationale: evaluation.rationale, backend: this.name };
    }
    if (evaluation.suggestedState === 'delegated') {
      return { verdict: 'APPROVE', rationale: 'Already delegated by the intent; no gate to advise on.', backend: this.name };
    }
    return {
      verdict: 'ESCALATE',
      rationale: `This is a local stub with no real judgment; it defers every gated proposal (${evaluation.rationale}) to a human rather than guessing.`,
      backend: this.name,
    };
  }
}
