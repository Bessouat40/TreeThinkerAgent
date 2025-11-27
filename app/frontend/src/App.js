import { useCallback, useMemo, useRef, useState } from 'react';
import FlowCanvas from './components/FlowCanvas';
import './App.css';

const COLUMN_GAP = 260;
const ROW_GAP = 170;
const PADDING = 40;

const buildGraphFromTree = (reasoningTree = {}) => {
  const leaves = Object.values(reasoningTree || {});
  const depthCache = {};
  const depthCounts = {};

  const computeDepth = (leafId) => {
    if (depthCache[leafId] !== undefined) return depthCache[leafId];
    const leaf = reasoningTree[leafId];
    if (!leaf || !leaf.parent_leaf) {
      depthCache[leafId] = 0;
      return 0;
    }
    depthCache[leafId] = 1 + computeDepth(leaf.parent_leaf);
    return depthCache[leafId];
  };

  const nodes = leaves.map((leaf, index) => {
    const depth = computeDepth(leaf.id);
    depthCounts[depth] = (depthCounts[depth] || 0) + 1;
    const rowIndex = depthCounts[depth] - 1;

    return {
      id: leaf.id,
      position: {
        x: PADDING + depth * COLUMN_GAP,
        y: PADDING + rowIndex * ROW_GAP,
      },
      data: {
        label: leaf.description || `Leaf ${index + 1}`,
        state: leaf.result ? 'done' : 'running',
        summary: leaf.result || 'Awaiting result…',
        reasoning: leaf.result,
        tools: (leaf.tool_calls || []).map((call) => call.tool_name),
        toolCalls: leaf.tool_calls || [],
      },
    };
  });

  const edges = leaves
    .filter((leaf) => leaf.parent_leaf)
    .map((leaf, index) => ({
      id: `edge-${leaf.parent_leaf}-${leaf.id}-${index}`,
      source: leaf.parent_leaf,
      target: leaf.id,
      label: 'next',
    }));

  return { nodes, edges };
};

