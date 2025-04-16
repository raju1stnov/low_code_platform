import React, { useEffect, useState } from 'react';
import axios from 'axios';

const AgentsPanel = () => {
  const [agents, setAgents] = useState([]);

  useEffect(() => {
    fetchAgents();
  }, []);

  const fetchAgents = async () => {
    const res = await axios.get('/api/agents');
    setAgents(res.data);
  };

  return (
    <div>
      <h3>Marketplace_Agent</h3>
      <button onClick={fetchAgents}>Refresh</button>

      {agents.map((agent) => (
        <div key={agent.name} style={{ marginBottom: '1rem' }}>
          <strong>{agent.name}</strong>
          <ul style={{ paddingLeft: '1rem' }}>
            {agent.methods &&
              agent.methods.map((m) => (
                <li
                  key={m.name}
                  draggable
                  onDragStart={(e) =>
                    e.dataTransfer.setData(
                      'application/reactflow',
                      JSON.stringify({ agent: agent.name, method: m.name })
                    )
                  }
                  style={{ cursor: 'grab', color: '#1d4ed8' }}
                >
                  {m.name}
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
};

export default AgentsPanel;
