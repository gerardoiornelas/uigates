import {
  IntelligenceEngine,
  UIGatesWrapper
} from './UIGatesWrapper';
import {
  Intent,
  Proposal,
  Authorization,
  Receipt,
  AuthorityState
} from './types/primitives';
import { GovernanceEngine } from './GovernanceEngine';
import { ReceiptStore } from './ReceiptStore';

/**
 * MockIntelligenceEngine
 * Simulates a combination of AIDD (orchestration),
 * Ralph Loop (iteration), and CE (knowledge compounding).
 */
class MockIntelligenceEngine implements IntelligenceEngine {
  private iterations = 0;
  private knowledgeBase: string[] = [];

  async proposeAction(intent: Intent): Promise<Proposal> {
    this.iterations++;

    // Simulate AIDD decomposing the goal
    const actions = [
      { action: 'Refactor Auth Module', resource: 'src/auth.ts', impact: 'medium' as const },
      { action: 'Update DB Schema', resource: 'src/db/schema.sql', impact: 'high' as const },
      { action: 'Clean up logs', resource: 'src/utils/logger.ts', impact: 'low' as const },
    ];

    const currentAction = actions[Math.min(this.iterations - 1, actions.length - 1)];

    return {
      id: `prop_${this.iterations}`,
      intentId: intent.id,
      actorId: 'agent-007',
      action: currentAction.action,
      resource: currentAction.resource,
      rationale: `Implementing a part of ${intent.goal}`,
      impact: currentAction.impact,
      risk: 'Simulated risk',
      authorityRequested: 'delegated',
      verificationPlan: 'Run unit tests and check for regressions',
      proposedAt: new Date(),
    };
  }

  async executeAction(auth: Authorization, proposal: Proposal): Promise<{
    success: boolean;
    actualOutcome: string;
    evidence: string[];
    delta: string;
  }> {
    console.log(`  [Ralph Loop] Iterating on ${proposal.action}...`);

    // Simulate a Ralph Loop: It might fail first, then succeed
    if (this.iterations === 1) {
      return {
        success: false,
        actualOutcome: 'Test failed: Syntax error in refactor',
        evidence: ['test_report_1.log'],
        delta: 'Bug introduced in line 42',
      };
    }

    // Final action signals completion
    const isLastAction = this.iterations >= 3;

    return {
      success: true,
      actualOutcome: isLastAction ? 'GOAL_REACHED: All tasks complete' : 'Task completed successfully',
      evidence: ['test_report_pass.log', 'commit_hash_abc123'],
      delta: 'None',
    };
  }

  async learnFromReceipt(receipt: Receipt): Promise<void> {
    console.log(`  [Compound Engineering] Synthesizing lesson from ${receipt.id}...`);
    this.knowledgeBase.push(`Lesson from ${receipt.actionPerformed}: ${receipt.actualOutcome}`);
  }
}

// --- Test Execution ---

async function runDemo() {
  const govEngine = new GovernanceEngine();
  const receiptStore = new ReceiptStore();
  const mockEngine = new MockIntelligenceEngine();
  const wrapper = new UIGatesWrapper(mockEngine, govEngine, receiptStore);

  const myIntent: Intent = {
    id: 'intent-123',
    principalId: 'principal-bob',
    goal: 'Modernize the Auth System',
    constraints: ['No downtime', 'Maintain audit logs'],
    successEvidence: ['All tests pass', 'Security audit clean'],
    authorityDomain: ['src/'],
    expiry: new Date(Date.now() + 3600000),
    createdAt: new Date(),
  };

  await wrapper.runTask(myIntent, 'principal-bob');
}

runDemo().catch(console.error);
