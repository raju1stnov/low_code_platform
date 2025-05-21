import React, { useState, useEffect, useCallback } from 'react';
import { ReactFlowProvider } from 'reactflow'; // Import provider
import axios from 'axios'; 
import AgentsPanel from './components/AgentsPanel.jsx';
import WorkflowBuilder from './components/WorkflowBuilder.jsx';
import RunPanel from './components/RunPanel.jsx';
import ChatPanel from './components/ChatPanel.jsx';

// Main application layout using ReactFlowProvider to wrap components that need context
export default function App() {
  // Lift state for nodes and edges here to share between WorkflowBuilder and RunPanel
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  //  Lifted state for agents ---
  const [agents, setAgents] = useState([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);
  const [agentError, setAgentError] = useState('');

  // Add Chat State
  const [chatSessionId] = useState(`session-${Date.now()}`); // Simple session ID for PoC

  // Function to fetch agents ---
  const fetchAgents = useCallback(async () => {
    setIsLoadingAgents(true);
    setAgentError('');
    // Don't clear agents immediately, provide smoother refresh
    try {
      const res = await axios.get('/api/agents');
      const formattedAgents = res.data.map(agent => ({
          ...agent,
          methods: Array.isArray(agent.methods) ? agent.methods : []
      }));
      setAgents(formattedAgents);
    } catch (err) {
        console.error("Failed to fetch agents:", err);
        let errorMsg = 'Failed to load agents.';
        if (err.response && err.response.data && err.response.data.detail) {
            errorMsg += ` Error: ${err.response.data.detail}`;
        } else if (err.request) {
            errorMsg = 'Network Error: Could not reach backend.';
        } else {
            errorMsg = `Error: ${err.message}`;
        }
        setAgentError(errorMsg); // Set error state here
        setAgents([]); // Clear agents on error
    } finally {
      setIsLoadingAgents(false);
    }
  }, []); // Empty dependency array means this function doesn't change

  // Fetch agents on initial mount
  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]); // Include fetchAgents in dependency array

  return (
    <ReactFlowProvider> {/* Needed for useReactFlow hook if used in children */}
      <div style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif' }}>
        {/* Left Panel: Agent Marketplace - Pass agents and refresh function*/}
        <div style={{ width: '20%', borderRight: '1px solid #ccc', padding: 10, overflowY: 'auto' }}>
          <h2>Agents & Methods</h2>
          <AgentsPanel 
            agents={agents} // Pass agents down
            isLoading={isLoadingAgents} // Pass loading state
            error={agentError} // Pass error state
            onRefresh={fetchAgents} // Pass refresh function          
          />
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

        {/* Right Panel: Pass nodes, edges, AND agents state Run Workflow & Logs */}
        <div style={{ width: '30%', padding: 10, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          {/* Keep Run/Save Panel */}
          <div style={{flexShrink: 0}}> {/* Prevent RunPanel from shrinking excessively */}
            <h2>Run & Save</h2>
            {/* Pass nodes and edges state down to RunPanel */}
            <RunPanel 
              nodes={nodes}
              edges={edges}
              agents={agents}
            />
          </div>
          {/* Add Chat Panel Below */}
          <div style={{marginTop: '20px', flexGrow: 1, minHeight: '300px'}}> {/* Allow chat to grow */}
            <h2>Chat Query</h2>
            <ChatPanel sessionId={chatSessionId} />
          </div>
        </div>
      </div>
    </ReactFlowProvider>
  );
}