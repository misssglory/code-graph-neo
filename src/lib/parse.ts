import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { EdgeRec, GraphData, GraphKind, NodeRec, SourceFileRecord } from './types.ts';

export type GraphParseMode = 'auto' | GraphKind;

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

function attributesOf(record: any): Record<string, unknown> {
  return typeof record?.attributes === 'object' && record.attributes ? record.attributes : {};
}

function deduceGraphKind(rawNodes: any[], rawEdges: any[], metadata: any): GraphKind {
  const explicit = String(metadata?.graphType ?? metadata?.graph_type ?? metadata?.kind ?? '').toLowerCase();
  if (['tx', 'transaction', 'transactions'].includes(explicit)) return 'tx';
  if (['code', 'call', 'calls', 'function'].includes(explicit)) return 'code';

  const txEdge = rawEdges.some((edge) => {
    const attrs = attributesOf(edge);
    const type = String(attrs.type ?? '').toLowerCase();
    return Boolean(attrs.tx_hash || attrs.amount_wei || attrs.amount_eth || attrs.block_number || type.includes('transfer') || type.includes('transaction'));
  });
  if (txEdge) return 'tx';

  const txNode = rawNodes.some((node) => {
    const attrs = attributesOf(node);
    const type = String(attrs.type ?? '').toLowerCase();
    const category = String(attrs.category ?? '').toLowerCase();
    const key = String(node?.key ?? '').toLowerCase();
    return type === 'wallet' || category.includes('wallet') || key.startsWith('wallet::');
  });
  return txNode ? 'tx' : 'code';
}

function compactEthAmount(value: unknown): string | undefined {
  if (value == null) return undefined;
  const text = String(value).trim();
  if (!text) return undefined;
  const numeric = Number(text);
  if (!Number.isFinite(numeric)) return text;
  if (numeric === 0) return '0 ETH';
  if (Math.abs(numeric) >= 1) return numeric.toLocaleString(undefined, { maximumFractionDigits: 4 }) + ' ETH';
  return numeric.toLocaleString(undefined, { maximumSignificantDigits: 4 }) + ' ETH';
}

function buildTxTransferNode(edge: EdgeRec, index: number): NodeRec {
  const amount = compactEthAmount(edge.amountEth ?? edge.attributes?.amount_eth);
  const txHash = String(edge.txHash || edge.attributes?.tx_hash || 'tx-' + index);
  const shortHash = txHash.length > 18 ? txHash.slice(0, 10) + '…' + txHash.slice(-6) : txHash;
  const label = amount ? amount : shortHash;
  return {
    key: `tx-transfer::${index}::${txHash}`,
    label,
    type: 'tx_transfer',
    category: 'transfer_amount',
    txHash,
    amountEth: amount ? String(edge.amountEth ?? edge.attributes?.amount_eth) : undefined,
    amountWei: edge.amountWei ?? (edge.attributes?.amount_wei != null ? String(edge.attributes.amount_wei) : undefined),
    blockNumber: edge.blockNumber,
    blockTime: edge.blockTime,
    attributes: {
      tx_hash: txHash,
      amount_eth: edge.amountEth ?? edge.attributes?.amount_eth,
      amount_wei: edge.amountWei ?? edge.attributes?.amount_wei,
      block_number: edge.blockNumber ?? edge.attributes?.block_number,
      block_time: edge.blockTime ?? edge.attributes?.block_time,
      classification: edge.classification ?? edge.attributes?.classification,
      transfer_edge_type: edge.type,
    },
  };
}

function materializeTxAmountNodes(nodes: NodeRec[], edges: EdgeRec[]): { nodes: NodeRec[]; edges: EdgeRec[] } {
  const nextNodes = [...nodes];
  const nextEdges: EdgeRec[] = [];
  edges.forEach((edge, index) => {
    const txNode = buildTxTransferNode(edge, index);
    nextNodes.push(txNode);
    const baseAttrs = { ...(edge.attributes || {}) };
    nextEdges.push({
      source: edge.source,
      target: txNode.key,
      type: edge.type || 'tx_transfer',
      txHash: edge.txHash,
      amountWei: edge.amountWei,
      amountEth: edge.amountEth,
      blockNumber: edge.blockNumber,
      blockTime: edge.blockTime,
      classification: edge.classification,
      attributes: { ...baseAttrs, direction: 'sender_to_transfer' },
    });
    nextEdges.push({
      source: txNode.key,
      target: edge.target,
      type: edge.type || 'tx_transfer',
      txHash: edge.txHash,
      amountWei: edge.amountWei,
      amountEth: edge.amountEth,
      blockNumber: edge.blockNumber,
      blockTime: edge.blockTime,
      classification: edge.classification,
      attributes: { ...baseAttrs, direction: 'transfer_to_receiver' },
    });
  });
  return { nodes: nextNodes, edges: nextEdges };
}

