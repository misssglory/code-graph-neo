export const clientCode = String.raw`
import Graph from 'https://esm.sh/graphology@0.26.0';
import Sigma from 'https://esm.sh/sigma@3.0.0';
import forceAtlas2 from 'https://esm.sh/graphology-layout-forceatlas2@0.10.1';
import Prism from 'https://esm.sh/prismjs@1.29.0';
import 'https://esm.sh/prismjs@1.29.0/components/prism-rust';

const raw = window.__GRAPH__;
const files = raw.files || [];
const fileContentByPath = new Map(files.map((f) => [f.path, f.content || '']));
const container = document.getElementById('graph-container');
const inspect = document.getElementById('inspect');
const selection = document.getElementById('selection');
const search = document.getElementById('search');
const pathFromInput = document.getElementById('path-from');
const pathToInput = document.getElementById('path-to');
const pathGoBtn = document.getElementById('path-go');
const pathClearBtn = document.getElementById('path-clear');
const pathReverseBtn = document.getElementById('path-reverse');
const pathStatus = document.getElementById('path-status');
const pathList = document.getElementById('path-list');
const directedToggle = document.getElementById('directed-toggle');
const lineNumbersToggle = document.getElementById('line-numbers-toggle');
const layoutModeSelect = document.getElementById('layout-mode');
const sizeModeSelect = document.getElementById('node-size-mode');
const sizeBaseInput = document.getElementById('node-size-base');
const sizeCodeFactorInput = document.getElementById('node-size-code-factor');
const sizeBaseValue = document.getElementById('node-size-base-value');
const sizeCodeFactorValue = document.getElementById('node-size-code-factor-value');
const mainSourceSelect = document.getElementById('main-source-select');
const recomputeMainBtn = document.getElementById('recompute-main');
const graph = new Graph({ multi: true, allowSelfLoops: true });
const baseNodeColor = new Map();
const baseEdgeColor = new Map();
const neighbors = new Map();
const rawNodeByKey = new Map(raw.nodes.map((n) => [n.key, n]));
const labelToKeys = new Map();
const url = new URL(window.location.href);
let layoutMode = url.searchParams.get('layout') || 'columns';
let hoveredNode = null;
let selectedNode = null;
let pathNodeSet = new Set();
let pathEdgeSet = new Set();
let currentPath = [];
let applyDirections = true;
let focusedPathField = 'from';
let showLineNumbers = false;
let nodeSizeMode = 'status';
let nodeSizeBase = 11;
let nodeSizeCodeFactor = 0.015;
let currentMainKey = raw.mainKey || null;
let currentMainPath = currentMainKey ? (rawNodeByKey.get(currentMainKey)?.path || '') : '';
let mainComponent = new Set();
let usedInMainComponent = new Set();
let deadInMainComponent = new Set();

for (const node of raw.nodes) {
  const label = String(node.label || '').toLowerCase();
  const key = String(node.key);
  if (!labelToKeys.has(label)) labelToKeys.set(label, []);
  labelToKeys.get(label).push(key);
}

function buildAdjacency() {
  const outgoing = new Map();
  const incoming = new Map();
  for (const node of raw.nodes) {
    outgoing.set(node.key, []);
    incoming.set(node.key, []);
  }
  for (const edge of raw.edges) {
    if (edge.type !== 'calls') continue;
    if (!outgoing.has(edge.source) || !incoming.has(edge.target)) continue;
    outgoing.get(edge.source).push(edge.target);
    incoming.get(edge.target).push(edge.source);
  }
  return { outgoing, incoming };
}

const { outgoing, incoming } = buildAdjacency();

function bfsFrom(roots, onlyWithin) {
  const seen = new Set();
  const queue = [...roots];
  while (queue.length) {
    const cur = queue.shift();
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of outgoing.get(cur) || []) {
      if (onlyWithin && !onlyWithin.has(next)) continue;
      if (!seen.has(next)) queue.push(next);
    }
  }
  return seen;
}

function undirectedComponent(start) {
  if (!start) return new Set();
  const seen = new Set();
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of outgoing.get(cur) || []) if (!seen.has(next)) queue.push(next);
    for (const prev of incoming.get(cur) || []) if (!seen.has(prev)) queue.push(prev);
  }
  return seen;
}

function recomputeMainComponent() {
  mainComponent = undirectedComponent(currentMainKey);
  const rootsInMainComponent = [...mainComponent].filter((key) => (incoming.get(key) || []).filter((src) => mainComponent.has(src)).length === 0);
  usedInMainComponent = bfsFrom(rootsInMainComponent, mainComponent);
  deadInMainComponent = new Set([...mainComponent].filter((key) => !usedInMainComponent.has(key)));
}

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

function renderCodeBlock(code, startLine = 1) {
  const highlighted = Prism.highlight(code || '', Prism.languages.rust, 'rust');
  if (!showLineNumbers) {
    return '<pre class="code-block"><code class="language-rust">' + highlighted + '</code></pre>';
  }
  const lines = highlighted.split('\n');
  const rows = lines.map((line, idx) => '<span class="code-row"><span class="code-ln">' + (startLine + idx) + '</span><span class="code-src">' + (line || ' ') + '</span></span>').join('');
  return '<pre class="code-block with-lines"><code class="language-rust">' + rows + '</code></pre>';
}

function estimateCodeSize(node) {
  const snippet = sourcePreview(node);
  if (snippet) return Math.max(1, snippet.split('\n').length);
  if (node.range?.start?.line && node.range?.end?.line) return Math.max(1, node.range.end.line - node.range.start.line + 1);
  return 1;
}

function computeNodeSize(nodeId) {
  const rawNode = rawNodeByKey.get(nodeId);
  if (!rawNode) return nodeSizeBase;
  const isMain = nodeId === currentMainKey;
  if (nodeSizeMode === 'code') {
    const codeSize = estimateCodeSize(rawNode);
    return Math.max(5, nodeSizeBase + Math.sqrt(codeSize) * nodeSizeCodeFactor * 10 + (isMain ? 4 : 0));
  }
  if (isMain) return nodeSizeBase + 7;
  if (deadInMainComponent.has(nodeId)) return nodeSizeBase;
  if (usedInMainComponent.has(nodeId)) return nodeSizeBase + 2;
  return nodeSizeBase - 1;
}

function refreshBaseNodeStyles() {
  for (const node of raw.nodes) {
    const isMain = node.key === currentMainKey;
    const isDead = deadInMainComponent.has(node.key);
    const isUsed = usedInMainComponent.has(node.key);
    const color = isMain ? '#63d7ff' : isDead ? '#ff7e7e' : isUsed ? '#67db8b' : '#8f9bb3';
    baseNodeColor.set(node.key, color);
    if (graph.hasNode(node.key)) {
      graph.setNodeAttribute(node.key, 'size', computeNodeSize(node.key));
      graph.setNodeAttribute(node.key, 'color', color);
    }
  }
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
        size: computeNodeSize(node.key),
        color: '#8f9bb3',
        forceLabel: node.key === currentMainKey
      });
    });
  });
}

function addEdges() {
  let edgeId = 0;
  for (const edge of raw.edges) {
    if (edge.type !== 'calls') continue;
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue;
    const bothMainComponent = mainComponent.has(edge.source) && mainComponent.has(edge.target);
    const bothUsed = usedInMainComponent.has(edge.source) && usedInMainComponent.has(edge.target);
    const color = bothMainComponent ? (bothUsed ? '#58667f' : '#6b4040') : '#404852';
    const key = 'e' + edgeId++;
    baseEdgeColor.set(key, color);
    graph.addDirectedEdgeWithKey(key, edge.source, edge.target, {
      color,
      size: bothUsed ? 2 : 1,
      type: 'line'
    });
  }
}

function reapplyBaseEdgeStyles() {
  graph.forEachEdge((edge, attrs, source, target) => {
    const bothMainComponent = mainComponent.has(source) && mainComponent.has(target);
    const bothUsed = usedInMainComponent.has(source) && usedInMainComponent.has(target);
    const color = bothMainComponent ? (bothUsed ? '#58667f' : '#6b4040') : '#404852';
    baseEdgeColor.set(edge, color);
    graph.setEdgeAttribute(edge, 'color', color);
    graph.setEdgeAttribute(edge, 'size', bothUsed ? 2 : 1);
  });
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

function escapeHtml(s) {
  return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function resolveNodeInput(value) {
  const q = String(value || '').trim();
  if (!q) return null;
  if (graph.hasNode(q)) return q;
  const lower = q.toLowerCase();
  if (labelToKeys.has(lower)) return labelToKeys.get(lower)[0];
  for (const node of raw.nodes) {
    if (String(node.label || '').toLowerCase() === lower) return node.key;
    if (String(node.key || '').toLowerCase() === lower) return node.key;
    if (String(node.path || '').toLowerCase().includes(lower)) return node.key;
  }
  return null;
}

function getSuccessors(node) {
  return applyDirections ? graph.outboundNeighbors(node) : graph.neighbors(node);
}

function findNodePath(source, target) {
  if (!graph.hasNode(source) || !graph.hasNode(target)) return null;
  const queue = [source];
  const prev = new Map([[source, null]]);
  while (queue.length) {
    const current = queue.shift();
    if (current === target) break;
    for (const next of getSuccessors(current)) {
      if (prev.has(next)) continue;
      prev.set(next, current);
      queue.push(next);
    }
  }
  if (!prev.has(target)) return null;
  const path = [];
  let cur = target;
  while (cur !== null) {
    path.push(cur);
    cur = prev.get(cur) ?? null;
  }
  path.reverse();
  return path;
}

function edgeKeyBetween(source, target) {
  if (applyDirections) {
    const edges = graph.outboundEdges(source) || [];
    for (const edge of edges) {
      if (graph.extremities(edge)[1] === target) return edge;
    }
    return null;
  }
  const edges = graph.edges(source, target) || [];
  return edges[0] || null;
}

function renderPathList() {
  if (!currentPath.length) {
    pathList.innerHTML = '<div class="path-empty">No path selected.</div>';
    return;
  }
  pathList.innerHTML = currentPath.map((nodeId, idx) => {
    const node = rawNodeByKey.get(nodeId);
    const label = escapeHtml(node?.label || nodeId);
    const path = escapeHtml(node?.path || 'unknown');
    return '<button class="path-item" data-node-id="' + escapeHtml(nodeId) + '"><span class="path-step">' + idx + '</span><span class="path-main"><span class="path-label">' + label + '</span><span class="path-file mono">' + path + '</span></span></button>';
  }).join('');
  pathList.querySelectorAll('[data-node-id]').forEach((el) => {
    el.addEventListener('click', () => {
      const nodeId = el.getAttribute('data-node-id');
      if (!nodeId) return;
      selectedNode = nodeId;
      updateInspect(nodeId);
      hoveredNode = nodeId;
      applyVisualState(search.value);
    });
  });
}

function setPath(nodePath) {
  currentPath = nodePath || [];
  pathNodeSet = new Set(currentPath);
  pathEdgeSet = new Set();
  if (currentPath.length > 1) {
    for (let i = 0; i < currentPath.length - 1; i++) {
      const edge = edgeKeyBetween(currentPath[i], currentPath[i + 1]);
      if (edge) pathEdgeSet.add(edge);
    }
  }
  renderPathList();
}

function updatePathStatus(message) {
  pathStatus.textContent = message;
}

function syncFocusedFieldUI() {
  pathFromInput.dataset.focused = focusedPathField === 'from' ? 'true' : 'false';
  pathToInput.dataset.focused = focusedPathField === 'to' ? 'true' : 'false';
}

function assignNodeToFocusedField(nodeId) {
  if (focusedPathField === 'to') {
    pathToInput.value = nodeId;
    updatePathStatus('Assigned clicked node to sink/target.');
  } else {
    pathFromInput.value = nodeId;
    updatePathStatus('Assigned clicked node to source/start.');
  }
  syncFocusedFieldUI();
}

function runPathSearch() {
  const from = resolveNodeInput(pathFromInput.value);
  const to = resolveNodeInput(pathToInput.value);
  if (!from || !to) {
    setPath(null);
    updatePathStatus('Could not resolve one or both nodes. Use a node key or exact label.');
    applyVisualState(search.value);
    return;
  }
  const path = findNodePath(from, to);
  if (!path) {
    setPath(null);
    updatePathStatus('No path found from ' + from + ' to ' + to + (applyDirections ? ' with directed traversal.' : ' when ignoring edge direction.'));
    applyVisualState(search.value);
    return;
  }
  setPath(path);
  updatePathStatus('Path length ' + (path.length - 1) + ': ' + path.map((id) => graph.getNodeAttribute(id, 'label')).join(' -> '));
  applyVisualState(search.value);
}

function clearPathSearch() {
  setPath(null);
  pathFromInput.value = '';
  pathToInput.value = '';
  updatePathStatus('No path selected.');
  applyVisualState(search.value);
}

function reversePathInputs() {
  const from = pathFromInput.value;
  pathFromInput.value = pathToInput.value;
  pathToInput.value = from;
  focusedPathField = focusedPathField === 'from' ? 'to' : 'from';
  syncFocusedFieldUI();
  if (pathFromInput.value && pathToInput.value) runPathSearch();
  else updatePathStatus('Reversed source and sink fields.');
}

function fillMainSourceSelect() {
  const uniquePaths = [...new Set(raw.nodes.map((n) => n.path || 'unknown'))].sort();
  mainSourceSelect.innerHTML = uniquePaths.map((path) => '<option value="' + escapeHtml(path) + '">' + escapeHtml(path) + '</option>').join('');
  if (currentMainPath) mainSourceSelect.value = currentMainPath;
}

function updateMainFromSelectedSource() {
  const path = mainSourceSelect.value;
  const candidates = raw.nodes.filter((n) => (n.path || '') === path);
  const explicitMain = candidates.find((n) => String(n.label || '').toLowerCase() === 'main');
  const chosen = explicitMain || candidates[0] || null;
  if (!chosen) return;
  currentMainKey = chosen.key;
  currentMainPath = chosen.path || '';
  recomputeMainComponent();
  refreshBaseNodeStyles();
  reapplyBaseEdgeStyles();
  if (selectedNode === null) selectedNode = currentMainKey;
  applyVisualState(search.value);
  updateInspect(selectedNode || currentMainKey);
  selection.textContent = 'Main source: ' + currentMainPath + ' — entry node ' + graph.getNodeAttribute(currentMainKey, 'label');
}

recomputeMainComponent();
seedColumnLayout();
refreshBaseNodeStyles();
addEdges();
applyOptionalLayout();
buildNeighborMap();
fillMainSourceSelect();

const sigma = new Sigma(graph, container, {
  minCameraRatio: 0.2,
  maxCameraRatio: 8,
  labelDensity: 1,
  labelGridCellSize: 120,
  renderEdgeLabels: false,
  allowInvalidContainer: false,
  itemSizesReference: 'screen',
  labelColor: { color: '#eef2ff' },
  defaultDrawNodeHover: () => {},
  defaultDrawNodeLabel: (context, data) => {
    const size = data.size || 1;
    if (size < 6 && !data.forceLabel) return;
    const label = String(data.label || '');
    const x = data.x + size + 6;
    const y = data.y;
    const highlighted = hoveredNode === data.key || pathNodeSet.has(data.key);
    context.font = (highlighted ? '600 ' : '500 ') + '12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    context.fillStyle = highlighted ? (pathNodeSet.has(data.key) ? '#ffe082' : '#ffffff') : '#d8deeb';
    context.shadowColor = highlighted ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.35)';
    context.shadowBlur = highlighted ? 8 : 3;
    context.fillText(label, x, y + 4);
    context.shadowBlur = 0;
  }
});

sigma.getCamera().animatedReset({ duration: 0 });

function updateInspect(nodeId) {
  const node = rawNodeByKey.get(nodeId);
  if (!node) return;
  const attrs = graph.getNodeAttributes(nodeId);
  const outgoingList = graph.outboundNeighbors(nodeId).slice(0, 24).map((id) => graph.getNodeAttribute(id, 'label'));
  const incomingList = graph.inboundNeighbors(nodeId).slice(0, 24).map((id) => graph.getNodeAttribute(id, 'label'));
  const status = nodeId === currentMainKey ? 'entrypoint' : deadInMainComponent.has(nodeId) ? 'dead code in main component' : usedInMainComponent.has(nodeId) ? 'used in main component' : 'outside main component';
  const preview = sourcePreview(node);
  const startLine = node.range?.start?.line || 1;
  const range = node.range ? node.range.start.line + ':' + node.range.start.column + ' - ' + node.range.end.line + ':' + node.range.end.column : 'unknown';
  selection.textContent = attrs.label + ' — ' + status;
  inspect.innerHTML = '<strong>' + escapeHtml(attrs.label) + '</strong><br>' +
    '<span class="mono">key: ' + escapeHtml(nodeId) + '</span><br>' +
    '<span class="mono">path: ' + escapeHtml(attrs.path || 'unknown') + '</span><br>' +
    'type: ' + escapeHtml(attrs.typeName || 'unknown') + '<br>' +
    'visibility: ' + escapeHtml(attrs.visibility || 'unknown') + '<br>' +
    'range: ' + escapeHtml(range) + '<br>' +
    (attrs.signature ? '<span class="mono">signature: ' + escapeHtml(attrs.signature) + '</span><br>' : '') +
    'code size: ' + estimateCodeSize(node) + ' lines<br>' +
    'status: ' + escapeHtml(status) + '<br><br>' +
    '<strong>Calls</strong>: ' + escapeHtml(outgoingList.join(', ') || 'none') + '<br><br>' +
    '<strong>Called by</strong>: ' + escapeHtml(incomingList.join(', ') || 'none') + '<br><br>' +
    '<strong>Source</strong>' + renderCodeBlock(preview || 'No source snippet available', startLine);
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
  const hasPath = pathNodeSet.size > 0;

  graph.forEachNode((node, attrs) => {
    const rawNode = rawNodeByKey.get(node);
    const matches = rawNode ? matchesQuery(rawNode, attrs, q) : true;
    const hidden = !matches;
    graph.setNodeAttribute(node, 'hidden', hidden);
    const related = !hoverSet || hoverSet.has(node);
    const onPath = pathNodeSet.has(node);
    let color = baseNodeColor.get(node);
    if (hidden) color = 'rgba(0,0,0,0)';
    else if (hasPath && onPath) color = '#ffd54f';
    else if (!related) color = 'rgba(255,255,255,0.14)';
    graph.setNodeAttribute(node, 'color', color);
    const baseSize = computeNodeSize(node);
    graph.setNodeAttribute(node, 'size', onPath ? baseSize + 3 : hoveredNode === node ? baseSize + 2 : baseSize);
    graph.setNodeAttribute(node, 'forceLabel', hoveredNode === node || node === currentMainKey || onPath);
  });

  graph.forEachEdge((edge, attrs, source, target) => {
    const hidden = graph.getNodeAttribute(source, 'hidden') || graph.getNodeAttribute(target, 'hidden');
    graph.setEdgeAttribute(edge, 'hidden', hidden);
    if (hidden) return;
    const active = !hoverSet || (hoverSet.has(source) && hoverSet.has(target));
    const onPath = pathEdgeSet.has(edge);
    graph.setEdgeAttribute(edge, 'color', onPath ? '#ffd54f' : active ? baseEdgeColor.get(edge) : 'rgba(255,255,255,0.05)');
    graph.setEdgeAttribute(edge, 'size', onPath ? 4 : hoveredNode && active ? 3 : 2);
  });

  sigma.refresh();
}

function syncNodeSizeControls() {
  sizeBaseValue.textContent = Number(nodeSizeBase).toFixed(0);
  sizeCodeFactorValue.textContent = Number(nodeSizeCodeFactor).toFixed(3);
}

search.addEventListener('input', () => applyVisualState(search.value));
pathGoBtn.addEventListener('click', runPathSearch);
pathClearBtn.addEventListener('click', clearPathSearch);
pathReverseBtn.addEventListener('click', reversePathInputs);
directedToggle.addEventListener('change', () => {
  applyDirections = directedToggle.checked;
  if (pathFromInput.value || pathToInput.value) runPathSearch();
  else updatePathStatus(applyDirections ? 'Directed traversal enabled.' : 'Ignoring edge direction.');
});
lineNumbersToggle.addEventListener('change', () => {
  showLineNumbers = lineNumbersToggle.checked;
  if (selectedNode) updateInspect(selectedNode);
  else if (currentMainKey) updateInspect(currentMainKey);
});
layoutModeSelect.addEventListener('change', () => {
  layoutMode = layoutModeSelect.value;
  const next = new URL(window.location.href);
  next.searchParams.set('layout', layoutMode);
  window.location.href = next.toString();
});
sizeModeSelect.addEventListener('change', () => {
  nodeSizeMode = sizeModeSelect.value;
  refreshBaseNodeStyles();
  applyVisualState(search.value);
});
sizeBaseInput.addEventListener('input', () => {
  nodeSizeBase = Number(sizeBaseInput.value);
  syncNodeSizeControls();
  refreshBaseNodeStyles();
  applyVisualState(search.value);
});
sizeCodeFactorInput.addEventListener('input', () => {
  nodeSizeCodeFactor = Number(sizeCodeFactorInput.value);
  syncNodeSizeControls();
  refreshBaseNodeStyles();
  applyVisualState(search.value);
});
recomputeMainBtn.addEventListener('click', updateMainFromSelectedSource);
pathFromInput.addEventListener('focus', () => { focusedPathField = 'from'; syncFocusedFieldUI(); });
pathToInput.addEventListener('focus', () => { focusedPathField = 'to'; syncFocusedFieldUI(); });
pathFromInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runPathSearch(); });
pathToInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runPathSearch(); });

sigma.on('clickNode', ({ node }) => {
  selectedNode = node;
  updateInspect(node);
  assignNodeToFocusedField(node);
});

sigma.on('enterNode', ({ node }) => {
  hoveredNode = node;
  applyVisualState(search.value);
});

sigma.on('leaveNode', () => {
  hoveredNode = null;
  applyVisualState(search.value);
});

layoutModeSelect.value = layoutMode;
sizeModeSelect.value = nodeSizeMode;
sizeBaseInput.value = String(nodeSizeBase);
sizeCodeFactorInput.value = String(nodeSizeCodeFactor);
syncNodeSizeControls();
syncFocusedFieldUI();
renderPathList();
applyVisualState();
updatePathStatus('No path selected. Focus source or sink, then click a node to assign it.');
if (currentMainKey) {
  selectedNode = currentMainKey;
  updateInspect(currentMainKey);
}
`;
