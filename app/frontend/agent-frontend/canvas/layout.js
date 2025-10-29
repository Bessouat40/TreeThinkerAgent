import { NODE_W, NODE_H, COL_GAP, ROW_GAP } from '../core/constants.js';

function longestPathRanks(nodes) {
  const memo = {},
    visiting = new Set();
  function rank(id) {
    if (memo[id] != null) return memo[id];
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const n = nodes[id];
    if (!n || !n.depends_on || n.depends_on.length === 0) {
      memo[id] = 0;
      visiting.delete(id);
      return 0;
    }
    let r = 0;
    for (const d of n.depends_on) r = Math.max(r, rank(d) + 1);
    memo[id] = r;
    visiting.delete(id);
    return r;
  }
  const out = {};
  for (const id of Object.keys(nodes)) out[id] = rank(id);
  return out;
}

export function buildLayout(state) {
  if (!state?.nodes) return { positions: {}, width: 0, height: 0 };
  const ranks = longestPathRanks(state.nodes);
  const layers = {};
  for (const id of Object.keys(state.nodes)) {
    const r = ranks[id] || 0;
    (layers[r] ??= []).push(id);
  }
  for (const k of Object.keys(layers)) layers[k].sort();

  const positions = {},
    cols = Object.keys(layers)
      .map(Number)
      .sort((a, b) => a - b);
  let maxRows = 0;
  for (const r of cols) {
    const ids = layers[r];
    maxRows = Math.max(maxRows, ids.length);
    ids.forEach((id, i) => {
      positions[id] = { x: r * (NODE_W + COL_GAP), y: i * (NODE_H + ROW_GAP) };
    });
  }
  return {
    positions,
    width: cols.length * (NODE_W + COL_GAP) + 400,
    height: maxRows * (NODE_H + ROW_GAP) + 400,
  };
}

export function withRootRecursive(state, label) {
  const ROOT = '__root__',
    nodes = {},
    hasParent = new Set();
  if (!state?.nodes || Object.keys(state.nodes).length === 0) {
    return {
      nodes: {
        [ROOT]: {
          id: ROOT,
          name: label || 'User Request',
          args: {},
          depends_on: [],
          status: 'done',
        },
      },
      final: null,
      __root__: ROOT,
    };
  }
  for (const node of Object.values(state.nodes))
    for (const dep of node.depends_on || []) hasParent.add(dep);
  for (const [id, node] of Object.entries(state.nodes)) {
    const parent = node.parent;
    const deps = new Set(node.depends_on || []);
    if (parent && state.nodes[parent]) {
      deps.add(parent);
      hasParent.add(id);
    } else if (!deps.size && !hasParent.has(id)) deps.add(ROOT);
    nodes[id] = { ...node, depends_on: Array.from(deps) };
  }
  nodes[ROOT] = {
    id: ROOT,
    name: label || 'User Request',
    args: {},
    depends_on: [],
    status: 'done',
  };
  return { ...state, nodes, __root__: ROOT };
}

export function edgePath(from, to) {
  const x1 = from.x + NODE_W,
    y1 = from.y + NODE_H / 2;
  const x2 = to.x,
    y2 = to.y + NODE_H / 2;
  const dx = Math.max(44, (x2 - x1) * 0.45);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}
