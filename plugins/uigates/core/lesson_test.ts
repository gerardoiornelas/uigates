import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ReceiptStore } from './ReceiptStore';
import { CESynthesizer, lessonProblem, loadKnowledge } from '../intelligence/ce/synthesizer';
import type { Receipt } from './types/primitives';

/**
 * A verified receipt used to become a lesson named after whatever action the agent chose, so the
 * first trial's ledger filled with "delete the temporary harness". A receipt can now state what the
 * next agent should know; the CLI promotes only receipts that do (`requireLesson`), and the library
 * keeps the old behaviour unless asked. The CLI side is covered in cli/cli_test.ts.
 *
 * Run: npx tsx --test plugins/uigates/core/lesson_test.ts
 */

const ACTION = 'use transactions';
const PLAN = 'run tests';
const ADVICE = 'wrap the writes in one transaction so a failure rolls the whole change back';

let n = 0;
const receipt = (over: Partial<Receipt> = {}): Receipt => {
  const k = ++n;
  return {
    id: `rec${k}`, authorizationId: `auth${k}`, intentId: `intent${k}`, actorId: 'agent', actionPerformed: ACTION,
    expectedOutcome: PLAN, actualOutcome: 'Verified success', delta: 'None', evidence: ['sha256:x:log.txt'],
    // Strictly increasing, so the most recent receipt decides a pack's status.
    verifiedAt: new Date(Date.now() + k * 1000), ...over,
  };
};

function world(t: any, requireLesson?: boolean) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uig-lesson-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new ReceiptStore(true);
  const synth = new CESynthesizer(store, root, 'unverified', { evidenceVerifier: () => true, ...(requireLesson === undefined ? {} : { requireLesson }) });
  const ingest = async (r: Receipt) => { store.record(r); await synth.synthesize(r.intentId); };
  return { root, store, synth, ingest, packs: () => loadKnowledge(root) };
}

// --- the library default is unchanged ---

test('by default a verified receipt is promoted with no lesson, as before', async t => {
  const w = world(t);
  await w.ingest(receipt());
  assert.equal(w.packs().length, 1);
  assert.deepEqual(w.packs()[0].lessons, []);
  assert.deepEqual(w.synth.getUnpromoted(), []);
  const md = fs.readFileSync(path.join(w.root, '.uig/knowledge/compound_packs', w.packs()[0].file), 'utf8');
  assert.match(md, /_None stated: this pack records that the action was verified, not what it teaches\._/);
});

test('by default a stated lesson is still recorded on the pack', async t => {
  const w = world(t);
  await w.ingest(receipt({ lesson: ADVICE }));
  assert.deepEqual(w.packs()[0].lessons, [ADVICE]);
});

// --- requireLesson ---

test('with requireLesson, a receipt with no lesson is not promoted and is listed', async t => {
  const w = world(t, true);
  const bare = receipt();
  await w.ingest(bare);
  assert.equal(w.packs().length, 0);
  assert.deepEqual(w.synth.getUnpromoted(), [{ receiptId: bare.id, action: ACTION }]);
});

test('with requireLesson, a whitespace-only lesson counts as none', async t => {
  const w = world(t, true);
  await w.ingest(receipt({ lesson: '   \n\t ' }));
  assert.equal(w.packs().length, 0);
  assert.equal(w.synth.getUnpromoted().length, 1);
});

test('with requireLesson, a receipt that states a lesson is promoted with it and is not listed', async t => {
  const w = world(t, true);
  await w.ingest(receipt({ lesson: ADVICE }));
  assert.equal(w.packs().length, 1);
  assert.deepEqual(w.packs()[0].lessons, [ADVICE]);
  assert.deepEqual(w.synth.getUnpromoted(), []);
});

test('with requireLesson, a failure still contradicts a lesson even though it states none', async t => {
  const w = world(t, true);
  await w.ingest(receipt({ lesson: ADVICE }));
  await w.ingest(receipt({ actualOutcome: 'Failed: the verification command exited with code 3', delta: 'exit code 3' }));
  assert.equal(w.packs()[0].status, 'conflicted');
  assert.deepEqual(w.synth.getUnpromoted(), [], 'a failure is not an unpromoted success');
});

test('with requireLesson, only the unpromoted receipt is listed when two are recorded', async t => {
  const w = world(t, true);
  const bare = receipt({ actionPerformed: 'tidy up' });
  await w.ingest(bare);
  await w.ingest(receipt({ lesson: ADVICE }));
  assert.equal(w.packs().length, 1);
  assert.equal(w.packs()[0].action, ACTION);
  assert.deepEqual(w.synth.getUnpromoted(), [{ receiptId: bare.id, action: 'tidy up' }]);
});

// --- how lessons accumulate on a pack ---

