import React, { useEffect, useState } from 'react';
import axios from 'axios';

const AgentsPanel = () => {
  const [agents, setAgents] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchAgents = async () => {
    setIsLoading(true);
    setError('');
    setAgents([]); // Clear previous agents
    try {
      const res = await axios.get('/api/agents');
      // Ensure methods is always an array
      const formattedAgents = res.data.map(agent => ({
          ...agent,
          methods: Array.isArray(agent.methods) ? agent.methods : [] // Handle missing/non-array methods
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
        setError(errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch agents on initial component mount
  useEffect(() => {
    fetchAgents();
  }, []);

  // Handler for starting the drag operation
   const onDragStart = (event, agentName, methodName) => {
      const dragData = JSON.stringify({ agent: agentName, method: methodName });
      event.dataTransfer.setData('application/reactflow', dragData);
      event.dataTransfer.effectAllowed = 'move';
      console.log(`Dragging: ${agentName}.${methodName}`);
   };

  return (
    <div>
      <button onClick={fetchAgents} disabled={isLoading} style={{ marginBottom: '10px' }}>
        {isLoading ? 'Loading...' : 'Refresh Agents'}
      </button>
      {error && <p style={{ color: 'red' }}>{error}</p>}

      {agents.length === 0 && !isLoading && !error && <p>No agents found in registry.</p>}

      {agents.map((agent) => (
        <div key={agent.name} style={{ marginBottom: '1rem', borderBottom: '1px solid #eee', paddingBottom: '0.5rem' }}>
          <strong title={agent.description || agent.name}>{agent.name}</strong>
          {/* Check if methods array exists and has items */}
          {agent.methods && agent.methods.length > 0 ? (
             <ul style={{ paddingLeft: '1rem', margin: '0.3rem 0 0 0', listStyle: 'none' }}>
               {agent.methods.map((method) => (
                 // Ensure method is an object and has a name before rendering
                 typeof method === 'object' && method !== null && method.name ? (
                   <li
                     key={method.name}
                     draggable // Make the list item draggable
                     onDragStart={(e) => onDragStart(e, agent.name, method.name)} // Pass agent/method names
                     title={method.description || method.name}
                     style={{
                       cursor: 'grab',
                       color: '#1d4ed8', // Blue color for link-like appearance
                       padding: '2px 5px',
                       margin: '2px 0',
                       backgroundColor: '#eef2ff', // Light background on hover/drag
                       borderRadius: '3px',
                       fontSize: '0.9em'
                      }}
                   >
                     {method.name}
                   </li>
                 ) : (
                    // Render a placeholder or log warning for invalid method entries
                    <li key={`invalid-${agent.name}-${Math.random()}`} style={{color: '#999', fontSize: '0.8em'}}> (Invalid method format)</li>
                 )
               ))}
             </ul>
          ) : (
             <p style={{ fontSize: '0.8em', color: '#777', margin: '0.3rem 0 0 1rem' }}>(No methods defined)</p>
          )}
        </div>
      ))}
    </div>
  );
};

export default AgentsPanel;