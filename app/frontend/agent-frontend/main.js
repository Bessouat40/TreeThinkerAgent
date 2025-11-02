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
  setOrigin,
  getView,
  getViewportSize,
} from './canvas/panzoom.js';
import { drawMinimapFrame, getMinimapState } from './canvas/minimap.js';
import { render } from './canvas/render.js';
import { runAgent as fetchRun } from './data/backend.js';
import { initProviderDefaults } from './ui/defaults.js';
import { NODE_W, NODE_H } from './core/constants.js';

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

const TREE_EXPORT_VERSION = 1;
let lastTreePayload = null;

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

initProviderDefaults(el);

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

el.exportTreeBtn?.addEventListener('click', exportCurrentTree);
el.importTreeBtn?.addEventListener('click', () =>
  el.importTreeInput?.click()
);
el.importTreeInput?.addEventListener('change', handleImportTreeFile);

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

function deriveFinalAnswer(leaves, fallback) {
  if (fallback) return fallback;
  for (const leaf of Object.values(leaves || {})) {
    if (
      leaf &&
      typeof leaf.description === 'string' &&
      leaf.description.toLowerCase() === 'final answer'
    ) {
      if (typeof leaf.result === 'string') return leaf.result;
      if (leaf.result != null) {
        try {
          return JSON.stringify(leaf.result);
        } catch {
          return String(leaf.result);
        }
      }
      if (typeof leaf.summary === 'string') return leaf.summary;
    }
  }
  return null;
}

function normalizeTreePayload(raw, queryOverride) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid payload: expected an object');
  }

  const tree = raw.reasoning_tree;
  if (!tree || typeof tree !== 'object' || Array.isArray(tree)) {
    throw new Error('Payload is missing a reasoning tree');
  }

  const metadataBase =
    raw.metadata && typeof raw.metadata === 'object' ? { ...raw.metadata } : {};
  if (queryOverride !== undefined) {
    metadataBase.query = queryOverride;
  } else if (typeof metadataBase.query !== 'string') {
    metadataBase.query = '';
  }

  return {
    reasoning_tree: tree,
    final_answer: deriveFinalAnswer(tree, raw.final_answer ?? null),
    trace: Array.isArray(raw.trace) ? [...raw.trace] : [],
    metadata: metadataBase,
  };
}

function buildRenderStateFromPayload(payload) {
  const leaves = payload?.reasoning_tree || {};
  const nodes = {};
  for (const [leafId, leaf] of Object.entries(leaves)) {
    if (!leaf || typeof leaf !== 'object') continue;
    const title = leaf.title || leaf.description || 'Untitled';
    const result =
      typeof leaf.result === 'string'
        ? leaf.result
        : leaf.result != null
        ? (() => {
            try {
              return JSON.stringify(leaf.result);
            } catch {
              return String(leaf.result);
            }
          })()
        : typeof leaf.summary === 'string'
        ? leaf.summary
        : '(no result)';

    nodes[leafId] = {
      id: leaf.id || leafId,
      name: String(title).slice(0, 60),
      description: result,
      depends_on: leaf.parent_leaf ? [leaf.parent_leaf] : [],
      status: leaf.status || 'done',
      tool_calls: Array.isArray(leaf.tool_calls) ? leaf.tool_calls : [],
      parent: leaf.parent_leaf ?? null,
      children: Array.isArray(leaf.child_leaves) ? leaf.child_leaves : [],
    };
  }

  return {
    nodes,
    final: payload?.final_answer ?? deriveFinalAnswer(leaves, null),
    trace: Array.isArray(payload?.trace) ? payload.trace : [],
    root: 'leaf_0',
  };
}

function summariseRenderState(state) {
  const nodeCount = Object.keys(state?.nodes || {}).length;
  let edgeCount = 0;
  for (const node of Object.values(state?.nodes || {})) {
    edgeCount += Array.isArray(node.depends_on) ? node.depends_on.length : 0;
  }
  return { nodeCount, edgeCount };
}

function applyTreePayload(payload, { updateQuery = true } = {}) {
  lastTreePayload = {
    reasoning_tree: payload.reasoning_tree,
    final_answer: payload.final_answer ?? null,
    trace: Array.isArray(payload.trace) ? payload.trace : [],
    metadata: { ...(payload.metadata || {}) },
  };

  const renderState = buildRenderStateFromPayload(lastTreePayload);
  const summary = summariseRenderState(renderState);
  lastTreePayload.metadata.node_count = summary.nodeCount;
  lastTreePayload.metadata.edge_count = summary.edgeCount;

  if (
    updateQuery &&
    el.query &&
    typeof lastTreePayload.metadata?.query === 'string'
  ) {
    el.query.value = lastTreePayload.metadata.query;
  }

  render(renderState);
  fitToContent();
  return { renderState, summary };
}

