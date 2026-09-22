import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { parseArgs } from 'util';
import { Runtime } from '../core/Runtime';
import { CESynthesizer, lessonProblem, loadKnowledge } from '../intelligence/ce/synthesizer';
import { Authorization, Intent, Proposal, Receipt } from '../core/types/primitives';
import type { DenialKind } from '../core/GovernanceEngine';
import { audit, AuditError, failed, formatReport } from './audit';
import { enforcementOn, runHook } from './hook';
import { buildBrief, DEFAULT_BRIEF_BUDGET } from '../intelligence/ce/brief';
import { claudeTranscriptDir, DEFAULT_WEIGHTS, formatCost, reportFor, type Usage } from './cost';
import { envSetting, hasBothStateDirs, stateDir, stateDirName } from '../core/names';

/**
 * `uigates` — the engine CLI an agent uses to make a /uigates session real: intents, proposals and
 * authorizations pass through GovernanceEngine, evidence is produced (not claimed) by this tool,
 * and synthesis is CESynthesizer. State lives in `<root>/.uigates/` (`.uig/` in a project that already has it) and is rebuilt on every call.
 */

class UsageError extends Error {}

const HELP = `UI-GATES engine CLI

  uigates begin "<goal>" --domain <path>... --success <evidence>... --action <text> --resource <path> --impact low|medium|high
            --rationale <text> --risk <text> --verify <plan> [--no-brief]
            start + propose --authorize in one call, for the usual one-action task. Every flag is checked first, so a missing one
            creates nothing. A gated (medium or high impact) action still waits for the principal.
  uigates start "<goal>" --domain <path>... --success <evidence>... [--constraint <text>...] [--no-brief]
            [--principal <id>] [--expires-in-hours <n> | --expires <ISO date>] [--actor <id>...]
  uigates propose <intentId> --action <text> --resource <path> --impact low|medium|high
            --rationale <text> --risk <text> --verify <plan> [--actor <id>] [--task <id>] [--authorize]
            [--replan-after <receiptId> --root-cause <text> --revision <text>]
  uigates authorize <proposalId> [--approved-by <principal>]
            (propose --authorize does both in one call for a delegated action; a gated one still waits for the principal)
  uigates receipt <authorizationId> --run "<verification command>" [--timeout-sec <n>] [--lesson <text>] [--synthesize]
            --synthesize also promotes the lesson now and prints only what changed, so no separate synthesize call is needed [--lesson <text>]
  uigates receipt <authorizationId> --evidence <file>... --outcome <text> --delta <text|None> [--lesson <text>]
            --lesson is what the next agent should know that the action's title does not say. Only a receipt
            that carries one is promoted to a lesson, and it can only be stated here: a receipt cannot be amended.
  uigates synthesize <intentId>
  uigates knowledge
  uigates approve knowledge|canon "<action>" --principal <id>
  uigates retire "<action>" --principal <id>
  uigates status [intentId]
  uigates brief [--paths <a,b,...> | --intent <id>] [--budget <tokens>] [--json]
            earlier verified work near those files, capped at a token budget (default 400); start prints it for its domain
  uigates cost [--transcripts <file|dir>...] [--weights input=1,cacheWrite=1.25,cacheRead=0.1,output=5] [--json]
            where a session's tokens went, from the host's transcript (Claude Code's, by default): weighted total,
            tool calls and output by kind, how much was UI-GATES commands, discovery before the first edit. Read-only.
  uigates audit [--base <commit>] [--intent <id>] [--json]
            score a session: do the changes since <commit> (default HEAD) match what was authorized and verified?
            Read-only; exits 1 on any FAIL. It reads the records, so it shows consistency, not good behaviour.

  uigates enforce [on|off]
            when on, the Claude Code hook (uigates hook pre-write) refuses a file edit that no unspent authorization covers.
            Off by default. It sees only the file-editing tools, not writes made through Bash.
  uigates hook pre-write    reads a PreToolUse payload on stdin; exit 2 blocks the edit, any other exit allows it

  --root <dir>    project root (default: UIGATES_ROOT or the current directory)

Records live in <root>/.uigates/ (or <root>/.uig/ in a project that already has it). Delegated actions inside the intent's scope are authorized by the
intent itself. A gated action needs the principal's approval in conversation first; only then pass
--approved-by. Principal decisions (approve, retire, --approved-by) must come from the user, never
from the agent. For the learning/evaluation harness: node plugins/uigates/learning/cli.mjs help`;

