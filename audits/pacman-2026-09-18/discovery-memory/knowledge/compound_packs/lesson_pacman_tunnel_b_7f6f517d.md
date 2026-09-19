---
status: verified
level: task
action: pacman:tunnel:b
expected: Execute tunnel behavior checks
evidence: attempts.json#2 sha256:7f42b497331be539be35a8e5faa77283790e75fa32c7ab87ebf2ae2428fd2433
intent: 1-0-discovery
actor: fixture-worker
intents: 1-0-discovery
principals: audit-fixture
verified: r3
contradicted: 
failure_modes: 
latest: verified
knowledge_approved_by: 
canon_approved_by: 
retired_by: 
---
# Knowledge Pack: pacman:tunnel:b
**Task-level lesson: verified in 1 intent. Reuse across tasks is not confirmed yet; try it, and verify.**

## Context
- Intent: 1-0-discovery
- Actor: fixture-worker

## Verified Action
pacman:tunnel:b

## Expected Outcome
Execute tunnel behavior checks

## Evidence of Success
attempts.json#2 sha256:7f42b497331be539be35a8e5faa77283790e75fa32c7ab87ebf2ae2428fd2433

## Reuse guidance
- Confidence: task, verified in 1 distinct intent(s): 1-0-discovery.
- Apply when: the verification plan matches "Execute tunnel behavior checks".
- Do NOT apply when: no failure observed yet (absence of failure is not proof); or the context differs from the intents above, unless you re-verify.
- Limits: the evidence above was checked in those intents only.

## Provenance
- Verified by receipts: r3
- Contradicted by receipts: none
