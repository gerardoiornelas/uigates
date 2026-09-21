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
docs/                        # Public system specification
skills/uigates/              # The portable skill: `uigates`
skills/uigates/references/   # Long-form reference and knowledge-artifact templates
plugins/uigates/             # Installable plugin (Codex and Claude Code), the authority/synthesis engine, and the `uigates` CLI
bin/uigates.mjs              # `npx uigates ...` launcher for the engine CLI (`uig` is a one-release alias)
```

Project integrations should keep their own committed local context bundles and generated Graphify outputs. See [the integration model](docs/architecture.md).

## Engine CLI

The skill is guidance; the engine is what makes a session verifiable. When the package is installed (`npm install github:gerardoiornelas/uigates`), `/uigates` records the workflow through the `uigates` CLI instead of prose:

```bash
npx uigates start "add CSV export" --domain src/ --success "tests pass"
npx uigates propose <intentId> --action "add export" --resource src/export.js --impact low \
  --rationale "requested feature" --risk "local" --verify "npm test"
npx uigates authorize <proposalId>                     # delegated work; gated work needs the principal's yes
npx uigates receipt <authorizationId> --run "npm test" # the CLI runs the command and hashes the output as evidence
npx uigates synthesize <intentId> && npx uigates knowledge
npx uigates audit --base <commit>                      # score a finished session against the records; read-only
npx uigates enforce on                                 # opt in: refuse a file edit no unspent authorization covers (Claude Code hook)
```

Use `npx --no-install uigates ...` if you are not sure the package is installed, so npx never installs or runs a package from the registry (it cancels instead). (`uigates` is not on npm today, but the older name `uig` is: a different, unrelated package, which is why the skills never use it.) Each call is a separate process, so the engine rebuilds its authority ledger, receipts and cumulative risk from the write-once records in `.uigates/`. Synthesis is `CESynthesizer`: only receipts traceable to issued authority, with hash-bound evidence, become lessons; reuse across distinct intents makes a candidate; a principal promotes it.

What this does not do: the records are plain files the agent's own process can also write, so they are tamper-evident to the engine's checks, not tamper-proof against a hostile agent, and the agent-facing rules (never self-approve, never run `approve`) are instructions the model follows. Real enforcement of what an agent may touch remains the host's sandbox and permission prompts. See the [engine README](plugins/uigates/core/README.md).

## Development

```bash
npm ci            # pinned tsx and TypeScript
npm run typecheck
npm test          # learning harness, engine and CLI (across processes), skills sync, Workboard
```

CI runs the same commands on every push and pull request.

## Status

The portable skill is available alongside a reference authority engine and an optional executable learning/evaluation harness. The harness runs real coding agents, retains source-bound lessons, compares frozen control/treatment tasks and reports scoped evidence with full token accounting. It does not certify arbitrary future coding tasks or retrain model weights.

```bash
node plugins/uigates/learning/cli.mjs help
npm run test:learning
```

Read [evidence-backed coding-agent learning](docs/certified-learning.md) for the workflow, confidence thresholds, accounting and trust boundaries. The [Workboard project](examples/workboard/README.md) is the real coding workload; its [evaluation artifacts](evaluations/real-project-v1/) preserve the frozen experiment and actual results. A positive performance claim must come from a completed certificate, not from the existence of this implementation.

## Read next

- [Architecture](docs/architecture.md)
- [Knowledge model](docs/knowledge-model.md)
- [Terminology](docs/terminology.md)
- [Roadmap](docs/roadmap.md)
- [Namespace and installation](docs/namespace.md)
- [The `uigates` skill](skills/uigates/SKILL.md)
- [Long-form reference](skills/uigates/references/long-form.md)
