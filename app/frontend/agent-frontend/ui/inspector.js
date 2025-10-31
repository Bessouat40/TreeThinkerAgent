import { el } from './dom.js';

function toDisplayString(v) {
  if (v == null) return '(no result)';
  if (typeof v === 'string') return v.trim() || '(empty)';
  try {
    if (typeof v === 'object') return JSON.stringify(v, null, 2);
    return String(v);
  } catch {
    return String(v);
  }
}

function normalizeMDInput(s) {
  return String(s)
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function unwrapSingleParagraph(html) {
  const m = /^<p>([\s\S]*?)<\/p>\s*$/.exec(html);
  return m ? m[1] : html;
}

function trimBlock(html = '') {
  return String(html).replace(/^\s+/, '').replace(/\s+$/, '');
}

function mdCompact(src) {
  const input = normalizeMDInput(toDisplayString(src));
  if (!input) return '';

  try {
    if (window.marked) {
      window.marked.setOptions?.({
        gfm: true,
        breaks: false,
        smartLists: true,
        smartypants: false,
      });
      const html = window.marked.parse(input);
      return unwrapSingleParagraph(trimBlock(html));
    }
    return input;
  } catch {
    return input;
  }
}

function escapeHTML(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function openInspectorRich(node) {
  if (!el.nodePanel || !el.nodeContent) return;

  document.getElementById('nodePanelTitle').textContent =
    node.name || 'Node details';

  const depList = (node.depends_on || [])
    .map((d) => `<code>${d}</code>`)
    .join(' ');
  const meta = `
    <div class="meta-row compact">
      <span class="pill ${node.status || 'done'}">${
    node.status || 'done'
  }</span>
      ${depList ? `<span class="meta">deps: ${depList}</span>` : ``}
      ${
        node.children?.length
          ? `<span class="meta">children: ${node.children.length}</span>`
          : ``
      }
    </div>
  `;

  const descHTML = mdCompact(node.description || '');

  const toolsHTML = (node.tool_calls || [])
    .map((t) => {
      const head = `🧩 ${t.tool_name || 'tool'}`;
      const body = mdCompact(t.result);
      return `
        <div class="tool-block compact">
          <div class="tool-head">${head}</div>
          <div class="tool-body md compact">${body || '(no result)'}</div>
        </div>`;
    })
    .join('');

  el.nodeContent.innerHTML = `
    <div class="inspector compact">
      ${meta}
      ${
        descHTML
          ? `
      <section class="section compact">
        <h3 class="section-title compact">Description</h3>
        <div class="section-body md compact">${descHTML}</div>
      </section>`
          : ''
      }
      ${
        toolsHTML
          ? `
      <section class="section compact">
        <h3 class="section-title compact">Tools</h3>
        <div class="section-body tools-grid compact">
          ${toolsHTML}
        </div>
      </section>`
          : ''
      }
      <section class="section compact">
        <h3 class="section-title compact">Raw</h3>
        <pre class="raw compact"><code>${escapeHTML(
          JSON.stringify(node, null, 2)
        )}</code></pre>
      </section>
    </div>
  `;

  el.nodePanel.classList.remove('hidden');
  el.nodePanel.setAttribute('aria-hidden', 'false');
}

export function bindInspector() {
  document
    .getElementById('closeNode')
    ?.addEventListener('click', closeInspector);
}
export function closeInspector() {
  el.nodePanel?.classList.add('hidden');
  el.nodePanel?.setAttribute('aria-hidden', 'true');
}
