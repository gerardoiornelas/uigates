#!/usr/bin/env node
// Launcher for the UI-GATES engine CLI. Runs the TypeScript entrypoint through the pinned tsx,
// so `npx uigates ...` works from any project that installs this package.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tsx = createRequire(import.meta.url).resolve('tsx/cli');
const main = path.join(here, '..', 'plugins', 'uigates', 'cli', 'main.ts');
// Loads ./.env from the caller's cwd if present (gitignored — see .env.example). Node's own loader,
// no dotenv dependency, and never overrides a variable already set in the real environment. Checked
// with existsSync (not --env-file-if-exists) so a missing .env — the common case — prints nothing.
const envFlag = existsSync(path.join(process.cwd(), '.env')) ? ['--env-file=.env'] : [];
const run = spawnSync(process.execPath, [...envFlag, tsx, main, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(run.status ?? 1);
