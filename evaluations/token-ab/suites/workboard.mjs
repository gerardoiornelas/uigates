// The Workboard workload from evaluations/real-project-v1, reused as it was frozen: the same project, the
// same task prompts, and the same external verifier, pinned by the SHA-256 the original plan recorded.
//
// What it can test: whether an agent, having learned this project's conventions, needs fewer tokens.
// What it cannot: whether an agent saves searching. The whole project is nine files and about 7 KB, so
// there is almost nothing to search. A search-heavy suite (a large repository, tasks that do not name
// their files) is a separate piece of work; see PLAN.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discovery, tasks } from '../../real-project-v1/workload.mjs';

const real = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../real-project-v1');
const plan = JSON.parse(fs.readFileSync(path.join(real, 'plan.json'), 'utf8'));
const pinned = (plan.body ?? plan).tasks[0].checks[0].sha256;

const shape = t => ({ id: t.id, family: t.family, prompt: t.prompt, allowedFiles: [`features/${t.id}.mjs`], args: [t.id] });

export default {
  id: 'workboard',
  source: path.join(real, 'frozen-project'),
  verifier: path.join(real, 'verify.mjs'),
  verifierSha256: pinned,
  discovery: discovery.map(shape),
  // What the discovery tasks create already exists in the frozen project; the learning phase must start without it.
  discoveryRemove: discovery.map(t => `features/${t.id}.mjs`),
  tasks: tasks.map(shape),
  // Four tasks, one per family: enough to see whether the arms behave, before spending on all sixteen.
  pilot: ['list', 'summary', 'rename', 'reopen'],
};
