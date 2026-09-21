# Reference engine

An executable model of the UI-GATES authority and knowledge rules. Two things use it:

- **The `uig` CLI** (`../cli/main.ts`, launched by `bin/uig.mjs`) is how a `/uig` session records intents, proposals, authorizations, receipts and synthesis through this engine. Each call is a fresh process; `Runtime.ts` rebuilds the authority ledger, receipt store and cumulative risk from the write-once records in `.uig/`. The skills tell the agent to use it when it is installed and to say so when it is not. `cli/cli_test.ts` drives it as separate processes.
- **The tests**, which pin each documented rule to code.

The Markdown skill itself still does not execute anything: an agent has to choose to call the CLI, and the CLI cannot see what the agent does outside it.

- The optional general coding-task harness lives in `../learning/`: run `node plugins/uigates/learning/cli.mjs help` from the repository root. It has real agent execution, external acceptance checks, full token accounting and scoped certificates. It is a separate path from the CLI above and does not call `CESynthesizer`.
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
| Skill copies carry the same essentials, including the engine guidance | (docs) | `skills_sync_test` |
| Across separate processes: authority is issued by the engine, evidence is produced by the tool, a receipt spends its authorization once, a delta forces a replan, risk persists, gated work cannot be self-approved | `Runtime`, `cli/main.ts` | `cli_test` |
| Gate-class resources (CI, dependencies, deployment, secrets, settings) need a principal at any declared impact | `GateClass`, `GovernanceEngine` | `gate_class_test` |
| A denial says what kind it is: only a protected record is a true prohibition; out-of-domain, expired and replan denials can be fixed | `GovernanceEngine` (`denial`), `cli/main.ts` | `denial_kinds_test`, `cli_test` |
| A finished session can be scored against the records: uncovered or unverified changes, gate-class changes under delegated authority, altered or contradicted evidence, verification whose logic is not in the record | `cli/audit.ts` | `audit_test` |
| A file-editing tool call can be refused unless an unspent authorization covers the file (opt-in) | `cli/hook.ts`, `hooks/hooks.json` | `hook_test` |

## What it does not do

- **Principal identity is a string.** Any code in the process can pass `'bob'`. Real enforcement needs authentication.
- **The ledger is rebuilt from plain files.** `Runtime` reconstructs it on every CLI call, so cross-process rules hold, but nothing signs those files: a hostile agent with write access to `.uig/` can forge records. Signed records with a key the agent cannot read would close this; not built. `cli_test` covers a forged authorization file that the engine's own checks refuse, not a forger who is consistent throughout.
- **Gating in the CLI is a recorded, explicit step, not authentication.** `authorize` on a gated action requires `--approved-by <the intent's principal>`; the CLI cannot tell whether the user actually said yes.
- **Evidence defaults to hash-bound project-local files.** Hashes establish integrity, not semantic truth. The new learning harness separately executes pinned verifiers. Simulated tests opt into a fixture evidence validator explicitly.
- **Replanning is checked for presence, not soundness,** and only when proposals carry a `taskId` and the engine is given the receipt store.
- `UIGatesWrapper` requires a principal-approval callback for gated actions and reports unfinished work honestly. The old synthetic-success `receipt` command was removed; the current `receipt` builds a receipt only from evidence the CLI produced or hashed.
- `receipt --run` records what the verification command did, not whether the command is a meaningful check. A trivial command passes; `--evidence` mode records an outcome the agent asserts.
- **The write-time hook sees only the file-editing tools.** `uig hook pre-write` (a Claude Code PreToolUse hook, shipped in `hooks/hooks.json`) refuses a Write, Edit, MultiEdit or NotebookEdit that no unspent authorization covers. A write made through Bash (`cat >> file`, `sed -i`) does not pass through it, and neither does anything an agent does outside the harness; the audit remains the backstop for those. In the first trial, the two files written before they were authorized both went through Write and Edit, and the CI edit that followed went through Bash. It is off by default (`uig enforce on`, or `UIG_ENFORCE=1`), because an intent lasts 24 hours and a hook that locked a project for that long during ordinary work would be worse than none. It fails open: only a definite refusal exits 2, which is what blocks the tool call, and any internal error or unreadable record exits 1. It adds a process start to every edit.
- **The audit cannot see what leaves no trace.** A file created and deleted within a session is not in `git diff`. `receipt --run` records a command's output, not the script it runs; the audit warns when that script is outside the project or gone, but the record still does not capture its content.
- Not implemented: the Decision level, retrieval by graph, any UI.

## Running the tests

```bash
npm ci
npm run typecheck
npm test                # everything below, as CI runs it
```

Individual files, for example `npx tsx plugins/uigates/core/promises_test.ts` (documented promises hold in code), `synthesis_pressure_test.ts` (adversarial receipts and learning), `arcade_pressure_test.ts` (two real games through the full lifecycle), `skills_sync_test.ts` (skill copies stay consistent), `npx tsx --test plugins/uigates/core/learning_regression_test.ts` (independent audit regressions), `npx tsx --test plugins/uigates/cli/cli_test.ts` (the CLI across processes), and `node --test plugins/uigates/learning/learning.test.mjs` (evidence and certification).

The old arcade/compounding results use scripted workers. They show receipt → lesson → next-task mechanics,
not coding-agent efficiency. `cli_test` proves the engine's rules hold when driven as a real agent would drive it; it does not show that an agent learns from the lessons. That needs a real-agent experiment; see the roadmap.
