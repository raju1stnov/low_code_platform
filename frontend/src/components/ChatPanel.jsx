import React, { useState, useRef, useEffect, useCallback } from 'react';
import axios from 'axios';

// Helper to render different message types (text, table, image, error)
// (Similar to renderAiMessageContent from previous response)
const renderMessageContent = (msg) => {
   if (!msg || !msg.content) return <p>...</p>; // Handle loading or empty

   if (msg.sender === 'user') {
       return <p style={{ margin: 0 }}>{msg.content}</p>;
   }

   // AI messages
   const type = msg.type || 'text'; // Default to text
   const content = msg.content;

   if (type === 'text') {
       return <p style={{ margin: 0 }}>{typeof content === 'string' ? content : JSON.stringify(content)}</p>;
   }
   if (type === 'image' && typeof content === 'string') {
       return <img src={`data:image/png;base64,${content}`} alt="Generated visualization" style={{ maxWidth: '100%', height: 'auto', marginTop: '5px', border: '1px solid #eee' }} />;
   }
   if (type === 'table' || type === 'table_with_viz_error') {
       const summary = content?.summary || (type === 'table_with_viz_error' ? "Could not generate visualization." : "Query Results:");
       const data = content?.data;

       if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && data[0] !== null) {
           const headers = Object.keys(data[0]);
           return (
               <div style={{fontFamily: 'monospace', fontSize: '0.85em'}}>
                   <p style={{ margin: '0 0 5px 0', fontStyle: 'italic', fontFamily:'sans-serif' }}>{summary}</p>
                   {type === 'table_with_viz_error' && <p style={{ margin: '0 0 5px 0', color: 'orange', fontSize: '0.9em', fontFamily:'sans-serif' }}>(Visualization failed, showing table data)</p>}
                   <div style={{ maxHeight: '300px', overflow: 'auto', border: '1px solid #ccc' }}>
                       <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                           <thead>
                               <tr style={{ backgroundColor: '#f0f0f0', position: 'sticky', top: 0 }}>
                                   {headers.map(header => <th key={header} style={{ border: '1px solid #ddd', padding: '4px 6px', textAlign: 'left' }}>{header}</th>)}
                               </tr>
                           </thead>
                           <tbody>
                               {data.map((row, index) => (
                                   <tr key={index} style={{backgroundColor: index % 2 ? '#f9f9f9' : 'white'}}>
                                       {headers.map(header => <td key={header} style={{ border: '1px solid #ddd', padding: '4px 6px', verticalAlign: 'top' }}>{typeof row[header] === 'object' ? JSON.stringify(row[header]) : String(row[header])}</td>)}
                                   </tr>
                               ))}
                           </tbody>
                       </table>
                   </div>
               </div>
           );
       } else if (Array.isArray(data) && data.length === 0) {
           return <div><p style={{ margin: '0 0 5px 0', fontStyle: 'italic', fontFamily:'sans-serif' }}>{summary}</p><p>(No results found)</p></div>;
       }
        else if (content) { // Fallback for non-array data or other structures
           return <div><p style={{ margin: '0 0 5px 0', fontStyle: 'italic', fontFamily:'sans-serif' }}>{summary}</p><pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{JSON.stringify(content, null, 2)}</pre></div>;
       } else {
           return <p style={{ margin: 0 }}>{summary || '(No specific data returned)'}</p>;
       }
   }
   if (type === 'error') {
       const errorContent = typeof content?.error === 'object' ? JSON.stringify(content.error) : String(content);
       return <p style={{ margin: 0, color: 'red' }}>Error: {errorContent}</p>;
   }
   // Fallback for unknown types
   return <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{JSON.stringify(content, null, 2)}</pre>;
};


