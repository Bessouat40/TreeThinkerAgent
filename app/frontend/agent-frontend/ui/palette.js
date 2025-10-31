import { el } from './dom.js';

export function openPalette() {
  el.palette.style.display = 'grid';
  el.paletteSearch?.focus();
}
export function closePalette() {
  el.palette.style.display = 'none';
}

export function bindPalette(runAction) {
  document
    .getElementById('openPalette')
    ?.addEventListener('click', openPalette);
  el.palette.addEventListener('click', (e) => {
    if (e.target === el.palette) closePalette();
  });
  el.paletteList.addEventListener('click', (e) => {
    const cmd = e.target.closest('.cmd');
    if (!cmd) return;
    runAction(cmd.dataset.action);
    closePalette();
  });
}
