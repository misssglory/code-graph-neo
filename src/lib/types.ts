export type SpanBoundary = {
  line: number;
  column: number;
};

export type ByteRange = {
  start: number;
  end: number;
};

export type NodeRange = {
  start: SpanBoundary;
  end: SpanBoundary;
  bytes?: ByteRange;
};

export type SourceFileRecord = {
  path: string;
  absolutePath?: string;
  language: string;
  content?: string;
};

export type GraphKind = 'code' | 'tx';

export type NodeRec = {
  key: string;
  label: string;
  path?: string;
  type?: string;
  category?: string;
  tracked?: boolean;
  visibility?: string;
  level?: number;
  calls?: string[];
  range?: NodeRange;
  signature?: string;
  sourceSnippet?: string;
  txHash?: string;
  amountWei?: string;
  amountEth?: string;
  blockNumber?: number;
  blockTime?: string;
  attributes?: Record<string, unknown>;
};

export type EdgeRec = {
  source: string;
  target: string;
  type: string;
  txHash?: string;
  amountWei?: string;
  amountEth?: string;
  blockNumber?: number;
  transactionIndex?: number;
  blockTime?: string;
  classification?: string;
  attributes?: Record<string, unknown>;
};

export type GraphMetadata = {
  root?: string;
  timestamp?: string;
  stats?: Record<string, number>;
  graphType?: GraphKind;
};

export type GraphData = {
  nodes: NodeRec[];
  edges: EdgeRec[];
  graphType: GraphKind;
  mainKey: string | null;
  reachable: string[];
  unreachable: string[];
  files: SourceFileRecord[];
  metadata?: GraphMetadata;
};
