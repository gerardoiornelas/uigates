# UI-GATES

**User-Intent Gated Agentic Task Execution & Synthesis**

UI-GATES is an authority-aware learning system for AI agents. It turns each verified task into durable, repository-native knowledge so future agents begin with better context than the agents before them.

> Reasoning proposes. Authority decides. Verified work synthesizes into reusable knowledge.

## Why UI-GATES

Autonomous agents can write and change software quickly, but speed alone does not compound. Without explicit intent, bounded authority, credible verification, and durable learning, each new task must rediscover prior decisions and risks.

UI-GATES connects the entire chain:

```text
Intent → Discover → Plan → Propose → UI-GATE → Execute → Verify → Receipt → Synthesize
```

- **Intent** explains why the work is being done and bounds its scope.
- **UI-GATE** makes an execution-time authority decision for a proposed action.
- **Verification** supplies evidence that the result is correct.
- **Synthesis** promotes only warranted learning into committed project knowledge.

## Architecture

```text
Principal
    │ establishes
    ▼
  Intent ──────────────────────────────────────────────┐
    │                                                   │
    ▼                                                   ▼
Orchestrator → Agent → Action proposal → UI-GATE → Execute
                                                    │
                                                    ▼
                                            Verify → Receipt
                                                    │
                                                    ▼
                                      Knowledge Steward → KF + Graph
```

The principal owns objectives and risk decisions. Agents can be technically capable of an action without being authorized to perform it.

## Components

| Component | Role |
| --- | --- |
| **UI-GATES** | The umbrella operating system. |
| **UI-GATE** | The authority plane that allows, denies, or escalates a proposed action at execution time. |
| **Orchestrator** | Loads context, forms plans, resolves conflicts where evidence is sufficient, and escalates otherwise. |
| **Knowledge Steward** | Classifies and promotes verified learning into committed knowledge and graph inputs. It does not authorize consequential actions. |
| **Compound Engineering** | The UI-GATES playbook for software work: code, tests, review, receipts, and reusable learning. |
| **OKF + Graph** | Repository-native source of truth plus a generated retrieval layer. |

## Learning model

UI-GATES does not treat every observation as permanent memory. Learning earns promotion:

```text
Ephemeral → Task → Decision → Knowledge → Canon
```

Each promoted artifact must link to its source, supporting evidence, and reuse guidance. See [the knowledge model](docs/knowledge-model.md).

## Repository layout

```text
docs/                 # Public system specification
skills/uig/           # Portable short-form skill: `uig`
skills/ui-gates/      # Formal UI-GATES skill
plugins/uigates/      # Installable Codex plugin (skills); core/ is a reference engine, not run by uig
```

Project integrations should keep their own committed local context bundles and generated Graphify outputs. See [the integration model](docs/architecture.md).

## Status

The portable skill is available alongside a reference authority engine and an optional executable learning/evaluation harness. The harness runs real coding agents, retains source-bound lessons, compares frozen control/treatment tasks and reports scoped evidence with full token accounting. It does not certify arbitrary future coding tasks or retrain model weights.

```bash
node plugins/uigates/learning/cli.mjs help
node --test plugins/uigates/learning/learning.test.mjs
```

Read [evidence-backed coding-agent learning](docs/certified-learning.md) for the workflow, confidence thresholds, accounting and trust boundaries. The [Workboard project](examples/workboard/README.md) is the real coding workload; its [evaluation artifacts](evaluations/real-project-v1/) preserve the frozen experiment and actual results. A positive performance claim must come from a completed certificate, not from the existence of this implementation.

## Read next

- [Architecture](docs/architecture.md)
- [Knowledge model](docs/knowledge-model.md)
- [Terminology](docs/terminology.md)
- [Roadmap](docs/roadmap.md)
- [Namespace and installation](docs/namespace.md)
- [Short `uig` skill](skills/uig/SKILL.md)
- [UI-GATES skill](skills/ui-gates/SKILL.md)
