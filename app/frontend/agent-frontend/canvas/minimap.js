import { el } from '../ui/dom.js';
import { getView, getViewportSize, setOrigin } from './panzoom.js';

let lastData = { nodes: [], size: { width: 1000, height: 600 } };
let isDragging = false;

function focusFromMinimapEvent(e) {
  const svg = el.minimapSvg;
  if (!svg) return;
  const { nodes, size } = lastData;
  if (!nodes.length) return;

  const rect = svg.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const nx = (e.clientX - rect.left) / rect.width;
  const ny = (e.clientY - rect.top) / rect.height;
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;

  const clampedX = Math.min(1, Math.max(0, nx));
  const clampedY = Math.min(1, Math.max(0, ny));

  const worldX = clampedX * size.width;
  const worldY = clampedY * size.height;
  const { scale } = getView();
  const { width: viewW, height: viewH } = getViewportSize();

  const originX = viewW / 2 - scale * worldX;
  const originY = viewH / 2 - scale * worldY;
  setOrigin(originX, originY);
}

const svg = el.minimapSvg;
if (svg) {
  svg.addEventListener('pointerdown', (e) => {
    isDragging = true;
    svg.setPointerCapture?.(e.pointerId);
    focusFromMinimapEvent(e);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    focusFromMinimapEvent(e);
  });
  const stop = () => {
    isDragging = false;
  };
  svg.addEventListener('pointerup', stop);
  svg.addEventListener('pointerleave', stop);
  svg.addEventListener('pointercancel', stop);
}

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
  const { width: viewW, height: viewH } = getViewportSize();
  const vw = viewW * inv;
  const vh = viewH * inv;
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

export function getMinimapState() {
  return lastData;
}
