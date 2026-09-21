import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AuthorityLedger } from './AuthorityLedger';
import { GovernanceEngine } from './GovernanceEngine';
import { ReceiptStore } from './ReceiptStore';
import { StateStore } from './StateStore';
import { Authorization, Intent, Proposal, Receipt } from './types/primitives';
import { CESynthesizer, loadKnowledge } from '../intelligence/ce/synthesizer';

/**
 * Do UI-GATES' documented promises hold in code?
 *
 * Every check is named after a claim in README.md, docs/architecture.md or
 * docs/knowledge-model.md and fails if the code stops keeping it. Where a check
 * could pass by denying everything, a positive control sits beside it.
 *
 * Run: npx tsx plugins/uigates/core/promises_test.ts
 */

const realLog = console.log;
const realWarn = console.warn;
function quiet<T>(fn: () => T): T {
  console.log = () => {};
  console.warn = () => {};
  try { return fn(); } finally { console.log = realLog; console.warn = realWarn; }
}

const results: { section: string; name: string; pass: boolean; detail: string }[] = [];
let section = '';
function check(name: string, pass: boolean, detail = ''): void {
  results.push({ section, name, pass, detail });
  realLog(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
/** Runs fn and returns the thrown message, or null if it did not throw. */
function threw(fn: () => unknown): string | null {
  try { fn(); return null; } catch (e) { return e instanceof Error ? e.message : String(e); }
}

// ---------- fixtures ----------

const hour = 3600000;
const mkIntent = (o: Partial<Intent> = {}): Intent => ({
  id: 'i1', principalId: 'bob', goal: 'g', constraints: [], successEvidence: [], authorityDomain: ['src/'],
  expiry: new Date(Date.now() + hour), createdAt: new Date(), ...o,
});
let pn = 0;
const mkProposal = (o: Partial<Proposal> = {}): Proposal => ({
  id: `p${++pn}`, intentId: 'i1', actorId: 'agent', action: 'edit', resource: 'src/a.ts', rationale: 'r',
  impact: 'low', risk: 'r', authorityRequested: 'delegated', verificationPlan: 'tests', proposedAt: new Date(), ...o,
});
function issue(gov: GovernanceEngine, intent: Intent, p: Proposal): Authorization {
  const ev = gov.evaluate(p, intent);
  return gov.authorize(p, intent.principalId, ev.suggestedState);
}
let rn = 0;
const mkReceipt = (a: Authorization, o: Partial<Receipt> = {}): Receipt => ({
  id: `r${++rn}`, authorizationId: a.id, intentId: a.intentId, actorId: a.actorId, actionPerformed: a.action,
  expectedOutcome: 'tests pass', actualOutcome: 'Verified success', delta: 'None', evidence: ['run.log'],
  verifiedAt: new Date(), ...o,
});
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'uigates-promises-'));

interface World { root: string; store: ReceiptStore; ledger: AuthorityLedger; synth: CESynthesizer }
function world(): World {
  const root = tmp();
  const store = new ReceiptStore();
  const ledger = new AuthorityLedger();
  return { root, store, ledger, synth: new CESynthesizer(store, root, ledger, { evidenceVerifier: r => r.evidence.some(e => e.trim().length > 0) }) };
}
/** One authorized, executed, recorded receipt under its own intent. */
function executed(w: World, o: { intent: string; action: string; principal?: string; actor?: string; success?: boolean; delta?: string }): Receipt {
  const intent = mkIntent({ id: o.intent, principalId: o.principal ?? 'bob' });
  const p = mkProposal({ intentId: intent.id, actorId: o.actor ?? 'agent', action: o.action });
  const auth = issue(new GovernanceEngine([], w.ledger), intent, p);
  const ok = o.success !== false;
  const r = mkReceipt(auth, ok ? {} : { actualOutcome: 'Failed tests', delta: o.delta ?? 'Regression' });
  quiet(() => w.store.record(r));
  return r;
}
const synth = (w: World, intent: string) => quiet(() => w.synth.synthesize(intent));
const pack = (w: World, action: string) => loadKnowledge(w.root).find(p => p.action === action);

