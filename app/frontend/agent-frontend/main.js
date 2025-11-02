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
import { streamAgent } from './data/backend.js';
import { initProviderDefaults } from './ui/defaults.js';
import { NODE_W, NODE_H } from './core/constants.js';
import { escHTML, shortText } from './core/utils.js';

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

const LIVE_PREF_KEY = 'ags:livePanel';
function saveLivePrefs(p) {
  try {
    localStorage.setItem(LIVE_PREF_KEY, JSON.stringify(p));
  } catch {}
}
function loadLivePrefs() {
  try {
    return JSON.parse(localStorage.getItem(LIVE_PREF_KEY)) || {};
  } catch {
    return {};
  }
}

let livePrefs = loadLivePrefs();
function updateLivePrefs(patch) {
  livePrefs = { ...livePrefs, ...patch };
  saveLivePrefs(livePrefs);
}

const finalDrawer = document.getElementById('finalDrawer');
const copyFinalBtn = document.getElementById('copyFinal');

const btnHideFinal =
  document.getElementById('btnHideFinal') ||
  document.getElementById('toggleFinal');
const btnExpandFinal = document.getElementById('btnExpandFinal');
const btnMaxFinal = document.getElementById('btnMaxFinal');

const TREE_EXPORT_VERSION = 1;
const MAX_LIVE_EVENTS = 80;
const LIVE_TOGGLE_DEFAULT_LABEL = 'Show live reasoning';
const LIVE_TOGGLE_UPDATES_LABEL = 'Show live reasoning (updates)';
let lastTreePayload = null;
let activeRun = null;
let hasInitialFit = false;
let runCancelled = false;
let finalToastShown = false;
let liveSequence = 0;

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

function isLiveHidden() {
  return el.liveStream?.classList.contains('is-user-hidden') ?? false;
}

function isLiveCollapsed() {
  return el.liveStream?.classList.contains('is-collapsed') ?? false;
}

function clearLiveActivityFlag() {
  if (!el.showLiveBtn) return;
  el.showLiveBtn.classList.remove('has-updates');
  el.showLiveBtn.textContent = LIVE_TOGGLE_DEFAULT_LABEL;
}

function flagLiveActivity() {
  if (!isLiveHidden() || !el.showLiveBtn) return;
  el.showLiveBtn.classList.add('has-updates');
  el.showLiveBtn.textContent = LIVE_TOGGLE_UPDATES_LABEL;
}

function applyLiveHidden(hidden, { persist = false, reveal = true } = {}) {
  if (!el.liveStream) return;

  el.liveStream.classList.toggle('is-user-hidden', hidden);
  if (hidden) {
    clearLiveActivityFlag();
  } else {
    if (reveal) {
      el.liveStream.classList.remove('is-hidden');
    }
    clearLiveActivityFlag();
  }

  const effectiveHidden =
    hidden || el.liveStream.classList.contains('is-hidden');
  el.liveStream.setAttribute('aria-hidden', String(effectiveHidden));

  if (el.showLiveBtn) {
    el.showLiveBtn.classList.toggle('is-hidden', !effectiveHidden);
    el.showLiveBtn.setAttribute('aria-expanded', String(!effectiveHidden));
    el.showLiveBtn.setAttribute('aria-pressed', String(effectiveHidden));
    el.showLiveBtn.setAttribute('title', LIVE_TOGGLE_DEFAULT_LABEL);
  }

  if (persist) updateLivePrefs({ hidden });
}

function applyLiveCollapsed(collapsed, { persist = false } = {}) {
  if (!el.liveStream) return;

  el.liveStream.classList.toggle('is-collapsed', collapsed);
  el.liveStream.setAttribute('aria-expanded', String(!collapsed));

  if (el.collapseLiveBtn) {
    el.collapseLiveBtn.textContent = collapsed ? 'Expand' : 'Collapse';
    el.collapseLiveBtn.setAttribute('aria-pressed', String(collapsed));
    el.collapseLiveBtn.setAttribute(
      'title',
      collapsed ? 'Expand live reasoning' : 'Collapse live reasoning'
    );
  }

  if (persist) updateLivePrefs({ collapsed });
}