function ChatPanel({ sessionId = "default" }) { // Simplified props for now
    const [messages, setMessages] = useState([]); // Store only messages for the current session
    const [availableSinks, setAvailableSinks] = useState([]);
    const [selectedSinkId, setSelectedSinkId] = useState(''); // Store the selected sink ID
    const [input, setInput] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [error, setError] = useState('');
    const messagesEndRef = useRef(null);

    // Fetch available sinks on mount
    const fetchSinks = useCallback(async () => {
        try {
            const res = await axios.get('/api/sinks');
            if (Array.isArray(res.data)) {
                setAvailableSinks(res.data);
                // Optionally select the first sink by default
                if (res.data.length > 0 && !selectedSinkId) {
                    setSelectedSinkId(res.data[0].sink_id);
                }
            } else {
                console.error("Received non-array response from /api/sinks:", res.data);
                setError("Could not load available data sources.");
            }
        } catch (err) {
            console.error('Failed to fetch sinks:', err);
            setError(err.response?.data?.detail || err.message || 'Failed to load data sources.');
        }
    }, [selectedSinkId]); // Refetch shouldn't depend on selectedSinkId here

    useEffect(() => {
        fetchSinks();
    }, [fetchSinks]); // Fetch sinks once on mount

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(scrollToBottom, [messages]);

    const handleSend = async () => {
        if (!input.trim() || isSending) return;

        setIsSending(true);
        setError('');
        const userMessage = { sender: 'user', content: input.trim(), type: 'text' };

        // Add user message to local state
        setMessages(prev => [...prev, userMessage]);
        const currentInput = input.trim(); // Capture input before clearing
        setInput('');

        try {
            const payload = {
                prompt: currentInput,
                session_id: sessionId,
                sink_id: selectedSinkId // Include selected sink ID
            };
            console.log("Sending to /api/chat:", payload);
            const res = await axios.post('/api/chat', payload);
            console.log("Received from /api/chat:", res.data);

            let aiMessage;
            if (res.data && res.data.response_type === 'error') {
                aiMessage = { sender: 'ai', content: res.data.response || { error: 'Unknown error from backend' }, type: 'error' };
                setError(JSON.stringify(aiMessage.content?.error || aiMessage.content));
            } else if (res.data && res.data.response && res.data.response_type) {
                aiMessage = {
                    sender: 'ai',
                    content: res.data.response,
                    type: res.data.response_type
                };
            } else {
                // Handle unexpected backend response format
                aiMessage = { sender: 'ai', content: { error: 'Invalid response format from server.' }, type: 'error' };
                setError('Invalid response format from server.');
            }
            // Add AI response to local state
            setMessages(prev => [...prev, aiMessage]);

        } catch (err) {
            console.error('Chat API error:', err);
            const errorMsg = err.response?.data?.detail || err.message || 'Failed to send message.';
            setError(`Network/Server Error: ${errorMsg}`);
            const errorMessage = { sender: 'ai', content: { error: errorMsg }, type: 'error' };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setIsSending(false);
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '400px', border: '1px solid #ccc', padding: '10px', marginTop: '10px', backgroundColor: '#f9f9f9', borderRadius: '5px' }}>
            {/* Sink Selection Dropdown */}
            <div style={{ marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <label htmlFor="sinkSelect" style={{ fontWeight: 'bold', fontSize: '0.9em' }}>Query Target:</label>
                <select
                    id="sinkSelect"
                    value={selectedSinkId}
                    onChange={(e) => setSelectedSinkId(e.target.value)}
                    disabled={availableSinks.length === 0}
                    style={{ flexGrow: 1, padding: '5px', fontSize: '0.9em', border: '1px solid #ccc', borderRadius: '3px' }}
                >
                    {availableSinks.length === 0 && <option>Loading sources...</option>}
                    {availableSinks.map(sink => (
                        <option key={sink.sink_id} value={sink.sink_id}>
                            {sink.name} ({sink.sink_id})
                        </option>
                    ))}
                </select>
            </div>

            {/* Message Display Area */}
            <div style={{ flexGrow: 1, overflowY: 'auto', marginBottom: '10px', border: '1px solid #e0e0e0', borderRadius: '3px', padding: '8px', backgroundColor: 'white' }}>
                {messages.map((msg, index) => (
                    <div key={index} style={{ marginBottom: '10px', display: 'flex', flexDirection: msg.sender === 'user' ? 'row-reverse' : 'row' }}>
                        <div style={{
                            padding: '8px 12px',
                            borderRadius: '15px',
                            backgroundColor: msg.sender === 'user' ? '#0b93f6' : '#e5e5ea',
                            color: msg.sender === 'user' ? 'white' : 'black',
                            maxWidth: '75%',
                            wordBreak: 'break-word',
                            // Ensure preformatted text within messages wraps
                            whiteSpace: msg.type === 'table' || msg.type === 'error' ? 'pre-wrap' : 'normal',
                        }}>
                            {renderMessageContent(msg)}
                        </div>
                    </div>
                ))}
                <div ref={messagesEndRef} /> {/* Anchor for scrolling */}
            </div>

            {/* Input Area */}
            {error && <p style={{ color: 'red', fontSize: '0.9em', margin: '0 0 5px 0', paddingLeft: '5px' }}>{error}</p>}
            <div style={{ display: 'flex' }}>
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                    placeholder={selectedSinkId ? `Ask about ${availableSinks.find(s=>s.sink_id===selectedSinkId)?.name || 'selected source'}...` : "Select a target to query..."}
                    disabled={isSending || !selectedSinkId}
                    style={{ flexGrow: 1, marginRight: '5px', padding: '10px', border: '1px solid #ccc', borderRadius: '15px' }}
                />
                <button
                    onClick={handleSend}
                    disabled={isSending || !input.trim() || !selectedSinkId}
                    style={{ padding: '10px 15px', borderRadius: '15px', border: 'none', backgroundColor: '#0b93f6', color: 'white', cursor: (isSending || !input.trim() || !selectedSinkId) ? 'not-allowed' : 'pointer' }}
                    >
                    {isSending ? '...' : 'Send'}
                </button>
            </div>
        </div>
    );
}

export default ChatPanel;