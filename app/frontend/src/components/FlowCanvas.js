import { useMemo } from 'react';

const NODE_WIDTH = 230;
const NODE_HEIGHT = 120;

function FlowCanvas({ nodes, edges, onNodeClick }) {
  const nodeLookup = useMemo(() => {
    const lookup = {};
    (nodes || []).forEach((node) => {
      lookup[node.id] = node;
    });
    return lookup;
  }, [nodes]);

  return (
    <div className="flow-canvas">
      <svg className="flow-edges" aria-label="graph connections">
        <defs>
          <marker id="arrow" markerWidth="10" markerHeight="10" refX="10" refY="5" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" className="edge-arrow" />
          </marker>
        </defs>
        {(edges || []).map((edge) => {
          const source = nodeLookup[edge.source];
          const target = nodeLookup[edge.target];
          if (!source || !target) return null;
          const start = {
            x: (source.position?.x || 0) + NODE_WIDTH / 2,
            y: (source.position?.y || 0) + NODE_HEIGHT / 2,
          };
          const end = {
            x: (target.position?.x || 0) + NODE_WIDTH / 2,
            y: (target.position?.y || 0) + NODE_HEIGHT / 2,
          };
          return (
            <g key={edge.id} className="flow-edge">
              <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} markerEnd="url(#arrow)" />
              {edge.label && (
                <text x={(start.x + end.x) / 2} y={(start.y + end.y) / 2 - 6} className="edge-label">
                  {edge.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {(nodes || []).map((node) => (
        <div
          key={node.id}
          className={`flow-node state-${(node.data?.state || 'pending').toLowerCase()}`}
          style={{ left: node.position?.x || 0, top: node.position?.y || 0, width: NODE_WIDTH, minHeight: NODE_HEIGHT }}
          role="button"
          tabIndex={0}
          onClick={() => onNodeClick?.(node)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              onNodeClick?.(node);
            }
          }}
        >
          <div className="node-header">
            <div className="node-title">{node.data?.label || node.label || node.id}</div>
            <span className="node-state">{node.data?.state || node.state || 'pending'}</span>
          </div>
          {node.data?.summary && <p className="node-summary">{node.data.summary}</p>}
          <div className="node-footer">Inspect node</div>
        </div>
      ))}
    </div>
  );
}

export default FlowCanvas;