applyLiveCollapsed(Boolean(livePrefs.collapsed));
applyLiveHidden(Boolean(livePrefs.hidden), { reveal: false });

el.collapseLiveBtn?.addEventListener('click', () => {
  const next = !isLiveCollapsed();
  applyLiveCollapsed(next, { persist: true });
});

el.hideLiveBtn?.addEventListener('click', () => {
  applyLiveHidden(true, { persist: true });
  el.showLiveBtn?.focus({ preventScroll: true });
});

el.showLiveBtn?.addEventListener('click', () => {
  applyLiveHidden(false, { persist: true });
});

function setRunningUI(running) {
  if (el.runBtn) {
    el.runBtn.textContent = running ? 'Stop' : 'Run';
    el.runBtn.classList.toggle('danger', running);
    el.runBtn.setAttribute('aria-pressed', String(running));
  }
}

function resetLiveStream(query) {
  liveSequence = 0;
  if (!el.liveStream) return;
  el.liveStream.classList.remove('is-complete', 'is-error', 'is-cancelled');
  if (el.liveEvents) el.liveEvents.innerHTML = '';
  if (el.liveTitle) el.liveTitle.textContent = 'Live reasoning';
  const label = query ? `“${shortText(query, 80)}”` : 'Streaming agent thoughts…';
  setLiveSubtitle(label);

  applyLiveCollapsed(Boolean(livePrefs.collapsed));
  applyLiveHidden(Boolean(livePrefs.hidden));
  if (!isLiveHidden()) {
    clearLiveActivityFlag();
  }
}

function setLiveSubtitle(text) {
  if (el.liveSubtitle) el.liveSubtitle.textContent = text;
}

function markLiveComplete(message = 'Final answer ready.') {
  if (!el.liveStream) return;
  el.liveStream.classList.remove('is-error', 'is-cancelled');
  el.liveStream.classList.add('is-complete');
  setLiveSubtitle(message);
  flagLiveActivity();
}

function markLiveError(message) {
  if (!el.liveStream) return;
  el.liveStream.classList.remove('is-complete', 'is-cancelled');
  el.liveStream.classList.add('is-error');
  setLiveSubtitle(message);
  flagLiveActivity();
}

function markLiveCancelled() {
  if (!el.liveStream) return;
  el.liveStream.classList.remove('is-error', 'is-complete');
  el.liveStream.classList.add('is-cancelled');
  setLiveSubtitle('Run cancelled.');
  flagLiveActivity();
}

function appendLiveEvent(leaf, { isFinal = false, isError = false } = {}) {
  if (!leaf || !el.liveEvents) return;
  const stepNumber = isFinal ? liveSequence : ++liveSequence;
  const stepLabel = isFinal ? 'Final answer' : `Step ${stepNumber}`;
  const wrapper = document.createElement('div');
  const classes = ['live-item'];
  if (isFinal || (leaf.description || '').toLowerCase() === 'final answer') classes.push('final');
  if (isError) classes.push('error');
  wrapper.className = classes.join(' ');

  const heading = escHTML(leaf.description || leaf.id || 'Reasoning step');
  const source = leaf.result ?? leaf.summary ?? '';
  const body = escHTML(shortText(source || '(awaiting result)', isFinal ? 320 : 220));

  wrapper.innerHTML = `
    <span class="live-step">${escHTML(stepLabel)}</span>
    <div class="live-heading">${heading}</div>
    <div class="live-body">${body}</div>
  `;

  el.liveEvents.appendChild(wrapper);
  while (el.liveEvents.children.length > MAX_LIVE_EVENTS) {
    el.liveEvents.removeChild(el.liveEvents.firstChild);
  }
  el.liveEvents.scrollTo({ top: el.liveEvents.scrollHeight, behavior: 'smooth' });

  flagLiveActivity();
}

