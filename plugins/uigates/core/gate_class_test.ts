import test from 'node:test';
import assert from 'node:assert/strict';
import { GovernanceEngine } from './GovernanceEngine';
import { gateClassOf } from './GateClass';
import type { Intent, Proposal } from './types/primitives';

/**
 * The engine used to gate only package.json, settings.json and .env by name, so an agent that
 * declared a CI or deployment edit as low impact was told it could proceed. Gate-class resources
 * now need the principal whatever impact is declared, and the same list is what `uig audit` uses.
 *
 * Run: npx tsx --test plugins/uigates/core/gate_class_test.ts
 */

const intent: Intent = {
  id: 'i1', principalId: 'bob', goal: 'work', constraints: [], successEvidence: ['tests pass'],
  authorityDomain: ['/'], expiry: new Date(Date.now() + 3_600_000), createdAt: new Date(),
};

const decide = (resource: string, impact: Proposal['impact'] = 'low') => new GovernanceEngine().evaluate({
  id: `p-${Math.random().toString(36).slice(2)}`, intentId: intent.id, actorId: 'agent', action: 'edit', resource,
  rationale: 'needed', impact, risk: 'local', authorityRequested: 'delegated', verificationPlan: 'check', proposedAt: new Date(),
}, intent);

test('a low-impact edit to CI, deployment, dependency or secret files is gated, not delegated', () => {
  const gated = [
    '.gitlab-ci.yml', 'vae/.gitlab-ci.yml', '.github/workflows/test.yml',
    'Dockerfile', 'docker-compose.yml',
    'package.json', 'package-lock.json', 'requirements.txt', 'requirements-dev.txt', 'poetry.lock',
    'vae-vtt/backend/template.yaml', 'samconfig.toml', 'netlify.toml', 'infra/main.tf',
    '.env', '.env.production', 'config/prod.env', 'settings.json', '.claude/settings.local.json',
  ];
  for (const resource of gated) {
    const r = decide(resource);
    assert.equal(r.suggestedState, 'gated', `${resource}: ${r.rationale}`);
    assert.match(r.rationale, /CRITICAL/);
    assert.equal(r.denied, false);
  }
});

test('the rationale says why, so the principal knows what they are approving', () => {
  assert.match(decide('.gitlab-ci.yml').rationale, /CI configuration/);
  assert.match(decide('package.json').rationale, /dependencies/);
});

test('a directory that would hold gate-class files is gated too', () => {
  assert.equal(decide('.github/workflows').suggestedState, 'gated');
  assert.equal(decide('.github/workflows/').suggestedState, 'gated');
});

test('the resource is judged where it resolves, not by its text', () => {
  assert.equal(decide('src/../.gitlab-ci.yml').suggestedState, 'gated');
  assert.equal(decide('src\\..\\package.json').suggestedState, 'gated');
});

test('ordinary source, docs and look-alike names stay delegated', () => {
  for (const resource of ['src/a.js', 'docs/ci.md', 'scripts/validate.py', 'src/package.json.md', 'my-package.jsonx', 'environment.ts', 'notes/dockerfile-tips.md']) {
    const r = decide(resource);
    assert.equal(r.suggestedState, 'delegated', `${resource}: ${r.rationale}`);
  }
});

test('gate-class stays gated at every declared impact, and cannot be talked down to delegated', () => {
  for (const impact of ['low', 'medium', 'high'] as const) assert.equal(decide('.gitlab-ci.yml', impact).suggestedState, 'gated');
});

test('a project-wide resource names no file, so the engine cannot gate it: the audit is what catches that', () => {
  assert.equal(decide('.').suggestedState, 'delegated', 'known limit; see docs/mvp.md');
  assert.equal(gateClassOf('.'), null);
});
