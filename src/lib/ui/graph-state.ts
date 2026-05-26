export function buildGraphState(raw) {
  const files = raw.files || [];
  const fileContentByPath = new Map(files.map((f) => [f.path, f.content || '']));
  const rawNodeByKey = new Map(raw.nodes.map((n) => [n.key, n]));
  const labelToKeys = new Map();
  const nodesByPath = new Map();
  const baseNodeColor = new Map();
  const baseEdgeColor = new Map();
  const neighbors = new Map();
  for (const node of raw.nodes) {
    const label = String(node.label || '').toLowerCase();
    if (!labelToKeys.has(label)) labelToKeys.set(label, []);
    labelToKeys.get(label).push(node.key);
    const path = node.path || 'unknown';
    if (!nodesByPath.has(path)) nodesByPath.set(path, []);
    nodesByPath.get(path).push(node);
  }
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
  return {
    raw,
    fileContentByPath,
    rawNodeByKey,
    labelToKeys,
    nodesByPath,
    baseNodeColor,
    baseEdgeColor,
    neighbors,
    outgoing,
    incoming,
    currentMainKey: raw.mainKey || null,
    currentMainPath: raw.mainKey ? (rawNodeByKey.get(raw.mainKey)?.path || '') : '',
    mainComponent: new Set(),
    usedInMainComponent: new Set(),
    deadInMainComponent: new Set(),
  };
}

export function recomputeMainComponentState(state) {
  state.mainComponent = undirectedComponent(state, state.currentMainKey);
  const rootsInMainComponent = [...state.mainComponent].filter((key) => (state.incoming.get(key) || []).filter((src) => state.mainComponent.has(src)).length === 0);
  state.usedInMainComponent = bfsFrom(state, rootsInMainComponent, state.mainComponent);
  state.deadInMainComponent = new Set([...state.mainComponent].filter((key) => !state.usedInMainComponent.has(key)));
}

function bfsFrom(state, roots, onlyWithin) {
  const seen = new Set();
  const queue = [...roots];
  while (queue.length) {
    const cur = queue.shift();
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of state.outgoing.get(cur) || []) {
      if (onlyWithin && !onlyWithin.has(next)) continue;
      if (!seen.has(next)) queue.push(next);
    }
  }
  return seen;
}

function undirectedComponent(state, start) {
  if (!start) return new Set();
  const seen = new Set();
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of state.outgoing.get(cur) || []) if (!seen.has(next)) queue.push(next);
    for (const prev of state.incoming.get(cur) || []) if (!seen.has(prev)) queue.push(prev);
  }
  return seen;
}

export function sourcePreview(state, node) {
  const path = node.path || '';
  const content = state.fileContentByPath.get(path) || '';
  if (!content) return node.sourceSnippet || '';
  if (node.range?.start?.line && node.range?.end?.line) {
    const lines = content.split('\n');
    const start = Math.max(0, node.range.start.line - 1);
    const end = Math.min(lines.length, node.range.end.line);
    return lines.slice(start, end).join('\n');
  }
  return node.sourceSnippet || '';
}

export function estimateCodeSize(state, node) {
  const snippet = sourcePreview(state, node);
  if (snippet) return Math.max(1, snippet.split('\n').length);
  if (node.range?.start?.line && node.range?.end?.line) return Math.max(1, node.range.end.line - node.range.start.line + 1);
  return 1;
}

export function computeNodeSize({ state, nodeId, nodeSizeMode, nodeSizeBase, nodeSizeCodeFactor }) {
  const rawNode = state.rawNodeByKey.get(nodeId);
  if (!rawNode) return nodeSizeBase;
  const isMain = nodeId === state.currentMainKey;
  if (nodeSizeMode === 'code') {
    const codeSize = estimateCodeSize(state, rawNode);
    return Math.max(5, nodeSizeBase + Math.sqrt(codeSize) * nodeSizeCodeFactor * 10 + (isMain ? 4 : 0));
  }
  if (isMain) return nodeSizeBase + 7;
  if (state.deadInMainComponent.has(nodeId)) return nodeSizeBase;
  if (state.usedInMainComponent.has(nodeId)) return nodeSizeBase + 2;
  return nodeSizeBase - 1;
}

export function resolveNodeInput(state, value) {
  const q = String(value || '').trim();
  if (!q) return null;
  if (state.rawNodeByKey.has(q)) return q;
  const lower = q.toLowerCase();
  if (state.labelToKeys.has(lower)) return state.labelToKeys.get(lower)[0];
  for (const node of state.raw.nodes) {
    if (String(node.label || '').toLowerCase() === lower) return node.key;
    if (String(node.key || '').toLowerCase() === lower) return node.key;
    if (String(node.path || '').toLowerCase().includes(lower)) return node.key;
  }
  return null;
}

export function findNodePath({ graph, source, target, applyDirections }) {
  if (!graph.hasNode(source) || !graph.hasNode(target)) return null;
  const queue = [source];
  const prev = new Map([[source, null]]);
  while (queue.length) {
    const current = queue.shift();
    if (current === target) break;
    const nextNodes = applyDirections ? graph.outboundNeighbors(current) : graph.neighbors(current);
    for (const next of nextNodes) {
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

export function edgeKeyBetween({ graph, source, target, applyDirections }) {
  if (applyDirections) {
    const edges = graph.outboundEdges(source) || [];
    for (const edge of edges) if (graph.extremities(edge)[1] === target) return edge;
    return null;
  }
  const edges = graph.edges(source, target) || [];
  return edges[0] || null;
}
