import test from 'node:test';
import assert from 'node:assert/strict';
import { GovernanceEngine } from './GovernanceEngine';
import type { Intent, Proposal } from './types/primitives';

/**
 * Every denial used to carry the state `prohibited`, the state the architecture reserves for what
 * can never be authorized. In the first trial an agent's out-of-domain scratch path was denied that
 * way and it could not tell a scope problem from a hard prohibition. The state is unchanged (existing
 * tests rely on it); each denial now also says what kind it is.
 *
 * Run: npx tsx --test plugins/uigates/core/denial_kinds_test.ts
 */

const intent = (over: Partial<Intent> = {}): Intent => ({
  id: 'i1', principalId: 'bob', goal: 'work', constraints: [], successEvidence: ['tests pass'],
  authorityDomain: ['src/'], expiry: new Date(Date.now() + 3_600_000), createdAt: new Date(), ...over,
});

const proposal = (resource: string, over: Partial<Proposal> = {}): Proposal => ({
  id: `p-${Math.random().toString(36).slice(2)}`, intentId: 'i1', actorId: 'agent', action: 'edit', resource,
  rationale: 'needed', impact: 'low', risk: 'local', authorityRequested: 'delegated', verificationPlan: 'check', proposedAt: new Date(), ...over,
});

const decide = (p: Proposal, i: Intent = intent()) => new GovernanceEngine().evaluate(p, i);

test('outside the domain is an outside-domain denial, and it can be fixed', () => {
  const r = decide(proposal('docs/readme.md'));
  assert.equal(r.denied, true);
  assert.equal(r.denial, 'outside-domain');
  assert.match(r.rationale, /outside the authorized domain/);
});

test('an absolute or escaping path says it can never be inside a domain', () => {
  for (const resource of ['/private/tmp/scratch/verify.py', '../elsewhere/x.js', 'src/../../etc/hosts', 'C:/temp/x.js']) {
    const r = decide(proposal(resource), intent({ authorityDomain: ['/'] }));
    assert.equal(r.denial, 'outside-domain', resource);
    assert.match(r.rationale, /not a project-relative path/, resource);
  }
});

test('each denial reason has its own kind', () => {
  assert.equal(decide(proposal('src/a.js'), intent({ expiry: new Date(Date.now() - 1000) })).denial, 'expired');
  assert.equal(decide(proposal('src/a.js'), intent({ authorizedActors: ['someone-else'] })).denial, 'wrong-actor');
  assert.equal(decide(proposal('src/a.js', { intentId: 'other' })).denial, 'wrong-intent');
  assert.equal(decide(proposal('.uig/receipts/x.json'), intent({ authorityDomain: ['/'] })).denial, 'protected-record');
});

test('an allowed proposal carries no denial kind', () => {
  const r = decide(proposal('src/a.js'));
  assert.equal(r.denied, false);
  assert.equal(r.denial, undefined);
});

test('the state stays prohibited for every denial, so existing callers are unaffected', () => {
  for (const r of [decide(proposal('docs/x.md')), decide(proposal('src/a.js'), intent({ expiry: new Date(Date.now() - 1000) }))]) {
    assert.equal(r.suggestedState, 'prohibited');
  }
});
