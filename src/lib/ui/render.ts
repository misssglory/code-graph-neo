export function escapeHtml(s) {
  return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function renderCodeBlock(Prism, code, startLine = 1, showLineNumbers = false) {
  const highlighted = Prism.highlight(code || '', Prism.languages.rust, 'rust');
  if (!showLineNumbers) return '<pre class="code-block"><code class="language-rust">' + highlighted + '</code></pre>';
  const lines = highlighted.split('\n');
  const rows = lines.map((line, idx) => '<span class="code-row"><span class="code-ln">' + (startLine + idx) + '</span><span class="code-src">' + (line || ' ') + '</span></span>').join('');
  return '<pre class="code-block with-lines"><code class="language-rust">' + rows + '</code></pre>';
}
