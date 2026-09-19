# Workboard: real coding-agent evaluation

**NOT CERTIFIED.** The full frozen experiment is retained, including negative results.

- Learning/guidance effect: **Not supported by this experiment**.
- Net token savings: **Not supported after observed operational overhead**.
- Unbounded general coding-agent learning: **not certified**.

This experiment used gpt-6-astra at high effort through a compatible Codex CLI. Agents wrote real feature modules, ran local checks, and were accepted or rejected by a separately executed, hash-pinned verifier. No worker was given a menu of prewritten solutions. All features belong to the usable [Workboard CLI](../../examples/workboard/README.md).

The first execution attempt was interrupted by a Codex usage limit. The historical store retains every attempted arm, including unknown-token failures. A rerun through [resume.mjs](resume.mjs) was attempted afterwards into `store-complete` and failed at startup for an environment reason, not a learning result; no certificate is based on it. See [ATTEMPTS.md](ATTEMPTS.md).

## Actual token totals

| Metric | Tokens |
|---|---:|
| Control arms | unknown |
| Learned-guidance arms | unknown |
| Observed learning overhead | 237,028 |
| Net saved after overhead | unknown |

Positive saved means treatment used fewer tokens. Full input plus output is counted; cached input is a subset of input and is not added again. Tokens are not billing dollars. The 95% paired-bootstrap net interval is **[unknown, unknown]**. Treatment acceptance's Wilson interval is **[6.6%, 43.0%]**, conditional on this workload, not an assurance about arbitrary future tasks.

Operational discovery, synthesis, selection, agent execution, deterministic verification and observed maintenance for this learning cycle. Excludes one-time framework/project/benchmark design and parent-session implementation tokens; no billing claim.

The operational overhead includes both discovery tasks, the real synthesis model call, and the successful current-CLI smoke call. The failed environment preflights are preserved separately; missing preflight usage is not converted to zero and is outside this operational-cycle claim. This does **not** establish total token savings for the entire parent task, implementation of the framework, or creation of this benchmark.

## Every predeclared pair

| Feature | Family | Acceptance control / guidance | Control tokens | Guidance tokens | Saved |
|---|---|---|---:|---:|---:|
| list | query | pass / pass | 74,136 | 96,766 | -22,630 |
| search | query | pass / pass | 93,121 | 75,264 | 17,857 |
| overdue | query | pass / pass | 73,542 | 94,334 | -20,792 |
| due-soon | query | fail/missing / fail/missing | unknown | unknown | unknown |
| summary | reporting | fail/missing / fail/missing | unknown | unknown | unknown |
| by-label | reporting | fail/missing / fail/missing | unknown | unknown | unknown |
| csv | reporting | fail/missing / fail/missing | unknown | unknown | unknown |
| markdown | reporting | fail/missing / fail/missing | unknown | unknown | unknown |
| rename | metadata | fail/missing / fail/missing | unknown | unknown | unknown |
| priority | metadata | fail/missing / fail/missing | unknown | unknown | unknown |
| label | metadata | fail/missing / fail/missing | unknown | unknown | unknown |
| schedule | metadata | fail/missing / fail/missing | unknown | unknown | unknown |
| reopen | workflow | fail/missing / fail/missing | unknown | unknown | unknown |
| archive | workflow | fail/missing / fail/missing | unknown | unknown | unknown |
| remove | workflow | fail/missing / fail/missing | unknown | unknown | unknown |
| batch-complete | workflow | fail/missing / fail/missing | unknown | unknown | unknown |

## What was learned

The candidate lesson was synthesized from two actual accepted discovery traces (add and complete). It identifies transaction, validation, cloning and persistence contracts and observed verification practices. It cites the original runs and hashes its source dependencies. The treatment received this compact text; the control received the same source and requirements without it. Source contracts were available to both arms, so any supported result is a repository-specific **guidance effect**, not proof of novel knowledge or model retraining. The candidate was authorized only for this bounded evaluation; no live principal approval was invented.

## Experimental controls and limitations

- Sixteen distinct feature tasks were fixed before holdout execution. Each used a new process and separate disposable workspace; task order alternated control/treatment.
- All arms used the same model/settings, source snapshot, required behavior and timeout. No failed arm was overwritten or selectively retried.
- No evaluation output was synthesized back into the candidate. Discovery, synthesis and per-arm full traces remain in the store.
- The 16 tasks span query, reporting, metadata and workflow work in **one JavaScript project**. They are purposively selected and share infrastructure; intervals do not demonstrate cross-repository or cross-language reliability.
- Verification is independent of the coding agent but was authored by the parent task author. This is not blinded external expert review.
- Control workspaces contain no lesson store or other arm artifacts. Standard local sandbox read access is not a hardened container-level blinding boundary; workers were instructed to stay within their workspace.
- Approval identities and the local evidence store trust the operator. This is a reproducible local attestation, not third-party accreditation.

## Evidence and reproduction

- [Frozen plan](plan.json), [learned candidate](lesson.json), [certificate](certificate.json), [all pair results CSV](results.csv).
- Immutable records and content-addressed traces, check output and produced code: [store](store/).
- [External verifier](verify.mjs), [task definitions](workload.mjs), [discovery runner](discover.mjs), [synthesis runner](synthesize.mjs).
- Framework guidance: [evidence-backed learning](../../docs/certified-learning.md).

A certificate cannot be overwritten. To replicate the experiment, use a **new** store and plan ID and record every arm again. The preserved original dataset is historical evidence, not a cache to rewrite until results improve.

