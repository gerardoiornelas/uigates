import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const verifier = path.join(here, 'mini-verify.mjs');
const shape = (id, family) => ({ id, family, prompt: `Create features/${id}.mjs exporting run().`, allowedFiles: [`features/${id}.mjs`], args: [id] });
export default {
  id: 'mini',
  source: path.join(here, 'mini-project'),
  verifier,
  verifierSha256: process.env.MINI_PIN ?? crypto.createHash('sha256').update(fs.readFileSync(verifier)).digest('hex'),
  discovery: [shape('d1', 'a'), shape('d2', 'b')],
  tasks: ['t1', 't2', 't3'].map(id => shape(id, 'a')),
  pilot: ['t1', 't2'],
};
