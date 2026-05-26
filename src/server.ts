import { renderHtml } from './lib/html.ts';
import { loadGraphFromDefaultInput } from './lib/parse.ts';

const graphData = loadGraphFromDefaultInput();

Bun.serve({
  port: 3000,
  routes: {
    '/': new Response(renderHtml(graphData), { headers: { 'content-type': 'text/html; charset=utf-8' } }),
    '/health': new Response('ok')
  }
});

console.log('Sigma graph viewer available at http://localhost:3000');
console.log('main =', graphData.mainKey, 'reachable =', graphData.reachable.length, 'unreachable =', graphData.unreachable.length, 'nodes =', graphData.nodes.length, 'files =', graphData.files.length);