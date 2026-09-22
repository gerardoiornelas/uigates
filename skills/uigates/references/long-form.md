# UI-GATES: long-form reference

The extended workflow behind the `uigates` skill ([`../SKILL.md`](../SKILL.md)). It is a reference, not a second skill.

Use UI-GATES to ensure a meaningful task leaves the repository easier to change than it was before.

## Core rule

Reasoning proposes. Authority decides. Verified work synthesizes into reusable knowledge.

## Before work

1. Read the repository's agent instructions and committed knowledge context.
2. Retrieve only task-relevant knowledge and graph relationships. Treat generated graph output as navigation, not authority.
3. Establish or infer a bounded intent: objective, constraints, success evidence, authority scope, and expiry. Ask the principal when a consequential constraint or risk tolerance is unknown.

## Work loop

1. **Discover and plan** — identify the smallest useful vertical slice and its verification evidence.
2. **Propose** — before consequential action, state the action, affected resource, reason, impact, risk, requested authority, and verification plan.
3. **Authorize** — classify the proposal as observe, delegated, gated, or prohibited. Execute only delegated work within the stated scope. Request approval immediately before gated actions.
4. **Execute and verify** — implement only what is authorized. After each execution step, record an observation:
   - **Expected** — the outcome the plan predicted.
   - **Actual** — the raw result (test output, logs, diff, browser state).
   - **Delta** — where actual diverges from expected, or "none."

   Do not claim success without evidence. If a delta exists, do not immediately retry — return to **Discover and plan** and revise the plan to account for the gap's root cause, then re-propose only if the revision changes the requested authority or scope.
5. **Receipt and synthesis** — create or update the task receipt. If the loop needed more than one pass, note in the receipt what the final delta-free observation confirmed and what the earlier deltas revealed. Classify learning using the promotion ladder (Ephemeral → Task → Decision → Knowledge → Canon). Promote only decisions, knowledge, and canon supported by evidence.

## Knowledge promotion

Read [knowledge artifact templates](knowledge-artifacts.md) when creating a durable artifact.

- Keep an implementation observation task-local unless it changes a future decision.
- Promote a decision when future work must understand a tradeoff.
- Promote knowledge only when it is verified and reusable.
- Promote canon only with explicit principal approval through the gate. Repeated reuse alone never promotes.
- Promotion is never automatic or self-awarded: reuse across distinct tasks makes a candidate, and a principal promotes it.

## Recording with the engine

If the UI-GATES engine CLI is available, record the workflow through it instead of prose, run as `npx --no-install uigates ...` (npx never installs it: if it cannot find `uigates`, use the markdown fallback below). **The usual one-action task is two calls.** `uigates begin "<goal>" --domain <path> --success <evidence> --action … --resource … --impact low|medium|high --rationale … --risk … --verify …` starts the intent, proposes the action and, if it is delegated, authorizes it, and prints a short brief of what earlier verified work found near your domain: begin there before searching the repo, and treat its advice as a claim to check. After the work, `uigates receipt <authorizationId> --run "<verification command>" --lesson "<advice>" --synthesize` runs and hashes your verification, records what the next agent should know, and promotes it. A gated action stops at `begin` and waits for the principal. The steps below are the same workflow one call at a time, for gated actions and for tasks with several actions (`start`, then `propose --authorize` for each). State lives in `.uigates/` (or `.uig/` in a project that already has it); each call is a separate process and the engine rebuilds its authority ledger from those records.

1. `uigates start "<goal>" --domain <path> --success <evidence>` bounds the intent (principal, delegated domain, expiry). It prints a short, capped brief of what earlier verified work found near your domain: begin there before searching the repo, and treat its advice as a claim to check, not a fact. `propose --authorize` proposes and authorizes a delegated action in one call (a gated action still waits for the principal).
2. `uigates propose <intentId> --action … --resource … --impact low|medium|high --rationale … --risk … --verify …` returns **delegated**, **gated**, or **DENIED**. Stop on denied.
3. `uigates authorize <proposalId>` issues delegated authority. For a gated action, ask the principal first; pass `--approved-by <principal>` only after their explicit yes in conversation. Never approve your own gated action.
4. Do the work, then `uigates receipt <authorizationId> --run "<verification command>"`. The CLI runs the command and hashes its output as evidence; you do not assert the result. Authorize before you write, not after: `uigates audit` flags a file written before it was authorized. The CLI records the command and its output, not the script it runs, so keep any verification script inside the project and within your domain, and leave it in place until the receipt is recorded; `uigates audit` flags a verification that runs a script outside the project or one that has since been deleted. A non-zero exit is a delta: return to planning and retry only with `--replan-after <receiptId> --root-cause … --revision …`. State what the next agent should know with `--lesson "<advice>"` when you record the receipt: a receipt without one is verified but teaches nothing, is not promoted, and cannot be given one later. It must say more than the action title or the verification plan, or `uigates` refuses it before running anything.
5. `uigates synthesize <intentId>`, then `uigates knowledge`. Only receipts that state a lesson are promoted, and a lesson is your claim, not something the receipt verifies. Lessons start at Task level; reuse across distinct intents makes a candidate. `uigates approve` and `uigates retire` are the principal's decisions, never yours.

Without the engine, record the same fields in markdown and say in the completion report that synthesis was not engine-verified.

## Stop conditions

Stop and ask the principal when:

- a proposed action is gated or prohibited;
- material constraints, scope, or success evidence are unclear;
- prior knowledge conflicts and authoritative context cannot resolve it;
- required verification fails or cannot be run.

## Completion

Report the implementation result, verification evidence, authority state, receipt location, and any knowledge promoted. End with:

`UI-GATES COMPLETE — outcome verified, provenance recorded, next work grounded.`