function App() {
  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState('idle');
  const [report, setReport] = useState('');
  const [graphError, setGraphError] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [selectedNode, setSelectedNode] = useState(null);
  const [metadata, setMetadata] = useState({ query: '', updated_at: null, node_count: 0, edge_count: 0 });
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);

  const fileInputRef = useRef(null);
  const snapshotRef = useRef(null);

  const statusLabel = useMemo(() => {
    const normalized = status?.toLowerCase();
    if (normalized === 'done') return 'Done';
    if (normalized === 'running') return 'Running';
    if (normalized === 'error') return 'Error';
    if (normalized === 'idle') return 'Idle';
    return status || 'Unknown';
  }, [status]);

  const styledNodes = useMemo(
    () =>
      (nodes || []).map((node, index) => ({
        ...node,
        id: node.id?.toString() || `node-${index + 1}`,
        position: node.position || {
          x: (index % 3) * COLUMN_GAP + PADDING,
          y: Math.floor(index / 3) * ROW_GAP + PADDING,
        },
        data: {
          label: node.data?.label || node.label || `Node ${index + 1}`,
          state: node.data?.state || node.state || 'pending',
          summary: node.data?.summary || node.summary,
          reasoning: node.data?.reasoning || node.reasoning || 'Awaiting details.',
          tools: node.data?.tools || node.tools || [],
          toolCalls: node.data?.toolCalls || node.toolCalls || [],
        },
      })),
    [nodes],
  );

  const styledEdges = useMemo(
    () =>
      (edges || []).map((edge, index) => ({
        ...edge,
        id: edge.id?.toString() || `edge-${index + 1}`,
        source: edge.source?.toString(),
        target: edge.target?.toString(),
        label: edge.label || '',
      })),
    [edges],
  );

  const applySnapshot = useCallback((snapshot) => {
    if (!snapshot || !snapshot.reasoning_tree) return;
    snapshotRef.current = snapshot;
    const { nodes: derivedNodes, edges: derivedEdges } = buildGraphFromTree(snapshot.reasoning_tree);
    setNodes(derivedNodes);
    setEdges(derivedEdges);
    setReport(snapshot.final_answer || '');
    setMetadata({
      query: snapshot.metadata?.query || prompt,
      updated_at: snapshot.metadata?.updated_at || new Date().toISOString(),
      node_count: snapshot.metadata?.node_count ?? derivedNodes.length,
      edge_count: snapshot.metadata?.edge_count ?? derivedEdges.length,
    });
    setStatus(snapshot.final_answer ? 'done' : 'running');
  }, [prompt]);

  const handleStreamEvent = useCallback(
    (event) => {
      if (!event) return;
      if (event.type === 'start') {
        setStatus('running');
        setMetadata((prev) => ({ ...prev, query: event.payload?.query || prompt, updated_at: new Date().toISOString() }));
        return;
      }

      if (event.type === 'update' || event.type === 'final') {
        applySnapshot(event.payload);
        if (event.type === 'final') {
          setStatus('done');
        }
        return;
      }

      if (event.type === 'error') {
        setGraphError(event.error || 'The agent reported an error.');
        setStatus('error');
      }
    },
    [applySnapshot, prompt],
  );

  const consumeStream = useCallback(
    async (response) => {
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Streaming is not supported by this browser.');

      const decoder = new TextDecoder();
      let buffer = '';
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() || '';
        chunks.forEach((chunk) => {
          const line = chunk.trim();
          if (!line.startsWith('data:')) return;
          try {
            const event = JSON.parse(line.replace(/^data:\s*/, ''));
            handleStreamEvent(event);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('Failed to parse stream chunk', err);
          }
        });
      }
      setStatus((prev) => (prev === 'error' ? 'error' : 'done'));
    },
    [handleStreamEvent],
  );

  const fallbackRun = useCallback(async () => {
    const response = await fetch('/api/agent/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: prompt }),
    });

    if (!response.ok) {
      throw new Error('Agent run failed.');
    }

    const payload = await response.json();
    applySnapshot(payload);
    setStatus('done');
  }, [applySnapshot, prompt]);

  const handleRun = useCallback(
    async (event) => {
      event.preventDefault();
      if (!prompt.trim()) return;
      setIsLoading(true);
      setGraphError('');
      setReport('');
      setStatus('running');
      setShowReport(true);
      setSelectedNode(null);

      try {
        const response = await fetch('/api/agent/run-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: prompt }),
        });

        if (!response.ok) {
          await fallbackRun();
          return;
        }

        await consumeStream(response);
      } catch (error) {
        try {
          await fallbackRun();
        } catch (err) {
          setGraphError(err.message || error.message || 'Unable to launch the agent.');
          setStatus('error');
        }
      } finally {
        setIsLoading(false);
      }
    },
    [consumeStream, fallbackRun, prompt],
  );

  const downloadGraph = useCallback(() => {
    const payload = snapshotRef.current || {
      nodes,
      edges,
      status,
      report,
      metadata,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'agent-graph.json';
    link.click();
    URL.revokeObjectURL(url);
  }, [edges, metadata, nodes, report, status]);

  const handleUpload = useCallback((event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        snapshotRef.current = parsed;
        if (parsed.reasoning_tree) {
          applySnapshot(parsed);
          setUploadError('');
          return;
        }
        setNodes(parsed.nodes || []);
        setEdges(parsed.edges || []);
        setStatus(parsed.status || 'imported');
        setReport(parsed.report || '');
        setMetadata(parsed.metadata || {});
        setUploadError('');
      } catch (err) {
        setUploadError('The uploaded file is not a valid graph JSON.');
      }
    };
    reader.readAsText(file);
  }, [applySnapshot]);

  const activeNodeDetails = useMemo(() => {
    if (!selectedNode) return null;
    return {
      label: selectedNode.data?.label || selectedNode.label,
      state: selectedNode.data?.state || selectedNode.state,
      reasoning: selectedNode.data?.reasoning,
      tools: selectedNode.data?.tools || [],
      toolCalls: selectedNode.data?.toolCalls || [],
      summary: selectedNode.data?.summary,
    };
  }, [selectedNode]);

  const statusClass = useMemo(() => `status-pill status-${status?.toLowerCase() || 'idle'}`, [status]);

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="brand">
          <div className="brand-mark">TT</div>
          <div>
            <p className="eyebrow">TreeThinker Agent Console</p>
            <h1>Reasoning Graph Monitor</h1>
          </div>
        </div>
        <div className="status-group">
          <span className={statusClass}>{statusLabel}</span>
          <span className="muted">{metadata.updated_at ? `Last sync: ${new Date(metadata.updated_at).toLocaleTimeString()}` : 'Waiting'}</span>
        </div>
      </header>

      <main className="layout">
        <section className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">New run</p>
              <h2>Launch a fresh reasoning session</h2>
              <p className="muted">Send a prompt to the backend at /api/agent/run-stream, then follow the live graph updates.</p>
            </div>
          </div>
          <form className="prompt-row" onSubmit={handleRun}>
            <input
              type="text"
              placeholder="Describe the task you want the agent to perform"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <button type="submit" className="primary" disabled={isLoading}>
              {isLoading ? 'Launching…' : 'Launch'}
            </button>
          </form>
          <div className="meta-grid">
            <div>
              <p className="muted">Query</p>
              <strong>{metadata.query || '—'}</strong>
            </div>
            <div>
              <p className="muted">Nodes</p>
              <strong>{metadata.node_count ?? nodes.length}</strong>
            </div>
            <div>
              <p className="muted">Edges</p>
              <strong>{metadata.edge_count ?? edges.length}</strong>
            </div>
            <div>
              <p className="muted">Updated</p>
              <strong>{metadata.updated_at ? new Date(metadata.updated_at).toLocaleTimeString() : '—'}</strong>
            </div>
          </div>
          <div className="actions">
            <button type="button" onClick={() => setShowReport((prev) => !prev)} className="ghost">
              {showReport ? 'Hide report' : 'Show report'}
            </button>
            <button type="button" onClick={downloadGraph} className="ghost">
              Download graph
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => fileInputRef.current?.click()}
            >
              Upload graph
            </button>
            <input
              type="file"
              accept="application/json"
              ref={fileInputRef}
              style={{ display: 'none' }}
              onChange={handleUpload}
            />
          </div>
          {(graphError || uploadError) && (
            <div className="alert error">
              <strong>Issue:</strong> {graphError || uploadError}
            </div>
          )}
        </section>

        <section className="panel graph-panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Graph</p>
              <h2>Reasoning tree</h2>
              <p className="muted">Nodes reflect the backend reasoning_tree payload; edges follow parent_leaf links.</p>
            </div>
            <div className="badges">
              <span className="badge">Edges: {styledEdges.length}</span>
              <span className="badge">Nodes: {styledNodes.length}</span>
            </div>
          </div>
          <div className="flow-wrapper">
            {isLoading && <div className="overlay">Syncing…</div>}
            <FlowCanvas nodes={styledNodes} edges={styledEdges} onNodeClick={setSelectedNode} />
          </div>
        </section>

        {showReport && (
          <section className="panel report-panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Final report</p>
                <h2>Agent output</h2>
              </div>
              <button type="button" className="ghost" onClick={() => setShowReport(false)}>
                Close
              </button>
            </div>
            <div className="report-body">
              {report ? <pre>{report}</pre> : <p className="muted">No report available yet.</p>}
            </div>
          </section>
        )}
      </main>

      <aside className={`side-panel ${selectedNode ? 'open' : ''}`}>
        <div className="side-head">
          <div>
            <p className="eyebrow">Node details</p>
            <h3>{activeNodeDetails?.label || 'Select a node'}</h3>
            {activeNodeDetails?.state && <span className="badge">{activeNodeDetails.state}</span>}
          </div>
          <button className="ghost" type="button" onClick={() => setSelectedNode(null)}>
            Close
          </button>
        </div>
        {selectedNode ? (
          <div className="side-body">
            {activeNodeDetails?.summary && <p className="muted">{activeNodeDetails.summary}</p>}
            <div className="detail-block">
              <h4>Reasoning</h4>
              <p>{activeNodeDetails?.reasoning || 'No reasoning provided.'}</p>
            </div>
            <div className="detail-block">
              <h4>Tools</h4>
              {activeNodeDetails?.toolCalls?.length ? (
                <ul>
                  {activeNodeDetails.toolCalls.map((tool) => (
                    <li key={tool.tool_name}>
                      <strong>{tool.tool_name}</strong>
                      {tool.args && (
                        <span className="muted"> — args: {JSON.stringify(tool.args)}</span>
                      )}
                      {tool.result !== undefined && (
                        <div className="tool-result">Result: {typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result)}</div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No tools recorded.</p>
              )}
            </div>
          </div>
        ) : (
          <div className="side-placeholder">
            <p className="muted">Click a node to inspect its internal reasoning.</p>
          </div>
        )}
      </aside>
    </div>
  );
}

export default App;
