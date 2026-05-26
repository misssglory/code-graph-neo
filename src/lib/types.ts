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

export type NodeRec = {
  key: string;
  label: string;
  path?: string;
  type?: string;
  visibility?: string;
  level?: number;
  calls?: string[];
  range?: NodeRange;
  signature?: string;
  sourceSnippet?: string;
};

export type EdgeRec = {
  source: string;
  target: string;
  type: string;
};

export type GraphMetadata = {
  root?: string;
  timestamp?: string;
  stats?: Record<string, number>;
};

export type GraphData = {
  nodes: NodeRec[];
  edges: EdgeRec[];
  mainKey: string | null;
  reachable: string[];
  unreachable: string[];
  files: SourceFileRecord[];
  metadata?: GraphMetadata;
};
