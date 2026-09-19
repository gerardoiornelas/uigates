import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { parseArgs } from 'util';
import { Runtime } from '../core/Runtime';
import { CESynthesizer, loadKnowledge } from '../intelligence/ce/synthesizer';
import { Authorization, Intent, Proposal, Receipt } from '../core/types/primitives';

/**
 * `uig` — the engine CLI an agent uses to make a /uig session real: intents, proposals and
 * authorizations pass through GovernanceEngine, evidence is produced (not claimed) by this tool,
 * and synthesis is CESynthesizer. State lives in `<root>/.uig/` and is rebuilt on every call.
 */

class UsageError extends Error {}

const HELP = `UI-GATES engine CLI

  uig start "<goal>" --domain <path>... --success <evidence>... [--constraint <text>...]
            [--principal <id>] [--expires-in-hours <n> | --expires <ISO date>] [--actor <id>...]
  uig propose <intentId> --action <text> --resource <path> --impact low|medium|high
            --rationale <text> --risk <text> --verify <plan> [--actor <id>] [--task <id>]
            [--replan-after <receiptId> --root-cause <text> --revision <text>]
  uig authorize <proposalId> [--approved-by <principal>]
  uig receipt <authorizationId> --run "<verification command>" [--timeout-sec <n>]
  uig receipt <authorizationId> --evidence <file>... --outcome <text> --delta <text|None>
  uig synthesize <intentId>
  uig knowledge
  uig approve knowledge|canon "<action>" --principal <id>
  uig retire "<action>" --principal <id>
  uig status [intentId]

  --root <dir>    project root (default: UIG_ROOT or the current directory)

Records live in <root>/.uig/. Delegated actions inside the intent's scope are authorized by the
intent itself. A gated action needs the principal's approval in conversation first; only then pass
--approved-by. Principal decisions (approve, retire, --approved-by) must come from the user, never
from the agent. For the learning/evaluation harness: node plugins/uigates/learning/cli.mjs help`;

const MAX_LOG = 1_000_000;

function fail(message: string): never { throw new UsageError(message); }

function principalFor(root: string, given?: string): string {
  if (given) return given;
  if (process.env.UIG_PRINCIPAL) return process.env.UIG_PRINCIPAL;
  const git = spawnSync('git', ['config', 'user.email'], { cwd: root, encoding: 'utf8' });
  const email = git.status === 0 ? git.stdout.trim() : '';
  if (email) return email;
  return fail('No principal. Pass --principal <id>, set UIG_PRINCIPAL, or configure git user.email. The principal owns the intent and signs its authority.');
}

function expiryFrom(hours?: string, iso?: string): Date {
  if (iso) {
    const at = new Date(iso);
    if (!Number.isFinite(at.getTime()) || at.getTime() <= Date.now()) fail(`--expires "${iso}" is not a future date.`);
    return at;
  }
  const h = hours === undefined ? 24 : Number(hours);
  if (!Number.isFinite(h) || h <= 0) fail('--expires-in-hours must be a positive number.');
  return new Date(Date.now() + h * 3_600_000);
}

const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
const sha256 = (data: Uint8Array | string) => crypto.createHash('sha256').update(data).digest('hex');

function need<T>(value: T | undefined, flag: string): T {
  return value === undefined || value === '' ? fail(`Missing --${flag}.`) : value;
}

/** A hash-bound, project-relative evidence reference the synthesizer can independently re-verify. */
function evidenceRef(root: string, file: string): string {
  const base = fs.realpathSync(root);
  let real: string;
  try { real = fs.realpathSync(path.resolve(root, file)); } catch { return fail(`Evidence file not found: ${file}`); }
  if (!real.startsWith(base + path.sep)) fail(`Evidence must live inside the project root: ${file}`);
  return `sha256:${sha256(fs.readFileSync(real))}:${path.relative(base, real)}`;
}

function runVerification(rt: Runtime, receiptId: string, command: string, timeoutSec: number): { ref: string; exitCode: number | null; timedOut: boolean } {
  const startedAt = new Date();
  const run = spawnSync(command, { cwd: rt.root, shell: true, encoding: 'utf8', timeout: timeoutSec * 1000, maxBuffer: 64 * 1024 * 1024 });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  const exitCode = run.status;
  const clip = (text: string) => text.length > MAX_LOG ? `${text.slice(0, MAX_LOG)}\n[truncated at ${MAX_LOG} characters]` : text;
  const log = [
    `command: ${command}`,
    `cwd: ${rt.root}`,
    `started: ${startedAt.toISOString()}`,
    `finished: ${new Date().toISOString()}`,
    `exit: ${timedOut ? 'timed out' : exitCode === null ? `signal ${run.signal ?? 'unknown'}` : exitCode}`,
    '--- stdout ---', clip(run.stdout ?? ''),
    '--- stderr ---', clip(run.stderr ?? (run.error ? String(run.error) : '')),
  ].join('\n');
  const file = path.join(rt.state.evidenceDir, `${receiptId}.log`);
  fs.writeFileSync(file, log, { flag: 'wx' });
  return { ref: evidenceRef(rt.root, file), exitCode, timedOut };
}

