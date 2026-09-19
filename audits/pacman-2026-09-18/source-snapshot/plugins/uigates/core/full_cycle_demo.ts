import { StateStore } from './StateStore';
import { GovernanceEngine } from './GovernanceEngine';
import { ReceiptStore } from './ReceiptStore';
import { LoopDriver } from '../intelligence/loop/driver';
import { CESynthesizer } from '../intelligence/ce/synthesizer';
import { Intent } from './types/primitives';

async function runFullCycle() {
  console.log('=== UI-GATES: FULL AGENTIC CYCLE DEMO ===\n');

  const store = new StateStore();
  const govEngine = new GovernanceEngine();
  const receiptStore = new ReceiptStore();

  // 1. Establish Intent
  const myIntent: Intent = {
    id: 'intent-full-cycle',
    principalId: 'principal-bob',
    goal: 'Implement secure session handling',
    constraints: ['No plain-text cookies', 'Refresh tokens required'],
    successEvidence: ['Passes OWASP scan', 'Unit tests pass'],
    authorityDomain: ['src/'],
    expiry: new Date(Date.now() + 86400000),
    createdAt: new Date(),
  };
  store.saveIntent(myIntent);
  console.log(`[1] Intent established: ${myIntent.goal}`);

  // 2. Run the Intelligence Loop (AIDD + Ralph Loop)
  const driver = new LoopDriver(store, govEngine, receiptStore);
  await driver.run(myIntent.id);
  console.log(`\n[2] Intelligence loop completed.`);

  // 3. Synthesize Knowledge (Compound Engineering)
  const synthesizer = new CESynthesizer(receiptStore, process.cwd(), govEngine.ledger);
  await synthesizer.synthesize(myIntent.id);
  console.log(`\n[3] Knowledge synthesized into Compound Packs.`);

  console.log('\n=== CYCLE COMPLETE ===');
  console.log('Check .uig/ for the full audit trail and knowledge base.');
}

runFullCycle().catch(console.error);
