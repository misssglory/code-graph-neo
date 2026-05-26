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
    .search, .text-input, .select-input, .range-input { width: 100%; padding: 10px 12px; border-radius: 10px; background: rgba(255,255,255,0.04); border: 1px solid var(--border); color: var(--text); font-family: var(--mono); }
    .select-input option { background: #050608; color: #ffffff; }
    .text-input[data-focused="true"] { border-color: var(--focus); box-shadow: 0 0 0 1px var(--focus) inset; }
    .meta { margin-top: 12px; color: var(--muted); font-size: 13px; line-height: 1.45; }
    .mono { font-family: var(--mono); }
    .path-grid { display: grid; gap: 8px; margin-top: 8px; }
    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .checkbox-row { display: flex; gap: 8px; align-items: center; color: var(--muted); font-size: 13px; margin-top: 8px; }
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
    .code-block { margin-top: 8px; background: rgba(0,0,0,0.42); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; overflow: auto; padding: 12px; font-family: var(--mono); font-size: 12px; line-height: 1.55; white-space: pre; }
    .code-block.with-lines { padding: 0; }
    .code-row { display: grid; grid-template-columns: auto 1fr; min-width: max-content; }
    .code-ln { user-select: none; padding: 0 12px; text-align: right; color: #707070; border-right: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.02); }
    .code-src { display: block; padding: 0 12px; white-space: pre; }
    .path-list { display: grid; gap: 8px; margin-top: 12px; }
    .path-item { width: 100%; text-align: left; display: grid; grid-template-columns: 32px 1fr; gap: 10px; align-items: start; padding: 10px; border-radius: 12px; border: 1px solid var(--border); background: rgba(255,255,255,0.04); color: var(--text); cursor: pointer; }
    .path-item:hover { background: rgba(255,255,255,0.07); }
    .path-item[data-selected="true"] { background: rgba(0,0,0,0.92); border-color: rgba(255,255,255,0.22); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06), 0 8px 24px rgba(0,0,0,0.28); }
    .path-item:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
    .path-step { color: var(--path); font-family: var(--mono); }
    .path-main { display: grid; gap: 4px; }
    .path-label { font-size: 13px; color: #ffffff; }
    .path-file { font-size: 11px; color: var(--muted); }
    .selection-accent { display: inline-flex; align-items: center; gap: 8px; }
    .selection-dot { width: 8px; height: 8px; border-radius: 999px; flex: 0 0 auto; }
    .path-empty { color: var(--muted); font-size: 13px; }
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
          <span class="chip mainchip mono">main: ${graphData.mainKey ?? 'not found'}</span>
          <span class="chip reachchip">used in main component</span>
          <span class="chip unreachchip">dead in main component</span>
          <span class="chip outsidechip">outside main component</span>
          <span class="chip">nodes: ${graphData.nodes.length}</span>
          <span class="chip">files: ${graphData.files.length}</span>
        </div>
        <div class="tab-row">
          <button class="tab-btn" data-tab-button="code-search" data-active="true">code search</button>
          <button class="tab-btn" data-tab-button="settings" data-active="false">settings</button>
          <button class="tab-btn" data-tab-button="find-path" data-active="false">find path</button>
        </div>
        <div class="sidebar-content">
          <section data-tab-panel="code-search">
            <div class="section-card">
              <h2>Code search</h2>
              <input id="search" class="search" placeholder="Search labels, files, signatures, or code" />
              <div id="selection" class="meta">Focus source or sink, then click a node to assign it. The focused field gets the clicked node. After a path appears, focus the list and use arrows or Ctrl-J/Ctrl-K, then Enter.</div>
            </div>
            <div class="section-card">
              <h2>Node info</h2>
              <div id="inspect" class="inspect">Ready.</div>
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
                <div id="path-list" class="path-list"></div>
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
