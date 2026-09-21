# Handoff: UI-GATES MVP trial and follow-up work

Written 2026-09-21 for a fresh session. Read this first; it is meant to be enough to continue without the earlier conversation. Delete it once it has been picked up. Nothing here has been pushed anywhere.

## In one paragraph

UI-GATES is an authority-aware learning system for AI agents (`uigates` repo: a skill, a TypeScript engine, a `uigates` CLI; the CLI was called `uig` until the rename described below). A first real-agent trial ran three tasks on the VAE repo. Stage 1 passed on the criteria fixed in advance, with caveats, and produced twelve findings. Most were acted on: a new `uig audit`, gating of CI and deployment files, denial kinds, skill guidance, and an opt-in write-time hook. **The `--lesson` change is now finished (see below). A second trial is planned but not prepared or run.** The results are in `evaluations/vae-mvp-1/RESULTS.md`; read that next.

## Where everything is

| What | Where | State |
| --- | --- | --- |
| The uigates repo | `~/Documents/Git/violetek/uigates`, branch `add-audit-and-gate-class` | The last commit is the one that finished `--lesson`. Not pushed. `.serena/` is untracked and not ours |
| Trial plan, criteria | `docs/mvp.md` | Current |
| Frozen prompts, protocol, score sheet | `evaluations/vae-mvp-1/PROMPTS.md` | Revision 2; used by trial 1 |
| Trial 1 results and findings | `evaluations/vae-mvp-1/RESULTS.md` | Current through the transcript review |
| Trial worktree (VAE) | `~/Documents/Git/uig-trials/vae-trial-1`, branch `trial/uig-mvp-1` | Head `2973f5f`; only `.uig/` untracked. **Finished; do not reuse** |
| Raw trial material | `~/Documents/Git/uig-trials/results/` (audits, patches, `.uig` snapshots, `transcripts/*.jsonl`) | Kept |
| The real VAE repo | `~/Documents/Git/violetek/vae`, branch `task/table-domain-and-field-ledger` at `4ec3baa` | The trial base. Not pushed. Fifty-two files of the user's own work are committed in it |
| Personal skill | `~/.claude/skills/uig` (v0.3.0, old) | Untouched. It used to override a project skill named `uig`; since the rename the project's skill is `uigates`, so it no longer collides, but `/uig` still runs it |

Tests: `npm run typecheck && npm test` from the repo root. 19 learning, 107 core, 2 Workboard (128), all passing.

## What was built, in order (all committed)

Commits up to and including the lesson work used the earlier names (`uig`, `.uig/`, `UIG_*`); the rename below changed them all. Descriptions of those commits keep the names they were made under.

| Commit | Change |
| --- | --- |
| `967f570` | `uig audit` (read-only scorer of a session against `.uig/` and `git diff`); CI and deployment files are gate-class in the engine (`core/GateClass.ts`) |
| `e01891e`, `18a56ad`, `2bda00c` | Trial plan and prompts; skill shipped as the `uigates` Claude Code plugin (`plugins/uigates/.claude-plugin/plugin.json`); launch instructions |
| `5148098` | `npx --no-install uig help` everywhere (a plain `npx uig` can fetch an unrelated npm package named `uig`) |
| `415f2b8`, `afb975e`, `8b0798a` | Trial results, tasks 1 to 3, and the stage 1 verdict |
| `b18f5a1` | Audit warns when a `--run` command runs a script outside the project or one that no longer exists |
| `8eb97ce` | Transcript review: models, gate confirmed, protocol deviations |
| `73ac8fb` | Denial kinds; opt-in write-time hook (`uig hook pre-write`, `uig enforce on`, `hooks/hooks.json`); skill guidance (authorize before writing; keep verification scripts in the project) |
| `797b104` | Lesson support in the synthesizer, inert until the CLI enabled it |
| `b5d59a1` | `--lesson` finished: CLI, tests, skill copies, docs |
| next commit | **Rename to one name, `uigates`** (see below) |

## The `--lesson` change: done, and not yet tried by a real agent

**Why.** After three tasks the ledger held seven lessons, mostly process. Decision (option B): an optional `--lesson "<what the next agent should know>"` on `receipt`, and only receipts that carry one are promoted. Semantic matching (option C) waits for a ledger of real lessons.

