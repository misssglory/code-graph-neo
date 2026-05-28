import Graph from 'https://esm.sh/graphology@0.26.0';
import Sigma from 'https://esm.sh/sigma@3.0.0';
import forceAtlas2 from 'https://esm.sh/graphology-layout-forceatlas2@0.10.1';
import Prism from 'https://esm.sh/prismjs@1.29.0';
import 'https://esm.sh/prismjs@1.29.0/components/prism-rust';
import { createDom } from './dom.ts';
import { buildGraphState, recomputeMainComponentState, computeNodeSize, sourcePreview, resolveNodeInput, estimateCodeSize, findNodePath, edgeKeyBetween } from './graph-state.ts';
import { applyPaneTransparency, setActiveTab, setSidebarCollapsed } from './layout.ts';
import { escapeHtml, renderCodeBlock } from './render.ts';

function hashString(input) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function makeFileColorMap(paths, palette) {
  const unique = [...new Set(paths.filter(Boolean))].sort();
  const map = new Map();
  unique.forEach((path) => map.set(path, palette[hashString(path) % palette.length]));
  return map;
}
function hexToRgb(hex) {
  const value = hex.replace('#', '');
  const normalized = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const n = parseInt(normalized, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
function drawArrowHead(context, x1, y1, x2, y2, color, size) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const len = Math.max(7, size * 3.2);
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(x2, y2);
  context.lineTo(x2 - len * Math.cos(angle - Math.PI / 7), y2 - len * Math.sin(angle - Math.PI / 7));
  context.lineTo(x2 - len * Math.cos(angle + Math.PI / 7), y2 - len * Math.sin(angle + Math.PI / 7));
  context.closePath();
  context.fill();
}

export function createApp(bootstrap) {
  const raw = bootstrap?.graph || bootstrap;
  const config = bootstrap?.config || {};
  const uiConfig = config.ui || {};
  const graphConfig = config.graph || {};
  const colorConfig = config.colors || {};
  const palette = Array.isArray(colorConfig.file_palette) && colorConfig.file_palette.length ? colorConfig.file_palette : ['#63d7ff', '#ff7e7e', '#67db8b', '#ffd54f'];

  const dom = createDom();
  const graph = new Graph({ multi: true, allowSelfLoops: true });
  const state = buildGraphState(raw);
  const fileColorByPath = makeFileColorMap(state.raw.nodes.map((n) => n.path || ''), palette);

  let hoveredNode = null;
  let selectedNode = raw.mainKey || null;
  let applyDirections = Boolean(graphConfig.apply_directions ?? true);
  let renderEdgeDirection = Boolean(uiConfig.render_edge_direction ?? true);
  let focusedPathField = 'from';
  let showLineNumbers = Boolean(uiConfig.show_line_numbers ?? false);
  let nodeSizeMode = graphConfig.node_size_mode || 'status';
  let nodeSizeBase = Number(graphConfig.node_size_base ?? 11);
  let nodeSizeCodeFactor = Number(graphConfig.node_size_code_factor ?? 0.015);
  let paneTransparency = Number(uiConfig.pane_transparency ?? 0.58);
  let currentPath = [];
  let pathSelectedNodeSet = new Set();
  let pathNodeSet = new Set();
  let pathEdgeSet = new Set();
  let pathCursorIndex = -1;
  let layoutMode = new URL(window.location.href).searchParams.get('layout') || graphConfig.layout || 'columns';
  let mainComponentFocusMode = false;
  let rightPaneWidth = Number(uiConfig.pane_width ?? 420);
  let rightPaneHeight = Math.max(360, Number(uiConfig.pane_height ?? (window.innerHeight - 32)));

  function refreshStateForCurrentMain() { recomputeMainComponentState(state); }
  function seedColumnLayout() {
    const orderedPaths = [...state.nodesByPath.keys()].sort();
    orderedPaths.forEach((path, col) => {
      const list = state.nodesByPath.get(path);
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
          borderColor: fileColorByPath.get(path || '') || '#8f9bb3',
          x: col * 8 + ((row % 2) * 0.35),
          y: row * 1.8,
          size: 10,
          color: '#8f9bb3',
          forceLabel: node.key === state.currentMainKey
        });
      });
    });
  }
  function refreshBaseNodeStyles() {
    for (const node of state.raw.nodes) {
      const isMain = node.key === state.currentMainKey;
      const isDead = state.deadInMainComponent.has(node.key);
      const isUsed = state.usedInMainComponent.has(node.key);
      const color = isMain ? '#63d7ff' : isDead ? '#ff7e7e' : isUsed ? '#67db8b' : '#8f9bb3';
      state.baseNodeColor.set(node.key, color);
      if (graph.hasNode(node.key)) {
        graph.setNodeAttribute(node.key, 'size', computeNodeSize({ state, nodeId: node.key, nodeSizeMode, nodeSizeBase, nodeSizeCodeFactor }));
        graph.setNodeAttribute(node.key, 'color', color);
        graph.setNodeAttribute(node.key, 'borderColor', fileColorByPath.get(node.path || '') || '#8f9bb3');
      }
    }
  }
  function addEdges() {
    let edgeId = 0;
    for (const edge of state.raw.edges) {
      if (edge.type !== 'calls') continue;
      if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue;
      const bothMainComponent = state.mainComponent.has(edge.source) && state.mainComponent.has(edge.target);
      const bothUsed = state.usedInMainComponent.has(edge.source) && state.usedInMainComponent.has(edge.target);
      const color = bothMainComponent ? (bothUsed ? '#58667f' : '#6b4040') : '#404852';
      const key = 'e' + edgeId++;
      state.baseEdgeColor.set(key, color);
      graph.addDirectedEdgeWithKey(key, edge.source, edge.target, { color, size: bothUsed ? 2 : 1, type: 'line', sourceColor: graph.getNodeAttribute(edge.source, 'borderColor') || '#63d7ff', targetColor: graph.getNodeAttribute(edge.target, 'borderColor') || '#ff7e7e' });
    }
  }
  function reapplyBaseEdgeStyles() {
    graph.forEachEdge((edge, attrs, source, target) => {
      const bothMainComponent = state.mainComponent.has(source) && state.mainComponent.has(target);
      const bothUsed = state.usedInMainComponent.has(source) && state.usedInMainComponent.has(target);
      const color = bothMainComponent ? (bothUsed ? '#58667f' : '#6b4040') : '#404852';
      state.baseEdgeColor.set(edge, color);
      graph.setEdgeAttribute(edge, 'color', color);
      graph.setEdgeAttribute(edge, 'size', bothUsed ? 2 : 1);
      graph.setEdgeAttribute(edge, 'sourceColor', graph.getNodeAttribute(source, 'borderColor') || '#63d7ff');
      graph.setEdgeAttribute(edge, 'targetColor', graph.getNodeAttribute(target, 'borderColor') || '#ff7e7e');
    });
  }
  function applyOptionalLayout() {
    if (layoutMode !== 'forceatlas2') return;
    const settings = forceAtlas2.inferSettings(graph);
    forceAtlas2.assign(graph, { iterations: 120, settings: { ...settings, gravity: 1, scalingRatio: 14, slowDown: 1.2 } });
  }
  function buildNeighborMap() {
    graph.forEachNode((node) => state.neighbors.set(node, new Set([node])));
    graph.forEachEdge((edge, attrs, source, target) => {
      state.neighbors.get(source).add(target);
      state.neighbors.get(target).add(source);
    });
  }

  function renderPathList() {
    if (!currentPath.length) {
      pathCursorIndex = -1;
      dom.pathList.innerHTML = '<div class="path-empty">No path selected.</div>';
      return;
    }
    if (pathCursorIndex < 0 || pathCursorIndex >= currentPath.length) pathCursorIndex = 0;
    dom.pathList.innerHTML = currentPath.map((nodeId, idx) => {
      const node = state.rawNodeByKey.get(nodeId);
      const fileColor = fileColorByPath.get(node?.path || '') || '#8f9bb3';
      const selected = idx === pathCursorIndex ? 'true' : 'false';
      const codeLines = estimateCodeSize(state, node || {});
      const showCode = pathSelectedNodeSet.has(nodeId) ? 'checked' : '';
      return '<button class="path-item" role="option" aria-selected="' + selected + '" data-selected="' + selected + '" data-node-id="' + escapeHtml(nodeId) + '" data-index="' + idx + '"><span class="path-step">' + idx + '</span><span class="path-main"><span class="path-label">' + escapeHtml(node?.label || nodeId) + '</span><span class="path-file mono"><span class="selection-accent"><span class="selection-dot" style="background:' + escapeHtml(fileColor) + ';"></span><span style="color:' + escapeHtml(fileColor) + '">' + escapeHtml(node?.path || 'unknown') + '</span></span></span><span class="path-entity-meta mono">' + codeLines + ' lines of code</span><label class="checkbox-row"><input type="checkbox" data-path-code-toggle="' + escapeHtml(nodeId) + '" ' + showCode + ' />Include code block</label></span></button>';
    }).join('');
    dom.pathList.querySelectorAll('[data-node-id]').forEach((el) => {
      el.addEventListener('click', () => activatePathRow(Number(el.getAttribute('data-index') || '0')));
    });
    dom.pathList.querySelectorAll('[data-path-code-toggle]').forEach((el) => {
      el.addEventListener('click', (event) => event.stopPropagation());
      el.addEventListener('change', () => {
        const nodeId = el.getAttribute('data-path-code-toggle');
        if (!nodeId) return;
        if (el.checked) pathSelectedNodeSet.add(nodeId);
        else pathSelectedNodeSet.delete(nodeId);
        updatePathSelectionSummary();
        renderPathCodeView();
      });
    });
    updatePathSelectionSummary();
  }

  function activatePathRow(index) {
    if (!currentPath.length) return;
    pathCursorIndex = Math.max(0, Math.min(currentPath.length - 1, index));
    const nodeId = currentPath[pathCursorIndex];
    selectedNode = nodeId;
    hoveredNode = nodeId;
    updateInspect(nodeId);
    renderPathList();
    applyVisualState(dom.search.value);
    const activeEl = dom.pathList.querySelector(`[data-index="${pathCursorIndex}"]`);
    activeEl?.scrollIntoView({ block: 'nearest' });
  }

  function handlePathListKeydown(event) {
    if (!currentPath.length) return;
    if (event.key === 'ArrowDown' || event.key === 'Ctrl+j' || (event.ctrlKey && event.key.toLowerCase() === 'j')) {
      event.preventDefault();
      activatePathRow(Math.min(currentPath.length - 1, pathCursorIndex + 1));
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'Ctrl+k' || (event.ctrlKey && event.key.toLowerCase() === 'k')) {
      event.preventDefault();
      activatePathRow(Math.max(0, pathCursorIndex - 1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      activatePathRow(pathCursorIndex < 0 ? 0 : pathCursorIndex);
    }
  }

  function setPath(nodePath) {
    currentPath = nodePath || [];
    pathSelectedNodeSet = new Set(currentPath);
    pathNodeSet = new Set(currentPath);
    pathEdgeSet = new Set();
    if (currentPath.length > 1) {
      for (let i = 0; i < currentPath.length - 1; i++) {
        const edge = edgeKeyBetween({ graph, source: currentPath[i], target: currentPath[i + 1], applyDirections });
        if (edge) pathEdgeSet.add(edge);
      }
    }
    pathCursorIndex = currentPath.length ? 0 : -1;
    renderPathList();
    renderPathCodeView();
  }

  function renderPathCodeView() {
    if (!dom.pathCodeView) return;
    if (!currentPath.length) {
      dom.pathCodeView.innerHTML = '<div class="path-empty">No path code view available.</div>';
      return;
    }
    const selectedPath = currentPath.filter((nodeId) => pathSelectedNodeSet.has(nodeId));
    if (!selectedPath.length) {
      dom.pathCodeView.innerHTML = '<div class="path-empty">No selected path code blocks.</div>';
      return;
    }
    dom.pathCodeView.innerHTML = selectedPath.map((nodeId, idx) => {
      const node = state.rawNodeByKey.get(nodeId);
      const fileName = node?.path || 'unknown';
      const preview = sourcePreview(state, node || {});
      const startLine = node?.range?.start?.line || 1;
      const header = '// file: ' + fileName;
      const code = header + '\n' + (preview || 'No source snippet available');
      return '<div><div class="path-code-file">' + escapeHtml(String(idx)) + '. ' + escapeHtml(node?.label || nodeId) + '</div>' +
        renderCodeBlock(Prism, code, startLine, showLineNumbers) + '</div>';
    }).join('');
  }
  function updatePathSelectionSummary() {
    const selectedPath = currentPath.filter((nodeId) => pathSelectedNodeSet.has(nodeId));
    const totalLines = selectedPath.reduce((sum, nodeId) => {
      const node = state.rawNodeByKey.get(nodeId);
      return sum + estimateCodeSize(state, node || {});
    }, 0);
    dom.pathSelectionSummary.textContent = 'Selected: ' + selectedPath.length + ' nodes · ' + totalLines + ' total lines.';
  }
  async function copySelectedPathCodeBlocks() {
    const selectedPath = currentPath.filter((nodeId) => pathSelectedNodeSet.has(nodeId));
    if (!selectedPath.length) {
      updatePathStatus('No selected nodes to copy.');
      return;
    }
    const text = selectedPath.map((nodeId) => {
      const node = state.rawNodeByKey.get(nodeId);
      const fileName = node?.path || 'unknown';
      const preview = sourcePreview(state, node || {}) || 'No source snippet available';
      return '// file: ' + fileName + '\n' + preview;
    }).join('\n\n');
    await navigator.clipboard.writeText(text);
    updatePathStatus('Copied ' + selectedPath.length + ' selected code block(s) to clipboard.');
  }

  function updatePathStatus(message) { dom.pathStatus.textContent = message + '  Keyboard: ↑/↓ or Ctrl-J/Ctrl-K, Enter selects.'; }
  function syncFocusedFieldUI() {
    dom.pathFromInput.dataset.focused = focusedPathField === 'from' ? 'true' : 'false';
    dom.pathToInput.dataset.focused = focusedPathField === 'to' ? 'true' : 'false';
  }
  function assignNodeToFocusedField(nodeId) {
    if (mainComponentFocusMode) return;
    if (focusedPathField === 'to') {
      dom.pathToInput.value = nodeId;
      updatePathStatus('Assigned clicked node to sink/target.');
    } else {
      dom.pathFromInput.value = nodeId;
      updatePathStatus('Assigned clicked node to source/start.');
    }
    syncFocusedFieldUI();
  }
  function runPathSearch() {
    const from = resolveNodeInput(state, dom.pathFromInput.value);
    const to = resolveNodeInput(state, dom.pathToInput.value);
    if (!from || !to) {
      setPath(null);
      updatePathStatus('Could not resolve one or both nodes. Use a node key or exact label.');
      applyVisualState(dom.search.value);
      return;
    }
    const path = findNodePath({ graph, source: from, target: to, applyDirections });
    if (!path) {
      setPath(null);
      updatePathStatus('No path found from ' + from + ' to ' + to + (applyDirections ? ' with directed traversal.' : ' when ignoring edge direction.'));
      applyVisualState(dom.search.value);
      return;
    }
    setPath(path);
    updatePathStatus('Path length ' + (path.length - 1) + ': ' + path.map((id) => graph.getNodeAttribute(id, 'label')).join(' -> '));
    applyVisualState(dom.search.value);
  }

  function updateInspect(nodeId) {
    const node = state.rawNodeByKey.get(nodeId);
    if (!node) return;
    const attrs = graph.getNodeAttributes(nodeId);
    const outgoingList = graph.outboundNeighbors(nodeId).slice(0, 24).map((id) => graph.getNodeAttribute(id, 'label'));
    const incomingList = graph.inboundNeighbors(nodeId).slice(0, 24).map((id) => graph.getNodeAttribute(id, 'label'));
    const status = nodeId === state.currentMainKey ? 'entrypoint' : state.deadInMainComponent.has(nodeId) ? 'dead code in main component' : state.usedInMainComponent.has(nodeId) ? 'used in main component' : 'outside main component';
    const preview = sourcePreview(state, node);
    const startLine = node.range?.start?.line || 1;
    const range = node.range ? node.range.start.line + ':' + node.range.start.column + ' - ' + node.range.end.line + ':' + node.range.end.column : 'unknown';
    const fileColor = attrs.borderColor || '#8f9bb3';
    dom.selection.innerHTML = '<span class="selection-accent"><span class="selection-dot" style="background:' + escapeHtml(fileColor) + '"></span><span>' + escapeHtml(attrs.label) + ' — ' + escapeHtml(status) + '</span></span>';
    dom.inspect.innerHTML = '<strong>' + escapeHtml(attrs.label) + '</strong><br>' +
      '<span class="mono">key: ' + escapeHtml(nodeId) + '</span><br>' +
      '<span class="mono">path: <span style="color:' + escapeHtml(fileColor) + '">' + escapeHtml(attrs.path || 'unknown') + '</span></span><br>' +
      '<span class="mono">file border: ' + escapeHtml(attrs.borderColor || 'unknown') + '</span><br>' +
      'type: ' + escapeHtml(attrs.typeName || 'unknown') + '<br>' +
      'visibility: ' + escapeHtml(attrs.visibility || 'unknown') + '<br>' +
      'range: ' + escapeHtml(range) + '<br>' +
      (attrs.signature ? '<span class="mono">signature: ' + escapeHtml(attrs.signature) + '</span><br>' : '') +
      'code size: ' + estimateCodeSize(state, node) + ' lines<br>' +
      'status: ' + escapeHtml(status) + '<br><br>' +
      '<strong>Calls</strong>: ' + escapeHtml(outgoingList.join(', ') || 'none') + '<br><br>' +
      '<strong>Called by</strong>: ' + escapeHtml(incomingList.join(', ') || 'none') + '<br><br>' +
      '<strong>Source</strong>' + renderCodeBlock(Prism, preview || 'No source snippet available', startLine, showLineNumbers);
  }

  function matchesQuery(node, attrs, q) {
    if (!q) return true;
    const fileContent = state.fileContentByPath.get(attrs.path || '') || '';
    return attrs.label.toLowerCase().includes(q)
      || String(attrs.path || '').toLowerCase().includes(q)
      || String(attrs.signature || '').toLowerCase().includes(q)
      || fileContent.toLowerCase().includes(q)
      || String(node.sourceSnippet || '').toLowerCase().includes(q);
  }
  function applyVisualState(query = '') {
    const q = query.trim().toLowerCase();
    const hoverSet = hoveredNode ? state.neighbors.get(hoveredNode) || new Set([hoveredNode]) : null;
    const hasPath = pathNodeSet.size > 0;
    const selectedIncomingColor = '#7ec8ff';
    const selectedOutgoingColor = '#ff9f7e';
    graph.forEachNode((node, attrs) => {
      const rawNode = state.rawNodeByKey.get(node);
      const matches = rawNode ? matchesQuery(rawNode, attrs, q) : true;
      const hidden = !matches;
      graph.setNodeAttribute(node, 'hidden', hidden);
      const related = !hoverSet || hoverSet.has(node);
      const onPath = pathNodeSet.has(node);
      let color = state.baseNodeColor.get(node);
      if (hidden) color = 'rgba(0,0,0,0)';
      else if (hasPath && onPath) color = '#ffd54f';
      else if (!related) color = 'rgba(255,255,255,0.14)';
      graph.setNodeAttribute(node, 'color', color);
      graph.setNodeAttribute(node, 'borderAlpha', hidden ? 0 : (!related ? 0.30 : 1));
      const baseSize = computeNodeSize({ state, nodeId: node, nodeSizeMode, nodeSizeBase, nodeSizeCodeFactor });
      graph.setNodeAttribute(node, 'size', onPath ? baseSize + 3 : hoveredNode === node || selectedNode === node ? baseSize + 2 : baseSize);
      graph.setNodeAttribute(node, 'forceLabel', hoveredNode === node || node === state.currentMainKey || onPath || selectedNode === node);
    });
    graph.forEachEdge((edge, attrs, source, target) => {
      const hidden = graph.getNodeAttribute(source, 'hidden') || graph.getNodeAttribute(target, 'hidden');
      graph.setEdgeAttribute(edge, 'hidden', hidden);
      if (hidden) return;
      const active = !hoverSet || (hoverSet.has(source) && hoverSet.has(target));
      const onPath = pathEdgeSet.has(edge);
      const isIncomingSelectedEdge = selectedNode && target === selectedNode;
      const isOutgoingSelectedEdge = selectedNode && source === selectedNode;
      let edgeColor = active ? state.baseEdgeColor.get(edge) : 'rgba(255,255,255,0.05)';
      if (isIncomingSelectedEdge) edgeColor = selectedIncomingColor;
      if (isOutgoingSelectedEdge) edgeColor = selectedOutgoingColor;
      if (onPath) edgeColor = '#ffd54f';
      graph.setEdgeAttribute(edge, 'color', edgeColor);
      graph.setEdgeAttribute(edge, 'size', onPath ? 4 : hoveredNode && active ? 3 : 2);
    });
    sigma.refresh();
  }

  function setMainFromNode(nodeId) {
    const node = state.rawNodeByKey.get(nodeId);
    if (!node) return;
    state.currentMainKey = nodeId;
    state.currentMainPath = node.path || '';
    if (state.currentMainPath) dom.mainSourceSelect.value = state.currentMainPath;
    refreshStateForCurrentMain();
    refreshBaseNodeStyles();
    reapplyBaseEdgeStyles();
    applyVisualState(dom.search.value);
    updateInspect(nodeId);
  }
  function fillMainSourceSelect() {
    const uniquePaths = [...new Set(state.raw.nodes.map((n) => n.path || 'unknown'))].sort();
    dom.mainSourceSelect.innerHTML = uniquePaths.map((path) => '<option value="' + escapeHtml(path) + '">' + escapeHtml(path) + '</option>').join('');
    if (state.currentMainPath) dom.mainSourceSelect.value = state.currentMainPath;
  }
  function applyFloatingPaneSize() {
    document.documentElement.style.setProperty('--pane-width', rightPaneWidth + 'px');
    document.documentElement.style.setProperty('--pane-height', rightPaneHeight + 'px');
    if (dom.rightPaneWrap) {
      dom.rightPaneWrap.style.width = rightPaneWidth + 'px';
      dom.rightPaneWrap.style.height = rightPaneHeight + 'px';
    }
    if (dom.rightPane) {
      dom.rightPane.style.width = '100%';
      dom.rightPane.style.height = '100%';
    }
  }
  function attachRightPaneResize() {
    if (!dom.rightPaneResizeCorner) return;
    dom.rightPaneResizeCorner.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      const startWidth = rightPaneWidth;
      const startHeight = rightPaneHeight;
      const move = (ev) => {
        ev.preventDefault();
        const maxWidth = Math.min(900, window.innerWidth - 32);
        const maxHeight = window.innerHeight - 32;
        rightPaneWidth = Math.max(280, Math.min(maxWidth, startWidth - (ev.clientX - startX)));
        rightPaneHeight = Math.max(220, Math.min(maxHeight, startHeight + (ev.clientY - startY)));
        applyFloatingPaneSize();
      };
      const up = () => {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      dom.rightPaneResizeCorner.setPointerCapture?.(event.pointerId);
      document.body.style.cursor = 'nesw-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }
  function drawDirectionOverlay() {
    if (!renderEdgeDirection) return;
    const ctx = sigma.getCanvases()?.edgeLabels;
    if (!ctx) return;
    const context = ctx.getContext('2d');
    if (!context) return;
    graph.forEachEdge((edge, attrs, source, target) => {
      if (graph.getEdgeAttribute(edge, 'hidden')) return;
      const sourceData = sigma.getNodeDisplayData(source);
      const targetData = sigma.getNodeDisplayData(target);
      if (!sourceData || !targetData) return;
      const size = graph.getEdgeAttribute(edge, 'size') || 1;
      const sourceColor = graph.getEdgeAttribute(edge, 'sourceColor') || '#63d7ff';
      const targetColor = graph.getEdgeAttribute(edge, 'targetColor') || '#ff7e7e';
      const onPath = pathEdgeSet.has(edge);
      const gradient = context.createLinearGradient(sourceData.x, sourceData.y, targetData.x, targetData.y);
      gradient.addColorStop(0, onPath ? '#ffd54f' : rgba(sourceColor, 0.18));
      gradient.addColorStop(0.65, onPath ? '#ffd54f' : rgba(sourceColor, 0.55));
      gradient.addColorStop(1, onPath ? '#ffd54f' : rgba(targetColor, 0.95));
      context.strokeStyle = gradient;
      context.lineWidth = Math.max(1.5, size + 0.25);
      context.beginPath();
      context.moveTo(sourceData.x, sourceData.y);
      context.lineTo(targetData.x, targetData.y);
      context.stroke();
      drawArrowHead(context, sourceData.x, sourceData.y, targetData.x, targetData.y, onPath ? '#ffd54f' : targetColor, size);
    });
  }

  refreshStateForCurrentMain();
  seedColumnLayout();
  refreshBaseNodeStyles();
  addEdges();
  applyOptionalLayout();
  buildNeighborMap();
  fillMainSourceSelect();

  const sigma = new Sigma(graph, dom.graphContainer, {
    minCameraRatio: 0.2,
    maxCameraRatio: 8,
    labelDensity: 1,
    labelGridCellSize: 120,
    renderEdgeLabels: false,
    allowInvalidContainer: false,
    itemSizesReference: 'screen',
    labelColor: { color: '#eef2ff' },
    defaultDrawNodeHover: () => {},
    defaultDrawEdgeLabel: () => {},
    defaultDrawNodeLabel: (context, data) => {
      const size = data.size || 1;
      const borderColor = data.borderColor || '#8f9bb3';
      const borderAlpha = data.borderAlpha == null ? 1 : data.borderAlpha;
      context.beginPath();
      context.fillStyle = rgba(borderColor, 0.95 * borderAlpha);
      context.arc(data.x, data.y, size + 2.3, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.fillStyle = data.color || '#8f9bb3';
      context.arc(data.x, data.y, Math.max(1, size - 0.2), 0, Math.PI * 2);
      context.fill();
      if (size < 6 && !data.forceLabel) return;
      const label = String(data.label || '');
      const x = data.x + size + 6;
      const y = data.y;
      const highlighted = hoveredNode === data.key || pathNodeSet.has(data.key) || selectedNode === data.key;
      context.font = (highlighted ? '600 ' : '500 ') + '12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      const width = context.measureText(label).width;
      const boxX = x - 6;
      const boxY = y - 11;
      const boxW = width + 12;
      const boxH = 18;
      if (highlighted) {
        context.fillStyle = 'rgba(0,0,0,0.92)';
        context.beginPath();
        context.roundRect(boxX, boxY, boxW, boxH, 8);
        context.fill();
        context.fillStyle = pathNodeSet.has(data.key) ? '#ffe082' : '#ffffff';
        context.fillText(label, x, y + 3);
        return;
      }
      context.fillStyle = '#d8deeb';
      context.shadowColor = 'rgba(0,0,0,0.35)';
      context.shadowBlur = 3;
      context.fillText(label, x, y + 4);
      context.shadowBlur = 0;
    }
  });

  sigma.getCamera().animatedReset({ duration: 0 });
  sigma.on('afterRender', drawDirectionOverlay);

  dom.search.addEventListener('input', () => applyVisualState(dom.search.value));
  dom.pathGoBtn.addEventListener('click', runPathSearch);
  dom.pathClearBtn.addEventListener('click', () => {
    setPath(null);
    dom.pathFromInput.value = '';
    dom.pathToInput.value = '';
    updatePathStatus('No path selected.');
    applyVisualState(dom.search.value);
  });
  dom.pathCopyBtn.addEventListener('click', () => { copySelectedPathCodeBlocks().catch(() => updatePathStatus('Clipboard copy failed. Browser denied clipboard access.')); });
  dom.pathReverseBtn.addEventListener('click', () => {
    const from = dom.pathFromInput.value;
    dom.pathFromInput.value = dom.pathToInput.value;
    dom.pathToInput.value = from;
    focusedPathField = focusedPathField === 'from' ? 'to' : 'from';
    syncFocusedFieldUI();
    if (dom.pathFromInput.value && dom.pathToInput.value) runPathSearch();
    else updatePathStatus('Reversed source and sink fields.');
  });
  dom.directedToggle.addEventListener('change', () => {
    applyDirections = dom.directedToggle.checked;
    if (dom.pathFromInput.value || dom.pathToInput.value) runPathSearch();
    else updatePathStatus(applyDirections ? 'Directed traversal enabled.' : 'Ignoring edge direction.');
  });
  dom.renderEdgeDirectionToggle.addEventListener('change', () => { renderEdgeDirection = dom.renderEdgeDirectionToggle.checked; sigma.refresh(); });
  dom.lineNumbersToggle.addEventListener('change', () => { showLineNumbers = dom.lineNumbersToggle.checked; if (selectedNode) updateInspect(selectedNode); renderPathCodeView(); });
  dom.layoutModeSelect.addEventListener('change', () => {
    layoutMode = dom.layoutModeSelect.value;
    const next = new URL(window.location.href);
    next.searchParams.set('layout', layoutMode);
    window.location.href = next.toString();
  });
  dom.sizeModeSelect.addEventListener('change', () => { nodeSizeMode = dom.sizeModeSelect.value; refreshBaseNodeStyles(); applyVisualState(dom.search.value); });
  dom.sizeBaseInput.addEventListener('input', () => { nodeSizeBase = Number(dom.sizeBaseInput.value); dom.sizeBaseValue.textContent = String(nodeSizeBase); refreshBaseNodeStyles(); applyVisualState(dom.search.value); });
  dom.sizeCodeFactorInput.addEventListener('input', () => { nodeSizeCodeFactor = Number(dom.sizeCodeFactorInput.value); dom.sizeCodeFactorValue.textContent = nodeSizeCodeFactor.toFixed(3); refreshBaseNodeStyles(); applyVisualState(dom.search.value); });
  dom.transparencyInput.addEventListener('input', () => { paneTransparency = Number(dom.transparencyInput.value); applyPaneTransparency(document.documentElement, paneTransparency, dom.transparencyValue); });
  dom.collapseSidebarBtn.addEventListener('click', () => {
    const collapsed = dom.appRoot.dataset.sidebarCollapsed !== 'true';
    setSidebarCollapsed(dom.appRoot, dom.collapseSidebarBtn, collapsed);
    if (!collapsed) applyFloatingPaneSize();
  });
  dom.mainComponentFocusBtn.addEventListener('click', () => {
    mainComponentFocusMode = !mainComponentFocusMode;
    dom.mainComponentFocusBtn.dataset.active = mainComponentFocusMode ? 'true' : 'false';
    dom.mainComponentFocusBtn.textContent = mainComponentFocusMode ? 'Main component target: ON' : 'Main component target: OFF';
  });
  dom.recomputeMainBtn.addEventListener('click', () => {
    const path = dom.mainSourceSelect.value;
    const candidates = state.raw.nodes.filter((n) => (n.path || '') === path);
    const explicitMain = candidates.find((n) => String(n.label || '').toLowerCase() === 'main');
    const chosen = explicitMain || candidates[0] || null;
    if (chosen) setMainFromNode(chosen.key);
  });
  dom.sidebarTabs.forEach((btn) => btn.addEventListener('click', () => setActiveTab(dom.sidebarTabs, dom.sidebarPanels, btn.dataset.tabButton)));
  dom.pathFromInput.addEventListener('focus', () => { focusedPathField = 'from'; syncFocusedFieldUI(); });
  dom.pathToInput.addEventListener('focus', () => { focusedPathField = 'to'; syncFocusedFieldUI(); });
  dom.pathFromInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runPathSearch(); });
  dom.pathToInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runPathSearch(); });
  dom.pathList.addEventListener('keydown', handlePathListKeydown);
  dom.pathList.tabIndex = 0;
  dom.pathList.setAttribute('role', 'listbox');
  dom.pathList.setAttribute('aria-label', 'Path selection list');
  sigma.on('clickNode', ({ node }) => {
    selectedNode = node;
    if (mainComponentFocusMode) setMainFromNode(node);
    else assignNodeToFocusedField(node);
    updateInspect(node);
    applyVisualState(dom.search.value);
  });
  sigma.on('enterNode', ({ node }) => { hoveredNode = node; applyVisualState(dom.search.value); });
  sigma.on('leaveNode', () => { hoveredNode = null; applyVisualState(dom.search.value); });

  dom.layoutModeSelect.value = layoutMode;
  dom.sizeModeSelect.value = nodeSizeMode;
  dom.sizeBaseInput.value = String(nodeSizeBase);
  dom.sizeCodeFactorInput.value = String(nodeSizeCodeFactor);
  dom.transparencyInput.value = String(paneTransparency);
  dom.lineNumbersToggle.checked = showLineNumbers;
  dom.directedToggle.checked = applyDirections;
  dom.renderEdgeDirectionToggle.checked = renderEdgeDirection;
  dom.sizeBaseValue.textContent = String(nodeSizeBase);
  dom.sizeCodeFactorValue.textContent = nodeSizeCodeFactor.toFixed(3);
  applyPaneTransparency(document.documentElement, paneTransparency, dom.transparencyValue);
  syncFocusedFieldUI();
  setActiveTab(dom.sidebarTabs, dom.sidebarPanels, uiConfig.active_tab || 'code-search');
  setSidebarCollapsed(dom.appRoot, dom.collapseSidebarBtn, false);
  applyFloatingPaneSize();
  attachRightPaneResize();
  renderPathList();
  renderPathCodeView();
  updatePathStatus('No path selected. Focus source or sink, then click a node to assign it.');
  if (selectedNode) updateInspect(selectedNode);
  applyVisualState();
}
