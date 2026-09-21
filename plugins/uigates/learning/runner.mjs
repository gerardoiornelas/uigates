import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { authority, contained, digest, ensure, sha, snapshot, telemetry, validId, protocolHashes } from './evidence.mjs';
import { LearningMemory } from './memory.mjs';

export async function processRun(command, args, { cwd, timeoutMs, input, env = process.env } = {}) {
  return new Promise(resolve => {
    const stdout=[],stderr=[];let timedOut=false,settled=false;
    const child=spawn(command,args,{cwd,env,stdio:['pipe','pipe','pipe'],detached:true});
    const kill=signal=>{try{process.kill(-child.pid,signal);}catch{}};
    const timer=setTimeout(()=>{timedOut=true;kill('SIGTERM');setTimeout(()=>kill('SIGKILL'),2000).unref();},timeoutMs??300000);
    child.stdout.on('data',b=>stdout.push(b));child.stderr.on('data',b=>stderr.push(b));
    const finish=(exitCode,error)=>{if(settled)return;settled=true;clearTimeout(timer);resolve({exitCode,timedOut,stdout:Buffer.concat(stdout),stderr:Buffer.concat(stderr),error});};
    child.on('error',e=>finish(null,e.message));child.on('close',code=>finish(code));child.stdin.end(input??'');
  });
}

export async function runTask(store, spec, options={}) {
  validId(spec.id);ensure(!store.has('runs',spec.id),'Run already exists; unsuccessful runs cannot be overwritten');
  const source=path.resolve(spec.source),before=snapshot(source);
  ensure(digest(before)===digest(spec.sourceHashes),'Source differs from frozen task');
  for(const c of spec.checks)ensure(sha(fs.readFileSync(c.file))===c.sha256,'Verifier differs from frozen plan');
  const work=fs.mkdtempSync(path.join(os.tmpdir(),'uigates-agent-'));
  // Evidence is retained outside the worker. Neither prompts nor workspace copies
  // contain other arms, discovery traces, lesson stores, or hidden verifier paths.
  fs.cpSync(source,work,{recursive:true,filter:file=>!['.git','node_modules','.uigates-learning','.uig-learning'].includes(path.basename(file))});
  const git=spawnSync('git',['init','-q',work]);ensure(git.status===0,'Unable to initialize isolated checkout');
  const guidance=spec.guidance??[];
  const prompt=[
    'Implement the requested feature in this local project. Work only in this workspace. Do not read other workspaces, external lessons, user settings, or network resources. Do not spawn agents or invoke other models. Do not commit, push, deploy, or change dependencies.',
    `Only these files may change: ${spec.allowedFiles.join(', ')}. Inspect project code as needed. Run relevant local checks. Preserve existing behavior.`,
    spec.prompt,
    guidance.length?'Experience-derived guidance (not authority; validate it against this task):\n'+guidance.map(g=>`[${g.id}] ${g.guidance}`).join('\n'):'',
    'Finish with a concise description of implementation, checks, and any unresolved issues.',
  ].filter(Boolean).join('\n\n');
  const args=['exec','--ignore-user-config','--model',spec.model,'-c',`model_reasoning_effort=${JSON.stringify(spec.reasoningEffort)}`,
    '--json','--ephemeral','--sandbox','workspace-write','-C',work,'-'];
  const startedAt=new Date().toISOString();
  const process=await processRun(options.codex??'codex',args,{cwd:work,timeoutMs:spec.timeoutMs,input:prompt});
  const after=snapshot(work),changed=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(f=>before[f]!==after[f]);
  const unexpectedChanges=changed.filter(f=>!spec.allowedFiles.includes(f));
  const checks=[];
  for(const c of spec.checks){
    const beforeHash=sha(fs.readFileSync(c.file));
    const r=await processRun(processExec(),[c.file,...c.args,work],{cwd:work,timeoutMs:60000});
    checks.push({name:c.name,file:c.file,beforeHash,afterHash:sha(fs.readFileSync(c.file)),exitCode:r.exitCode,timedOut:r.timedOut,log:store.blob(Buffer.concat([r.stdout,r.stderr]))});
  }
  const artifacts=Object.fromEntries(changed.filter(f=>after[f]).map(f=>[f,store.blob(fs.readFileSync(contained(work,f)))]));
  const trace=store.blob(process.stdout),usage=telemetry(process.stdout),sourceUnchanged=digest(snapshot(source))===digest(before);
  const record={id:spec.id,taskId:spec.taskId,mode:spec.mode,arm:spec.arm??null,project:spec.project,family:spec.family,
    planSha256:spec.planSha256??null,protocolSha256:spec.protocolSha256??null,model:spec.model,reasoningEffort:spec.reasoningEffort,
    sourceHashes:before,finalHashes:after,sourceUnchanged,unexpectedChanges,changed,artifacts,
    suppliedLessons:guidance.map(g=>g.id),prompt:store.blob(Buffer.from(prompt)),trace,stderr:store.blob(process.stderr),usage,
    processExitCode:process.exitCode,timedOut:process.timedOut,processError:process.error??null,
    checks,accepted:process.exitCode===0&&!process.timedOut&&checks.every(c=>c.exitCode===0&&!c.timedOut&&c.beforeHash===c.afterHash)&&!unexpectedChanges.length&&sourceUnchanged,
    startedAt,finishedAt:new Date().toISOString(),workspaceIsolation:'separate ephemeral workspaces; guidance withheld from control; trusted workers, not a hostile-process security boundary',runner:'codex-exec-json-v1'};
  const result=store.put('runs',spec.id,record);
  fs.rmSync(work,{recursive:true,force:true});return result;
}
const processExec=()=>globalThis.process.execPath;