function exportCurrentTree() {
  if (
    !lastTreePayload ||
    !lastTreePayload.reasoning_tree ||
    !Object.keys(lastTreePayload.reasoning_tree).length
  ) {
    toast('Nothing to export yet. Run the agent or import a tree first.');
    return;
  }

  const timestamp = new Date();
  const safeStamp = timestamp.toISOString().replace(/[:.]/g, '-');
  const nodeCount =
    lastTreePayload.metadata?.node_count ??
    Object.keys(lastTreePayload.reasoning_tree || {}).length;
  let edgeCount = lastTreePayload.metadata?.edge_count ?? 0;
  if (!edgeCount) {
    for (const leaf of Object.values(lastTreePayload.reasoning_tree || {})) {
      edgeCount += Array.isArray(leaf?.child_leaves) ? leaf.child_leaves.length : 0;
    }
  }

  const exportPayload = {
    version: TREE_EXPORT_VERSION,
    exported_at: timestamp.toISOString(),
    metadata: {
      ...(lastTreePayload.metadata || {}),
      node_count: nodeCount,
      edge_count: edgeCount,
    },
    reasoning_tree: lastTreePayload.reasoning_tree,
    final_answer: lastTreePayload.final_answer ?? null,
  };
  if (lastTreePayload.trace?.length) {
    exportPayload.trace = lastTreePayload.trace;
  }

  const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `reasoning-tree-${safeStamp}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  el.status.textContent = `Exported ${nodeCount} nodes to reasoning-tree-${safeStamp}.json.`;
  toast('Reasoning tree downloaded');
}

async function handleImportTreeFile(event) {
  const file = event.target?.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const raw = JSON.parse(text);
    const normalized = normalizeTreePayload(raw);
    if (!Object.keys(normalized.reasoning_tree || {}).length) {
      toast('Imported file does not contain any nodes.');
      el.status.textContent = 'Imported file did not include nodes.';
      return;
    }

    const { summary } = applyTreePayload(normalized, { updateQuery: true });
    toast(
      `Imported ${summary.nodeCount} nodes and ${summary.edgeCount} connections from ${file.name}`
    );
    el.status.textContent = `Imported ${summary.nodeCount} nodes from ${file.name}.`;
  } catch (err) {
    console.error(err);
    toast('Failed to import tree. Check the console for details.');
    el.status.textContent = 'Import failed.';
  } finally {
    if (event.target) event.target.value = '';
  }
}

function loadTreeFromData(raw, options = {}) {
  const normalized = normalizeTreePayload(
    raw,
    options.query !== undefined ? options.query : undefined
  );
  if (!Object.keys(normalized.reasoning_tree || {}).length) {
    throw new Error('Provided data does not contain any nodes');
  }
  return applyTreePayload(normalized, {
    updateQuery: options.updateQuery ?? true,
  });
}

function runAction(a) {
  const map = {
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
      document.getElementById('tab-nodes').style.display = 'none';
      document.getElementById('tab-settings').style.display = 'block';
    },
  };
  (map[a] || (() => {}))();
}

function clearCanvas() {
  el.nodesLayer.innerHTML = '';
  el.edgesSvg.innerHTML = '';
  el.finalContent.textContent = 'No answer yet.';
  lastTreePayload = null;
  el.status.textContent = 'Canvas cleared.';
  toast('Canvas cleared');
}
document.getElementById('clearBtn')?.addEventListener('click', clearCanvas);

function fitToContent() {
  const { nodes } = getMinimapState();
  if (!nodes.length) return;

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const node of nodes) {
    if (!node) continue;
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + NODE_W);
    maxY = Math.max(maxY, node.y + NODE_H);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return;

  const boundsWidth = Math.max(1, maxX - minX);
  const boundsHeight = Math.max(1, maxY - minY);

  const { width: viewWidth, height: viewHeight } = getViewportSize();
  const basePad = 80;
  const padX = Math.min(basePad, viewWidth / 4);
  const padY = Math.min(basePad, viewHeight / 4);
  const innerWidth = Math.max(1, viewWidth - padX * 2);
  const innerHeight = Math.max(1, viewHeight - padY * 2);

  const scaleX = innerWidth / boundsWidth;
  const scaleY = innerHeight / boundsHeight;
  const desiredScale = Math.min(scaleX, scaleY);
  setScale(desiredScale);
  const { scale } = getView();

  const originX = padX - scale * minX;
  const originY = padY - scale * minY;
  setOrigin(originX, originY);
}

async function runAgent() {
  try {
    const query = (el.query?.value ?? '').trim();
    const data = await fetchRun();
    const normalized = normalizeTreePayload(data, query);
    if (!Object.keys(normalized.reasoning_tree || {}).length) {
      el.status.textContent = 'No leaves returned.';
      toast('No leaves returned.');
      return;
    }

    const { summary } = applyTreePayload(normalized, { updateQuery: false });
    toast(
      `Run complete — ${summary.nodeCount} nodes and ${summary.edgeCount} connections.`
    );
  } catch (e) {
    console.error(e);
    el.status.textContent = 'Error: ' + (e?.message || e);
    toast('Error: ' + (e?.message || e));
  }
}

window.AgentGraphUI = {
  render,
  runAgent,
  fitToContent,
  updateTransform,
  loadTreeFromData,
  exportCurrentTree,
};
