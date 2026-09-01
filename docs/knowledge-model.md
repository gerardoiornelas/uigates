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
| Pattern | A verified approach is reusable across tasks. | Commit with applicability and evidence. |
| Canon | A stable principle governs multiple decisions or projects. | Promote only after repeated confirmed reuse or principal approval. |

## Promotion standard

Every durable artifact must state:

1. **Context** — what changed and why it mattered.
2. **Claim or decision** — what future work should understand.
3. **Evidence** — tests, review, observation, or other proof; state limits plainly.
4. **Provenance** — links to code, plan, receipt, and prior knowledge where applicable.
5. **Reuse guidance** — when to apply it and when not to.

## Trust rules

- Never promote an unsupported model inference as established knowledge.
- Keep secrets, credentials, private user data, and production-sensitive receipts out of committed knowledge.
- When current evidence conflicts with a prior decision, the Orchestrator must either resolve the conflict from authoritative context or request principal approval.
- Graph retrieval must return evidence links, confidence, and unresolved conflicts alongside any recommendation.

See the [skill reference](../skills/ui-gates/references/knowledge-artifacts.md) for compact artifact templates.
