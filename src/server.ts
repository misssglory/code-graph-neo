import config from '../codegraph.toml';
import { renderHtml } from './lib/html.ts';
import { loadGraphFromDefaultInput } from './lib/parse.ts';

const graphData = loadGraphFromDefaultInput();
const port = Number(process.env.PORT || 3000);

Bun.serve({
  port,
  routes: {
    '/': () => new Response(renderHtml(graphData, config), { headers: { 'content-type': 'text/html; charset=utf-8' } }),
    '/health': () => new Response('ok'),
  },
});

console.log(`Sigma graph viewer available at http://localhost:${port}`);
console.log('main', graphData.mainKey, 'reachable', graphData.reachable.length, 'unreachable', graphData.unreachable.length, 'nodes', graphData.nodes.length, 'files', graphData.files.length);