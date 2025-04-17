import React, { useState } from 'react';
import axios from 'axios';

// Receive nodes and edges as props from App.jsx
export default function RunPanel({ nodes, edges }) {
  // State for runtime inputs
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('secret');
  const [title, setTitle] = useState('Data Scientist');
  const [skills, setSkills] = useState('Python,Machine Learning'); // Default skills

  // State for logs and execution status
  const [logs, setLogs] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [runStatus, setRunStatus] = useState(''); // e.g., 'completed', 'failed'

  const handleRun = async () => {
    // Prevent running if already running
    if (isRunning) return;

    setIsRunning(true);
    setLogs([]); // Clear previous logs
    setRunStatus('Running...');

    // Prepare the payload from current nodes, edges, and runtime inputs
    // Map ReactFlow nodes to the structure expected by the backend
    const backendNodes = nodes.map(node => ({
        id: node.id,
        type: node.type,
        position: node.position,
        data: { // Send data field containing agent/method info
           label: node.data.label,
           agent: node.data.agent,
           method: node.data.method
        }
    }));

    // Map ReactFlow edges
    const backendEdges = edges.map(edge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: edge.type
    }));

    const workflowPayload = {
      nodes: backendNodes,
      edges: backendEdges,
      initial_inputs: { username, password, title, skills }, // Pass runtime inputs
    };

    console.log('Sending workflow to backend:', workflowPayload);

    try {
      // Make the API call to the backend's run_workflow endpoint
      // Ensure  backend runs on port 9001 or adjust proxy/URL
      const res = await axios.post('/api/run_workflow', workflowPayload);
      console.log('Backend response:', res.data);
      setLogs(res.data.logs || []);
      setRunStatus(res.data.status || 'completed'); // Update status from response
    } catch (err) {
      console.error('Workflow execution error:', err);
      let errorMsg = 'An unexpected error occurred.';
      let errorDetail = {};
      // Extract error details from Axios error response if available
      if (err.response && err.response.data && err.response.data.detail) {
         // Handle errors from FastAPI (HTTPException)
         errorMsg = `Error: ${err.response.data.detail}`;
         errorDetail = { code: err.response.status, message: err.response.data.detail };
      } else if (err.request) {
          errorMsg = 'Network Error: Could not reach the backend.';
          errorDetail = { message: errorMsg };
      } else {
          errorMsg = err.message;
          errorDetail = { message: errorMsg };
      }

      // Add a log entry for the overall error
      setLogs([{
        nodeId: 'WORKFLOW_ERROR',
        agent: 'System',
        method: 'Execution',
        status: 'error',
        inputs_used: workflowPayload.initial_inputs, // Show initial inputs attempted
        output: { error: errorDetail },
        duration_ms: 0
      }]);
      setRunStatus('failed');
    } finally {
      setIsRunning(false); // Re-enable the run button
    }
  };

  // Helper to format log output nicely
  const formatLogOutput = (output) => {
     if (typeof output === 'object' && output !== null) {
         // Special handling for errors
         if (output.error) {
             const errorInfo = output.error;
             return `Error (Code: ${errorInfo.code || 'N/A'}): ${errorInfo.message || JSON.stringify(errorInfo)}`;
         }
         return JSON.stringify(output, null, 2); // Pretty print JSON
     }
     return String(output); // Convert non-objects to string
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Runtime Inputs Form */}
      <div style={{ marginBottom: '1rem', borderBottom: '1px solid #eee', paddingBottom: '1rem' }}>
        <h4>Runtime Inputs</h4>
        <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '5px', alignItems: 'center' }}>
          <label htmlFor="username">Username:</label>
          <input id="username" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} style={{ width: '95%' }}/>

          <label htmlFor="password">Password:</label>
          <input id="password" placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ width: '95%' }}/>

          <label htmlFor="title">Job Title:</label>
          <input id="title" placeholder="Job Title" value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: '95%' }}/>

          <label htmlFor="skills">Skills:</label>
          <input id="skills" placeholder="Skills (comma-sep)" value={skills} onChange={(e) => setSkills(e.target.value)} style={{ width: '95%' }}/>
        </div>
        <button onClick={handleRun} disabled={isRunning} style={{ marginTop: '10px', padding: '8px 15px', cursor: isRunning ? 'wait' : 'pointer' }}>
          {isRunning ? 'Running...' : 'Run Workflow'}
        </button>
        {runStatus && <p style={{ marginTop: '5px', fontWeight: 'bold' }}>Status: {runStatus}</p>}
      </div>

      {/* Execution Logs Area */}
      <div style={{ flexGrow: 1, overflowY: 'auto' }}>
        <h4>Execution Logs</h4>
        {logs.length === 0 && !isRunning && <p>No logs yet. Build a workflow and click Run.</p>}
        {logs.map((log, idx) => (
          <div
            key={idx}
            style={{              
              border: `1px solid ${log.status === 'error' ? '#f56565' : (log.status === 'partial_success' ? '#ecc94b' : '#ccc')}`, // Add yellow for partial              
              backgroundColor: log.status === 'error' ? '#fff5f5' : (log.status === 'partial_success' ? '#fffbeb' : '#f9f9f9'), // Add light yellow
              marginBottom: '8px',
              padding: '8px',
              fontSize: '0.9em',
              wordBreak: 'break-word' // Prevent long strings from overflowing
            }}
          >
            <p style={{ margin: '0 0 4px 0', fontWeight: 'bold' }}>
              Step {idx + 1}: {log.agent}.{log.method} ({log.nodeId})
              <span style={{ float: 'right', color: '#555', fontSize: '0.9em' }}>
                 {log.duration_ms !== null ? `${log.duration_ms.toFixed(1)} ms` : ''}
              </span>
            </p>
            <p style={{
                margin: '2px 0',
                color: log.status === 'error' ? '#c53030' : (log.status === 'partial_success' ? '#b7791f' : '#38a169'), // Add color for partial
                fontWeight: 'bold'
             }}>
              Status: {log.status}
            </p>            
            <details style={{ marginTop: '4px', cursor: 'pointer' }}>
               <summary style={{ fontSize: '0.9em', color: '#555' }}>Inputs Used</summary>
               <pre style={{ fontSize: '0.85em', backgroundColor: '#eee', padding: '5px', borderRadius: '3px', marginTop: '3px', whiteSpace: 'pre-wrap' }}>
                 {JSON.stringify(log.inputs_used, null, 2)}
               </pre>
            </details>
            {/* Display Main Output (Summary for create_record) */}                         
             <details style={{ marginTop: '4px', cursor: 'pointer' }} open={log.status === 'error' || log.status === 'partial_success'}>               
               <summary style={{ fontSize: '0.9em', color: '#555' }}>Output / Summary</summary>
               <pre style={{ fontSize: '0.85em', backgroundColor: log.status === 'error' ? '#fed7d7' : (log.status === 'partial_success' ? '#feebc8' : '#eee'), padding: '5px', borderRadius: '3px', marginTop: '3px', whiteSpace: 'pre-wrap' }}>
                 {formatLogOutput(log.output)}
               </pre>
            </details>

            {/* Display Details if present (for create_record loop) */}
            {log.details && log.details.length > 0 && (
                <details style={{ marginTop: '4px', cursor: 'pointer' }}>
                    <summary style={{ fontSize: '0.9em', color: '#555' }}>Details ({log.details.length} items)</summary>
                    {log.details.map((item, itemIdx) => (
                        <div key={itemIdx} style={{ borderLeft: `3px solid ${item.status === 'error' ? '#f56565' : '#48bb78'}`, marginLeft: '5px', marginTop: '5px', paddingLeft: '5px' }}>
                             <p style={{margin: '2px 0', fontSize: '0.9em'}}><strong>Item {itemIdx+1}:</strong> Status: {item.status}</p>
                             <details style={{cursor: 'pointer'}}>
                                 <summary style={{ fontSize: '0.85em', color: '#555'}}>Input Candidate</summary>
                                 <pre style={{ fontSize: '0.8em', backgroundColor: '#eee', padding: '3px', borderRadius: '3px', marginTop: '2px', whiteSpace: 'pre-wrap' }}>
                                     {JSON.stringify(item.input_candidate, null, 2)}
                                 </pre>
                             </details>
                             <details style={{cursor: 'pointer'}} open={item.status === 'error'}>
                                 <summary style={{ fontSize: '0.85em', color: '#555'}}>Output</summary>
                                 <pre style={{ fontSize: '0.8em', backgroundColor: item.status === 'error' ? '#fed7d7' : '#eee', padding: '3px', borderRadius: '3px', marginTop: '2px', whiteSpace: 'pre-wrap' }}>
                                     {formatLogOutput(item.output)}
                                 </pre>
                             </details>
                        </div>
                    ))}
                </details>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}