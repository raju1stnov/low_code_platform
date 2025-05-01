import React from 'react'; // Removed useEffect, useState

// Receive agents, loading state, error, and refresh handler as props
const AgentsPanel = ({ agents, isLoading, error, onRefresh }) => {

  // Handler for starting the drag operation (remains the same)
  const onDragStart = (event, agentName, methodName) => {
    const dragData = JSON.stringify({ agent: agentName, method: methodName });
    event.dataTransfer.setData('application/reactflow', dragData);
    event.dataTransfer.effectAllowed = 'move';
    console.log(`Dragging: ${agentName}.${methodName}`);
  };

  return (
    <div>
      {/* Use the passed-in refresh handler */}
      <button onClick={onRefresh} disabled={isLoading} style={{ marginBottom: '10px' }}>
        {isLoading ? 'Loading...' : 'Refresh Agents'}
      </button>
      {/* Display error passed down from App.jsx */}
      {error && <p style={{ color: 'red' }}>{error}</p>}

      {/* Display logic remains the same, using the 'agents' prop */}
      {agents.length === 0 && !isLoading && !error && <p>No agents found.</p>}

      {agents.map((agent) => (
        <div key={agent.name} style={{ marginBottom: '1rem', borderBottom: '1px solid #eee', paddingBottom: '0.5rem' }}>
          <strong title={agent.description || agent.name}>{agent.name}</strong>
          {agent.methods && agent.methods.length > 0 ? (
              <ul style={{ paddingLeft: '1rem', margin: '0.3rem 0 0 0', listStyle: 'none' }}>
               {agent.methods.map((method) => (
                 typeof method === 'object' && method !== null && method.name ? (
                   <li
                     key={method.name}
                     draggable
                     onDragStart={(e) => onDragStart(e, agent.name, method.name)}
                     title={method.description || method.name}
                     style={{
                       cursor: 'grab',
                       color: '#1d4ed8',
                       padding: '2px 5px',
                       margin: '2px 0',
                       backgroundColor: '#eef2ff',
                       borderRadius: '3px',
                       fontSize: '0.9em'
                     }}
                   >
                     {method.name}
                   </li>
                 ) : (
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