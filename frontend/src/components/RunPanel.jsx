import React, { useState, useEffect, useCallback } from 'react'; // Removed useEffect as it wasn't used here
import axios from 'axios';

// Receive nodes and edges as props from App.jsx
export default function RunPanel({ nodes, edges, agents }) {
  // Holds the definition of inputs needed { name, type, description }
  const [dynamicInputs, setDynamicInputs] = useState([]);
  // Holds the current values entered by the user { paramName: value, ... }
  const [inputValues, setInputValues] = useState({});

  // Other state variables (logs, isRunning, runStatus, save workflow state) remain the same
  const [logs, setLogs] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [runStatus, setRunStatus] = useState(''); // e.g., 'completed', 'failed'

  // State for Saving Workflow
  const [compositeName, setCompositeName] = useState('');
  const [compositeDescription, setCompositeDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [saveError, setSaveError] = useState('');

  // useEffect to determine required inputs from all nodes---
  useEffect(() => {
    const calculateRequiredInputs = () => {
      const required = new Map(); // Use Map to easily handle duplicates by key (param name)

      // Check if necessary props are available
      if (!nodes || !agents || agents.length === 0) {
          setDynamicInputs([]);
          // setInputValues({}); // Optionally clear values when workflow is empty
          return;
      }
      
      // --- Iterate through ALL nodes, not just start nodes ---
      nodes.forEach(node => {
        // Basic validation for node data structure
        if (!node || !node.data || !node.data.agent || !node.data.method) {
            console.warn(`Skipping node ${node?.id} due to missing data.`);
            return; // Skip this node if essential data is missing
        }

        // Find agent metadata
        const agentMeta = agents.find(a => a.name === node.data.agent);
        if (!agentMeta) {
            console.warn(`Metadata not found for agent: ${node.data.agent}`);
            return; // Skip if agent metadata not found
        }
        if (!agentMeta.methods || !Array.isArray(agentMeta.methods)) {
            console.warn(`No methods array found for agent: ${node.data.agent}`);
            return; // Skip if methods array is missing or invalid
        }

        // Find method metadata
        const methodMeta = agentMeta.methods.find(m => m.name === node.data.method);
        if (!methodMeta) {
            console.warn(`Metadata not found for method: ${node.data.agent}.${node.data.method}`);
            return; // Skip if method metadata not found
        }
        // Ensure params exist and is an array before iterating
        if (methodMeta.params && Array.isArray(methodMeta.params)) {
            methodMeta.params.forEach(param => {
                // Check if param has a name before adding
                if (param && param.name) {
                    // Store param info using name as key to avoid duplicates
                    // If the same param name is required by multiple nodes,
                    // the last one encountered will overwrite, which is usually fine.
                    required.set(param.name, {
                        name: param.name,
                        type: param.type || 'string', // Default to string if type missing
                        description: param.description || '',
                        required: param.required || false // Keep track if metadata provides this
                    });
                } else {
                   console.warn(`Invalid parameter format found in ${node.data.agent}.${node.data.method}:`, param);
                }
            });
        }
        // If methodMeta.params is missing or not an array, we simply don't add any params for this method.
      });
      // --- End of iteration through ALL nodes ---

      // Convert map values to array for rendering
      const newDynamicInputs = Array.from(required.values());
      setDynamicInputs(newDynamicInputs);

      // Initialize inputValues state for new inputs, preserving existing ones
      // (This logic remains the same as before)
      setInputValues(prevValues => {
          const newValues = { ...prevValues };
          newDynamicInputs.forEach(input => {
              if (!(input.name in newValues)) {
                  newValues[input.name] = ''; // Initialize new inputs
              }
          });
          // Optional: You might want to remove values from inputValues
          // if the corresponding input is no longer in newDynamicInputs
          Object.keys(newValues).forEach(key => {
             if (!required.has(key)) {
                delete newValues[key];
             }
          });
          return newValues;
      });
    };
    calculateRequiredInputs();
    // Recalculate whenever nodes, edges, or the agent metadata changes
  }, [nodes, edges, agents]);
  // --- END MODIFIED ---

  // Handler for updating dynamic input values ---
  const handleInputChange = useCallback((event) => {
    const { name, value, type, checked } = event.target;
    setInputValues(prevValues => ({
      ...prevValues,
      // Handle checkboxes differently if needed in the future
      [name]: type === 'checkbox' ? checked : value
    }));
  }, []); // No dependencies needed as it only uses event and setter


  const handleRun = async () => {
    if (isRunning) return;
    setIsRunning(true);
    setLogs([]);
    setRunStatus('Running...');

    const backendNodes = nodes.map(node => ({
      id: node.id,
      type: node.type,
      position: node.position,
      data: {
        label: node.data.label,
        agent: node.data.agent,
        method: node.data.method
      }
    }));

    const backendEdges = edges.map(edge => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: edge.type
    }));

    // --- MODIFIED: Use dynamic inputValues for initial_inputs ---  
    const processedInputValues = { ...inputValues };

    // --- MODIFIED: Include new inputs in the payload ---
    const workflowPayload = {
      nodes: backendNodes,
      edges: backendEdges,   
      initial_inputs: processedInputValues, // Use the collected dynamic values
    };

    console.log('Sending workflow to backend:', workflowPayload);

    try {
      const res = await axios.post('/api/run_workflow', workflowPayload);
      console.log('Backend response:', res.data);
      setLogs(res.data.logs || []);
      setRunStatus(res.data.status || 'completed');
    } catch (err) {
      console.error('Workflow execution error:', err);
      let errorMsg = 'An unexpected error occurred.';
      let errorDetail = {};
      if (err.response && err.response.data && err.response.data.detail) {
        errorMsg = `Error: ${err.response.data.detail}`;
        errorDetail = { code: err.response.status, message: err.response.data.detail };
      } else if (err.request) {
        errorMsg = 'Network Error: Could not reach the backend.';
        errorDetail = { message: errorMsg };
      } else {
        errorMsg = err.message;
        errorDetail = { message: errorMsg };
      }
      setLogs([{
        nodeId: 'WORKFLOW_ERROR',
        agent: 'System',
        method: 'Execution',
        status: 'error',
        inputs_used: workflowPayload.initial_inputs,
        output: { error: errorDetail },
        duration_ms: 0
      }]);
      setRunStatus('failed');
    } finally {
      setIsRunning(false);
    }
  };

  const handleSaveWorkflow = async () => {
    if (isSaving || !compositeName.trim()) {
      setSaveError("Please provide a name for the composite agent.");
      return;
    }
    if (nodes.length === 0) {
      setSaveError("Cannot save an empty workflow.");
      return;
    }

    setIsSaving(true);
    setSaveMessage('');
    setSaveError('');

    const backendNodes = nodes.map(node => ({ id: node.id, type: node.type, position: node.position, data: { label: node.data.label, agent: node.data.agent, method: node.data.method } }));
    const backendEdges = edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, type: edge.type }));

    const savePayload = {
      name: compositeName.trim(),
      description: compositeDescription.trim(),
      nodes: backendNodes,
      edges: backendEdges,
    };

    console.log("Sending save request:", savePayload);

    try {
      const res = await axios.post('/api/register_composite', savePayload);
      setSaveMessage(res.data.message || "Workflow saved successfully!");
      setCompositeName('');
      setCompositeDescription('');
      alert("Workflow saved! Please refresh the Agents panel to see it.");
    } catch (err) {
      console.error("Failed to save workflow:", err);
      let errorMsg = 'Failed to save workflow.';
      if (err.response && err.response.data && err.response.data.detail) {
        errorMsg += ` Error: ${err.response.data.detail}`;
      } else if (err.request) {
        errorMsg = 'Network Error: Could not reach the backend.';
      } else {
        errorMsg = `Error: ${err.message}`;
      }
      setSaveError(errorMsg);
      setSaveMessage('');
    } finally {
      setIsSaving(false);
    }
  };

  const formatLogOutput = (output) => {
    if (typeof output === 'object' && output !== null) {
      if (output.error) {
        const errorInfo = output.error;
        return `Error (Code: ${errorInfo.code || 'N/A'}): ${errorInfo.message || JSON.stringify(errorInfo)}`;
      }
      return JSON.stringify(output, null, 2);
    }
    return String(output);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Runtime Inputs Form */}
      <div style={{ marginBottom: '1rem', borderBottom: '1px solid #eee', paddingBottom: '1rem' }}>
        <h4>Runtime Inputs</h4>
        {/* --- MODIFIED: Dynamic input rendering --- */}
        {dynamicInputs.length === 0 && nodes.length > 0 && <p style={{fontSize: '0.9em', color: '#666'}}>No initial inputs required based on method parameters.</p>}
        {nodes.length === 0 && <p style={{fontSize: '0.9em', color: '#666'}}>Build a workflow to see required inputs.</p> }

        <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '5px', alignItems: 'center' }}>
          {dynamicInputs.map(input => (
            <React.Fragment key={input.name}>
              <label htmlFor={input.name} title={input.description || input.name}>
                {/* Simple capitalization for label */}
                {input.name.charAt(0).toUpperCase() + input.name.slice(1)}:
              </label>
              <input
                id={input.name}
                name={input.name}
                // Basic type handling (can be expanded)
                type={input.name.toLowerCase().includes('password') ? 'password' : (input.type === 'integer' || input.type === 'number' ? 'number' : 'text')}
                placeholder={input.description || input.name}
                value={inputValues[input.name] || ''} // Ensure controlled component
                onChange={handleInputChange}
                style={{ width: '95%' }}
                required={input.required} // Use required flag from metadata if available              
              />
            </React.Fragment>
          ))}
        </div>

        <button 
          onClick={handleRun}
          disabled={isRunning || nodes.length === 0}
          style={{ marginTop: '10px', padding: '8px 15px', cursor: (isRunning || nodes.length === 0) ? 'not-allowed' : 'pointer' }}
          >
          {isRunning ? 'Running...' : 'Run Workflow'}
        </button>
        {runStatus && <p style={{ marginTop: '5px', fontWeight: 'bold' }}>Status: {runStatus}</p>}
      </div>

      {/* Section to Save Workflow */}
      <div style={{ marginBottom: '1rem', borderBottom: '1px solid #eee', paddingBottom: '1rem' }}>
            <h4>Save Workflow as Agent</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '5px', alignItems: 'center' }}>
                 <label htmlFor="compName">Agent Name*:</label>
                 <input
                     id="compName"
                     placeholder="e.g., LogAnalysisWorkflow" // Updated placeholder suggestion
                     value={compositeName}
                     onChange={(e) => setCompositeName(e.target.value)}
                     style={{ width: '95%' }}
                     required
                 />
                 <label htmlFor="compDesc">Description:</label>
                 <input
                     id="compDesc"
                     placeholder="Optional description"
                     value={compositeDescription}
                     onChange={(e) => setCompositeDescription(e.target.value)}
                     style={{ width: '95%' }}
                 />
            </div>
            <button onClick={handleSaveWorkflow} disabled={isSaving || nodes.length === 0} style={{ marginTop: '10px', padding: '8px 15px', cursor: (isSaving || nodes.length === 0) ? 'not-allowed' : 'pointer' }}>
                 {isSaving ? 'Saving...' : 'Save Workflow'}
            </button>
            {saveMessage && <p style={{ color: 'green', marginTop: '5px' }}>{saveMessage}</p>}
            {saveError && <p style={{ color: 'red', marginTop: '5px' }}>{saveError}</p>}
       </div>

      {/* Execution Logs Area , it will display logs from any workflow) */}
      <div style={{ flexGrow: 1, overflowY: 'auto' }}>
        <h4>Execution Logs</h4>
        {logs.length === 0 && !isRunning && <p>No logs yet. Build a workflow and click Run.</p>}
        {logs.map((log, idx) => (
          <div
            key={idx}
            style={{
              border: `1px solid ${log.status === 'error' ? '#f56565' : (log.status === 'partial_success' ? '#ecc94b' : '#ccc')}`,
              backgroundColor: log.status === 'error' ? '#fff5f5' : (log.status === 'partial_success' ? '#fffbeb' : '#f9f9f9'),
              marginBottom: '8px',
              padding: '8px',
              fontSize: '0.9em',
              wordBreak: 'break-word'
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
                 color: log.status === 'error' ? '#c53030' : (log.status === 'partial_success' ? '#b7791f' : '#38a169'),
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
            <details style={{ marginTop: '4px', cursor: 'pointer' }} open={log.status === 'error' || log.status === 'partial_success'}>
               <summary style={{ fontSize: '0.9em', color: '#555' }}>Output / Summary</summary>
               <pre style={{ fontSize: '0.85em', backgroundColor: log.status === 'error' ? '#fed7d7' : (log.status === 'partial_success' ? '#feebc8' : '#eee'), padding: '5px', borderRadius: '3px', marginTop: '3px', whiteSpace: 'pre-wrap' }}>
                 {formatLogOutput(log.output)}
               </pre>
            </details>
            {/* Details section (if applicable, e.g., for composite agents) */}
            {log.details && log.details.length > 0 && ( <details style={{ marginTop: '4px', cursor: 'pointer' }}> <summary style={{ fontSize: '0.9em', color: '#555' }}>Details ({log.details.length} items)</summary> {log.details.map((item, itemIdx)=>( <div key={itemIdx} style={{ borderLeft: `3px solid ${item.status === 'error' ? '#f56565' : '#48bb78'}`, marginLeft: '5px', marginTop: '5px', paddingLeft: '5px' }}> <p style={{margin: '2px 0', fontSize: '0.9em'}}><strong>Item {itemIdx+1}:</strong> Status: {item.status}</p> <details style={{cursor: 'pointer'}}> <summary style={{ fontSize: '0.85em', color: '#555'}}>Input Candidate</summary> <pre style={{ fontSize: '0.8em', backgroundColor: '#eee', padding: '3px', borderRadius: '3px', marginTop: '2px', whiteSpace: 'pre-wrap' }}> {JSON.stringify(item.input_candidate, null, 2)} </pre> </details> <details style={{cursor: 'pointer'}} open={item.status === 'error'}> <summary style={{ fontSize: '0.85em', color: '#555'}}>Output</summary> <pre style={{ fontSize: '0.8em', backgroundColor: item.status === 'error' ? '#fed7d7' : '#eee', padding: '3px', borderRadius: '3px', marginTop: '2px', whiteSpace: 'pre-wrap' }}> {formatLogOutput(item.output)} </pre> </details> </div> ))} </details> )}
          </div>
        ))}
      </div>
    </div>
  );
}