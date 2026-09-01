# UI-GATES Knowledge Artifacts

Use these templates inside the target repository's committed knowledge structure. Adapt path names to the repository's existing OKF profile.

## Intent

```yaml
intent:
  id: INT-YYYY-NNNN
  principal: principal-id
  objective: A bounded desired outcome.
  constraints:
    - Explicit non-negotiable constraint.
  success_evidence:
    - Named test, review, or observable result.
  expires: YYYY-MM-DD
```

## Action proposal

```yaml
proposal:
  intent: INT-YYYY-NNNN
  agent: agent-id
  action: repository.write
  scope:
    - src/example.ts
  reason: Why this action is needed.
  impact: What it changes.
  risk: low | medium | high
  requested_authority: repository.write
  verification:
    - npm test -- example
```

## Receipt

```yaml
receipt:
  id: RCP-YYYY-NNNN
  intent: INT-YYYY-NNNN
  agent: agent-id
  proposed_action: repository.write
  scope:
    - src/example.ts
  authority:
    state: delegated
    source: intent delegation
    policy: policy-id
  result:
    commit: git-sha
  verification:
    tests: pass
  provenance:
    plan: relative/path/to/plan.md
```

## Decision or pattern

```markdown
---
title: Short, searchable lesson
type: decision | pattern
description: One-sentence summary.
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags: [relevant, tags]
generated: true
verified: test-or-review-evidence
status: active
sources: [relative/path/to/receipt]
---

# Short, searchable lesson

## Context

What changed and why did it matter?

## Decision or pattern

What should future work understand or reuse?

## Evidence

What was verified, and what remains unproven?

## Reuse guidance

When should this apply? When should it not?
```
