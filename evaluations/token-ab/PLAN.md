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
- The agent's own configuration is isolated identically for every arm: user-level MCP servers (`--strict-mcp-config` with an empty config) and user-level settings (`--setting-sources project`). This was learned from real runs: a user-level Serena server wrote a `.serena/` folder into the workspace and failed the run, and the fixed context per call was 37k tokens against 25k when isolated (a trivial call cost $0.076 against $0.023). Every extra turn re-reads that context, so a large fixed baseline changes what the ceremony costs. The choice is stated: results describe a lean environment, and UI-GATES' absolute overhead will be larger in a heavier one.
- Headless mode does not expand slash commands, so the treatment is requested in words (one added sentence: "Use the uigates skill for this task.") and the plugin is loaded explicitly with `--plugin-dir`, from outside the workspace. A skills-directory plugin was not registered ("Unknown skill") in the first two real runs. The prompt tells every arm that dot-directories tools keep their state in are not project files; without that, the agent hesitated to record through the engine because it would write outside the allowed-files list.
- A record is written for every run, failures and timeouts included, and **an arm is never rerun to get a better number**. A resumed run skips anything already recorded.
- Acceptance is the external verifier passing, no file outside the allowed list changed, and the verifier's hash unchanged.

## Gates before the full run

The pilot is four tasks, one per family, plus the two discovery tasks (14 runs). It must pass all of these, or the design is fixed before anything is scored:

1. **The skill loads in headless mode.** At least 90% of ceremony and learned runs used a uigates command. (Verified once on 2026-09-21 after two fixes; the pilot checks it holds.)
2. **The brief reaches the learned arm.** The learned runs' `start` output contains "Earlier verified work".
3. **The control accepts.** At least 75% of control runs pass the verifier, so cost is being compared on work that was done.
4. **No infrastructure voids** (see below).

## Void run log

- **Pilot 2, evaluation phase, 2026-09-22.** Right after the learning phase finished, Anthropic's API began returning `529 Overloaded`. The `list` task's three runs retried through it to an empty synthetic response; the remaining nine failed instantly at zero tokens. Every arm failed identically, including control, confirming it was infrastructure. Retried once, in a fresh output directory, reusing the same (unaffected) learning-phase ledger and skipping the learning phase: 12 of 12 accepted, no voids. Per the rule above, pilot 2's original evaluation records are kept but excluded from analysis; the retry is the design-validation run.

## Pilot 1: a design run, not evidence

Pilot 1 (14 real runs, four tasks) was run to test the design. Its numbers are **not** results and are not in any verdict; the treatment changed afterward, as described. What it showed:

- Every gate held mechanically: all 10 ceremony and learned runs used UI-GATES, the control accepted 4 of 4, no run was void, and the brief reached every learned run (and "no lessons yet" every ceremony run).
- UI-GATES cost about 2.2x the control in the lean environment: 78k against 35k weighted tokens per task, 10.0 against 4.3 model calls (interval on the difference 34k to 59k, n = 4). The five `uigates` calls per task (`help`, `start`, `propose`, `receipt`, `synthesize`), plus loading the skill, are where the extra turns came from.
- The learning phase was not real: the frozen project already contains `add.mjs` and `complete.mjs`, so the discovery agents "verified existing" files and stated lessons about that. The ledger it produced ("features/add.mjs may already exist... verify before rewriting") would mislead a task that creates a new file.

What changed as a result: `begin` (start and propose --authorize in one call) and `receipt --synthesize` (promote in the same call, printing only what changed, not the whole ledger) take the usual task from five `uigates` calls to two; the skill carries the exact command forms so no `help` call is needed; and the learning phase now removes the files discovery is meant to create. Pilot 2 repeats the same four tasks and the same seed against the changed treatment. Pilot 1's records are kept for the record and are not pooled with anything.

## Pilot 2 (retry): design validated, still not evidence

12 of 12 accepted, 0 voids. All four pre-registered gates passed:

