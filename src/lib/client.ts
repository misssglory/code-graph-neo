import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const baseDir = import.meta.dir;
const uiDir = join(baseDir, 'ui');

function stripImports(code: string): string {
  return code.replace(/^import .*?;$/gm, '').trim();
}

function readUiFile(name: string): string {
  return readFileSync(join(uiDir, name), 'utf8');
}

export const clientCode = String.raw`
import Graph from 'https://esm.sh/graphology@0.26.0';
import Sigma from 'https://esm.sh/sigma@3.0.0';
import forceAtlas2 from 'https://esm.sh/graphology-layout-forceatlas2@0.10.1';
import Prism from 'https://esm.sh/prismjs@1.29.0';
import 'https://esm.sh/prismjs@1.29.0/components/prism-rust';

${stripImports(readUiFile('dom.ts'))}
${stripImports(readUiFile('graph-state.ts'))}
${stripImports(readUiFile('layout.ts'))}
${stripImports(readUiFile('render.ts'))}
${stripImports(readUiFile('app.ts'))}

createApp(window.__BOOTSTRAP__);
`;