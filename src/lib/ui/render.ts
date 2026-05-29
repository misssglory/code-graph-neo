export function escapeHtml(s) {
  return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function escapeAttr(s) {
  return escapeHtml(s).replaceAll('\"', '&quot;');
}

export function renderCodeBlock(Prism, code, startLine = 1, showLineNumbers = false, wordWrap = false) {
  const rawCode = code || '';
  const highlighted = Prism.highlight(rawCode, Prism.languages.rust, 'rust');
  const wrapClass = wordWrap ? ' word-wrap' : '';
  const button = '<button class="code-copy-btn btn" type="button" data-copy-code="' + escapeAttr(encodeURIComponent(rawCode)) + '">Copy</button>';
  if (!showLineNumbers) {
    return '<div class="code-block-wrap' + wrapClass + '">' + button + '<pre class="code-block' + wrapClass + '"><code class="language-rust">' + highlighted + '</code></pre></div>';
  }
  const lines = highlighted.split('\n');
  const rows = lines.map((line, idx) => '<span class="code-row"><span class="code-ln">' + (startLine + idx) + '</span><span class="code-src">' + (line || ' ') + '</span></span>').join('');
  return '<div class="code-block-wrap' + wrapClass + '">' + button + '<pre class="code-block with-lines' + wrapClass + '"><code class="language-rust">' + rows + '</code></pre></div>';
}
