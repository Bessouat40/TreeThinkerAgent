// ======== Small utilities ========
const NODE_W =
  parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--node-w')
  ) || 220;
const NODE_H =
  parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--node-h')
  ) || 64;
const COL_GAP =
  parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--col-gap')
  ) || 120;
const ROW_GAP =
  parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--row-gap')
  ) || 22;

const viewport = document.getElementById('viewport');
const nodesLayer = document.getElementById('nodesLayer');
const edgesSvg = document.getElementById('edges');
const minimapSvg = document.getElementById('minimap');
const runBtn = document.getElementById('runBtn');
const statusEl = document.getElementById('status');
const apiBaseEl = document.getElementById('apiBase');
const queryEl = document.getElementById('query');
const finalContent = document.getElementById('finalContent');
const nodePanel = document.getElementById('nodePanel');
const nodePanelTitle = document.getElementById('nodePanelTitle');
const nodeContent = document.getElementById('nodeContent');
const closeNode = document.getElementById('closeNode');
const fitBtn = document.getElementById('fitBtn');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const hudFit = document.getElementById('hudFit');
const hudZoomIn = document.getElementById('hudZoomIn');
const hudZoomOut = document.getElementById('hudZoomOut');
const runHistoryEl = document.getElementById('runHistory');
const nodeListEl = document.getElementById('nodeList');

// Tabs
document.querySelectorAll('.tab').forEach((t) =>
  t.addEventListener('click', () => {
    document
      .querySelectorAll('.tab')
      .forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    const panels = {
      history: 'tab-history',
      nodes: 'tab-nodes',
      settings: 'tab-settings',
    };
    for (const [k, id] of Object.entries(panels))
      document.getElementById(id).style.display =
        t.dataset.tab === k ? 'block' : 'none';
  })
);

// Toast
const toastBox = document.getElementById('toast');
const toast = (msg) => {
  const el = document.createElement('div');
  el.className = 't';
  el.textContent = msg;
  toastBox.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, 3000);
};

// Pan/Zoom
let scale = 1,
  origin = { x: 40, y: 60 },
  isPanning = false,
  panStart = { x: 0, y: 0 };
function applyZoomDensity() {
  document.body.classList.toggle('zoomed-out', scale < 0.9);
  drawMinimapFrame();
}
function updateTransform() {
  viewport.style.transform = `translate(${origin.x}px,${origin.y}px) scale(${scale})`;
  applyZoomDensity();
}
function setScale(next, cx, cy) {
  const prev = scale;
  scale = Math.min(2.75, Math.max(0.4, next));
  if (cx != null && cy != null) {
    const rect = viewport.getBoundingClientRect();
    const x = cx - rect.left,
      y = cy - rect.top;
    origin.x = x - (x - origin.x) * (scale / prev);
    origin.y = y - (y - origin.y) * (scale / prev);
  }
  updateTransform();
}
function zoomIn() {
  setScale(scale * 1.15, window.innerWidth / 2, window.innerHeight / 2);
}
function zoomOut() {
  setScale(scale / 1.15, window.innerWidth / 2, window.innerHeight / 2);
}
function fitToContent() {
  const box = edgesSvg.getBBox
    ? edgesSvg.getBBox()
    : { x: 0, y: 0, width: 1000, height: 600 };
  const pad = 80;
  const vw = window.innerWidth - pad * 2 - 320;
  const vh = window.innerHeight - pad * 2 - 160;
  const sx = vw / (box.width + pad * 2);
  const sy = vh / (box.height + pad * 2);
  const s = Math.max(0.45, Math.min(2.0, Math.min(sx, sy)));
  scale = s;
  origin = { x: pad - box.x * s + 10, y: 80 + pad - box.y * s };
  updateTransform();
  drawMinimapFrame();
}
viewport.addEventListener('mousedown', (e) => {
  if (e.target.classList.contains('node')) return;
  isPanning = true;
  panStart = { x: e.clientX - origin.x, y: e.clientY - origin.y };
});
window.addEventListener('mousemove', (e) => {
  if (!isPanning) return;
  origin.x = e.clientX - panStart.x;
  origin.y = e.clientY - panStart.y;
  updateTransform();
});
window.addEventListener('mouseup', () => (isPanning = false));
window.addEventListener(
  'wheel',
  (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const next = scale * (e.deltaY > 0 ? 0.9 : 1.1);
    setScale(next, e.clientX, e.clientY);
  },
  { passive: false }
);
zoomInBtn?.addEventListener('click', zoomIn);
zoomOutBtn?.addEventListener('click', zoomOut);
fitBtn?.addEventListener('click', fitToContent);
hudZoomIn?.addEventListener('click', zoomIn);
hudZoomOut?.addEventListener('click', zoomOut);
hudFit?.addEventListener('click', fitToContent);

