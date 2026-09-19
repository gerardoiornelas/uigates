# Reference engine

An executable model of the UI-GATES authority and knowledge rules, kept so those rules can be
tested instead of only described. **It is not what runs when you invoke `uig`.**

- The portable Markdown skill (`skills/uig`, `skills/ui-gates`) does not automatically execute this engine.
- The optional general coding-task harness now lives in `../learning/`: run `node plugins/uigates/learning/cli.mjs help` from the repository root. It has real agent execution, external acceptance checks, full token accounting and scoped certificates.
- The separate receipt-authoring harness and usage ledger in `gerardoiornelas-portfolio` remain a different, narrower integration.

## What it models

| Rule (source) | Where | Test |
| --- | --- | --- |
| Authority is intent-, actor-, action-, resource- and time-bounded (architecture.md) | `GovernanceEngine`, `AuthorityLedger` | `promises_test` A |
| Execution never implies authorization; only the principal signs what was evaluated | `GovernanceEngine.authorize` | `promises_test` A7 |
| Receipts are immutable records of authorized executions | `ReceiptStore`, `StateStore`, `AuthorityLedger` | `promises_test` A8, B |
| Only authorized receipts become knowledge | `CESynthesizer` | `promises_test` C |
| Promotion is never automatic; a principal promotes Task → Knowledge → Canon (ui-gates-canon.md) | `CESynthesizer.approveKnowledge/approveCanon` | `promises_test` C3–C4 |
| On a delta, return to planning before retrying | `GovernanceEngine` (needs `taskId`, `receipts`) | `promises_test` D |
| Skill copies carry the same essentials | (docs) | `skills_sync_test` |

## What it does not do

- **Principal identity is a string.** Any code in the process can pass `'bob'`. Real enforcement needs authentication.
- **The ledger is in memory** and trusts its process. Cross-process use needs signed records. Cumulative risk resets per process (including the CLI).
- **Evidence defaults to hash-bound project-local files.** Hashes establish integrity, not semantic truth. The new learning harness separately executes pinned verifiers. Simulated tests opt into a fixture evidence validator explicitly.
- **Replanning is checked for presence, not soundness,** and only when proposals carry a `taskId` and the engine is given the receipt store.
- `UIGatesWrapper` requires a principal-approval callback for gated actions and reports unfinished work honestly. The synthetic CLI `receipt` command has been removed.
- Not implemented: the Decision level, retrieval by graph, any UI.

## Running the tests

```bash
npx tsx plugins/uigates/core/promises_test.ts          # documented promises hold in code
npx tsx plugins/uigates/core/synthesis_pressure_test.ts # adversarial receipts and learning
npx tsx plugins/uigates/core/arcade_pressure_test.ts    # two real games through the full lifecycle
npx tsx plugins/uigates/core/skills_sync_test.ts        # skill copies stay consistent
npx tsx --test plugins/uigates/core/learning_regression_test.ts # independent audit regressions
node --test plugins/uigates/learning/learning.test.mjs  # evidence and certification
```

The old arcade/compounding results use scripted workers. They show receipt → lesson → next-task mechanics,
not coding-agent efficiency. Actual coding-agent data belongs to the separately frozen Workboard evaluation.
