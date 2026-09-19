import fs from 'node:fs';
import path from 'node:path';
import { EvidenceStore } from '../../plugins/uigates/learning/evidence.mjs';
import { LearningMemory } from '../../plugins/uigates/learning/memory.mjs';
import { accountModel, runPlan } from '../../plugins/uigates/learning/runner.mjs';

const oldDir = path.resolve('evaluations/real-project-v1/store');
const newDir = path.resolve('evaluations/real-project-v1/store-complete');
const dryRun = process.argv.includes('--dry-run');
const newStore = new EvidenceStore(newDir);
const memory = new LearningMemory(newStore);
const oldStore = new EvidenceStore(oldDir);
const planId = 'workboard-v1-complete';
const planExists = newStore.has('plans', planId);
let newPlan;
if (!planExists) {
  fs.cpSync(path.join(oldDir, 'blobs'), path.join(newDir, 'blobs'), { recursive: true });
  for (const id of ['discovery-add', 'discovery-complete', 'synthesis']) {
    const r = oldStore.get('runs', id);
    newStore.put('runs', id, r.body);
  }
  const oldLesson = oldStore.get('lessons', oldStore.all('lessons')[0].body.id).body;
  const { evidence: _evidence, createdAt: _createdAt, id: _id, ...proposal } = oldLesson;
  const lesson = memory.propose({ ...proposal, evidenceRuns: ['discovery-add', 'discovery-complete'] });
  const oldPlan = oldStore.get('plans', 'workboard-v1').body;
  const { frozenAt: _frozenAt, lessonVersions: _lessonVersions, ...planBody } = oldPlan;
  newPlan = memory.freeze({ ...planBody, id: planId, authorization: { ...planBody.authorization, scope: `evaluation:${planId}` }, lessonIds: [lesson.body.id] });
  for (const id of ['discovery-add', 'discovery-complete']) accountModel(newStore, planId, 'discovery', id);
  accountModel(newStore, planId, 'synthesis', 'synthesis');
  for (const phase of ['selection', 'verification', 'maintenance']) {
    newStore.put('overhead', `${planId}.${phase}`, { planId, phase, kind: 'deterministic', reason: 'This phase uses local JavaScript, hashes and executable assertions only; no additional model call in the observed evaluation cycle.' });
  }
  const oldSmoke = oldStore.get('overhead', 'workboard-v1.smoke').body;
  newStore.put('overhead', `${planId}.smoke`, { ...oldSmoke, planId });
} else {
  newPlan = newStore.get('plans', planId);
}

console.log(JSON.stringify({ plan: newPlan.body.id, planSha256: newPlan.sha256, store: newDir }, null, 2));
if (!dryRun) {
  await runPlan(newStore, newPlan.body.id, { codex: process.env.UIG_CODEX, progress: r => console.log(JSON.stringify(r)) });
}
