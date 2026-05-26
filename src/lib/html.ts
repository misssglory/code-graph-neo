import type { GraphData } from './types.ts';
import { clientCode } from './client.ts';

export function renderHtml(graphData: GraphData): string {
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
      --panel: rgba(8, 10, 14, 0.58);
      --panel-2: rgba(14, 17, 23, 0.48);
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
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: radial-gradient(circle at top left, rgba(69,95,120,0.12), transparent 32%), #000; color: var(--text); font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    .app { display: grid; grid-template-columns: 420px 1fr 340px; min-height: 100vh; }
    .sidebar, .pathbar { background: var(--panel); border-right: 1px solid var(--border); padding: 16px; overflow: auto; backdrop-filter: blur(16px); }
    .pathbar { border-right: 0; border-left: 1px solid var(--border); }
    .stage { position: relative; min-height: 100vh; }
    h1 { margin: 0 0 8px; font-size: 20px; }
    h2 { margin: 18px 0 8px; font-size: 14px; color: var(--text); }
    h3 { margin: 16px 0 8px; font-size: 13px; color: var(--text); }
    p { color: var(--muted); line-height: 1.5; }
    .section-card { background: var(--panel-2); border: 1px solid var(--border); border-radius: 14px; padding: 12px; margin-top: 12px; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0; }
    .chip { padding: 5px 9px; border-radius: 999px; border: 1px solid var(--border); background: rgba(255,255,255,0.04); font-size: 12px; }
    .mainchip { color: var(--main); }
    .reachchip { color: var(--reach); }
    .unreachchip { color: var(--unreach); }
    .outsidechip { color: var(--outside); }
    .search, .text-input, .select-input, .range-input {
      width: 100%; padding: 10px 12px; border-radius: 10px; background: rgba(255,255,255,0.04); border: 1px solid var(--border); color: var(--text); font-family: var(--mono);
    }
    .text-input[data-focused="true"] { border-color: var(--focus); box-shadow: 0 0 0 1px var(--focus) inset; }
    .meta { margin-top: 12px; color: var(--muted); font-size: 13px; line-height: 1.45; }
    .mono { font-family: var(--mono); }
    .path-grid { display: grid; gap: 8px; margin-top: 8px; }
    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .btn { padding: 10px 12px; border-radius: 10px; border: 1px solid var(--border); background: rgba(255,255,255,0.05); color: var(--text); cursor: pointer; }
    .btn:hover { background: rgba(255,255,255,0.08); }
    .checkbox-row { display: flex; gap: 8px; align-items: center; color: var(--muted); font-size: 13px; margin-top: 8px; }
    .range-row { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; margin-top: 8px; }
    .range-value { color: var(--muted); font-family: var(--mono); font-size: 12px; min-width: 42px; text-align: right; }
    #graph-container { position: absolute; inset: 0; }
    .inspect {
      position: absolute;
      right: 16px;
      top: 16px;
      width: min(720px, calc(100% - 32px));
      background: rgba(12, 14, 18, 0.58);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 12px 14px;
      color: var(--muted);
      line-height: 1.45;
      backdrop-filter: blur(18px);
      box-shadow: 0 12px 30px rgba(0,0,0,0.25);
      max-height: calc(100vh - 32px);
      overflow: auto;
    }
    .inspect strong { color: var(--text); }
    .legend-row { display: flex; gap: 8px; align-items: center; margin-top: 10px; color: var(--muted); font-size: 13px; }
    .swatch { width: 10px; height: 10px; border-radius: 999px; }
    .mainswatch { background: var(--main); }
    .reachswatch { background: var(--reach); }
    .unreachswatch { background: var(--unreach); }
    .outside-swatch { background: var(--outside); }
    .pathswatch { background: var(--path); }
    .status-box { margin-top: 8px; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--border); background: rgba(255,255,255,0.04); color: var(--muted); font-size: 12px; line-height: 1.45; }
    .code-block {
      margin-top: 8px; background: rgba(0,0,0,0.42); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; overflow: auto; padding: 12px;
      font-family: var(--mono); font-size: 12px; line-height: 1.55; white-space: pre;
    }
    .code-block code { font-family: var(--mono); }
    .code-block.with-lines { padding: 0; }
    .code-row { display: grid; grid-template-columns: auto 1fr; min-width: max-content; }
    .code-ln { user-select: none; padding: 0 12px; text-align: right; color: #707070; border-right: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.02); }
    .code-src { display: block; padding: 0 12px; white-space: pre; }
    .path-list { display: grid; gap: 8px; margin-top: 12px; }
    .path-item {
      width: 100%; text-align: left; display: grid; grid-template-columns: 32px 1fr; gap: 10px; align-items: start; padding: 10px;
      border-radius: 12px; border: 1px solid var(--border); background: rgba(255,255,255,0.04); color: var(--text); cursor: pointer;
    }
    .path-item:hover { background: rgba(255,255,255,0.07); }
    .path-step { color: var(--path); font-family: var(--mono); }
    .path-main { display: grid; gap: 4px; }
    .path-label { font-size: 13px; }
    .path-file { font-size: 11px; color: var(--muted); }
    .path-empty { color: var(--muted); font-size: 13px; }
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
  <div class="app">
    <aside class="sidebar">
      <h1>Code graph</h1>
      <p>This viewer renders the exported graph, computes used and dead code inside the selected main component, and lets you inspect and route paths through the graph.</p>
      <div class="chips">
        <span class="chip mainchip mono">main: ${graphData.mainKey ?? 'not found'}</span>
        <span class="chip reachchip">used in main component</span>
        <span class="chip unreachchip">dead in main component</span>
        <span class="chip outsidechip">outside main component</span>
        <span class="chip">nodes: ${graphData.nodes.length}</span>
        <span class="chip">files: ${graphData.files.length}</span>
      </div>
      <input id="search" class="search" placeholder="Search labels, files, signatures, or code" />

      <div class="section-card">
        <h2>Path finder</h2>
        <div class="path-grid">
          <input id="path-from" class="text-input" data-focused="true" placeholder="Source node key or exact label" />
          <input id="path-to" class="text-input" data-focused="false" placeholder="Sink node key or exact label" />
          <div class="checkbox-row">
            <input id="directed-toggle" type="checkbox" checked />
            <label for="directed-toggle">Apply edge directions</label>
          </div>
          <div class="row">
            <button id="path-go" class="btn">Find path</button>
            <button id="path-reverse" class="btn">Reverse</button>
            <button id="path-clear" class="btn">Clear</button>
          </div>
          <div id="path-status" class="status-box">No path selected.</div>
        </div>
      </div>

      <div class="section-card">
        <h2>Main component</h2>
        <select id="main-source-select" class="select-input"></select>
        <div class="row" style="margin-top:8px;">
          <button id="recompute-main" class="btn">Use as main source</button>
        </div>
      </div>

      <div class="section-card">
        <h2>View settings</h2>
        <div class="checkbox-row">
          <input id="line-numbers-toggle" type="checkbox" />
          <label for="line-numbers-toggle">Show line numbers in source view</label>
        </div>
        <h3>Layout</h3>
        <select id="layout-mode" class="select-input">
          <option value="columns">columns</option>
          <option value="forceatlas2">forceatlas2</option>
        </select>
      </div>

      <div class="section-card">
        <h2>Node sizing</h2>
        <select id="node-size-mode" class="select-input">
          <option value="status">status based</option>
          <option value="code">scale by code size</option>
        </select>
        <div class="range-row">
          <input id="node-size-base" class="range-input" type="range" min="6" max="24" step="1" value="11" />
          <span id="node-size-base-value" class="range-value">11</span>
        </div>
        <div class="range-row">
          <input id="node-size-code-factor" class="range-input" type="range" min="0.005" max="0.100" step="0.005" value="0.015" />
          <span id="node-size-code-factor-value" class="range-value">0.015</span>
        </div>
      </div>

      <div class="legend-row"><span class="swatch mainswatch"></span> entrypoint</div>
      <div class="legend-row"><span class="swatch reachswatch"></span> used in main component</div>
      <div class="legend-row"><span class="swatch unreachswatch"></span> dead in main component</div>
      <div class="legend-row"><span class="swatch outside-swatch"></span> outside main component</div>
      <div class="legend-row"><span class="swatch pathswatch"></span> current path</div>
      <div id="selection" class="meta">Focus source or sink, then click a node to assign it. The focused field gets the clicked node.</div>
    </aside>
    <main class="stage">
      <div id="graph-container"></div>
      <div id="inspect" class="inspect">Ready.</div>
    </main>
    <aside class="pathbar">
      <h2>Found path</h2>
      <div id="path-list" class="path-list"></div>
    </aside>
  </div>
  <script>window.__GRAPH__ = ${JSON.stringify(graphData)};</script>
  <script type="module">
${clientCode}
  </script>
</body>
</html>`;
}