export function parseStructuredGraph(text: string, mode: GraphParseMode = 'auto'): GraphData {
  const payload = JSON.parse(extractJsonPayload(text));
  const graph = payload.graph ?? payload;
  const rawNodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const rawEdges = Array.isArray(graph.edges) ? graph.edges : [];
  const metadata = payload.metadata ?? graph.metadata ?? {};
  const graphType = mode === 'auto' ? deduceGraphKind(rawNodes, rawEdges, metadata) : mode;

  let nodes: NodeRec[] = rawNodes.map((n: any) => {
    const attrs = attributesOf(n);
    return {
      key: String(n.key),
      label: String(attrs.label ?? n.key),
      path: attrs.path ? String(attrs.path) : undefined,
      type: attrs.type ? String(attrs.type) : undefined,
      category: attrs.category ? String(attrs.category) : undefined,
      tracked: typeof attrs.tracked === 'boolean' ? attrs.tracked : undefined,
      visibility: attrs.visibility ? String(attrs.visibility) : undefined,
      level: typeof attrs.level === 'number' ? attrs.level : undefined,
      calls: Array.isArray(attrs.calls) ? attrs.calls.map((x: any) => String(x)) : [],
      signature: attrs.signature ? String(attrs.signature) : undefined,
      sourceSnippet: attrs.sourceSnippet ? String(attrs.sourceSnippet) : undefined,
      attributes: attrs,
      range: attrs.range
        ? {
            start: {
              line: Number((attrs.range as any).start?.line ?? 0),
              column: Number((attrs.range as any).start?.column ?? 0)
            },
            end: {
              line: Number((attrs.range as any).end?.line ?? 0),
              column: Number((attrs.range as any).end?.column ?? 0)
            },
            bytes: (attrs.range as any).bytes
              ? {
                  start: Number((attrs.range as any).bytes.start ?? 0),
                  end: Number((attrs.range as any).bytes.end ?? 0)
                }
              : undefined
          }
        : undefined
    };
  });

  let edges: EdgeRec[] = rawEdges.map((e: any) => {
    const attrs = attributesOf(e);
    return {
      source: String(e.source),
      target: String(e.target),
      type: String(attrs.type ?? 'unknown'),
      txHash: attrs.tx_hash ? String(attrs.tx_hash) : undefined,
      amountWei: attrs.amount_wei != null ? String(attrs.amount_wei) : undefined,
      amountEth: attrs.amount_eth != null ? String(attrs.amount_eth) : undefined,
      blockNumber: typeof attrs.block_number === 'number' ? attrs.block_number : undefined,
      transactionIndex: typeof attrs.transaction_index === 'number' ? attrs.transaction_index : undefined,
      blockTime: attrs.block_time ? String(attrs.block_time) : undefined,
      classification: attrs.classification ? String(attrs.classification) : undefined,
      attributes: attrs,
    };
  });

  if (graphType === 'tx') {
    ({ nodes, edges } = materializeTxAmountNodes(nodes, edges));
  }

  const traversableEdgeTypes = graphType === 'code' ? new Set(['calls']) : null;
  const nodeKeys = new Set(nodes.map((n) => n.key));
  const mainKey = graphType === 'code'
    ? nodes.find((n) => n.label === 'main')?.key ?? nodes.find((n) => /(^|::)main$/i.test(n.key))?.key ?? null
    : nodes.find((n) => n.tracked)?.key ?? nodes.find((n) => n.type === 'wallet')?.key ?? nodes[0]?.key ?? null;
  const outgoing = new Map<string, string[]>();

  for (const edge of edges) {
    if (traversableEdgeTypes && !traversableEdgeTypes.has(edge.type)) continue;
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

  const root = graphType === 'code' && typeof metadata.root === 'string' ? metadata.root : undefined;
  const files = readSourceFiles(root, nodes);

  return {
    nodes,
    edges,
    graphType,
    mainKey,
    reachable: [...reachable],
    unreachable: nodes.map((n) => n.key).filter((k) => !reachable.has(k)),
    files,
    metadata: {
      root,
      timestamp: typeof metadata.timestamp === 'string' ? metadata.timestamp : undefined,
      stats: typeof metadata.stats === 'object' && metadata.stats ? metadata.stats : undefined,
      graphType
    }
  };
}

export function loadGraphFromDefaultInput(): GraphData {
  const inputPath = process.env.CODEGRAPH_INPUT || join(process.cwd(), 'public', 'graph.json');
  const raw = readFileSync(inputPath, 'utf8');
  return parseStructuredGraph(raw);
}
