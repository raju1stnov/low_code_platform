import React, { useState } from 'react';
import axios from 'axios';

export default function RunPanel() {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('secret');
  const [title, setTitle] = useState('Data Scientist');
  const [skills, setSkills] = useState('Python,Machine Learning');
  const [logs, setLogs] = useState([]);

  const handleRun = async () => {
    const workflow = {
      startNodeId: 'node1',
      nodes: [
        {
          id: 'node1',
          agent: 'auth_agent',
          method: 'login',
          inputs: { username, password },
          next: 'node2',
        },
        {
          id: 'node2',
          agent: 'webservice_agent',
          method: 'search_candidates',
          inputs: { title, skills },
          next: '',
        },
      ],
    };

    try {
      const res = await axios.post('/api/run_workflow', workflow);
      setLogs(res.data.logs || []);
    } catch (err) {
      console.error(err);
      setLogs([
        {
          nodeId: 'ERROR',
          agent: '',
          method: '',
          inputs: {},
          output: err.message,
        },
      ]);
    }
  };

  return (
    <div>
      <h3>Run Workflow</h3>
      <div>
        <input
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <br />
        <input
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <br />
        <input
          placeholder="Job Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <br />
        <input
          placeholder="Skills"
          value={skills}
          onChange={(e) => setSkills(e.target.value)}
        />
        <br />
        <button onClick={handleRun}>Run</button>
      </div>

      <h4>Execution Logs</h4>
      {logs.map((log, idx) => (
        <div
          key={idx}
          style={{
            border: '1px solid #ccc',
            marginTop: 5,
            padding: 5,
          }}
        >
          <p>
            <strong>{log.agent}.{log.method}</strong>
          </p>
          <p>Inputs: {JSON.stringify(log.inputs)}</p>
          <p>Output: {JSON.stringify(log.output)}</p>
        </div>
      ))}
    </div>
  );
}
