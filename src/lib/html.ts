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
      --panel: #050505;
      --panel-2: #0b0b0b;
      --text: #ffffff;
      --muted: #d0d0d0;
      --border: #222222;
      --main: #63d7ff;
      --reach: #67db8b;
      --unreach: #ff7e7e;
      --path: #ffd54f;
      --focus: #8ab4ff;
      --outside: #8f9bb3;
      --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    .app { display: grid; grid-template-columns: 400px 1fr; min-height: 100vh; }
    .sidebar { background: var(--panel); border-right: 1px solid var(--border); padding: 16px; overflow: auto; }
    .stage { position: relative; min-height: 100vh; }
    h1 { margin: 0 0 8px; font-size: 20px; }
    h2 { margin: 18px 0 8px; font-size: 14px; color: var(--text); }
    p { color: var(--muted); line-height: 1.5; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0; }
    .chip { padding: 5px 9px; border-radius: 999px; border: 1px solid var(--border); background: var(--panel-2); font-size: 12px; }
    .mainchip { color: var(--main); }
    .reachchip { color: var(--reach); }
    .unreachchip { color: var(--unreach); }
    .outsidechip { color: var(--outside); }
    .search, .text-input {
      width: 100%; padding: 10px 12px; border-radius: 10px; background: var(--panel-2); border: 1px solid var(--border); color: var(--text); font-family: var(--mono);
    }
    .text-input[data-focused="true"] {
      border-color: var(--focus);
      box-shadow: 0 0 0 1px var(--focus) inset;
    }
    .meta { margin-top: 12px; color: var(--muted); font-size: 13px; line-height: 1.45; }
    .mono { font-family: var(--mono); }
    .path-grid { display: grid; gap: 8px; margin-top: 8px; }
    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .btn {
      padding: 10px 12px; border-radius: 10px; border: 1px solid var(--border); background: var(--panel-2); color: var(--text); cursor: pointer;
    }
    .checkbox-row { display: flex; gap: 8px; align-items: center; color: var(--muted); font-size: 13px; margin-top: 8px; }
    #graph-container { position: absolute; inset: 0; }
    .inspect {
      position: absolute;
      right: 16px;
      top: 16px;
      width: min(720px, calc(100% - 32px));
      background: rgba(18, 18, 18, 0.96);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 12px 14px;
      color: var(--muted);
      line-height: 1.45;
      backdrop-filter: blur(10px);
      box-shadow: 0 12px 30px rgba(0,0,0,0.35);
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
    .links { margin-top: 14px; display: flex; gap: 10px; flex-wrap: wrap; }
    .links a { color: #ffffff; text-decoration: none; border-bottom: 1px solid #444; }
    .status-box { margin-top: 8px; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--border); background: var(--panel-2); color: var(--muted); font-size: 12px; line-height: 1.45; }
    .code-block {
      margin-top: 8px;
      background: #050505;
      border: 1px solid #1c1c1c;
      border-radius: 10px;
      overflow: auto;
      padding: 12px;
      font-family: var(--mono);
      font-size: 12px;
      line-height: 1.55;
      white-space: pre;
    }
    .code-block code { font-family: var(--mono); }
    .code-block.with-lines { padding: 0; }
    .code-row {
      display: grid;
      grid-template-columns: auto 1fr;
      min-width: max-content;
    }
    .code-ln {
      user-select: none;
      padding: 0 12px;
      text-align: right;
      color: #707070;
      border-right: 1px solid #1c1c1c;
      background: #080808;
    }
    .code-src {
      display: block;
      padding: 0 12px;
      white-space: pre;
    }
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
      <p>This viewer renders the exported graph, identifies used and dead items inside the undirected component containing <span class="mono">main</span>, and supports code-aware inspection.</p>
      <div class="chips">
        <span class="chip mainchip mono">main: ${graphData.mainKey ?? 'not found'}</span>
        <span class="chip reachchip">used in main component</span>
        <span class="chip unreachchip">dead in main component</span>
        <span class="chip outsidechip">outside main component</span>
        <span class="chip">nodes: ${graphData.nodes.length}</span>
        <span class="chip">files: ${graphData.files.length}</span>
      </div>
      <input id="search" class="search" placeholder="Search labels, files, signatures, or code" />
      <h2>Path finder</h2>
      <div class="path-grid">
        <input id="path-from" class="text-input" data-focused="true" placeholder="Source node key or exact label" />
        <input id="path-to" class="text-input" data-focused="false" placeholder="Sink node key or exact label" />
        <div class="checkbox-row">
          <input id="directed-toggle" type="checkbox" checked />
          <label for="directed-toggle">Apply edge directions</label>
        </div>
        <div class="checkbox-row">
          <input id="line-numbers-toggle" type="checkbox" />
          <label for="line-numbers-toggle">Show line numbers in source view</label>
        </div>
        <div class="row">
          <button id="path-go" class="btn">Find path</button>
          <button id="path-reverse" class="btn">Reverse</button>
          <button id="path-clear" class="btn">Clear</button>
        </div>
        <div id="path-status" class="status-box">No path selected.</div>
      </div>
      <div class="legend-row"><span class="swatch mainswatch"></span> entrypoint</div>
      <div class="legend-row"><span class="swatch reachswatch"></span> used in main component</div>
      <div class="legend-row"><span class="swatch unreachswatch"></span> dead in main component</div>
      <div class="legend-row"><span class="swatch outside-swatch"></span> outside main component</div>
      <div class="legend-row"><span class="swatch pathswatch"></span> current path</div>
      <div class="meta">Layout modes:</div>
      <div class="links">
        <a href="/?layout=columns">columns</a>
        <a href="/?layout=forceatlas2">forceatlas2</a>
      </div>
      <div id="selection" class="meta">Focus source or sink, then click a node to assign it. The focused field gets the clicked node.</div>
    </aside>
    <main class="stage">
      <div id="graph-container"></div>
      <div id="inspect" class="inspect">Ready.</div>
    </main>
  </div>
  <script>window.__GRAPH__ = ${JSON.stringify(graphData)};</script>
  <script type="module">
${clientCode}
  </script>
</body>
</html>`;
}
