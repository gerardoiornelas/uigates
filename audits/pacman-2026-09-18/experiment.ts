import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { GovernanceEngine } from '../../plugins/uigates/core/GovernanceEngine';
import { ReceiptStore } from '../../plugins/uigates/core/ReceiptStore';
import { CESynthesizer, loadKnowledge } from '../../plugins/uigates/intelligence/ce/synthesizer';
import { verifyFamily } from './behavior.mjs';

const OUT = path.resolve('audits/pacman-2026-09-18');
const plan = JSON.parse(fs.readFileSync(path.join(OUT,'plan.json'),'utf8'));
// Opaque candidates contain different executable semantics; no success flag is supplied to the worker.
const options: Record<string, Record<string, string>> = {
  tunnel: { a:'blocked', b:'wrap', c:'right-only' },
  collision: { a:'endpoint', b:'disabled', c:'swept' },
  terminal: { a:'loss-first', b:'win-first', c:'never-win' },
};
const log=console.log;
console.log=()=>{};
function rng(seed:number){let x=seed>>>0;return()=>{x=(Math.imul(x,1664525)+1013904223)>>>0;return x/4294967296;};}
function shuffle<T>(a:T[],r:()=>number){a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
const rows:any[]=[], attempts:any[]=[], auditTrail:any[]=[];
let serial=0;
function world(root:string) {const store=new ReceiptStore(),gov=new GovernanceEngine([],undefined,store);return {root,store,gov,synth:new CESynthesizer(store,root,gov.ledger)};}
async function build(w:ReturnType<typeof world>, seed:number, variant:number, arm:string, train:boolean){
  const id=`${seed}-${variant}-${arm}`,now=Date.now();
  const intent={id,principalId:'audit-fixture',goal:'Verify Pac-Man semantics',constraints:['Only local fixture executions'],successEvidence:['behavior results'],authorityDomain:['examples/pacman-audit/'],expiry:new Date(now+3600000),createdAt:new Date(now)};
  const row:any={seed,variant,arm,attempts:0,failures:0,accepted:true,retrieved:[],choices:{}};
  const random=rng(seed*1009+variant*9176);
  for(const family of Object.keys(options)){
    const packs=loadKnowledge(w.root).filter(p=>p.status==='verified'&&p.action.startsWith(`pacman:${family}:`));
    const prior=packs.map(p=>p.action.split(':')[2]).filter(k=>k in options[family]);
    row.retrieved.push(...packs.map(p=>p.file));
    const coldOrder=shuffle(Object.keys(options[family]),random);
    const order=[...new Set(prior),...coldOrder.filter(k=>!prior.includes(k))];
    let last:any, solved=false;
    for(const candidate of order){
      const action=`pacman:${family}:${candidate}`;
      const proposal:any={id:`p${++serial}`,intentId:id,actorId:'fixture-worker',action,resource:'examples/pacman-audit/engine.mjs',rationale:`Verify ${family}`,impact:'low',risk:'Disposable simulation only',authorityRequested:'delegated',verificationPlan:`Execute ${family} behavior checks`,proposedAt:new Date(),taskId:family,
        ...(last?{replan:{after:last.id,rootCause:last.delta,revision:`Execute candidate ${candidate} instead`}}:{})};
      const evaluation=w.gov.evaluate(proposal,intent);
      if(evaluation.denied||evaluation.suggestedState!=='delegated')throw Error(`unexpected fixture gate: ${evaluation.rationale}`);
      const auth=w.gov.authorize(proposal,'audit-fixture','delegated');
      const checks=verifyFamily(family,{[family]:options[family][candidate]},variant), failed=checks.filter((c:any)=>!c.pass);
      row.attempts++;if(failed.length)row.failures++;
      const evidence={seed,variant,arm,family,candidate,checks};
      attempts.push(evidence);
      const receipt={id:`r${serial}`,authorizationId:auth.id,intentId:id,actorId:'fixture-worker',actionPerformed:action,expectedOutcome:proposal.verificationPlan,actualOutcome:failed.length?'Failed behavioral verification':'Verified success',delta:failed.length?failed.map((x:any)=>x.name).join('; '):'None',evidence:[`attempts.json#${attempts.length-1} sha256:${crypto.createHash('sha256').update(JSON.stringify(evidence)).digest('hex')}`],verifiedAt:new Date(),taskId:family};
      w.store.record(receipt);
      auditTrail.push({intent,proposal,authorization:auth,receipt});
      if(train && seed===1){fs.mkdirSync(path.join(OUT,'discovery-records'),{recursive:true});fs.writeFileSync(path.join(OUT,'discovery-records',`${receipt.id}.json`),JSON.stringify({intent,proposal,authorization:auth,receipt,evidence},null,2));}
      if(!failed.length){row.choices[family]=candidate;solved=true;break;}last=receipt;
    }
    row.accepted&&=solved;
  }
  if(train)await w.synth.synthesize(id);
  return row;
}
async function main(){
  for(let seed=1;seed<=plan.experiment.seeds;seed++){
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'uig-pacman-audit-'));
    try{
      const discovery=world(path.join(root,'discovery'));
      rows.push(await build(discovery,seed,0,'discovery',true));
      const dir=path.join(discovery.root,'.uig');
      if(seed===1)fs.cpSync(dir,path.join(OUT,'discovery-memory'),{recursive:true});
      for(let variant=1;variant<=plan.experiment.heldout_cases;variant++){
        // Same permutation is generated even when priming applies: use a separate cold permutation first.
        for(const arm of variant%2?['control','memory','memory-ablated']:['memory','control','memory-ablated']){
          const target=path.join(root,`${variant}-${arm}`);
          if(arm==='memory')fs.cpSync(dir,path.join(target,'.uig'),{recursive:true});
          // Every new world gets fresh receipt store and authority ledger; retrieval is from disk alone.
          rows.push(await build(world(target),seed,variant,arm,false));
        }
      }
    }finally{fs.rmSync(root,{recursive:true,force:true});}
  }
  const summary:any={kind:'deterministic mechanism test; not a coding-agent trial',planSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(OUT,'plan.json'))).digest('hex'),seeds:plan.experiment.seeds,casesPerSeed:plan.experiment.heldout_cases,arms:{},modelTokenUsage:null};
  for(const arm of ['discovery','control','memory','memory-ablated']){
    const a=rows.filter(r=>r.arm===arm);summary.arms[arm]={runs:a.length,accepted:a.filter(r=>r.accepted).length,attempts:a.reduce((n,r)=>n+r.attempts,0),failures:a.reduce((n,r)=>n+r.failures,0),meanAttempts:a.reduce((n,r)=>n+r.attempts,0)/a.length};
  }
  summary.attemptReduction=1-summary.arms.memory.attempts/summary.arms.control.attempts;
  summary.ablationExactlyMatchesControl=rows.filter(r=>r.arm==='control').every(r=>{const a=rows.find(x=>x.seed===r.seed&&x.variant===r.variant&&x.arm==='memory-ablated');return a.attempts===r.attempts&&JSON.stringify(a.choices)===JSON.stringify(r.choices);});
  summary.allAccepted=rows.every(r=>r.accepted);
  for(const [name,data] of Object.entries({results:rows,attempts,summary}))fs.writeFileSync(path.join(OUT,`${name}.json`),JSON.stringify(data,null,2)+'\n');
  fs.writeFileSync(path.join(OUT,'execution-records.jsonl'),auditTrail.map(r=>JSON.stringify(r)).join('\n')+'\n');
  fs.writeFileSync(path.join(OUT,'results.csv'),'seed,variant,arm,attempts,failures,accepted\n'+rows.map(r=>[r.seed,r.variant,r.arm,r.attempts,r.failures,r.accepted].join(',')).join('\n')+'\n');
  console.log=log;log(JSON.stringify(summary,null,2));
  if(!summary.allAccepted||!summary.ablationExactlyMatchesControl)process.exitCode=1;
}
main().catch(e=>{console.log=log;console.error(e);process.exitCode=1;});
