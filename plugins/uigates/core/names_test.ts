import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { GovernanceEngine } from './GovernanceEngine';
import { StateStore } from './StateStore';
import { ReceiptStore } from './ReceiptStore';
import { AUDIT_RECORD_PATH, envSetting, hasBothStateDirs, ROOT_STATE_PATH, STATE_PATH, stateDir, stateDirName } from './names';
import { CESynthesizer, loadKnowledge } from '../intelligence/ce/synthesizer';
import type { Intent, Proposal, Receipt } from './types/primitives';

/**
 * The project has one name, `uigates`. The state directory is `.uigates/`, but a project that already
 * has `.uig/` keeps using it: a receipt's evidence reference embeds the path, so moving the records
 * would break every hash. Both names are always protected, and the `UIG_*` variables still work.
 *
 * Run: npx tsx --test plugins/uigates/core/names_test.ts
 */

const project = (t: any, ...dirs: string[]) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uigates-names-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const d of dirs) fs.mkdirSync(path.join(root, d), { recursive: true });
  return root;
};

// --- which directory a project uses ---

test('a new project uses .uigates', t => {
  const root = project(t);
  assert.equal(stateDirName(root), '.uigates');
  assert.equal(stateDir(root), path.join(root, '.uigates'));
});

test('an older project that has .uig keeps using it', t => {
  const root = project(t, '.uig');
  assert.equal(stateDirName(root), '.uig');
  assert.equal(stateDir(root), path.join(root, '.uig'));
});

test('a project that has .uigates uses it', t => {
  assert.equal(stateDirName(project(t, '.uigates')), '.uigates');
});

test('with both, .uigates wins and the ambiguity is reported', t => {
  const root = project(t, '.uig', '.uigates');
  assert.equal(stateDirName(root), '.uigates');
  assert.equal(hasBothStateDirs(root), true);
  assert.equal(hasBothStateDirs(project(t, '.uig')), false);
  assert.equal(hasBothStateDirs(project(t, '.uigates')), false);
  assert.equal(hasBothStateDirs(project(t)), false);
});

test('a plain file named .uig is not a state directory', t => {
  const root = project(t);
  fs.writeFileSync(path.join(root, '.uig'), 'not a directory');
  assert.equal(stateDirName(root), '.uigates');
});

// --- the protected-path patterns cover both names, and only whole segments ---

test('state paths: either name, as a whole segment, at any depth', () => {
  for (const p of ['.uigates', '.uig', '.uigates/receipts/r.json', '.uig/receipts/r.json', 'a/.uigates/x', 'a/b/.uig/x'])
    assert.equal(STATE_PATH.test(p), true, p);
  for (const p of ['src/uigates/x', 'uig/x', 'my.uig/x', 'my.uigates/x', '.uigates-learning/x', '.uig-learning/x', '.uiggy/x', 'src/.uigatesx'])
    assert.equal(STATE_PATH.test(p), false, p);
});

test('audit records: the four record directories under either name, and not knowledge or evidence', () => {
  for (const dir of ['.uigates', '.uig'])
    for (const sub of ['intents', 'proposals', 'authorizations', 'receipts'])
      assert.equal(AUDIT_RECORD_PATH.test(`${dir}/${sub}/x.json`), true, `${dir}/${sub}`);
  for (const p of ['.uigates/knowledge/x.md', '.uig/evidence/x.log', '.uigates/enforce', 'src/receipts/x.json'])
    assert.equal(AUDIT_RECORD_PATH.test(p), false, p);
});

test('root state paths, for filtering a change list: only at the project root', () => {
  for (const p of ['.uigates/x', '.uig/x', '.uigates', '.uig']) assert.equal(ROOT_STATE_PATH.test(p), true, p);
  for (const p of ['a/.uigates/x', 'src/.uig/x', '.uigates-learning/x', 'uig/x']) assert.equal(ROOT_STATE_PATH.test(p), false, p);
});

// --- the engine protects both ---

const intent = (over: Partial<Intent> = {}): Intent => ({
  id: 'i1', principalId: 'bob', goal: 'work', constraints: [], successEvidence: ['tests pass'],
  authorityDomain: ['/'], expiry: new Date(Date.now() + 3_600_000), createdAt: new Date(), ...over,
});
const proposal = (resource: string): Proposal => ({
  id: `p-${Math.random().toString(36).slice(2)}`, intentId: 'i1', actorId: 'agent', action: 'edit', resource,
  rationale: 'needed', impact: 'low', risk: 'local', authorityRequested: 'delegated', verificationPlan: 'check', proposedAt: new Date(),
});

