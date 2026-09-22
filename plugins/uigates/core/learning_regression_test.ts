import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {GovernanceEngine} from './GovernanceEngine';
import {ReceiptStore} from './ReceiptStore';
import {CESynthesizer,loadKnowledge} from '../intelligence/ce/synthesizer';
import {UIGatesWrapper} from './UIGatesWrapper';
let next=0;
function fixture(t:any){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'uigates-fixed-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=new ReceiptStore(),gov=new GovernanceEngine([],undefined,store),synth=new CESynthesizer(store,root,gov.ledger);
 fs.writeFileSync(path.join(root,'checks.json'),JSON.stringify({passed:true,checks:['external verifier fixture']}));
 const ref='sha256:'+crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'checks.json'),'utf8')).digest('hex')+':checks.json';
 function proposed(){const n=++next,intent:any={id:`i${n}`,principalId:'principal',goal:'audit',constraints:[],successEvidence:['checks'],authorityDomain:['src/'],createdAt:new Date(),expiry:new Date(Date.now()+3600000)};
 const p:any={id:`p${n}`,intentId:intent.id,actorId:'worker',action:'use transactions',resource:'src/a.js',impact:'low',risk:'local',rationale:'verify',authorityRequested:'delegated',verificationPlan:'run independent checks',proposedAt:new Date()};return{intent,p};}
 function receipt(over:any={}){const {intent,p}=proposed(),ev=gov.evaluate(p,intent),a=gov.authorize(p,'principal',ev.suggestedState);return{id:`r${next}`,authorizationId:a.id,intentId:intent.id,actorId:'worker',actionPerformed:p.action,expectedOutcome:p.verificationPlan,actualOutcome:'Verified success',delta:'None',evidence:[ref],verifiedAt:new Date(),...over};}
 async function ingest(r:any){store.record(r);await synth.synthesize(r.intentId);}
 return{root,store,gov,synth,ref,proposed,receipt,ingest,packs:()=>loadKnowledge(root)};
}
test('forged or nonexistent evidence fails closed, valid hash-backed evidence works',async t=>{const w=fixture(t);await w.ingest(w.receipt({evidence:['does-not-exist.log']}));assert.equal(w.packs().length,0);await w.ingest(w.receipt());assert.equal(w.packs().length,1);});
test('modified evidence bytes fail validation',async t=>{const w=fixture(t),r=w.receipt();fs.writeFileSync(path.join(w.root,'checks.json'),'tampered');await w.ingest(r);assert.equal(w.packs().length,0);});
test('delayed old success cannot clear newer failure',async t=>{const w=fixture(t),old=w.receipt(),good=w.receipt(),bad=w.receipt({actualOutcome:'Failed',delta:'regression'}),at=Date.now();old.verifiedAt=new Date(at+1);good.verifiedAt=new Date(at+2);bad.verifiedAt=new Date(at+3);await w.ingest(good);await w.ingest(bad);await w.ingest(old);assert.equal(w.packs()[0].status,'conflicted');});
test('failure arriving before first success remains known',async t=>{const w=fixture(t),old=w.receipt(),bad=w.receipt({actualOutcome:'Failed',delta:'regression'}),at=Date.now();old.verifiedAt=new Date(at+1);bad.verifiedAt=new Date(at+2);await w.ingest(bad);assert.equal(w.packs().length,0);await w.ingest(old);assert.equal(w.packs()[0].status,'conflicted');});
test('pending result does not invent a contradiction',async t=>{const w=fixture(t);await w.ingest(w.receipt());await w.ingest(w.receipt({actualOutcome:'Pending verification',evidence:[]}));assert.equal(w.packs()[0].status,'verified');});
test('invalid receipt and intent times grant nothing',async t=>{const w=fixture(t);await w.ingest(w.receipt({verifiedAt:new Date('invalid')}));assert.equal(w.packs().length,0);const {p,intent}=w.proposed();intent.expiry=new Date('invalid');assert.equal(w.gov.evaluate(p,intent).denied,true);});
test('Markdown edits cannot assert Canon',async t=>{const w=fixture(t);await w.ingest(w.receipt());const f=path.join(w.root,'.uigates/knowledge/compound_packs',w.packs()[0].file);fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace('canon_approved_by: ','canon_approved_by: mallory'));assert.equal(w.packs().length,0);});
test('new supporting evidence remains visible',async t=>{const w=fixture(t);await w.ingest(w.receipt());fs.writeFileSync(path.join(w.root,'second.log'),'new proof');const hash=crypto.createHash('sha256').update('new proof').digest('hex');await w.ingest(w.receipt({evidence:[`sha256:${hash}:second.log`]}));assert(w.packs()[0].evidence.includes('second.log'));});
test('scope checks path boundaries and rejects host paths',t=>{const w=fixture(t),{p,intent}=w.proposed();for(const resource of ['private/not-src/a.js','/src/a.js','../src/a.js','C:/src/a.js'])assert.equal(w.gov.evaluate({...p,resource},intent).denied,true);assert.equal(w.gov.evaluate({...p,resource:'src/nested/a.js'},intent).denied,false);});
test('changing verification or risk after evaluation invalidates authority',t=>{const w=fixture(t);for(const key of ['verificationPlan','risk','rationale','authorityRequested']){const {p,intent}=w.proposed(),ev=w.gov.evaluate(p,intent);assert.throws(()=>w.gov.authorize({...p,[key]:'changed'},'principal',ev.suggestedState),/differs/);}});
test('wrapper never automatically approves gated execution',async t=>{
 const w=fixture(t),{p,intent}=w.proposed();p.impact='medium';let executed=false;
 const engine:any={proposeAction:async()=>p,executeAction:async()=>{executed=true;return{success:true,actualOutcome:'GOAL_REACHED',evidence:[w.ref],delta:'None'};},learnFromReceipt:async()=>{}};
 await assert.rejects(new UIGatesWrapper(engine,w.gov,w.store).runTask(intent,'principal'),/approval required/);assert.equal(executed,false);
 await new UIGatesWrapper(engine,w.gov,w.store,async()=>true).runTask(intent,'principal');assert.equal(executed,true);
});
test('wrapper cannot report completion after a denied proposal',async t=>{
 const w=fixture(t),{p,intent}=w.proposed();p.resource='../outside';
 const engine:any={proposeAction:async()=>p,executeAction:async()=>{throw Error('must not execute');},learnFromReceipt:async()=>{}};
 await assert.rejects(new UIGatesWrapper(engine,w.gov,w.store).runTask(intent,'principal'),/not complete/);
});
