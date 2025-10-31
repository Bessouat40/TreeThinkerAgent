import { el } from '../ui/dom.js';
import { escHTML, pretty, safeToolText } from '../core/utils.js';
import { buildLayout, withRootRecursive, edgePath } from './layout.js';
import { drawMinimap } from './minimap.js';

export function render(state) {
  if (!state?.nodes || Object.keys(state.nodes).length === 0) {
    el.status.textContent = 'No nodes to display.';
    el.nodesLayer.innerHTML = '';
    el.edgesSvg.innerHTML = '';
    el.finalContent.textContent = '';
    drawMinimap([], { width: 1000, height: 600 });
    return;
  }

  const label = (el.query?.value || 'User Request').trim();
  const view = withRootRecursive(state, label);
  const { positions, width, height } = buildLayout(view);

  // Edges
  el.edgesSvg.innerHTML = '';
  el.edgesSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  el.edgesSvg.setAttribute('width', width);
  el.edgesSvg.setAttribute('height', height);

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
  el.edgesSvg.appendChild(defs);

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
      el.edgesSvg.appendChild(p);
      edgeIndex.set(`${node.id}<-${dep}`, p);
    }
  }

  // Nodes
  el.nodesLayer.innerHTML = '';
  el.nodeList.innerHTML = '';

  for (const [id, n] of Object.entries(view.nodes)) {
    const pos = positions[id] || { x: 0, y: 0 };
    const div = document.createElement('div');
    div.className = `node ${n.status}${id === view.__root__ ? ' root' : ''}`;
    div.style.left = `${pos.x}px`;
    div.style.top = `${pos.y}px`;

    const badge = `${n.children?.length || 0}·${n.tool_calls?.length || 0}`;
    const toolsHTML = (n.tool_calls || [])
      .map(
        (t) => `
      <div class="tool">
        <div class="tool-name">🧩 ${escHTML(t.tool_name)}</div>
        <div class="tool-result">${safeToolText(
          t.result ?? '(no result)',
          220
        )}</div>
      </div>`
      )
      .join('');

    div.innerHTML = `
      <div class="row">
        <span class="dot"></span>
        <div class="title" title="${escHTML(n.name || 'Untitled')}">${escHTML(
      n.name || 'Untitled'
    )}</div>
        <span class="badge" title="children·tools">${badge}</span>
      </div>
      <div class="desc">${escHTML(n.description || '(no result)')}</div>
      ${toolsHTML ? `<div class="tools">${toolsHTML}</div>` : ''}
    `;

    div.addEventListener('mouseenter', () => {
      for (const d of n.depends_on || [])
        edgeIndex.get(`${id}<-${d}`)?.classList.add('active');
    });
    div.addEventListener('mouseleave', () => {
      for (const d of n.depends_on || [])
        edgeIndex.get(`${id}<-${d}`)?.classList.remove('active');
    });
    div.addEventListener('click', () => {
      import('../ui/inspector.js').then((m) => m.openInspectorRich(n));
    });

    el.nodesLayer.appendChild(div);

    // side list
    const li = document.createElement('div');
    li.className = 'list-item';
    li.innerHTML = `<span>${escHTML(n.name || id)}</span><span class="meta">${
      n.status || ''
    }</span>`;
    li.addEventListener('click', () =>
      import('../ui/inspector.js').then((m) => m.openInspector(n))
    );
    el.nodeList.appendChild(li);
  }

  // final
  if (state.final) {
    const raw =
      typeof state.final === 'string'
        ? state.final
        : state.final.answer ?? pretty(state.final);

    // ✅ rendu markdown
    const html = window.marked ? window.marked.parse(raw) : raw;
    el.finalContent.innerHTML = html;

    el.status.textContent = 'Done.';
  } else {
    el.finalContent.textContent = 'No answer yet.';
    el.status.textContent = 'Ready.';
  }

  drawMinimap(Object.values(positions), { width, height });
}
