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
| Claude Code | `.claude/skills/uig/` | `/uig` in the project. |
| Gemini CLI / Gemini API agents | `.agents/skills/uig/` | `gemini skills list`, then invoke the discovered skill. |

The platform copies are intentionally small compatibility entrypoints. `skills/uig/SKILL.md` is the portable source to keep in sync; `skills/ui-gates/SKILL.md` is the long-form reference.

## Installation guidance

For a project-local installation, copy `skills/uig/` into the appropriate host layout above. For Codex plugin distribution, install the `uigates` plugin so its skill remains plugin-qualified and cannot silently collide with an unrelated global `uig` skill.

See the official host documentation: [Codex skills](https://learn.chatgpt.com/docs/build-skills), [Claude Code skills](https://code.claude.com/docs/en/skills), and [Gemini custom agents and skills](https://ai.google.dev/gemini-api/docs/custom-agents).
