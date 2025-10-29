import {
  esc,
  pretty,
  short,
  buildLayout,
  withRootRecursive,
  edgePath,
  NODE_W,
  NODE_H,
} from './layout.js';

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

// ------- Pan / Zoom -------
let scale = 1,
  origin = { x: 20, y: 40 },
  isPanning = false,
  panStart = { x: 0, y: 0 };

function updateTransform() {
  viewport.style.transform = `translate(${origin.x}px,${origin.y}px) scale(${scale})`;
}
updateTransform();

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
    const prev = scale;
    scale = Math.min(2.5, Math.max(0.4, scale * (e.deltaY > 0 ? 0.9 : 1.1)));
    const rect = viewport.getBoundingClientRect(),
      cx = e.clientX - rect.left,
      cy = e.clientY - rect.top;
    origin.x = cx - (cx - origin.x) * (scale / prev);
    origin.y = cy - (cy - origin.y) * (scale / prev);
    updateTransform();
  },
  { passive: false }
);

// ------- Render -------
function render(state) {
  if (!state?.nodes || Object.keys(state.nodes).length === 0) {
    statusEl.textContent = 'No nodes to display.';
    nodesLayer.innerHTML = '';
    edgesSvg.innerHTML = '';
    finalContent.textContent = '';
    return;
  }

  const label = (queryEl?.value || 'User Request').trim();
  const view = withRootRecursive(state, label);
  const { positions, width, height } = buildLayout(view);

  // --- Edges ---
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
  ap.setAttribute('fill', '#9ca3af');
  marker.appendChild(ap);
  defs.appendChild(marker);
  edgesSvg.appendChild(defs);

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

  // --- Nodes ---
  nodesLayer.innerHTML = '';
  for (const [id, n] of Object.entries(view.nodes)) {
    const pos = positions[id] || { x: 0, y: 0 };
    const el = document.createElement('div');
    el.className = `node ${n.status}${id === view.__root__ ? ' root' : ''}`;
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;

    // Tools
    const toolsHTML = (n.tool_calls || [])
      .map(
        (t) => `
        <div class="tool">
          <div class="tool-name">🧩 ${esc(t.tool_name)}</div>
          <div class="tool-result">${short(
            t.result || '(no result)',
            200
          )}</div>
        </div>`
      )
      .join('');

    el.innerHTML = `
      <div class="title">${esc(n.name || 'Untitled')}</div>
      <div class="description">${esc(n.description || '(aucun résultat)')}</div>
      ${toolsHTML ? `<div class="tools">${toolsHTML}</div>` : ''}
    `;

    // Expand / Details
    el.addEventListener('click', (e) => {
      if (e.shiftKey) {
        nodeContent.textContent = pretty(n);
        nodePanel.classList.add('open');
      } else {
        el.classList.toggle('expanded');
        statusEl.textContent = `Selected: ${n.name} (${n.status})`;
      }
    });

    nodesLayer.appendChild(el);
  }

  // --- Final answer ---
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

    const leaves = data.reasoning_tree?.leaves || data.leaves;
    if (!leaves || Object.keys(leaves).length === 0) {
      statusEl.textContent = 'No leaves returned.';
      return;
    }

    const nodes = {};
    for (const [leafId, leaf] of Object.entries(leaves)) {
      nodes[leafId] = {
        id: leaf.id,
        name:
          leaf.description?.slice(0, 40) +
          (leaf.description?.length > 40 ? '…' : ''),
        description: leaf.result || '(aucun résultat)',
        depends_on: leaf.parent_leaf ? [leaf.parent_leaf] : [],
        status: 'done',
        tool_calls: leaf.tool_calls || [],
        parent: leaf.parent_leaf,
        children: leaf.child_leaves,
      };
    }

    const finalAnswer = Object.values(leaves).find(
      (l) => l.description === 'Réponse finale'
    )?.result;

    render({
      nodes,
      final: finalAnswer || data.final || null,
      trace: [],
      root: 'leaf_0',
    });
  } catch (e) {
    console.error(e);
    statusEl.textContent = 'Error: ' + (e?.message || e);
  }
}

runBtn.addEventListener('click', runAgent);
closeNode.addEventListener('click', () => nodePanel.classList.remove('open'));
