import fs from 'node:fs';
import { verifyGame } from './behavior.mjs';
const results=verifyGame();
fs.writeFileSync('audits/pacman-2026-09-18/game-checks.json',JSON.stringify(results,null,2)+'\n');
console.log(`${results.filter(r=>r.pass).length}/${results.length} game checks passed`);
for(const r of results)if(!r.pass)console.error(r);
process.exitCode=results.some(r=>!r.pass)?1:0;
