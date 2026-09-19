# Evidence-backed coding-agent learning

UI-GATES now includes an optional executable learning harness:

```sh
node plugins/uigates/learning/cli.mjs help
```

It runs real coding agents through the Codex CLI, records full JSONL usage, independently checks the resulting code, retains experience-derived guidance, and compares later work with and without that guidance. It is project- and language-independent: project snapshots, prompts, permitted files and verifier programs are inputs. The portable Markdown skill remains a workflow guide; it does not silently launch this harness.

## What a certificate means

A certificate is a local, reproducible attestation about a **declared project/task/model scope**, not accreditation or proof of general intelligence. No finite benchmark certifies correctness for every future coding task. The certificate always includes `unboundedGeneralLearningCertified: false`.

There are three separate conclusions:

1. `learningSupported`: all paired arms have complete telemetry, all external acceptance checks pass, at least two pairs use fewer tokens with guidance, and the lower bound of the paired bootstrap interval for aggregate token reduction is above zero.
2. `tokenSavingsSupported`: the above holds **after** all observed discovery, synthesis, selection, verification and maintenance overhead, with a positive lower bound for net savings.
3. `certified`: the above holds with at least 16 paired tasks, a frozen runner protocol, and a Wilson 95% lower confidence bound of at least 80% for treatment acceptance. This is scoped to the sampled workload. The 80% threshold is a minimum evidence floor, not a guarantee acceptable for safety-critical work.

An unsuccessful or incomplete evaluation is retained and reports `inconclusive-or-not-supported`. Six cases can show a bounded effect but cannot clear the reliability threshold. Each task-family result is reported separately so aggregate success does not conceal limited coverage. Repeated or correlated tasks weaken the interpretation of intervals; independent projects, models and task authors are needed for a broader claim.

“Learning” here means a persistent, evidence-derived change in guidance that measurably changes later agent behavior. It does not mean weight updates. If the lesson merely summarizes shared source or documentation, describe the result as a **guidance effect**; do not claim novel algorithm discovery.

## Workflow

1. Prepare a real project and external verification programs. Keep verifiers outside agent-editable workspaces. They receive the temporary workspace path as their final argument and must return nonzero on failure. Agents may write only declared files; unexpected changes invalidate acceptance.
2. Run at least two distinct discovery tasks. Each starts in an isolated copy, produces actual code, and passes the independently invoked verifier. Save the complete traces, code artifacts and failures.
3. Synthesize a compact lesson from those accepted runs. A proposal includes `guidance`, `appliesWhen`, `doNotApplyWhen`, `project`, `families`, source `dependencies` hashes, and two or more `evidenceRuns`. General guidance is text, not a patch that the learner executes or new authority.
4. Freeze a plan with at least six holdouts before observing their results. It fixes model, reasoning effort, source hashes, checks and their hashes, lesson versions, permitted files, task prompts, timeout and accounting scope. Discovery task IDs cannot be reused as holdouts. Principal authorization is required for the bounded evaluation.
5. Run each task as both control and treatment. Both receive identical source and task instructions; only treatment receives the frozen lesson. Order alternates, no holdout results feed discovery, and failures cannot be overwritten with a convenient retry. Resume skips recorded arms, including unsuccessful ones.
6. Account for learning overhead. Model phases need full traces. Deterministic phases must state what ran without a model; unknown work remains unknown. Record parent/reviewer model work if it belongs to the declared operational cycle. Do not hide learning overhead inside “setup.”
7. Certify. The evaluator rechecks integrity and correspondence with the frozen plan, then emits the bounded conclusion and uncertainty. A treatment acceptance regression retires the supplied lesson conservatively.
8. For subsequent **live** reuse, a principal separately approves the evaluated lesson with a source, scope and expiry. Passing evaluation does not itself grant approval. Retrieval requires the current project root, project and task family; it checks source freshness and returns only applicable, approved lessons within a character budget. Any relevant source change makes the old lesson stale. Retirement is terminal.

Commands use an explicit store directory outside the agent workspaces:

```sh
node plugins/uigates/learning/cli.mjs discover /tmp/uig-store discovery.json
node plugins/uigates/learning/cli.mjs propose /tmp/uig-store lesson.json
node plugins/uigates/learning/cli.mjs freeze /tmp/uig-store plan.json
UIG_CODEX=/path/to/codex node plugins/uigates/learning/cli.mjs run /tmp/uig-store plan-id
node plugins/uigates/learning/cli.mjs certify /tmp/uig-store plan-id
node plugins/uigates/learning/cli.mjs retrieve /tmp/uig-store query.json
```

The [Workboard experiment](../evaluations/real-project-v1/) provides concrete discovery specifications, synthesis, frozen plans and verifiers. The general modules do not know Workboard's schema or contain its repairs. The experiment's synthesis model call is counted separately; `propose` validates and stores its candidate rather than pretending the deterministic store authored semantic guidance.

A live query includes `{"project":"workboard","family":"workflow","root":"/absolute/current/project","maxChars":4000}`. Approval JSON uses `lesson`, `certificate`, and `authority` with `principal`, `source`, `scope: "live:LESSON_ID"`, and `expiresAt`. Do not invent principal approval; these local attestations must reference actual decisions.

## Accounting and evidence

Total tokens are `input_tokens + output_tokens` across **all completed turns** in each run. Cached input is already included in input and is reported separately, never added twice. Missing counters, invalid counters, truncated traces, failed turns, timeouts, duplicate traces and missing arms cannot become zero usage. Token counts are not money: different caching/pricing arrangements can change billing independently.

`EvidenceStore` writes records exclusively and hashes their canonical bodies. Raw traces, external check output, prompts and output files are content-addressed blobs. Certificates bind the plan; runs bind the frozen engine implementation. Changes during execution or verification invalidate the relevant evidence. The runner checks source before and after and verifies that external check programs were not modified.

The unit-test telemetry is synthetic and labelled as such. Only an actual trace from a real run may support a product performance claim. Preserve full negative results as well as successes. Do not promote evaluator-generated counters as measured data.

## Trust boundaries

The harness controls the verifier and evidence store; the worker edits an isolated, disposable Git workspace using the Codex workspace-write sandbox. Other arm artifacts and lesson stores are not supplied in the control prompt or copied into its workspace. This is not a hostile-process isolation service: standard sandbox read access and the local OS account may still reach other files. Use separate containers/hosts and a verifier service when adversarial blinding is required.

The local operator controls the store and code. Hashes detect accidental or inconsistent changes, not an operator who forges every dependent record consistently. Principal strings and source references are local attestations, not authenticated identities. Verification quality depends on the external checks; passing a weak test is not a guarantee of correctness. A certificate is only as strong as the frozen acceptance criteria and representative task sample.

The reference `CESynthesizer` now defaults to hash-bound local evidence references, rejects invalid timestamps, tracks recency across intents, retains additional evidence, and reads authoritative state rather than accepting hand-edited Markdown promotions. Its file hashes establish integrity, not that the bytes prove success. The executable harness adds the independent command execution and telemetry needed for measured coding trials.

## Tests

```sh
node --test plugins/uigates/learning/learning.test.mjs
npx tsx --test plugins/uigates/core/learning_regression_test.ts
```

Tests cover incomplete accounting, tampering, replay, insufficient sample size, changed source, retirement, unsupported promotion and the regressions found in the Pac-Man audit. The old synthetic CLI success receipt has been removed; the wrapper no longer auto-approves gated actions or claims completion after denial.
