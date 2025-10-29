import { el } from '../ui/dom.js';
import { getView } from './panzoom.js';

let lastData = { nodes: [], size: { width: 1000, height: 600 } };

export function drawMinimap(
  positions = [],
  size = { width: 1000, height: 600 }
) {
  lastData = { nodes: positions, size };
  const svg = el.minimapSvg;
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

export function drawMinimapFrame() {
  const svg = el.minimapSvg;
  const { nodes, size } = lastData;
  if (!nodes.length) return;

  const old = svg.querySelector('#viewframe');
  if (old) svg.removeChild(old);

  const { scale, origin } = getView();
  const { width, height } = size;
  const scaleX = 100 / Math.max(width, 1);
  const scaleY = 60 / Math.max(height, 1);

  const inv = 1 / scale;
  const vw = window.innerWidth * inv;
  const vh = (window.innerHeight - 160) * inv;
  const vx = -origin.x * inv,
    vy = -origin.y * inv;

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
