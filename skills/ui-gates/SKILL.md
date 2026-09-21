---
name: ui-gates
description: Run an authority-aware, learning workflow for meaningful agentic work. Use when a task should be grounded in repository knowledge, bounded by explicit intent, verified with evidence, and synthesized into reusable learning. Do not use for a trivial answer or an isolated read-only question.
---

# UI-GATES

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

Read [knowledge artifact templates](references/knowledge-artifacts.md) when creating a durable artifact.

- Keep an implementation observation task-local unless it changes a future decision.
- Promote a decision when future work must understand a tradeoff.
- Promote knowledge only when it is verified and reusable.
- Promote canon only with explicit principal approval through the gate. Repeated reuse alone never promotes.
- Promotion is never automatic or self-awarded: reuse across distinct tasks makes a candidate, and a principal promotes it.

## Recording with the engine

If the UI-GATES engine CLI is installed (`npx --no-install uig help` succeeds), record the workflow through it instead of prose. State lives in `.uig/`; each call is a separate process and the engine rebuilds its authority ledger from those records.

1. `uig start "<goal>" --domain <path> --success <evidence>` bounds the intent (principal, delegated domain, expiry).
2. `uig propose <intentId> --action … --resource … --impact low|medium|high --rationale … --risk … --verify …` returns **delegated**, **gated**, or **DENIED**. Stop on denied.
3. `uig authorize <proposalId>` issues delegated authority. For a gated action, ask the principal first; pass `--approved-by <principal>` only after their explicit yes in conversation. Never approve your own gated action.
4. Do the work, then `uig receipt <authorizationId> --run "<verification command>"`. The CLI runs the command and hashes its output as evidence; you do not assert the result. Authorize before you write, not after: `uig audit` flags a file written before it was authorized. The CLI records the command and its output, not the script it runs, so keep any verification script inside the project and within your domain, and leave it in place until the receipt is recorded; `uig audit` flags a verification that runs a script outside the project or one that has since been deleted. A non-zero exit is a delta: return to planning and retry only with `--replan-after <receiptId> --root-cause … --revision …`.
5. `uig synthesize <intentId>`, then `uig knowledge`. Lessons start at Task level; reuse across distinct intents makes a candidate. `uig approve` and `uig retire` are the principal's decisions, never yours.

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
