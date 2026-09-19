import fs from 'node:fs';
import path from 'node:path';
import { authority, digest, ensure, sha, text, validId, telemetry } from './evidence.mjs';

/** General code guidance, with task evidence; never executable authority or an automatic patch. */
export class LearningMemory {
  constructor(store) { this.store = store; }
  propose(proposal) {
    ensure(text(proposal.guidance) && proposal.guidance.length <= 6000, 'Guidance must be concise');
    ensure(text(proposal.appliesWhen) && text(proposal.doNotApplyWhen), 'Applicability and limitations required');
    ensure(text(proposal.project) && Array.isArray(proposal.families) && proposal.families.length, 'Project and task families required');
    ensure(Array.isArray(proposal.evidenceRuns) && new Set(proposal.evidenceRuns).size >= 2, 'Two distinct verified discovery tasks required');
    const evidence = proposal.evidenceRuns.map(id => this.store.get('runs', id));
    ensure(new Set(evidence.map(r => r.body.taskId)).size === evidence.length, 'Duplicate discovery task');
    for (const r of evidence) {
      ensure(r.body.mode === 'discovery' && r.body.accepted === true && r.body.project === proposal.project, 'Only accepted discovery runs from this project can teach');
      ensure(r.body.checks?.length && r.body.checks.every(c => c.exitCode === 0 && c.beforeHash === c.afterHash), 'Independent verification required');
      for (const c of r.body.checks) this.store.readBlob(c.log);
      ensure(telemetry(this.store.readBlob(r.body.trace)).complete, 'Discovery telemetry incomplete');
    }
    ensure(proposal.dependencies && Object.keys(proposal.dependencies).length, 'Source-bound dependencies required');
    for (const [file, hash] of Object.entries(proposal.dependencies)) ensure(!path.isAbsolute(file) && !file.split(/[\\/]/).includes('..') && /^[a-f0-9]{64}$/.test(hash), 'Invalid source dependency');
    const body = { ...proposal, evidence: evidence.map(r => ({ id: r.body.id, sha256: r.sha256 })), createdAt: new Date().toISOString() };
    const id = 'lesson-' + digest(proposal).slice(0, 20);
    return this.store.put('lessons', id, { ...body, id });
  }
  state(id, root, now = Date.now()) {
    const lesson = this.store.get('lessons', id);
    for (const e of lesson.body.evidence) ensure(this.store.get('runs', e.id).sha256 === e.sha256, 'Lesson provenance changed');
    if (this.store.all('retirements').some(r => r.body.lesson === id)) return { state: 'retired', lesson };
    if (root && Object.entries(lesson.body.dependencies).some(([file, hash]) => {
      try { const target=path.resolve(root,file);return !target.startsWith(path.resolve(root)+path.sep)||sha(fs.readFileSync(target))!==hash; } catch { return true; }
    })) return { state: 'stale', lesson };
    const approvals = this.store.all('approvals').filter(r => r.body.lesson === id && r.body.lessonSha256 === lesson.sha256 && Date.parse(r.body.authority.expiresAt) > now);
    const valid = approvals.some(a => {
      try { const cert=this.store.get('certificates',a.body.certificate);return cert.sha256===a.body.certificateSha256 && cert.body.learningSupported && cert.body.lessonIds.includes(id); } catch { return false; }
    });
    return { state: valid ? 'approved' : 'candidate', lesson };
  }
  approve(id, certificateId, decision) {
    authority(decision, `live:${id}`);
    const lesson=this.store.get('lessons',id), certificate=this.store.get('certificates',certificateId);
    ensure(certificate.body.learningSupported && certificate.body.lessonIds.includes(id), 'Measured transfer certificate required before live approval');
    ensure(this.state(id).state!=='retired','Retirement is terminal');
    return this.store.put('approvals',`${id}-${Date.now()}`,{lesson:id,lessonSha256:lesson.sha256,certificate:certificateId,certificateSha256:certificate.sha256,authority:decision});
  }
  retire(id, reason, source) {
    this.store.get('lessons',id);ensure(text(reason)&&text(source),'Retirement reason and evidence required');
    return this.store.put('retirements',`${id}-${Date.now()}`,{lesson:id,reason,source,at:new Date().toISOString()});
  }
  retrieve({ project, family, root, maxChars = 4000 }) {
    ensure(Number.isSafeInteger(maxChars)&&maxChars>0&&maxChars<=12000,'Invalid context budget');
    let used=0;
    return this.store.all('lessons').filter(r=>r.body.project===project&&r.body.families.includes(family)).flatMap(r=>{
      const s=this.state(r.body.id,root);if(s.state!=='approved')return[];
      const guidance=`${r.body.guidance}\nApply when: ${r.body.appliesWhen}\nDo not apply when: ${r.body.doNotApplyWhen}`;
      if(used+guidance.length>maxChars)return[];used+=guidance.length;return[{id:r.body.id,sha256:r.sha256,guidance}];
    });
  }
  freeze(plan) {
    validId(plan.id);authority(plan.authorization,`evaluation:${plan.id}`);
    ensure(text(plan.model)&&text(plan.reasoningEffort)&&text(plan.costScope),'Model, settings and accounting scope required');
    ensure(Array.isArray(plan.tasks)&&plan.tasks.length>=6,'At least six predeclared holdout tasks required');
    ensure(new Set(plan.tasks.map(t=>t.id)).size===plan.tasks.length,'Duplicate task IDs');
    ensure(plan.tasks.every(t=>text(t.project)&&text(t.family)&&text(t.prompt)&&t.sourceHashes&&t.checks?.length&&t.allowedFiles?.length),'Each task needs source, checks and allowed files');
    ensure(Number.isInteger(plan.timeoutMs)&&plan.timeoutMs>=1000&&plan.timeoutMs<=900000,'Bounded timeout required');
    const lessons=(plan.lessonIds??[]).map(id=>this.store.get('lessons',id));
    ensure(lessons.length,'No learned guidance to evaluate');
    const discovery=new Set(lessons.flatMap(l=>l.body.evidenceRuns.map(id=>this.store.get('runs',id).body.taskId)));
    ensure(plan.tasks.every(t=>!discovery.has(t.id)),'Discovery/holdout task overlap');
    for(const l of lessons)ensure(this.state(l.body.id).state!=='retired','Retired lesson');
    for(const t of plan.tasks){
      validId(t.id);
      for(const c of t.checks)ensure(text(c.file)&&/^[a-f0-9]{64}$/.test(c.sha256)&&Array.isArray(c.args),'Checks must be pinned scripts');
      for(const l of lessons.filter(l=>l.body.project===t.project&&l.body.families.includes(t.family)))
        ensure(Object.entries(l.body.dependencies).every(([file,hash])=>t.sourceHashes[file]===hash),'Stale lesson dependency');
    }
    return this.store.put('plans',plan.id,{...plan,lessonVersions:lessons.map(l=>({id:l.body.id,sha256:l.sha256})),frozenAt:new Date().toISOString()});
  }
  experimentalGuidance(planId, task) {
    const plan=this.store.get('plans',planId).body;authority(plan.authorization,`evaluation:${planId}`);
    return plan.lessonVersions.flatMap(v=>{
      const l=this.store.get('lessons',v.id);ensure(l.sha256===v.sha256,'Frozen lesson changed');
      ensure(this.state(v.id).state!=='retired','Frozen lesson was retired');
      if(l.body.project!==task.project||!l.body.families.includes(task.family))return[];
      return [{id:v.id,sha256:v.sha256,guidance:`${l.body.guidance}\nApply when: ${l.body.appliesWhen}\nDo not apply when: ${l.body.doNotApplyWhen}`}];
    });
  }
}
