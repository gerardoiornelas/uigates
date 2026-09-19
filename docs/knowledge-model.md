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

## Measured coding-agent reuse

The optional [learning harness](certified-learning.md) makes the empirical portion executable. A candidate is grounded in at least two independently checked discovery tasks and source hashes. A frozen control/treatment evaluation must support transfer before a principal can approve live reuse. Retrieval checks the approval, expiry, project/task scope and current source; treatment acceptance regressions retire affected guidance.

This does not automatically promote text to Canon. A local certificate describes measured task/model scope, acceptance uncertainty and net token accounting. It cannot certify arbitrary future coding work. Generalizing beyond one repository requires separate evidence, not a broader label on the same result.
