import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FlowCanvas from './components/FlowCanvas';
import './App.css';

const fallbackNodes = [
  {
    id: 'intro',
    label: 'Planning',
    position: { x: 60, y: 60 },
    data: {
      label: 'Planning',
      state: 'idle',
      summary: 'Drafting the reasoning steps',
      reasoning: 'Waiting for a new run to start.',
    },
  },
  {
    id: 'execute',
    label: 'Execution',
    position: { x: 340, y: 200 },
    data: {
      label: 'Execution',
      state: 'idle',
      summary: 'Will stream tool calls here',
      reasoning: 'No active task yet.',
    },
  },
];

const fallbackEdges = [
  { id: 'e1-2', source: 'intro', target: 'execute', label: 'flows to' },
];

function App() {
  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState('idle');
  const [report, setReport] = useState('');
  const [graphError, setGraphError] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [polling, setPolling] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [selectedNode, setSelectedNode] = useState(null);
  const [graphMeta, setGraphMeta] = useState({ runId: null, lastUpdated: null });

  const [nodes, setNodes] = useState(fallbackNodes);
  const [edges, setEdges] = useState(fallbackEdges);

  const fileInputRef = useRef(null);
  const pollingRef = useRef(null);

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
          x: (index % 3) * 260 + 40,
          y: Math.floor(index / 3) * 180 + 60,
        },
        data: {
          label: node.data?.label || node.label || `Node ${index + 1}`,
          state: node.data?.state || node.state || 'pending',
          summary: node.data?.summary || node.summary,
          reasoning: node.data?.reasoning || node.reasoning || 'Awaiting details.',
          tools: node.data?.tools || node.tools || [],
          intermediates: node.data?.intermediates || node.intermediates || {},
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

  const refreshGraph = useCallback(
    async (silent = false) => {
      try {
        if (!silent) {
          setGraphError('');
          setIsLoading(true);
        }
        const query = graphMeta.runId ? `?run_id=${graphMeta.runId}` : '';
        const response = await fetch(`/api/graph${query}`);
        if (!response.ok) {
          throw new Error('Unable to fetch the graph from the backend.');
        }
        const data = await response.json();
        setNodes(data.nodes || []);
        setEdges(data.edges || []);
        setStatus(data.status || status);
        setReport(data.report || '');
        setGraphMeta((prev) => ({
          ...prev,
          lastUpdated: new Date().toISOString(),
          runId: data.run_id || data.runId || prev.runId,
        }));
        if (data.status && data.status.toLowerCase() === 'done') {
          setPolling(false);
        }
        if (data.status && data.status.toLowerCase() === 'error') {
          setPolling(false);
          setGraphError('The backend reported an error while generating the graph.');
        }
      } catch (error) {
        setGraphError(error.message);
      } finally {
        if (!silent) {
          setIsLoading(false);
        }
      }
    },
    [graphMeta.runId, status],
  );

  const handleRun = useCallback(
    async (event) => {
      event.preventDefault();
      if (!prompt.trim()) return;
      try {
        setIsLoading(true);
        setGraphError('');
        setStatus('running');
        setPolling(true);
        const response = await fetch('/api/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt }),
        });
        if (!response.ok) {
          throw new Error('Launching the agent failed.');
        }
        const payload = await response.json();
        setGraphMeta({
          runId: payload.run_id || payload.runId || null,
          lastUpdated: new Date().toISOString(),
        });
        await refreshGraph(true);
      } catch (error) {
        setGraphError(error.message);
        setStatus('error');
        setPolling(false);
      } finally {
        setIsLoading(false);
      }
    },
    [prompt, refreshGraph],
  );

  useEffect(() => {
    if (!polling) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
      return undefined;
    }
    pollingRef.current = setInterval(() => {
      refreshGraph(true);
    }, 2500);
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [polling, refreshGraph]);

  const downloadGraph = useCallback(() => {
    const payload = {
      nodes,
      edges,
      status,
      report,
      runId: graphMeta.runId,
      lastUpdated: graphMeta.lastUpdated,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'agent-graph.json';
    link.click();
    URL.revokeObjectURL(url);
  }, [edges, graphMeta.lastUpdated, graphMeta.runId, nodes, report, status]);

  const handleUpload = useCallback((event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        setNodes(parsed.nodes || []);
        setEdges(parsed.edges || []);
        setStatus(parsed.status || 'imported');
        setReport(parsed.report || '');
        setGraphMeta({
          runId: parsed.runId || parsed.run_id || null,
          lastUpdated: parsed.lastUpdated || new Date().toISOString(),
        });
        setUploadError('');
      } catch (err) {
        setUploadError('The uploaded file is not a valid graph JSON.');
      }
    };
    reader.readAsText(file);
  }, []);

  const activeNodeDetails = useMemo(() => {
    if (!selectedNode) return null;
    return {
      label: selectedNode.data?.label || selectedNode.label,
      state: selectedNode.data?.state || selectedNode.state,
      reasoning: selectedNode.data?.reasoning,
      tools: selectedNode.data?.tools || [],
      intermediates: selectedNode.data?.intermediates || {},
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
          {polling ? <span className="pulse">Live polling…</span> : <span className="muted">Waiting</span>}
          {graphMeta.lastUpdated && (
            <span className="muted">Last sync: {new Date(graphMeta.lastUpdated).toLocaleTimeString()}</span>
          )}
        </div>
      </header>

      <main className="layout">
        <section className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">New run</p>
              <h2>Launch a fresh reasoning session</h2>
              <p className="muted">Send a prompt to the backend, then follow the live graph updates.</p>
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
          <div className="actions">
            <button type="button" onClick={() => refreshGraph(false)} className="ghost">
              Refresh graph
            </button>
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
              <h2>React Flow view</h2>
              <p className="muted">
                Nodes and edges refresh automatically while the backend reports <span className="badge">running</span>.
              </p>
            </div>
            <div className="badges">
              <span className="badge">Run ID: {graphMeta.runId || 'pending'}</span>
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
              {activeNodeDetails?.tools?.length ? (
                <ul>
                  {activeNodeDetails.tools.map((tool) => (
                    <li key={tool}>{tool}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No tools recorded.</p>
              )}
            </div>
            <div className="detail-block">
              <h4>Intermediate values</h4>
              {activeNodeDetails?.intermediates &&
              Object.keys(activeNodeDetails.intermediates).length ? (
                <ul>
                  {Object.entries(activeNodeDetails.intermediates).map(([key, value]) => (
                    <li key={key}>
                      <strong>{key}:</strong> {String(value)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No intermediate values.</p>
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
