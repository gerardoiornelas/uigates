# Workboard evaluation: attempt history

This is a map of what each store contains and why neither produced a certificate. It adds no results; every number below comes from records already committed here. Nothing in this directory should be deleted or regenerated: the stores are content-addressed evidence, and the frozen plans, blobs and certificate are hash-bound to each other.

## Attempt 1: `store/`, plan `workboard-v1`

- Discovery (`discovery-add`, `discovery-complete`) and the synthesis model call ran and were accepted, with full token counts.
- Of 32 holdout arms, **6 completed** with telemetry: the control and treatment arms of `list`, `search` and `overdue`. **26** ended without telemetry and are recorded as failed/unknown. The [REPORT](REPORT.md) attributes this to a Codex usage limit.
- The certificate ([certificate.json](certificate.json), also `store/certificates/workboard-v1.json`) is **not certified**, and correctly so: the claim gate withholds support when telemetry is incomplete.
- The 3 completed pairs, for the record: guidance used more tokens in `list` (+22,630) and `overdue` (+20,792) and 17,857 fewer in `search`. Three pairs from one project cannot support or refute anything.

## Attempt 2: `store-complete/`, plan `workboard-v1-complete`

`resume.mjs` copied attempt 1's discovery, synthesis and lesson into a new store, froze a new plan under a new id, and ran all 32 arms again.

- **All 32 arms failed at startup**, including the 3 pairs that had passed in attempt 1. Each arm lasted 80–253 ms and captured an empty trace (the hash of zero bytes); every arm's stderr shows the same initialization failure.
- Cause, from the recorded stderr: Codex could not initialize (`failed to open state DB at ~/.codex/state_5.sqlite … attempt to write a readonly database`, then `failed to initialize in-process app-server client: Operation not permitted`). The process that launched it evidently could not write to `~/.codex`. In the arm inspected for this note (`list` control) the verifier then failed with `ERR_MODULE_NOT_FOUND` because the agent never wrote a feature file.
- This is an environment fault, not a learning result. Only the carried-over discovery and synthesis runs have usage in this store. **No certificate exists for it.**

## Consequences for anyone continuing this work

1. **Do not certify from `store-complete/`.** Its plan records the 3 previously passing pairs as acceptance failures, which is wrong as a description of the agent and would poison an aggregate.
2. **A valid rerun needs a new plan id and a fresh freeze.** The harness deliberately refuses to overwrite a recorded arm or quietly retry it, so the arm ids in both stores are used up.
3. **Run from an environment where the agent CLI can start** (writable `~/.codex`, not inside a read-only sandbox). A quick preflight before any arm would have caught attempt 2 in one call; the harness does not have one yet. Adding it, and a separate "void: infrastructure" status distinct from "acceptance failed", is listed in the [roadmap](../../docs/roadmap.md).
4. Even a clean rerun would not answer the synthesis question, because the lesson was model-authored through `propose` and the task source was readable by both arms. See the roadmap's paused-experiment notes.
