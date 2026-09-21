---
name: uig
description: Run the UI-GATES authority-aware learning workflow for meaningful work that needs repository knowledge, explicit intent, verification evidence, and reusable learning. Use when the user invokes `$uig` or asks to run UI-GATES.
---

# UIG — UI-GATES short entrypoint

`uig` is the short, portable command identity for **UI-GATES**: User-Intent Gated Agentic Task Execution & Synthesis.

## Core rule

Reasoning proposes. Authority decides. Verified work synthesizes into reusable knowledge.

## Workflow

1. Read repository instructions and the task-relevant committed knowledge. Use generated graph output only as retrieval guidance.
2. Bound the intent: objective, constraints, success evidence, authority scope, and expiry. Ask the principal when a consequential constraint or risk tolerance is unknown.
3. Discover and plan the smallest useful vertical slice and its verification evidence.
4. Before consequential action, state the action, affected resource, reason, impact, risk, requested authority, and verification plan.
5. Classify authority as **observe**, **delegated**, **gated**, or **prohibited**. Execute only delegated work within its stated scope. Request approval immediately before a gated action.
6. Execute and verify. After each step, record Expected/Actual/Delta. Do not claim success without evidence, and do not retry on a delta without first returning to planning to address its root cause.
7. Record a task receipt and promote only warranted learning: Ephemeral → Task → Decision → Knowledge → Canon. Each durable artifact must retain provenance to its source and evidence.

## Recording with the engine

If the UI-GATES engine CLI is installed (`npx --no-install uig help` succeeds), record the workflow through it instead of prose. State lives in `.uig/`; each call is a separate process and the engine rebuilds its authority ledger from those records.

1. `uig start "<goal>" --domain <path> --success <evidence>` bounds the intent (principal, delegated domain, expiry).
2. `uig propose <intentId> --action … --resource … --impact low|medium|high --rationale … --risk … --verify …` returns **delegated**, **gated**, or **DENIED**. Stop on denied.
3. `uig authorize <proposalId>` issues delegated authority. For a gated action, ask the principal first; pass `--approved-by <principal>` only after their explicit yes in conversation. Never approve your own gated action.
4. Do the work, then `uig receipt <authorizationId> --run "<verification command>"`. The CLI runs the command and hashes its output as evidence; you do not assert the result. A non-zero exit is a delta: return to planning and retry only with `--replan-after <receiptId> --root-cause … --revision …`.
5. `uig synthesize <intentId>`, then `uig knowledge`. Lessons start at Task level; reuse across distinct intents makes a candidate. `uig approve` and `uig retire` are the principal's decisions, never yours.

Without the engine, record the same fields in markdown and say in the completion report that synthesis was not engine-verified.

## Stop conditions

Stop and ask the principal when an action is gated or prohibited, material constraints are unknown, authoritative knowledge conflicts, or required verification fails or cannot run.

## Completion

Report the result, verification evidence, authority state, receipt location, and learning promoted. End with:

`UI-GATES COMPLETE — outcome verified, provenance recorded, next work grounded.`

The formal, extended workflow is available in [`skills/ui-gates/SKILL.md`](../ui-gates/SKILL.md).
