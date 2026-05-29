import Graph from 'https://esm.sh/graphology@0.26.0';
import Sigma from 'https://esm.sh/sigma@3.0.0';
import forceAtlas2 from 'https://esm.sh/graphology-layout-forceatlas2@0.10.1';
import Prism from 'https://esm.sh/prismjs@1.29.0';
import 'https://esm.sh/prismjs@1.29.0/components/prism-rust';
import { createDom } from './dom.ts';
import { buildGraphState, recomputeMainComponentState, computeNodeSize, sourcePreview, resolveNodeInput, estimateCodeSize, findNodePath, edgeKeyBetween } from './graph-state.ts';
import { applyPaneTransparency, setActiveTab, setSidebarCollapsed } from './layout.ts';
import { escapeAttr, escapeHtml, renderCodeBlock } from './render.ts';

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
function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


function bulkMatchKey(match) {
  return [match.rawWord, match.matchedText, match.nodeId, match.reason, match.start, match.end].map((part) => encodeURIComponent(String(part ?? ''))).join('|');
}
function renderSimpleMarkdownFromAnnotatedHtml(annotatedHtml) {
  const lines = String(annotatedHtml || '').split('\n');
  const blocks = [];
  let paragraph = [];
  let listItems = [];
  let inFence = false;
  let fenceLines = [];
  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push('<p>' + paragraph.join('<br>') + '</p>');
    paragraph = [];
  };
  const flushList = () => {
    if (!listItems.length) return;
    blocks.push('<ul>' + listItems.map((item) => '<li>' + item + '</li>').join('') + '</ul>');
    listItems = [];
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^```/.test(trimmed)) {
      if (inFence) {
        blocks.push('<pre><code>' + fenceLines.join('\n') + '</code></pre>');
        fenceLines = [];
        inFence = false;
      } else {
        flushParagraph();
        flushList();
        inFence = true;
      }
      continue;
    }
    if (inFence) {
      fenceLines.push(line);
      continue;
    }
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      blocks.push('<h' + level + '>' + heading[2] + '</h' + level + '>');
      continue;
    }
    const bullet = trimmed.match(/^[-*+]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      listItems.push(bullet[1]);
      continue;
    }
    const quote = trimmed.match(/^&gt;\s?(.+)$/);
    if (quote) {
      flushParagraph();
      flushList();
      blocks.push('<blockquote>' + quote[1] + '</blockquote>');
      continue;
    }
    flushList();
    paragraph.push(trimmed);
  }
  if (inFence) blocks.push('<pre><code>' + fenceLines.join('\n') + '</code></pre>');
  flushParagraph();
  flushList();
  return blocks.join('') || '<div class="mutation-hint-empty">Paste text to preview matched parts.</div>';
}

function pathWithoutExtension(path) {
  return String(path || '').replace(/\.[^\/.]+$/, '');
}
function normalizePathSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\\/g, '/')
    .replace(/::+/g, '/')
    .replace(/[.]+/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '');
}
function pathSearchCandidates(path) {
  const lowerPath = String(path || '').toLowerCase();
  const noExt = pathWithoutExtension(lowerPath);
  const parts = noExt.split(/[\/]/).filter(Boolean);
  const fileStem = parts.at(-1) || noExt;
  return new Set([
    lowerPath,
    noExt,
    normalizePathSearchText(lowerPath),
    normalizePathSearchText(noExt),
    fileStem,
    normalizePathSearchText(fileStem)
  ].filter(Boolean));
}
function pathMatchesFilePart(path, rawFilePart) {
  const raw = String(rawFilePart || '').trim().toLowerCase();
  if (!raw) return false;
  const normalizedRaw = normalizePathSearchText(raw);
  const rawWithoutExt = pathWithoutExtension(raw);
  const normalizedRawWithoutExt = normalizePathSearchText(rawWithoutExt);
  const rawLeaf = normalizedRawWithoutExt.split('/').filter(Boolean).at(-1) || normalizedRawWithoutExt;
  const candidates = pathSearchCandidates(path);
  for (const candidate of candidates) {
    if (candidate.includes(raw) || candidate.includes(rawWithoutExt) || candidate.includes(normalizedRaw) || candidate.includes(normalizedRawWithoutExt)) return true;
    if (candidate.endsWith('/' + normalizedRawWithoutExt) || candidate === normalizedRawWithoutExt) return true;
    if (rawLeaf && candidate.split('/').filter(Boolean).at(-1) === rawLeaf) return true;
  }
  return false;
}
function parseFileLineQuery(query) {
  const match = query.match(/^(.+):(\d+)$/);
  if (!match) return null;
  const filePart = match[1].trim().toLowerCase();
  const line = Number(match[2]);
  if (!filePart || !Number.isFinite(line) || line < 1) return null;
  const normalized = filePart.endsWith('.rs') ? filePart : `${filePart}.rs`;
  return { rawFile: filePart, normalizedFile: normalized, normalizedFilePart: normalizePathSearchText(filePart), line };
}
function nodeScoreForHint(node, query, matchOptions = { name: true, filename: true, code: true }, stateRef) {
  const q = query.trim().toLowerCase();
  if (!q) return -Infinity;
  const fileLineQuery = parseFileLineQuery(q);
  if (fileLineQuery) {
    if (!matchOptions.filename) return -Infinity;
    const range = node.range || null;
    const lineInRange = Boolean(range && range.start?.line <= fileLineQuery.line && range.end?.line >= fileLineQuery.line);
    if (lineInRange && pathMatchesFilePart(node.path || '', fileLineQuery.rawFile)) return 360;
  }
  const label = String(node.label || '').toLowerCase();
  const key = String(node.key || '').toLowerCase();
  const path = String(node.path || '').toLowerCase();
  const signature = String(node.signature || '').toLowerCase();
  let score = -Infinity;
  const candidates = [];
  if (matchOptions.name) candidates.push(label, key, signature);
  if (matchOptions.filename) candidates.push(path, ...pathSearchCandidates(path));
  const queryCandidates = [...new Set([q, normalizePathSearchText(q)].filter(Boolean))];
  for (const text of candidates) {
    for (const candidateQuery of queryCandidates) {
      const idx = text.indexOf(candidateQuery);
      if (idx < 0) continue;
      const candidateScore = (idx === 0 ? 220 : 140 - Math.min(idx, 100)) + Math.max(0, 80 - text.length);
      if (candidateScore > score) score = candidateScore;
    }
  }
  if (matchOptions.code && stateRef) {
    const nodeCode = sourcePreview(stateRef, node || {}).toLowerCase();
    if (nodeCode.includes(q)) score = Math.max(score, 120);
  }
  return score;
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
function withLineNumbers(text, startLine = 1, enabled = false) {
  const value = String(text || '');
  if (!enabled) return value;
  return value.split('\n').map((line, idx) => `${startLine + idx}: ${line}`).join('\n');
}

export function createApp(bootstrap) {
  const initialRaw = bootstrap?.graph || bootstrap;
  const config = bootstrap?.config || {};
  const uiConfig = config.ui || {};
  const graphConfig = config.graph || {};
  const colorConfig = config.colors || {};
  const palette = Array.isArray(colorConfig.file_palette) && colorConfig.file_palette.length ? colorConfig.file_palette : ['#63d7ff', '#ff7e7e', '#67db8b', '#ffd54f'];

  const dom = createDom();
  const graph = new Graph({ multi: true, allowSelfLoops: true });
  let state = buildGraphState(initialRaw);
  let fileColorByPath = makeFileColorMap(state.raw.nodes.map((n) => n.path || ''), palette);
  let sigma = null;
  let graphSnapshots = [];
  let currentSnapshotPath = 'graph.json';
  let graphSnapshotSort = 'time-desc';
  let selectedSnapshotComparePath = '';

  function fileLineCount(path) {
    const content = String(state.fileContentByPath.get(path || '') || '');
    if (content) return Math.max(1, content.split('\n').length);
    const nodes = state.nodesByPath.get(path || 'unknown') || [];
    const largestRangeEnd = nodes.reduce((max, node) => Math.max(max, node.range?.end?.line || 0), 0);
    return Math.max(1, largestRangeEnd);
  }
  function nodeLineShareText(node) {
    const codeLines = estimateCodeSize(state, node || {});
    const totalLines = fileLineCount(node?.path || '');
    const percent = totalLines ? (codeLines / totalLines) * 100 : 0;
    return String(codeLines).padStart(5, ' ') + 'L ' + String(Math.round(percent)).padStart(3, ' ') + '%';
  }

  function lineNumberForSnippetIndex(node, lineIdx) {
    return (node?.range?.start?.line || 1) + lineIdx;
  }

  function highlightedCodeLine(line, matchStart, matchLength) {
    if (matchStart < 0 || matchLength <= 0) return escapeHtml(line);
    return escapeHtml(line.slice(0, matchStart)) +
      '<strong>' + escapeHtml(line.slice(matchStart, matchStart + matchLength)) + '</strong>' +
      escapeHtml(line.slice(matchStart + matchLength));
  }

  function codeMatchLineForHint(node, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q || parseFileLineQuery(q) || !searchMatchOptions().code) return null;
    const snippet = sourcePreview(state, node || {});
    const snippetLines = String(snippet || '').split('\n');
    for (let idx = 0; idx < snippetLines.length; idx++) {
      const matchStart = snippetLines[idx].toLowerCase().indexOf(q);
      if (matchStart >= 0) {
        return {
          line: lineNumberForSnippetIndex(node, idx),
          html: highlightedCodeLine(snippetLines[idx].trim(), Math.max(0, matchStart - (snippetLines[idx].length - snippetLines[idx].trimStart().length)), q.length)
        };
      }
    }

    return null;
  }


  function updateGraphSummary() {
    if (dom.summaryMain) dom.summaryMain.textContent = 'main: ' + (state.currentMainKey || 'not found');
    if (dom.summaryNodes) dom.summaryNodes.textContent = 'nodes: ' + state.raw.nodes.length;
    if (dom.summaryFiles) dom.summaryFiles.textContent = 'files: ' + state.raw.files.length;
  }

  function formatSnapshotDate(value) {
    if (!value) return 'mtime unavailable';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'mtime unavailable';
    return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
  }
  function formatSnapshotSize(bytes) {
    const n = Number(bytes || 0);
    if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
    return n + ' B';
  }
  function sortedGraphSnapshots() {
    const snapshots = [...graphSnapshots];
    snapshots.sort((a, b) => {
      if (graphSnapshotSort === 'time-asc') return (a.mtimeMs || 0) - (b.mtimeMs || 0) || String(a.path).localeCompare(String(b.path));
      if (graphSnapshotSort === 'name-asc') return String(a.path).localeCompare(String(b.path));
      if (graphSnapshotSort === 'name-desc') return String(b.path).localeCompare(String(a.path));
      return (b.mtimeMs || 0) - (a.mtimeMs || 0) || String(a.path).localeCompare(String(b.path));
    });
    return snapshots;
  }
  function renderSnapshotPicker() {
    if (!dom.graphSnapshotList) return;
    if (!graphSnapshots.length) {
      dom.graphSnapshotList.innerHTML = '<div class="path-empty">No JSON graph snapshots found in public/.</div>';
      if (dom.graphSnapshotDetails) dom.graphSnapshotDetails.textContent = 'No graph snapshots are available to compare.';
      return;
    }
    dom.graphSnapshotList.innerHTML = sortedGraphSnapshots().map((snapshot) => {
      const active = snapshot.path === currentSnapshotPath ? ' · current' : '';
      const selected = snapshot.path === selectedSnapshotComparePath ? ' data-selected="true"' : '';
      return '<div class="snapshot-row" data-graph-snapshot-path="' + escapeAttr(snapshot.path) + '"' + selected + '><div><div class="snapshot-name">' + escapeHtml(snapshot.path) + escapeHtml(active) + '</div><div class="snapshot-meta">Last modified: ' + escapeHtml(formatSnapshotDate(snapshot.mtime)) + ' · ' + escapeHtml(formatSnapshotSize(snapshot.size)) + '</div></div><button class="btn snapshot-open-btn" type="button" data-open-graph-snapshot="' + escapeAttr(snapshot.path) + '">Open</button></div>';
    }).join('');
    dom.graphSnapshotList.querySelectorAll('[data-open-graph-snapshot]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        openGraphSnapshot(button.getAttribute('data-open-graph-snapshot') || '');
      });
    });
    dom.graphSnapshotList.querySelectorAll('[data-graph-snapshot-path]').forEach((row) => {
      row.addEventListener('click', () => compareGraphSnapshot(row.getAttribute('data-graph-snapshot-path') || ''));
    });
  }
  function graphKeySet(graphData) {
    return new Set((graphData?.nodes || []).map((node) => node.key));
  }
  function sampleNodeList(keys, graphData) {
    const byKey = new Map((graphData?.nodes || []).map((node) => [node.key, node]));
    const sample = keys.slice(0, 20).map((key) => {
      const node = byKey.get(key);
      return escapeHtml((node?.label || key) + (node?.path ? ' · ' + node.path : ''));
    });
    const more = keys.length > sample.length ? '<br>…and ' + (keys.length - sample.length) + ' more' : '';
    return sample.length ? sample.join('<br>') + more : 'none';
  }
  async function compareGraphSnapshot(path) {
    if (!path || !dom.graphSnapshotDetails) return;
    selectedSnapshotComparePath = path;
    renderSnapshotPicker();
    dom.graphSnapshotDetails.textContent = 'Loading comparison for ' + path + '…';
    try {
      const response = await fetch('/api/graph?path=' + encodeURIComponent(path));
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || ('HTTP ' + response.status));
      const candidate = data.graph || {};
      const candidateKeys = graphKeySet(candidate);
      const currentKeys = graphKeySet(state.raw);
      const notPresent = [...candidateKeys].filter((key) => !currentKeys.has(key)).sort();
      const missing = [...currentKeys].filter((key) => !candidateKeys.has(key)).sort();
      dom.graphSnapshotDetails.innerHTML = '<strong>' + escapeHtml(path) + '</strong><br>' +
        'Nodes: ' + (candidate.nodes || []).length + ' · Edges: ' + (candidate.edges || []).length + '<br><br>' +
        '<strong>Not present in currently open graph</strong> (' + notPresent.length + ')<br>' + sampleNodeList(notPresent, candidate) + '<br><br>' +
        '<strong>Missing from selected graph</strong> (' + missing.length + ')<br>' + sampleNodeList(missing, state.raw);
    } catch (error) {
      dom.graphSnapshotDetails.textContent = 'Could not compare ' + path + ': ' + (error?.message || error);
    }
  }
  async function refreshSnapshotList() {
    if (dom.graphSnapshotStatus) dom.graphSnapshotStatus.textContent = 'Loading snapshots from public/*.json…';
    try {
      const response = await fetch('/api/graphs');
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      graphSnapshots = Array.isArray(data.snapshots) ? data.snapshots : [];
      renderSnapshotPicker();
      if (dom.graphSnapshotStatus) dom.graphSnapshotStatus.textContent = graphSnapshots.length ? 'Found ' + graphSnapshots.length + ' graph snapshot(s). Last modification times are shown below.' : 'No JSON graph snapshots found in public/.';
    } catch (error) {
      if (dom.graphSnapshotStatus) dom.graphSnapshotStatus.textContent = 'Could not load graph snapshots: ' + (error?.message || error);
    }
  }
  function resetGraphSelections() {
    hoveredNode = null;
    selectedNode = state.currentMainKey || null;
    foundPaths = [];
    foundPathIndex = -1;
    currentPath = [];
    pathSelectedNodeSet = new Set();
    pathNodeSet = new Set();
    pathEdgeSet = new Set();
    pathCursorIndex = -1;
    selectedStateNodeSet = new Set();
    disabledBulkMatchKeys = new Set();
    bulkMatchJobId += 1;
    bulkMatchState = { text: '', tokens: [], matches: [], unresolved: [], nodeIds: [], processed: 0, total: 0, running: false };
  }
  function rebuildGraphFromState({ resetSelections = true } = {}) {
    graph.clear();
    fileColorByPath = makeFileColorMap(state.raw.nodes.map((n) => n.path || ''), palette);
    if (resetSelections) resetGraphSelections();
    refreshStateForCurrentMain();
    seedColumnLayout();
    refreshBaseNodeStyles();
    addEdges();
    applyOptionalLayout();
    buildNeighborMap();
    fillMainSourceSelect();
    updateGraphSummary();
  }
  function refreshGraphDependentViews() {
    renderFoundPathTabs();
    renderPathList();
    renderPathCodeView();
    updateSelectedStateViews();
    updateAllMutationViews();
    updatePathStatus('No path selected. Focus source or sink, then click a node to assign it.');
    if (selectedNode) updateInspect(selectedNode);
    else if (dom.inspect) dom.inspect.textContent = 'Ready.';
    applyVisualState(dom.search?.value || '');
  }
  async function openGraphSnapshot(path) {
    if (!path) return;
    if (dom.graphSnapshotStatus) dom.graphSnapshotStatus.textContent = 'Opening ' + path + '…';
    try {
      const response = await fetch('/api/graph?path=' + encodeURIComponent(path));
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || ('HTTP ' + response.status));
      state = buildGraphState(data.graph);
      currentSnapshotPath = data.snapshot?.path || path;
      selectedSnapshotComparePath = '';
      if (dom.graphSnapshotDetails) dom.graphSnapshotDetails.textContent = 'Click a graph row to compare it with the currently open graph.';
      rebuildGraphFromState({ resetSelections: true });
      refreshGraphDependentViews();
      renderSnapshotPicker();
      if (dom.graphSnapshotStatus) dom.graphSnapshotStatus.textContent = 'Opened ' + currentSnapshotPath + '. Last modified: ' + formatSnapshotDate(data.snapshot?.mtime) + '.';
    } catch (error) {
      if (dom.graphSnapshotStatus) dom.graphSnapshotStatus.textContent = 'Could not open ' + path + ': ' + (error?.message || error);
    }
  }

  function searchMatchOptions() {
    return {
      name: dom.searchMatchName?.matches(':checked') ?? true,
      filename: dom.searchMatchFilename?.matches(':checked') ?? true,
      code: dom.searchMatchCode?.matches(':checked') ?? true,
    };
  }

  let hoveredNode = null;
  let selectedNode = state.currentMainKey || null;
  let applyDirections = Boolean(graphConfig.apply_directions ?? true);
  let renderEdgeDirection = Boolean(uiConfig.render_edge_direction ?? true);
  let focusedPathField = 'from';
  let showLineNumbers = Boolean(uiConfig.show_line_numbers ?? false);
  let wordWrapCode = Boolean(uiConfig.word_wrap_code ?? false);
  let nodeSizeMode = graphConfig.node_size_mode || 'status';
  let nodeSizeBase = Number(graphConfig.node_size_base ?? 11);
  let nodeSizeCodeFactor = Number(graphConfig.node_size_code_factor ?? 0.015);
  let paneTransparency = Number(uiConfig.pane_transparency ?? 0.58);
  let foundPaths = [];
  let foundPathIndex = -1;
  let currentPath = [];
  let pathSelectedNodeSet = new Set();
  let pathNodeSet = new Set();
  let pathEdgeSet = new Set();
  let pathCursorIndex = -1;
  let selectedStateNodeSet = new Set();
  let searchHintNodeSet = new Set();
  let disabledBulkMatchKeys = new Set();
  let bulkRenderMarkdown = false;
  let bulkNameMatchMode = 'full';
  let bulkFilenameMatchMode = 'full';
  let bulkMatchJobId = 0;
  let bulkMatchState = { text: '', tokens: [], matches: [], unresolved: [], nodeIds: [], processed: 0, total: 0, running: false };
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

  function renderFoundPathTabs() {
    if (!dom.pathFoundList) return;
    if (!foundPaths.length) {
      dom.pathFoundList.innerHTML = '<div class="path-empty">No paths found yet.</div>';
      return;
    }
    dom.pathFoundList.innerHTML = foundPaths.map((path, idx) => {
      const active = idx === foundPathIndex ? 'true' : 'false';
      const length = Math.max(0, path.length - 1);
      return '<button class="btn path-pill" data-found-path-index="' + idx + '" data-active="' + active + '">Path ' + (idx + 1) + ' · len ' + length + '</button>';
    }).join('');
    dom.pathFoundList.querySelectorAll('[data-found-path-index]').forEach((el) => {
      el.addEventListener('click', () => activateFoundPath(Number(el.getAttribute('data-found-path-index') || '0')));
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
      const includeCode = pathSelectedNodeSet.has(nodeId) ? 'true' : 'false';
      return '<button class="path-item" role="option" aria-selected="' + selected + '" data-selected="' + selected + '" data-node-id="' + escapeHtml(nodeId) + '" data-index="' + idx + '"><span class="path-step path-step-toggle" role="checkbox" data-path-code-toggle="' + escapeHtml(nodeId) + '" data-included="' + includeCode + '" aria-checked="' + includeCode + '">' + idx + '</span><span class="path-main"><span class="path-label">' + escapeHtml(node?.label || nodeId) + '</span><span class="path-file mono"><span class="selection-accent"><span class="selection-dot" style="background:' + escapeHtml(fileColor) + ';"></span><span style="color:' + escapeHtml(fileColor) + '">' + escapeHtml(node?.path || 'unknown') + '</span></span></span><span class="path-entity-meta mono">' + codeLines + ' lines of code</span></span></button>';
    }).join('');
    dom.pathList.querySelectorAll('[data-node-id]').forEach((el) => {
      el.addEventListener('click', () => activatePathRow(Number(el.getAttribute('data-index') || '0')));
    });
    dom.pathList.querySelectorAll('[data-path-code-toggle]').forEach((el) => {
      el.addEventListener('click', (event) => {
        event.stopPropagation();
        const nodeId = el.getAttribute('data-path-code-toggle');
        if (!nodeId) return;
        if (pathSelectedNodeSet.has(nodeId)) pathSelectedNodeSet.delete(nodeId);
        else pathSelectedNodeSet.add(nodeId);
        updatePathSelectionSummary();
        renderPathCodeView();
        updateSelectedStateViews();
        renderPathList();
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
    renderFoundPathTabs();
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

  function activateFoundPath(index) {
    if (!foundPaths.length) return;
    foundPathIndex = Math.max(0, Math.min(foundPaths.length - 1, index));
    setPath(foundPaths[foundPathIndex] || []);
    renderFoundPathTabs();
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
    renderFoundPathTabs();
    renderPathList();
    renderPathCodeView();
    updateSelectedStateViews();
    updateAllMutationViews();
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
        renderCodeBlock(Prism, code, startLine, showLineNumbers, wordWrapCode) + '</div>';
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
      const startLine = node?.range?.start?.line || 1;
      return '// file: ' + fileName + '\n' + withLineNumbers(preview, startLine, showLineNumbers);
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
    foundPaths.push(path);
    foundPathIndex = foundPaths.length - 1;
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
      '<strong>Source</strong>' + renderCodeBlock(Prism, preview || 'No source snippet available', startLine, showLineNumbers, wordWrapCode);
  }

  function matchesQuery(node, attrs, q, matchOptions = searchMatchOptions()) {
    if (!q) return true;
    const fileLineQuery = parseFileLineQuery(q);
    if (fileLineQuery) {
      if (!matchOptions.filename) return false;
      const range = node.range || null;
      const lineInRange = Boolean(range && range.start?.line <= fileLineQuery.line && range.end?.line >= fileLineQuery.line);
      const fileMatches = pathMatchesFilePart(attrs.path || node.path || '', fileLineQuery.rawFile);
      return lineInRange && fileMatches;
    }
    if (matchOptions.name) {
      if (String(attrs.label || '').toLowerCase().includes(q)
        || String(node.key || '').toLowerCase().includes(q)
        || String(attrs.signature || '').toLowerCase().includes(q)) return true;
    }
    if (matchOptions.filename) {
      if (String(attrs.path || '').toLowerCase().includes(q)
        || pathMatchesFilePart(attrs.path || node.path || '', q)) return true;
    }
    if (matchOptions.code) {
      const nodeCode = sourcePreview(state, node || {}).toLowerCase();
      if (nodeCode.includes(q)) return true;
    }
    return false;
  }
  function searchMatchedNodeIds(query = '') {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const ids = [];
    const matchOptions = searchMatchOptions();
    for (const node of state.raw.nodes) {
      const attrs = graph.getNodeAttributes(node.key);
      if (matchesQuery(node, attrs, q, matchOptions)) ids.push(node.key);
    }
    return ids;
  }
  function uniqueNodeIds(ids) {
    return [...new Set((ids || []).filter((id) => id && state.rawNodeByKey.has(id)))];
  }
  function mutationSummary(ids, mode) {
    const nodeIds = uniqueNodeIds(ids).filter((id) => mode === 'add' ? !selectedStateNodeSet.has(id) : selectedStateNodeSet.has(id));
    const lines = nodeIds.reduce((sum, nodeId) => sum + estimateCodeSize(state, state.rawNodeByKey.get(nodeId) || {}), 0);
    return { nodeIds, lines };
  }
  function formatMutationLabel(verb, summary, sign) {
    return verb + ' (' + sign + summary.nodeIds.length + ' nodes · ' + summary.lines + ' lines)';
  }
  function renderMutationHint(container, title, summary) {
    if (!container) return;
    const rows = summary.nodeIds.slice(0, 80).map((nodeId) => {
      const node = state.rawNodeByKey.get(nodeId);
      const fileColor = fileColorByPath.get(node?.path || '') || '#8f9bb3';
      const codeLines = estimateCodeSize(state, node || {});
      return '<div class="mutation-hint-row"><span>' + escapeHtml(node?.label || nodeId) + '</span><span style="color:' + escapeHtml(fileColor) + '">' + escapeHtml(node?.path || 'unknown') + ' · ' + codeLines + ' lines</span></div>';
    }).join('');
    const overflow = summary.nodeIds.length > 80 ? '<div class="mutation-hint-empty">…and ' + (summary.nodeIds.length - 80) + ' more nodes.</div>' : '';
    container.innerHTML = '<div class="mutation-hint"><div class="mutation-hint-title">' + escapeHtml(title) + ': ' + summary.nodeIds.length + ' nodes · ' + summary.lines + ' lines</div><div class="mutation-hint-list">' + (rows || '<div class="mutation-hint-empty">No nodes will change.</div>') + overflow + '</div></div>';
  }
  function bulkMatchOptions() {
    return {
      name: bulkNameMatchMode || 'full',
      filename: bulkFilenameMatchMode || 'full',
    };
  }
  function filePathWithoutExtension(path) {
    return String(path || '').replace(/\.[^\/.]+$/, '');
  }
  function normalizeBulkFilename(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/\\/g, '/')
      .replace(/::+/g, '/')
      .replace(/[.]+/g, '/')
      .replace(/\/+/g, '/')
      .replace(/^\/+|\/+$/g, '');
  }
  function bulkFilenameTokenCandidates(value) {
    const raw = String(value || '').trim();
    if (!raw) return [];
    const withoutLine = raw.replace(/:(\d+)$/, '');
    return [...new Set([raw, withoutLine].filter(Boolean))];
  }
  function lineMatchesNodeRange(node, line) {
    if (!line) return true;
    const range = node?.range || null;
    return Boolean(range && range.start?.line <= line && range.end?.line >= line);
  }

  function bulkWordCandidates(word) {
    const value = String(word || '').trim();
    if (!value) return [];
    const candidates = [value];
    for (const part of value.split(/[.:]+/)) {
      const clean = part.trim();
      if (clean && !/^\d+$/.test(clean)) candidates.push(clean);
    }
    return [...new Set(candidates)];
  }
  function buildBulkFilenameIndex() {
    const index = new Map();
    const add = (key, node) => {
      if (!key) return;
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(node);
    };
    for (const node of state.raw.nodes) {
      const path = node.path || '';
      add(normalizeBulkFilename(path), node);
      add(normalizeBulkFilename(filePathWithoutExtension(path)), node);
    }
    return index;
  }
  function resolveBulkFuzzyNodeName(value) {
    if (state.rawNodeByKey.has(value)) return { nodeId: value, reason: 'key' };
    const lower = value.toLowerCase();
    if (state.labelToKeys.has(lower)) return { nodeId: state.labelToKeys.get(lower)[0], reason: 'label' };
    for (const node of state.raw.nodes) {
      if (String(node.key || '').toLowerCase() === lower) return { nodeId: node.key, reason: 'key' };
      if (String(node.label || '').toLowerCase() === lower) return { nodeId: node.key, reason: 'label' };
    }
    return null;
  }
  function resolveBulkFuzzyFilename(value, line) {
    for (const node of state.raw.nodes) {
      if (!lineMatchesNodeRange(node, line)) continue;
      if (pathMatchesFilePart(node.path || '', value)) return { nodeId: node.key, reason: line ? 'file:line' : 'file' };
    }
    return null;
  }
  function resolveBulkToken(token, options = bulkMatchOptions()) {
    const value = String(token?.rawWord || '').trim();
    if (!value) return null;
    const line = token.line || null;
    if (options.name === 'full') {
      const keys = state.labelToKeys.get(value.toLowerCase());
      if (keys?.length) return { nodeId: keys[0], reason: 'name' };
    } else if (options.name === 'fuzzy') {
      for (const candidate of bulkWordCandidates(value)) {
        const byName = resolveBulkFuzzyNodeName(candidate);
        if (byName) return byName;
      }
    }
    if (options.filename === 'full') {
      for (const candidate of bulkFilenameTokenCandidates(value)) {
        const filenameKeys = [normalizeBulkFilename(candidate), normalizeBulkFilename(filePathWithoutExtension(candidate))];
        for (const key of filenameKeys) {
          for (const node of options.filenameIndex?.get(key) || []) {
            if (lineMatchesNodeRange(node, line)) return { nodeId: node.key, reason: line ? 'filename:line' : 'filename' };
          }
        }
      }
    } else if (options.filename === 'fuzzy') {
      for (const candidate of bulkWordCandidates(value)) {
        const byFilename = resolveBulkFuzzyFilename(candidate, line);
        if (byFilename) return byFilename;
      }
    }
    return null;
  }
  function tokenizeBulkText(text) {
    const tokens = [];
    const tokenRegex = /[A-Za-z0-9_./\\:-]+/g;
    let tokenMatch;
    while ((tokenMatch = tokenRegex.exec(text))) {
      const rawToken = tokenMatch[0];
      const leading = rawToken.match(/^[^A-Za-z0-9_./\\]+/)?.[0]?.length || 0;
      const trailing = rawToken.match(/[^A-Za-z0-9_]+$/)?.[0]?.length || 0;
      const rawWord = rawToken.slice(leading, rawToken.length - trailing);
      if (!rawWord) continue;
      const lineMatch = rawWord.match(/^(.*):(\d+)$/);
      tokens.push({
        rawWord,
        start: tokenMatch.index + leading,
        end: tokenMatch.index + leading + rawWord.length,
        line: lineMatch ? Number(lineMatch[2]) : null,
      });
    }
    return tokens;
  }
  function parseBulkTextNodeIds() {
    const enabledNodeIds = bulkMatchState.matches.filter((match) => !disabledBulkMatchKeys.has(match.key)).map((match) => match.nodeId);
    return {
      nodeIds: uniqueNodeIds(enabledNodeIds),
      wordCount: bulkMatchState.total,
      unresolved: [...bulkMatchState.unresolved],
      matches: bulkMatchState.matches,
      processed: bulkMatchState.processed,
      total: bulkMatchState.total,
      running: bulkMatchState.running,
    };
  }
  function setBulkProgress(processed, total, running) {
    if (!dom.bulkProgress) return;
    if (!total && !running) {
      dom.bulkProgress.hidden = true;
      dom.bulkProgress.querySelector('[role="progressbar"]')?.setAttribute('aria-valuenow', '0');
      if (dom.bulkProgressBar) dom.bulkProgressBar.style.width = '0%';
      if (dom.bulkProgressLabel) dom.bulkProgressLabel.textContent = 'Waiting to match text…';
      return;
    }
    const percent = total ? Math.round((processed / total) * 100) : 0;
    dom.bulkProgress.hidden = false;
    dom.bulkProgress.querySelector('[role="progressbar"]')?.setAttribute('aria-valuenow', String(Math.max(0, Math.min(100, percent))));
    if (dom.bulkProgressBar) dom.bulkProgressBar.style.width = Math.max(0, Math.min(100, percent)) + '%';
    if (dom.bulkProgressLabel) {
      dom.bulkProgressLabel.textContent = (running ? 'Matching' : 'Matched') + ' ' + processed + ' of ' + total + ' word(s) (' + percent + '%).';
    }
  }
  function renderBulkAnnotatedText(text, matches) {
    if (!dom.bulkAnnotatedText) return;
    if (!text) {
      dom.bulkAnnotatedText.dataset.renderMode = bulkRenderMarkdown ? 'markdown' : 'raw';
      dom.bulkAnnotatedText.innerHTML = '<div class="mutation-hint-empty">Paste text to preview matched parts.</div>';
      return;
    }
    const ordered = [...(matches || [])].sort((a, b) => a.start - b.start || a.end - b.end);
    let cursor = 0;
    let html = '';
    for (const match of ordered) {
      if (match.start < cursor) continue;
      html += escapeHtml(text.slice(cursor, match.start));
      const node = state.rawNodeByKey.get(match.nodeId);
      const enabled = !disabledBulkMatchKeys.has(match.key);
      html += '<button class="bulk-match-token" type="button" data-bulk-match-key="' + escapeAttr(match.key) + '" data-enabled="' + (enabled ? 'true' : 'false') + '" title="' + escapeAttr((enabled ? 'Enabled' : 'Disabled') + ': ' + (node?.label || match.nodeId) + ' · ' + match.reason) + '">' + escapeHtml(text.slice(match.start, match.end)) + '<span class="bulk-match-node">→ ' + escapeHtml(node?.label || match.nodeId) + '</span></button>';
      cursor = match.end;
    }
    html += escapeHtml(text.slice(cursor));
    dom.bulkAnnotatedText.dataset.renderMode = bulkRenderMarkdown ? 'markdown' : 'raw';
    dom.bulkAnnotatedText.innerHTML = bulkRenderMarkdown ? renderSimpleMarkdownFromAnnotatedHtml(html) : html;
  }
  function renderBulkTextMutationViews() {
    const parsed = parseBulkTextNodeIds();
    const addSummary = mutationSummary(parsed.nodeIds, 'add');
    const removeSummary = mutationSummary(parsed.nodeIds, 'remove');
    if (dom.bulkAddBtn) dom.bulkAddBtn.textContent = formatMutationLabel('Add text nodes', addSummary, '+');
    if (dom.bulkRemoveBtn) dom.bulkRemoveBtn.textContent = formatMutationLabel('Remove text nodes', removeSummary, '-');
    const disabledCount = parsed.matches.filter((match) => disabledBulkMatchKeys.has(match.key)).length;
    if (dom.bulkStatus) {
      if (parsed.running) {
        dom.bulkStatus.textContent = 'Matching bulk text asynchronously… ' + parsed.processed + ' of ' + parsed.total + ' word(s) scanned. ' + parsed.nodeIds.length + ' enabled unique node(s) resolved so far.';
      } else {
        dom.bulkStatus.textContent = parsed.nodeIds.length
          ? 'Resolved ' + parsed.nodeIds.length + ' enabled unique node(s) from ' + parsed.wordCount + ' word(s). ' + disabledCount + ' match(es) are turned off. ' + parsed.unresolved.length + ' unique word(s) did not resolve.'
          : (parsed.matches.length ? 'All ' + parsed.matches.length + ' resolved match(es) are turned off.' : 'No text nodes resolved yet.');
      }
    }
    setBulkProgress(parsed.processed, parsed.total, parsed.running);
    renderBulkAnnotatedText(bulkMatchState.text, parsed.matches);
    renderBulkMatchAnnotations(parsed.matches);
    renderMutationHint(dom.bulkAddHints, 'Will be added from text', addSummary);
    renderMutationHint(dom.bulkRemoveHints, 'Will be removed from text', removeSummary);
  }
  function startBulkTextMatching() {
    if (!dom.bulkTextInput) return;
    const text = dom.bulkTextInput.value || '';
    const jobId = ++bulkMatchJobId;
    const tokens = tokenizeBulkText(text);
    const matchOptions = bulkMatchOptions();
    if (matchOptions.filename === 'full') matchOptions.filenameIndex = buildBulkFilenameIndex();
    bulkMatchState = { text, tokens, matches: [], unresolved: [], nodeIds: [], processed: 0, total: tokens.length, running: Boolean(text && tokens.length) };
    if (!text || !tokens.length) {
      bulkMatchState.running = false;
      renderBulkTextMutationViews();
      return;
    }
    renderBulkTextMutationViews();
    const unresolvedSet = new Set();
    const processChunk = () => {
      if (jobId !== bulkMatchJobId) return;
      const deadline = performance.now() + 12;
      let scanned = 0;
      while (bulkMatchState.processed < bulkMatchState.total && scanned < 500 && performance.now() < deadline) {
        const token = bulkMatchState.tokens[bulkMatchState.processed];
        const resolved = resolveBulkToken(token, matchOptions);
        if (resolved) {
          const match = { rawWord: token.rawWord, matchedText: token.rawWord, start: token.start, end: token.end, nodeId: resolved.nodeId, reason: resolved.reason };
          match.key = bulkMatchKey(match);
          bulkMatchState.matches.push(match);
          if (!disabledBulkMatchKeys.has(match.key)) bulkMatchState.nodeIds.push(resolved.nodeId);
        } else {
          unresolvedSet.add(token.rawWord);
        }
        bulkMatchState.processed += 1;
        scanned += 1;
      }
      bulkMatchState.unresolved = [...unresolvedSet];
      bulkMatchState.nodeIds = uniqueNodeIds(bulkMatchState.nodeIds);
      bulkMatchState.running = bulkMatchState.processed < bulkMatchState.total;
      renderBulkTextMutationViews();
      if (bulkMatchState.running) window.setTimeout(processChunk, 0);
    };
    window.setTimeout(processChunk, 0);
  }
  function updateBulkTextMutationViews() {
    if (!dom.bulkTextInput) return;
    const text = dom.bulkTextInput.value || '';
    if (text !== bulkMatchState.text) startBulkTextMatching();
    else renderBulkTextMutationViews();
  }
  function renderBulkMatchAnnotations(matches) {
    if (!dom.bulkMatchAnnotations) return;
    const uniqueMatches = [];
    const seen = new Set();
    for (const match of matches || []) {
      const key = match.key || bulkMatchKey(match);
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueMatches.push({ ...match, key });
    }
    for (const disabledKey of [...disabledBulkMatchKeys]) {
      if (!seen.has(disabledKey)) disabledBulkMatchKeys.delete(disabledKey);
    }
    if (!uniqueMatches.length) {
      dom.bulkMatchAnnotations.innerHTML = '<div class="mutation-hint-empty">No matched text parts yet.</div>';
      return;
    }
    const rows = uniqueMatches.slice(0, 120).map((match) => {
      const node = state.rawNodeByKey.get(match.nodeId);
      const fileColor = fileColorByPath.get(node?.path || '') || '#8f9bb3';
      const enabled = !disabledBulkMatchKeys.has(match.key);
      return '<div class="bulk-match-row" data-enabled="' + (enabled ? 'true' : 'false') + '"><button class="bulk-match-toggle btn" type="button" data-bulk-match-key="' + escapeAttr(match.key) + '">' + (enabled ? 'On' : 'Off') + '</button><span><mark>' + escapeHtml(match.matchedText) + '</mark> from <span class="mono">' + escapeHtml(match.rawWord) + '</span></span><span style="color:' + escapeHtml(fileColor) + '">' + escapeHtml(node?.label || match.nodeId) + ' · ' + escapeHtml(match.reason) + '</span></div>';
    }).join('');
    const overflow = uniqueMatches.length > 120 ? '<div class="mutation-hint-empty">…and ' + (uniqueMatches.length - 120) + ' more matched text part(s).</div>' : '';
    dom.bulkMatchAnnotations.innerHTML = '<div class="bulk-match-title">Matched text parts → nodes (toggle matches to tune selected nodes and copied sources)</div><div class="bulk-match-list">' + rows + overflow + '</div>';
  }

  function updateAllMutationViews() {
    updateSearchMutationViews(dom.search?.value || '');
    updateSelectedMutationButtonLabels();
    updateBulkTextMutationViews();
  }

  function updateSearchMutationViews(query = '') {
    if (!dom.searchAddToStateBtn) return;
    const summary = mutationSummary(searchMatchedNodeIds(query), 'add');
    dom.searchAddToStateBtn.textContent = formatMutationLabel('Add search matches', summary, '+');
    dom.searchAddToStateBtn.title = query.trim()
      ? summary.lines + ' lines across ' + summary.nodeIds.length + ' currently matching node(s) will be added to selected state.'
      : 'Enter a search query to choose nodes before adding them to selected state.';
  }

  function updateSelectedStateViews() {
    const items = [...selectedStateNodeSet];
    const totalLines = items.reduce((sum, nodeId) => sum + estimateCodeSize(state, state.rawNodeByKey.get(nodeId) || {}), 0);
    dom.selectedStatus.textContent = items.length ? ('Selected-state nodes: ' + items.length + ' · ' + totalLines + ' total lines ready to copy.') : 'No selected-state nodes yet.';
    dom.selectedList.innerHTML = items.map((nodeId, idx) => {
      const node = state.rawNodeByKey.get(nodeId);
      const fileColor = fileColorByPath.get(node?.path || '') || '#8f9bb3';
      const codeLines = estimateCodeSize(state, node || {});
      return '<div class="path-item selected-item"><span class="path-step">' + idx + '</span><span class="path-main"><span class="path-label">' + escapeHtml(node?.label || nodeId) + '</span><span class="path-file mono"><span class="selection-accent"><span class="selection-dot" style="background:' + escapeHtml(fileColor) + ';"></span><span style="color:' + escapeHtml(fileColor) + '">' + escapeHtml(node?.path || 'unknown') + '</span></span></span><span class="path-entity-meta mono">' + codeLines + ' lines of code</span></span><button class="btn selected-remove-btn" data-selected-remove-node="' + escapeHtml(nodeId) + '">Remove node</button></div>';
    }).join('');
    dom.selectedList.querySelectorAll('[data-selected-remove-node]').forEach((el) => {
      el.addEventListener('click', () => {
        const nodeId = el.getAttribute('data-selected-remove-node');
        if (!nodeId) return;
        selectedStateNodeSet.delete(nodeId);
        updateSelectedStateViews();
        updateAllMutationViews();
        applyVisualState(dom.search.value);
      });
    });
    dom.selectedCodeView.innerHTML = items.map((nodeId, idx) => {
      const node = state.rawNodeByKey.get(nodeId);
      const preview = sourcePreview(state, node || {});
      const startLine = node?.range?.start?.line || 1;
      const code = '// file: ' + (node?.path || 'unknown') + '\n' + (preview || 'No source snippet available');
      return '<div><div class="path-code-file">' + escapeHtml(String(idx)) + '. ' + escapeHtml(node?.label || nodeId) + '</div>' + renderCodeBlock(Prism, code, startLine, showLineNumbers, wordWrapCode) + '</div>';
    }).join('');
  }
  function updateSelectedMutationButtonLabels() {
    const selected = selectedNode ? [selectedNode] : [];
    const incoming = selectedNode ? graph.inboundNeighbors(selectedNode) : [];
    const outgoing = selectedNode ? graph.outboundNeighbors(selectedNode) : [];
    const path = currentPath || [];
    const addSelected = mutationSummary(selected, 'add');
    const addIncoming = mutationSummary(incoming, 'add');
    const addOutgoing = mutationSummary(outgoing, 'add');
    const removeIncoming = mutationSummary(incoming, 'remove');
    const removeOutgoing = mutationSummary(outgoing, 'remove');
    const addPath = mutationSummary(path, 'add');
    const removePath = mutationSummary(path, 'remove');
    dom.selectedAddNodeBtn.textContent = formatMutationLabel('Add selected node', addSelected, '+');
    dom.selectedAddIncomingBtn.textContent = formatMutationLabel('Add incoming', addIncoming, '+');
    dom.selectedAddOutgoingBtn.textContent = formatMutationLabel('Add outgoing', addOutgoing, '+');
    dom.selectedRemoveIncomingBtn.textContent = formatMutationLabel('Remove incoming', removeIncoming, '-');
    dom.selectedRemoveOutgoingBtn.textContent = formatMutationLabel('Remove outgoing', removeOutgoing, '-');
    dom.selectedAddPathBtn.textContent = formatMutationLabel('Add current path', addPath, '+');
    dom.selectedRemovePathBtn.textContent = formatMutationLabel('Remove current path', removePath, '-');
    const hintParts = [
      ['Add selected node', addSelected],
      ['Add incoming', addIncoming],
      ['Add outgoing', addOutgoing],
      ['Remove incoming', removeIncoming],
      ['Remove outgoing', removeOutgoing],
      ['Add current path', addPath],
      ['Remove current path', removePath],
    ];
    if (dom.selectedMutationHints) dom.selectedMutationHints.innerHTML = hintParts.map(([title, summary]) => {
      const rows = summary.nodeIds.slice(0, 20).map((nodeId) => {
        const node = state.rawNodeByKey.get(nodeId);
        const fileColor = fileColorByPath.get(node?.path || '') || '#8f9bb3';
        const codeLines = estimateCodeSize(state, node || {});
        return '<div class="mutation-hint-row"><span>' + escapeHtml(node?.label || nodeId) + '</span><span style="color:' + escapeHtml(fileColor) + '">' + escapeHtml(node?.path || 'unknown') + ' · ' + codeLines + ' lines</span></div>';
      }).join('');
      const overflow = summary.nodeIds.length > 20 ? '<div class="mutation-hint-empty">…and ' + (summary.nodeIds.length - 20) + ' more.</div>' : '';
      return '<details class="mutation-hint"><summary class="mutation-hint-title">' + escapeHtml(title) + ': ' + summary.nodeIds.length + ' nodes · ' + summary.lines + ' lines</summary><div class="mutation-hint-list">' + (rows || '<div class="mutation-hint-empty">No nodes will change.</div>') + overflow + '</div></details>';
    }).join('');
  }

  function updateSearchHints(query = '') {
    if (!dom.searchHints) return;
    const q = query.trim();
    if (!q) {
      dom.searchHints.innerHTML = '';
      dom.searchHintsOverlay.innerHTML = '';
      dom.searchHintsOverlay.hidden = true;
      searchHintNodeSet = new Set();
      return;
    }
    const candidates = state.raw.nodes
      .map((node) => ({ node, score: nodeScoreForHint(node, q, searchMatchOptions(), state) }))
      .filter((item) => Number.isFinite(item.score))
      .sort((a, b) => b.score - a.score || a.node.label.localeCompare(b.node.label))
      .slice(0, 16);
    const seen = new Set();
    const options = [];
    for (const { node } of candidates) {
      const label = node.label || node.key;
      const path = node.path || 'unknown';
      const value = `${label} — ${path}`;
      if (seen.has(value)) continue;
      seen.add(value);
      options.push(`<option value="${escapeHtml(value)}"></option>`);
    }
    searchHintNodeSet = new Set(candidates.map(({ node }) => node.key));
    dom.searchHints.innerHTML = options.join('');
    dom.searchHintsOverlay.innerHTML = candidates.map(({ node }) => {
      const fileColor = fileColorByPath.get(node.path || '') || '#8f9bb3';
      const codeMatch = codeMatchLineForHint(node, q);
      const codeMatchHtml = codeMatch ? '<span class="hint-code-line"><span class="hint-code-ln">L' + escapeHtml(codeMatch.line) + '</span><span class="hint-code-src">' + codeMatch.html + '</span></span>' : '';
      const inSelectedState = selectedStateNodeSet.has(node.key);
      const isFocused = selectedNode === node.key;
      const stateColor = isFocused ? '#ffd54f' : inSelectedState ? '#b48dff' : fileColor;
      const stateBadges = (isFocused ? '<span class="hint-state-badge" data-kind="focused">focused</span>' : '') + (inSelectedState ? '<span class="hint-state-badge" data-kind="selected">selected</span>' : '');
      return '<button class="hint-row" data-hint-node="' + escapeHtml(node.key) + '" data-selected-state="' + (inSelectedState ? 'true' : 'false') + '" data-focused-node="' + (isFocused ? 'true' : 'false') + '" style="--hint-border-color:' + escapeHtml(stateColor) + '; --hint-file-color:' + escapeHtml(fileColor) + ';"><span class="hint-main"><span>' + escapeHtml(node.label || node.key) + stateBadges + '</span>' + codeMatchHtml + '</span><span class="hint-meta" style="color:' + escapeHtml(fileColor) + '">' + escapeHtml(node.path || 'unknown') + ' · ' + escapeHtml(nodeLineShareText(node)) + '</span></button>';
    }).join('');
    dom.searchHintsOverlay.hidden = candidates.length === 0;
  }
  function applyVisualState(query = '') {
    updateSearchHints(query);
    updateSearchMutationViews(query);
    const q = query.trim().toLowerCase();
    const matchOptions = searchMatchOptions();
    const hoverSet = hoveredNode ? state.neighbors.get(hoveredNode) || new Set([hoveredNode]) : null;
    const hasPath = pathNodeSet.size > 0;
    const selectedIncomingColor = '#7ec8ff';
    const selectedOutgoingColor = '#ff9f7e';
    graph.forEachNode((node, attrs) => {
      const rawNode = state.rawNodeByKey.get(node);
      const matches = rawNode ? matchesQuery(rawNode, attrs, q, matchOptions) : true;
      const hidden = !matches;
      graph.setNodeAttribute(node, 'hidden', hidden);
      const related = !hoverSet || hoverSet.has(node);
      const onPath = pathNodeSet.has(node);
      const inSelectedState = selectedStateNodeSet.has(node);
      const inSearchHints = searchHintNodeSet.has(node);
      let color = state.baseNodeColor.get(node);
      if (hidden) color = 'rgba(0,0,0,0)';
      else if (hasPath && onPath) color = '#ffd54f';
      else if (inSelectedState) color = '#84f8ff';
      else if (!related) color = 'rgba(255,255,255,0.14)';
      const baseBorderColor = fileColorByPath.get(rawNode?.path || attrs.path || '') || '#8f9bb3';
      const stateBorderColor = inSearchHints && selectedNode === node ? '#ffd54f' : inSearchHints && inSelectedState ? '#b48dff' : baseBorderColor;
      graph.setNodeAttribute(node, 'color', color);
      graph.setNodeAttribute(node, 'borderColor', stateBorderColor);
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
      const bothSelectedState = selectedStateNodeSet.has(source) && selectedStateNodeSet.has(target);
      let edgeColor = active ? state.baseEdgeColor.get(edge) : 'rgba(255,255,255,0.05)';
      if (bothSelectedState && !isIncomingSelectedEdge && !isOutgoingSelectedEdge) edgeColor = '#b48dff';
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
    updateGraphSummary();
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

  rebuildGraphFromState({ resetSelections: false });

  sigma = new Sigma(graph, dom.graphContainer, {
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
  [dom.searchMatchName, dom.searchMatchFilename, dom.searchMatchCode].forEach((checkbox) => {
    checkbox?.addEventListener('change', () => applyVisualState(dom.search.value));
  });
  dom.searchHintsOverlay.addEventListener('click', (event) => { const btn = event.target.closest('[data-hint-node]'); if (!btn) return; const nodeId = btn.getAttribute('data-hint-node'); if (!nodeId) return; selectedNode = nodeId; hoveredNode = nodeId; updateInspect(nodeId); applyVisualState(dom.search.value); });
  dom.searchAddToStateBtn?.addEventListener('click', () => {
    const summary = mutationSummary(searchMatchedNodeIds(dom.search.value), 'add');
    summary.nodeIds.forEach((nodeId) => selectedStateNodeSet.add(nodeId));
    updateSelectedStateViews();
    updateAllMutationViews();
    applyVisualState(dom.search.value);
  });
  dom.pathGoBtn.addEventListener('click', runPathSearch);
  dom.pathClearBtn.addEventListener('click', () => {
    foundPaths = [];
    foundPathIndex = -1;
    setPath(null);
    renderFoundPathTabs();
    dom.pathFromInput.value = '';
    dom.pathToInput.value = '';
    updatePathStatus('No path selected.');
    applyVisualState(dom.search.value);
  });
  dom.pathCopyBtn.addEventListener('click', () => { copySelectedPathCodeBlocks().catch(() => updatePathStatus('Clipboard copy failed. Browser denied clipboard access.')); });
  const mutateSelected = (mode, add) => { if (!selectedNode) return; const nodes = mode === 'node' ? [selectedNode] : (mode === 'incoming' ? graph.inboundNeighbors(selectedNode) : graph.outboundNeighbors(selectedNode)); nodes.forEach((n) => add ? selectedStateNodeSet.add(n) : selectedStateNodeSet.delete(n)); updateSelectedStateViews(); updateAllMutationViews(); applyVisualState(dom.search.value); };
  dom.selectedAddNodeBtn.addEventListener('click', () => mutateSelected('node', true));
  dom.selectedAddIncomingBtn.addEventListener('click', () => mutateSelected('incoming', true));
  dom.selectedAddOutgoingBtn.addEventListener('click', () => mutateSelected('outgoing', true));
  dom.selectedRemoveIncomingBtn.addEventListener('click', () => mutateSelected('incoming', false));
  dom.selectedRemoveOutgoingBtn.addEventListener('click', () => mutateSelected('outgoing', false));
  dom.selectedAddPathBtn.addEventListener('click', () => { currentPath.forEach((n) => selectedStateNodeSet.add(n)); updateSelectedStateViews(); updateAllMutationViews(); applyVisualState(dom.search.value); });
  dom.selectedRemovePathBtn.addEventListener('click', () => { currentPath.forEach((n) => selectedStateNodeSet.delete(n)); updateSelectedStateViews(); updateAllMutationViews(); applyVisualState(dom.search.value); });
  dom.bulkTextInput?.addEventListener('input', updateBulkTextMutationViews);
  dom.bulkRenderMarkdown?.addEventListener('change', () => { bulkRenderMarkdown = dom.bulkRenderMarkdown.checked; updateBulkTextMutationViews(); });
  dom.bulkNameMatchMode?.addEventListener('change', () => { bulkNameMatchMode = dom.bulkNameMatchMode.value || 'full'; startBulkTextMatching(); });
  dom.bulkFilenameMatchMode?.addEventListener('change', () => { bulkFilenameMatchMode = dom.bulkFilenameMatchMode.value || 'full'; startBulkTextMatching(); });
  const toggleBulkMatch = (key) => { if (!key) return; if (disabledBulkMatchKeys.has(key)) disabledBulkMatchKeys.delete(key); else disabledBulkMatchKeys.add(key); updateBulkTextMutationViews(); };
  dom.bulkAnnotatedText?.addEventListener('click', (event) => { const target = event.target; if (!(target instanceof Element)) return; const button = target.closest('[data-bulk-match-key]'); if (button) toggleBulkMatch(button.getAttribute('data-bulk-match-key')); });
  dom.bulkMatchAnnotations?.addEventListener('click', (event) => { const target = event.target; if (!(target instanceof Element)) return; const button = target.closest('[data-bulk-match-key]'); if (button) toggleBulkMatch(button.getAttribute('data-bulk-match-key')); });
  dom.bulkAddBtn?.addEventListener('click', () => { parseBulkTextNodeIds().nodeIds.forEach((n) => selectedStateNodeSet.add(n)); updateSelectedStateViews(); updateAllMutationViews(); applyVisualState(dom.search.value); });
  dom.bulkRemoveBtn?.addEventListener('click', () => { parseBulkTextNodeIds().nodeIds.forEach((n) => selectedStateNodeSet.delete(n)); updateSelectedStateViews(); updateAllMutationViews(); applyVisualState(dom.search.value); });
  dom.selectedCopyBtn.addEventListener('click', async () => { const text = [...selectedStateNodeSet].map((nodeId) => { const node = state.rawNodeByKey.get(nodeId); const preview = sourcePreview(state, node || {}) || 'No source snippet available'; const startLine = node?.range?.start?.line || 1; return '// file: ' + (node?.path || 'unknown') + '\n' + withLineNumbers(preview, startLine, showLineNumbers); }).join('\n\n'); await navigator.clipboard.writeText(text); dom.selectedStatus.textContent = 'Copied ' + selectedStateNodeSet.size + ' selected-state code block(s).'; });
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
  dom.rightPane?.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest('[data-copy-code]');
    if (!button) return;
    const original = button.textContent;
    try {
      await navigator.clipboard.writeText(decodeURIComponent(button.getAttribute('data-copy-code') || ''));
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = original || 'Copy'; }, 1200);
    } catch {
      button.textContent = 'Failed';
      setTimeout(() => { button.textContent = original || 'Copy'; }, 1200);
    }
  });
  dom.renderEdgeDirectionToggle.addEventListener('change', () => { renderEdgeDirection = dom.renderEdgeDirectionToggle.checked; sigma.refresh(); });
  dom.lineNumbersToggle.addEventListener('change', () => { showLineNumbers = dom.lineNumbersToggle.checked; if (selectedNode) updateInspect(selectedNode); renderPathCodeView(); updateSelectedStateViews(); updateAllMutationViews(); });
  dom.wordWrapToggle.addEventListener('change', () => { wordWrapCode = dom.wordWrapToggle.checked; if (selectedNode) updateInspect(selectedNode); renderPathCodeView(); updateSelectedStateViews(); });
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
  dom.graphSnapshotRefreshBtn?.addEventListener('click', refreshSnapshotList);
  dom.graphSnapshotSort?.addEventListener('change', () => { graphSnapshotSort = dom.graphSnapshotSort.value; renderSnapshotPicker(); });
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
    updateAllMutationViews();
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
  dom.wordWrapToggle.checked = wordWrapCode;
  dom.directedToggle.checked = applyDirections;
  dom.renderEdgeDirectionToggle.checked = renderEdgeDirection;
  if (dom.graphSnapshotSort) dom.graphSnapshotSort.value = graphSnapshotSort;
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
  updateSelectedStateViews();
  updateAllMutationViews();
  updatePathStatus('No path selected. Focus source or sink, then click a node to assign it.');
  if (selectedNode) updateInspect(selectedNode);
  applyVisualState();
  refreshSnapshotList();
}
