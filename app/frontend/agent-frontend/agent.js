// ------- Mock fallback -------
const STATE_EXAMPLE = {
  nodes: {
    fl1: {
      id: 'fl1',
      name: 'search_flights',
      args: {},
      depends_on: [],
      status: 'done',
      result: { thought: 'searched api', count: 12 },
    },
    lo1: {
      id: 'lo1',
      name: 'search_lodging',
      args: {},
      depends_on: [],
      status: 'done',
    },
    ac1: {
      id: 'ac1',
      name: 'search_activities',
      args: {},
      depends_on: [],
      status: 'done',
    },
    tr1: {
      id: 'tr1',
      name: 'plan_city_transport',
      args: {},
      depends_on: [],
      status: 'done',
    },
    ci1: {
      id: 'ci1',
      name: 'compile_itinerary',
      args: {},
      depends_on: ['fl1', 'lo1', 'ac1', 'tr1'],
      status: 'pending',
    },
  },
  final: null,
};

// ------- DOM -------
const viewport = document.getElementById('viewport');
const nodesLayer = document.getElementById('nodesLayer');
const edgesSvg = document.getElementById('edges');
const runBtn = document.getElementById('runBtn');
const statusEl = document.getElementById('status');
const apiBaseEl = document.getElementById('apiBase');
const queryEl = document.getElementById('query');

const finalContent = document.getElementById('finalContent');
const nodePanel = document.getElementById('nodePanel');
const nodeContent = document.getElementById('nodeContent');
const closeNode = document.getElementById('closeNode');

// ------- Helpers -------
const NODE_W = 240,
  NODE_H = 72,
  COL_GAP = 140,
  ROW_GAP = 26;

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function pretty(obj) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}
function short(obj, max = 120) {
  const s = typeof obj === 'string' ? obj : pretty(obj);
  return s.length > max ? s.slice(0, max) + '…' : s;
}

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

function buildLayout(state) {
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
    width: cols.length * (NODE_W + COL_GAP) + 200,
    height: maxRows * (NODE_H + ROW_GAP) + 200,
  };
}

function withRootRecursive(state, label) {
  const ROOT = '__root__';
  const nodes = {};
  const hasParent = new Set();

  // Détecter les dépendances explicites
  for (const node of Object.values(state.nodes)) {
    for (const dep of node.depends_on || []) {
      hasParent.add(dep);
    }
  }

  // Injecter des dépendances implicites via les champs `parent`
  for (const [id, node] of Object.entries(state.nodes)) {
    const parent = node.parent;
    const deps = new Set(node.depends_on || []);
    if (parent && state.nodes[parent]) {
      deps.add(parent);
      hasParent.add(id);
    } else if (!deps.size && !hasParent.has(id)) {
      deps.add(ROOT);
    }
    nodes[id] = { ...node, depends_on: Array.from(deps) };
  }

  // Ajoute un noeud virtuel racine
  nodes[ROOT] = {
    id: ROOT,
    name: label || 'User Request',
    args: {},
    depends_on: [],
    status: 'done',
  };

  return { ...state, nodes, __root__: ROOT };
}

