# Workboard

A local-first command-line project board for small teams. No server, account or dependencies. Records stay in a JSON file you own. Requires Node 22 or later.

Run `node cli.mjs help` for commands. Use `WORKBOARD_FILE=/path/to/board.json` to choose storage. With no override, data lives at `.workboard.json` in the current directory. Command inputs and outputs are JSON so other tools can compose them.

```sh
node cli.mjs add '{"title":"Ship release notes","labels":["docs"],"priority":2}'
node cli.mjs list '{}'
```

The implementation separates disk persistence, record validation and feature operations. Files under `features/` each export `run(board, input)`. The CLI owns load/save; feature functions operate on an in-memory board and return JSON-serializable values. `node --test test/*.test.mjs` runs local contracts.

This project is also the real coding-task workload for UI-GATES evaluation. The released feature code is produced by coding agents and accepted by external behavioral checks. Benchmark task prompts and evidence are kept outside worker workspaces.
