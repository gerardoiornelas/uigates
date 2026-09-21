---
title: UI-GATES Roadmap
type: plan
description: Incremental path from a Codex skill to a proven, authority-aware learning system, with current status.
created: 2026-09-01
updated: 2026-09-19
tags: [ui-gates, roadmap, skill, plugin]
status: active
---

# UI-GATES Roadmap

Status as of 2026-09-19. **Done** means built and covered by a test that runs in CI. It does not mean a real agent has been shown to learn from it; that claim is Phase 2 and is open.

| Phase | Status |
| --- | --- |
| 0 — Canon and skill foundation | **Done** |
| 1 — Single-project proving loop | **Partial**: engine and CLI proven mechanically, and one real-agent trial (three tasks, one model, no control) followed the loop; the current build has not been run by a real agent |
| 2 — Evaluation and refinement | **Partial**: harnesses and adversarial tests built, including a three-arm token A/B (`evaluations/token-ab`) tested only against a stand-in agent; learning and token savings are **not supported by any completed evidence** ([token savings](token-savings.md)) |
| 3 — Plugin and control-plane decision | **Done**: plugin and `uigates` CLI, no central service |
| 4 — Cross-project operation | **Not started** |

## Phase 0 — Canon and skill foundation — Done

- Terminology, architecture, knowledge model, and the skill in five copies (`skills/uigates`, its long-form reference, Claude, Gemini/agents, the plugin), kept consistent by `skills_sync_test`.
- Intent, proposal, receipt, and knowledge-promotion artifacts defined and implemented (`core/types/primitives.ts`).
- All state is repository-native and human-readable (`.uigates/`).

## Phase 1 — Single-project proving loop — Partial

Done:

- The engine is wired to the workflow: the skills direct an agent to the `uigates` CLI, which passes intents, proposals and authorizations through `GovernanceEngine`, produces evidence itself (`receipt --run`), and synthesizes with `CESynthesizer`. Because each call is a new process, `Runtime` rebuilds authority state from `.uigates/`. `cli/cli_test.ts` drives the full cycle across processes and checks that a receipt spends its authorization once, a delta forces a replan, cumulative risk persists, gated work cannot be self-approved, and a candidate needs reuse across intents plus a principal.
- Two games (`examples/arcade`) and a Pac-Man audit went through the lifecycle with scripted workers.

Open:

- **A real agent, on a real task, using `/uigates` with the CLI, end to end.** The CLI is tested by scripts that play the agent's part, not by an agent following the skill. Whether models reliably follow the recording steps is unmeasured.
- Refreshing Graphify after a learning update is not built.

## Phase 2 — Evaluation and refinement — Partial

Done:

- Repeatable examples and failure cases: the synthesis pressure test (adversarial receipts, drift), the arcade and Pac-Man audits, and the regressions those audits found (`learning_regression_test`).
- An executable learning harness (`plugins/uigates/learning/`): real agent runs, external verifiers, full token accounting, frozen plans, scoped certificates.

Open:

- **Whether agents learn from synthesized knowledge has no completed evidence.** The Workboard experiment ([REPORT](../evaluations/real-project-v1/REPORT.md), [attempt history](../evaluations/real-project-v1/ATTEMPTS.md)) is **not certified**: 3 of 16 pairs completed, guidance used more tokens in 2 of those 3, and n=3 supports no conclusion. The other 13 pairs were lost to a usage limit in the first attempt, and a rerun failed at startup (Codex could not open its state database), so neither outcome is a learning result. The Pac-Man synthesis result (3.00 to 1.00 attempts) used a simulated worker and proves the mechanics, not learning.
- The Workboard lesson was model-authored through the harness's `propose`, not produced by `CESynthesizer`, and the task source was readable by both arms. It does not test the shipped synthesizer.
- Tighten only the rules that observed failure modes support. Ongoing.

### Paused: synthesis experiment

Held on 2026-09-19. Design settled so far, to resume from: a real open-source repository with tasks mined from PRs merged after the learner's training cutoff and their tests as hidden verifiers; `CESynthesizer` as the synthesizer under test, fed by real receipts through the `uigates` CLI; Claude via Claude Code as the learner; arms of no memory, a same-length placebo, naive appended run summaries, UI-GATES synthesis, and a hand-written oracle lesson; a pilot before any full run (roughly 6M tokens for about 72 runs, a rough estimate from Workboard's ~85k tokens per run). Before running: separate infrastructure-void from acceptance-failed runs with a pre-declared retry rule, add a budget and rate-limit preflight with resumable batches, and add a Claude Code runner. Nothing in this paragraph has been run.

## Phase 3 — Plugin and control-plane decision — Done

Deterministic tooling turned out to be necessary for policy evaluation, receipts and evidence, so the engine ships as a package (`uigates` CLI, `npx uigates`) alongside the Codex plugin. The decision not to build a service stands: state is files in the project, and nothing central is required.

Open within this phase: a principal approval surface beyond the conversation, and signed records (see the [engine README](../plugins/uigates/core/README.md) for what the current records do and do not protect).

## Phase 4 — Cross-project operation — Not started

Add explicit, reviewable promotion paths for knowledge and canon that are proven reusable across projects. Project-local rules remain authoritative. This depends on Phase 2 producing evidence that lessons transfer at all within one project.
