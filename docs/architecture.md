---
title: UI-GATES Architecture
type: architecture
description: The authority-aware architecture for intent-bound, learning agent execution.
created: 2026-09-01
updated: 2026-09-01
tags: [ui-gates, architecture, authority, agents]
status: active
---

# UI-GATES Architecture

## Design objective

Build agents whose useful work compounds without granting them ambient authority. The system must answer, at the moment of action:

> Is this actor authorized to perform this action, on this resource, under this intent, right now?

## Primitives

| Primitive | Definition |
| --- | --- |
| Principal | The human owner of objectives, risk tolerance, and delegated authority. |
| Intent | A time-bounded objective with constraints and success evidence. |
| Agent | A reasoning actor that can inspect, plan, propose, and execute only when authorized. |
| Capability | What an agent can technically do. It is not authority. |
| Authority | A time-, actor-, action-, resource-, and intent-bounded permission. |
| Proposal | A concrete requested action with scope, rationale, impact, risk, and verification plan. |
| Policy | A reusable rule for evaluating authority. |
| Receipt | An immutable record of an authorized execution and its outcome. |
| Knowledge | Verified learning that can guide future work. |

## Authority states

| State | Meaning | Typical examples |
| --- | --- | --- |
| Observe | Inspect and reason; no state change. | read, search, analyze, plan |
| Delegated | Pre-authorized inside an intent's exact scope. | modify local source, run tests, update committed project knowledge |
| Gated | Requires a principal decision at execution time. | merge, deploy, infrastructure, external communication, production data |
| Prohibited | Cannot be authorized through the workflow. | expose secrets, disable audit, expand own authority, alter authority records |

## Canonical cycle

1. **Establish intent** — capture the outcome, constraints, proof requirements, authority domain, and expiry.
2. **Discover** — retrieve repository context, prior decisions, relevant knowledge, and evidence from OKF + Graph.
3. **Plan** — propose the smallest vertical slices and acceptance evidence.
4. **Propose** — name the exact action, scope, risk, and authority requested.
5. **Authorize** — UI-GATE allows, denies, or escalates the proposal.
6. **Execute** — perform only the authorized action. After each step, record Expected/Actual/Delta; on a delta, return to Plan and address the root cause before retrying.
7. **Verify** — gather proportionate, reproducible evidence.
8. **Receipt** — preserve why the action happened, its authority, result, and verification.
9. **Synthesize** — the Knowledge Steward promotes warranted learning.

Execution never implies authorization.

## First proving loop

The first implementation should run inside one repository:

1. Create one intent.
2. Produce a scoped code-change proposal.
3. Let UI-GATE authorize a delegated local write.
4. Implement and run the repository's required tests.
5. Create a receipt.
6. Promote one verified reusable lesson.
7. Refresh the project graph.

Do not introduce a central service, cross-project federation, or broad automatic authority before this loop is reliable.