window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === '+') {
    e.preventDefault();
    zoomIn();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === '-') {
    e.preventDefault();
    zoomOut();
  }
  if (e.key === 'f' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    fitToContent();
  }
  if (e.key === 'Escape') {
    closeInspector();
    closePalette();
  }
  if (e.key === 'Enter' && e.shiftKey) {
    e.preventDefault();
    runAgent();
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openPalette();
  }
});

function escHTML(s) {
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
function shortText(obj, max = 120) {
  const s = typeof obj === 'string' ? obj : pretty(obj);
  return s.length > max ? s.slice(0, max) + '…' : s;
}
function safeToolText(v, max = 220) {
  try {
    if (typeof v === 'object' && v !== null)
      return escHTML(shortText(JSON.stringify(v, null, 2), max));
    return escHTML(shortText(String(v), max));
  } catch {
    return escHTML(shortText(String(v), max));
  }
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
function withRootRecursive(state, label) {
  const ROOT = '__root__';
  const nodes = {};
  const hasParent = new Set();
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
function edgePath(from, to) {
  const x1 = from.x + NODE_W,
    y1 = from.y + NODE_H / 2;
  const x2 = to.x,
    y2 = to.y + NODE_H / 2;
  const dx = Math.max(44, (x2 - x1) * 0.45);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

let lastMinimapData = { nodes: [], size: { width: 1000, height: 600 } };
function drawMinimap(positions = [], size = { width: 1000, height: 600 }) {
  lastMinimapData = { nodes: positions, size };
  const svg = minimapSvg;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const { width, height } = size;
  const scaleX = 100 / Math.max(width, 1);
  const scaleY = 60 / Math.max(height, 1);
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('x', '0');
  bg.setAttribute('y', '0');
  bg.setAttribute('width', '100');
  bg.setAttribute('height', '60');
  bg.setAttribute('fill', '#0b1328');
  svg.appendChild(bg);
  for (const p of positions) {
    const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r.setAttribute('x', p.x * scaleX);
    r.setAttribute('y', p.y * scaleY);
    r.setAttribute('width', 4);
    r.setAttribute('height', 2.2);
    r.setAttribute('rx', 1);
    r.setAttribute('fill', '#5b82c8');
    r.setAttribute('opacity', '0.9');
    svg.appendChild(r);
  }
  drawMinimapFrame();
}
function drawMinimapFrame() {
  const svg = minimapSvg;
  const { nodes, size } = lastMinimapData;
  if (!nodes.length) return;
  const { width, height } = size;
  const scaleX = 100 / Math.max(width, 1);
  const scaleY = 60 / Math.max(height, 1);
  const old = svg.querySelector('#viewframe');
  if (old) svg.removeChild(old);
  const inv = 1 / scale;
  const vw = window.innerWidth * inv;
  const vh = (window.innerHeight - 160) * inv;
  const vx = -origin.x * inv;
  const vy = -origin.y * inv;
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('id', 'viewframe');
  rect.setAttribute('x', vx * scaleX);
  rect.setAttribute('y', vy * scaleY);
  rect.setAttribute('width', vw * scaleX);
  rect.setAttribute('height', vh * scaleY);
  rect.setAttribute('fill', 'none');
  rect.setAttribute('stroke', '#93c5fd');
  rect.setAttribute('stroke-width', '1');
  rect.setAttribute('opacity', '0.9');
  svg.appendChild(rect);
}

function render(state) {
  if (!state?.nodes || Object.keys(state.nodes).length === 0) {
    statusEl.textContent = 'No nodes to display.';
    nodesLayer.innerHTML = '';
    edgesSvg.innerHTML = '';
    finalContent.textContent = '';
    drawMinimap([], { width: 1000, height: 600 });
    return;
  }
  const label = (queryEl?.value || 'User Request').trim();
  const view = withRootRecursive(state, label);
  const { positions, width, height } = buildLayout(view);
  edgesSvg.innerHTML = '';
  edgesSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  edgesSvg.setAttribute('width', width);
  edgesSvg.setAttribute('height', height);
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
  ap.setAttribute('fill', '#5a79b3');
  marker.appendChild(ap);
  defs.appendChild(marker);
  edgesSvg.appendChild(defs);
  const edgeIndex = new Map();
  for (const node of Object.values(view.nodes)) {
    for (const dep of node.depends_on || []) {
      const from = positions[dep],
        to = positions[node.id];
      if (!from || !to) continue;
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', edgePath(from, to));
      p.setAttribute('marker-end', 'url(#arrow)');
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', '#3d527c');
      p.setAttribute('stroke-width', '1.6');
      p.setAttribute('stroke-dasharray', '5 5');
      p.setAttribute('opacity', '.9');
      edgesSvg.appendChild(p);
      edgeIndex.set(`${node.id}<-${dep}`, p);
    }
  }
  nodesLayer.innerHTML = '';
  nodeListEl.innerHTML = '';
  for (const [id, n] of Object.entries(view.nodes)) {
    const pos = positions[id] || { x: 0, y: 0 };
    const el = document.createElement('div');
    el.className = `node ${n.status}${id === view.__root__ ? ' root' : ''}`;
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
    const badge = `${n.children?.length || 0}·${n.tool_calls?.length || 0}`;
    const toolsHTML = (n.tool_calls || [])
      .map(
        (t) =>
          `<div class="tool"><div class="tool-name">🧩 ${escHTML(
            t.tool_name
          )}</div><div class="tool-result">${safeToolText(
            t.result ?? '(no result)',
            220
          )}</div></div>`
      )
      .join('');
    el.innerHTML = `
  <div class="row">
    <span class="dot"></span>
    <div class="title" title="${escHTML(n.name || 'Untitled')}">${escHTML(
      n.name || 'Untitled'
    )}</div>
    <span class="badge" title="children·tools">${badge}</span>
  </div>
  <div class="desc">${escHTML(n.description || '')}</div>
  ${toolsHTML ? `<div class="tools">${toolsHTML}</div>` : ''}
`;
    el.addEventListener('mouseenter', () => {
      for (const dep of n.depends_on || [])
        edgeIndex.get(`${id}<-${dep}`)?.classList.add('active');
    });
    el.addEventListener('mouseleave', () => {
      for (const dep of n.depends_on || [])
        edgeIndex.get(`${id}<-${dep}`)?.classList.remove('active');
    });
    el.addEventListener('click', (e) => {
      if (e.shiftKey) {
        openInspector(n);
      } else {
        el.classList.toggle('expanded');
        statusEl.textContent = `Selected: ${n.name} (${n.status})`;
      }
    });
    nodesLayer.appendChild(el);
    const li = document.createElement('div');
    li.className = 'list-item';
    li.innerHTML = `<span>${escHTML(n.name || id)}</span><span class="meta">${
      n.status || ''
    }</span>`;
    li.addEventListener('click', () => {
      openInspector(n);
    });
    nodeListEl.appendChild(li);
  }
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
  drawMinimap(Object.values(positions), { width, height });
  fitToContent();
}

function openInspector(node) {
  nodePanelTitle.textContent = node.name || 'Node details';
  nodeContent.textContent = pretty(node);
  nodePanel.classList.remove('hidden');
  nodePanel.setAttribute('aria-hidden', 'false');
}
function closeInspector() {
  nodePanel.classList.add('hidden');
  nodePanel.setAttribute('aria-hidden', 'true');
}
closeNode.addEventListener('click', closeInspector);

async function runAgent() {
  const base = (apiBaseEl?.value || 'http://localhost:8000').replace(/\/$/, '');
  const query = (queryEl?.value || '').trim();
  const mode = document.getElementById('runMode').value;
  statusEl.textContent = 'Running…';
  toast('Running agent…');
  try {
    const res = await fetch(`${base}/api/agent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, mode }),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    const leaves = data.reasoning_tree?.leaves || data.leaves;
    if (!leaves || Object.keys(leaves).length === 0) {
      statusEl.textContent = 'No leaves returned.';
      toast('No leaves returned.');
      return;
    }
    const nodes = {};
    for (const [leafId, leaf] of Object.entries(leaves)) {
      nodes[leafId] = {
        id: leaf.id,
        name: (leaf.title || leaf.description || 'Untitled').slice(0, 60),
        description: leaf.result || leaf.summary || '(no result)',
        depends_on: leaf.parent_leaf ? [leaf.parent_leaf] : [],
        status: leaf.status || 'done',
        tool_calls: leaf.tool_calls || [],
        parent: leaf.parent_leaf,
        children: leaf.child_leaves,
      };
    }
    const finalAnswer = Object.values(leaves).find(
      (l) => l.description === 'Final answer'
    )?.result;
    const card = document.createElement('div');
    card.className = 'list-item';
    card.innerHTML = `<span>${escHTML(
      query || 'Untitled run'
    )}</span><span class="meta">${new Date().toLocaleTimeString()}</span>`;
    runHistoryEl.prepend(card);
    render({
      nodes,
      final: finalAnswer || data.final || null,
      trace: [],
      root: 'leaf_0',
    });
  } catch (e) {
    console.error(e);
    statusEl.textContent = 'Error: ' + (e?.message || e);
    toast('Error: ' + (e?.message || e));
  }
}
runBtn.addEventListener('click', runAgent);
queryEl?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.shiftKey) {
    e.preventDefault();
    runAgent();
  }
});

const palette = document.getElementById('palette');
const paletteSearch = document.getElementById('paletteSearch');
const paletteList = document.getElementById('paletteList');
document.getElementById('openPalette')?.addEventListener('click', openPalette);
function openPalette() {
  palette.style.display = 'grid';
  paletteSearch.focus();
}
function closePalette() {
  palette.style.display = 'none';
}
palette.addEventListener('click', (e) => {
  if (e.target === palette) closePalette();
});
paletteList.addEventListener('click', (e) => {
  const el = e.target.closest('.cmd');
  if (!el) return;
  const action = el.dataset.action;
  runAction(action);
  closePalette();
});
function runAction(a) {
  const map = {
    newRun: () => {
      queryEl.value = '';
      queryEl.focus();
    },
    fit: fitToContent,
    zoomIn,
    zoomOut,
    clear: clearCanvas,
    settings: () => {
      document
        .querySelectorAll('.tab')
        .forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tab').forEach((t) => {
        if (t.dataset.tab === 'settings') t.classList.add('active');
      });
      document.getElementById('tab-history').style.display = 'none';
      document.getElementById('tab-nodes').style.display = 'none';
      document.getElementById('tab-settings').style.display = 'block';
    },
  };
  (map[a] || (() => {}))();
}

function clearCanvas() {
  nodesLayer.innerHTML = '';
  edgesSvg.innerHTML = '';
  finalContent.textContent = '';
  toast('Canvas cleared');
}
document.getElementById('clearBtn').addEventListener('click', clearCanvas);
document.getElementById('newRunBtn').addEventListener('click', () => {
  queryEl.value = '';
  queryEl.focus();
  toast('New run');
});

// Expose for console
window.AgentGraphUI = { render, runAgent, fitToContent };
