# Handoff: UI-GATES MVP trial and follow-up work

Written 2026-09-21 for a fresh session. Read this first; it is meant to be enough to continue without the earlier conversation. Delete it once it has been picked up. Nothing here has been pushed anywhere.

## In one paragraph

UI-GATES is an authority-aware learning system for AI agents (`uigates` repo: skills, a TypeScript engine, a `uig` CLI). A first real-agent trial ran three tasks on the VAE repo. Stage 1 passed on the criteria fixed in advance, with caveats, and produced twelve findings. Most were acted on: a new `uig audit`, gating of CI and deployment files, denial kinds, skill guidance, and an opt-in write-time hook. **One change is half built (`--lesson`), and a second trial is planned but not prepared or run.** The results are in `evaluations/vae-mvp-1/RESULTS.md`; read that next.

## Where everything is

| What | Where | State |
| --- | --- | --- |
| The uigates repo | `~/Documents/Git/violetek/uigates`, branch `add-audit-and-gate-class` | Head is the commit that added this file; the last code commit is `797b104`. Not pushed. `.serena/` is untracked and not ours |
| Trial plan, criteria | `docs/mvp.md` | Current |
| Frozen prompts, protocol, score sheet | `evaluations/vae-mvp-1/PROMPTS.md` | Revision 2; used by trial 1 |
| Trial 1 results and findings | `evaluations/vae-mvp-1/RESULTS.md` | Current through the transcript review |
| Trial worktree (VAE) | `~/Documents/Git/uig-trials/vae-trial-1`, branch `trial/uig-mvp-1` | Head `2973f5f`; only `.uig/` untracked. **Finished; do not reuse** |
| Raw trial material | `~/Documents/Git/uig-trials/results/` (audits, patches, `.uig` snapshots, `transcripts/*.jsonl`) | Kept |
| The real VAE repo | `~/Documents/Git/violetek/vae`, branch `task/table-domain-and-field-ledger` at `4ec3baa` | The trial base. Not pushed. Fifty-two files of the user's own work are committed in it |
| Personal skill | `~/.claude/skills/uig` (v0.3.0, old) | Untouched. **It overrides a project skill named `uig`**, which is why the skill ships as the `uigates` plugin (`/uigates:uig`) |

Tests: `npm run typecheck && npm test` from the repo root. At `797b104`: 19 learning, 81 core, 2 Workboard, all passing.

## What was built, in order (all committed)

| Commit | Change |
| --- | --- |
| `967f570` | `uig audit` (read-only scorer of a session against `.uig/` and `git diff`); CI and deployment files are gate-class in the engine (`core/GateClass.ts`) |
| `e01891e`, `18a56ad`, `2bda00c` | Trial plan and prompts; skill shipped as the `uigates` Claude Code plugin (`plugins/uigates/.claude-plugin/plugin.json`); launch instructions |
| `5148098` | `npx --no-install uig help` everywhere (a plain `npx uig` can fetch an unrelated npm package named `uig`) |
| `415f2b8`, `afb975e`, `8b0798a` | Trial results, tasks 1 to 3, and the stage 1 verdict |
| `b18f5a1` | Audit warns when a `--run` command runs a script outside the project or one that no longer exists |
| `8eb97ce` | Transcript review: models, gate confirmed, protocol deviations |
| `73ac8fb` | Denial kinds; opt-in write-time hook (`uig hook pre-write`, `uig enforce on`, `hooks/hooks.json`); skill guidance (authorize before writing; keep verification scripts in the project) |
| `797b104` | **WIP:** lesson support in the synthesizer, inert (see below) |

## The unfinished change: `--lesson`

**Why.** After three tasks the ledger held seven lessons, mostly process ("delete the temporary harness"). A pack is keyed by the action text an agent chose; its "reuse guidance" is boilerplate that restates the action, the verification plan and evidence hashes. There is no lesson content. Every verified receipt is promoted regardless of value. Decision already made with the user: option B, an optional `--lesson "<what the next agent should know>"` on `receipt`, and only receipts that carry one are promoted. Semantic matching of similar lessons (option C) is deferred until a ledger of real lessons exists.