function edgePath(from, to) {
  const x1 = from.x + NODE_W,
    y1 = from.y + NODE_H / 2;
  const x2 = to.x,
    y2 = to.y + NODE_H / 2;
  const dx = Math.max(40, (x2 - x1) * 0.5);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

// ------- Pan / Zoom -------
let scale = 1,
  origin = { x: 20, y: 40 },
  isPanning = false,
  panStart = { x: 0, y: 0 };
viewport.style.transform = `translate(${origin.x}px,${origin.y}px) scale(${scale})`;
viewport.addEventListener('mousedown', (e) => {
  if (e.target.classList.contains('node')) return;
  isPanning = true;
  panStart = { x: e.clientX - origin.x, y: e.clientY - origin.y };
});
window.addEventListener('mousemove', (e) => {
  if (!isPanning) return;
  origin.x = e.clientX - panStart.x;
  origin.y = e.clientY - panStart.y;
  viewport.style.transform = `translate(${origin.x}px,${origin.y}px) scale(${scale})`;
});
window.addEventListener('mouseup', () => (isPanning = false));
window.addEventListener(
  'wheel',
  (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const prev = scale;
    scale = Math.min(2.5, Math.max(0.4, scale * (e.deltaY > 0 ? 0.9 : 1.1)));
    const rect = viewport.getBoundingClientRect(),
      cx = e.clientX - rect.left,
      cy = e.clientY - rect.top;
    origin.x = cx - (cx - origin.x) * (scale / prev);
    origin.y = cy - (cy - origin.y) * (scale / prev);
    viewport.style.transform = `translate(${origin.x}px,${origin.y}px) scale(${scale})`;
  },
  { passive: false }
);

// ------- Render -------
function render(state) {
  const label = (
    document.getElementById('query')?.value || 'User Request'
  ).trim();
  const view = withRootRecursive(state, label);
  const { positions, width, height } = buildLayout(view);

  edgesSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  edgesSvg.setAttribute('width', width);
  edgesSvg.setAttribute('height', height);
  edgesSvg.innerHTML = '';
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const marker = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'marker'
  );
  marker.setAttribute('id', 'arrow');
  marker.setAttribute('orient', 'auto');
  marker.setAttribute('markerWidth', '10');
  marker.setAttribute('markerHeight', '10');
  marker.setAttribute('refX', '8');
  marker.setAttribute('refY', '3');
  const ap = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  ap.setAttribute('d', 'M0,0 L8,3 L0,6 z');
  ap.setAttribute('fill', '#9ca3af');
  marker.appendChild(ap);
  defs.appendChild(marker);
  edgesSvg.appendChild(defs);

  // edges
  for (const node of Object.values(view.nodes)) {
    for (const dep of node.depends_on || []) {
      const from = positions[dep],
        to = positions[node.id];
      if (!from || !to) continue;
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', edgePath(from, to));
      p.setAttribute('marker-end', 'url(#arrow)');
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', '#9ca3af');
      p.setAttribute('stroke-width', '2');
      p.setAttribute('stroke-dasharray', '6 6');
      p.setAttribute('opacity', '0.9');
      edgesSvg.appendChild(p);
    }
  }

  // nodes
  nodesLayer.innerHTML = '';
  for (const id of Object.keys(view.nodes)) {
    const n = view.nodes[id],
      pos = positions[id] || { x: 0, y: 0 };
    const el = document.createElement('div');
    const root = id === view.__root__;
    el.className = `node ${n.status}${root ? ' root' : ''}`;
    el.style.left = pos.x + 'px';
    el.style.top = pos.y + 'px';
    const fn = n.name; // function name (tool)
    const thought = n.thought || n.result?.thought || n.result?.reasoning || '';
    const argsLine =
      n.args && typeof n.args === 'object'
        ? `args: ${short(n.args)}`
        : 'args: —';
    const resLine =
      n.result != null
        ? `result: ${short(n.result)}`
        : n.error
        ? `error: ${short(n.error)}`
        : 'result: —';

    el.innerHTML = `
      <div class="title">${esc(fn)}</div>
      <div class="status">${root ? 'source' : esc(n.status)}</div>
      <div class="details">
        ${thought ? `thought: ${esc(thought)}\n` : ''}
        ${esc(argsLine)}\n${esc(resLine)}
      </div>
    `;

    // 1 clic = toggle infos inline
    el.addEventListener('click', (e) => {
      if (e.shiftKey) return; // shift+click géré plus bas
      el.classList.toggle('expanded');
      statusEl.textContent = `Selected: ${n.name} (${n.status})`;
    });

    // Shift+clic = ouvrir panneau détails complet
    el.addEventListener('click', (e) => {
      if (!e.shiftKey) return;
      nodeContent.textContent = pretty(n);
      nodePanel.classList.add('open');
    });

    nodesLayer.appendChild(el);
  }

  // final answer toujours visible
  if (state.final) {
    const txt =
      typeof state.final === 'string'
        ? state.final
        : state.final.answer ?? pretty(state.final);
    finalContent.textContent = txt;
    statusEl.textContent = 'Done.';
  } else {
    finalContent.textContent = 'No answer yet.';
    statusEl.textContent = 'Ready.';
  }
}

// ------- Backend -------
async function runAgent() {
  const url = apiBaseEl.value.trim();
  const query = queryEl.value.trim();
  statusEl.textContent = 'Running…';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    render(data);
  } catch (e) {
    console.error(e);
    statusEl.textContent = 'Error: ' + (e?.message || e);
    render(STATE_EXAMPLE);
  }
}

// ------- Init -------
render(STATE_EXAMPLE);
runBtn.addEventListener('click', runAgent);
closeNode.addEventListener('click', () => nodePanel.classList.remove('open'));
