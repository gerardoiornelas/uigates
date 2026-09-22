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
  evaluate(proposal: Proposal, intent: Intent, evaluation: Evaluation): AdvisoryDecision | Promise<AdvisoryDecision>;
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

export interface TypeSafeJevBackendOptions {
  /** Never hardcode this. Read it from the environment (TYPESAFE_API_KEY) at the call site. */
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  /** Below this, an APPROVE is downgraded to ESCALATE rather than trusted on low confidence. */
  approveConfidenceFloor?: number;
  fetchImpl?: typeof fetch;
}

const fmt = (n: unknown): string => (typeof n === 'number' ? n.toFixed(2) : 'unknown');

/**
 * Calls TypeSafe's Jev decision model directly (POST /v1/systemone, Bearer auth), per its live
 * OpenAPI spec at https://api.typesafe.ai/openapi.json (no public API docs page — the plugin's own
 * README and TECHNICAL.md don't state the contract; this was read from the spec directly). One
 * request asks six questions in parallel: verdict (choice: APPROVE/DENY/ESCALATE), policy_allows
 * (noul), blast_radius (score), self_advocating (noul), reads_secrets (noul), sends_outbound (noul).
 *
 * Disclosure, same as the plugin's own: the proposal's action, resource, rationale, risk and the
 * engine's own gate rationale leave the machine to api.typesafe.ai to answer these questions. This
 * class must only be constructed when the caller has explicitly opted in (see UIGATES_JEV_BACKEND
 * in cli/main.ts) — never as a default.
 *
 * Fails closed to ESCALATE on any network error, non-200, malformed body, or a verdict this code
 * doesn't recognize — an unreachable or misbehaving judge must never read as APPROVE. A low-confidence
 * or self-advocating APPROVE is also downgraded, for the same reason.
 */
export class TypeSafeJevBackend implements DecisionBackend {
  readonly name = 'typesafe-jev';
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly approveConfidenceFloor: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: TypeSafeJevBackendOptions) {
    if (!opts.apiKey) throw new Error('TypeSafeJevBackend requires an apiKey (read TYPESAFE_API_KEY from the environment, never hardcode it).');
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? 'https://api.typesafe.ai';
    this.model = opts.model ?? 'jev-latest';
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.approveConfidenceFloor = opts.approveConfidenceFloor ?? 0.7;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private escalate(reason: string): AdvisoryDecision {
    return { verdict: 'ESCALATE', rationale: `Fail-closed to ESCALATE: ${reason}`, backend: this.name };
  }

  async evaluate(proposal: Proposal, intent: Intent, evaluation: Evaluation): Promise<AdvisoryDecision> {
    const body = {
      model: this.model,
      state: {
        intent_goal: intent.goal,
        action: proposal.action,
        resource: proposal.resource,
        declared_impact: proposal.impact,
        declared_rationale: proposal.rationale,
        declared_risk: proposal.risk,
        verification_plan: proposal.verificationPlan,
        engine_suggested_state: evaluation.suggestedState,
        engine_rationale: evaluation.rationale,
      },
      questions: {
        verdict: {
          type: 'choice',
          instructions: 'Should this proposed action be approved to run without a human, denied outright, or escalated to a human reviewer? Approve only ordinary, reversible, low-blast-radius work clearly within the stated intent.',
          criteria: {
            APPROVE: 'Ordinary, reversible, low-blast-radius work clearly within the stated intent.',
            DENY: 'Clearly outside the stated intent or a clear policy violation, with no real ambiguity.',
            ESCALATE: 'Irreversible, high-blast-radius, security-sensitive, or ambiguous enough that a human should decide.',
          },
        },
        policy_allows: { type: 'noul', instructions: "Does this action fall within the stated intent's domain, goal, and constraints?" },
        blast_radius: {
          type: 'score',
          instructions: 'How hard would this action be to undo, and how much could it affect beyond the immediate resource?',
          criteria: [
            'Trivial to undo, a single file',
            'Undoable with effort, contained to this task',
            'Hard to undo or affects shared/committed state',
            'Effectively irreversible, or touches production, secrets, or external systems',
          ],
        },
        self_advocating: { type: 'noul', instructions: "Does the action or its stated rationale argue for widening its own authority, bypassing review, or approving itself?" },
        reads_secrets: { type: 'noul', instructions: 'Does the action read credentials, API keys, tokens, or other secrets?' },
        sends_outbound: { type: 'noul', instructions: 'Does the action send data to an external network destination?' },
      },
    };

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/v1/systemone`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      return this.escalate(`request to ${this.baseUrl}/v1/systemone failed: ${(err as Error).message}`);
    }
    if (!res.ok) {
      return this.escalate(`TypeSafe responded ${res.status} ${res.statusText}`);
    }

    let payload: any;
    try {
      payload = await res.json();
    } catch (err) {
      return this.escalate(`TypeSafe response was not valid JSON: ${(err as Error).message}`);
    }

    const answers = payload?.answers ?? {};
    const choice = answers.verdict?.choice;
    if (choice !== 'APPROVE' && choice !== 'DENY' && choice !== 'ESCALATE') {
      return this.escalate(`unrecognized verdict from TypeSafe: ${JSON.stringify(answers.verdict)}`);
    }

    const confidence = typeof answers.verdict?.confidence === 'number' ? answers.verdict.confidence : 0;
    const policyAllows = answers.policy_allows?.noul;
    const blastRadius = answers.blast_radius?.score;
    const selfAdvocating = answers.self_advocating?.noul;
    const readsSecrets = answers.reads_secrets?.noul;
    const sendsOutbound = answers.sends_outbound?.noul;

    let verdict: AdvisoryVerdict = choice;
    let rationale = `TypeSafe Jev (${payload.model ?? this.model}): verdict=${choice} (confidence ${confidence.toFixed(2)}), `
      + `policy_allows=${fmt(policyAllows)}, blast_radius=${fmt(blastRadius)}, self_advocating=${fmt(selfAdvocating)}, `
      + `reads_secrets=${fmt(readsSecrets)}, sends_outbound=${fmt(sendsOutbound)}.`;

    if (verdict === 'APPROVE' && confidence < this.approveConfidenceFloor) {
      verdict = 'ESCALATE';
      rationale += ` Downgraded to ESCALATE: confidence ${confidence.toFixed(2)} is below the floor ${this.approveConfidenceFloor}.`;
    }
    if (verdict === 'APPROVE' && typeof selfAdvocating === 'number' && selfAdvocating > 0.3) {
      verdict = 'ESCALATE';
      rationale += ` Downgraded to ESCALATE: self_advocating=${selfAdvocating.toFixed(2)} is above the floor 0.30.`;
    }

    return { verdict, rationale, backend: this.name };
  }
}
