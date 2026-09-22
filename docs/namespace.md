# UI-GATES namespace and installation

## One name

Everything you type is `uigates`: the skill, the command, the plugin, the state directory and the settings. `UI-GATES` is the name of the system in prose, and is never typed.

| Identifier | Purpose |
| --- | --- |
| `uigates` | The repository, the npm package, the plugin, the skill, the `uigates` command, and the `.uigates/` state directory |
| `UIGATES_*` | Environment variables: `UIGATES_PRINCIPAL`, `UIGATES_ROOT`, `UIGATES_ENFORCE`, `UIGATES_CODEX` |
| `UI-GATES` | The governing operating system (prose) |
| `UI-GATE` | The execution-time authority decision plane (prose) |

The canonical public source is [gerardoiornelas/uigates](https://github.com/gerardoiornelas/uigates). Releases and platform copies must originate from this repository.

## What this locks

This repository establishes project ownership, public provenance, and the `uigates` plugin and skill identity. It does **not** reserve the name globally: Codex, Claude, and Gemini do not provide a cross-vendor namespace registry, and `uigates` is not registered on npm today (checked 2026-09-21), so nothing stops another package from taking it. Exact-name collisions remain governed by each host's local scope and plugin rules.

Use the exact name `uigates`; do not rely on prefix matching.

## The earlier name, `uig`

The project was first called `uig`. That name is retired but still understood for one release, so nothing already in use breaks:

| Earlier | Now | Behaviour during the transition |
| --- | --- | --- |
| `uig` (command) | `uigates` | `package.json` `bin` keeps `uig` as an alias for the same launcher. It is not documented and no skill uses it |
| `.uig/` (state directory) | `.uigates/` | A project that already has `.uig/` **keeps using it**. It is never migrated: a receipt's evidence reference embeds the path (`sha256:<hash>:.uig/evidence/<id>.log`), so moving the directory would break the hash check on every record already written. A new project gets `.uigates/`. If both exist, `.uigates/` is read, `.uig/` is ignored, and the CLI and the audit say so |
| `UIG_PRINCIPAL`, `UIG_ROOT`, `UIG_ENFORCE`, `UIG_CODEX` | `UIGATES_*` | The older names are read when the new one is unset or empty |
| `uig` and `ui-gates` (skills) | `uigates` | One skill. The long form is `skills/uigates/references/long-form.md`, a reference with no skill frontmatter, so no host loads it as a second skill |

Both directory names are always protected. The engine denies a proposal to edit authority records under either, gates hand-edits to knowledge under either, and the write-time hook refuses a file-tool edit to either, whichever one the project uses.

**Do not use `uig` in a skill or in an `npx` line.** On the npm registry `uig` is an unrelated package (version 0.0.0, last modified 2022; not run). In a project where the CLI is not installed, a plain `npx uig` would fetch and run it.

If you have a personal skill named `uig` from before (for example `~/.claude/skills/uig`), it still answers to `/uig` and is unrelated to this project. It no longer collides with anything here, but it can still be invoked by muscle memory and has its own instructions.

## Platform layouts

| Host | Included layout | Invocation |
| --- | --- | --- |
| Codex | `plugins/uigates/` or `skills/uigates/` | `$uigates:uigates` as a plugin skill, or `$uigates` when installed as a standalone skill |
| Claude Code (plugin) | `plugins/uigates/` (manifest at `.claude-plugin/plugin.json`) | `/uigates:uigates`. Namespaced, so an unrelated personal or project skill cannot shadow it |
| Claude Code (standalone) | `.claude/skills/uigates/` | `/uigates` in the project |
| Gemini CLI / Gemini API agents | `.agents/skills/uigates/` | `gemini skills list`, then invoke the discovered skill |

The platform copies are intentionally small compatibility entrypoints. `skills/uigates/SKILL.md` is the portable source to keep in sync, and `skills/uigates/references/long-form.md` is the long-form reference. `skills_sync_test` checks that every copy carries the essentials, that each is named `uigates`, and that the retired command name does not return.

## Engine CLI

The skills work alone as guidance. To have `/uigates` record intents, authority, receipts and synthesis through the engine, also install the package that provides the `uigates` command (Node 22+):

```bash
npm install --save-dev github:gerardoiornelas/uigates
npx --no-install uigates help
```

`--no-install` matters. Without it, in a project where the package is not installed, npx resolves the name from the npm registry and runs whatever package holds it. With it, npx cancels ("missing packages and no YES option"), installs and runs nothing, and the skills fall back to markdown, saying synthesis was not engine-verified. `.uigates/` holds local runtime records; whether to commit `.uigates/knowledge/` is the project's decision.

## Installation guidance

For a project-local installation, copy `skills/uigates/` into the appropriate host layout above. For plugin distribution, install the `uigates` plugin (Codex: `.codex-plugin`; Claude Code: `.claude-plugin`) so its skill remains plugin-qualified. To try it locally in Claude Code without a marketplace, put `plugins/uigates`'s manifest, `skills/` and `hooks/` in `.claude/skills/uigates/` of a project (loads as `uigates@skills-dir` once the workspace is trusted), or run `claude --plugin-dir plugins/uigates`.

See the official host documentation: [Codex skills](https://learn.chatgpt.com/docs/build-skills), [Claude Code skills](https://code.claude.com/docs/en/skills), and [Gemini custom agents and skills](https://ai.google.dev/gemini-api/docs/custom-agents).

## The first trial used the earlier names

[The VAE trial](../evaluations/vae-mvp-1/RESULTS.md) ran on `uig` (`/uigates:uig`, `npx --no-install uig`, `.uig/`). Its records, prompts and results are kept as they were and are not rewritten; the raw material is in `~/Documents/Git/uig-trials/`.
