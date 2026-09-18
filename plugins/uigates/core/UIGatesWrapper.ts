import {
  GovernanceEngine,
  ReceiptStore
} from './GovernanceEngine';
import {
  Intent,
  Proposal,
  Authorization,
  Receipt,
  AuthorityState
} from './types/primitives';

/**
 * IntelligenceEngine Interface
 * This is what any tool (AIDD, Ralph Loop, etc.) must implement to be
 * governed by UI-GATES.
 */
export interface IntelligenceEngine {
  // The engine's ability to decompose a goal into a proposal
  proposeAction(intent: Intent): Promise<Proposal>;

  // The engine's ability to execute an authorized action
  executeAction(authorization: Authorization, proposal: Proposal): Promise<{
    success: boolean;
    actualOutcome: string;
    evidence: string[];
    delta: string;
  }>;

  // The engine's ability to refine its internal state based on a receipt
  learnFromReceipt(receipt: Receipt): Promise<void>;
}

/**
 * UIGatesWrapper
 * This class wraps any IntelligenceEngine and enforces the UI-GATES lifecycle.
 */
export class UIGatesWrapper {
  constructor(
    private engine: IntelligenceEngine,
    private govEngine: GovernanceEngine,
    private receiptStore: ReceiptStore
  ) {}

  /**
   * The main entry point for a task.
   */
  async runTask(intent: Intent, principalId: string): Promise<void> {
    console.log(`[UI-GATES] Starting task for Intent: ${intent.goal}`);

    let taskComplete = false;
    while (!taskComplete) {
      // 1. Intelligence Layer: Propose an action
      const proposal = await this.engine.proposeAction(intent);

      // 2. Governance Layer: Evaluate and Authorize
      const evaluation = this.govEngine.evaluate(proposal, intent);

      if (evaluation.denied) {
        console.error(`[UI-GATES] Proposal Denied: ${evaluation.rationale}`);
        // Here, a real system would stop or ask the Principal for a policy override
        break;
      }

      if (evaluation.suggestedState === 'gated') {
        console.log(`[UI-GATES] Action GATED. Requesting Principal authorization...`);
        // Simulation: In a real tool, this would pause for human input
        console.log(`[Principal] Authorizing ${proposal.action} as ${AuthorityState.delegated}...`);
      }

      const auth = this.govEngine.authorize(proposal, principalId, evaluation.suggestedState);

      // 3. Intelligence Layer: Execute (e.g., via Ralph Loop)
      console.log(`[UI-GATES] Executing authorized action: ${proposal.action}`);
      const result = await this.engine.executeAction(auth, proposal);

      // 4. Governance Layer: Record Receipt
      const receipt: Receipt = {
        id: `rec_${Math.random().toString(36).substr(2, 9)}`,
        authorizationId: auth.id,
        intentId: intent.id,
        actorId: proposal.actorId,
        actionPerformed: proposal.action,
        expectedOutcome: proposal.verificationPlan,
        actualOutcome: result.actualOutcome,
        delta: result.delta,
        evidence: result.evidence,
        verifiedAt: new Date(),
      };

      this.receiptStore.record(receipt);

      // 5. Intelligence Layer: Learn from result (Compound Engineering)
      await this.engine.learnFromReceipt(receipt);

      // Determine if the overall intent is satisfied
      // (In a real system, the engine would indicate completion)
      if (result.success && result.actualOutcome.includes('GOAL_REACHED')) {
        taskComplete = true;
      }
    }

    console.log(`[UI-GATES] Task complete for Intent: ${intent.goal}`);
  }
}