**What exists.** `Receipt.lesson?`; `CESynthesizer` option `requireLesson` (library default off, only the CLI turns it on) and `lessonProblem()` (under 20 or over 500 characters, a placeholder, or only restating the action or verification plan); `receipt --lesson`, checked **before** the verification runs so a refusal records nothing and leaves the authorization unspent; `synthesize` lists receipts it did not promote; `knowledge` prints lessons labelled as the agent's claim. The five skill copies say to use it and `skills_sync_test` requires that. Docs updated: `docs/knowledge-model.md` ("What a lesson is", including the prompt-injection risk), `docs/mvp.md`, `RESULTS.md`, `plugins/uigates/core/README.md`.

**Tests.** `core/lesson_test.ts` (19) and seven new tests in `cli/cli_test.ts`; `cli_test`'s `cycle` helper now passes a lesson. **Mutation-tested: 42 mutations across `synthesizer.ts` and `main.ts`, all killed, run against a green baseline**, and each of the five skill copies was broken three ways against the sync test. Two things the first pass exposed: a restatement check that no test could fail (the test's action was already lowercase and unpunctuated), and an existing evidence-tamper test that would have passed for the wrong reason once lesson-less receipts stopped being promoted (its receipt now carries a lesson).

**Still true.** A lesson is agent-written text later agents read, so it is a prompt-injection surface: flattened, truncated and labelled, not verified. Reuse is still matched on exact action text. No real agent has stated a lesson yet.

## The rename: one name, `uigates` (done, committed, not pushed)

`uig` and `uigates` had become confusing (`/uigates:uig`, `.uig/`, `UIG_*`, and two skills). Everything you type is now `uigates`; `UI-GATES` stays as prose. Full table and rationale: `docs/namespace.md`.

