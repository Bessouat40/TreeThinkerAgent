import { el } from '../ui/dom.js';
import { NODE_W, NODE_H } from '../core/constants.js';
import { getView, getViewportSize, setOrigin } from './panzoom.js';

let lastData = {
  nodes: [],
  size: { width: 1000, height: 600 },
  bounds: { minX: 0, minY: 0, width: 1000, height: 600 },
};
let isDragging = false;

function focusFromMinimapEvent(e) {
  const svg = el.minimapSvg;
  if (!svg) return;
  const { nodes, bounds } = lastData;
  if (!nodes.length) return;
  if (!bounds) return;

  const rect = svg.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const nx = (e.clientX - rect.left) / rect.width;
  const ny = (e.clientY - rect.top) / rect.height;
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;

  const clampedX = Math.min(1, Math.max(0, nx));
  const clampedY = Math.min(1, Math.max(0, ny));

  const worldX = bounds.minX + clampedX * bounds.width;
  const worldY = bounds.minY + clampedY * bounds.height;
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

function computeBounds(positions = [], size = { width: 1000, height: 600 }) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of positions) {
    if (!p) continue;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + NODE_W);
    maxY = Math.max(maxY, p.y + NODE_H);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    const fallbackW = Math.max(1, size?.width ?? 1000);
    const fallbackH = Math.max(1, size?.height ?? 600);
    return { minX: 0, minY: 0, width: fallbackW, height: fallbackH };
  }

  const spanW = Math.max(1, maxX - minX);
  const spanH = Math.max(1, maxY - minY);
  const layoutW = Math.max(spanW, size?.width ?? spanW);
  const layoutH = Math.max(spanH, size?.height ?? spanH);
  const padX = Math.max(0, (layoutW - spanW) / 2);
  const padY = Math.max(0, (layoutH - spanH) / 2);

  return {
    minX: minX - padX,
    minY: minY - padY,
    width: spanW + padX * 2,
    height: spanH + padY * 2,
  };
}

export function drawMinimap(
  positions = [],
  size = { width: 1000, height: 600 }
) {
  const bounds = computeBounds(positions, size);
  lastData = { nodes: positions, size, bounds };
  const svg = el.minimapSvg;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const { width, height, minX, minY } = bounds;
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
    const nx = (p.x - minX) * scaleX;
    const ny = (p.y - minY) * scaleY;
    r.setAttribute('x', nx);
    r.setAttribute('y', ny);
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
  const { nodes, bounds } = lastData;
  if (!nodes.length) return;
  if (!bounds) return;

  const old = svg.querySelector('#viewframe');
  if (old) svg.removeChild(old);

  const { scale, origin } = getView();
  const { width, height, minX, minY } = bounds;
  const scaleX = 100 / Math.max(width, 1);
  const scaleY = 60 / Math.max(height, 1);

  const inv = 1 / scale;
  const { width: viewW, height: viewH } = getViewportSize();
  const vw = viewW * inv;
  const vh = viewH * inv;
  const vx = -origin.x * inv - minX,
    vy = -origin.y * inv - minY;

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
