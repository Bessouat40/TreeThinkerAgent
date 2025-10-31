import { el } from './ui/dom.js';
import { initTabs } from './ui/tabs.js';
import { toast } from './ui/toast.js';
import { bindPalette, openPalette, closePalette } from './ui/palette.js';
import { bindInspector, closeInspector } from './ui/inspector.js';

import {
  bindPanZoom,
  setScale,
  zoomIn,
  zoomOut,
  updateTransform,
  setOnTransform,
} from './canvas/panzoom.js';
import { drawMinimapFrame } from './canvas/minimap.js';
import { render } from './canvas/render.js';
import { runAgent as fetchRun } from './data/backend.js';

const FINAL_PREF_KEY = 'ags:finalDrawer';
function saveFinalPrefs(p) {
  try {
    localStorage.setItem(FINAL_PREF_KEY, JSON.stringify(p));
  } catch {}
}
function loadFinalPrefs() {
  try {
    return JSON.parse(localStorage.getItem(FINAL_PREF_KEY)) || {};
  } catch {
    return {};
  }
}

const finalDrawer = document.getElementById('finalDrawer');
const copyFinalBtn = document.getElementById('copyFinal');

const btnHideFinal =
  document.getElementById('btnHideFinal') ||
  document.getElementById('toggleFinal');
const btnExpandFinal = document.getElementById('btnExpandFinal');
const btnMaxFinal = document.getElementById('btnMaxFinal');

function applyFinalMode(mode) {
  if (!finalDrawer) return;

  finalDrawer.style.removeProperty('height');
  finalDrawer.style.removeProperty('--final-h');

  finalDrawer.classList.remove('collapsed', 'expanded', 'max');
  if (mode === 'collapsed') finalDrawer.classList.add('collapsed');
  if (mode === 'expanded') finalDrawer.classList.add('expanded');
  if (mode === 'max') finalDrawer.classList.add('max');

  finalDrawer.setAttribute('aria-expanded', String(mode !== 'collapsed'));

  if (btnHideFinal)
    btnHideFinal.textContent = mode === 'collapsed' ? 'Show' : 'Hide';
  if (btnExpandFinal)
    btnExpandFinal.textContent = mode === 'expanded' ? 'Normal' : 'Expand';
  if (btnMaxFinal) btnMaxFinal.textContent = mode === 'max' ? 'Normal' : 'Max';

  saveFinalPrefs({ ...loadFinalPrefs(), mode });
}

function getFinalMode() {
  if (!finalDrawer) return 'normal';
  if (finalDrawer.classList.contains('collapsed')) return 'collapsed';
  if (finalDrawer.classList.contains('max')) return 'max';
  if (finalDrawer.classList.contains('expanded')) return 'expanded';
  return 'normal';
}

{
  const prefs = loadFinalPrefs();

  finalDrawer?.style.removeProperty('height');
  finalDrawer?.style.removeProperty('--final-h');

  applyFinalMode(prefs.mode || 'normal');
}

btnHideFinal?.addEventListener('click', () => {
  const m = getFinalMode();
  applyFinalMode(m === 'collapsed' ? 'normal' : 'collapsed');
});

btnExpandFinal?.addEventListener('click', () => {
  const m = getFinalMode();
  applyFinalMode(m === 'expanded' ? 'normal' : 'expanded');
});

btnMaxFinal?.addEventListener('click', () => {
  const m = getFinalMode();
  applyFinalMode(m === 'max' ? 'normal' : 'max');
});

copyFinalBtn?.addEventListener('click', async () => {
  const html = el.finalContent?.innerHTML ?? '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const text = tmp.textContent || '';
  try {
    await navigator.clipboard.writeText(text);
    toast('Final answer copied');
  } catch {
    toast('Unable to copy');
  }
});

initTabs();
bindInspector();
bindPalette(runAction);
bindPanZoom();
setOnTransform(drawMinimapFrame);

el.fitBtn?.addEventListener('click', fitToContent);
el.zoomInBtn?.addEventListener('click', zoomIn);
el.zoomOutBtn?.addEventListener('click', zoomOut);
el.hudFit?.addEventListener('click', fitToContent);
el.hudZoomIn?.addEventListener('click', zoomIn);
el.hudZoomOut?.addEventListener('click', zoomOut);

el.runBtn?.addEventListener('click', runAgent);
el.query?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.shiftKey) {
    e.preventDefault();
    runAgent();
  }
});

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

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j' && !e.shiftKey) {
    e.preventDefault();
    const m = getFinalMode();
    applyFinalMode(m === 'collapsed' ? 'normal' : 'collapsed');
  }
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'j') {
    e.preventDefault();
    const order = ['normal', 'expanded', 'max'];
    const cur = getFinalMode();
    const next = order[(order.indexOf(cur) + 1) % order.length];
    applyFinalMode(next);
  }
});

function runAction(a) {
  const map = {
    newRun: () => {
      el.query.value = '';
      el.query.focus();
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
  el.nodesLayer.innerHTML = '';
  el.edgesSvg.innerHTML = '';
  el.finalContent.textContent = '';
  toast('Canvas cleared');
}
document.getElementById('clearBtn')?.addEventListener('click', clearCanvas);
document.getElementById('newRunBtn')?.addEventListener('click', () => {
  el.query.value = '';
  el.query.focus();
  toast('New run');
});

function fitToContent() {
  const box = el.edgesSvg.getBBox
    ? el.edgesSvg.getBBox()
    : { x: 0, y: 0, width: 1000, height: 600 };
  const pad = 80;
  const vw = window.innerWidth - pad * 2 - 320;
  const vh = window.innerHeight - pad * 2 - 160;
  const sx = vw / (box.width + pad * 2);
  const sy = vh / (box.height + pad * 2);
  const s = Math.max(0.45, Math.min(2.0, Math.min(sx, sy)));
  setScale(s, window.innerWidth / 2, window.innerHeight / 2);
  drawMinimapFrame();
}

async function runAgent() {
  try {
    const data = await fetchRun();
    const leaves = data.reasoning_tree || {};
    if (!Object.keys(leaves).length) {
      el.status.textContent = 'No leaves returned.';
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

    // historique
    const card = document.createElement('div');
    card.className = 'list-item';
    card.innerHTML = `<span>${
      el.query.value || 'Untitled run'
    }</span><span class="meta">${new Date().toLocaleTimeString()}</span>`;
    el.runHistory.prepend(card);

    render({
      nodes,
      final: finalAnswer || data.final || null,
      trace: [],
      root: 'leaf_0',
    });
    fitToContent();
  } catch (e) {
    console.error(e);
    el.status.textContent = 'Error: ' + (e?.message || e);
    toast('Error: ' + (e?.message || e));
  }
}

window.AgentGraphUI = { render, runAgent, fitToContent, updateTransform };
