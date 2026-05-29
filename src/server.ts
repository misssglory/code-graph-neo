import { readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import config from '../codegraph.toml';
import { renderHtml } from './lib/html.ts';
import { loadGraphFromDefaultInput, parseStructuredGraph } from './lib/parse.ts';

const publicDir = resolve(process.cwd(), 'public');
const graphData = loadGraphFromDefaultInput();
const port = Number(process.env.PORT || 3000);

type GraphSnapshot = {
  path: string;
  name: string;
  size: number;
  mtime: string;
  mtimeMs: number;
};

function isPathInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function listJsonFiles(dir = publicDir, prefix = ''): GraphSnapshot[] {
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }> = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const snapshots: GraphSnapshot[] = [];
  for (const entry of entries) {
    const absolutePath = join(dir, entry.name);
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      snapshots.push(...listJsonFiles(absolutePath, relativePath));
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) continue;
    const stat = statSync(absolutePath);
    snapshots.push({
      path: relativePath,
      name: entry.name,
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      mtimeMs: stat.mtimeMs,
    });
  }
  return snapshots.sort((a, b) => {
    if (a.path === 'graph.json') return -1;
    if (b.path === 'graph.json') return 1;
    return b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path);
  });
}

function graphPathFromRequest(request: Request): string {
  const url = new URL(request.url);
  const requested = url.searchParams.get('path') || 'graph.json';
  if (!requested.toLowerCase().endsWith('.json')) throw new Error('Only .json graph snapshots can be opened');
  const absolutePath = resolve(publicDir, requested);
  if (!isPathInside(publicDir, absolutePath)) throw new Error('Graph path must stay inside the public folder');
  return absolutePath;
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers || {}) },
  });
}

Bun.serve({
  port,
  routes: {
    '/': () => new Response(renderHtml(graphData, config), { headers: { 'content-type': 'text/html; charset=utf-8' } }),
    '/health': () => new Response('ok'),
    '/api/graphs': () => jsonResponse({ defaultPath: 'graph.json', snapshots: listJsonFiles() }),
    '/api/graph': (request) => {
      try {
        const absolutePath = graphPathFromRequest(request);
        const raw = readFileSync(absolutePath, 'utf8');
        const stat = statSync(absolutePath);
        const graph = parseStructuredGraph(raw);
        return jsonResponse({
          graph,
          snapshot: {
            path: relative(publicDir, absolutePath).replaceAll(sep, '/'),
            name: absolutePath.split(sep).at(-1) || 'graph.json',
            size: stat.size,
            mtime: stat.mtime.toISOString(),
            mtimeMs: stat.mtimeMs,
          },
        });
      } catch (error) {
        return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
      }
    },
  },
});

console.log(`Sigma graph viewer available at http://localhost:${port}`);
console.log('main', graphData.mainKey, 'reachable', graphData.reachable.length, 'unreachable', graphData.unreachable.length, 'nodes', graphData.nodes.length, 'files', graphData.files.length);
