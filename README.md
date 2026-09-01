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
Ephemeral → Task → Decision → Pattern → Canon
```

Each promoted artifact must link to its source, supporting evidence, and reuse guidance. See [the knowledge model](docs/knowledge-model.md).

## Repository layout

```text
docs/                 # Public system specification
skills/uig/           # Portable short-form skill: `uig`
skills/ui-gates/      # Formal UI-GATES skill
plugins/uigates/      # Installable Codex plugin
```

Project integrations should keep their own committed local context bundles and generated Graphify outputs. See [the integration model](docs/architecture.md).

## Status

This is the documentation-first reference implementation. The initial objective is a usable Codex skill and a single-project proving loop before introducing a control-plane service or plugin.

## Read next

- [Architecture](docs/architecture.md)
- [Knowledge model](docs/knowledge-model.md)
- [Terminology](docs/terminology.md)
- [Roadmap](docs/roadmap.md)
- [Namespace and installation](docs/namespace.md)
- [Short `uig` skill](skills/uig/SKILL.md)
- [UI-GATES skill](skills/ui-gates/SKILL.md)
