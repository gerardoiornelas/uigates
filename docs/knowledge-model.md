---
title: UI-GATES Knowledge Model
type: architecture
description: Rules and artifact schemas for turning verified work into trustworthy repository knowledge.
created: 2026-09-01
updated: 2026-09-01
tags: [ui-gates, knowledge, okf, graph]
status: active
---

# UI-GATES Knowledge Model

## Source of truth

Knowledge is committed with the project it explains. A generated graph is a retrieval and relationship layer, not an authority over source code, approved decisions, or verified evidence.

## Promotion ladder

| Level | Use when | Retention |
| --- | --- | --- |
| Ephemeral | An observation helps only the active task. | Session-local; do not commit by default. |
| Task | A fact is needed to resume or review a named task. | Keep with the task artifact. |
| Decision | A tradeoff will affect future work. | Commit with alternatives and consequences. |
| Knowledge | A verified approach is reusable across tasks. | Commit with applicability, evidence, and limits. Reuse across two distinct tasks makes a candidate; a principal promotes it. |
| Canon | A stable principle governs multiple decisions or projects. | Promote only through the normal gate, by principal approval: it alters how authority is evaluated. Repeated reuse alone never promotes. |

## Promotion standard

Every durable artifact must state:

1. **Context** — what changed and why it mattered.
2. **Claim or decision** — what future work should understand.
3. **Evidence** — tests, review, observation, or other proof; state limits plainly.
4. **Provenance** — links to code, plan, receipt, and prior knowledge where applicable.
5. **Reuse guidance** — when to apply it and when not to.

## Trust rules

- Promotion is never automatic and never self-awarded. A candidate must carry provenance, evidence, and stated conditions for reuse, and a principal promotes it.
- Never promote an unsupported model inference as established knowledge.
- Keep secrets, credentials, private user data, and production-sensitive receipts out of committed knowledge.
- When current evidence conflicts with a prior decision, the Orchestrator must either resolve the conflict from authoritative context or request principal approval.
- Graph retrieval must return evidence links, confidence, and unresolved conflicts alongside any recommendation.

See the [skill reference](../skills/ui-gates/references/knowledge-artifacts.md) for compact artifact templates.

## What a lesson is

A lesson is the advice an agent states when it records a receipt: what the next agent should know that the action's title does not say. The `uig` CLI takes it as `receipt ... --lesson "<advice>"`, and the synthesizer promotes only receipts that carry one. A verified receipt with no lesson is still recorded and still counts for coverage in `uig audit`; it just teaches nothing, so it is not written into the ledger. Before this rule every verified receipt became a lesson named after the agent's own action text, and the first trial's ledger filled with process ("delete the temporary harness").

- **Stated at the time of the receipt, and only then.** A receipt is immutable, so a lesson cannot be added afterwards. `uig receipt` says so when none is given.
- **Refused before anything runs.** The verification command has side effects and a receipt is one-shot per authorization, so `uig` checks the lesson first. It refuses text under 20 or over 500 characters, a placeholder (`TODO`, `n/a`, `see above`), and text that only restates the action or the verification plan. A refusal records nothing and leaves the authorization unspent.
- **The agent's claim, not a verified fact.** The receipt proves the action succeeded and binds the lesson to that evidence. It does not prove the advice is right, and the pack says so. A pack keeps the last three distinct lessons, most recent last. A later failure still conflicts the pack, whether or not the failing receipt states a lesson.
- **A prompt-injection surface.** A lesson is agent-written text that later agents read into their context. It is flattened to one line, cannot open a heading, and is truncated like every other pack field, and it is labelled as unverified, but nothing checks that it is sound or benign. Treat it as advice to weigh, never as an instruction. Reuse is still matched on the action text, so lessons about similar work worded differently do not combine.
- **The library default is unchanged.** `SynthesisOptions.requireLesson` is off unless a caller enables it; only the CLI does.

## Measured coding-agent reuse

The optional [learning harness](certified-learning.md) makes the empirical portion executable. A candidate is grounded in at least two independently checked discovery tasks and source hashes. A frozen control/treatment evaluation must support transfer before a principal can approve live reuse. Retrieval checks the approval, expiry, project/task scope and current source; treatment acceptance regressions retire affected guidance.

This does not automatically promote text to Canon. A local certificate describes measured task/model scope, acceptance uncertainty and net token accounting. It cannot certify arbitrary future coding work. Generalizing beyond one repository requires separate evidence, not a broader label on the same result.
