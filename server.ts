import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type NodeRec = {
  key: string;
  label: string;
  path?: string;
  type?: string;
  visibility?: string;
  level?: number;
  calls?: string[];
};

type EdgeRec = {
  source: string;
  target: string;
  type: string;
};

type GraphData = {
  nodes: NodeRec[];
  edges: EdgeRec[];
  mainKey: string | null;
  reachable: string[];
  unreachable: string[];
};

function extractJsonPayload(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('Could not find JSON payload in input file');
  return text.slice(start, end + 1);
}

function parseStructuredGraph(text: string): GraphData {
  const payload = JSON.parse(extractJsonPayload(text));
  const graph = payload.graph ?? payload;
  const rawNodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const rawEdges = Array.isArray(graph.edges) ? graph.edges : [];

  const nodes: NodeRec[] = rawNodes.map((n: any) => ({
    key: String(n.key),
    label: String(n.attributes?.label ?? n.key),
    path: n.attributes?.path ? String(n.attributes.path) : undefined,
    type: n.attributes?.type ? String(n.attributes.type) : undefined,
    visibility: n.attributes?.visibility ? String(n.attributes.visibility) : undefined,
    level: typeof n.attributes?.level === 'number' ? n.attributes.level : undefined,
    calls: Array.isArray(n.attributes?.calls) ? n.attributes.calls.map((x: any) => String(x)) : []
  }));

  const edges: EdgeRec[] = rawEdges.map((e: any) => ({
    source: String(e.source),
    target: String(e.target),
    type: String(e.attributes?.type ?? 'unknown')
  }));

  const nodeKeys = new Set(nodes.map((n) => n.key));
  const mainKey = nodes.find((n) => n.label === 'main')?.key ?? nodes.find((n) => /(^|::)main$/i.test(n.key))?.key ?? null;
  const outgoing = new Map<string, string[]>();

  for (const edge of edges) {
    if (edge.type !== 'calls') continue;
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
    outgoing.get(edge.source)!.push(edge.target);
  }

  const reachable = new Set<string>();
  if (mainKey) {
    const stack = [mainKey];
    while (stack.length) {
      const current = stack.pop()!;
      if (reachable.has(current)) continue;
      reachable.add(current);
      for (const next of outgoing.get(current) ?? []) {
        if (nodeKeys.has(next) && !reachable.has(next)) stack.push(next);
      }
    }
  }

  return {
    nodes,
    edges,
    mainKey,
    reachable: [...reachable],
    unreachable: nodes.map((n) => n.key).filter((k) => !reachable.has(k))
  };
}

function html(graphData: GraphData): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Code Graph Sigma</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #000000;
      --panel: #050505;
      --panel-2: #0b0b0b;
      --text: #ffffff;
      --muted: #d0d0d0;
      --border: #222222;
      --main: #63d7ff;
      --reach: #67db8b;
      --unreach: #ff7e7e;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    .app { display: grid; grid-template-columns: 320px 1fr; min-height: 100vh; }
    .sidebar { background: var(--panel); border-right: 1px solid var(--border); padding: 16px; overflow: auto; }
    .stage { position: relative; min-height: 100vh; }
    h1 { margin: 0 0 8px; font-size: 20px; }
    p { color: var(--muted); line-height: 1.5; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0; }
    .chip { padding: 5px 9px; border-radius: 999px; border: 1px solid var(--border); background: var(--panel-2); font-size: 12px; }
    .mainchip { color: var(--main); }
    .reachchip { color: var(--reach); }
    .unreachchip { color: var(--unreach); }
    .search { width: 100%; padding: 10px 12px; border-radius: 10px; background: var(--panel-2); border: 1px solid var(--border); color: var(--text); }
    .meta { margin-top: 12px; color: var(--muted); font-size: 13px; line-height: 1.45; }
    #graph-container { position: absolute; inset: 0; }
    .inspect {
      position: absolute;
      right: 16px;
      top: 16px;
      width: min(430px, calc(100% - 32px));
      background: rgba(18, 18, 18, 0.92);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 12px 14px;
      color: var(--muted);
      line-height: 1.45;
      backdrop-filter: blur(10px);
      box-shadow: 0 12px 30px rgba(0,0,0,0.35);
    }
    .inspect strong { color: var(--text); }
    .legend-row { display: flex; gap: 8px; align-items: center; margin-top: 10px; color: var(--muted); font-size: 13px; }
    .swatch { width: 10px; height: 10px; border-radius: 999px; }
    .mainswatch { background: var(--main); }
    .reachswatch { background: var(--reach); }
    .unreachswatch { background: var(--unreach); }
  </style>
