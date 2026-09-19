import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { StateStore } from './StateStore';
import { GovernanceEngine } from './GovernanceEngine';
import { ReceiptStore } from './ReceiptStore';
import { LoopDriver } from '../intelligence/loop/driver';
import { CESynthesizer, loadKnowledge } from '../intelligence/ce/synthesizer';
import { IntelligenceEngine } from './UIGatesWrapper';
import { Intent, Proposal } from './types/primitives';

/** A real filesystem smoke test, not a coding-agent learning benchmark. */
async function runFullCycle() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uig-cycle-'));
  const state = new StateStore(root), receipts = new ReceiptStore();
  const gov = new GovernanceEngine([], undefined, receipts);
  const intent: Intent = { id:'demo',principalId:'demo-principal',goal:'Write and verify a local note',constraints:['temporary directory only'],successEvidence:['read-back comparison'],authorityDomain:['notes.txt'],expiry:new Date(Date.now()+60000),createdAt:new Date() };
  state.saveIntent(intent);
  const proposal: Proposal = {id:'demo-proposal',intentId:'demo',actorId:'demo-worker',action:'Write and verify a local note',resource:'notes.txt',rationale:'Demonstrate actual verified I/O',impact:'low',risk:'temporary local file',authorityRequested:'delegated',verificationPlan:'Read back notes.txt and compare exact content',proposedAt:new Date()};
  const worker: IntelligenceEngine = {
    async proposeAction() { return proposal; },
    async executeAction() {
      const expected='UI-GATES real execution\n';fs.writeFileSync(path.join(root,'notes.txt'),expected);
      const ok=fs.readFileSync(path.join(root,'notes.txt'),'utf8')===expected;
      const proof=JSON.stringify({check:'read-back',passed:ok});fs.writeFileSync(path.join(root,'proof.json'),proof);
      return {success:ok,actualOutcome:ok?'Verified success GOAL_REACHED':'Failed read-back',delta:ok?'None':'Content mismatch',evidence:['sha256:'+crypto.createHash('sha256').update(proof).digest('hex')+':proof.json']};
    },
    async learnFromReceipt(r) { state.saveReceipt(r); },
  };
  await new LoopDriver(state,gov,receipts,worker).run(intent.id);
  await new CESynthesizer(receipts,root,gov.ledger).synthesize(intent.id);
  if(loadKnowledge(root).length!==1)throw Error('Verified receipt did not synthesize');
  console.log('Real I/O, verification, receipt and synthesis completed. Evidence: '+root);
}
runFullCycle().catch(error=>{console.error(error);process.exitCode=1;});
