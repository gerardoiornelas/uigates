// Run from the repository root: node audits/pacman-2026-09-18/run.mjs
// Set TSX_IMPORT to an installed tsx/dist/loader.mjs if tsx is not in the local npx cache.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
const out=path.resolve('audits/pacman-2026-09-18'),root=process.cwd();
let loader=process.env.TSX_IMPORT;
if(!loader){const cache=path.join(os.homedir(),'.npm/_npx');if(fs.existsSync(cache))loader=fs.readdirSync(cache).map(d=>path.join(cache,d,'node_modules/tsx/dist/loader.mjs')).find(p=>fs.existsSync(p));}
if(!loader)throw Error('Install tsx in a temporary directory and set TSX_IMPORT to its dist/loader.mjs');
const sha=(p)=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const audited=files('plugins/uigates').filter(p=>/\.(ts|js|md|json)$/.test(p)).concat(files('examples/pacman'),files('examples/pacman-audit'));
const before=Object.fromEntries(audited.map(p=>[p,sha(p)]));
const startedAt=new Date().toISOString();
for(const file of audited){const target=path.join(out,'source-snapshot',file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(file,target);}
const specs=[
  ['promises',['--import',loader,'plugins/uigates/core/promises_test.ts']],
  ['synthesis',['--import',loader,'plugins/uigates/core/synthesis_pressure_test.ts']],
  ['arcade',['--import',loader,'plugins/uigates/core/arcade_pressure_test.ts','--no-showcase']],
  ['skills',['--import',loader,'plugins/uigates/core/skills_sync_test.ts']],
  ['baseline',['audits/pacman-2026-09-18/baseline.mjs']],
  ['game',['audits/pacman-2026-09-18/game-check.mjs']],
  ['experiment',['--import',loader,'audits/pacman-2026-09-18/experiment.ts']],
  ['safety-probes',['--import',loader,'audits/pacman-2026-09-18/safety-probes.ts']],
];
const suites=await Promise.all(specs.map(([name,args])=>new Promise(resolve=>{
  const log=fs.openSync(path.join(out,name+'.log'),'w'),start=performance.now();
  const child=spawn(process.execPath,args,{cwd:root,stdio:['ignore',log,log]});
  child.on('error',e=>{fs.closeSync(log);resolve({name,error:e.message,exitCode:null});});
  child.on('exit',(exitCode,signal)=>{fs.closeSync(log);console.log(`${name}: exit ${exitCode}`);resolve({name,args,exitCode,signal,elapsedMs:performance.now()-start});});
})));
const changed=audited.filter(p=>!fs.existsSync(p)||sha(p)!==before[p]);
const metadata={startedAt,finishedAt:new Date().toISOString(),node:process.version,platform:process.platform,arch:process.arch,headAtCompletion:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceHashes:before,changedDuringRun:changed,suites,limits:'Baseline and safety probes intentionally report violated properties in their JSON; exit 0 only means all observations completed. Timing is concurrent harness runtime, not agent efficiency.'};
fs.writeFileSync(path.join(out,'run-metadata.json'),JSON.stringify(metadata,null,2)+'\n');
if(changed.length||suites.some(s=>s.exitCode!==0))process.exitCode=1;
