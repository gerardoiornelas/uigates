import { GovernanceEngine } from './GovernanceEngine';
import { Intent, Proposal } from './types/primitives';

async function testCriticalResourceProtection() {
  console.log('--- Testing Critical Resource Protection ---');

  const govEngine = new GovernanceEngine();
  const intent: Intent = {
    id: 'test-intent',
    principalId: 'bob',
    goal: 'Update project',
    constraints: [],
    successEvidence: [],
    authorityDomain: ['/'],
    expiry: new Date(Date.now() + 3600000),
    createdAt: new Date(),
  };

  // Scenario: Agent tries to "sneak" a change to package.json as "low impact"
  const sneakyProposal: Proposal = {
    id: 'prop-sneaky',
    intentId: intent.id,
    actorId: 'agent-001',
    action: 'Update a dependency',
    resource: 'package.json',
    rationale: 'Minor version bump',
    impact: 'low',
    risk: 'Low',
    authorityRequested: 'delegated',
    verificationPlan: 'npm install',
    proposedAt: new Date(),
  };

  const result = govEngine.evaluate(sneakyProposal, intent);

  console.log(`Action: ${sneakyProposal.action}`);
  console.log(`Resource: ${sneakyProposal.resource}`);
  console.log(`Requested: ${sneakyProposal.impact} impact`);
  console.log(`Resulting State: ${result.suggestedState}`);
  console.log(`Rationale: ${result.rationale}`);

  if (result.suggestedState === 'gated') {
    console.log('\nVERDICT: SUCCESS ✅ - package.json was correctly escalated to GATED.');
  } else {
    console.log('\nVERDICT: FAILURE ❌ - package.json was not protected.');
    process.exit(1);
  }
}

testCriticalResourceProtection();
