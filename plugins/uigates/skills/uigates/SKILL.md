---
name: uigates
description: Run UI-GATES for meaningful engineering work that needs explicit intent, authority-aware execution, verification evidence, and reusable learning. Use when the user invokes the `uigates` skill or asks to run UI-GATES.
---

# UIGATES

Apply the UI-GATES workflow:

1. Ground the task in repository instructions and committed knowledge; use generated graphs only for retrieval.
2. Bound objective, constraints, success evidence, authority scope, and expiry.
3. Propose consequential actions with their resource, reason, impact, risk, authority request, and verification plan.
4. Execute only delegated work. Escalate gated or prohibited actions to the principal. After each step, record Expected/Actual/Delta; on a delta, replan its root cause before retrying.
5. Verify with evidence, record a receipt, and promote only warranted learning with provenance: Ephemeral → Task → Decision → Knowledge → Canon.

Stop and ask the principal when an action is gated or prohibited, material constraints are unknown, authoritative knowledge conflicts, or required verification fails or cannot run.

Engine: record through the UI-GATES engine, run as `npx --no-install uigates ...` (npx never installs it; if it cannot find `uigates`, record the same fields in markdown and report that synthesis was not engine-verified). The usual one-action task is two calls. First `npx --no-install uigates begin "<goal>" --domain <path> --success <evidence> --action "<action>" --resource <path> --impact low|medium|high --rationale "<why>" --risk "<risk>" --verify "<how>"`: it starts the intent, proposes the action and, if it is delegated, authorizes it, and prints a short brief of what earlier verified work found near your domain (begin there before searching the repo, and treat its advice as a claim to check). Then, after the work, `npx --no-install uigates receipt <authorizationId> --run "<verification command>" --lesson "<advice>" --synthesize`: it runs and hashes your verification, records what the next agent should know, and promotes it. A gated action (medium or high impact, or CI, dependency, deployment or secret files) stops at `begin`: ask the principal, and only after their explicit yes run `uigates authorize <proposalId> --approved-by <principal>`. For several actions use `start`, then `propose --authorize` for each. Authorize before you write, not after. A receipt without `--lesson` is verified but teaches nothing, is not promoted, and cannot be given one later; the lesson must say more than the action title. The record holds a command's output, not the script it runs, so keep verification scripts inside the project and leave them in place: `uigates audit` flags one that runs outside the project or has been deleted. A non-zero exit is a delta: replan before retrying (`--replan-after <receiptId> --root-cause … --revision …`). Never pass `--approved-by` or run `approve` or `retire` yourself: those are the principal's decisions, taken only from their explicit yes in conversation. `uigates help` lists every flag.

Authority states are **observe**, **delegated**, **gated**, and **prohibited**. The governing rule is: reasoning proposes; authority decides; verified work synthesizes into reusable knowledge.

End verified work with: `UI-GATES COMPLETE — outcome verified, provenance recorded, next work grounded.`

For the canonical portable source and detailed workflow, see https://github.com/gerardoiornelas/uigates/tree/main/skills/uigates (the long form is `references/long-form.md` there).
