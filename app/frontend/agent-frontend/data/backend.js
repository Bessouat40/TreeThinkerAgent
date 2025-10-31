import { el } from '../ui/dom.js';
import { toast } from '../ui/toast.js';

export async function runAgent() {
  const base = (el.apiBase?.value || 'http://localhost:8000').replace(
    /\/$/,
    ''
  );
  const query = (el.query?.value || '').trim();
  const mode = document.getElementById('runMode')?.value;

  el.status.textContent = 'Running…';
  toast('Running agent…');

  const res = await fetch(`${base}/api/agent/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, mode }),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}
