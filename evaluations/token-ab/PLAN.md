# Token A/B: does UI-GATES save tokens, and does it learn?

Fixed before any real run. Do not edit a criterion after a run has used it; if one is wrong, void the run, change it in a new commit that says why, and keep both. The criteria that decide a verdict live in `analyze.mjs` as frozen constants, and the tests pin them.

## What is being asked

Two questions, kept apart because a single before-and-after comparison blurs them:

1. **What does UI-GATES cost?** Every command is a tool call, and every tool call is another turn that re-reads the whole context. A tool that adds turns can be a net loss even if what it teaches is good.
2. **Does what it learns save tokens?** A lesson that names where earlier verified work happened should let a later agent start there instead of searching.

The hypotheses, in the order they are judged:

| | Comparison | Claim | Supported when |
| --- | --- | --- | --- |
| H1 | ceremony - control | UI-GATES costs tokens | Reported as a number with its interval; no pass or fail. It is the price of the audit trail |
| H2 | ceremony - learned | Learning saves tokens | Interval above zero **and** learned cheaper in at least 70% of pairs |
| H3 | control - learned | The user comes out ahead of using nothing | The same test |
| H4 | H3 summed, minus the learning phase | It repays what learning cost | Total saved across the tasks exceeds the tokens spent learning, **and** H3 is supported |

"Supported" means all of those. "Contradicted" means the interval is entirely below zero. Anything else is "not supported", which is a result, not a failure to run.

## Arms

| Arm | The agent gets |
| --- | --- |
| `control` | The task, and nothing of UI-GATES in the workspace |
| `ceremony` | The `uigates` skill and command, invoked as `/uigates:uigates`, with an **empty** ledger |
| `learned` | The same, with the ledger a learning phase produced from earlier tasks |

The learning phase is the two discovery tasks run in the ceremony arm; their lessons are merged into one ledger. Its tokens are counted as the cost of learning (H4).

## Workload

`suites/workboard.mjs`: the Workboard project and its 16 frozen tasks from `evaluations/real-project-v1`, judged by the same external verifier, pinned by the SHA-256 the original plan recorded. If the verifier differs, nothing runs.

**What this suite can and cannot show.** The project is nine files and about 7 KB, roughly 2,000 tokens in total. It can test whether an agent that has learned a project's conventions needs fewer tokens. **It cannot test whether an agent saves searching**, because there is almost nothing to search. A null result here says nothing about a large repository. The search-savings claim needs a search-heavy suite (a large repository, tasks that do not name their files, independent verifiers). That suite does not exist yet, and the claim stays unsupported until it does.

## Metric

**Weighted tokens per task**: fresh input x1, cache write x1.25, cache re-read x0.1, output x5, from the agent's own transcript by `uigates cost`, the same meter for every arm. These are relative prices, an assumption, and the raw components are recorded so the weighting can be changed in analysis. Fresh tokens alone are not used: they would hide the turns UI-GATES adds.

Also recorded: model calls, tool calls by kind, discovery before the first edit, acceptance.

## Procedure

- One fresh workspace per run, copied from the frozen project; `git init`; no other run's files.
- Arm order is shuffled per task with a recorded seed (`--seed`, default 20260921).
- Provider settings (`ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `OPENAI_BASE_URL`) are removed from the agent's environment. The model is pinned with `--model` and recorded.
- User-level Claude configuration is the same for every arm. It is not removed, so its fixed cost falls on all three equally.
- A record is written for every run, failures and timeouts included, and **an arm is never rerun to get a better number**. A resumed run skips anything already recorded.
- Acceptance is the external verifier passing, no file outside the allowed list changed, and the verifier's hash unchanged.

## Gates before the full run

The pilot is four tasks, one per family, plus the two discovery tasks (14 runs). It must pass all of these, or the design is fixed before anything is scored:

1. **The skill loads in headless mode.** At least 90% of ceremony and learned runs used a uigates command. (The headless slash-command behaviour is unverified from here; this gate is where it gets verified.)
2. **The brief reaches the learned arm.** The learned runs' `start` output contains "Earlier verified work".
3. **The control accepts.** At least 75% of control runs pass the verifier, so cost is being compared on work that was done.
4. **No infrastructure voids** (see below).

## Analysis

`node analyze.mjs results.jsonl`. Two analyses are printed. **Intention-to-treat** (every accepted run as randomized, whether or not the agent used UI-GATES) decides the verdict. **Per-protocol** (only runs where it did) is shown beside it. The criteria:

| | |
| --- | --- |
| Minimum complete accepted pairs | 8 |
| Learned cheaper than ceremony in at least | 70% of pairs |
| Interval | 95%, paired bootstrap, 10,000 resamples, seeded |
| Arms may differ in tasks accepted by at most | 1; more, and cost is not comparable |

Only tasks all three arms got right are compared. Acceptance imbalance and too few pairs are reported as "no verdict", never as support.

## Void runs

A run is void, not failed, when it ends for a reason unrelated to the agent's behaviour: a usage limit, an expired login, a network failure, a tool that would not start. A void run is retried once with a fresh workspace, and both are recorded. Two voids on the same task stop the run and are reported as infrastructure findings. A run whose result is merely bad is never voided.

## Limits, stated now

- One model, one operator, one machine, one small project. n is at most 16 pairs.
- Not blind: the agent can read the skill and run `uigates audit` on itself, as it did in the first trial.
- The weights are assumed relative prices, not a bill.
- Discovery tasks and holdouts share a project and a family structure, so a positive learning result is about this project's conventions, not about coding in general.
- No claim about search savings, for the reason above.

## Running it

```bash
# the shell must not carry a proxy or another provider's key; the runner strips them, but check /login first
claude            # then /login, once

node evaluations/token-ab/run.mjs --dry-run --tasks pilot          # the plan and the arm orders
node evaluations/token-ab/run.mjs --out ~/uigates-ab/pilot --tasks pilot --model <model>
node evaluations/token-ab/analyze.mjs ~/uigates-ab/pilot/results.jsonl
```

The pilot is about 14 agent runs and the full set about 50. From the first trial, one run is on the order of a million tokens re-read from cache, so check the plan limits first.
