import * as path from 'path';
import * as crypto from 'crypto';
import { Proposal, Intent, AuthorityState, Authorization, Policy } from './types/primitives';
import { AuthorityLedger } from './AuthorityLedger';
import { ReceiptStore } from './ReceiptStore';
import { gateClassOf } from './GateClass';
import { AUDIT_RECORD_PATH, STATE_PATH } from './names';
import type { AdvisoryDecision } from './DecisionBackend';

/**
 * Resource Protection Policy
 * Ensures that specific critical resources always require Gated authority.
 */
export const ResourceProtectionPolicy: Policy = {
  id: 'policy-resource-protection',
  name: 'Critical Resource Protection',
  description: 'Resources listed as critical always require Gated authorization.',
  rule: (proposal, _intent) => {
    const isCritical = gateClassOf(path.posix.normalize(proposal.resource.replace(/\\/g, '/'))) !== null;

    if (isCritical && proposal.impact === 'low') {
      return false;
    }
    return true;
  }
};

/**
 * Why a proposal was denied. `suggestedState` is 'prohibited' for every denial, which is the state
 * the architecture reserves for what can never be authorized; most denials are not that. A proposal
 * outside the domain, from an expired intent, or missing a replan can become fine, so an agent must
 * be able to tell those from a true prohibition.
 */
export type DenialKind = 'wrong-intent' | 'expired' | 'wrong-actor' | 'replan-required' | 'protected-record' | 'outside-domain' | 'policy';

export interface Evaluation {
  suggestedState: AuthorityState;
  rationale: string;
  denied: boolean;
  denial?: DenialKind;
}

// Authority and audit records (nothing that acts under an intent may alter them) and any other UI-GATES
// state (e.g. knowledge, which changes only through synthesis or with a principal's decision). Both the
// current and the legacy state directory are covered, whichever one the project uses.
const AUDIT_RECORDS = AUDIT_RECORD_PATH;
const UIGATES_STATE = STATE_PATH;

