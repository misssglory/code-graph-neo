export type NodeRec = {
  key: string;
  label: string;
  path?: string;
  type?: string;
  visibility?: string;
  level?: number;
  calls?: string[];
};

export type EdgeRec = {
  source: string;
  target: string;
  type: string;
};

export type GraphData = {
  nodes: NodeRec[];
  edges: EdgeRec[];
  mainKey: string | null;
  reachable: string[];
  unreachable: string[];
};