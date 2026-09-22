import test from 'node:test';
import assert from 'node:assert/strict';
import { GovernanceEngine } from './GovernanceEngine';
import { LocalStubBackend } from './DecisionBackend';
import type { Intent, Proposal } from './types/primitives';

/**
 * Spike for docs/compound-engineering/graph-jev-aar.md: the DecisionBackend interface is advisory
 * only. These tests pin the one property that must never regress — the stub never turns a denial
 * or a gate into an APPROVE on its own — since a real backend (e.g. jev-approvals) will be judged
 * against this baseline.
 *
 * Run: npx tsx --test plugins/uigates/core/DecisionBackend_test.ts
 */

const intent: Intent = {
  id: 'i1', principalId: 'bob', goal: 'work', constraints: [], successEvidence: ['tests pass'],
  authorityDomain: ['/'], expiry: new Date(Date.now() + 3_600_000), createdAt: new Date(),
};

const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  id: 'p1', intentId: intent.id, actorId: 'agent', action: 'edit', resource: 'src/a.ts',
  rationale: 'needed', impact: 'low', risk: 'local', authorityRequested: 'delegated', verificationPlan: 'check',
  proposedAt: new Date(), ...over,
});

test('a delegated proposal advises APPROVE, with no new authority granted by the advisory itself', () => {
  const engine = new GovernanceEngine();
  const p = proposal({ resource: 'src/a.ts', impact: 'low' });
  const evaluation = engine.evaluate(p, intent);
  assert.equal(evaluation.suggestedState, 'delegated');
  const decision = new LocalStubBackend().evaluate(p, intent, evaluation);
  assert.equal(decision.verdict, 'APPROVE');
  assert.equal(decision.backend, 'local-stub');
});

test('a gated proposal is never auto-approved by the stub; it escalates', () => {
  const engine = new GovernanceEngine();
  const p = proposal({ resource: 'package.json', impact: 'low' }); // gate-class resource
  const evaluation = engine.evaluate(p, intent);
  assert.equal(evaluation.suggestedState, 'gated');
  const decision = new LocalStubBackend().evaluate(p, intent, evaluation);
  assert.equal(decision.verdict, 'ESCALATE');
  assert.match(decision.rationale, /no real judgment/);
});

test('a denied proposal advises DENY, carrying the engine\'s own rationale', () => {
  const engine = new GovernanceEngine();
  const p = proposal({ resource: '../outside', impact: 'low' });
  const evaluation = engine.evaluate(p, intent);
  assert.equal(evaluation.denied, true);
  const decision = new LocalStubBackend().evaluate(p, intent, evaluation);
  assert.equal(decision.verdict, 'DENY');
  assert.equal(decision.rationale, evaluation.rationale);
});