**Done and committed (`797b104`).** `Receipt.lesson?` in `core/types/primitives.ts`. In `intelligence/ce/synthesizer.ts`: `SynthesisOptions.requireLesson` (default **off**, so all existing callers and tests are unchanged); `lessonProblem(lesson, action, verificationPlan)` which rejects a lesson that is under 20 characters, a placeholder, over 500 characters, or only restates the action or the verification plan; `getUnpromoted()`; `PackState.lessons` (last three distinct, most recent last; older packs without the field are handled with `??= []`); `KnowledgePack.lessons`; and a `## Lesson` section in the rendered pack that says the text is the agent's claim and that the receipt does not prove the advice right. Typecheck and all tests pass because nothing enables it yet.

**Not done. In this order:**

1. **CLI, `plugins/uigates/cli/main.ts`.**
   - Import `lessonProblem`; add `lesson: { type: 'string' }` to `parseArgs`; add `[--lesson <text>]` to the `receipt` line of `HELP`.
   - In `case 'receipt'`, collapse whitespace in the lesson and call `lessonProblem(lesson, authorization.action, proposal.verificationPlan)` **before `runVerification`**. A receipt is one-shot per authorization, and the verification command has side effects, so a bad lesson must fail before anything runs and must not burn the authorization.
   - Add `...(lesson ? { lesson } : {})` to the receipt object. Print `Lesson: ...`, or, when none was given, say the receipt will not be promoted and that a lesson can only be stated when the receipt is recorded (a receipt cannot be amended).
   - `case 'synthesize'`: construct with `{ requireLesson: true }`, then print each `synth.getUnpromoted()` entry with how to state one next time. Leave the `approve` and `retire` constructions alone.
   - `printKnowledge`: print each pack's lessons, labelled as the agent's claim.
2. **Tests.**
   - `cli/cli_test.ts`: its `cycle` helper records receipts with no lesson and many tests expect lessons to appear, so make `cycle` pass a valid `--lesson` (for example "wrap the writes in one transaction so a failure rolls the whole change back"; it must not be a substring of the action text or verification plan). Then run the file and fix whatever else assumed lesson-less promotion.
   - New CLI tests: a lesson is stored on the receipt and shown by `uig knowledge`; a receipt without one is recorded but not promoted and `synthesize` says so; each rejection (too short, restates the action, restates the verification plan, placeholder, too long) fails **without running the verification or creating a receipt**; a multi-line lesson is collapsed and a leading `#` cannot open a heading in the pack file; a failure still contradicts an existing lesson; a second intent's different lesson is added (most recent three kept).
   - New `core/lesson_test.ts` for the library: `requireLesson` off by default (old behaviour), on = no lesson means not promoted and listed by `getUnpromoted()`; use `'unverified'` authority and `evidenceVerifier: () => true` as the other synthesizer tests do. Register both in `package.json` `test:core`.
   - **Mutation-test them** (see gotchas): remove the `requireLesson` check, and each `lessonProblem` branch, and confirm a test fails each time.
3. **Skill copies (five):** `skills/uig`, `skills/ui-gates`, `.claude/skills/uig`, `.agents/skills/uig`, `plugins/uigates/skills/uig`. Add a sentence: state what the next agent should know with `--lesson` when recording the receipt; a receipt without one is verified but teaches nothing, and cannot be given one later; it must say more than the action title. The long copies have the receipt step around line 31 and 50; the short ones have an `Engine:` line. Add a matching regex to `ESSENTIALS` in `plugins/uigates/core/skills_sync_test.ts`, and confirm the test fails when one copy drops it.
4. **Docs:** `docs/knowledge-model.md` (what a lesson now is); the "What it models" table in `plugins/uigates/core/README.md`; in `docs/mvp.md` change the "3, 9: lessons with no value filter | Not changed" row to describe this; in `RESULTS.md` mark the open decision as implemented and **not yet tested with a real agent**.
5. Full suite, then commit.

**One risk to state in the docs and keep in mind.** A lesson is agent-written text that future agents read into their context, which makes it a prompt-injection surface. It is flattened to one line and truncated like every other field, and the pack labels it as an unverified claim, but nothing checks the advice is sound.

## The second trial: planned, not prepared

Recommendation (not yet agreed with the user): rerun **the same three tasks** from a clean base, so the two trials can be compared. Neither trial is blind and n is one, so treat any difference as an observation.

Setup, none of which is done:

1. New worktree from the VAE base: `git -C ~/Documents/Git/violetek/vae worktree add ~/Documents/Git/uig-trials/vae-trial-2 4ec3baa`, then a branch `trial/uig-mvp-2`. The base has no `.uig/` and none of trial 1's changes. Run the five verifiers there first (commands in `PROMPTS.md`).
2. Install the **updated** plugin: copy `plugins/uigates/.claude-plugin/`, `skills/` **and `hooks/`** into `.claude/skills/uigates/` of the new worktree. The trial 1 copy has neither the hook nor the new skill wording. Validate with `claude plugin validate`. Recreate the shim in the gitignored `node_modules/.bin/uig` (`#!/bin/sh` then `exec node <uigates>/bin/uig.mjs "$@"`), check `npx --no-install uig help`, and commit as "Trial setup". That commit is the audit base.
3. Add a revision note to `PROMPTS.md` (same task text, new base and worktree, hook on). **Do not put `--lesson` or hook instructions in the prompts**: the point is whether the skill alone gets the behaviour.
4. Launch each task in a **fresh** session, from the worktree, with `UIG_ENFORCE=1` and the provider overrides removed:
   `cd ~/Documents/Git/uig-trials/vae-trial-2 && UIG_ENFORCE=1 env -u ANTHROPIC_BASE_URL -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u OPENAI_BASE_URL claude`
   Trial 1 broke "a fresh session per task" (tasks 2 and 3 shared one); do not repeat that. Run `/status` and record the model.
5. **Smoke-test the hook before scoring anything.** It has never run inside a live Claude Code session; it is tested only against real payloads and real records. With enforcement on and an intent started, ask the agent to edit a file before authorizing it and check the edit is refused. If the plumbing does not work (hook not loaded, `npx` too slow, wrong project directory), fix that first.
6. Score with `uig audit --base <setup commit>`, and add to the score sheet: hook refusals (count, and which tools); whether the agent routes around the hook by writing through Bash; lessons stated and whether each says more than the title; where verification scripts were put; whether the agent ran `uig knowledge` first.

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
- Should agents get a sanctioned scratch location? Anything under `.uig/` is gated state today.
- Semantic matching of lessons (option C), after the ledger has real lessons in it.
- Whether to ship `.claude-plugin/marketplace.json` so others can install the plugin.

## Not verified. Do not assume any of these

- The **hook has not run in a live Claude Code session**, and the plugin's hook config is not covered by `claude plugin validate` output (it reported only the manifest).
- The `claude` CLI login here is **expired** (`OAuth session expired`). Headless probes fail; do not try to work around it. The user can `/login` in their own terminal.
- The `--lesson` change is unfinished and untested with a real agent.
- No GitLab runner or CI linter has run the CI change from task 3.
- The task 1 to 3 results are n = 1: one model (`claude-sonnet-5`), one repo, one operator, one deviation (tasks 2 and 3 in one session) and one directive intervention (task 1).

## Gotchas that cost time

- **The user's shell exports a dead proxy.** `~/.zshrc` sets `ANTHROPIC_BASE_URL=http://127.0.0.1:8787` (a Headroom block; the binary is not installed and nothing listens), after an earlier line pointing at `api.minimax.io` with a key for that endpoint. A terminal `claude` launched from zsh fails or, worse, is not Claude on Anthropic's API. Always launch with the `env -u ...` form above and check `/status`. Do not edit the dotfiles without asking.
- **A personal skill shadows a project skill of the same name** (enterprise, then personal, then project). Use `/uigates:uig`.
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
npm run typecheck && npm test                          # 102 tests at 797b104
npx tsx --test plugins/uigates/cli/audit_test.ts       # one file
claude plugin validate plugins/uigates                 # manifest only

# score a finished session (read-only)
cd ~/Documents/Git/uig-trials/vae-trial-N
npx --no-install uig audit --base <setup-commit> [--intent <id>] [--json]
npx --no-install uig status
npx --no-install uig knowledge

# read a session transcript (JSON lines, one event each)
ls ~/.claude/projects/-Users-ornelastechnologies-Documents-Git-uig-trials-vae-trial-N/
```

## Kickoff message for the new session

> Read `evaluations/vae-mvp-1/HANDOFF.md`, then `evaluations/vae-mvp-1/RESULTS.md` and `docs/mvp.md`. Verify the state it describes with `git log`, `git status` and `npm test`. Then finish the `--lesson` change (section "The unfinished change"), mutation-testing each new test, and stop for review before preparing the second trial.
