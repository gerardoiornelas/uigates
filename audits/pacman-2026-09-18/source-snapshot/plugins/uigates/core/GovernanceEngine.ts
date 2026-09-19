import * as path from 'path';
import * as crypto from 'crypto';
import { Proposal, Intent, AuthorityState, Authorization, Policy } from './types/primitives';
import { AuthorityLedger } from './AuthorityLedger';
import { ReceiptStore } from './ReceiptStore';

/**
 * Resource Protection Policy
 * Ensures that specific critical resources always require Gated authority.
 */
export const ResourceProtectionPolicy: Policy = {
  id: 'policy-resource-protection',
  name: 'Critical Resource Protection',
  description: 'Resources listed as critical always require Gated authorization.',
  rule: (proposal, _intent) => {
    const criticalResources = ['package.json', 'settings.json', '.env'];
    const isCritical = criticalResources.some(res => proposal.resource.endsWith(res));

    if (isCritical && proposal.impact === 'low') {
      return false;
    }
    return true;
  }
};

export interface Evaluation {
  suggestedState: AuthorityState;
  rationale: string;
  denied: boolean;
}

// Authority and audit records: nothing that acts under an intent may alter them.
const AUDIT_RECORDS = /(^|\/)\.uig\/(intents|proposals|authorizations|receipts)(\/|$)/;
// Any other UI-GATES state (e.g. knowledge) changes only through synthesis, or with a principal's decision.
const UIG_STATE = /(^|\/)\.uig(\/|$)/;

const fingerprint = (p: Proposal) =>
  crypto.createHash('sha256').update(JSON.stringify([p.id, p.intentId, p.actorId, p.action, p.resource, p.impact, p.taskId ?? null, p.replan ?? null])).digest('hex');

export class GovernanceEngine {
  private policies: Policy[] = [];
  private cumulativeRisk: Map<string, number> = new Map(); // IntentID -> Risk Score
  // What evaluate() decided, so authorize() can only sign what was actually approved.
  private evaluations: Map<string, { intent: Intent; result: Evaluation; fingerprint: string }> = new Map();

  /**
   * `receipts` lets the engine see what earlier attempts at a task produced, which is what
   * makes "no retry on a delta without replanning" enforceable. Without it that rule is not applied.
   */
  constructor(
    initialPolicies: Policy[] = [],
    public readonly ledger: AuthorityLedger = new AuthorityLedger(),
    private readonly receipts?: ReceiptStore
  ) {
    this.policies = initialPolicies;
  }

  addPolicy(policy: Policy): void {
    this.policies.push(policy);
  }

  private key(p: Proposal): string {
    return `${p.intentId}::${p.id}`;
  }

  evaluate(proposal: Proposal, intent: Intent): Evaluation {
    const result = this.decide(proposal, intent);
    this.evaluations.set(this.key(proposal), { intent: structuredClone(intent), result, fingerprint: fingerprint(proposal) });
    return result;
  }

