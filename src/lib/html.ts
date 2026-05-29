import type { GraphData } from './types.ts';
import { clientCode } from './client.ts';

export function renderHtml(graphData: GraphData, config: any = {}): string {
  const bootstrap = { graph: graphData, config };
  const ui = config?.ui || {};
  const paneWidth = Number(ui.pane_width ?? 420);
  const paneHeight = Number(ui.pane_height ?? 900);
  const paneTransparency = Number(ui.pane_transparency ?? 0.58);
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
      --panel-alpha: ${paneTransparency};
      --panel-alpha-2: ${Math.max(0.04, paneTransparency - 0.10)};
      --text: #ffffff;
      --muted: #c7cfdb;
      --border: rgba(255,255,255,0.12);
      --main: #63d7ff;
      --reach: #67db8b;
      --unreach: #ff7e7e;
      --path: #ffd54f;
      --focus: #8ab4ff;
      --outside: #8f9bb3;
      --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      --pane-width: ${paneWidth}px;
      --pane-height: min(${paneHeight}px, calc(100vh - 32px));
      --pane-top: 16px;
      --pane-right: 16px;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body { margin: 0; background: radial-gradient(circle at top left, rgba(69,95,120,0.12), transparent 32%), #000; color: var(--text); font-family: Inter, ui-sans-serif, system-ui, sans-serif; overflow: hidden; }
    .app { position: relative; width: 100vw; height: 100vh; overflow: hidden; }
    .stage { position: absolute; inset: 0; min-width: 0; min-height: 0; }
    #graph-container { position: absolute; inset: 0; }
    .right-pane-wrap { position: absolute; top: var(--pane-top); right: var(--pane-right); width: var(--pane-width); height: var(--pane-height); min-width: 56px; min-height: 56px; max-width: min(900px, calc(100vw - 32px)); max-height: calc(100vh - 32px); z-index: 30; pointer-events: auto; }
    .right-pane { position: relative; width: 100%; height: 100%; background: rgba(8, 10, 14, var(--panel-alpha)); border: 1px solid var(--border); border-radius: 18px; padding: 16px; overflow: auto; backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); box-shadow: 0 12px 30px rgba(0,0,0,0.25); }
    .right-pane-resize-corner { position: absolute; left: -2px; bottom: -2px; width: 22px; height: 22px; cursor: nesw-resize; z-index: 50; border-bottom-left-radius: 16px; background: linear-gradient(135deg, transparent 0 42%, rgba(255,255,255,0.08) 42% 50%, transparent 50% 62%, rgba(255,255,255,0.14) 62% 70%, transparent 70%), radial-gradient(circle at bottom left, rgba(255,255,255,0.12), transparent 70%); }
    h1 { margin: 0 0 8px; font-size: 20px; }
    h2 { margin: 0 0 8px; font-size: 14px; color: var(--text); }
    h3 { margin: 14px 0 8px; font-size: 13px; color: var(--text); }
    p { color: var(--muted); line-height: 1.5; }
    .topbar { display: flex; gap: 8px; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .tab-row { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
    .tab-btn, .btn { padding: 10px 12px; border-radius: 10px; border: 1px solid var(--border); background: rgba(255,255,255,0.05); color: var(--text); cursor: pointer; }
    .tab-btn[data-active="true"], .btn[data-active="true"] { background: rgba(255,255,255,0.08); }
    .btn:hover, .tab-btn:hover { background: rgba(255,255,255,0.08); }
    .section-card { background: rgba(14, 17, 23, var(--panel-alpha-2)); border: 1px solid var(--border); border-radius: 14px; padding: 12px; margin-top: 12px; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0; }
    .chip { padding: 5px 9px; border-radius: 999px; border: 1px solid var(--border); background: rgba(255,255,255,0.04); color: #fff; font-size: 12px; }
    .mainchip { color: var(--main); }
    .reachchip { color: var(--reach); }
    .unreachchip { color: var(--unreach); }
    .outsidechip { color: var(--outside); }
    .search, .text-input, .select-input, .range-input, .textarea-input { width: 100%; padding: 10px 12px; border-radius: 10px; background: rgba(255,255,255,0.04); border: 1px solid var(--border); color: var(--text); font-family: var(--mono); }
    .textarea-input { min-height: 280px; resize: vertical; line-height: 1.45; }
    .search-hints-overlay { width: 100%; margin-top: 8px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.15); background: rgba(0,0,0,0.95); overflow: hidden; }
    .hint-row { --hint-border-color: rgba(255,255,255,0.22); --hint-file-color: #8f9bb3; width: 100%; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; text-align: left; border: 1px solid transparent; border-left: 4px solid var(--hint-border-color); border-bottom-color: rgba(255,255,255,0.07); background: transparent; color: #dce2ef; padding: 8px 10px; font-family: var(--mono); cursor: pointer; }
    .hint-row:last-child { border-bottom-color: transparent; }
    .hint-row:hover { background: rgba(255,255,255,0.06); }
    .hint-row[data-selected-state="true"] { background: rgba(180,141,255,0.10); border-color: rgba(180,141,255,0.34); border-left-color: var(--hint-border-color); }
    .hint-row[data-focused-node="true"] { background: rgba(255,213,79,0.12); border-color: rgba(255,213,79,0.48); border-left-color: var(--hint-border-color); }
    .hint-state-badge { display: inline-block; margin-left: 6px; padding: 1px 5px; border-radius: 999px; border: 1px solid currentColor; color: var(--hint-file-color); font-size: 10px; line-height: 1.2; vertical-align: middle; }
    .hint-state-badge[data-kind="focused"] { color: var(--path); }
    .hint-state-badge[data-kind="selected"] { color: #d4c1ff; }
    .hint-main { min-width: 0; display: grid; gap: 3px; }
    .hint-meta { white-space: pre; }
    .hint-code-line { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 8px; color: var(--muted); font-size: 11px; }
    .hint-code-ln { color: var(--path); }
    .hint-code-src { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .hint-code-src strong { color: #ffffff; background: rgba(255,213,79,0.22); border-radius: 3px; padding: 0 2px; }
    .select-input option { background: #050608; color: #ffffff; }
    .text-input[data-focused="true"] { border-color: var(--focus); box-shadow: 0 0 0 1px var(--focus) inset; }
    .meta { margin-top: 12px; color: var(--muted); font-size: 13px; line-height: 1.45; }
    .mono { font-family: var(--mono); }
    .path-grid { display: grid; gap: 8px; margin-top: 8px; }
    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .checkbox-row { display: flex; gap: 8px; align-items: center; color: var(--muted); font-size: 13px; margin-top: 8px; }
    .checkbox-row label { display: inline-flex; gap: 6px; align-items: center; cursor: pointer; }
    .range-row { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; margin-top: 8px; }
    .range-value { color: var(--muted); font-family: var(--mono); font-size: 12px; min-width: 42px; text-align: right; }
    .inspect { width: 100%; background: transparent; border: 0; padding: 0; color: var(--muted); line-height: 1.45; box-shadow: none; max-height: none; overflow: visible; }
    .inspect strong { color: var(--text); }
    .legend-row { display: flex; gap: 8px; align-items: center; margin-top: 10px; color: var(--muted); font-size: 13px; }
    .swatch { width: 10px; height: 10px; border-radius: 999px; }
    .mainswatch { background: var(--main); }
    .reachswatch { background: var(--reach); }
    .unreachswatch { background: var(--unreach); }
    .outside-swatch { background: var(--outside); }
    .pathswatch { background: var(--path); }
    .status-box { margin-top: 8px; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--border); background: rgba(255,255,255,0.04); color: var(--muted); font-size: 12px; line-height: 1.45; }
    .snapshot-list { display: grid; gap: 8px; margin-top: 12px; }
    .snapshot-row { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: start; padding: 10px; border: 1px solid var(--border); border-radius: 10px; background: rgba(255,255,255,0.035); color: var(--text); text-align: left; cursor: pointer; }
    .snapshot-row:hover, .snapshot-row[data-selected="true"] { background: rgba(255,255,255,0.07); border-color: rgba(255,255,255,0.24); }
    .snapshot-name { color: var(--text); font-family: var(--mono); font-size: 12px; overflow-wrap: anywhere; }
    .snapshot-meta { color: var(--muted); font-size: 11px; margin-top: 3px; }
    .snapshot-open-btn { white-space: nowrap; padding: 7px 10px; }
    .code-block-wrap { position: relative; max-width: 100%; min-width: 0; }
    .code-copy-btn { position: absolute; top: 14px; right: 8px; z-index: 2; padding: 5px 8px; font-size: 11px; }
    .code-block { margin-top: 8px; max-width: 100%; background: rgba(0,0,0,0.42); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; overflow-x: auto; overflow-y: auto; padding: 12px; padding-right: 58px; font-family: var(--mono); font-size: 12px; line-height: 1.55; white-space: pre; }
    .code-block.with-lines { padding: 0; padding-right: 58px; }
    .code-row { display: grid; grid-template-columns: auto 1fr; min-width: max-content; }
    .code-ln { user-select: none; padding: 0 12px; text-align: right; color: #707070; border-right: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.02); }
    .code-src { display: block; padding: 0 12px; white-space: pre; }
    .code-block.word-wrap { white-space: pre-wrap; overflow-x: hidden; }
    .code-block.word-wrap .code-row { min-width: 0; }
    .code-block.word-wrap .code-src { white-space: pre-wrap; overflow-wrap: anywhere; }
    .path-list { display: grid; gap: 8px; margin-top: 12px; }
    .path-found-list { display:flex; gap:8px; overflow:auto; padding-bottom:2px; margin-top:8px; }
    .path-pill { white-space: nowrap; padding: 6px 10px; font-size: 12px; }
    .path-item { width: 100%; text-align: left; display: grid; grid-template-columns: 32px 1fr; gap: 10px; align-items: start; padding: 10px; border-radius: 12px; border: 1px solid var(--border); background: rgba(255,255,255,0.04); color: var(--text); cursor: pointer; }
    .path-item:hover { background: rgba(255,255,255,0.07); }
    .path-item[data-selected="true"] { background: rgba(0,0,0,0.92); border-color: rgba(255,255,255,0.22); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06), 0 8px 24px rgba(0,0,0,0.28); }
    .path-item:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
    .path-step { color: var(--path); font-family: var(--mono); }
    .path-step-toggle { display:inline-flex; align-items:center; justify-content:center; width:24px; height:24px; border-radius:8px; border:1px solid rgba(255,255,255,0.18); cursor:pointer; }
    .path-step-toggle[data-included="true"] { background: rgba(255,213,79,0.2); border-color: var(--path); }
    .path-main { display: grid; gap: 4px; }
    .path-label { font-size: 13px; color: #ffffff; }
    .path-file { font-size: 11px; color: var(--muted); }
    .path-entity-meta { font-size: 11px; color: var(--muted); }
    .selection-accent { display: inline-flex; align-items: center; gap: 8px; }
    .selection-dot { width: 8px; height: 8px; border-radius: 999px; flex: 0 0 auto; }
    .path-empty { color: var(--muted); font-size: 13px; }
    .path-code-view { display: grid; gap: 10px; margin-top: 12px; min-width: 0; }
    .path-code-view > div { min-width: 0; }
    .path-code-file { margin: 0; color: #d0d8e8; font-family: var(--mono); font-size: 12px; }
    .selected-item { position: relative; padding-right: 120px; }
    .selected-remove-btn { position:absolute; right:10px; top:10px; padding:6px 10px; }
    .mutation-hints { display: grid; gap: 8px; margin-top: 10px; }
    .mutation-hint { border: 1px solid var(--border); border-radius: 12px; background: rgba(255,255,255,0.035); padding: 10px; }
    .mutation-hint-title { color: var(--muted); font-size: 12px; margin-bottom: 8px; }
    .mutation-hint-list { display: grid; gap: 6px; max-height: 220px; overflow: auto; }
    .mutation-hint-row { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: baseline; font-family: var(--mono); font-size: 12px; color: #dce2ef; }
    .mutation-hint-empty { color: var(--muted); font-size: 12px; }
    .bulk-preview { margin-top: 10px; border: 1px solid var(--border); border-radius: 12px; background: rgba(0,0,0,0.28); overflow: hidden; }
    .bulk-preview-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 9px 10px; border-bottom: 1px solid rgba(255,255,255,0.08); color: var(--muted); font-size: 12px; }
    .bulk-annotated-text { max-height: 280px; overflow: auto; padding: 12px; color: #dce2ef; font-size: 13px; line-height: 1.55; }
    .bulk-annotated-text[data-render-mode="raw"] { white-space: pre-wrap; font-family: var(--mono); overflow-wrap: anywhere; }
    .bulk-annotated-text[data-render-mode="markdown"] { font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    .bulk-annotated-text h1, .bulk-annotated-text h2, .bulk-annotated-text h3 { margin: 8px 0; }
    .bulk-annotated-text p { margin: 0 0 8px; color: #dce2ef; }
    .bulk-annotated-text ul, .bulk-annotated-text ol { margin: 0 0 8px 20px; padding: 0; }
    .bulk-annotated-text blockquote { margin: 0 0 8px; padding-left: 10px; border-left: 2px solid var(--border); color: var(--muted); }
    .bulk-annotated-text pre { margin: 0 0 8px; padding: 10px; border-radius: 10px; background: rgba(0,0,0,0.38); overflow: auto; }
    .bulk-match-token { display: inline-flex; align-items: center; gap: 4px; margin: 0 1px; border-radius: 6px; border: 1px solid var(--path); color: #081014; background: var(--path); padding: 0 4px; font-family: var(--mono); font-size: 0.95em; cursor: pointer; animation: bulkMatchPulse 1.35s ease-out 1; }
    .bulk-match-token[data-enabled="false"] { color: var(--path); background: transparent; border-style: dashed; }
    .bulk-match-node { color: inherit; opacity: 0.74; font-size: 0.82em; }
    .bulk-match-options { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
    .bulk-match-options label { display: grid; gap: 4px; color: var(--muted); font-size: 12px; }
    .bulk-match-options select { width: 100%; }
    .bulk-progress { display: grid; gap: 5px; margin-top: 8px; }
    .bulk-progress-track { height: 7px; overflow: hidden; border-radius: 999px; border: 1px solid rgba(255,255,255,0.10); background: rgba(255,255,255,0.06); }
    .bulk-progress-bar { width: 0%; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--path), var(--accent)); transition: width 120ms ease; }
    .bulk-progress-label { color: var(--muted); font-size: 11px; }
    .bulk-match-annotations { margin-top: 10px; border: 1px solid var(--border); border-radius: 12px; background: rgba(255,255,255,0.035); padding: 10px; }
    .bulk-match-title { color: var(--muted); font-size: 12px; margin-bottom: 8px; }
    .bulk-match-list { display: grid; gap: 6px; max-height: 220px; overflow: auto; }
    .bulk-match-row { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: baseline; font-family: var(--mono); font-size: 12px; color: #dce2ef; border: 1px solid transparent; border-radius: 8px; padding: 4px 6px; }
    .bulk-match-row[data-enabled="false"] { border-color: var(--path); background: transparent; opacity: 0.78; }
    .bulk-match-row mark { color: #081014; background: var(--path); border: 1px solid var(--path); border-radius: 4px; padding: 1px 4px; animation: bulkMatchPulse 1.35s ease-out 1; }
    .bulk-match-row[data-enabled="false"] mark { color: var(--path); background: transparent; border-style: dashed; }
    .bulk-match-toggle { padding: 3px 7px; border-radius: 999px; font-size: 11px; }
    @keyframes bulkMatchPulse { 0% { box-shadow: 0 0 0 0 rgba(255,213,79,0.55); } 70% { box-shadow: 0 0 0 8px rgba(255,213,79,0); } 100% { box-shadow: 0 0 0 0 rgba(255,213,79,0); } }
    [hidden] { display: none !important; }
    .app[data-sidebar-collapsed="true"] .right-pane-wrap { width: 56px !important; height: 56px !important; }
    .app[data-sidebar-collapsed="true"] .right-pane-resize-corner { display: none; }
    .app[data-sidebar-collapsed="true"] .right-pane { overflow: hidden; padding: 12px; }
    .app[data-sidebar-collapsed="true"] .tab-row, .app[data-sidebar-collapsed="true"] .sidebar-content, .app[data-sidebar-collapsed="true"] h1, .app[data-sidebar-collapsed="true"] p, .app[data-sidebar-collapsed="true"] .chips { display: none; }
    .app[data-sidebar-collapsed="true"] .topbar { justify-content: center; margin-bottom: 0; }
    .app[data-sidebar-collapsed="true"] .topbar .row { width: 100%; justify-content: center; }
    .arrow-btn { width: 32px; height: 32px; padding: 0; display: inline-flex; align-items: center; justify-content: center; font-size: 18px; }
    .token.comment, .token.prolog, .token.doctype, .token.cdata { color: #6a9955; }
    .token.punctuation { color: #d4d4d4; }
    .token.namespace { opacity: 0.7; }
    .token.property, .token.tag, .token.boolean, .token.number, .token.constant, .token.symbol, .token.deleted { color: #b5cea8; }
    .token.selector, .token.attr-name, .token.string, .token.char, .token.builtin, .token.inserted { color: #ce9178; }
    .token.operator, .token.entity, .token.url, .language-css .token.string, .style .token.string { color: #d4d4d4; }
    .token.atrule, .token.attr-value, .token.keyword { color: #569cd6; }
    .token.function, .token.class-name { color: #dcdcaa; }
    .token.regex, .token.important, .token.variable { color: #c586c0; }
  </style>
</head>
<body>
  <div id="app-root" class="app" data-sidebar-collapsed="false">
    <main class="stage"><div id="graph-container"></div></main>
    <div id="right-pane-wrap" class="right-pane-wrap">
      <aside id="right-pane" class="right-pane">
        <div class="topbar">
          <h1>Code graph</h1>
          <div class="row"><button id="collapse-sidebar" class="btn arrow-btn" aria-label="Collapse panel" title="Collapse panel">→</button></div>
        </div>
        <p>This viewer combines code inspection, settings, and path exploration in one transparent floating panel. Use the path list like a mini fzf: arrows or Ctrl-J/Ctrl-K move, Enter locks selection.</p>
        <div class="chips">
          <span id="summary-main" class="chip mainchip mono">main: ${graphData.mainKey ?? 'not found'}</span>
          <span class="chip reachchip">used in main component</span>
          <span class="chip unreachchip">dead in main component</span>
          <span class="chip outsidechip">outside main component</span>
          <span id="summary-nodes" class="chip">nodes: ${graphData.nodes.length}</span>
          <span id="summary-files" class="chip">files: ${graphData.files.length}</span>
        </div>
        <div class="tab-row">
          <button class="tab-btn" data-tab-button="code-search" data-active="true">code search</button>
          <button class="tab-btn" data-tab-button="settings" data-active="false">settings</button>
          <button class="tab-btn" data-tab-button="find-path" data-active="false">find path</button>
          <button class="tab-btn" data-tab-button="selected-nodes" data-active="false">selected nodes</button>
          <button class="tab-btn" data-tab-button="bulk-text" data-active="false">bulk text</button>
          <button class="tab-btn" data-tab-button="graphs" data-active="false">graphs</button>
        </div>
        <div class="sidebar-content">
          <section data-tab-panel="code-search">
            <div class="section-card">
              <h2>Code search</h2>
              <input id="search" class="search" placeholder="Search names, files, signatures, code, or file:line (e.g. state:55)" />
              <div class="checkbox-row" aria-label="Search match fields">
                <span>Match by:</span>
                <label><input id="search-match-name" type="checkbox" checked /> name</label>
                <label><input id="search-match-filename" type="checkbox" checked /> filename</label>
                <label><input id="search-match-code" type="checkbox" checked /> code</label>
              </div>
              <datalist id="search-hints"></datalist>
              <div id="search-hints-overlay" class="search-hints-overlay" hidden></div>
              <div class="row" style="margin-top:8px;"><button id="search-add-to-state" class="btn">Add search matches (+0 nodes · 0 lines)</button></div>
              <div id="selection" class="meta">Focus source or sink, then click a node to assign it. The focused field gets the clicked node. After a path appears, focus the list and use arrows or Ctrl-J/Ctrl-K, then Enter.</div>
            </div>
            <div class="section-card">
              <h2>Node info</h2>
              <div id="inspect" class="inspect">Ready.</div>
            </div>
          </section>
          <section data-tab-panel="graphs" hidden>
            <div class="section-card">
              <h2>Graph snapshots</h2>
              <div class="row">
                <select id="graph-snapshot-sort" class="select-input" aria-label="Sort graph snapshots">
                  <option value="time-desc">time newest first</option>
                  <option value="time-asc">time oldest first</option>
                  <option value="name-asc">name A-Z</option>
                  <option value="name-desc">name Z-A</option>
                </select>
                <button id="graph-snapshot-refresh" class="btn">Refresh list</button>
              </div>
              <div id="graph-snapshot-status" class="status-box">Loading snapshots from public/*.json…</div>
              <div id="graph-snapshot-details" class="status-box">Click a graph row to compare it with the currently open graph.</div>
              <div id="graph-snapshot-list" class="snapshot-list"></div>
            </div>
          </section>
          <section data-tab-panel="selected-nodes" hidden>
            <div class="section-card">
              <h2>Selected state</h2>
              <div class="row"><button id="selected-add-node" class="btn">Add selected node</button><button id="selected-add-incoming" class="btn">Add incoming</button><button id="selected-add-outgoing" class="btn">Add outgoing</button></div>
              <div class="row" style="margin-top:8px;"><button id="selected-remove-incoming" class="btn">Remove incoming</button><button id="selected-remove-outgoing" class="btn">Remove outgoing</button></div>
              <div class="row" style="margin-top:8px;"><button id="selected-add-path" class="btn">Add current path</button><button id="selected-remove-path" class="btn">Remove current path</button><button id="selected-copy" class="btn">Copy selected code</button></div>
              <div id="selected-mutation-hints" class="mutation-hints"></div>
              <div id="selected-status" class="status-box">No selected-state nodes yet.</div>
              <div id="selected-list" class="path-list"></div>
              <div id="selected-code-view" class="path-code-view"></div>
            </div>
          </section>
          <section data-tab-panel="bulk-text" hidden>
            <div class="section-card">
              <h2>Bulk text selection</h2>
              <textarea id="bulk-text-input" class="textarea-input" placeholder="Paste text here. Words match node names; log locations like src/main.rs:55 can also match by filename."></textarea>
              <div class="bulk-match-options">
                <label for="bulk-name-match-mode">Node names
                  <select id="bulk-name-match-mode" class="input">
                    <option value="full" selected>Full name</option>
                    <option value="fuzzy">Fuzzy / previous</option>
                    <option value="none">None</option>
                  </select>
                </label>
                <label for="bulk-filename-match-mode">Filenames
                  <select id="bulk-filename-match-mode" class="input">
                    <option value="full" selected>Full filename</option>
                    <option value="fuzzy">Fuzzy / previous</option>
                    <option value="none">None</option>
                  </select>
                </label>
              </div>
              <div class="checkbox-row"><input id="bulk-render-markdown" type="checkbox" /><label for="bulk-render-markdown">Render bulk text preview as markdown</label></div>
              <div id="bulk-progress" class="bulk-progress" hidden><div class="bulk-progress-track" role="progressbar" aria-label="Bulk text match progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div id="bulk-progress-bar" class="bulk-progress-bar"></div></div><div id="bulk-progress-label" class="bulk-progress-label">Waiting to match text…</div></div>
              <div class="bulk-preview"><div class="bulk-preview-title"><span>Annotated bulk text</span><span>Click a highlighted part to include/exclude it</span></div><div id="bulk-annotated-text" class="bulk-annotated-text" data-render-mode="raw"><div class="mutation-hint-empty">Paste text to preview matched parts.</div></div></div>
              <div class="row" style="margin-top:8px;"><button id="bulk-add" class="btn">Add text nodes (+0 nodes · 0 lines)</button><button id="bulk-remove" class="btn">Remove text nodes (-0 nodes · 0 lines)</button></div>
              <div id="bulk-status" class="status-box">No text nodes resolved yet.</div>
              <div id="bulk-match-annotations" class="bulk-match-annotations"><div class="mutation-hint-empty">No matched text parts yet.</div></div>
              <div class="mutation-hints"><div id="bulk-add-hints"></div><div id="bulk-remove-hints"></div></div>
            </div>
          </section>
          <section data-tab-panel="settings" hidden>
            <div class="section-card">
              <h2>Main component</h2>
              <select id="main-source-select" class="select-input"></select>
              <div class="row" style="margin-top:8px;">
                <button id="recompute-main" class="btn">Use selected source</button>
                <button id="main-component-focus" class="btn" data-active="false">Main component target: OFF</button>
              </div>
              <div class="meta">When main component target is on, clicking a node in the graph sets that node as the root for live/dead component analysis.</div>
            </div>
            <div class="section-card">
              <h2>View settings</h2>
              <div class="checkbox-row"><input id="line-numbers-toggle" type="checkbox" /><label for="line-numbers-toggle">Show line numbers in source view</label></div>
              <div class="checkbox-row"><input id="word-wrap-toggle" type="checkbox" /><label for="word-wrap-toggle">Word wrap code views</label></div>
              <div class="checkbox-row"><input id="render-edge-direction-toggle" type="checkbox" /><label for="render-edge-direction-toggle">Render edge direction</label></div>
              <h3>Layout</h3>
              <select id="layout-mode" class="select-input"><option value="columns">columns</option><option value="forceatlas2">forceatlas2</option></select>
              <h3>Transparency</h3>
              <div class="range-row"><input id="pane-transparency" class="range-input" type="range" min="0.10" max="0.95" step="0.05" value="${paneTransparency}" /><span id="pane-transparency-value" class="range-value">${paneTransparency.toFixed(2)}</span></div>
            </div>
            <div class="section-card">
              <h2>Node sizing</h2>
              <select id="node-size-mode" class="select-input"><option value="status">status based</option><option value="code">scale by code size</option></select>
              <div class="range-row"><input id="node-size-base" class="range-input" type="range" min="6" max="24" step="1" value="11" /><span id="node-size-base-value" class="range-value">11</span></div>
              <div class="range-row"><input id="node-size-code-factor" class="range-input" type="range" min="0.005" max="0.100" step="0.005" value="0.015" /><span id="node-size-code-factor-value" class="range-value">0.015</span></div>
            </div>
            <div class="section-card">
              <h2>Legend</h2>
              <div class="legend-row"><span class="swatch mainswatch"></span> entrypoint</div>
              <div class="legend-row"><span class="swatch reachswatch"></span> used in main component</div>
              <div class="legend-row"><span class="swatch unreachswatch"></span> dead in main component</div>
              <div class="legend-row"><span class="swatch outside-swatch"></span> outside main component</div>
              <div class="legend-row"><span class="swatch pathswatch"></span> current path</div>
            </div>
          </section>
          <section data-tab-panel="find-path" hidden>
            <div class="section-card">
              <h2>Find path</h2>
              <div class="path-grid">
                <input id="path-from" class="text-input" data-focused="true" placeholder="Source node key or exact label" />
                <input id="path-to" class="text-input" data-focused="false" placeholder="Sink node key or exact label" />
                <div class="checkbox-row"><input id="directed-toggle" type="checkbox" checked /><label for="directed-toggle">Apply edge directions</label></div>
                <div class="row"><button id="path-go" class="btn">Find path</button><button id="path-reverse" class="btn">Reverse</button><button id="path-clear" class="btn">Clear</button></div>
                <div id="path-status" class="status-box">No path selected.</div>
                <div id="path-selection-summary" class="status-box">Selected: 0 nodes · 0 total lines.</div>
                <div id="path-found-list" class="path-found-list"></div>
                <div class="row"><button id="path-copy-selected" class="btn">Copy selected code blocks</button></div>
                <div id="path-list" class="path-list"></div>
                <div id="path-code-view" class="path-code-view"></div>
              </div>
            </div>
          </section>
        </div>
      </aside>
      <div id="right-pane-resize-corner" class="right-pane-resize-corner" aria-hidden="true"></div>
    </div>
  </div>
  <script>window.__BOOTSTRAP__ = ${JSON.stringify(bootstrap)};</script>
  <script type="module">
${clientCode}
  </script>
</body>
</html>`;
}
