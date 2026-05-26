import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderHtml } from './lib/html';
import { parseStructuredGraph } from './lib/parse';

const inputPath = process.env.CODEGRAPH_INPUT || join(process.cwd(), 'public', 'paste.txt');
const raw = readFileSync(inputPath, 'utf8');
const graphData = parseStructuredGraph(raw);

Bun.serve({
  port: 3000,
  routes: {
    '/': new Response(renderHtml(graphData), { headers: { 'content-type': 'text/html; charset=utf-8' } }),
    '/health': new Response('ok')
  }
});

console.log('Sigma graph viewer available at http://localhost:3000');
console.log('main =', graphData.mainKey, 'reachable =', graphData.reachable.length, 'unreachable =', graphData.unreachable.length, 'nodes =', graphData.nodes.length);