function describeAuthorization(a: Authorization): string {
  return `${a.id}  ${a.state}  ${a.action} -> ${a.resource}`;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (!command || command === 'help' || command === '--help' || command === '-h') { console.log(HELP); return; }

  const { values: v, positionals } = parseArgs({
    args: argv.slice(1),
    allowPositionals: true,
    options: {
      root: { type: 'string' }, principal: { type: 'string' }, 'approved-by': { type: 'string' },
      domain: { type: 'string', multiple: true }, success: { type: 'string', multiple: true },
      constraint: { type: 'string', multiple: true }, actor: { type: 'string', multiple: true },
      'expires-in-hours': { type: 'string' }, expires: { type: 'string' },
      action: { type: 'string' }, resource: { type: 'string' }, impact: { type: 'string' },
      rationale: { type: 'string' }, risk: { type: 'string' }, verify: { type: 'string' }, task: { type: 'string' },
      'replan-after': { type: 'string' }, 'root-cause': { type: 'string' }, revision: { type: 'string' },
      run: { type: 'string' }, 'timeout-sec': { type: 'string' },
      evidence: { type: 'string', multiple: true }, outcome: { type: 'string' }, delta: { type: 'string' },
    },
  });
  const root = path.resolve(v.root ?? process.env.UIG_ROOT ?? process.cwd());
  if (!fs.existsSync(root)) fail(`Project root does not exist: ${root}`);
  const rt = new Runtime(root);
  if (rt.orphans.length) console.warn(`Warning: ${rt.orphans.length} authorization(s) lack their proposal or intent and authorize nothing: ${rt.orphans.join(', ')}`);

  switch (command) {
    case 'start': {
      const goal = need(positionals[0], 'goal (first argument)');
      const authorityDomain = need(v.domain, 'domain');
      const successEvidence = need(v.success, 'success');
      const intent: Intent = {
        id: newId('intent'),
        principalId: principalFor(root, v.principal),
        goal,
        constraints: v.constraint ?? [],
        successEvidence,
        authorityDomain,
        ...(v.actor ? { authorizedActors: v.actor } : {}),
        expiry: expiryFrom(v['expires-in-hours'], v.expires),
        createdAt: new Date(),
      };
      rt.state.saveIntent(intent);
      console.log(`Intent: ${intent.id}`);
      console.log(`Principal: ${intent.principalId}`);
      console.log(`Delegated domain: ${intent.authorityDomain.join(', ')}`);
      console.log(`Expires: ${new Date(intent.expiry).toISOString()}`);
      return;
    }

    case 'propose': {
      const intent = rt.state.getIntent(need(positionals[0], 'intentId (first argument)'));
      if (!intent) return fail('Intent not found.');
      const impact = need(v.impact, 'impact');
      if (impact !== 'low' && impact !== 'medium' && impact !== 'high') fail('--impact must be low, medium or high.');
      const replan = v['replan-after'] ? { after: v['replan-after'], rootCause: need(v['root-cause'], 'root-cause'), revision: need(v.revision, 'revision') } : undefined;
      const proposal: Proposal = {
        id: newId('prop'),
        intentId: intent.id,
        actorId: v.actor?.[0] ?? 'agent',
        action: need(v.action, 'action'),
        resource: need(v.resource, 'resource'),
        rationale: need(v.rationale, 'rationale'),
        impact,
        risk: need(v.risk, 'risk'),
        authorityRequested: impact === 'low' ? 'delegated' : 'gated',
        verificationPlan: need(v.verify, 'verify'),
        proposedAt: new Date(),
        ...(v.task ? { taskId: v.task } : {}),
        ...(replan ? { replan } : {}),
      };
      // Denied proposals are kept too: the audit trail should show what was attempted.
      rt.state.saveProposal(proposal);
      const evaluation = rt.gov.evaluate(proposal, intent);
      console.log(`Proposal: ${proposal.id}`);
      console.log(`Authority: ${evaluation.suggestedState}${evaluation.denied ? ' (DENIED)' : ''}`);
      console.log(`Why: ${evaluation.rationale}`);
      if (evaluation.denied) { process.exitCode = 1; return; }
      console.log(evaluation.suggestedState === 'gated'
        ? 'Next: ask the principal. Only after they approve, run: uig authorize ' + proposal.id + ' --approved-by ' + intent.principalId
        : 'Next: uig authorize ' + proposal.id);
      return;
    }

    case 'authorize': {
      const proposal = rt.state.getProposal(need(positionals[0], 'proposalId (first argument)'));
      if (!proposal) return fail('Proposal not found.');
      const intent = rt.state.getIntent(proposal.intentId);
      if (!intent) return fail('Intent not found.');
      const existing = rt.state.listAuthorizations().find(a => a.proposalId === proposal.id);
      if (existing) { console.log(`Already authorized: ${describeAuthorization(existing)}`); return; }
      const evaluation = rt.gov.evaluate(proposal, intent);
      if (evaluation.denied) { console.error(`Denied: ${evaluation.rationale}`); process.exitCode = 1; return; }
      if (evaluation.suggestedState === 'gated' && v['approved-by'] !== intent.principalId) {
        console.error(`Gated: ${evaluation.rationale}`);
        console.error(`Ask ${intent.principalId} and wait for a clear yes in this conversation. Then re-run with --approved-by ${intent.principalId}. The agent may not approve its own gated action.`);
        process.exitCode = 1;
        return;
      }
      const authorization = rt.gov.authorize(proposal, intent.principalId, evaluation.suggestedState);
      rt.state.saveAuthorization(authorization);
      console.log(`Authorization: ${authorization.id}`);
      console.log(`State: ${authorization.state}${authorization.state === 'gated' ? ` (approved by ${v['approved-by']})` : ' (delegated by the intent)'}`);
      console.log(`Scope: ${authorization.action} -> ${authorization.resource}, until ${new Date(authorization.expiry ?? intent.expiry).toISOString()}`);
      console.log(`Next: do the work, then: uig receipt ${authorization.id} --run "<verification command>"`);
      return;
    }

    case 'receipt': {
      const authorization = rt.state.getAuthorization(need(positionals[0], 'authorizationId (first argument)'));
      if (!authorization) return fail('Authorization not found.');
      const proposal = rt.state.getProposal(authorization.proposalId);
      if (!proposal) return fail('The authorization has no proposal on record.');
      if (rt.receipts.getByIntent(authorization.intentId).some(r => r.authorizationId === authorization.id)) {
        return fail(`Authorization ${authorization.id} already has a receipt. Each authorization covers one execution; propose again (with a replan, if it ended in a delta).`);
      }

      const id = newId('rec');
      let evidence: string[];
      let actualOutcome: string;
      let delta: string;
      if (v.run) {
        const timeout = Number(v['timeout-sec'] ?? 600);
        if (!Number.isFinite(timeout) || timeout <= 0) fail('--timeout-sec must be a positive number.');
        const result = runVerification(rt, id, v.run, timeout);
        evidence = [result.ref];
        const ok = result.exitCode === 0 && !result.timedOut;
        actualOutcome = ok ? 'Verified success: the verification command exited 0' : result.timedOut ? 'Failed: the verification command timed out' : `Failed: the verification command exited with code ${result.exitCode ?? 'signal'}`;
        delta = ok ? 'None' : `${result.timedOut ? 'timeout' : `exit code ${result.exitCode ?? 'signal'}`}; see the evidence log`;
      } else {
        evidence = (v.evidence ?? []).map(file => evidenceRef(root, file));
        if (!evidence.length) fail('Give --run "<command>" (the CLI executes and records it) or --evidence <file>... with --outcome and --delta.');
        actualOutcome = need(v.outcome, 'outcome');
        delta = need(v.delta, 'delta');
        console.log('Note: the outcome is asserted by the agent; only the evidence files are hashed. Prefer --run where a command can verify it.');
      }

      const receipt: Receipt = {
        id,
        authorizationId: authorization.id,
        intentId: authorization.intentId,
        actorId: authorization.actorId,
        actionPerformed: authorization.action,
        expectedOutcome: proposal.verificationPlan,
        actualOutcome,
        delta,
        evidence,
        verifiedAt: new Date(),
        ...(proposal.taskId ? { taskId: proposal.taskId } : {}),
      };
      const verdict = rt.gov.ledger.admitReceipt(receipt);
      if (!verdict.ok) return fail(`Receipt refused: ${verdict.reason}`);
      rt.state.saveReceipt(receipt);
      console.log(`Receipt: ${receipt.id}`);
      console.log(`Outcome: ${receipt.actualOutcome}`);
      console.log(`Delta: ${receipt.delta}`);
      console.log(`Evidence: ${receipt.evidence.join(', ')}`);
      if (delta.trim().toLowerCase() !== 'none') {
        console.log(`Next: return to planning. A retry needs: uig propose ... ${proposal.taskId ? `--task ${proposal.taskId} ` : ''}--replan-after ${receipt.id} --root-cause "<why>" --revision "<what changes>"`);
        process.exitCode = 1;
      } else {
        console.log(`Next: uig synthesize ${receipt.intentId}`);
      }
      return;
    }

    case 'synthesize': {
      const intentId = need(positionals[0], 'intentId (first argument)');
      if (!rt.state.getIntent(intentId)) return fail('Intent not found.');
      const synth = new CESynthesizer(rt.receipts, root, rt.gov.ledger);
      await synth.synthesize(intentId);
      for (const r of synth.getRejections()) console.log(`Rejected receipt ${r.receiptId}: ${r.reason}`);
      printKnowledge(root);
      for (const e of synth.getEscalations()) {
        console.log(`Needs the principal: ${e.kind} at ${e.level}: ${e.action}`);
      }
      return;
    }

    case 'knowledge': {
      printKnowledge(root);
      return;
    }

    case 'approve': {
      const level = positionals[0];
      const action = need(positionals[1], 'action (second argument)');
      const principal = need(v.principal, 'principal');
      const synth = new CESynthesizer(rt.receipts, root, rt.gov.ledger);
      if (level === 'knowledge') synth.approveKnowledge(action, principal);
      else if (level === 'canon') synth.approveCanon(action, principal);
      else return fail('Usage: uig approve knowledge|canon "<action>" --principal <id>');
      console.log(`${principal} approved "${action}" as ${level}.`);
      return;
    }

    case 'retire': {
      const action = need(positionals[0], 'action (first argument)');
      new CESynthesizer(rt.receipts, root, rt.gov.ledger).retire(action, need(v.principal, 'principal'));
      console.log(`Retired: ${action}`);
      return;
    }

    case 'status': {
      const intents = positionals[0] ? [rt.state.getIntent(positionals[0])].filter((i): i is Intent => !!i) : rt.state.listIntents();
      if (!intents.length) { console.log('No intents.'); return; }
      const proposals = rt.state.listProposals();
      const auths = rt.state.listAuthorizations();
      for (const intent of intents) {
        const own = proposals.filter(p => p.intentId === intent.id);
        const ownAuth = auths.filter(a => a.intentId === intent.id);
        const receipts = rt.receipts.getByIntent(intent.id);
        const expired = new Date(intent.expiry).getTime() <= Date.now();
        console.log(`${intent.id}  ${expired ? 'EXPIRED' : 'active'}  principal ${intent.principalId}  "${intent.goal}"`);
        console.log(`  proposals ${own.length}, authorized ${ownAuth.length}, receipts ${receipts.length} (${receipts.filter(r => r.delta.trim().toLowerCase() === 'none').length} delta-free)`);
        const unspent = ownAuth.filter(a => !receipts.some(r => r.authorizationId === a.id));
        for (const a of unspent) console.log(`  awaiting receipt: ${describeAuthorization(a)}`);
      }
      return;
    }

    default:
      return fail(`Unknown command "${command}". Run: uig help`);
  }
}

function printKnowledge(root: string): void {
  const packs = loadKnowledge(root);
  if (!packs.length) { console.log('Knowledge: none yet.'); return; }
  console.log('Knowledge:');
  for (const p of packs) {
    const flags = [p.candidate ? 'candidate for Knowledge' : '', p.needsPrincipal ? 'needs principal' : ''].filter(Boolean).join(', ');
    console.log(`  [${p.level}/${p.status}] ${p.action}  (${p.intents.length} intent${p.intents.length === 1 ? '' : 's'}${flags ? `; ${flags}` : ''})`);
    if (p.failureModes.length) console.log(`    failures: ${p.failureModes.join(' | ')}`);
  }
}

main().catch(error => {
  if (error instanceof UsageError) console.error(`uig: ${error.message}`);
  else console.error(error instanceof Error ? `uig: ${error.message}` : error);
  process.exitCode = 2;
});
