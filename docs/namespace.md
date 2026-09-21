# UI-GATES namespace and installation

## Canonical identifiers

| Identifier | Purpose |
| --- | --- |
| `uigates` | Public repository and Codex plugin identifier. |
| `uig` | Short portable skill identifier and human invocation. |
| `ui-gates` | Formal descriptive skill identifier. |
| `UI-GATES` | The governing operating system. |
| `UI-GATE` | The execution-time authority decision plane. |

The canonical public source is [gerardoiornelas/uigates](https://github.com/gerardoiornelas/uigates). Releases and platform copies must originate from this repository.

## What this locks

This repository establishes project ownership, public provenance, the `uigates` plugin identity, and a portable `uig` skill implementation. It does **not** reserve `uig` globally: Codex, Claude, and Gemini do not provide a cross-vendor namespace registry. Exact-name collisions remain governed by each host's local scope and plugin rules.

Use the exact name `uig`; do not rely on prefix matching. This avoids ambiguity with unrelated locally installed skills such as `uig-validate`.

## Platform layouts

| Host | Included layout | Invocation |
| --- | --- | --- |
| Codex | `plugins/uigates/` or `skills/uig/` | `$uigates:uig` as a plugin skill, or `$uig` when installed as a standalone skill. |
| Claude Code (plugin) | `plugins/uigates/` (manifest at `.claude-plugin/plugin.json`) | `/uigates:uig`. Namespaced, so an unrelated personal or project `uig` skill cannot shadow it. |
| Claude Code (standalone) | `.claude/skills/uig/` | `/uig` in the project. A personal `~/.claude/skills/uig` **overrides** a project skill of the same name (enterprise, then personal, then project), so prefer the plugin. |
| Gemini CLI / Gemini API agents | `.agents/skills/uig/` | `gemini skills list`, then invoke the discovered skill. |

The platform copies are intentionally small compatibility entrypoints. `skills/uig/SKILL.md` is the portable source to keep in sync; `skills/ui-gates/SKILL.md` is the long-form reference.

## Engine CLI

The skills work alone as guidance. To have `/uig` record intents, authority, receipts and synthesis through the engine, also install the package that provides the `uig` command (Node 22+):

```bash
npm install --save-dev github:gerardoiornelas/uigates
npx --no-install uig help
```

`--no-install` matters. Without it, in a project where the package is not installed, npx resolves `uig` from the npm registry, where an unrelated package of that name exists, and may run it. With it, npx fails and the skills fall back to markdown, saying synthesis was not engine-verified. `.uig/` holds local runtime records; whether to commit `.uig/knowledge/` is the project's decision.

## Installation guidance

For a project-local installation, copy `skills/uig/` into the appropriate host layout above. For plugin distribution, install the `uigates` plugin (Codex: `.codex-plugin`; Claude Code: `.claude-plugin`) so its skill remains plugin-qualified and cannot silently collide with an unrelated global `uig` skill. To try it locally in Claude Code without a marketplace, put `plugins/uigates`'s manifest and `skills/` in `.claude/skills/uigates/` of a project (loads as `uigates@skills-dir` once the workspace is trusted), or run `claude --plugin-dir plugins/uigates`.

See the official host documentation: [Codex skills](https://learn.chatgpt.com/docs/build-skills), [Claude Code skills](https://code.claude.com/docs/en/skills), and [Gemini custom agents and skills](https://ai.google.dev/gemini-api/docs/custom-agents).