function handleStreamEvent(event) {
  if (!event || typeof event !== 'object') return;

  if (event.type === 'start') {
    setLiveSubtitle('Agent planning…');
    if (el.status) el.status.textContent = 'Agent planning…';
    return;
  }

  if (event.type === 'cancelled') {
    if (runCancelled) {
      markLiveCancelled();
      if (el.status) el.status.textContent = 'Run cancelled.';
    }
    return;
  }

  if (event.type === 'error') {
    const message = event.error || 'Agent error';
    markLiveError(message);
    if (el.status) el.status.textContent = `Error: ${message}`;
    appendLiveEvent({ description: 'Error', result: message }, { isError: true });
    toast(`Error: ${message}`);
    return;
  }

  if (event.type !== 'update' && event.type !== 'final') {
    return;
  }

  const snapshot = event.payload;
  if (!snapshot || typeof snapshot !== 'object') return;

  const normalized = normalizeTreePayload(
    snapshot,
    snapshot.metadata?.query !== undefined ? snapshot.metadata.query : undefined
  );
  const { summary } = applyTreePayload(normalized, {
    updateQuery: false,
    fitViewport: !hasInitialFit,
  });
  if (!hasInitialFit) hasInitialFit = true;

  const latestLeaf = snapshot.latest_leaf;
  if (latestLeaf) {
    appendLiveEvent(latestLeaf, { isFinal: event.type === 'final' });
  }

  const nodes = summary.nodeCount ?? summary.node_count ?? 0;
  const edges = summary.edgeCount ?? summary.edge_count ?? 0;
  const stepCount = Math.max(0, nodes - 1);
  if (event.type === 'final') {
    markLiveComplete(`Completed with ${stepCount} steps.`);
    const statusText = `Run complete — ${nodes} nodes and ${edges} connections.`;
    if (el.status) el.status.textContent = statusText;
    if (!finalToastShown) {
      toast('Final answer ready.');
      finalToastShown = true;
    }
  } else {
    const statusText = `Streaming — ${nodes} nodes and ${edges} connections.`;
    if (el.status) el.status.textContent = statusText;
    setLiveSubtitle(`${stepCount} steps · ${edges} links`);
  }
}

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
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'l') {
    e.preventDefault();
    const next = !isLiveCollapsed();
    applyLiveCollapsed(next, { persist: true });
  }
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
    e.preventDefault();
    const nextHidden = !isLiveHidden();
    applyLiveHidden(nextHidden, { persist: true });
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

function applyTreePayload(payload, { updateQuery = true, fitViewport = true } = {}) {
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
  if (fitViewport) {
    fitToContent();
  }
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
    fitViewport: options.fitViewport ?? true,
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
  if (activeRun) {
    if (!runCancelled) {
      runCancelled = true;
      setLiveSubtitle('Stopping agent…');
      toast('Stopping agent…');
      activeRun.cancel();
    }
    return;
  }

  const query = (el.query?.value ?? '').trim();
  hasInitialFit = false;
  runCancelled = false;
  finalToastShown = false;
  resetLiveStream(query);
  setRunningUI(true);
  if (el.status) el.status.textContent = 'Starting agent…';
  toast('Starting agent…');

  const { promise, cancel } = streamAgent(handleStreamEvent);
  activeRun = { cancel };

  try {
    await promise;
    if (runCancelled) {
      markLiveCancelled();
      if (el.status) el.status.textContent = 'Run cancelled.';
      toast('Run cancelled.');
    }
  } catch (err) {
    if (runCancelled) {
      markLiveCancelled();
      if (el.status) el.status.textContent = 'Run cancelled.';
      toast('Run cancelled.');
    } else {
      console.error(err);
      const message = err?.message || 'Streaming failed';
      markLiveError(message);
      if (el.status) el.status.textContent = `Error: ${message}`;
      toast(`Error: ${message}`);
    }
  } finally {
    activeRun = null;
    setRunningUI(false);
    runCancelled = false;
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
