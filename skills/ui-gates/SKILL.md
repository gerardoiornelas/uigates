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
5. **Receipt and synthesis** — create or update the task receipt. If the loop needed more than one pass, note in the receipt what the final delta-free observation confirmed and what the earlier deltas revealed. Classify learning using the promotion ladder. Promote only decisions, patterns, and canon supported by evidence.

## Knowledge promotion

Read [knowledge artifact templates](references/knowledge-artifacts.md) when creating a durable artifact.

- Keep an implementation observation task-local unless it changes a future decision.
- Promote a decision when future work must understand a tradeoff.
- Promote a pattern only when it is verified and reusable.
- Promote canon only after repeated confirmed reuse or explicit principal approval.

## Stop conditions

Stop and ask the principal when:

- a proposed action is gated or prohibited;
- material constraints, scope, or success evidence are unclear;
- prior knowledge conflicts and authoritative context cannot resolve it;
- required verification fails or cannot be run.

## Completion

Report the implementation result, verification evidence, authority state, receipt location, and any knowledge promoted. End with:

`UI-GATES COMPLETE — outcome verified, provenance recorded, next work grounded.`
