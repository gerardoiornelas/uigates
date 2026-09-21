#!/usr/bin/env node
// Launcher for the UI-GATES engine CLI. Runs the TypeScript entrypoint through the pinned tsx,
// so `npx uigates ...` works from any project that installs this package.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tsx = createRequire(import.meta.url).resolve('tsx/cli');
const main = path.join(here, '..', 'plugins', 'uigates', 'cli', 'main.ts');
const run = spawnSync(process.execPath, [tsx, main, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(run.status ?? 1);
