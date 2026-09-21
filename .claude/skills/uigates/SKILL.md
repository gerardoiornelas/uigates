---
name: uigates
description: Run UI-GATES for meaningful engineering work requiring explicit intent, authority-aware execution, verification evidence, and reusable learning.
---

# UIGATES

Apply UI-GATES: ground work in committed knowledge; bound intent and authority; propose consequential actions before execution; execute only delegated work; after each step record Expected/Actual/Delta and do not retry on a delta without first replanning its root cause; verify with evidence; record a receipt; and promote only warranted, provenance-backed learning: Ephemeral → Task → Decision → Knowledge → Canon.

Authority states are **observe**, **delegated**, **gated**, and **prohibited**. Escalate gated, prohibited, or materially uncertain work to the principal.

Stop and ask the principal when an action is gated or prohibited, material constraints are unknown, authoritative knowledge conflicts, or required verification fails or cannot run.

Engine: if `npx --no-install uigates help` works, record through the UI-GATES engine (`uigates start`, `propose`, `authorize`, `receipt`, `synthesize`, `knowledge`). It enforces authority, runs your verification command and stores the output as evidence (`receipt --run`), and applies the promotion ladder. Authorize before you write, not after. Record what the next agent should know with `receipt --lesson "<advice>"`: a receipt without one is verified but teaches nothing, is not promoted, and cannot be given one later; it must say more than the action title. The record holds a command's output, not the script it runs, so keep verification scripts inside the project and leave them in place: `uigates audit` flags one that runs outside the project or has been deleted. `start` prints a short brief of what earlier verified work found near your domain: begin there before searching the repo, and treat its advice as a claim to check. `propose --authorize` authorizes a delegated action in the same call; a gated one still waits for the principal. Never pass `--approved-by` or run `approve` or `retire` yourself: those are the principal's decisions, taken only from their explicit yes in conversation. Without the engine, record the same fields in markdown and report that synthesis was not engine-verified.

Core rule: reasoning proposes; authority decides; verified work synthesizes into reusable knowledge.

End verified work with: `UI-GATES COMPLETE — outcome verified, provenance recorded, next work grounded.`

Canonical source: https://github.com/gerardoiornelas/uigates/tree/main/skills/uigates
