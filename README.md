# codegraph-bun

Bun + TypeScript project that parses the attached graph dump, computes reachability from `main`, and renders it with Sigma.js + Graphology.

## Run

```bash
bun install
bun run dev
```

Open http://localhost:3000

## Input

By default the app reads `public/paste.txt`.

You can override it with:

```bash
CODEGRAPH_INPUT=/path/to/paste.txt bun run dev
```