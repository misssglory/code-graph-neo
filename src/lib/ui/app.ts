import Graph from 'https://esm.sh/graphology@0.26.0';
import Sigma from 'https://esm.sh/sigma@3.0.0';
import forceAtlas2 from 'https://esm.sh/graphology-layout-forceatlas2@0.10.1';
import Prism from 'https://esm.sh/prismjs@1.29.0';
import 'https://esm.sh/prismjs@1.29.0/components/prism-rust';
import { createDom } from './dom.ts';
import { buildGraphState, recomputeMainComponentState, computeNodeSize, sourcePreview, resolveNodeInput, estimateCodeSize, findNodePath, edgeKeyBetween } from './graph-state.ts';
import { applyPaneTransparency, setActiveTab, setSidebarCollapsed } from './layout.ts';
import { escapeHtml, renderCodeBlock } from './render.ts';

export function createApp(raw) {
  const dom = createDom();
  const graph = new Graph({ multi: true, allowSelfLoops: true });
  const state = buildGraphState(raw);

  let hoveredNode = null;
  let selectedNode = raw.mainKey || null;
  let applyDirections = true;
  let focusedPathField = 'from';
  let showLineNumbers = false;
  let nodeSizeMode = 'status';
  let nodeSizeBase = 11;
  let nodeSizeCodeFactor = 0.015;
  let paneTransparency = 0.58;
  let currentPath = [];
  let pathNodeSet = new Set();
  let pathEdgeSet = new Set();
  let layoutMode = new URL(window.location.href).searchParams.get('layout') || 'columns';
  let mainComponentFocusMode = false;
  let rightPaneWidth = 430;

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
      graph.addDirectedEdgeWithKey(key, edge.source, edge.target, { color, size: bothUsed ? 2 : 1, type: 'line' });
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
      dom.pathList.innerHTML = '<div class="path-empty">No path selected.</div>';
      return;
    }
    dom.pathList.innerHTML = currentPath.map((nodeId, idx) => {
      const node = state.rawNodeByKey.get(nodeId);
      return '<button class="path-item" data-node-id="' + escapeHtml(nodeId) + '"><span class="path-step">' + idx + '</span><span class="path-main"><span class="path-label">' + escapeHtml(node?.label || nodeId) + '</span><span class="path-file mono">' + escapeHtml(node?.path || 'unknown') + '</span></span></button>';
    }).join('');
    dom.pathList.querySelectorAll('[data-node-id]').forEach((el) => el.addEventListener('click', () => {
      const nodeId = el.getAttribute('data-node-id');
      if (!nodeId) return;
      selectedNode = nodeId;
      updateInspect(nodeId);
      hoveredNode = nodeId;
      applyVisualState(dom.search.value);
    }));
  }

  function setPath(nodePath) {
    currentPath = nodePath || [];
    pathNodeSet = new Set(currentPath);
    pathEdgeSet = new Set();
    if (currentPath.length > 1) {
      for (let i = 0; i < currentPath.length - 1; i++) {
        const edge = edgeKeyBetween({ graph, source: currentPath[i], target: currentPath[i + 1], applyDirections });
        if (edge) pathEdgeSet.add(edge);
      }
    }
    renderPathList();
  }

  function updatePathStatus(message) { dom.pathStatus.textContent = message; }
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
    dom.selection.textContent = attrs.label + ' — ' + status;
    dom.inspect.innerHTML = '<strong>' + escapeHtml(attrs.label) + '</strong><br>' +
      '<span class="mono">key: ' + escapeHtml(nodeId) + '</span><br>' +
      '<span class="mono">path: ' + escapeHtml(attrs.path || 'unknown') + '</span><br>' +
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
      graph.setEdgeAttribute(edge, 'color', onPath ? '#ffd54f' : active ? state.baseEdgeColor.get(edge) : 'rgba(255,255,255,0.05)');
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
    dom.selection.textContent = 'Main source node: ' + graph.getNodeAttribute(nodeId, 'label') + ' — ' + state.currentMainPath;
  }

  function fillMainSourceSelect() {
    const uniquePaths = [...new Set(state.raw.nodes.map((n) => n.path || 'unknown'))].sort();
    dom.mainSourceSelect.innerHTML = uniquePaths.map((path) => '<option value="' + escapeHtml(path) + '">' + escapeHtml(path) + '</option>').join('');
    if (state.currentMainPath) dom.mainSourceSelect.value = state.currentMainPath;
  }

  function applyRightPaneWidth() {
    document.documentElement.style.setProperty('--right-pane-width', rightPaneWidth + 'px');
    if (dom.rightPaneWrap) {
      dom.rightPaneWrap.style.width = rightPaneWidth + 'px';
      dom.rightPaneWrap.style.flexBasis = rightPaneWidth + 'px';
    }
    if (dom.rightPane) dom.rightPane.style.width = '100%';
  }

  function attachRightPaneResize() {
    if (!dom.rightPaneResizeHandle) return;
    dom.rightPaneResizeHandle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = rightPaneWidth;
      const move = (ev) => {
        ev.preventDefault();
        rightPaneWidth = Math.max(280, Math.min(Math.min(900, window.innerWidth - 120), startWidth - (ev.clientX - startX)));
        applyRightPaneWidth();
      };
      const up = () => {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      dom.rightPaneResizeHandle.setPointerCapture?.(event.pointerId);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
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
    defaultDrawNodeLabel: (context, data) => {
      const size = data.size || 1;
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

  dom.search.addEventListener('input', () => applyVisualState(dom.search.value));
  dom.pathGoBtn.addEventListener('click', runPathSearch);
  dom.pathClearBtn.addEventListener('click', () => {
    setPath(null);
    dom.pathFromInput.value = '';
    dom.pathToInput.value = '';
    updatePathStatus('No path selected.');
    applyVisualState(dom.search.value);
  });
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
  dom.lineNumbersToggle.addEventListener('change', () => {
    showLineNumbers = dom.lineNumbersToggle.checked;
    if (selectedNode) updateInspect(selectedNode);
  });
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
    if (!collapsed) applyRightPaneWidth();
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
  sigma.on('clickNode', ({ node }) => {
    selectedNode = node;
    if (mainComponentFocusMode) {
      setMainFromNode(node);
    } else {
      assignNodeToFocusedField(node);
    }
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
  dom.sizeBaseValue.textContent = String(nodeSizeBase);
  dom.sizeCodeFactorValue.textContent = nodeSizeCodeFactor.toFixed(3);
  applyPaneTransparency(document.documentElement, paneTransparency, dom.transparencyValue);
  syncFocusedFieldUI();
  setActiveTab(dom.sidebarTabs, dom.sidebarPanels, 'code-search');
  setSidebarCollapsed(dom.appRoot, dom.collapseSidebarBtn, false);
  applyRightPaneWidth();
  attachRightPaneResize();
  renderPathList();
  updatePathStatus('No path selected. Focus source or sink, then click a node to assign it.');
  if (selectedNode) updateInspect(selectedNode);
  applyVisualState();
}
