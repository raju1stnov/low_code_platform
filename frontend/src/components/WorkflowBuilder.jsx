import React, { useCallback, useRef } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState, // We can keep using these hooks locally if preferred
  useEdgesState, // OR receive state via props as done in App.jsx
  Position, // Import Position for handles
} from 'reactflow';
import 'reactflow/dist/style.css';

// Receive nodes, setNodes, edges, setEdges as props from App.jsx
const WorkflowBuilder = ({ nodes, setNodes, edges, setEdges }) => {
  const reactFlowWrapper = useRef(null);
  // Use the passed-in state and setters directly
  const onNodesChange = useCallback((changes) => setNodes((nds) => applyNodeChanges(changes, nds)), [setNodes]);
  const onEdgesChange = useCallback((changes) => setEdges((eds) => applyEdgeChanges(changes, eds)), [setEdges]);

  // Local state for the ReactFlow instance if needed for projection
  const [reactFlowInstance, setReactFlowInstance] = React.useState(null);

  const onConnect = useCallback(
    (params) => {
      console.log('Connecting:', params);
      // Ensure edges have a distinct style or type if needed
      setEdges((eds) => addEdge({ ...params, type: 'smoothstep', animated: true, style: { stroke: '#007bff' } }, eds));
    },
    [setEdges]
  );

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();

      if (!reactFlowInstance || !reactFlowWrapper.current) {
        console.error("ReactFlow instance or wrapper not ready for drop");
        return;
      }

      const reactflowBounds = reactFlowWrapper.current.getBoundingClientRect();
      // Extract agent/method data from the dragged item
      const dataString = event.dataTransfer.getData('application/reactflow');
      if (!dataString) {
        console.error("No data found in drag event");
        return;
      }
      const data = JSON.parse(dataString);

      // Calculate position where the node should be placed
      const position = reactFlowInstance.project({
        x: event.clientX - reactflowBounds.left,
        y: event.clientY - reactflowBounds.top,
      });

      // Create a unique ID for the new node
      const newNodeId = `${data.agent}-${data.method}-${+new Date()}`; // More robust ID
      const newNode = {
        id: newNodeId,
        type: 'default', // Use default node type, can customize later
        position,
        data: {
          label: `${data.agent}.${data.method}`, // Display agent.method as label
          agent: data.agent,
          method: data.method,
          // inputs: {} // Placeholder for node-specific static inputs if needed later
        },
        // Add handles for connections
        sourcePosition: Position.Right, // Output handle on the right
        targetPosition: Position.Left,  // Input handle on the left
        style: { // Basic styling
             background: '#f0f0f0',
             border: '1px solid #aaa',
             borderRadius: '4px',
             padding: '10px',
             fontSize: '12px',
             minWidth: '150px', // Ensure nodes have some width
             textAlign: 'center'
        }
      };

      console.log('Adding new node:', newNode);
      // Add the new node to the existing nodes state
      setNodes((nds) => nds.concat(newNode));
    },
    [reactFlowInstance, setNodes] // Include setNodes in dependencies
  );

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move'; // Indicate it's a valid drop target
  }, []);

  // Optional: Function to apply node changes (if using useNodesState locally)
  const applyNodeChanges = (changes, currentNodes) => {
     return changes.reduce((acc, change) => {
        if (change.type === 'add') return [...acc, change.item];
        if (change.type === 'remove') return acc.filter(node => node.id !== change.id);
        if (change.type === 'position' || change.type === 'dimensions' || change.type === 'select') {
           return acc.map(node => node.id === change.id ? {...node, ...change} : node);
        }
        return acc; // default includes 'reset' etc if needed
     }, currentNodes);
  };

  // Optional: Function to apply edge changes (if using useEdgesState locally)
   const applyEdgeChanges = (changes, currentEdges) => {
     return changes.reduce((acc, change) => {
        if (change.type === 'add') return [...acc, change.item];
        if (change.type === 'remove') return acc.filter(edge => edge.id !== change.id);
        // Add other edge change types if needed
        return acc;
     }, currentEdges);
  };


  return (
    // Ensure the wrapper has definite height for ReactFlow to render
    <div ref={reactFlowWrapper} style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange} // Use the passed-in setter via this handler
        onEdgesChange={onEdgesChange} // Use the passed-in setter via this handler
        onConnect={onConnect}
        onInit={setReactFlowInstance} // Capture instance for coordinate projection
        onDrop={onDrop}
        onDragOver={onDragOver}
        fitView // Adjust view to fit nodes on load/change
        attributionPosition="top-right" // Optional: position ReactFlow attribution
        nodeTypes={{}} // Define custom node types here later if needed
        edgeTypes={{}} // Define custom edge types here later if needed
      >
        <MiniMap nodeStrokeWidth={3} zoomable pannable />
        <Controls />
        <Background variant="dots" gap={12} size={1} />
      </ReactFlow>
    </div>
  );
};

export default WorkflowBuilder;