const fingerprint = (p: Proposal) =>
  crypto.createHash('sha256').update(JSON.stringify([
    p.id, p.intentId, p.actorId, p.action, p.resource, p.impact, p.rationale,
    p.risk, p.authorityRequested, p.verificationPlan, p.proposedAt, p.taskId ?? null, p.replan ?? null,
  ])).digest('hex');

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
    const deny = (denial: DenialKind, rationale: string): Evaluation => ({ suggestedState: 'prohibited', rationale, denied: true, denial });

    // "Is this actor authorized ... under this intent, right now?"
    if (proposal.intentId !== intent.id) {
      return deny('wrong-intent', `Proposal ${proposal.id} belongs to intent ${proposal.intentId}, not ${intent.id}.`);
    }
    if (!Number.isFinite(new Date(intent.expiry).getTime()) || new Date(intent.expiry).getTime() <= Date.now()) {
      return deny('expired', `Intent ${intent.id} has expired; it grants no authority.`);
    }
    if (intent.authorizedActors && !intent.authorizedActors.includes(proposal.actorId)) {
      return deny('wrong-actor', `Actor ${proposal.actorId} is not authorized to act under intent ${intent.id}.`);
    }

    // "On a delta, return to Plan": a retry must carry the replan that answers the last failure.
    if (proposal.taskId && this.receipts) {
      const last = this.receipts.getByTask(intent.id, proposal.taskId).at(-1);
      if (last && last.delta.trim().toLowerCase() !== 'none') {
        const r = proposal.replan;
        const stated = (v?: string) => typeof v === 'string' && v.trim().length >= 3 && !/^(todo|tbd|n\/a|\.{3})$/i.test(v.trim());
        if (!r || r.after !== last.id || !stated(r.rootCause) || !stated(r.revision)) {
          return deny('replan-required', `Task ${proposal.taskId} ended with a delta ("${last.delta}", receipt ${last.id}). Return to planning: a retry must carry a replan citing that receipt, the root cause, and the revision.`);
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
      return deny('protected-record', `Resource ${proposal.resource} is an authority or audit record; it cannot be altered through the workflow.`);
    }

    // Domains are project-relative path prefixes, never substrings. '/' means
    // the project root, not permission to address the host filesystem.
    const isWithinDomain = !escapesRoot && !path.posix.isAbsolute(resource) && !/^[a-z]:/i.test(resource) && intent.authorityDomain.some(domain => {
      if (domain === '/') return true;
      const prefix = path.posix.normalize(domain.replace(/\\/g, '/')).replace(/\/$/, '');
      return prefix !== '..' && !prefix.startsWith('../') && (resource === prefix || resource.startsWith(prefix + '/'));
    });

    if (!isWithinDomain) {
      // An absolute path or a '..' escape is never inside a project-relative domain, whatever the domain says.
      const never = escapesRoot || path.posix.isAbsolute(resource) || /^[a-z]:/i.test(resource);
      return deny('outside-domain', never
        ? `Resource ${proposal.resource} is not a project-relative path: absolute paths and '..' escapes are never inside a domain.`
        : `Resource ${proposal.resource} is outside the authorized domain.`);
    }

    if (UIGATES_STATE.test(resource)) {
      return {
        suggestedState: 'gated',
        rationale: `Resource ${proposal.resource} is UI-GATES state; knowledge changes through synthesis or a principal decision.`,
        denied: false
      };
    }

    // 2. Critical Resource Override (Hard-coded Protection). Judged on the normalized path, so
    // 'src/../.gitlab-ci.yml' is the CI file and not something under src/.
    const critical = gateClassOf(resource);
    if (critical) {
      return {
        suggestedState: 'gated',
        rationale: `Resource ${proposal.resource} is marked as CRITICAL (${critical}) and requires Gated authorization.`,
        denied: false
      };
    }

    // 3. Policy Evaluation
    for (const policy of this.policies) {
      if (!policy.rule(proposal, intent)) {
        return deny('policy', `Policy violation: ${policy.name}`);
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
    if (principalId !== evaluated.intent.principalId) {
      throw new Error(`Cannot authorize ${proposal.id}: only the intent's principal (${evaluated.intent.principalId}) can grant authority, not ${principalId}.`);
    }
    return this.issueAuthorization(proposal, state, principalId);
  }

  /**
   * Issue authority on an advisory backend's own APPROVE, per docs/compound-engineering/graph-jev-aar.md
   * (solo-workflow direction, decided 2026-09-22). `authorizedBy` is derived only from the backend's own
   * name on the decision it actually returned — never a caller-supplied string — so this path cannot be
   * used to forge a human's approval, and the record never claims a person decided what a model did.
   * DENY and ESCALATE grant nothing; ESCALATE still needs a human through `authorize(principalId, ...)`.
   */
  authorizeViaAdvisory(proposal: Proposal, decision: AdvisoryDecision, state: AuthorityState): Authorization {
    if (decision.verdict !== 'APPROVE') {
      throw new Error(`Cannot authorize ${proposal.id} via advisory: verdict was ${decision.verdict}, not APPROVE.`);
    }
    return this.issueAuthorization(proposal, state, `jev:${decision.backend}`);
  }

  private issueAuthorization(proposal: Proposal, state: AuthorityState, authorizedBy: string): Authorization {
    const evaluated = this.evaluations.get(this.key(proposal));
    if (!evaluated) throw new Error(`Cannot authorize ${proposal.id}: it was never evaluated by this engine.`);
    if (evaluated.fingerprint !== fingerprint(proposal)) {
      throw new Error(`Cannot authorize ${proposal.id}: it differs from the proposal that was evaluated.`);
    }
    const { intent, result } = evaluated;
    if (result.denied) throw new Error(`Cannot authorize ${proposal.id}: denied (${result.rationale})`);
    if (state !== result.suggestedState) {
      throw new Error(`Cannot authorize ${proposal.id} as ${state}: evaluation resolved to ${result.suggestedState}.`);
    }
    if (!Number.isFinite(new Date(intent.expiry).getTime()) || new Date(intent.expiry).getTime() <= Date.now()) throw new Error(`Cannot authorize ${proposal.id}: intent ${intent.id} has expired or is invalid.`);

    this.recordAuthorizedRisk(proposal.intentId, proposal.impact);
    const authorization: Authorization = {
      id: `auth_${crypto.randomUUID()}`,
      proposalId: proposal.id,
      authorizedBy,
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