test('the engine denies edits to authority records under either directory name, even by path tricks', () => {
  const gov = new GovernanceEngine();
  for (const dir of ['.uigates', '.uig']) {
    for (const p of [`${dir}/receipts/r.json`, `${dir}/authorizations/a.json`, `${dir}/intents/i.json`, `${dir}/proposals/p.json`, `src/../${dir}/receipts/r.json`, `./${dir}/receipts/r.json`]) {
      const r = gov.evaluate(proposal(p), intent());
      assert.equal(r.denied, true, p);
      assert.equal(r.denial, 'protected-record', p);
    }
  }
});

test('the engine gates hand-edits to knowledge under either directory name', () => {
  const gov = new GovernanceEngine();
  for (const p of ['.uigates/knowledge/compound_packs/x.md', '.uig/knowledge/compound_packs/x.md']) {
    const r = gov.evaluate(proposal(p), intent());
    assert.equal(r.denied, false, p);
    assert.equal(r.suggestedState, 'gated', p);
  }
});

test('control: an ordinary file, and a lookalike name, are still delegated', () => {
  const gov = new GovernanceEngine();
  for (const p of ['src/app.ts', 'src/uigates/notes.md', '.uigates-learning/x.json']) {
    assert.equal(gov.evaluate(proposal(p), intent()).suggestedState, 'delegated', p);
  }
});

// --- the store and the synthesizer write where the project keeps its records ---

test('the state store writes to .uigates in a new project and .uig in an older one, and never creates the other', t => {
  const fresh = project(t);
  new StateStore(fresh);
  assert.ok(fs.existsSync(path.join(fresh, '.uigates/intents')));
  assert.equal(fs.existsSync(path.join(fresh, '.uig')), false);

  const older = project(t, '.uig');
  new StateStore(older).saveIntent(intent({ id: 'i9' }));
  assert.ok(fs.existsSync(path.join(older, '.uig/intents/i9.json')));
  assert.equal(fs.existsSync(path.join(older, '.uigates')), false);
});

const receipt = (): Receipt => ({
  id: 'rec1', authorizationId: 'auth1', intentId: 'intent1', actorId: 'agent', actionPerformed: 'use transactions',
  expectedOutcome: 'run tests', actualOutcome: 'Verified success', delta: 'None', evidence: ['sha256:x:log.txt'], verifiedAt: new Date(),
  lesson: 'wrap the writes in one transaction so a failure rolls the whole change back',
});

test('knowledge packs are written and read under the directory the project uses', async t => {
  for (const [dirs, expected, other] of [[[], '.uigates', '.uig'], [['.uig'], '.uig', '.uigates']] as const) {
    const root = project(t, ...dirs);
    const store = new ReceiptStore(true);
    const synth = new CESynthesizer(store, root, 'unverified', { evidenceVerifier: () => true });
    store.record(receipt());
    await synth.synthesize('intent1');
    assert.equal(loadKnowledge(root).length, 1, expected);
    assert.ok(fs.readdirSync(path.join(root, expected, 'knowledge/compound_packs')).length === 1, expected);
    assert.ok(fs.existsSync(path.join(root, expected, 'knowledge/pack_state')), expected);
    assert.equal(fs.existsSync(path.join(root, other)), false, `${other} must not be created`);
  }
});

// --- settings ---

test('UIGATES_ names win, and the older UIG_ names still work', () => {
  assert.equal(envSetting('PRINCIPAL', { UIGATES_PRINCIPAL: 'new' }), 'new');
  assert.equal(envSetting('PRINCIPAL', { UIG_PRINCIPAL: 'old' }), 'old');
  assert.equal(envSetting('PRINCIPAL', { UIGATES_PRINCIPAL: 'new', UIG_PRINCIPAL: 'old' }), 'new');
  assert.equal(envSetting('PRINCIPAL', {}), undefined);
});

test('an empty setting counts as unset, so it cannot hide the older name', () => {
  assert.equal(envSetting('PRINCIPAL', { UIGATES_PRINCIPAL: '', UIG_PRINCIPAL: 'old' }), 'old');
  assert.equal(envSetting('PRINCIPAL', { UIGATES_PRINCIPAL: '', UIG_PRINCIPAL: '' }), undefined);
});

test('settings are read by suffix, so each variable has both spellings', () => {
  for (const name of ['ROOT', 'ENFORCE', 'CODEX']) {
    assert.equal(envSetting(name, { [`UIGATES_${name}`]: 'a' }), 'a', name);
    assert.equal(envSetting(name, { [`UIG_${name}`]: 'b' }), 'b', name);
  }
});
