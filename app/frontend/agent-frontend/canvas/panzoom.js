import { el } from '../ui/dom.js';

let scale = 1,
  origin = { x: 40, y: 60 },
  isPanning = false,
  panStart = { x: 0, y: 0 };
let onTransform = () => {}; // callback (minimap, density…)

export function getView() {
  return { scale, origin };
}

export function setOnTransform(cb) {
  onTransform = cb;
}

export function applyZoomDensity() {
  document.body.classList.toggle('zoomed-out', scale < 0.9);
  onTransform();
}

export function updateTransform() {
  el.viewport.style.transform = `translate(${origin.x}px,${origin.y}px) scale(${scale})`;
  applyZoomDensity();
}

export function setScale(next, cx, cy) {
  const prev = scale;
  scale = Math.min(2.75, Math.max(0.4, next));
  if (cx != null && cy != null) {
    const rect = el.viewport.getBoundingClientRect();
    const x = cx - rect.left,
      y = cy - rect.top;
    origin.x = x - (x - origin.x) * (scale / prev);
    origin.y = y - (y - origin.y) * (scale / prev);
  }
  updateTransform();
}

export const zoomIn = () =>
  setScale(scale * 1.15, window.innerWidth / 2, window.innerHeight / 2);
export const zoomOut = () =>
  setScale(scale / 1.15, window.innerWidth / 2, window.innerHeight / 2);

export function bindPanZoom() {
  el.viewport.addEventListener('mousedown', (e) => {
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
  updateTransform();
}

export function setOrigin(x, y) {
  origin = { x, y };
  updateTransform();
}
