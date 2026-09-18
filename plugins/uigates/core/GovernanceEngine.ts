import { Proposal, Intent, AuthorityState, Authorization, Policy } from './types/primitives';

export class GovernanceEngine {
  private policies: Policy[] = [];
  private cumulativeRisk: Map<string, number> = new Map(); // IntentID -> Risk Score

  constructor(initialPolicies: Policy[] = []) {
    this.policies = initialPolicies;
  }

  addPolicy(policy: Policy): void {
    this.policies.push(policy);
  }

  evaluate(proposal: Proposal, intent: Intent): {
    suggestedState: AuthorityState;
    rationale: string;
    denied: boolean;
  } {
    const currentRisk = this.cumulativeRisk.get(intent.id) || 0;
    const proposalRiskValue = proposal.impact === 'high' ? 10 : proposal.impact === 'medium' ? 5 : 1;
    const newRisk = currentRisk + proposalRiskValue;

    // 1. Basic Intent Match
    const isWithinDomain = intent.authorityDomain.some(domain =>
      proposal.resource.includes(domain)
    );

    if (!isWithinDomain) {
      return {
        suggestedState: 'prohibited',
        rationale: `Resource ${proposal.resource} is outside the authorized domain.`,
        denied: true
      };
    }

    // 2. Policy Evaluation
    for (const policy of this.policies) {
      if (!policy.rule(proposal, intent)) {
        return {
          suggestedState: 'prohibited',
          rationale: `Policy violation: ${policy.name}`,
          denied: true
        };
      }
    }

    // 3. Salami Protection: Aggregate Risk Escalation
    if (newRisk > 15) {
      return {
        suggestedState: 'gated',
        rationale: `Cumulative risk for this intent has reached ${newRisk}. Escalating to Gated.`,
        denied: false
      };
    }

    // 4. Individual Risk
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

  authorize(proposal: Proposal, principalId: string, state: AuthorityState): Authorization {
    this.recordAuthorizedRisk(proposal.intentId, proposal.impact);
    return {
      id: `auth_${Math.random().toString(36).substr(2, 9)}`,
      proposalId: proposal.id,
      authorizedBy: principalId,
      state: state,
      authorizedAt: new Date(),
    };
  }
}
