import { ensure, telemetry, protocolHashes, digest } from './evidence.mjs';

export function wilson(successes, total, z=1.96) {
  if(!total)return[0,1];const p=successes/total,d=1+z*z/total,c=(p+z*z/(2*total))/d;
  const m=z*Math.sqrt(p*(1-p)/total+z*z/(4*total*total))/d;return[c-m,c+m];
}
export function bootstrap(values, overhead=0) {
  if(!values.length)return[null,null];let seed=827361;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const sums=[];for(let b=0;b<10000;b++){let sum=-overhead;for(let i=0;i<values.length;i++)sum+=values[Math.floor(random()*values.length)];sums.push(sum);}
  sums.sort((a,b)=>a-b);return[sums[250],sums[9749]];
}

/** A certificate reports its tested scope. It never certifies arbitrary future coding tasks. */
export function certify(store, planId) {
  const frozen=store.get('plans',planId),plan=frozen.body, reasons=[],pairs=[],seenTraces=new Set();
  const protocol=store.has('protocols',planId)?store.get('protocols',planId):null;
  if(protocol)ensure(digest(protocol.body.hashes)===digest(protocolHashes())&&protocol.body.planSha256===frozen.sha256,'Frozen evaluation protocol changed');
  else reasons.push('Missing frozen runner protocol');
  const checkedUsage=run=>{
    if(!run?.trace)return{complete:false,total:null};
    ensure(!seenTraces.has(run.trace),'A trace was reused across runs or overhead');seenTraces.add(run.trace);
    const usage=telemetry(store.readBlob(run.trace));
    if(run.processExitCode!==0||run.timedOut)return{...usage,complete:false,total:null,reason:'Runner failed or timed out'};
    return usage;
  };
  for(const task of plan.tasks){
    const arms={};
    for(const arm of ['control','treatment']){
      const id=`${planId}.${task.id}.${arm}`;
      if(!store.has('runs',id)){reasons.push(`Missing ${id}`);continue;}
      const r=store.get('runs',id).body;
      ensure(r.planSha256===frozen.sha256&&r.model===plan.model&&r.reasoningEffort===plan.reasoningEffort,'Run does not match frozen plan');
      if(protocol)ensure(r.protocolSha256===protocol.sha256,'Run protocol mismatch');
      ensure(r.taskId===task.id&&r.arm===arm&&r.project===task.project,'Run identity mismatch');
      const quality=r.accepted===true && r.checks.length===task.checks.length && r.checks.every((c,i)=>{
        store.readBlob(c.log);return c.exitCode===0&&c.beforeHash===task.checks[i].sha256&&c.afterHash===c.beforeHash;
      }) && !r.unexpectedChanges?.length && r.sourceUnchanged;
      const usage=checkedUsage(r);
      if(!usage.complete)reasons.push(`Incomplete telemetry: ${id}`);
      if(!quality)reasons.push(`Acceptance failed: ${id}`);
      const expected=arm==='control'?[]:plan.lessonVersions.filter(v=>{const l=store.get('lessons',v.id).body;return l.project===task.project&&l.families.includes(task.family);}).map(v=>v.id);
      ensure(JSON.stringify([...r.suppliedLessons].sort())===JSON.stringify(expected.sort()),'Incorrect experimental guidance');
      arms[arm]={id,quality,usage,supplied:r.suppliedLessons};
    }
    pairs.push({task:task.id,project:task.project,family:task.family,...arms,saved:arms.control?.usage.complete&&arms.treatment?.usage.complete?arms.control.usage.total-arms.treatment.usage.total:null});
  }
  const overheadRecords=store.all('overhead').filter(r=>r.body.planId===planId);
  const phases=['discovery','synthesis','selection','verification','maintenance'];
  let overhead=0,overheadComplete=true;
  for(const phase of phases){
    const records=overheadRecords.filter(r=>r.body.phase===phase);
    if(!records.length){overheadComplete=false;reasons.push(`Missing overhead: ${phase}`);continue;}
    for(const {body:r} of records){
      if(r.kind==='deterministic'&&typeof r.reason==='string'&&r.reason.length>10)continue;
      if(r.kind!=='model'){overheadComplete=false;reasons.push(`Unknown overhead: ${phase}`);continue;}
      const u=checkedUsage(r);if(!u.complete){overheadComplete=false;reasons.push(`Incomplete overhead: ${phase}`);}else overhead+=u.total;
    }
  }
  // All discovery runs cited by the lessons must be accounted for, including unsuccessful
  // predecessors recorded in this experiment's discovery batch.
  const requiredDiscovery=new Set(plan.lessonVersions.flatMap(v=>store.get('lessons',v.id).body.evidenceRuns));
  const countedDiscovery=new Set(overheadRecords.filter(r=>r.body.phase==='discovery').map(r=>r.body.runId));
  if([...requiredDiscovery].some(id=>!countedDiscovery.has(id))){overheadComplete=false;reasons.push('Uncounted discovery evidence');}
  const complete=pairs.every(p=>p.control?.usage.complete&&p.treatment?.usage.complete);
  const quality=pairs.every(p=>p.control?.quality&&p.treatment?.quality);
  // A lesson that accompanies a new acceptance regression is withdrawn before live reuse.
  for(const p of pairs.filter(p=>p.control?.quality&&p.treatment&&!p.treatment.quality)){
    for(const lesson of p.treatment.supplied){
      const id=`${planId}.${p.task}.${lesson}`;
      if(!store.has('retirements',id))store.put('retirements',id,{lesson,reason:'Treatment acceptance regressed against paired control',source:`${planId}/${p.task}`,at:new Date().toISOString()});
    }
  }
  const deltas=pairs.map(p=>p.saved).filter(n=>n!==null);
  const control=complete?pairs.reduce((s,p)=>s+p.control.usage.total,0):null;
  const treatment=complete?pairs.reduce((s,p)=>s+p.treatment.usage.total,0):null;
  const net=complete&&overheadComplete?control-treatment-overhead:null;
  const grossCI=complete?bootstrap(deltas):[null,null],netCI=complete&&overheadComplete?bootstrap(deltas,overhead):[null,null];
  const accepted=pairs.filter(p=>p.treatment?.quality).length, reliabilityCI=wilson(accepted,pairs.length);
  const learningSupported=complete&&quality&&deltas.filter(n=>n>0).length>=2&&grossCI[0]>0;
  const tokenSavingsSupported=learningSupported&&overheadComplete&&net>0&&netCI[0]>0;
  // Six observations may support a bounded effect but cannot meet this reliability threshold.
  const certified=!!protocol&&tokenSavingsSupported&&reliabilityCI[0]>=0.8&&pairs.length>=16;
  const result={id:planId,planSha256:frozen.sha256,scope:{projects:[...new Set(plan.tasks.map(t=>t.project))],families:[...new Set(plan.tasks.map(t=>t.family))],model:plan.model,reasoningEffort:plan.reasoningEffort,costScope:plan.costScope},
    lessonIds:plan.lessonIds,pairs,complete,quality,learningSupported,tokenSavingsSupported,certified,
    familyResults:[...new Set(pairs.map(p=>p.family))].map(family=>{const rows=pairs.filter(p=>p.family===family);return{family,pairs:rows.length,accepted:rows.filter(p=>p.treatment?.quality).length,acceptance95CI:wilson(rows.filter(p=>p.treatment?.quality).length,rows.length),grossTokensSaved:rows.every(p=>p.saved!==null)?rows.reduce((s,p)=>s+p.saved,0):null};}),
    unboundedGeneralLearningCertified:false,status:certified?'certified-within-tested-scope':learningSupported?'bounded-effect-supported':'inconclusive-or-not-supported',
    controlTokens:control,treatmentTokens:treatment,observedOverheadTokens:overhead,overheadComplete,netTokensSaved:net,
    grossSavings95CI:grossCI,netSavings95CI:netCI,acceptance95CI:reliabilityCI,reasons,
    limitations:['A local evidence attestation, not third-party accreditation.','Bootstrap assumes the declared task sample; correlated tasks and one project limit external validity.','No claim about billing: cached-input tokens are included once in total input.','One-time framework and benchmark development is outside the declared operational cost scope.','Future tasks, other repositories and other models require their own evidence.'],createdAt:new Date().toISOString()};
  return store.put('certificates',planId,result);
}