test('a repeated lesson in the middle of a run is not stored again and does not push out a newer one', async t => {
  const w = world(t);
  for (const lesson of ['lesson one advice', 'lesson two advice', 'lesson three advice', 'lesson two advice', 'lesson four advice'])
    await w.ingest(receipt({ lesson }));
  assert.deepEqual(w.packs()[0].lessons, ['lesson two advice', 'lesson three advice', 'lesson four advice']);
});

test('lessons are kept in the order they arrived and are capped at three', async t => {
  const w = world(t);
  for (const lesson of ['lesson one advice', 'lesson two advice', 'lesson three advice', 'lesson four advice']) await w.ingest(receipt({ lesson }));
  assert.deepEqual(w.packs()[0].lessons, ['lesson two advice', 'lesson three advice', 'lesson four advice']);
});

test('the same lesson from another intent is not stored twice', async t => {
  const w = world(t);
  await w.ingest(receipt({ lesson: ADVICE }));
  await w.ingest(receipt({ lesson: ADVICE }));
  assert.deepEqual(w.packs()[0].lessons, [ADVICE]);
  assert.equal(w.packs()[0].intents.length, 2, 'but both intents still count as reuse');
});

test('the pack text stores a lesson on one line and labels it as a claim', async t => {
  const w = world(t);
  await w.ingest(receipt({ lesson: '# Heading\n\n## Another\nwrap the writes in one transaction' }));
  const md = fs.readFileSync(path.join(w.root, '.uig/knowledge/compound_packs', w.packs()[0].file), 'utf8');
  assert.ok(md.split('\n').includes('- Heading ## Another wrap the writes in one transaction'));
  assert.match(md, /Stated by the agent that did the work\. The receipt proves the action succeeded; it does not prove this advice is right\./);
});

test('a pack written before lessons existed still loads and accepts one', async t => {
  const w = world(t);
  await w.ingest(receipt());
  const file = w.packs()[0].file;
  const stateFile = path.join(w.root, '.uig/knowledge/pack_state', `${file}.json`);
  const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  delete saved.state.lessons; // markdown is untouched, so its hash still matches
  fs.writeFileSync(stateFile, JSON.stringify(saved));

  assert.equal(w.packs().length, 1, 'still trusted');
  assert.deepEqual(w.packs()[0].lessons, []);
  await w.ingest(receipt({ lesson: ADVICE }));
  assert.deepEqual(w.packs()[0].lessons, [ADVICE]);
});

// --- lessonProblem ---

const problem = (lesson: string, action = ACTION, plan = PLAN) => lessonProblem(lesson, action, plan);

test('advice that says something the title does not is accepted', () => {
  assert.equal(problem(ADVICE), null);
});

test('text under 20 characters is refused, and 20 is enough', () => {
  assert.match(problem('a'.repeat(19))!, /at least 20 characters/);
  assert.equal(problem('a'.repeat(20)), null);
  assert.match(problem('!!! ??? ...')!, /at least 20 characters/, 'punctuation carries no advice');
});

test('placeholders are refused, but a word that only starts like one is not', () => {
  for (const text of ['TODO: fill this in later', 'tbd, decide what to write', 'None of note here today', 'N/A, nothing to add here', 'na na na na na na na', 'nothing worth adding today', 'see above for the details', 'as above, the same again'])
    assert.match(problem(text)!, /placeholder/, text);
  assert.equal(problem('Nonexistent tables need a guard clause'), null);
  assert.equal(problem('Navigate to the table before you write to it'), null);
});

test('text over 500 characters is refused, and 500 is enough', () => {
  assert.equal(problem('a'.repeat(500)), null);
  assert.match(problem('a'.repeat(501))!, /at most 500 characters/);
  assert.equal(problem(`${'a'.repeat(10)}${' '.repeat(600)}${'b'.repeat(10)}`), null, 'a run of whitespace is counted as one character');
});

test('a lesson that only restates the action is refused, however it is cased or punctuated', () => {
  const action = 'Wrap every Export write in a single Database transaction.';
  for (const text of ['wrap every export write in a single database transaction', 'WRAP  every export write in a single   database transaction!!', 'wrap every export write in a single database'])
    assert.match(problem(text, action)!, /only restates the action/, text);
});

test('a lesson that only restates the verification plan is refused, however it is cased or punctuated', () => {
  const plan = 'Run the Export tests, and check the row counts match!';
  for (const text of ['run the export tests and check the row counts match', 'RUN the export tests, and check the row counts.', 'check the row counts match'])
    assert.match(problem(text, ACTION, plan)!, /only restates the verification plan/, text);
});

test('a lesson that contains the action but says more is accepted', () => {
  const action = 'wrap every export write in a single database transaction';
  assert.equal(problem(`${action}, and batch the inserts in groups of 500`, action), null);
});
