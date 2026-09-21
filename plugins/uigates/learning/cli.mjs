#!/usr/bin/env node
import fs from 'node:fs';
import { EvidenceStore } from './evidence.mjs';
import { LearningMemory } from './memory.mjs';
import { certify } from './certify.mjs';
import { runPlan, runTask, materialize } from './runner.mjs';
const [command,directory,arg,extra]=process.argv.slice(2);
try {
  if(!command||command==='help'){
    console.log('UI-GATES learning\nCommands: discover STORE SPEC.json | propose STORE LESSON.json | freeze STORE PLAN.json | run STORE PLAN_ID | certify STORE PLAN_ID | approve STORE APPROVAL.json | retire STORE RETIREMENT.json | retrieve STORE QUERY.json | materialize STORE RUN_ID TARGET\nSet UIGATES_CODEX (or the older UIG_CODEX) to a compatible Codex CLI. Model/settings are frozen in specs. See docs/certified-learning.md.');
  }else{
    const store=new EvidenceStore(directory),memory=new LearningMemory(store),input=()=>JSON.parse(fs.readFileSync(arg,'utf8'));let result;
    switch(command){
      case'discover':{const spec=input();if(spec.mode!=='discovery')throw Error('Expected discovery mode');result=await runTask(store,spec,{codex:process.env.UIGATES_CODEX||process.env.UIG_CODEX});break;}
      case'propose':result=memory.propose(input());break;
      case'freeze':result=memory.freeze(input());break;
      case'run':await runPlan(store,arg,{codex:process.env.UIGATES_CODEX||process.env.UIG_CODEX,progress:r=>console.log(JSON.stringify(r))});break;
      case'certify':result=certify(store,arg);break;
      case'approve':{const a=input();result=memory.approve(a.lesson,a.certificate,a.authority);break;}
      case'retire':{const r=input();result=memory.retire(r.lesson,r.reason,r.source);break;}
      case'retrieve':result=memory.retrieve(input());break;
      case'materialize':materialize(store,arg,extra);break;
      default:throw Error('Unknown command');
    }
    if(result)console.log(JSON.stringify(result,null,2));
  }
}catch(e){console.error(e.message);process.exitCode=1;}
