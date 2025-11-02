import { el } from '../ui/dom.js';
import { toast } from '../ui/toast.js';

export async function runAgent() {
  const base = 'http://localhost:8000';
  const llmProvider = el.llmProvider.value;
  const providerUrl = el.providerUrl.value;
  const modelName = el.modelName.value;
  const apiKey = el.apiKey.value;
  const query = (el.query?.value || '').trim();

  el.status.textContent = 'Running…';
  toast('Running agent…');

  const res = await fetch(`${base}/api/agent/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      llmProvider,
      providerUrl,
      modelName,
      apiKey,
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}
