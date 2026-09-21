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

Engine: if `npx --no-install uig help` works, record through the UI-GATES engine (`uig start`, `propose`, `authorize`, `receipt`, `synthesize`, `knowledge`). It enforces authority, runs your verification command and stores the output as evidence (`receipt --run`), and applies the promotion ladder. Authorize before you write, not after. The record holds a command's output, not the script it runs, so keep verification scripts inside the project and leave them in place: `uig audit` flags one that runs outside the project or has been deleted. Never pass `--approved-by` or run `approve` or `retire` yourself: those are the principal's decisions, taken only from their explicit yes in conversation. Without the engine, record the same fields in markdown and report that synthesis was not engine-verified.

Authority states are **observe**, **delegated**, **gated**, and **prohibited**. The governing rule is: reasoning proposes; authority decides; verified work synthesizes into reusable knowledge.

End verified work with: `UI-GATES COMPLETE — outcome verified, provenance recorded, next work grounded.`

For the canonical portable source and detailed workflow, see https://github.com/gerardoiornelas/uigates/tree/main/skills/uig and https://github.com/gerardoiornelas/uigates/tree/main/skills/ui-gates.
