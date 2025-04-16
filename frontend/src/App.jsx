import React from 'react';
import AgentsPanel from './components/AgentsPanel.jsx';
import WorkflowBuilder from './components/WorkflowBuilder.jsx';
import RunPanel from './components/RunPanel.jsx';

export default function App() {
  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <div style={{ width: '20%', borderRight: '1px solid #ccc', padding: 10 }}>
        <AgentsPanel />
      </div>
      <div style={{ width: '50%', borderRight: '1px solid #ccc' }}>
        <WorkflowBuilder />
      </div>
      <div style={{ width: '30%', padding: 10 }}>
        <RunPanel />
      </div>
    </div>
  );
}