1. **Skill loads and is used.** 8 of 8 ceremony/learned runs issued a uigates command (100%, gate is 90%). The reduced ceremony worked: most runs are `begin > receipt`, two calls, against pilot 1's five (`help > start > propose > receipt > synthesize`).
2. **The brief reaches the learned arm.** All 4 learned runs printed "Earlier verified work near ..." naming the real lesson from the (now-real) learning phase ("Create features/add.mjs").
3. **The control accepts.** 4 of 4 (gate is 75%).
4. **No unresolved infrastructure voids.** One void occurred and was retried per the rule above; the retry was clean.

The numbers (still n = 4, no verdict by the criteria above):

| | Control | Ceremony | Learned |
| --- | --- | --- | --- |
| Mean weighted tokens | 64,435 | 118,919 | 122,049 |
| Mean model calls | 6.8 | 12.0 | 13.0 |

UI-GATES overhead is 84.6% of control here, against 123.6% in pilot 1 — the reduced ceremony lowered the *relative* cost even though total model calls were higher than pilot 1's for every arm, control included, which points at task-to-task variance rather than the fix. Learning shows no effect distinguishable from noise (learned cheaper in 1 of 4 pairs; interval −33,989 to 38,963). Consistent with the suite's stated limit: a ~2,000-token project gives a location index almost nothing to save.

**Decision point.** The design is validated; a verdict needs 8+ pairs, which means the full 16-task suite (~50 runs, several hours sequential, roughly 4x this pilot's small cost). Given every measurement so far is consistent with "no saving on a project too small to search," and the suite cannot test search savings at all by its own stated limit, the full Workboard run is queued but not yet started; a search-heavy suite is likely the higher-priority next build.

## Full Workboard run, 2026-09-22

50 of 50 runs completed (2 learning, 48 evaluation), 0 voids, $12.71 total. `--out ~/uigates-ab/full --model claude-sonnet-5 --seed 20260921`; `analyze.mjs` on the raw output, intention-to-treat and per-protocol identical (every ceremony and learned run issued a `uigates` command).

Accepted by the independent verifier: control 16/16, ceremony 15/16, learned 14/16.

| | Control | Ceremony | Learned |
| --- | --- | --- | --- |
| Mean weighted tokens (14 complete triples) | 70,685 | 130,971 | 127,947 |
| Mean model calls | 7.3 | 13.8 | 13.4 |

1. **What UI-GATES costs:** +60,286 over control (+85.3%), interval [47,862, 72,897]. Clearly costly, as in both pilots.
2. **What learning saves:** 3,025 (2.3% of ceremony), interval [−19,913, 25,951], learned cheaper in 64.3% of pairs. Not distinguishable from no effect.
3. **Net for the user (control vs. learned):** −57,261 (learned costs 81.0% more than control), interval [−72,436, −42,894]; after paying for the 221,940-token learning phase, −1,023,599 over the 14 tasks.

**No verdict on any of the three**, by the plan's own comparability rule: control and learned differ by 2 accepted tasks, above the "at most 1" bound, so their costs are not judged comparable. The direction is consistent with pilot 2 and the plan's stated limit (a ~2,000-token project gives almost nothing to save), but this run does not add a statistically supported verdict beyond that.

What went wrong, from the records and transcripts, not summarized by an agent:

- **`search` failed the verifier in both ceremony and learned** (`features/search.mjs` written, verifier exit 1; control passed). A genuine implementation miss shared by both UI-GATES arms, not a gating or harness artifact.
- **`label` failed only in `learned`, and not from a bad implementation — the file was never written.** The `learned` run declared the same file-creation action `--impact medium` (gated) where the `ceremony` run of the identical task declared `--impact low` (delegated) and completed normally. `uigates begin` then printed the gated stop-and-ask; this harness runs headless with no principal to answer, so the run ended there. This is the model's own impact declaration varying between two runs of the same task, exposed by a harness limitation (no approval path for a gated action), not evidence that the learned ledger caused a worse outcome.

Records: `~/uigates-ab/full/{results.jsonl,protocol.json,transcripts/}`. Not committed to this repo (outside it, like the pilots).

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