// ---------- A. The authority plane ----------

async function authority() {
  section = 'A';
  realLog('\n=== A. AUTHORITY: "is this actor authorized, on this resource, under this intent, right now?" ===\n');

  // Positive control first: the engine still says yes to ordinary, in-bounds work.
  {
    const gov = new GovernanceEngine();
    const ev = gov.evaluate(mkProposal(), mkIntent());
    check('A0 control: an in-domain, low-impact action by a listed principal is delegated', ev.suggestedState === 'delegated' && !ev.denied, ev.suggestedState);
  }

  // "time-bounded"
  {
    const ev = new GovernanceEngine().evaluate(mkProposal(), mkIntent({ expiry: new Date(Date.now() - 86400000) }));
    check('A1 an expired intent grants nothing', ev.denied && ev.suggestedState === 'prohibited', ev.rationale);
  }
  {
    const gov = new GovernanceEngine();
    const intent = mkIntent({ expiry: new Date(Date.now() + 25) });
    const p = mkProposal();
    const ev = gov.evaluate(p, intent);
    await new Promise(r => setTimeout(r, 60));
    const err = threw(() => gov.authorize(p, 'bob', ev.suggestedState));
    check('A2 an intent that expires between evaluation and authorization cannot be authorized', !!err && /expired/.test(err), err ?? 'authorized');
  }
  {
    const gov = new GovernanceEngine();
    const intent = mkIntent({ expiry: new Date(Date.now() + 60000) });
    const auth = issue(gov, intent, mkProposal());
    const late = gov.ledger.admitReceipt(mkReceipt(auth, { verifiedAt: new Date(Date.now() + 120000) }));
    const early = gov.ledger.admitReceipt(mkReceipt(auth, { verifiedAt: new Date(Date.now() - 60000) }));
    check('A3 a receipt produced after its authorization expired is refused', !late.ok && /expired/.test(late.reason), late.reason);
    check('A3b a receipt that predates its authorization is refused', !early.ok && /predates/.test(early.reason), early.reason);
  }

  // "actor-bounded"
  {
    const gov = new GovernanceEngine();
    const intent = mkIntent({ authorizedActors: ['agent-a'] });
    const yes = gov.evaluate(mkProposal({ actorId: 'agent-a' }), intent);
    const no = gov.evaluate(mkProposal({ actorId: 'agent-b' }), intent);
    check('A4 an intent that names its actors excludes everyone else (and still admits the named one)',
      yes.suggestedState === 'delegated' && no.denied, `agent-a=${yes.suggestedState}, agent-b=${no.suggestedState}`);
  }
  {
    const gov = new GovernanceEngine();
    const auth = issue(gov, mkIntent(), mkProposal({ actorId: 'agent-a' }));
    const v = gov.ledger.admitReceipt(mkReceipt(auth, { actorId: 'agent-b' }));
    check('A5 authority issued to one actor cannot be used by another', !v.ok && /agent-a/.test(v.reason), v.reason);
  }

  // "Prohibited: alter authority records / disable audit"
  {
    const gov = new GovernanceEngine();
    const wide = mkIntent({ authorityDomain: ['/'] }); // the domain the repo's own tests use
    const targets = ['.uigates/authorizations/a.json', '.uigates/receipts/r.json', '.uigates/intents/i.json', '.uigates/proposals/p.json', 'src/../.uigates/receipts/r.json', './.uigates/authorizations/a.json'];
    const outcomes = targets.map(t => gov.evaluate(mkProposal({ resource: t }), wide));
    check('A6 authority and audit records are prohibited, even under a wide domain and via path tricks',
      outcomes.every(o => o.denied), outcomes.map(o => o.suggestedState).join(','));
    const knowledge = gov.evaluate(mkProposal({ resource: '.uigates/knowledge/compound_packs/x.md' }), wide);
    check('A6b knowledge cannot be hand-edited without a principal decision (gated)', knowledge.suggestedState === 'gated' && !knowledge.denied, knowledge.suggestedState);
    const source = gov.evaluate(mkProposal({ resource: 'src/app.ts' }), wide);
    check('A6c control: ordinary source under the same wide domain is still delegated', source.suggestedState === 'delegated', source.suggestedState);
  }

  // "Execution never implies authorization"
  {
    const gov = new GovernanceEngine();
    const intent = mkIntent();
    const never = threw(() => gov.authorize(mkProposal({ id: 'unseen' }), 'bob', 'delegated'));
    check('A7 a proposal that was never evaluated cannot be authorized', !!never && /never evaluated/.test(never), never ?? 'authorized');

    const bad = mkProposal({ resource: '../../etc/passwd' });
    gov.evaluate(bad, intent);
    const denied = threw(() => gov.authorize(bad, 'bob', 'delegated'));
    check('A7b a denied proposal cannot be authorized, whatever state is asked for', !!denied && /denied/.test(denied), denied ?? 'authorized');

    const ok = mkProposal();
    gov.evaluate(ok, intent);
    const stranger = threw(() => gov.authorize(ok, 'random-person', 'delegated'));
    check('A7c only the intent\'s principal can grant authority', !!stranger && /principal/.test(stranger), stranger ?? 'authorized');

    const medium = mkProposal({ impact: 'medium' });
    const ev = gov.evaluate(medium, intent);
    const upgrade = threw(() => gov.authorize(medium, 'bob', 'delegated'));
    check('A7d a gated proposal cannot be quietly authorized as delegated', ev.suggestedState === 'gated' && !!upgrade && /resolved to gated/.test(upgrade), upgrade ?? 'authorized');

    const original = mkProposal({ resource: 'src/a.ts' });
    gov.evaluate(original, intent);
    const swapped = threw(() => gov.authorize({ ...original, resource: 'src/secrets.ts' }, 'bob', 'delegated'));
    check('A7e authority cannot be minted for a different proposal than the one evaluated', !!swapped && /differs/.test(swapped), swapped ?? 'authorized');

    const p = mkProposal();
    const ev2 = gov.evaluate(p, intent);
    const auth = gov.authorize(p, 'bob', ev2.suggestedState);
    check('A7f control: the honest path yields an authorization bound to actor, intent, action, resource and expiry',
      auth.actorId === p.actorId && auth.intentId === intent.id && auth.action === p.action && auth.resource === p.resource && !!auth.expiry && auth.authorizedBy === 'bob');
  }

  // "Authority is ... action- and intent-bounded"; one execution, one authorization
  {
    const gov = new GovernanceEngine();
    const auth = issue(gov, mkIntent(), mkProposal({ action: 'refactor' }));
    const first = mkReceipt(auth);
    const other = gov.ledger.admitReceipt(mkReceipt(auth, { actionPerformed: 'deploy to prod' }));
    const elsewhere = gov.ledger.admitReceipt(mkReceipt(auth, { intentId: 'someone-elses-intent' }));
    const ok = gov.ledger.admitReceipt(first);
    const again = gov.ledger.admitReceipt(first);
    const replay = gov.ledger.admitReceipt(mkReceipt(auth));
    check('A8 authority covers only the action it was issued for', !other.ok && /covers/.test(other.reason), other.reason);
    check('A8b authority covers only the intent it was issued under', !elsewhere.ok && /intent/.test(elsewhere.reason), elsewhere.reason);
    check('A8c control: the matching receipt is admitted, and re-admitting it is idempotent', ok.ok && again.ok);
    check('A8d one authorization cannot be spent on a second receipt', !replay.ok && /already spent/.test(replay.reason), replay.reason);
  }
}

