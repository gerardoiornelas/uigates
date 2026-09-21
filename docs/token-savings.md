---
title: Token savings: what other tools do, what UI-GATES does not, and what is measured
type: analysis
description: How token-saving tools work and prove their claims, where UI-GATES falls short of them, and the instrument built to find out whether it saves anything.
created: 2026-09-21
updated: 2026-09-21
tags: [ui-gates, tokens, evaluation]
status: active
---

# Token savings

**Status: not demonstrated.** UI-GATES is designed so that an agent starts where earlier verified work happened instead of searching for the place. Nothing measured so far shows that it saves tokens. The one direct measurement (the Workboard experiment) found guided runs cost more: across the three pairs that completed, 266k tokens against 241k, before 237k of learning overhead. The first VAE trial had no control arm. This page says what other tools do, what UI-GATES lacks, and what has been built to settle it.

## What the token-saving tools do

| Tool | Mechanism | Where it sits | How it measures |
| --- | --- | --- | --- |
| [Headroom](https://github.com/headroomlabs-ai/headroom) | Compresses tool output before the model sees it: statistical crushing of JSON, AST-aware code compression, a model for logs. Reversible: originals are stored and the model can fetch them. Keeps errors, outliers and boundaries. Aligns the prompt to the provider's cache | A local proxy under the agent; needs no cooperation from it | `headroom savings` and a dashboard; seeded offline benchmarks with a reproducible command; a held-out share of sessions left unshaped for measured, not estimated, output savings. Published: 20% on code search, 42% on codebase exploration, 57% on incident debugging. One user reported about 26% after a month, against a headline of up to 95% |
| [RTK](https://github.com/rtk-ai/rtk) | Filters, groups, truncates and de-duplicates shell command output | A `PreToolUse` hook that rewrites commands; no agent cooperation | `rtk gain`; claims 60 to 90% on common commands |
| [claude-mem](https://docs.claude-mem.ai/progressive-disclosure) | Captures observations automatically, compresses them, and injects relevant ones later. **Progressive disclosure**: a compact index (50 to 100 tokens a result), then a timeline, then full detail only for chosen items | Hooks and a local service | Claims about 10x on recall; the compression is done by a model and is not verified |
| [Serena](https://github.com/oraios/serena) | Symbol-level retrieval and editing over a language server (`find_symbol`, `find_referencing_symbols`) instead of reading whole files or grepping | An MCP server | Reported by users; not benchmarked by the project |
| graphify | A queryable knowledge graph of a codebase; queries return a capped answer (`--budget`) | A skill and an MCP server | Its own report |

Three things they share that UI-GATES did not have:

1. **A meter.** Each ships one. A savings claim without a meter is a claim.
2. **A control.** The better ones keep a held-out share of traffic unshaped, so savings are measured against a real baseline.
3. **Caveats in the open.** Headroom's own numbers run from about 20% to 95% depending on the payload, and it says compression helps little on prose or already-dense input.

## What UI-GATES lacks

| Gap | Notes |
| --- | --- |
| No compression of tool output | Not its job. Headroom and RTK already do this, below the agent, and compose with UI-GATES rather than compete. Headroom sees UI-GATES' own output like any other tool output |
| No structured retrieval to replace searching | Serena and graphify answer "where is X?" with a symbol or a graph node. UI-GATES had a ledger of action titles. It now records the files each verified action covered |
| No progressive disclosure or budget | `uigates knowledge` printed everything, so it grew with the ledger. The brief is now capped and selected by location |
| It needs the agent's cooperation and adds turns | The tools above work without the agent's help and remove calls. Every uigates command is a tool call, and each tool call re-reads the whole context. In the first trial, uigates commands were 40% to 83% of tool calls |
| No meter, no control | Now built: `uigates cost` and the token A/B |

What UI-GATES has that they do not is **verified, authorized, scoped learning with provenance**. claude-mem captures everything automatically and verifies nothing. A lesson here is tied to a receipt whose evidence was hashed, is labelled as the agent's claim, can be contradicted by a later failure, and can be retired. Whether that is worth its cost in turns is the question.

## What was measured in the first trial

From the three recorded sessions (n = 1, one model, no control):

- Search and read output before the first edit was about 6k to 7k tokens per task, well under 1% of tokens processed. The tasks named their files.
- The dominant cost was the context being re-read on every model call (38k to 105k tokens per call). Weighted by price, cache re-reads were 43% of the cost and output 32%.
- A replay of the brief against the trial's real records, rewound to each task's start: 218 tokens for task 2, pointing at the right file but replacing almost none of the discovery, which went on finding where validators are documented; 68 tokens of unrelated material for task 3. A location index helps only on **repeated territory**, and the trial's tasks were not.

## What was built

- **`uigates cost`**: a meter that reads the agent's transcript and reports weighted tokens, tool calls and output by kind, the share that were uigates commands, and discovery before the first edit. It counts every model call, so the cost of UI-GATES' own turns is not hidden.
- **Location-indexed lessons and `uigates brief`**: a lesson records where its verified work happened; `start` prints the lessons near the task's domain, capped at a token budget (default 400), ranked by how closely the files overlap, with stale and failed lessons marked. "Nothing yet" is one short line.
- **`propose --authorize`**: one call instead of two for delegated work. It never authorizes a gated action.
- **The token A/B** (`evaluations/token-ab/`, plan in `PLAN.md`): three arms, so the cost of UI-GATES and the saving from learning are separate numbers.

## What is still unproven

- That an agent, in a real session, uses the brief instead of searching. The skill now says to; nothing has shown that it does.
- Any saving at all. The A/B has been tested against a stand-in for the agent and has not been run on a real one.
- Search savings in particular. The only workload with a verifier, Workboard, is about 2,000 tokens of code and cannot test them. That needs a large repository and tasks that do not name their files, and no such suite exists yet.
