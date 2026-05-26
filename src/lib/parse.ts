import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { EdgeRec, GraphData, NodeRec, SourceFileRecord } from './types.ts';

function extractJsonPayload(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('Could not find JSON payload in input file');
  return text.slice(start, end + 1);
}

function readSourceFiles(root: string | undefined, nodes: NodeRec[]): SourceFileRecord[] {
  if (!root) return [];
  const uniquePaths = [...new Set(nodes.map((n) => n.path).filter(Boolean) as string[])];
  const files: SourceFileRecord[] = [];
  for (const relPath of uniquePaths) {
    const absolutePath = resolve(root, relPath);
    try {
      const content = readFileSync(absolutePath, 'utf8');
      files.push({ path: relPath, absolutePath, language: 'rust', content });
    } catch {
      files.push({ path: relPath, absolutePath, language: 'rust' });
    }
  }
  return files;
}

export function parseStructuredGraph(text: string): GraphData {
  const payload = JSON.parse(extractJsonPayload(text));
  const graph = payload.graph ?? payload;
  const rawNodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const rawEdges = Array.isArray(graph.edges) ? graph.edges : [];
  const metadata = payload.metadata ?? {};

  const nodes: NodeRec[] = rawNodes.map((n: any) => ({
    key: String(n.key),
    label: String(n.attributes?.label ?? n.key),
    path: n.attributes?.path ? String(n.attributes.path) : undefined,
    type: n.attributes?.type ? String(n.attributes.type) : undefined,
    visibility: n.attributes?.visibility ? String(n.attributes.visibility) : undefined,
    level: typeof n.attributes?.level === 'number' ? n.attributes.level : undefined,
    calls: Array.isArray(n.attributes?.calls) ? n.attributes.calls.map((x: any) => String(x)) : [],
    signature: n.attributes?.signature ? String(n.attributes.signature) : undefined,
    sourceSnippet: n.attributes?.sourceSnippet ? String(n.attributes.sourceSnippet) : undefined,
    range: n.attributes?.range
      ? {
          start: {
            line: Number(n.attributes.range.start?.line ?? 0),
            column: Number(n.attributes.range.start?.column ?? 0)
          },
          end: {
            line: Number(n.attributes.range.end?.line ?? 0),
            column: Number(n.attributes.range.end?.column ?? 0)
          },
          bytes: n.attributes.range.bytes
            ? {
                start: Number(n.attributes.range.bytes.start ?? 0),
                end: Number(n.attributes.range.bytes.end ?? 0)
              }
            : undefined
        }
      : undefined
  }));

  const edges: EdgeRec[] = rawEdges.map((e: any) => ({
    source: String(e.source),
    target: String(e.target),
    type: String(e.attributes?.type ?? 'unknown')
  }));

  const nodeKeys = new Set(nodes.map((n) => n.key));
  const mainKey = nodes.find((n) => n.label === 'main')?.key ?? nodes.find((n) => /(^|::)main$/i.test(n.key))?.key ?? null;
  const outgoing = new Map<string, string[]>();

  for (const edge of edges) {
    if (edge.type !== 'calls') continue;
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
    outgoing.get(edge.source)!.push(edge.target);
  }

  const reachable = new Set<string>();
  if (mainKey) {
    const stack = [mainKey];
    while (stack.length) {
      const current = stack.pop()!;
      if (reachable.has(current)) continue;
      reachable.add(current);
      for (const next of outgoing.get(current) ?? []) {
        if (nodeKeys.has(next) && !reachable.has(next)) stack.push(next);
      }
    }
  }

  const root = typeof metadata.root === 'string' ? metadata.root : undefined;
  const files = readSourceFiles(root, nodes);

  return {
    nodes,
    edges,
    mainKey,
    reachable: [...reachable],
    unreachable: nodes.map((n) => n.key).filter((k) => !reachable.has(k)),
    files,
    metadata: {
      root,
      timestamp: typeof metadata.timestamp === 'string' ? metadata.timestamp : undefined,
      stats: typeof metadata.stats === 'object' && metadata.stats ? metadata.stats : undefined
    }
  };
}

export function loadGraphFromDefaultInput(): GraphData {
  const inputPath = process.env.CODEGRAPH_INPUT || join(process.cwd(), 'public', 'paste.txt');
  const raw = readFileSync(inputPath, 'utf8');
  return parseStructuredGraph(raw);
}
