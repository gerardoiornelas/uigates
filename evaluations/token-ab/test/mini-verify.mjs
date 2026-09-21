// A trivial independent verifier for the stub suite: the feature file must exist and export run.
import fs from 'node:fs';
import path from 'node:path';
const [task, root] = process.argv.slice(2);
const file = path.join(root, 'features', `${task}.mjs`);
if (!fs.existsSync(file) || !/export\s+(const|function)\s+run/.test(fs.readFileSync(file, 'utf8'))) { console.error(`FAIL ${task}`); process.exit(1); }
console.log(`PASS ${task}`);
