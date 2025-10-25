export type Point = { x: number; y: number };

export type NodeT = {
  id: string;
  x: number;
  y: number;
  name: string;
  icon?: string;
  color?: 'sky' | 'emerald' | 'amber' | 'rose' | 'violet';
  size?: 'small' | 'medium' | 'large';                      
};


export type EdgeT = {
  id: string;
  fromId: string;
  toId: string;
  label?: string;
};

export type WorldState = {
  panX: number;
  panY: number;
  zoom: number;     // keep = 1 for now, future-proof
  nodes: NodeT[];
  edges: EdgeT[];
  mode: 'idle' | 'add-node' | 'drag-node' | 'connect';
  draggingNodeId?: string | null;
};
