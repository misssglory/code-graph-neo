# codegraph-bun

Bun + TypeScript project that parses the attached graph dump, computes reachability from `main`, and renders it with Sigma.js + Graphology.

## Run

```bash
bun install
bun run dev
```

Open http://localhost:3000

## Input

By default the app opens `public/graph.json`. The **graphs** tab lists all `.json` snapshots in `public/`, including their last modification time, and can switch the viewer to another snapshot without restarting the server.

You can override it with:

```bash
CODEGRAPH_INPUT=/path/to/graph.json bun run dev
```