---
name: uigates
description: Run the UI-GATES authority-aware learning workflow for meaningful work that needs repository knowledge, explicit intent, verification evidence, and reusable learning. Use when the user invokes `$uigates` or asks to run UI-GATES.
---

# UIGATES — UI-GATES entrypoint

`uigates` is the one name for **UI-GATES** (User-Intent Gated Agentic Task Execution & Synthesis): the skill, the command and the plugin.

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

If the UI-GATES engine CLI is available, record the workflow through it instead of prose, run as `npx --no-install uigates ...` (npx never installs it: if it cannot find `uigates`, use the markdown fallback below). **The usual one-action task is two calls.** `uigates begin "<goal>" --domain <path> --success <evidence> --action … --resource … --impact low|medium|high --rationale … --risk … --verify …` starts the intent, proposes the action and, if it is delegated, authorizes it, and prints a short brief of what earlier verified work found near your domain: begin there before searching the repo, and treat its advice as a claim to check. After the work, `uigates receipt <authorizationId> --run "<verification command>" --lesson "<advice>" --synthesize` runs and hashes your verification, records what the next agent should know, and promotes it. A gated action stops at `begin` and waits for the principal. The steps below are the same workflow one call at a time, for gated actions and for tasks with several actions (`start`, then `propose --authorize` for each). State lives in `.uigates/` (or `.uig/` in a project that already has it); each call is a separate process and the engine rebuilds its authority ledger from those records.

1. `uigates start "<goal>" --domain <path> --success <evidence>` bounds the intent (principal, delegated domain, expiry). It prints a short, capped brief of what earlier verified work found near your domain: begin there before searching the repo, and treat its advice as a claim to check, not a fact. `propose --authorize` proposes and authorizes a delegated action in one call (a gated action still waits for the principal).
2. `uigates propose <intentId> --action … --resource … --impact low|medium|high --rationale … --risk … --verify …` returns **delegated**, **gated**, or **DENIED**. Stop on denied.
3. `uigates authorize <proposalId>` issues delegated authority. For a gated action, ask the principal first; pass `--approved-by <principal>` only after their explicit yes in conversation. Never approve your own gated action.
4. Do the work, then `uigates receipt <authorizationId> --run "<verification command>"`. The CLI runs the command and hashes its output as evidence; you do not assert the result. Authorize before you write, not after: `uigates audit` flags a file written before it was authorized. The CLI records the command and its output, not the script it runs, so keep any verification script inside the project and within your domain, and leave it in place until the receipt is recorded; `uigates audit` flags a verification that runs a script outside the project or one that has since been deleted. A non-zero exit is a delta: return to planning and retry only with `--replan-after <receiptId> --root-cause … --revision …`. State what the next agent should know with `--lesson "<advice>"` when you record the receipt: a receipt without one is verified but teaches nothing, is not promoted, and cannot be given one later. It must say more than the action title or the verification plan, or `uigates` refuses it before running anything.
5. `uigates synthesize <intentId>`, then `uigates knowledge`. Only receipts that state a lesson are promoted, and a lesson is your claim, not something the receipt verifies. Lessons start at Task level; reuse across distinct intents makes a candidate. `uigates approve` and `uigates retire` are the principal's decisions, never yours.

Without the engine, record the same fields in markdown and say in the completion report that synthesis was not engine-verified.

## Stop conditions

Stop and ask the principal when an action is gated or prohibited, material constraints are unknown, authoritative knowledge conflicts, or required verification fails or cannot run.

## Completion

Report the result, verification evidence, authority state, receipt location, and learning promoted. End with:

`UI-GATES COMPLETE — outcome verified, provenance recorded, next work grounded.`

The formal, extended workflow is available in [`references/long-form.md`](references/long-form.md).
