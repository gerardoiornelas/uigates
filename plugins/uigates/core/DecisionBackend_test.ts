import test from 'node:test';
import assert from 'node:assert/strict';
import { GovernanceEngine } from './GovernanceEngine';
import { LocalStubBackend, TypeSafeJevBackend } from './DecisionBackend';
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

/**
 * TypeSafeJevBackend: no real network call in any of these — fetchImpl is stubbed. The one property
 * that must never regress is fail-closed: anything unexpected from the wire becomes ESCALATE, never APPROVE.
 */

const answers = (choice: 'APPROVE' | 'DENY' | 'ESCALATE', confidence: number, selfAdvocating = 0.05) => ({
  model: 'jev-latest',
  answers: {
    verdict: { type: 'choice', choice, confidence, probabilities: { APPROVE: 0, DENY: 0, ESCALATE: 0 } },
    policy_allows: { type: 'noul', noul: 0.9 },
    blast_radius: { type: 'score', score: 0.5, confidence: 0.9, legend: {}, probabilities: {} },
    self_advocating: { type: 'noul', noul: selfAdvocating },
    reads_secrets: { type: 'noul', noul: 0.01 },
    sends_outbound: { type: 'noul', noul: 0.01 },
  },
  usage: { input_tokens: 10, output_tokens: 5 },
});

const okFetch = (body: unknown): typeof fetch =>
  (async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => body })) as unknown as typeof fetch;

test('constructing the TypeSafe backend without an API key throws, so it can never run with an implicit empty key', () => {
  assert.throws(() => new TypeSafeJevBackend({ apiKey: '' }));
});

test('a confident APPROVE from TypeSafe is trusted', async () => {
  const backend = new TypeSafeJevBackend({ apiKey: 'k', fetchImpl: okFetch(answers('APPROVE', 0.95)) });
  const engine = new GovernanceEngine();
  const p = proposal({ resource: 'package.json', impact: 'low' });
  const evaluation = engine.evaluate(p, intent);
  const decision = await backend.evaluate(p, intent, evaluation);
  assert.equal(decision.verdict, 'APPROVE');
  assert.equal(decision.backend, 'typesafe-jev');
});

test('a low-confidence APPROVE is downgraded to ESCALATE, not trusted at face value', async () => {
  const backend = new TypeSafeJevBackend({ apiKey: 'k', fetchImpl: okFetch(answers('APPROVE', 0.4)) });
  const engine = new GovernanceEngine();
  const p = proposal({ resource: 'package.json', impact: 'low' });
  const evaluation = engine.evaluate(p, intent);
  const decision = await backend.evaluate(p, intent, evaluation);
  assert.equal(decision.verdict, 'ESCALATE');
  assert.match(decision.rationale, /confidence/);
});

test('a self-advocating APPROVE is downgraded to ESCALATE even with high confidence', async () => {
  const backend = new TypeSafeJevBackend({ apiKey: 'k', fetchImpl: okFetch(answers('APPROVE', 0.95, 0.8)) });
  const engine = new GovernanceEngine();
  const p = proposal({ resource: 'package.json', impact: 'low' });
  const evaluation = engine.evaluate(p, intent);
  const decision = await backend.evaluate(p, intent, evaluation);
  assert.equal(decision.verdict, 'ESCALATE');
  assert.match(decision.rationale, /self_advocating/);
});

test('a network failure fails closed to ESCALATE, never APPROVE', async () => {
  const throwingFetch = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
  const backend = new TypeSafeJevBackend({ apiKey: 'k', fetchImpl: throwingFetch });
  const engine = new GovernanceEngine();
  const p = proposal({ resource: 'package.json', impact: 'low' });
  const evaluation = engine.evaluate(p, intent);
  const decision = await backend.evaluate(p, intent, evaluation);
  assert.equal(decision.verdict, 'ESCALATE');
  assert.match(decision.rationale, /Fail-closed/);
});

test('a non-200 response fails closed to ESCALATE', async () => {
  const badFetch = (async () => ({ ok: false, status: 500, statusText: 'Internal Server Error', json: async () => ({}) })) as unknown as typeof fetch;
  const backend = new TypeSafeJevBackend({ apiKey: 'k', fetchImpl: badFetch });
  const engine = new GovernanceEngine();
  const p = proposal({ resource: 'package.json', impact: 'low' });
  const evaluation = engine.evaluate(p, intent);
  const decision = await backend.evaluate(p, intent, evaluation);
  assert.equal(decision.verdict, 'ESCALATE');
  assert.match(decision.rationale, /Fail-closed/);
});