## Reasons the claim gate withheld support

- Incomplete telemetry: workboard-v1.due-soon.control
- Acceptance failed: workboard-v1.due-soon.control
- Incomplete telemetry: workboard-v1.due-soon.treatment
- Acceptance failed: workboard-v1.due-soon.treatment
- Incomplete telemetry: workboard-v1.summary.control
- Acceptance failed: workboard-v1.summary.control
- Incomplete telemetry: workboard-v1.summary.treatment
- Acceptance failed: workboard-v1.summary.treatment
- Incomplete telemetry: workboard-v1.by-label.control
- Acceptance failed: workboard-v1.by-label.control
- Incomplete telemetry: workboard-v1.by-label.treatment
- Acceptance failed: workboard-v1.by-label.treatment
- Incomplete telemetry: workboard-v1.csv.control
- Acceptance failed: workboard-v1.csv.control
- Incomplete telemetry: workboard-v1.csv.treatment
- Acceptance failed: workboard-v1.csv.treatment
- Incomplete telemetry: workboard-v1.markdown.control
- Acceptance failed: workboard-v1.markdown.control
- Incomplete telemetry: workboard-v1.markdown.treatment
- Acceptance failed: workboard-v1.markdown.treatment
- Incomplete telemetry: workboard-v1.rename.control
- Acceptance failed: workboard-v1.rename.control
- Incomplete telemetry: workboard-v1.rename.treatment
- Acceptance failed: workboard-v1.rename.treatment
- Incomplete telemetry: workboard-v1.priority.control
- Acceptance failed: workboard-v1.priority.control
- Incomplete telemetry: workboard-v1.priority.treatment
- Acceptance failed: workboard-v1.priority.treatment
- Incomplete telemetry: workboard-v1.label.control
- Acceptance failed: workboard-v1.label.control
- Incomplete telemetry: workboard-v1.label.treatment
- Acceptance failed: workboard-v1.label.treatment
- Incomplete telemetry: workboard-v1.schedule.control
- Acceptance failed: workboard-v1.schedule.control
- Incomplete telemetry: workboard-v1.schedule.treatment
- Acceptance failed: workboard-v1.schedule.treatment
- Incomplete telemetry: workboard-v1.reopen.control
- Acceptance failed: workboard-v1.reopen.control
- Incomplete telemetry: workboard-v1.reopen.treatment
- Acceptance failed: workboard-v1.reopen.treatment
- Incomplete telemetry: workboard-v1.archive.control
- Acceptance failed: workboard-v1.archive.control
- Incomplete telemetry: workboard-v1.archive.treatment
- Acceptance failed: workboard-v1.archive.treatment
- Incomplete telemetry: workboard-v1.remove.control
- Acceptance failed: workboard-v1.remove.control
- Incomplete telemetry: workboard-v1.remove.treatment
- Acceptance failed: workboard-v1.remove.treatment
- Incomplete telemetry: workboard-v1.batch-complete.control
- Acceptance failed: workboard-v1.batch-complete.control
- Incomplete telemetry: workboard-v1.batch-complete.treatment
- Acceptance failed: workboard-v1.batch-complete.treatment

## Measured run inventory

- discovery-add: accepted; 100,757 tokens.
- discovery-complete: accepted; 93,515 tokens.
- synthesis: synthesis; 26,690 tokens.
- workboard-v1.archive.control: not accepted; unknown tokens.
- workboard-v1.archive.treatment: not accepted; unknown tokens.
- workboard-v1.batch-complete.control: not accepted; unknown tokens.
- workboard-v1.batch-complete.treatment: not accepted; unknown tokens.
- workboard-v1.by-label.control: not accepted; unknown tokens.
- workboard-v1.by-label.treatment: not accepted; unknown tokens.
- workboard-v1.csv.control: not accepted; unknown tokens.
- workboard-v1.csv.treatment: not accepted; unknown tokens.
- workboard-v1.due-soon.control: not accepted; unknown tokens.
- workboard-v1.due-soon.treatment: not accepted; unknown tokens.
- workboard-v1.label.control: not accepted; unknown tokens.
- workboard-v1.label.treatment: not accepted; unknown tokens.
- workboard-v1.list.control: accepted; 74,136 tokens.
- workboard-v1.list.treatment: accepted; 96,766 tokens.
- workboard-v1.markdown.control: not accepted; unknown tokens.
- workboard-v1.markdown.treatment: not accepted; unknown tokens.
- workboard-v1.overdue.control: accepted; 73,542 tokens.
- workboard-v1.overdue.treatment: accepted; 94,334 tokens.
- workboard-v1.priority.control: not accepted; unknown tokens.
- workboard-v1.priority.treatment: not accepted; unknown tokens.
- workboard-v1.remove.control: not accepted; unknown tokens.
- workboard-v1.remove.treatment: not accepted; unknown tokens.
- workboard-v1.rename.control: not accepted; unknown tokens.
- workboard-v1.rename.treatment: not accepted; unknown tokens.
- workboard-v1.reopen.control: not accepted; unknown tokens.
- workboard-v1.reopen.treatment: not accepted; unknown tokens.
- workboard-v1.schedule.control: not accepted; unknown tokens.
- workboard-v1.schedule.treatment: not accepted; unknown tokens.
- workboard-v1.search.control: accepted; 93,121 tokens.
- workboard-v1.search.treatment: accepted; 75,264 tokens.
- workboard-v1.summary.control: not accepted; unknown tokens.
- workboard-v1.summary.treatment: not accepted; unknown tokens.