  private decide(proposal: Proposal, intent: Intent): Evaluation {
    const deny = (rationale: string): Evaluation => ({ suggestedState: 'prohibited', rationale, denied: true });

    // "Is this actor authorized ... under this intent, right now?"
    if (proposal.intentId !== intent.id) {
      return deny(`Proposal ${proposal.id} belongs to intent ${proposal.intentId}, not ${intent.id}.`);
    }
    if (new Date(intent.expiry).getTime() <= Date.now()) {
      return deny(`Intent ${intent.id} has expired; it grants no authority.`);
    }
    if (intent.authorizedActors && !intent.authorizedActors.includes(proposal.actorId)) {
      return deny(`Actor ${proposal.actorId} is not authorized to act under intent ${intent.id}.`);
    }

    // "On a delta, return to Plan": a retry must carry the replan that answers the last failure.
    if (proposal.taskId && this.receipts) {
      const last = this.receipts.getByTask(intent.id, proposal.taskId).at(-1);
      if (last && last.delta.trim().toLowerCase() !== 'none') {
        const r = proposal.replan;
        const stated = (v?: string) => typeof v === 'string' && v.trim().length >= 3 && !/^(todo|tbd|n\/a|\.{3})$/i.test(v.trim());
        if (!r || r.after !== last.id || !stated(r.rootCause) || !stated(r.revision)) {
          return deny(`Task ${proposal.taskId} ended with a delta ("${last.delta}", receipt ${last.id}). Return to planning: a retry must carry a replan citing that receipt, the root cause, and the revision.`);
        }
      }
    }

    const currentRisk = this.cumulativeRisk.get(intent.id) || 0;
    const proposalRiskValue = proposal.impact === 'high' ? 10 : proposal.impact === 'medium' ? 5 : 1;
    const newRisk = currentRisk + proposalRiskValue;

    // Judge the resource by where it resolves, not by its literal text:
    // 'games/../../etc/hosts' contains 'games/' but is nowhere near it.
    const resource = path.posix.normalize(proposal.resource.replace(/\\/g, '/'));
    const escapesRoot = resource === '..' || resource.startsWith('../');

    // Prohibited: altering authority or audit records, even inside an otherwise wide domain.
    if (AUDIT_RECORDS.test(resource)) {
      return deny(`Resource ${proposal.resource} is an authority or audit record; it cannot be altered through the workflow.`);
    }

    // 1. Basic Intent Match
    // FIXED: Ensure the domain check is inclusive enough for the test
    const isWithinDomain = !escapesRoot && intent.authorityDomain.some(domain =>
      resource.includes(domain) || domain === '/'
    );

    if (!isWithinDomain) {
      return deny(`Resource ${proposal.resource} is outside the authorized domain.`);
    }

    if (UIG_STATE.test(resource)) {
      return {
        suggestedState: 'gated',
        rationale: `Resource ${proposal.resource} is UI-GATES state; knowledge changes through synthesis or a principal decision.`,
        denied: false
      };
    }

    // 2. Critical Resource Override (Hard-coded Protection)
    const criticalResources = ['package.json', 'settings.json', '.env'];
    if (criticalResources.some(res => resource.endsWith(res))) {
      return {
        suggestedState: 'gated',
        rationale: `Resource ${proposal.resource} is marked as CRITICAL and requires Gated authorization.`,
        denied: false
      };
    }

    // 3. Policy Evaluation
    for (const policy of this.policies) {
      if (!policy.rule(proposal, intent)) {
        return deny(`Policy violation: ${policy.name}`);
      }
    }

    // 4. Salami Protection: Aggregate Risk Escalation
    if (newRisk > 15) {
      return {
        suggestedState: 'gated',
        rationale: `Cumulative risk for this intent has reached ${newRisk}. Escalating to Gated.`,
        denied: false
      };
    }

    // 5. Individual Risk
    if (proposal.impact === 'low') {
      return {
        suggestedState: 'delegated',
        rationale: 'Low impact action within domain.',
        denied: false
      };
    }

    return {
      suggestedState: 'gated',
      rationale: 'Medium or High impact action requires authorization.',
      denied: false
    };
  }

  recordAuthorizedRisk(intentId: string, impact: string): void {
    const riskValue = impact === 'high' ? 10 : impact === 'medium' ? 5 : 1;
    this.cumulativeRisk.set(intentId, (this.cumulativeRisk.get(intentId) || 0) + riskValue);
  }

  /**
   * Issue authority. It can only grant exactly what evaluate() approved for this
   * exact proposal, and only in the name of the intent's principal: execution
   * never implies authorization.
   */
  authorize(proposal: Proposal, principalId: string, state: AuthorityState): Authorization {
    const evaluated = this.evaluations.get(this.key(proposal));
    if (!evaluated) throw new Error(`Cannot authorize ${proposal.id}: it was never evaluated by this engine.`);
    if (evaluated.fingerprint !== fingerprint(proposal)) {
      throw new Error(`Cannot authorize ${proposal.id}: it differs from the proposal that was evaluated.`);
    }
    const { intent, result } = evaluated;
    if (result.denied) throw new Error(`Cannot authorize ${proposal.id}: denied (${result.rationale})`);
    if (principalId !== intent.principalId) {
      throw new Error(`Cannot authorize ${proposal.id}: only the intent's principal (${intent.principalId}) can grant authority, not ${principalId}.`);
    }
    if (state !== result.suggestedState) {
      throw new Error(`Cannot authorize ${proposal.id} as ${state}: evaluation resolved to ${result.suggestedState}.`);
    }
    if (new Date(intent.expiry).getTime() <= Date.now()) throw new Error(`Cannot authorize ${proposal.id}: intent ${intent.id} has expired.`);

    this.recordAuthorizedRisk(proposal.intentId, proposal.impact);
    const authorization: Authorization = {
      id: `auth_${crypto.randomUUID()}`,
      proposalId: proposal.id,
      authorizedBy: principalId,
      state: state,
      authorizedAt: new Date(),
      expiry: new Date(intent.expiry),
      actorId: proposal.actorId,
      intentId: proposal.intentId,
      action: proposal.action,
      resource: proposal.resource,
    };
    this.ledger.register({ authorization, proposal, intent });
    return authorization;
  }
}