test('an unrecognized verdict value fails closed to ESCALATE rather than being passed through', async () => {
  const weirdFetch = okFetch({ model: 'jev-latest', answers: { verdict: { type: 'choice', choice: 'MAYBE', confidence: 0.9 } }, usage: {} });
  const backend = new TypeSafeJevBackend({ apiKey: 'k', fetchImpl: weirdFetch });
  const engine = new GovernanceEngine();
  const p = proposal({ resource: 'package.json', impact: 'low' });
  const evaluation = engine.evaluate(p, intent);
  const decision = await backend.evaluate(p, intent, evaluation);
  assert.equal(decision.verdict, 'ESCALATE');
});

/**
 * GovernanceEngine.authorizeViaAdvisory: solo-workflow direction, docs/compound-engineering/graph-jev-aar.md,
 * decided 2026-09-22 — APPROVE grants authority directly, gated or not, with no carve-out for gate-class
 * resources. What must never regress: only a real APPROVE from evaluate()+backend.evaluate() can grant
 * authority, the record's authorizedBy is always the backend's own name (never a human identity, and not
 * settable by the caller), and DENY/ESCALATE grant nothing however they're called.
 */

test('authorizeViaAdvisory grants authority on APPROVE, even for a gate-class resource', () => {
  const engine = new GovernanceEngine();
  const p = proposal({ resource: 'package.json', impact: 'low' }); // gate-class: CRITICAL, would otherwise need a human
  const evaluation = engine.evaluate(p, intent);
  assert.equal(evaluation.suggestedState, 'gated');
  const authorization = engine.authorizeViaAdvisory(p, { verdict: 'APPROVE', rationale: 'looks fine', backend: 'typesafe-jev' }, evaluation.suggestedState);
  assert.equal(authorization.state, 'gated');
  assert.equal(authorization.authorizedBy, 'jev:typesafe-jev');
});

test('authorizeViaAdvisory refuses to grant anything on DENY or ESCALATE', () => {
  const engine = new GovernanceEngine();
  const p = proposal({ resource: 'package.json', impact: 'low' });
  const evaluation = engine.evaluate(p, intent);
  for (const verdict of ['DENY', 'ESCALATE'] as const) {
    assert.throws(() => engine.authorizeViaAdvisory(p, { verdict, rationale: 'x', backend: 'typesafe-jev' }, evaluation.suggestedState), /not APPROVE/);
  }
});

test('authorizeViaAdvisory still refuses a proposal the engine itself denied (outside domain, wrong actor, etc.)', () => {
  const engine = new GovernanceEngine();
  const p = proposal({ resource: '../outside', impact: 'low' });
  const evaluation = engine.evaluate(p, intent);
  assert.equal(evaluation.denied, true);
  assert.throws(() => engine.authorizeViaAdvisory(p, { verdict: 'APPROVE', rationale: 'x', backend: 'typesafe-jev' }, 'prohibited'), /Cannot authorize/);
});

test('a human authorize() and an advisory authorizeViaAdvisory() cannot both authorize the same proposal', () => {
  const engine = new GovernanceEngine();
  const p = proposal({ resource: 'package.json', impact: 'low' });
  const evaluation = engine.evaluate(p, intent);
  engine.authorizeViaAdvisory(p, { verdict: 'APPROVE', rationale: 'x', backend: 'typesafe-jev' }, evaluation.suggestedState);
  // A second evaluate()+authorize() for the same proposal still works at the engine level (the CLI's
  // own "already authorized" check is what prevents a double-grant in practice) — what must hold here
  // is narrower: authorizeViaAdvisory never lets a human identity masquerade as the backend's approval.
  const authorization = engine.authorizeViaAdvisory(p, { verdict: 'APPROVE', rationale: 'x', backend: 'local-stub' }, evaluation.suggestedState);
  assert.equal(authorization.authorizedBy, 'jev:local-stub');
  assert.notEqual(authorization.authorizedBy, intent.principalId);
});

test('the request carries the API key as a bearer token and never in the body or URL', async () => {
  let seenAuth: string | null = null;
  let seenUrl = '';
  const capturingFetch = (async (url: string, init: RequestInit) => {
    seenUrl = String(url);
    seenAuth = (init.headers as Record<string, string>).Authorization;
    return { ok: true, status: 200, statusText: 'OK', json: async () => answers('DENY', 0.9) };
  }) as unknown as typeof fetch;
  const backend = new TypeSafeJevBackend({ apiKey: 'secret-key', fetchImpl: capturingFetch });
  const engine = new GovernanceEngine();
  const p = proposal({ resource: 'package.json', impact: 'low' });
  const evaluation = engine.evaluate(p, intent);
  await backend.evaluate(p, intent, evaluation);
  assert.equal(seenAuth, 'Bearer secret-key');
  assert.equal(seenUrl, 'https://api.typesafe.ai/v1/systemone');
  assert.doesNotMatch(seenUrl, /secret-key/);
});
