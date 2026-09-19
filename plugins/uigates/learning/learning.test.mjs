import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EvidenceStore, telemetry, sha, digest, snapshot, contained, protocolHashes } from './evidence.mjs';
import { LearningMemory } from './memory.mjs';
import { certify, wilson, bootstrap } from './certify.mjs';

const trace=(input=1000,output=100,extra=[])=>Buffer.from([
  {type:'thread.started',thread_id:`fixture-${input}-${output}`},{type:'turn.started'},...extra,
  {type:'turn.completed',usage:{input_tokens:input,cached_input_tokens:Math.floor(input/2),output_tokens:output}},
].map(e=>JSON.stringify(e)).join('\n'));
function fixture(t,n=16){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'uig-cert-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new EvidenceStore(root),memory=new LearningMemory(store),log=store.blob(Buffer.from('test passed'));
  const authority={principal:'fixture-only',source:'automated synthetic unit test',scope:'evaluation:trial',expiresAt:new Date(Date.now()+3600000).toISOString()};
  for(let i=1;i<=2;i++)store.put('runs',`d${i}`,{id:`d${i}`,taskId:`discovery-${i}`,project:'project',mode:'discovery',accepted:true,trace:store.blob(trace(10+i,2)),checks:[{exitCode:0,beforeHash:'a',afterHash:'a',log}]});
  const lesson=memory.propose({guidance:'Use the validated storage transaction helper',appliesWhen:'Changing project p persistence',doNotApplyWhen:'The helper contract changes',project:'project',families:['storage'],dependencies:{'store.mjs':'a'.repeat(64)},evidenceRuns:['d1','d2']});
  const tasks=Array.from({length:n},(_,i)=>({id:`t${i}`,project:'project',family:'storage',prompt:`Implement feature ${i}`,sourceHashes:{'store.mjs':'a'.repeat(64)},allowedFiles:[`feature${i}.mjs`],checks:[{file:'fixture.mjs',name:'behavior',sha256:'b'.repeat(64),args:[]}]}));
  const plan=memory.freeze({id:'trial',model:'fixture-not-a-real-model',reasoningEffort:'high',timeoutMs:10000,costScope:'synthetic unit test only',authorization:authority,tasks,lessonIds:[lesson.body.id]});
  const protocol=store.put('protocols','trial',{hashes:protocolHashes(),cliVersion:'synthetic',planSha256:plan.sha256});
  function arm(i,name,over={}){
    const id=`trial.t${i}.${name}`;
    return store.put('runs',id,{id,taskId:`t${i}`,arm:name,project:'project',model:plan.body.model,reasoningEffort:'high',planSha256:plan.sha256,
      protocolSha256:protocol.sha256,accepted:true,sourceUnchanged:true,unexpectedChanges:[],suppliedLessons:name==='treatment'?[lesson.body.id]:[],
      trace:store.blob(trace((name==='treatment'?100:1000)+i,100)),processExitCode:0,timedOut:false,
      checks:[{exitCode:0,beforeHash:'b'.repeat(64),afterHash:'b'.repeat(64),log}],...over});
  }
  function overhead(){
    for(let i=1;i<=2;i++){const r=store.get('runs',`d${i}`).body;store.put('overhead',`d${i}`,{planId:'trial',phase:'discovery',kind:'model',runId:`d${i}`,trace:r.trace,processExitCode:0});}
    for(const phase of ['synthesis','selection','verification','maintenance'])store.put('overhead',phase,{planId:'trial',phase,kind:'deterministic',reason:'Synthetic fixture does not invoke any models'});
  }
  return{root,store,memory,lesson,plan,arm,overhead};
}
test('telemetry counts all complete turns and never double-counts cache',()=>{
  const r=telemetry(Buffer.concat([trace(100,10),Buffer.from('\n'),trace(200,20)]));assert.equal(r.total,330);assert.equal(r.cached,150);
});
test('failed, truncated, malformed, missing and invalid usage are unknown rather than zero',()=>{
  for(const b of [Buffer.from(''),Buffer.from('x'),Buffer.from('{"type":"turn.started"}'),trace(1,2,[{type:'error'}]),trace(-1,3),Buffer.from('{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":2,"cached_input_tokens":0}}')])assert.equal(telemetry(b).total,null);
});
test('immutable records reject overwrite and detect content tampering',t=>{const {store,root}=fixture(t);assert.throws(()=>store.put('runs','d1',{}));const f=path.join(root,'runs/d1.json');const r=JSON.parse(fs.readFileSync(f));r.body.accepted=false;fs.writeFileSync(f,JSON.stringify(r));assert.throws(()=>store.get('runs','d1'),/integrity/);});
test('blob tampering is detected',t=>{const {store,root}=fixture(t);const id=store.blob(Buffer.from('original'));fs.writeFileSync(path.join(root,'blobs',id),'changed');assert.throws(()=>store.readBlob(id),/integrity/);});
test('candidate cannot become live guidance without evaluation and approval',t=>{const {memory,lesson}=fixture(t);assert.equal(memory.state(lesson.body.id).state,'candidate');assert.deepEqual(memory.retrieve({project:'project',family:'storage'}),[]);});
test('discovery and holdout IDs cannot overlap',t=>{const {memory,plan}=fixture(t);assert.throws(()=>memory.freeze({...plan.body,id:'overlap',authorization:{...plan.body.authorization,scope:'evaluation:overlap'},tasks:plan.body.tasks.map((r,i)=>({...r,id:i===0?'discovery-1':r.id}))}),/overlap/);});
test('duplicate discovery evidence cannot teach',t=>{const {memory,lesson}=fixture(t);assert.throws(()=>memory.propose({...lesson.body,evidenceRuns:['d1','d1']}),/distinct/);});
test('missing arms never certify',t=>{const {store}=fixture(t);const r=certify(store,'trial').body;assert.equal(r.certified,false);assert.equal(r.netTokensSaved,null);});
test('complete paired data with measured overhead produces a scoped certificate',t=>{const {store,arm,overhead}=fixture(t);for(let i=0;i<16;i++){arm(i,'control');arm(i,'treatment');}overhead();const r=certify(store,'trial').body;assert.equal(r.certified,true);assert.equal(r.unboundedGeneralLearningCertified,false);assert.equal(r.controlTokens-r.treatmentTokens-r.observedOverheadTokens,r.netTokensSaved);assert(r.acceptance95CI[0]>=.8);});
test('six accepted pairs can show effect but cannot certify 80% reliability at 95% confidence',t=>{const {store,arm,overhead}=fixture(t,6);for(let i=0;i<6;i++){arm(i,'control');arm(i,'treatment');}overhead();const r=certify(store,'trial').body;assert.equal(r.learningSupported,true);assert.equal(r.certified,false);});
test('quality regression blocks learning and savings even with fewer tokens',t=>{const {store,arm,overhead}=fixture(t);for(let i=0;i<16;i++){arm(i,'control');arm(i,'treatment',i===2?{accepted:false}:{});}overhead();const r=certify(store,'trial').body;assert.equal(r.learningSupported,false);assert.equal(r.tokenSavingsSupported,false);});
test('missing overhead blocks net-savings claims',t=>{const {store,arm}=fixture(t);for(let i=0;i<16;i++){arm(i,'control');arm(i,'treatment');}const r=certify(store,'trial').body;assert.equal(r.overheadComplete,false);assert.equal(r.netTokensSaved,null);});
test('reused telemetry is rejected',t=>{const {store,arm}=fixture(t);const r=arm(0,'control');arm(0,'treatment',{trace:r.body.trace});assert.throws(()=>certify(store,'trial'),/reused/);});
test('timeout with final counters remains incomplete',t=>{const {store,arm,overhead}=fixture(t);for(let i=0;i<16;i++){arm(i,'control');arm(i,'treatment',i===0?{timedOut:true}:{});}overhead();const r=certify(store,'trial').body;assert.equal(r.complete,false);assert.equal(r.netTokensSaved,null);});
test('wrong model or modified verifier invalidates evidence',t=>{const {store,arm}=fixture(t);arm(0,'control',{model:'different'});assert.throws(()=>certify(store,'trial'),/frozen/);});
test('source freshness withholds old approved guidance',t=>{const {memory,lesson,root}=fixture(t);fs.writeFileSync(path.join(root,'store.mjs'),'new source');assert.equal(memory.state(lesson.body.id,root).state,'stale');});
test('retirement is terminal',t=>{const {memory,lesson}=fixture(t);memory.retire(lesson.body.id,'Measured acceptance regression','fixture report');assert.equal(memory.state(lesson.body.id).state,'retired');assert.deepEqual(memory.retrieve({project:'project',family:'storage'}),[]);});
test('filesystem scope and snapshot reject traversal and symlinks',t=>{const {root}=fixture(t);assert.throws(()=>contained(root,'../outside'));fs.symlinkSync('/tmp',path.join(root,'escape'));assert.throws(()=>snapshot(root),/Symlinks/);});
test('intervals expose uncertainty and overhead can eliminate net savings',()=>{assert(wilson(6,6)[0]<.8);assert(wilson(16,16)[0]>.8);assert(bootstrap([1,2,3],100)[1]<0);});
