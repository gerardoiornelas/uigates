import { StateStore } from '../../core/StateStore';
import { GovernanceEngine } from '../../core/GovernanceEngine';
import { ReceiptStore } from '../../core/ReceiptStore';
import { UIGatesWrapper, IntelligenceEngine } from '../../core/UIGatesWrapper';
import { AIDDOrchestrator, Task } from '../aidd/orchestrator';
import { Intent } from '../../core/types/primitives';

/**
 * Mock Worker Engine for the Ralph Loop
 */
class RalphWorker implements IntelligenceEngine {
  async proposeAction(intent: Intent): Promise<never> {
    throw new Error('RalphWorker does not propose; it executes tasks from FIX_PLAN.md');
  }

  async executeAction(auth: any, proposal: any) {
    console.log(`  [Ralph Loop] Working on: ${proposal.action}...`);
    // Simulate a a loop that fails once then succeeds
    if (Math.random() > 0.7) {
      return { success: false, actualOutcome: 'Failed tests', evidence: ['fail.log'], delta: 'Bug' };
    }
    return { success: true, actualOutcome: 'Verified success', evidence: ['pass.log'], delta: 'None' };
  }

  async learnFromReceipt(receipt: any) {
    console.log(`  [CE] Learning from ${receipt.id}...`);
  }
}

export class LoopDriver {
  private store: StateStore;
  private govEngine: GovernanceEngine;
  private receiptStore: ReceiptStore;

  constructor(store: StateStore, govEngine: GovernanceEngine, receiptStore: ReceiptStore) {
    this.store = store;
    this.govEngine = govEngine;
    this.receiptStore = receiptStore;
  }

  async run(intentId: string) {
    const intent = this.store.getIntent(intentId);
    if (!intent) throw new Error('Intent not found');

    const aidd = new AIDDOrchestrator(this.store);
    const tasks = await aidd.generatePlan(intent);
    await aidd.writeFixPlan(tasks);

    console.log(`[Ralph Loop] Starting loop for Intent: ${intent.goal}`);

    for (const task of tasks) {
      console.log(`\n--- Next Task: ${task.id} ---`);

      // 1. Propose via AIDD
      // The worker that executes is the actor the authorization is issued to.
      const proposal = { ...(await aidd.createProposalForTask(intent, task)), actorId: 'ralph-worker' };

      // 2. Authorize via Governance
      const evalResult = this.govEngine.evaluate(proposal, intent);
      if (evalResult.denied) {
        console.error(`[Loop] Task ${task.id} denied by policy. Skipping.`);
        continue;
      }

      const auth = this.govEngine.authorize(proposal, 'principal-bob', evalResult.suggestedState);

      // 3. Execute in a fresh Worker session
      const worker = new RalphWorker();
      const wrapper = new UIGatesWrapper(worker, this.govEngine, this.receiptStore);

      // Simulate the execution loop until success
      let success = false;
      let attempts = 0;
      while (!success && attempts < 3) {
        attempts++;
        console.log(`  [Loop] Attempt ${attempts}...`);
        const result = await worker.executeAction(auth, proposal);

        if (result.success) {
          success = true;
          console.log(`  [Loop] Converged on success!`);

          // Record the receipt
          this.receiptStore.record({
            id: `rec_${task.id}_${Date.now()}`,
            authorizationId: auth.id,
            intentId: intent.id,
            actorId: 'ralph-worker',
            actionPerformed: proposal.action,
            expectedOutcome: proposal.verificationPlan,
            actualOutcome: result.actualOutcome,
            delta: result.delta,
            evidence: result.evidence,
            verifiedAt: new Date(),
          });
        } else {
          console.log(`  [Loop] Failed: ${result.actualOutcome}. Resetting context...`);
        }
      }

      if (!success) {
        console.error(`[Loop] Task ${task.id} failed to converge after ${attempts} attempts.`);
      }
    }

    console.log('\n[Ralph Loop] All tasks processed. Intent satisfied.');
  }
}