const MAX_LOG = 1_000_000;

function fail(message: string): never { throw new UsageError(message); }

function principalFor(root: string, given?: string): string {
  if (given) return given;
  const fromEnv = envSetting('PRINCIPAL');
  if (fromEnv) return fromEnv;
  const git = spawnSync('git', ['config', 'user.email'], { cwd: root, encoding: 'utf8' });
  const email = git.status === 0 ? git.stdout.trim() : '';
  if (email) return email;
  return fail('No principal. Pass --principal <id>, set UIGATES_PRINCIPAL, or configure git user.email. The principal owns the intent and signs its authority.');
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

/** What a denial means and what to do next, by kind. Only 'protected-record' is a true prohibition. */
const DENIAL_HELP: Record<DenialKind, { label: string; next: string }> = {
  'outside-domain': { label: 'outside the authorized domain', next: 'This is not a prohibition. Propose a project-relative path inside the intent\'s domain (temporary and verification files belong in the project too), or ask the principal to start a new intent with a wider domain.' },
  'protected-record': { label: 'prohibited: protected record', next: 'UI-GATES records are written only by the uigates CLI and cannot be altered through the workflow. Do not retry.' },
  'expired': { label: 'the intent has expired', next: 'Ask the principal for a new intent.' },
  'wrong-actor': { label: 'actor not authorized under this intent', next: 'Ask the principal to add the actor to the intent, or start a new one.' },
  'wrong-intent': { label: 'proposal belongs to a different intent', next: 'Propose under the intent it belongs to.' },
  'replan-required': { label: 'a replan is required', next: 'Return to planning, then propose again with --replan-after, --root-cause and --revision.' },
  'policy': { label: 'a policy refused it', next: 'Ask the principal.' },
};

/** Sign and record an authorization the engine has already approved, and say what it covers. */
function issueAuthorization(rt: Runtime, proposal: Proposal, intent: Intent, state: Authorization['state'], approvedBy?: string): void {
  const authorization = rt.gov.authorize(proposal, intent.principalId, state);
  rt.state.saveAuthorization(authorization);
  console.log(`Authorization: ${authorization.id}`);
  console.log(`State: ${authorization.state}${authorization.state === 'gated' ? ` (approved by ${approvedBy})` : ' (delegated by the intent)'}`);
  console.log(`Scope: ${authorization.action} -> ${authorization.resource}, until ${new Date(authorization.expiry ?? intent.expiry).toISOString()}`);
  console.log(`Next: do the work, then: uigates receipt ${authorization.id} --run "<verification command>"`);
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
      run: { type: 'string' }, 'timeout-sec': { type: 'string' }, lesson: { type: 'string' },
      evidence: { type: 'string', multiple: true }, outcome: { type: 'string' }, delta: { type: 'string' },
      base: { type: 'string' }, intent: { type: 'string' }, json: { type: 'boolean' },
      transcripts: { type: 'string', multiple: true }, weights: { type: 'string' },
      paths: { type: 'string' }, budget: { type: 'string' }, 'no-brief': { type: 'boolean' }, authorize: { type: 'boolean' }, synthesize: { type: 'boolean' },
    },
  });
  const root = path.resolve(v.root ?? envSetting('ROOT') ?? process.cwd());
  if (!fs.existsSync(root)) fail(`Project root does not exist: ${root}`);

  // The hook runs on every file edit and must not fail closed: it handles its own errors and never reaches the catch below.
  if (command === 'hook') {
    const hookRoot = path.resolve(v.root ?? envSetting('ROOT') ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
    let input = '';
    try { input = fs.readFileSync(0, 'utf8'); } catch { /* no stdin: treated as an empty payload */ }
    const result = runHook(hookRoot, input);
    if (result.stderr) console.error(result.stderr);
    process.exitCode = result.exit;
    return;
  }

  if (command === 'enforce') {
    const marker = path.join(stateDir(root), 'enforce');
    const want = positionals[0];
    if (want === 'on') { fs.mkdirSync(path.dirname(marker), { recursive: true }); fs.writeFileSync(marker, 'on\n'); }
    else if (want === 'off') fs.rmSync(marker, { force: true });
    else if (want !== undefined) fail('Usage: uigates enforce [on|off]');
    const viaEnv = process.env.UIGATES_ENFORCE === '1' ? ' (UIGATES_ENFORCE=1)' : process.env.UIG_ENFORCE === '1' ? ' (UIG_ENFORCE=1, the older name)' : '';
    console.log(`Enforcement: ${enforcementOn(root) ? 'on' : 'off'}${viaEnv}`);
    return;
  }

  // Brief is read-only: it reads lessons and, for --intent, the intent's domain.
  if (command === 'brief') {
    const budget = v.budget === undefined ? DEFAULT_BRIEF_BUDGET : Number(v.budget);
    if (!Number.isFinite(budget) || budget < 60) fail('--budget must be a number of tokens, at least 60.');
    let query = (v.paths ?? '').split(',').map(x => x.trim()).filter(Boolean);
    if (v.intent) {
      const file = path.join(stateDir(root), 'intents', `${v.intent}.json`);
      if (!fs.existsSync(file)) fail(`Intent ${v.intent} not found.`);
      query = query.concat(JSON.parse(fs.readFileSync(file, 'utf8')).authorityDomain ?? []);
    }
    if (!query.length) fail('Name the files: --paths <a,b,...> or --intent <id>.');
    const brief = buildBrief(root, query, budget);
    console.log(v.json ? JSON.stringify(brief, null, 2) : brief.text);
    return;
  }

  // Cost is read-only too: it reads the host's transcripts and the intent records, and writes nothing.
  if (command === 'cost') {
    const weights: Usage = { ...DEFAULT_WEIGHTS };
    for (const part of (v.weights ?? '').split(',').filter(Boolean)) {
      const [key, value] = part.split('=');
      if (!(key in weights) || !Number.isFinite(Number(value))) fail(`--weights takes ${Object.keys(DEFAULT_WEIGHTS).join('=n,')}=n; got "${part}".`);
      (weights as unknown as Record<string, number>)[key] = Number(value);
    }
    const given = v.transcripts ?? [claudeTranscriptDir(root)];
    const files = given.flatMap(p => fs.existsSync(p) && fs.statSync(p).isDirectory()
      ? fs.readdirSync(p).filter(f => f.endsWith('.jsonl')).map(f => path.join(p, f)) : [p]).filter(f => fs.existsSync(f));
    if (!files.length) return fail(`No transcripts found. Pass --transcripts <file|dir>. (Looked in ${given.join(', ')}.)`);
    const reports = reportFor(root, files.sort(), weights);
    console.log(v.json ? JSON.stringify(reports, null, 2) : formatCost(reports));
    return;
  }

  // Audit is read-only, so it runs before Runtime, which creates the state directory and rebuilds engine state.
  if (command === 'audit') {
    try {
      const report = audit(root, v.base ?? 'HEAD', v.intent);
      console.log(v.json ? JSON.stringify(report, null, 2) : formatReport(report));
      if (failed(report)) process.exitCode = 1;
    } catch (error) {
      if (error instanceof AuditError) fail(error.message);
      throw error;
    }
    return;
  }

  const rt = new Runtime(root);
  if (hasBothStateDirs(root)) console.warn(`Warning: both .uigates/ and .uig/ exist. Records are read from ${stateDirName(root)}/ and the other directory is ignored.`);
  if (rt.orphans.length) console.warn(`Warning: ${rt.orphans.length} authorization(s) lack their proposal or intent and authorize nothing: ${rt.orphans.join(', ')}`);

  const startIntent = (): Intent => {
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
    if (!v['no-brief']) console.log(`\n${buildBrief(root, authorityDomain).text}`);
    return intent;
  };

  const proposeAction = (intent: Intent, authorizeNow: boolean): void => {
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
    const help = evaluation.denied && evaluation.denial ? DENIAL_HELP[evaluation.denial] : undefined;
    console.log(evaluation.denied ? `Authority: DENIED (${help?.label ?? 'not allowed'})` : `Authority: ${evaluation.suggestedState}`);
    console.log(`Why: ${evaluation.rationale}`);
    if (evaluation.denied) { if (help) console.log(`Next: ${help.next}`); process.exitCode = 1; return; }
    if (evaluation.suggestedState === 'gated') {
      // --authorize never speaks for the principal: a gated action always waits for their yes, then a separate authorize.
      console.log('Next: ask the principal. Only after they approve, run: uigates authorize ' + proposal.id + ' --approved-by ' + intent.principalId);
    } else if (authorizeNow) {
      // The proposal is saved and evaluated before the authorization is written, so the order on record is unchanged.
      issueAuthorization(rt, proposal, intent, evaluation.suggestedState);
    } else {
      console.log('Next: uigates authorize ' + proposal.id);
    }
  };

  /** Promote what this intent's receipts earned and say only what changed. `synthesize` prints the whole ledger, which grows. */
  const finishSynthesis = async (intentId: string): Promise<void> => {
    const synth = new CESynthesizer(rt.receipts, root, rt.gov.ledger, { requireLesson: true });
    await synth.synthesize(intentId);
    for (const r of synth.getRejections()) console.log(`Rejected receipt ${r.receiptId}: ${r.reason}`);
    for (const u of synth.getUnpromoted()) console.log(`Not promoted: ${u.receiptId} (${u.action}) stated no lesson. Next time, record the receipt with --lesson "<what the next agent should know>".`);
    for (const e of synth.getEscalations()) console.log(`Needs the principal: ${e.kind} at ${e.level}: ${e.action}`);
    console.log(`Knowledge: ${loadKnowledge(root).length} lesson(s) on record; uigates knowledge lists them.`);
  };

  switch (command) {
    case 'start': {
      startIntent();
      return;
    }

    case 'propose': {
      const intent = rt.state.getIntent(need(positionals[0], 'intentId (first argument)'));
      if (!intent) return fail('Intent not found.');
      proposeAction(intent, !!v.authorize);
      return;
    }

    case 'begin': {
      // Everything is checked before anything is written: a missing flag must not leave an intent behind.
      need(positionals[0], 'goal (first argument)');
      for (const [flag, value] of [['domain', v.domain], ['success', v.success], ['action', v.action], ['resource', v.resource], ['impact', v.impact], ['rationale', v.rationale], ['risk', v.risk], ['verify', v.verify]] as const) need(value, flag);
      if (v.impact !== 'low' && v.impact !== 'medium' && v.impact !== 'high') fail('--impact must be low, medium or high.');
      const intent = startIntent();
      proposeAction(intent, true);
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
      if (evaluation.denied) { console.error(`Denied (${(evaluation.denial && DENIAL_HELP[evaluation.denial].label) ?? 'not allowed'}): ${evaluation.rationale}`); process.exitCode = 1; return; }
      if (evaluation.suggestedState === 'gated' && v['approved-by'] !== intent.principalId) {
        console.error(`Gated: ${evaluation.rationale}`);
        console.error(`Ask ${intent.principalId} and wait for a clear yes in this conversation. Then re-run with --approved-by ${intent.principalId}. The agent may not approve its own gated action.`);
        process.exitCode = 1;
        return;
      }
      issueAuthorization(rt, proposal, intent, evaluation.suggestedState, v['approved-by']);
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

      // Checked before anything runs: a receipt is one-shot per authorization and the verification command has side effects.
      const lesson = v.lesson === undefined ? '' : v.lesson.replace(/\s+/g, ' ').trim();
      if (v.lesson !== undefined) {
        const problem = lessonProblem(lesson, authorization.action, proposal.verificationPlan);
        if (problem) fail(`Lesson refused, and nothing was run or recorded: ${problem}. Re-run with a better --lesson, or without one to record the receipt with no lesson.`);
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
        ...(lesson ? { lesson } : {}),
      };
      const verdict = rt.gov.ledger.admitReceipt(receipt);
      if (!verdict.ok) return fail(`Receipt refused: ${verdict.reason}`);
      rt.state.saveReceipt(receipt);
      rt.receipts.record(receipt); // so a synthesis in this same process (--synthesize) sees it; a later process reads it from disk
      console.log(`Receipt: ${receipt.id}`);
      console.log(`Outcome: ${receipt.actualOutcome}`);
      console.log(`Delta: ${receipt.delta}`);
      console.log(`Evidence: ${receipt.evidence.join(', ')}`);
      console.log(lesson
        ? `Lesson: ${lesson}`
        : 'Lesson: none. This receipt will not be promoted to a lesson, and one can only be stated when the receipt is recorded (a receipt cannot be amended).');
      if (v.synthesize) await finishSynthesis(receipt.intentId);
      if (delta.trim().toLowerCase() !== 'none') {
        console.log(`Next: return to planning. A retry needs: uigates propose ... ${proposal.taskId ? `--task ${proposal.taskId} ` : ''}--replan-after ${receipt.id} --root-cause "<why>" --revision "<what changes>"`);
        process.exitCode = 1;
      } else {
        console.log(v.synthesize ? 'Done: recorded and synthesized.' : `Next: uigates synthesize ${receipt.intentId}`);
      }
      return;
    }

    case 'synthesize': {
      const intentId = need(positionals[0], 'intentId (first argument)');
      if (!rt.state.getIntent(intentId)) return fail('Intent not found.');
      const synth = new CESynthesizer(rt.receipts, root, rt.gov.ledger, { requireLesson: true });
      await synth.synthesize(intentId);
      for (const r of synth.getRejections()) console.log(`Rejected receipt ${r.receiptId}: ${r.reason}`);
      for (const u of synth.getUnpromoted()) console.log(`Not promoted: ${u.receiptId} (${u.action}) stated no lesson. Next time, record the receipt with --lesson "<what the next agent should know>".`);
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
      else return fail('Usage: uigates approve knowledge|canon "<action>" --principal <id>');
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
      return fail(`Unknown command "${command}". Run: uigates help`);
  }
}

function printKnowledge(root: string): void {
  const packs = loadKnowledge(root);
  if (!packs.length) { console.log('Knowledge: none yet.'); return; }
  console.log('Knowledge:');
  for (const p of packs) {
    const flags = [p.candidate ? 'candidate for Knowledge' : '', p.needsPrincipal ? 'needs principal' : ''].filter(Boolean).join(', ');
    console.log(`  [${p.level}/${p.status}] ${p.action}  (${p.intents.length} intent${p.intents.length === 1 ? '' : 's'}${flags ? `; ${flags}` : ''})`);
    if (p.paths.length) console.log(`    files: ${p.paths.join(', ')}`);
    if (p.failureModes.length) console.log(`    failures: ${p.failureModes.join(' | ')}`);
    for (const l of p.lessons) console.log(`    lesson (the agent's claim, not verified): ${l}`);
  }
}

main().catch(error => {
  if (error instanceof UsageError) console.error(`uigates: ${error.message}`);
  else console.error(error instanceof Error ? `uigates: ${error.message}` : error);
  process.exitCode = 2;
});
