---
status: verified
level: task
action: pacman:collision:c
expected: Execute collision behavior checks
evidence: attempts.json#5 sha256:16868c708804f9c9520582f675fcdf571c632a7863b64cdd25a2e34b385cfc3e
intent: 1-0-discovery
actor: fixture-worker
intents: 1-0-discovery
principals: audit-fixture
verified: r6
contradicted: 
failure_modes: 
latest: verified
knowledge_approved_by: 
canon_approved_by: 
retired_by: 
---
# Knowledge Pack: pacman:collision:c
**Task-level lesson: verified in 1 intent. Reuse across tasks is not confirmed yet; try it, and verify.**

## Context
- Intent: 1-0-discovery
- Actor: fixture-worker

## Verified Action
pacman:collision:c

## Expected Outcome
Execute collision behavior checks

## Evidence of Success
attempts.json#5 sha256:16868c708804f9c9520582f675fcdf571c632a7863b64cdd25a2e34b385cfc3e

## Reuse guidance
- Confidence: task, verified in 1 distinct intent(s): 1-0-discovery.
- Apply when: the verification plan matches "Execute collision behavior checks".
- Do NOT apply when: no failure observed yet (absence of failure is not proof); or the context differs from the intents above, unless you re-verify.
- Limits: the evidence above was checked in those intents only.

## Provenance
- Verified by receipts: r6
- Contradicted by receipts: none