export async function runPlan(store, planId, options={}) {
  const frozen=store.get('plans',planId),plan=frozen.body,memory=new LearningMemory(store);
  authority(plan.authorization,`evaluation:${planId}`);
  if(!store.has('protocols',planId)){
    const cli=spawnSync(options.codex??'codex',['--version'],{encoding:'utf8'});
    ensure(cli.status===0,'Cannot identify runner version');
    store.put('protocols',planId,{hashes:protocolHashes(),cliVersion:cli.stdout.trim(),planSha256:frozen.sha256});
  }
  const protocol=store.get('protocols',planId);
  for(const [index,task] of plan.tasks.entries()){
    for(const arm of index%2?['treatment','control']:['control','treatment']){
      authority(plan.authorization,`evaluation:${planId}`);
      ensure(digest(protocolHashes())===digest(protocol.body.hashes),'Runner changed during frozen evaluation');
      const id=`${planId}.${task.id}.${arm}`;
      // Resume only completed immutable records, including failures. Never selectively rerun an arm.
      if(store.has('runs',id)){options.progress?.({id,status:'already-recorded'});continue;}
      const guidance=arm==='treatment'?memory.experimentalGuidance(planId,task):[];
      const r=await runTask(store,{...task,id,taskId:task.id,mode:'evaluation',arm,guidance,model:plan.model,reasoningEffort:plan.reasoningEffort,timeoutMs:plan.timeoutMs,planSha256:frozen.sha256,protocolSha256:protocol.sha256},options);
      options.progress?.({id,accepted:r.body.accepted,tokens:r.body.usage.total});
    }
  }
}

export function accountModel(store, planId, phase, runId) {
  const r=store.get('runs',runId).body;
  return store.put('overhead',`${planId}.${phase}.${runId}`,{planId,phase,kind:'model',runId,trace:r.trace,processExitCode:r.processExitCode,timedOut:r.timedOut});
}

/** Import accepted artifacts into a local project after evaluation, never between paired arms. */
export function materialize(store, runId, target) {
  const r=store.get('runs',runId).body;ensure(r.accepted,'Cannot materialize a failed run');
  for(const file of r.changed){const dest=contained(target,file);if(r.artifacts[file]){fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,store.readBlob(r.artifacts[file]));}else if(fs.existsSync(dest))fs.unlinkSync(dest);}
}