- **Command:** `uigates` (`bin/uigates.mjs`). `uig` remains in `package.json` `bin` as an undocumented alias for one release; no skill mentions it.
- **Skill:** one skill, `uigates`, in the five copies (`skills/uigates`, `.claude/skills/uigates`, `.agents/skills/uigates`, `plugins/uigates/skills/uigates`). The old long-form skill is now `skills/uigates/references/long-form.md`, with no frontmatter, so no host loads it as a second skill. Invocation is `/uigates:uigates` (Codex: `$uigates:uigates`), which stutters; **not yet seen in a live Claude Code session**.
- **State directory:** `.uigates/`. A project that already has `.uig/` **keeps using it** and is never migrated, because evidence references embed the path (`sha256:<hash>:.uig/evidence/<id>.log`). With both, `.uigates/` wins and the CLI and audit warn. Both names are always protected (engine, hook, audit). All of this lives in `plugins/uigates/core/names.ts`.
- **Settings:** `UIGATES_PRINCIPAL`, `UIGATES_ROOT`, `UIGATES_ENFORCE`, `UIGATES_CODEX`; the `UIG_*` names are still read.
- **Version:** 0.2.0 in `package.json`, the lockfile and both plugin manifests.
- **npm:** `uigates` is **not** on the registry (404, checked 2026-09-21); `uig` is an unrelated package. `--no-install` stays. Nothing has been published.
- **Left alone on purpose:** everything under `evaluations/vae-mvp-1/` except this file, `docs/mvp.md`'s trial description, `evaluations/real-project-v1/` and `audits/` (hash-bound or historical records that quote the old names), and your personal `~/.claude/skills/uig`.
- **Tests:** `core/names_test.ts` (16) and `cli/names_cli_test.ts` (15); the suite is 19 learning + 138 core + 2 Workboard = 159. Mutation-tested: 50 mutations of the resolver, patterns, settings, store, synthesizer, hook, audit, CLI and package bins, all killed against a green baseline (one survived the first pass, the audit's recognition of `.uigates/` evidence, and now has a test); plus 21 mutations of the skill copies against `skills_sync_test`, which now also requires each skill to be named `uigates`, forbids the bare old command in skills, and fails if the old directories return.
- **Trial 1's records still work.** Checked against the real trial worktree and a copy of its `.uig/`: `audit --base 111ed08 --json`, `status` and `knowledge` give byte-identical output from the old CLI (`b5d59a1`) and the new one, and the audit created nothing in the worktree.
- **Trial 1's shim** in `vae-trial-1/node_modules/.bin/uig` still runs, but it points at the old `bin/uig.mjs`, which no longer exists. Do not reuse that worktree (it is finished). Trial 2 needs a `uigates` shim.

## The second trial: planned, not prepared

Recommendation (not yet agreed with the user): rerun **the same three tasks** from a clean base, so the two trials can be compared. Neither trial is blind and n is one, so treat any difference as an observation.

Setup, none of which is done:

1. New worktree from the VAE base: `git -C ~/Documents/Git/violetek/vae worktree add ~/Documents/Git/uig-trials/vae-trial-2 4ec3baa`, then a branch `trial/uig-mvp-2`. The base has no `.uigates/` or `.uig/` and none of trial 1's changes. Run the five verifiers there first (commands in `PROMPTS.md`).
2. Install the **updated** plugin: copy `plugins/uigates/.claude-plugin/`, `skills/` **and `hooks/`** into `.claude/skills/uigates/` of the new worktree. The trial 1 copy has neither the hook nor the new skill wording. Validate with `claude plugin validate`. Copy `skills/uigates/` (not the old `uig`), so the skill is `/uigates:uigates`. Create the shim in the gitignored `node_modules/.bin/uigates` (`#!/bin/sh` then `exec node <uigates>/bin/uigates.mjs "$@"`, `chmod +x`), check `npx --no-install uigates help`, and commit as "Trial setup". That commit is the audit base.
3. Add a revision note to `PROMPTS.md` (same task text, new base and worktree, hook on, and the skill now invoked as `/uigates:uigates` where PROMPTS.md says `/uigates:uig`; the first trial ran on the earlier names). **Do not put `--lesson` or hook instructions in the prompts**: the point is whether the skill alone gets the behaviour.
4. Launch each task in a **fresh** session, from the worktree, with `UIGATES_ENFORCE=1` and the provider overrides removed:
   `cd ~/Documents/Git/uig-trials/vae-trial-2 && UIGATES_ENFORCE=1 env -u ANTHROPIC_BASE_URL -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u OPENAI_BASE_URL claude`
   Trial 1 broke "a fresh session per task" (tasks 2 and 3 shared one); do not repeat that. Run `/status` and record the model.
5. **Smoke-test the hook before scoring anything.** It has never run inside a live Claude Code session; it is tested only against real payloads and real records. With enforcement on and an intent started, ask the agent to edit a file before authorizing it and check the edit is refused. If the plumbing does not work (hook not loaded, `npx` too slow, wrong project directory), fix that first.
6. Score with `uigates audit --base <setup commit>`, and add to the score sheet: hook refusals (count, and which tools); whether the agent routes around the hook by writing through Bash; lessons stated and whether each says more than the title; where verification scripts were put; whether the agent ran `uigates knowledge` first.

What the second trial can and cannot show: it can show whether the skill and hook change behaviour. It cannot show that lessons help, because that needs an agent to use another agent's lesson on a related task, and reuse is still matched on exact action text. No "candidate" lesson is expected.

## Decisions made, and decisions still open

Made (do not reopen without a reason):
- The skill ships as the `uigates` plugin so a personal `/uig` cannot shadow it. The user's personal skill stays as it is.
- The hook is **opt-in** and **fails open**. An intent lasts 24 hours; a default-on hook would lock a project during ordinary work.
- The library default for `requireLesson` is off; only the CLI turns it on.
- Nothing is pushed. Every commit is local.

Open, for the user:
- Should the hook be on by default in the shipped plugin, once a live session has shown it works?
- Should `receipt` snapshot an in-repo script's content into the evidence, so the record holds what was checked and not only what it printed? (The audit only warns today.)
- Should a project-wide resource (`.` or `/`) be gated outright? The engine cannot see that it covers a CI file; the audit catches it afterwards.
- Should agents get a sanctioned scratch location? Anything under `.uigates/` (or `.uig/`) is gated state today.
- Semantic matching of lessons (option C), after the ledger has real lessons in it.
- Whether to ship `.claude-plugin/marketplace.json` so others can install the plugin.

## Not verified. Do not assume any of these

- The **hook has not run in a live Claude Code session**, and the plugin's hook config is not covered by `claude plugin validate` output (it reported only the manifest).
- The `claude` CLI login here is **expired** (`OAuth session expired`). Headless probes fail; do not try to work around it. The user can `/login` in their own terminal.
- The `--lesson` change is finished and mutation-tested, but no real agent has used it.
- No GitLab runner or CI linter has run the CI change from task 3.
- The task 1 to 3 results are n = 1: one model (`claude-sonnet-5`), one repo, one operator, one deviation (tasks 2 and 3 in one session) and one directive intervention (task 1).

## Gotchas that cost time

- **The user's shell exports a dead proxy.** `~/.zshrc` sets `ANTHROPIC_BASE_URL=http://127.0.0.1:8787` (a Headroom block; the binary is not installed and nothing listens), after an earlier line pointing at `api.minimax.io` with a key for that endpoint. A terminal `claude` launched from zsh fails or, worse, is not Claude on Anthropic's API. Always launch with the `env -u ...` form above and check `/status`. Do not edit the dotfiles without asking.
- **A personal skill shadows a project skill of the same name** (enterprise, then personal, then project). Use `/uigates:uigates`. Since the rename the project's skill is named `uigates`, so a personal `uig` skill no longer collides with it.
- **Start sessions in the worktree**, not `~/Documents/Git/uig-trials`. Trial run 1 started one level up and was void.
- The parent `violetek/CLAUDE.md` describes VAE as Node/Vue with MUI and lucide-react rules. **That is wrong for VAE** (it is a Python SAM backend, React/Vite frontend, Astro codex and OKF lore). It is one reason the worktree lives outside `violetek/`.
- **Mutation-testing Python: turn bytecode caching off** (`PYTHONDONTWRITEBYTECODE=1`, `python3 -B`, `-p no:cacheprovider`). Two edits that change a file by the same number of bytes in the same second reuse stale `.pyc`, and a test appears to fail for the wrong reason.
- macOS and zsh: there is no `timeout`; an unquoted `--include=*.ts` glob errors in zsh; `sed -i ''` needs the empty string; relative paths from the repo root miss `~/Documents/Git/uig-trials` (it is two levels up).
- `receipt` is one-shot per authorization. A `--run` verification runs when the receipt is recorded, so validate anything that can fail (a lesson, for example) **before** running it.
- **My own errors, so the next session can guard against them:** I wrote assertions that could not fail (`/./` against output, `status === 2 || 0`) and a mutation check that misled through stale bytecode. I caught them by reading my tests back and by breaking the code on purpose. Do that for every new test: change the behaviour under test and confirm the test goes red.

## How to work with the user

The user wants results scored from records and independent checks, not from an agent's own summary, and wants what did not work stated plainly. Trial replies should be brief and non-technical: in trial 1 a directive reply from the operator shaped the result and had to be recorded as an intervention. The user often replies "do it" to a recommendation; that means proceed with what was recommended, not with everything ever mentioned. Confirm before anything outward-facing: pushes, changing dotfiles or the personal skill, sending repo content to a service.

## Commands

```bash
cd ~/Documents/Git/violetek/uigates
npm run typecheck && npm test                          # 159 tests
npx tsx --test plugins/uigates/cli/audit_test.ts       # one file
claude plugin validate plugins/uigates                 # manifest only

# score a finished session (read-only)
cd ~/Documents/Git/uig-trials/vae-trial-N
npx --no-install uigates audit --base <setup-commit> [--intent <id>] [--json]
npx --no-install uigates status
npx --no-install uigates knowledge

# read a session transcript (JSON lines, one event each)
ls ~/.claude/projects/-Users-ornelastechnologies-Documents-Git-uig-trials-vae-trial-N/
```

## Kickoff message for the new session

> Read `evaluations/vae-mvp-1/HANDOFF.md`, then `evaluations/vae-mvp-1/RESULTS.md` and `docs/mvp.md`. Verify the state it describes with `git log`, `git status` and `npm test`. Then prepare the second trial (section "The second trial"), smoke-testing the hook before scoring anything.
