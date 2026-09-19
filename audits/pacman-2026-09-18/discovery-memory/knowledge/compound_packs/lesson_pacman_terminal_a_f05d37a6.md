---
status: verified
level: task
action: pacman:terminal:a
expected: Execute terminal behavior checks
evidence: attempts.json#7 sha256:563c7bb6717edc2743edf067b7aab6c57b77f5bdbd39ba9d07079c612e77020b
intent: 1-0-discovery
actor: fixture-worker
intents: 1-0-discovery
principals: audit-fixture
verified: r8
contradicted: 
failure_modes: 
latest: verified
knowledge_approved_by: 
canon_approved_by: 
retired_by: 
---
# Knowledge Pack: pacman:terminal:a
**Task-level lesson: verified in 1 intent. Reuse across tasks is not confirmed yet; try it, and verify.**

## Context
- Intent: 1-0-discovery
- Actor: fixture-worker

## Verified Action
pacman:terminal:a

## Expected Outcome
Execute terminal behavior checks

## Evidence of Success
attempts.json#7 sha256:563c7bb6717edc2743edf067b7aab6c57b77f5bdbd39ba9d07079c612e77020b

## Reuse guidance
- Confidence: task, verified in 1 distinct intent(s): 1-0-discovery.
- Apply when: the verification plan matches "Execute terminal behavior checks".
- Do NOT apply when: no failure observed yet (absence of failure is not proof); or the context differs from the intents above, unless you re-verify.
- Limits: the evidence above was checked in those intents only.

## Provenance
- Verified by receipts: r8
- Contradicted by receipts: none