// ---------- B. Receipts ----------

function receipts() {
  section = 'B';
  realLog('\n=== B. RECEIPTS: "an immutable record of an authorized execution and its outcome" ===\n');

  const base: Receipt = {
    id: 'r1', authorizationId: 'a', intentId: 'i', actorId: 'x', actionPerformed: 'deploy', expectedOutcome: 'ok',
    actualOutcome: 'Failed', delta: 'Bug', evidence: ['log'], verifiedAt: new Date(),
  };
  {
    const rs = new ReceiptStore();
    quiet(() => rs.record(base));
    const rewrite = threw(() => quiet(() => rs.record({ ...base, actualOutcome: 'Verified success', delta: 'None' })));
    check('B1 re-recording an id with different content is refused', !!rewrite && /immutable/.test(rewrite) && rs.get('r1')!.actualOutcome === 'Failed', rewrite ?? 'overwritten');
    const same = threw(() => quiet(() => rs.record({ ...base })));
    check('B1b control: re-recording identical content is a harmless no-op', same === null);
  }
  {
    const rs = new ReceiptStore();
    quiet(() => rs.record(base));
    const stored = rs.get('r1') as any;
    threw(() => { stored.actualOutcome = 'Verified success'; });
    threw(() => { stored.evidence.push('forged.log'); });
    check('B2 a stored receipt cannot be edited through the reference handed out', stored.actualOutcome === 'Failed' && stored.evidence.length === 1);
    const input: Receipt = { ...base, id: 'r2', evidence: ['log'] };
    quiet(() => rs.record(input));
    input.actualOutcome = 'Verified success';
    check('B2b editing the object you passed in does not change what was recorded', rs.get('r2')!.actualOutcome === 'Failed');
  }
  {
    const rs = new ReceiptStore();
    quiet(() => rs.record(base));
    check('B3 control: an untouched receipt passes its integrity check', rs.verifyIntegrity('r1'));
    rs.get('r1')!.verifiedAt.setTime(0); // Dates cannot be frozen; tampering must still be detectable
    check('B3b in-place tampering that freezing cannot stop (a Date) is detected', !rs.verifyIntegrity('r1'));
  }
  {
    const root = tmp();
    const st = new StateStore(root);
    const gov = new GovernanceEngine();
    const auth = issue(gov, mkIntent(), mkProposal());
    const r = mkReceipt(auth);
    st.saveReceipt(r);
    check('B4 control: saving the same receipt twice is fine', threw(() => st.saveReceipt(r)) === null);
    check('B4b an on-disk receipt cannot be rewritten', /write-once/.test(threw(() => st.saveReceipt({ ...r, actualOutcome: 'Failed' })) ?? ''));
    st.saveAuthorization(auth);
    check('B4c an on-disk authorization cannot be rewritten (no self-extension of authority)',
      /write-once/.test(threw(() => st.saveAuthorization({ ...auth, state: 'gated', expiry: new Date(Date.now() + 999 * hour) })) ?? ''));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// ---------- C. Synthesis and the knowledge model ----------

async function knowledge() {
  section = 'C';
  realLog('\n=== C. KNOWLEDGE: "verified work synthesizes into reusable knowledge", earned, not assumed ===\n');

  // Fail closed
  {
    const store = new ReceiptStore();
    const root = tmp();
    const err = threw(() => new (CESynthesizer as any)(store, root));
    check('C0 a synthesizer without an authority source refuses to exist (fail closed)', !!err && /AuthorityLedger/.test(err), err ?? 'constructed');
    check('C0b the opt-out is explicit, never the default', threw(() => new CESynthesizer(store, root, 'unverified')) === null);
    fs.rmSync(root, { recursive: true, force: true });
  }

  // "Receipt: an authorized execution" -> only those become knowledge
  {
    const w = world();
    const good = executed(w, { intent: 'i1', action: 'Use HMAC for sessions' });
    quiet(() => w.store.record({
      id: 'ghost', authorizationId: 'auth_DOES_NOT_EXIST', intentId: 'i1', actorId: 'nobody', actionPerformed: 'Rotate prod keys',
      expectedOutcome: 'ok', actualOutcome: 'Verified success', delta: 'None', evidence: ['trust-me.log'], verifiedAt: new Date(),
    }));
    await synth(w, 'i1');
    const actions = loadKnowledge(w.root).map(p => p.action);
    const rej = w.synth.getRejections();
    check('C1 a receipt citing an authorization nobody issued becomes no knowledge, and the refusal is on record',
      actions.length === 1 && actions[0] === 'Use HMAC for sessions' && rej.length === 1 && rej[0].receiptId === 'ghost' && /never issued/.test(rej[0].reason),
      `packs=[${actions}] rejections=${JSON.stringify(rej.map(r => r.reason))}`);
    check('C1b control: the genuinely authorized receipt was promoted', !!good && actions.includes('Use HMAC for sessions'));
    fs.rmSync(w.root, { recursive: true, force: true });
  }
  {
    // Denial-of-knowledge: a forged failure must not push good knowledge into conflict.
    const w = world();
    executed(w, { intent: 'i1', action: 'Cache with TTL' });
    await synth(w, 'i1');
    quiet(() => w.store.record({
      id: 'forged-fail', authorizationId: 'nope', intentId: 'i2', actorId: 'saboteur', actionPerformed: 'Cache with TTL',
      expectedOutcome: 'ok', actualOutcome: 'Failed', delta: 'Total meltdown', evidence: ['x'], verifiedAt: new Date(),
    }));
    await synth(w, 'i2');
    check('C2 a forged failure cannot conflict out good knowledge', pack(w, 'Cache with TTL')?.status === 'verified', pack(w, 'Cache with TTL')?.status);
    // and a tampered stored receipt is refused
    const r = executed(w, { intent: 'i3', action: 'Batch writes' });
    w.store.get(r.id)!.verifiedAt.setTime(0);
    await synth(w, 'i3');
    check('C2b a receipt altered after recording is refused', !pack(w, 'Batch writes') && w.synth.getRejections().some(x => /no longer matches/.test(x.reason)));
    fs.rmSync(w.root, { recursive: true, force: true });
  }

  // Promotion ladder (portfolio canon): "Promotion is never automatic and never self-awarded."
  {
    const w = world();
    const act = 'Validate sessions server-side';
    executed(w, { intent: 'i1', action: act, principal: 'alice' });
    await synth(w, 'i1');
    let p = pack(w, act)!;
    const text = () => fs.readFileSync(path.join(w.root, '.uigates/knowledge/compound_packs', p.file), 'utf8');
    check('C3 one verified success earns Task, not Knowledge, and is not yet a candidate', p.level === 'task' && !p.candidate && !/Proven Pattern/.test(text()) && /not confirmed yet/.test(text()), `${p.level}`);

    executed(w, { intent: 'i1', action: act, principal: 'alice' });
    await synth(w, 'i1');
    p = pack(w, act)!;
    check('C3b repeating it inside the same task does not make it reusable across tasks', p.level === 'task' && !p.candidate && p.intents.length === 1, `${p.level}, ${p.intents.length} intent(s)`);

    executed(w, { intent: 'i2', action: act, principal: 'alice' });
    await synth(w, 'i2');
    p = pack(w, act)!;
    check('C3c verified in a second, distinct intent it becomes a candidate, and stays Task until a principal decides',
      p.level === 'task' && p.candidate && p.needsPrincipal && /promotion is never automatic/.test(text()), `${p.level}, candidate=${p.candidate}`);
    check('C3d the open question is explicit: the candidate is listed as awaiting a principal',
      w.synth.getEscalations().some(e => e.action === act && e.kind === 'candidate'), JSON.stringify(w.synth.getEscalations()));

    for (let i = 3; i <= 8; i++) { executed(w, { intent: `i${i}`, action: act, principal: 'alice' }); await synth(w, `i${i}`); }
    p = pack(w, act)!;
    check('C3e no amount of confirmed reuse promotes it by itself (8 distinct intents, still Task)', p.level === 'task' && p.candidate && p.intents.length === 8, `${p.level}, ${p.intents.length} intents`);

    const stranger = threw(() => w.synth.approveKnowledge(act, 'mallory'));
    const ok = threw(() => w.synth.approveKnowledge(act, 'alice'));
    p = pack(w, act)!;
    check('C3f a principal of the verifying intents promotes it to Knowledge; a stranger cannot',
      !!stranger && /not a principal/.test(stranger) && ok === null && p.level === 'knowledge' && !p.candidate && !p.needsPrincipal && /approved by alice/.test(text()), `stranger="${stranger}" level=${p.level}`);
    fs.rmSync(w.root, { recursive: true, force: true });
  }
  {
    // Rungs cannot be skipped, and only the right principal can climb them.
    const w = world();
    const act = 'Use idempotency keys';
    executed(w, { intent: 'i1', action: act, principal: 'alice' });
    await synth(w, 'i1');
    const single = threw(() => w.synth.approveKnowledge(act, 'alice'));
    const skipTask = threw(() => w.synth.approveCanon(act, 'alice'));
    executed(w, { intent: 'i2', action: act, principal: 'alice' });
    await synth(w, 'i2');
    const skipKnowledge = threw(() => w.synth.approveCanon(act, 'alice'));
    const promoted = threw(() => w.synth.approveKnowledge(act, 'alice'));
    const again = threw(() => w.synth.approveKnowledge(act, 'alice'));
    const strangerCanon = threw(() => w.synth.approveCanon(act, 'mallory'));
    const ok = threw(() => w.synth.approveCanon(act, 'alice'));
    check('C4 Knowledge needs a second task, Canon cannot skip Knowledge, and only a principal can grant Canon',
      !!single && /more than one task/.test(single) && !!skipTask && /Knowledge/.test(skipTask) && !!skipKnowledge && /Knowledge/.test(skipKnowledge)
      && promoted === null && !!again && /Already/.test(again) && !!strangerCanon && /not a principal/.test(strangerCanon) && ok === null && pack(w, act)?.level === 'canon',
      `single="${single}" skip="${skipKnowledge}" level=${pack(w, act)?.level}`);
    fs.rmSync(w.root, { recursive: true, force: true });
  }
  {
    const w = world();
    const act = 'Retry with backoff';
    executed(w, { intent: 'i1', action: act, principal: 'alice' });
    executed(w, { intent: 'i2', action: act, principal: 'alice' });
    await synth(w, 'i1'); await synth(w, 'i2');
    executed(w, { intent: 'j1', action: act, principal: 'alice', success: false, delta: 'Thundering herd under load' });
    await synth(w, 'j1');
    const err = threw(() => w.synth.approveKnowledge(act, 'alice'));
    check('C4b a lesson that is currently contradicted cannot be promoted', !!err && /conflicted/.test(err) && pack(w, act)!.level === 'task', err ?? 'promoted');
    fs.rmSync(w.root, { recursive: true, force: true });
  }

  // "Promotion standard": reuse guidance says when NOT to apply
  {
    const w = world();
    const act = 'Denormalize the read model';
    executed(w, { intent: 'i1', action: act });
    await synth(w, 'i1');
    let p = pack(w, act)!;
    const text = () => fs.readFileSync(path.join(w.root, '.uigates/knowledge/compound_packs', p.file), 'utf8');
    const before = text();
    check('C5 every pack states when to apply, when NOT to, and its limits',
      /Apply when/.test(before) && /Do NOT apply when/.test(before) && /Limits/.test(before) && /absence of failure is not proof/.test(before));
    executed(w, { intent: 'i2', action: act, success: false, delta: 'Stale reads after concurrent writes' });
    await synth(w, 'i2');
    check('C5b an observed failure becomes a recorded "do not apply" condition', /Stale reads after concurrent writes/.test(text()) && /Do NOT apply when: a later attempt failed/.test(text()));
    fs.rmSync(w.root, { recursive: true, force: true });
  }

  // "When current evidence conflicts with a prior decision ... resolve ... or request principal approval"
  {
    const w = world();
    const act = 'Shard by tenant';
    executed(w, { intent: 'i1', action: act, principal: 'alice' });
    await synth(w, 'i1');
    executed(w, { intent: 'i2', action: act, principal: 'alice' });
    await synth(w, 'i2');
    const promotedK = threw(() => w.synth.approveKnowledge(act, 'alice'));
    const files = () => fs.readdirSync(path.join(w.root, '.uigates/knowledge/compound_packs')).length;
    executed(w, { intent: 'i3', action: act, principal: 'alice', success: false, delta: 'Hot shard' });
    await synth(w, 'i3');
    let p = pack(w, act)!;
    check('C6 a contradiction withholds the recommendation but keeps the evidence, and flags that a principal should look',
      promotedK === null && p.status === 'conflicted' && p.level === 'knowledge' && files() === 1 && p.needsPrincipal && p.failureModes.includes('Hot shard') && w.synth.getEscalations().some(e => e.kind === 'conflict'), `${p.status}, needsPrincipal=${p.needsPrincipal}`);
    executed(w, { intent: 'i4', action: act, principal: 'alice' });
    await synth(w, 'i4');
    p = pack(w, act)!;
    check('C6b newer verified evidence resolves the conflict', p.status === 'verified', p.status);

    const stranger = threw(() => w.synth.retire(act, 'mallory'));
    const retired = threw(() => w.synth.retire(act, 'alice'));
    executed(w, { intent: 'i5', action: act, principal: 'alice' });
    await synth(w, 'i5');
    check('C6c only a principal can retire a pack, and retirement is final', !!stranger && retired === null && pack(w, act)!.status === 'retired', `${stranger} / ${pack(w, act)!.status}`);
    fs.rmSync(w.root, { recursive: true, force: true });
  }

  // Idempotence / replay through synthesis
  {
    const w = world();
    executed(w, { intent: 'i1', action: 'Pin dependencies' });
    await synth(w, 'i1');
    const first = fs.readdirSync(path.join(w.root, '.uigates/knowledge/compound_packs')).map(f => fs.readFileSync(path.join(w.root, '.uigates/knowledge/compound_packs', f), 'utf8')).join();
    await synth(w, 'i1'); await synth(w, 'i1');
    const after = fs.readdirSync(path.join(w.root, '.uigates/knowledge/compound_packs')).map(f => fs.readFileSync(path.join(w.root, '.uigates/knowledge/compound_packs', f), 'utf8')).join();
    check('C7 synthesizing the same receipts again changes nothing (no self-inflicted rejections either)', first === after && w.synth.getRejections().length === 0);
    fs.rmSync(w.root, { recursive: true, force: true });
  }
}

// ---------- D. Execute discipline ----------

function replanning() {
  section = 'D';
  realLog('\n=== D. EXECUTE: "do not retry on a delta without first returning to planning" ===\n');

  const setupTask = () => {
    const rs = new ReceiptStore();
    const gov = new GovernanceEngine([], new AuthorityLedger(), rs);
    const intent = mkIntent();
    const attempt = (over: Partial<Proposal> = {}) => mkProposal({ taskId: 'T1', ...over });
    const run = (p: Proposal, receipt: Partial<Receipt>) => {
      const auth = issue(gov, intent, p);
      const r = mkReceipt(auth, { taskId: p.taskId, ...receipt });
      quiet(() => rs.record(r));
      return r;
    };
    return { rs, gov, intent, attempt, run };
  };
  const good = (failed: Receipt) => ({ after: failed.id, rootCause: 'Off-by-one in the bounds check', revision: 'Clamp before comparing' });

  {
    const { gov, intent, attempt } = setupTask();
    const ev = gov.evaluate(attempt(), intent);
    check('D0 control: the first attempt at a task needs no replan', ev.suggestedState === 'delegated' && !ev.denied, ev.suggestedState);
  }
  {
    const { gov, intent, attempt, run } = setupTask();
    const failed = run(attempt(), { actualOutcome: 'Failed tests', delta: 'Off-by-one' });
    const bare = gov.evaluate(attempt(), intent);
    check('D1 a retry after a delta is refused unless it carries a replan', bare.denied && /Return to planning/.test(bare.rationale), bare.rationale.slice(0, 80));

    const wrongReceipt = gov.evaluate(attempt({ replan: { ...good(failed), after: 'some-other-receipt' } }), intent);
    check('D2 a replan must cite the receipt that actually failed', wrongReceipt.denied);

    const noCause = gov.evaluate(attempt({ replan: { ...good(failed), rootCause: '' } }), intent);
    const noRevision = gov.evaluate(attempt({ replan: { ...good(failed), revision: '  ' } }), intent);
    const placeholder = gov.evaluate(attempt({ replan: { ...good(failed), rootCause: 'TBD' } }), intent);
    check('D3 a replan must state a root cause and a revision (blank and placeholder text do not count)', noCause.denied && noRevision.denied && placeholder.denied);

    const p = attempt({ replan: good(failed) });
    const ok = gov.evaluate(p, intent);
    check('D4 control: a retry that carries a proper replan is evaluated like any other proposal', !ok.denied && ok.suggestedState === 'delegated', ok.suggestedState);
    const swapped = threw(() => gov.authorize({ ...p, replan: undefined }, 'bob', ok.suggestedState));
    check('D4b the replan is bound to the authorization: it cannot be dropped between evaluation and authorize', !!swapped && /differs/.test(swapped), swapped ?? 'authorized');
  }
  {
    const { gov, intent, attempt, run } = setupTask();
    const failed = run(attempt(), { actualOutcome: 'Failed tests', delta: 'Off-by-one' });
    run(attempt({ replan: good(failed) }), {});
    const next = gov.evaluate(attempt(), intent);
    check('D5 once the task has succeeded the delta is cleared and no replan is needed', !next.denied, next.rationale);
  }
  {
    const { gov, intent, attempt, run } = setupTask();
    run(attempt(), { actualOutcome: 'Failed tests', delta: 'Off-by-one' });
    const other = gov.evaluate(attempt({ taskId: 'T2' }), intent);
    const untracked = gov.evaluate(mkProposal({ taskId: undefined }), intent);
    check('D6 only the failed task is held: other tasks proceed', !other.denied);
    check('D6b a proposal with no task identity is never treated as a retry (the rule needs taskId)', !untracked.denied);
  }
  {
    const { gov, attempt, run } = setupTask();
    run(attempt(), { actualOutcome: 'Failed tests', delta: 'Off-by-one' });
    const otherIntent = gov.evaluate(mkProposal({ taskId: 'T1', intentId: 'i-other' }), mkIntent({ id: 'i-other' }));
    check('D7 a failure under one intent does not gate the same task id under another', !otherIntent.denied);
  }
  {
    const gov = new GovernanceEngine();
    const failedBare = mkReceipt(issue(gov, mkIntent(), mkProposal({ taskId: 'T1' })), { taskId: 'T1', delta: 'Off-by-one' });
    const ev = gov.evaluate(mkProposal({ taskId: 'T1' }), mkIntent());
    check('D8 stated limit: an engine that is not given the receipt store cannot apply the rule', !ev.denied && !!failedBare, 'rule is opt-in via the third constructor argument');
  }
}

async function main() {
  await authority();
  receipts();
  await knowledge();
  replanning();

  const failed = results.filter(r => !r.pass);
  realLog(`\n=== SUMMARY: ${results.length - failed.length}/${results.length} promises kept ===`);
  for (const f of failed) realLog(`  BROKEN [${f.section}] ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch(e => {
  // A crash must still say which promises had already been found broken.
  const failed = results.filter(r => !r.pass);
  realLog(`
=== CRASHED after ${results.length} checks: ${e instanceof Error ? e.message : e} ===`);
  for (const f of failed) realLog(`  BROKEN [${f.section}] ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  process.exit(2);
});
