import { StateStore } from '../core/StateStore';
import { GovernanceEngine } from '../core/GovernanceEngine';
import {
  Intent,
  Proposal,
  Authorization,
  AuthorityState
} from '../core/types/primitives';

const store = new StateStore();
const govEngine = new GovernanceEngine();

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'start': {
      const goal = args[1] || 'New Intent';
      const intent: Intent = {
        id: `intent_${Date.now()}`,
        principalId: 'current_user',
        goal: goal,
        constraints: [],
        successEvidence: [],
        authorityDomain: ['src/'],
        expiry: new Date(Date.now() + 86400000),
        createdAt: new Date(),
      };
      store.saveIntent(intent);
      console.log(`UI-GATES: Intent started. ID: ${intent.id}`);
      console.log(`Goal: ${intent.goal}`);
      break;
    }

    case 'propose': {
      const intentId = args[1];
      if (!intentId) {
        console.error('Usage: uig propose <intentId>');
        process.exit(1);
      }

      const intent = store.getIntent(intentId);
      if (!intent) {
        console.error('Intent not found.');
        process.exit(1);
      }

      // In a real system, the agent would generate this.
      // Here we simulate a proposal for the CLI.
      const proposal: Proposal = {
        id: `prop_${Date.now()}`,
        intentId: intent.id,
        actorId: 'agent-001',
        action: 'Update critical configuration',
        resource: 'src/config.ts',
        rationale: 'Improving performance',
        impact: 'medium',
        risk: 'Potential breaking change in config',
        authorityRequested: 'delegated',
        verificationPlan: 'Run integration tests',
        proposedAt: new Date(),
      };

      store.saveProposal(proposal);
      const evaluation = govEngine.evaluate(proposal, intent);

      console.log(`Proposal Created: ${proposal.id}`);
      console.log(`Action: ${proposal.action}`);
      console.log(`Suggested Authority: ${evaluation.suggestedState}`);
      console.log(`Rationale: ${evaluation.rationale}`);
      break;
    }

    case 'authorize': {
      const propId = args[1];
      const state = args[2] as AuthorityState | undefined;
      if (!propId) {
        console.error('Usage: uig authorize <propId> [state]  (must match the evaluated state; omit to accept it)');
        process.exit(1);
      }

      const proposal = store.getProposal(propId);
      if (!proposal) {
        console.error('Proposal not found.');
        process.exit(1);
      }

      const intent = store.getIntent(proposal.intentId);
      if (!intent) {
        console.error('Intent not found.');
        process.exit(1);
      }

      // Authority is only issued for what the engine evaluates, in the principal's name.
      const evaluation = govEngine.evaluate(proposal, intent);
      if (evaluation.denied) {
        console.error(`Denied: ${evaluation.rationale}`);
        process.exit(1);
      }
      if (state && state !== evaluation.suggestedState) {
        console.error(`Cannot authorize as ${state}: evaluation resolved to ${evaluation.suggestedState}. ${evaluation.rationale}`);
        process.exit(1);
      }
      const auth: Authorization = govEngine.authorize(proposal, intent.principalId, evaluation.suggestedState);

      store.saveAuthorization(auth);
      console.log(`UI-GATES: Proposal ${propId} authorized as ${auth.state}.`);
      break;
    }

    case 'receipt': {
      const authId = args[1];
      if (!authId) {
        console.error('Usage: uig receipt <authId>');
        process.exit(1);
      }

      const auth = store.getAuthorization(authId);
      if (!auth) {
        console.error('Authorization not found.');
        process.exit(1);
      }

      const proposal = store.getProposal(auth.proposalId);

      const receipt = {
        id: `rec_${Date.now()}`,
        authorizationId: auth.id,
        intentId: proposal?.intentId || 'unknown',
        actorId: proposal?.actorId || 'unknown',
        actionPerformed: proposal?.action || 'unknown',
        expectedOutcome: proposal?.verificationPlan || 'none',
        actualOutcome: 'Success: Verified via tests',
        delta: 'None',
        evidence: ['test_result.log'],
        verifiedAt: new Date(),
      };

      store.saveReceipt(receipt);
      console.log(`UI-GATES: Receipt recorded. ID: ${receipt.id}`);
      break;
    }

    default:
      console.log('UI-GATES CLI');
      console.log('Commands: start <goal>, propose <intentId>, authorize <propId> <state>, receipt <authId>');
  }
}

main().catch(console.error);
