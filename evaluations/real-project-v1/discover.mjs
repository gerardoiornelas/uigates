import fs from 'node:fs';
import path from 'node:path';
import {EvidenceStore,sha,snapshot} from '../../plugins/uigates/learning/evidence.mjs';
import {runTask,materialize} from '../../plugins/uigates/learning/runner.mjs';
import {discovery} from './workload.mjs';
const directory=path.resolve('evaluations/real-project-v1'),store=new EvidenceStore(path.join(directory,'store'));
const source=path.resolve('examples/workboard'),verifier=path.join(directory,'verify.mjs');
for(const task of discovery){
 const id=`discovery-${task.id}`;
 if(store.has('runs',id)){console.log(`${id} already recorded`);continue;}
 const result=await runTask(store,{id,taskId:id,mode:'discovery',project:'workboard',family:task.family,source,sourceHashes:snapshot(source),model:'gpt-6-astra',reasoningEffort:'high',timeoutMs:300000,prompt:task.prompt,allowedFiles:[`features/${task.id}.mjs`],checks:[{name:task.id,file:verifier,args:[task.id],sha256:sha(fs.readFileSync(verifier))}]},{codex:process.env.UIG_CODEX});
 console.log(JSON.stringify({id,accepted:result.body.accepted,tokens:result.body.usage.total,checks:result.body.checks.map(c=>c.exitCode)}));
 if(!result.body.accepted)throw Error(`Discovery failed; retain evidence and replan: ${id}`);
 materialize(store,id,source);
}
