# Task receipt: Pac-Man synthesis audit

- **Intent:** Analyze UI-GATES against its public promises and test whether synthesis learns, using Pac-Man.
- **Authority:** User delegated local analysis, testing and game recreation in this conversation. No release or shared knowledge promotion authorized or performed.
- **Expected:** Reproducible evidence of game correctness, durable reuse and limitations.
- **Actual:** A playable recreation passes behavioral and browser checks. A controlled candidate-selection test demonstrates persistence/reuse and an exact memory-removal control. Eight independent probes reveal correctness gaps or trust boundaries in the reference engine.
- **Delta:** General coding-agent learning remains unproven; the engine cannot be certified as fulfilling an unrestricted learning claim. Favorable fixture counts do not cure the observed defects.
- **Root causes:** Order-dependent synthesis, text-based success/evidence checks, incomplete authority binding and trusted pack files. See the report for exact probes and locations.
- **Synthesis:** Keep this as a task-level audit artifact. Do not promote its benchmark percentage as a general efficiency result. Future work should reuse the behavioral regressions and evidence-quality checks, then validate actual agent transfer separately.
- **Evidence:** [Report](REPORT.md), [plan](plan.json), [run metadata](run-metadata.json), [baseline](baseline.json), [game checks](game-checks.json), [browser checks](browser-checks.json), [benchmark](summary.json), [adversarial probes](safety-probes.json).
- **Acceptance:** Audit artifacts and local game verified to the stated scope. Broad product-learning claim not accepted; independent human review remains available.
