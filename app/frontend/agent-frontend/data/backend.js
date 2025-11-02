import { el } from '../ui/dom.js';

const BASE_URL = 'http://localhost:8000';

function collectPayload() {
  return {
    query: (el.query?.value || '').trim(),
    llmProvider: el.llmProvider.value,
    providerUrl: el.providerUrl.value,
    modelName: el.modelName.value,
    apiKey: el.apiKey.value,
  };
}

export function streamAgent(onEvent) {
  const payload = collectPayload();
  const controller = new AbortController();
  let cancelled = false;

  const emit = (evt) => {
    if (typeof onEvent === 'function') {
      try {
        onEvent(evt);
      } catch (err) {
        console.error('stream event handler failed', err);
      }
    }
  };

  const promise = (async () => {
    let res;
    try {
      res = await fetch(`${BASE_URL}/api/agent/run-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      if (cancelled) return;
      throw err;
    }

    if (!res.ok) {
      if (cancelled) return;
      throw new Error(`${res.status} ${res.statusText}`);
    }

    if (!res.body) {
      throw new Error('Streaming response body is not available');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const processBuffer = () => {
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const lines = rawEvent.split('\n');
        let dataChunk = '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith('data:')) {
            dataChunk += trimmed.slice(5).trim();
          }
        }
        if (!dataChunk) continue;
        try {
          const parsed = JSON.parse(dataChunk);
          emit(parsed);
        } catch (err) {
          console.warn('Failed to parse stream event', err);
        }
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        processBuffer();
      }

      if (buffer) {
        processBuffer();
      }
    } catch (err) {
      if (!cancelled) {
        throw err;
      }
    } finally {
      if (cancelled) {
        emit({ type: 'cancelled' });
      }
      emit({ type: 'done' });
    }
  })();

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    controller.abort();
  };

  return { promise, cancel, payload };
}