</head>
<body>
  <div class="app">
    <aside class="sidebar">
      <h1>Code graph</h1>
      <p>This viewer parses the JSON graph dump, renders it with Sigma.js, and marks everything not reachable from <strong>main</strong> as unreachable.</p>
      <div class="chips">
        <span class="chip mainchip">main: ${graphData.mainKey ?? 'not found'}</span>
        <span class="chip reachchip">reachable: ${graphData.reachable.length}</span>
        <span class="chip unreachchip">unreachable: ${graphData.unreachable.length}</span>
        <span class="chip">nodes: ${graphData.nodes.length}</span>
      </div>
      <input id="search" class="search" placeholder="Search label or path" />
      <div class="legend-row"><span class="swatch mainswatch"></span> entrypoint</div>
      <div class="legend-row"><span class="swatch reachswatch"></span> reachable from main</div>
      <div class="legend-row"><span class="swatch unreachswatch"></span> unreachable from main</div>
      <div id="selection" class="meta">Click a node to inspect it.</div>
    </aside>
    <main class="stage">
      <div id="graph-container"></div>
      <div id="inspect" class="inspect">Ready.</div>
    </main>
  </div>
  <script>window.__GRAPH__ = ${JSON.stringify(graphData)};</script>
  <script type="module">
    import Graph from 'https://esm.sh/graphology@0.26.0';
    import Sigma from 'https://esm.sh/sigma@3.0.0';

    const raw = window.__GRAPH__;
    const reachable = new Set(raw.reachable);
    const container = document.getElementById('graph-container');
    const inspect = document.getElementById('inspect');
    const selection = document.getElementById('selection');
    const search = document.getElementById('search');
    const graph = new Graph({ multi: true, allowSelfLoops: true });
    const baseNodeColor = new Map();
    const baseEdgeColor = new Map();
    const neighbors = new Map();
    let hoveredNode = null;

    const nodesByPath = new Map();
    for (const node of raw.nodes) {
      const path = node.path || 'unknown';
      if (!nodesByPath.has(path)) nodesByPath.set(path, []);
      nodesByPath.get(path).push(node);
    }

    const orderedPaths = [...nodesByPath.keys()].sort();
    orderedPaths.forEach((path, col) => {
      const list = nodesByPath.get(path);
      list.forEach((node, row) => {
        const isMain = node.key === raw.mainKey;
        const isReachable = reachable.has(node.key);
        const color = isMain ? '#63d7ff' : isReachable ? '#67db8b' : '#ff7e7e';
        baseNodeColor.set(node.key, color);
        graph.addNode(node.key, {
          label: node.label,
          path,
          typeName: node.type || 'unknown',
          visibility: node.visibility || 'unknown',
          x: col * 8,
          y: row * 1.8,
          size: isMain ? 18 : isReachable ? 12 : 10,
          color,
          forceLabel: isMain
        });
      });
    });

    let edgeId = 0;
    for (const edge of raw.edges) {
      if (edge.type !== 'calls') continue;
      if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue;
      const color = reachable.has(edge.source) && reachable.has(edge.target) ? '#58667f' : '#6b4040';
      const key = 'e' + edgeId++;
      baseEdgeColor.set(key, color);
      graph.addEdgeWithKey(key, edge.source, edge.target, {
        color,
        size: reachable.has(edge.source) && reachable.has(edge.target) ? 2 : 1,
        type: 'line'
      });
    }

    graph.forEachNode((node) => neighbors.set(node, new Set([node])));
    graph.forEachEdge((edge, attrs, source, target) => {
      neighbors.get(source).add(target);
      neighbors.get(target).add(source);
    });

    const sigma = new Sigma(graph, container, {
      minCameraRatio: 0.2,
      maxCameraRatio: 8,
      labelDensity: 1,
      labelGridCellSize: 120,
      renderEdgeLabels: false,
      allowInvalidContainer: false,
      labelColor: { color: '#ffffff' },
      defaultDrawNodeLabel: (context, data) => {
        const size = data.size || 1;
        if (size < 6 && !data.forceLabel) return;
        const label = String(data.label || '');
        const x = data.x + size + 6;
        const y = data.y;
        if (hoveredNode === data.key) {
          const paddingX = 8;
          const paddingY = 5;
          context.font = '600 12px Inter, ui-sans-serif, system-ui, sans-serif';
          const width = context.measureText(label).width;
          const boxX = x - paddingX;
          const boxY = y - 12;
          const boxW = width + paddingX * 2;
          const boxH = 20;
          const r = 10;
          context.fillStyle = '#ffffff';
          context.beginPath();
          context.moveTo(boxX + r, boxY);
          context.lineTo(boxX + boxW - r, boxY);
          context.quadraticCurveTo(boxX + boxW, boxY, boxX + boxW, boxY + r);
          context.lineTo(boxX + boxW, boxY + boxH - r);
          context.quadraticCurveTo(boxX + boxW, boxY + boxH, boxX + boxW - r, boxY + boxH);
          context.lineTo(boxX + r, boxY + boxH);
          context.quadraticCurveTo(boxX, boxY + boxH, boxX, boxY + boxH - r);
          context.lineTo(boxX, boxY + r);
          context.quadraticCurveTo(boxX, boxY, boxX + r, boxY);
          context.closePath();
          context.shadowColor = 'rgba(255,255,255,0.18)';
          context.shadowBlur = 18;
          context.fill();
          context.shadowBlur = 0;
          context.fillStyle = '#000000';
          context.fillText(label, x, y + 4);
          return;
        }
        context.font = '500 12px Inter, ui-sans-serif, system-ui, sans-serif';
        context.fillStyle = '#ffffff';
        context.fillText(label, x, y + 4);
      },
      defaultDrawNodeHover: (context, data) => {
        const glow = (data.size || 8) + 8;
        context.beginPath();
        context.arc(data.x, data.y, glow, 0, Math.PI * 2);
        context.fillStyle = 'rgba(255,255,255,0.08)';
        context.fill();
      }
    });

    sigma.getCamera().animatedReset({ duration: 0 });

    function applyVisualState(query = '') {
      const q = query.trim().toLowerCase();
      const hoverSet = hoveredNode ? neighbors.get(hoveredNode) || new Set([hoveredNode]) : null;

      graph.forEachNode((node, attrs) => {
        const matches = !q || attrs.label.toLowerCase().includes(q) || String(attrs.path || '').toLowerCase().includes(q);
        const hidden = !matches;
        graph.setNodeAttribute(node, 'hidden', hidden);
        const related = !hoverSet || hoverSet.has(node);
        graph.setNodeAttribute(node, 'color', hidden ? 'rgba(0,0,0,0)' : related ? baseNodeColor.get(node) : 'rgba(255,255,255,0.14)');
        graph.setNodeAttribute(node, 'size', hoveredNode === node ? (node === raw.mainKey ? 22 : 15) : (node === raw.mainKey ? 18 : reachable.has(node) ? 12 : 10));
        graph.setNodeAttribute(node, 'forceLabel', hoveredNode === node || node === raw.mainKey);
      });

      graph.forEachEdge((edge, attrs, source, target) => {
        const hidden = graph.getNodeAttribute(source, 'hidden') || graph.getNodeAttribute(target, 'hidden');
        graph.setEdgeAttribute(edge, 'hidden', hidden);
        if (hidden) return;
        const active = !hoverSet || (hoverSet.has(source) && hoverSet.has(target));
        graph.setEdgeAttribute(edge, 'color', active ? baseEdgeColor.get(edge) : 'rgba(255,255,255,0.05)');
        graph.setEdgeAttribute(edge, 'size', hoveredNode && active ? 3 : reachable.has(source) && reachable.has(target) ? 2 : 1);
      });

      sigma.refresh();
    }

    search.addEventListener('input', () => applyVisualState(search.value));

    sigma.on('clickNode', ({ node }) => {
      const attrs = graph.getNodeAttributes(node);
      const outgoing = graph.outboundNeighbors(node).slice(0, 24).map((id) => graph.getNodeAttribute(id, 'label'));
      const incoming = graph.inboundNeighbors(node).slice(0, 24).map((id) => graph.getNodeAttribute(id, 'label'));
      const status = node === raw.mainKey ? 'entrypoint' : reachable.has(node) ? 'reachable from main' : 'unreachable from main';
      selection.textContent = attrs.label + ' — ' + status;
      inspect.innerHTML = '<strong>' + attrs.label + '</strong><br>' +
        'key: ' + node + '<br>' +
        'path: ' + (attrs.path || 'unknown') + '<br>' +
        'type: ' + (attrs.typeName || 'unknown') + '<br>' +
        'visibility: ' + (attrs.visibility || 'unknown') + '<br>' +
        'status: ' + status + '<br><br>' +
        '<strong>Calls</strong>: ' + (outgoing.join(', ') || 'none') + '<br><br>' +
        '<strong>Called by</strong>: ' + (incoming.join(', ') || 'none');
    });

    sigma.on('enterNode', ({ node }) => {
      hoveredNode = node;
      applyVisualState(search.value);
    });

    sigma.on('leaveNode', () => {
      hoveredNode = null;
      applyVisualState(search.value);
    });

    applyVisualState();
  </script>
</body>
</html>`;
}

const inputPath = process.env.CODEGRAPH_INPUT || join(process.cwd(), 'public', 'paste.txt');
const raw = readFileSync(inputPath, 'utf8');
const graphData = parseStructuredGraph(raw);

Bun.serve({
  port: 3000,
  routes: {
    '/': new Response(html(graphData), { headers: { 'content-type': 'text/html; charset=utf-8' } }),
    '/health': new Response('ok')
  }
});

console.log('Sigma graph viewer available at http://localhost:3000');
console.log('main =', graphData.mainKey, 'reachable =', graphData.reachable.length, 'unreachable =', graphData.unreachable.length, 'nodes =', graphData.nodes.length);
