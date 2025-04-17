import React, { useState } from 'react';
import { ReactFlowProvider } from 'reactflow'; // Import provider
import AgentsPanel from './components/AgentsPanel.jsx';
import WorkflowBuilder from './components/WorkflowBuilder.jsx';
import RunPanel from './components/RunPanel.jsx';

// Main application layout using ReactFlowProvider to wrap components that need context
export default function App() {
  // Lift state for nodes and edges here to share between WorkflowBuilder and RunPanel
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);

  return (
    <ReactFlowProvider> {/* Needed for useReactFlow hook if used in children */}
      <div style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif' }}>
        {/* Left Panel: Agent Marketplace */}
        <div style={{ width: '20%', borderRight: '1px solid #ccc', padding: 10, overflowY: 'auto' }}>
          <h2>Agents & Methods</h2>
          <AgentsPanel />
        </div>

        {/* Middle Panel: Workflow Canvas */}
        <div style={{ width: '50%', borderRight: '1px solid #ccc', height: '100%' }}>
          {/* Pass state down to WorkflowBuilder */}
          <WorkflowBuilder
            nodes={nodes}
            setNodes={setNodes}
            edges={edges}
            setEdges={setEdges}
          />
        </div>

        {/* Right Panel: Run Workflow & Logs */}
        <div style={{ width: '30%', padding: 10, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          <h2>Run & Logs</h2>
          {/* Pass nodes and edges state down to RunPanel */}
          <RunPanel nodes={nodes} edges={edges} />
        </div>
      </div>
    </ReactFlowProvider>
  );
}