# Reference engine

An executable model of the UI-GATES authority and knowledge rules, kept so those rules can be
tested instead of only described. **It is not what runs when you invoke `uig`.**

- The product is the portable Markdown skill (`skills/uig`, `skills/ui-gates`). Nothing in a
  skill, manifest, hook or doc calls this code, and there is no `package.json` or entrypoint.
- The real learning harness (lesson store, evaluator, frozen plans, usage ledger, `npm run uig:learn`)
  lives in the `gerardoiornelas-portfolio` repository. Its `Learning` store already covers
  approval, expiry, freshness and retirement, and it disclaims being an authorization service.
- Findings from this engine that applied there were ported as tests and a fix, not as code.

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
- **Evidence content is not verified.** An authorized actor that fabricates evidence gets through; the verifier contains it afterward (arcade test G5).
- **Replanning is checked for presence, not soundness,** and only when proposals carry a `taskId` and the engine is given the receipt store.
- `UIGatesWrapper` auto-approves gated actions (a labelled simulation), and the CLI's `receipt` command records a hardcoded success.
- Not implemented: the Decision level, retrieval by graph, any UI.

## Running the tests

```bash
npx tsx plugins/uigates/core/promises_test.ts          # documented promises hold in code
npx tsx plugins/uigates/core/synthesis_pressure_test.ts # adversarial receipts and learning
npx tsx plugins/uigates/core/arcade_pressure_test.ts    # two real games through the full lifecycle
npx tsx plugins/uigates/core/skills_sync_test.ts        # skill copies stay consistent
```

The learning results use scripted workers and verifiers written here. They show the receipt → lesson →
next-task loop works, not that a coding agent benefits; that needs the harness's evaluation.
