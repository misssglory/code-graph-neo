export const clientCode = String.raw`
import Graph from 'https://esm.sh/graphology@0.26.0';
import Sigma from 'https://esm.sh/sigma@3.0.0';
import forceAtlas2 from 'https://esm.sh/graphology-layout-forceatlas2@0.10.1';

const raw = window.__GRAPH__;
const reachable = new Set(raw.reachable);
const files = raw.files || [];
const fileContentByPath = new Map(files.map((f) => [f.path, f.content || '']));
const container = document.getElementById('graph-container');
const inspect = document.getElementById('inspect');
const selection = document.getElementById('selection');
const search = document.getElementById('search');
const graph = new Graph({ multi: true, allowSelfLoops: true });
const baseNodeColor = new Map();
const baseEdgeColor = new Map();
const neighbors = new Map();
const params = new URL(window.location.href).searchParams;
const layoutMode = params.get('layout') || 'columns';
let hoveredNode = null;
let selectedNode = null;

function sourcePreview(node) {
  const path = node.path || '';
  const content = fileContentByPath.get(path) || '';
  if (!content) return node.sourceSnippet || '';
  if (node.range?.start?.line && node.range?.end?.line) {
    const lines = content.split('\n');
    const start = Math.max(0, node.range.start.line - 1);
    const end = Math.min(lines.length, node.range.end.line);
    return lines.slice(start, end).join('\n');
  }
  return node.sourceSnippet || '';
}

function seedColumnLayout() {
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
        key: node.key,
        label: node.label,
        path,
        typeName: node.type || 'unknown',
        visibility: node.visibility || 'unknown',
        signature: node.signature || '',
        sourceSnippet: node.sourceSnippet || '',
        range: node.range || null,
        x: col * 8 + ((row % 2) * 0.35),
        y: row * 1.8,
        size: isMain ? 18 : isReachable ? 12 : 10,
        color,
        forceLabel: isMain
      });
    });
  });
}

function addEdges() {
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
}

function applyOptionalLayout() {
  if (layoutMode !== 'forceatlas2') return;
  const settings = forceAtlas2.inferSettings(graph);
  forceAtlas2.assign(graph, {
    iterations: 120,
    settings: {
      ...settings,
      gravity: 1,
      scalingRatio: 14,
      slowDown: 1.2
    }
  });
}

function buildNeighborMap() {
  graph.forEachNode((node) => neighbors.set(node, new Set([node])));
  graph.forEachEdge((edge, attrs, source, target) => {
    neighbors.get(source).add(target);
    neighbors.get(target).add(source);
  });
}

seedColumnLayout();
addEdges();
applyOptionalLayout();
buildNeighborMap();

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
      const boxH = 20;
      context.font = '600 12px Inter, ui-sans-serif, system-ui, sans-serif';
      const width = context.measureText(label).width;
      const boxX = x - paddingX;
      const boxY = y - 12;
      const boxW = width + paddingX * 2;
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
  }
});

sigma.getCamera().animatedReset({ duration: 0 });

function updateInspect(nodeId) {
  const node = raw.nodes.find((n) => n.key === nodeId);
  if (!node) return;
  const attrs = graph.getNodeAttributes(nodeId);
  const outgoing = graph.outboundNeighbors(nodeId).slice(0, 24).map((id) => graph.getNodeAttribute(id, 'label'));
  const incoming = graph.inboundNeighbors(nodeId).slice(0, 24).map((id) => graph.getNodeAttribute(id, 'label'));
  const status = nodeId === raw.mainKey ? 'entrypoint' : reachable.has(nodeId) ? 'reachable from main' : 'unreachable from main';
  const preview = sourcePreview(node);
  const range = node.range ? node.range.start.line + ':' + node.range.start.column + ' - ' + node.range.end.line + ':' + node.range.end.column : 'unknown';
  selection.textContent = attrs.label + ' — ' + status;
  inspect.innerHTML = '<strong>' + attrs.label + '</strong><br>' +
    'key: ' + nodeId + '<br>' +
    'path: ' + (attrs.path || 'unknown') + '<br>' +
    'type: ' + (attrs.typeName || 'unknown') + '<br>' +
    'visibility: ' + (attrs.visibility || 'unknown') + '<br>' +
    'range: ' + range + '<br>' +
    (attrs.signature ? 'signature: ' + attrs.signature + '<br>' : '') +
    'status: ' + status + '<br><br>' +
    '<strong>Calls</strong>: ' + (outgoing.join(', ') || 'none') + '<br><br>' +
    '<strong>Called by</strong>: ' + (incoming.join(', ') || 'none') + '<br><br>' +
    '<strong>Source</strong><pre style="white-space:pre-wrap;color:#fff;background:#050505;padding:10px;border-radius:10px;max-height:260px;overflow:auto;">' +
    (preview || 'No source snippet available').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;') +
    '</pre>';
}

function matchesQuery(node, attrs, q) {
  if (!q) return true;
  const fileContent = fileContentByPath.get(attrs.path || '') || '';
  return attrs.label.toLowerCase().includes(q)
    || String(attrs.path || '').toLowerCase().includes(q)
    || String(attrs.signature || '').toLowerCase().includes(q)
    || fileContent.toLowerCase().includes(q)
    || String(node.sourceSnippet || '').toLowerCase().includes(q);
}

function applyVisualState(query = '') {
  const q = query.trim().toLowerCase();
  const hoverSet = hoveredNode ? neighbors.get(hoveredNode) || new Set([hoveredNode]) : null;

  graph.forEachNode((node, attrs) => {
    const rawNode = raw.nodes.find((n) => n.key === node);
    const matches = rawNode ? matchesQuery(rawNode, attrs, q) : true;
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
  selectedNode = node;
  updateInspect(node);
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
if (raw.mainKey) updateInspect(raw.mainKey);
`;
