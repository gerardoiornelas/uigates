---
name: uig
description: Run UI-GATES for meaningful engineering work that needs explicit intent, authority-aware execution, verification evidence, and reusable learning. Use when the user invokes the UIGATES `uig` skill.
---

# UIG

Apply the UI-GATES workflow:

1. Ground the task in repository instructions and committed knowledge; use generated graphs only for retrieval.
2. Bound objective, constraints, success evidence, authority scope, and expiry.
3. Propose consequential actions with their resource, reason, impact, risk, authority request, and verification plan.
4. Execute only delegated work. Escalate gated or prohibited actions to the principal. After each step, record Expected/Actual/Delta; on a delta, replan its root cause before retrying.
5. Verify with evidence, record a receipt, and promote only warranted learning with provenance: Ephemeral → Task → Decision → Knowledge → Canon.

Stop and ask the principal when an action is gated or prohibited, material constraints are unknown, authoritative knowledge conflicts, or required verification fails or cannot run.

Authority states are **observe**, **delegated**, **gated**, and **prohibited**. The governing rule is: reasoning proposes; authority decides; verified work synthesizes into reusable knowledge.

End verified work with: `UI-GATES COMPLETE — outcome verified, provenance recorded, next work grounded.`

For the canonical portable source and detailed workflow, see https://github.com/gerardoiornelas/uigates/tree/main/skills/uig and https://github.com/gerardoiornelas/uigates/tree/main/skills/ui-gates.
