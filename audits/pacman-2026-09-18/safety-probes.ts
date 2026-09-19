import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GovernanceEngine } from '../../plugins/uigates/core/GovernanceEngine';
import { ReceiptStore } from '../../plugins/uigates/core/ReceiptStore';
import { CESynthesizer, loadKnowledge } from '../../plugins/uigates/intelligence/ce/synthesizer';

const OUT=path.resolve('audits/pacman-2026-09-18'), results:any[]=[];
let counter=0;
function world(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'uig-probe-')),store=new ReceiptStore(),gov=new GovernanceEngine([],undefined,store);return{root,store,gov,synth:new CESynthesizer(store,root,gov.ledger)};}
function receipt(w:ReturnType<typeof world>, overrides:any={}){
  const id=++counter,intent={id:`i${id}`,principalId:'fixture-principal',goal:'Local audit',constraints:[],successEvidence:['real checks'],authorityDomain:['examples/'],createdAt:new Date(),expiry:new Date(Date.now()+3600000)};
  const proposal:any={id:`p${id}`,intentId:intent.id,actorId:'worker',action:'pacman:collision:swept',resource:'examples/game.js',impact:'low',risk:'local fixture',rationale:'test',authorityRequested:'delegated',verificationPlan:'collision verifier',proposedAt:new Date()};
  const ev=w.gov.evaluate(proposal,intent),auth=w.gov.authorize(proposal,intent.principalId,ev.suggestedState);
  return {id:`r${id}`,authorizationId:auth.id,intentId:intent.id,actorId:proposal.actorId,actionPerformed:proposal.action,expectedOutcome:proposal.verificationPlan,actualOutcome:'Verified success',delta:'None',evidence:['test.log'],verifiedAt:new Date(),...overrides};
}
async function ingest(w:ReturnType<typeof world>,r:any){w.store.record(r);await w.synth.synthesize(r.intentId);}
async function probe(name:string,fn:(w:ReturnType<typeof world>)=>Promise<any>){const w=world();try{const r=await fn(w);results.push({name,...r});}finally{fs.rmSync(w.root,{recursive:true,force:true});}}
async function main(){
  await probe('nonexistent evidence should not be called verified',async w=>{
    await ingest(w,receipt(w,{evidence:['/definitely-nonexistent/pacman-tests-pass.json']}));
    const packs=loadKnowledge(w.root);return{pass:packs.length===0,actual:packs.map(p=>p.status),expected:'no verified lesson',category:'documented verification limitation'};
  });
  await probe('older delayed success must not clear newer failure',async w=>{
    const old=receipt(w),current=receipt(w),bad=receipt(w,{actualOutcome:'Failed',delta:'crossing collision still broken'});
    const at=Date.now();old.verifiedAt=new Date(at+1);current.verifiedAt=new Date(at+2);bad.verifiedAt=new Date(at+3);
    await ingest(w,current);await ingest(w,bad);const before=loadKnowledge(w.root)[0].status;await ingest(w,old);const after=loadKnowledge(w.root)[0].status;
    return{pass:after==='conflicted',before,actual:after,expected:'conflicted',category:'chronology defect'};
  });
  await probe('invalid receipt time must not satisfy authority window',async w=>{
    await ingest(w,receipt(w,{verifiedAt:new Date('invalid')}));const packs=loadKnowledge(w.root);
    return{pass:packs.length===0,actual:packs.length,expected:0,category:'invalid time accepted'};
  });
  await probe('unknown outcome is unverified rather than contradictory',async w=>{
    await ingest(w,receipt(w));await ingest(w,receipt(w,{actualOutcome:'Pending independent verification',delta:'None',evidence:[]}));
    const actual=loadKnowledge(w.root)[0].status;return{pass:actual==='verified',actual,expected:'verified (retain prior evidence; pending is not a failure)',category:'classification defect'};
  });
  await probe('filesystem pack edit cannot self-promote to Canon',async w=>{
    await ingest(w,receipt(w));const file=path.join(w.root,'.uig/knowledge/compound_packs',loadKnowledge(w.root)[0].file);
    fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('canon_approved_by: ','canon_approved_by: invented-principal'));
    const actual=loadKnowledge(w.root)[0].level;return{pass:actual!=='canon',actual,expected:'reject unsupported promotion',category:'trusted-filesystem boundary'};
  });
  await probe('domain matching must respect path boundaries',async w=>{
    const intent:any={id:'domain',principalId:'principal',goal:'edit examples only',constraints:[],successEvidence:[],authorityDomain:['examples/'],createdAt:new Date(),expiry:new Date(Date.now()+3600000)};
    const p:any={id:'escape',intentId:'domain',actorId:'worker',action:'edit',resource:'private/not-examples/game.js',rationale:'audit',impact:'low',risk:'test',authorityRequested:'delegated',verificationPlan:'test',proposedAt:new Date()};
    const r=w.gov.evaluate(p,intent);return{pass:r.denied,actual:r.suggestedState,expected:'prohibited',category:'resource scope defect'};
  });
  await probe('mutating verification plan after evaluation must invalidate approval',async w=>{
    const intent:any={id:'bound',principalId:'principal',goal:'audit',constraints:[],successEvidence:['tests'],authorityDomain:['examples/'],createdAt:new Date(),expiry:new Date(Date.now()+3600000)};
    const p:any={id:'bound-p',intentId:'bound',actorId:'worker',action:'edit',resource:'examples/game.js',rationale:'audit',impact:'low',risk:'test',authorityRequested:'delegated',verificationPlan:'run real collision tests',proposedAt:new Date()};
    const ev=w.gov.evaluate(p,intent);p.verificationPlan='skip every test';let allowed=false;try{w.gov.authorize(p,'principal',ev.suggestedState);allowed=true;}catch{}
    return{pass:!allowed,actual:allowed?'authorized changed plan':'rejected',expected:'rejected',category:'incomplete proposal binding'};
  });
  await probe('new success updates evidence shown to next task',async w=>{
    await ingest(w,receipt(w,{evidence:['first-run.log']}));await ingest(w,receipt(w,{evidence:['new-run.log']}));
    const actual=loadKnowledge(w.root)[0].evidence;return{pass:actual.includes('new-run.log'),actual,expected:'new-run.log retained alongside first-run.log',category:'stale evidence summary'};
  });
  fs.writeFileSync(path.join(OUT,'safety-probes.json'),JSON.stringify(results,null,2)+'\n');
  console.log(`AUDIT FINDINGS: ${results.filter(r=>!r.pass).length}/${results.length} desired properties violated`);
  console.log(JSON.stringify(results,null,2));
  // This is an observation runner: exit 0 means all probes executed. Findings are explicit in JSON.
}
main().catch(e=>{console.error(e);process.exitCode=1;});
