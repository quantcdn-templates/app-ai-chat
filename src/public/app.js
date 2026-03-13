import { html } from 'htm/preact';
import { render } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { ChatWindow } from './components/ChatWindow.js';
import { AgentPicker } from './components/AgentPicker.js';
import { ModelPicker } from './components/ModelPicker.js';

const formatToolName = (name) => (name ?? '').replace(/_/g, ' ');

function App() {
  const [messages, setMessages]           = useState([]);
  const [sessionId, setSessionId]         = useState(() => sessionStorage.getItem('sessionId'));
  const [models, setModels]               = useState([]);
  const [agents, setAgents]               = useState([]);
  const [selectedModel, setSelectedModel] = useState(null);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [streaming, setStreaming]         = useState(false);
  const [activeTools, setActiveTools]     = useState([]);
  const [completedTools, setCompleted]    = useState([]);
  const [toolsFading, setFading]          = useState(false);
  const [orchStatus, setOrchStatus]       = useState(null);
  const [input, setInput]                 = useState('');
  const [error, setError]                 = useState(null);
  const pollRef = useRef(null);

  // Load config, models, and agents on mount — fetched concurrently, resolved together
  // so QUANT_DEFAULT_MODEL is always applied before selecting the default model.
  useEffect(() => {
    Promise.all([
      fetch('/api/config').then((r) => r.json()).catch(() => ({})),
      fetch('/api/models').then((r) => r.json()).catch(() => null),
      fetch('/api/agents').then((r) => r.json()).catch(() => null),
    ]).then(([configData, modelsData, agentsData]) => {
      const defaultModelId = configData.defaultModel ?? 'amazon.nova-lite-v1:0';
      if (modelsData) {
        // SDK listAIModels returns { models: [{ id, name, ... }] }
        const list = modelsData.models ?? [];
        setModels(list);
        const preferred = list.find((m) => m.id === defaultModelId) ?? list[0];
        setSelectedModel(preferred?.id ?? null);
      } else {
        setError('Failed to load models');
      }
      if (agentsData) {
        setAgents(agentsData.agents ?? []);
      }
    });
  }, []);

  // Clear poll interval on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Persist sessionId
  useEffect(() => {
    if (sessionId) sessionStorage.setItem('sessionId', sessionId);
    else sessionStorage.removeItem('sessionId');
  }, [sessionId]);

  const clearSession = useCallback(() => {
    setSessionId(null);
    setMessages([]);
    setActiveTools([]);
    setCompleted([]);
    setOrchStatus(null);
  }, []);

  const handleAgentChange = (agentId) => {
    setSelectedAgent(agentId);
    clearSession();
  };

  const handleModelChange = (modelId) => {
    setSelectedModel(modelId);
    clearSession();
  };

  const finalizeTurn = useCallback(() => {
    setStreaming(false);
    setActiveTools([]);
    setFading(true);
    setTimeout(() => {
      setCompleted([]);
      setFading(false);
    }, 700);
  }, []);

  // Orchestration polling — proxied through /api/orchestration/poll to keep token server-side
  const startOrchestrationPoll = useCallback((pollUrl) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/orchestration/poll?url=${encodeURIComponent(pollUrl)}`);
        const data = await r.json();
        setOrchStatus(data.message ?? `Status: ${data.status}`);
        if (data.status === 'complete' || data.status === 'failed') {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setOrchStatus(null);
          if (data.synthesizedResponse) {
            setMessages((prev) => [...prev, { role: 'assistant', content: data.synthesizedResponse }]);
          }
          finalizeTurn();
        }
      } catch {
        clearInterval(pollRef.current);
        pollRef.current = null;
        setOrchStatus(null);
        finalizeTurn();
      }
    }, 2000);
  }, [finalizeTurn]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    setError(null);

    // Ensure session exists
    let sid = sessionId;
    if (!sid) {
      try {
        const r = await fetch('/api/sessions', { method: 'POST' });
        const data = await r.json();
        sid = data.sessionId;
        setSessionId(sid);
      } catch {
        setError('Failed to create session');
        return;
      }
    }

    // Optimistically add user message
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setStreaming(true);
    setActiveTools([]);
    setCompleted([]);
    setOrchStatus(null);

    // Track whether the assistant message slot has been pushed yet
    let assistantAdded = false;

    try {
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          sessionId: sid,
          modelId: selectedAgent ? null : selectedModel,
          agentId: selectedAgent,
        }),
      });

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line === '') {
            // SSE spec: blank line = event boundary, reset type
            currentEvent = '';
          } else if (line.startsWith('data: ')) {
            const raw = line.slice(6);
            if (raw === '[DONE]') continue;
            let data;
            try { data = JSON.parse(raw); } catch { continue; }

            switch (currentEvent) {
              case 'content': {
                const delta = data.delta ?? '';
                if (!assistantAdded) {
                  setMessages((prev) => [...prev, { role: 'assistant', content: delta }]);
                  assistantAdded = true;
                } else {
                  setMessages((prev) => {
                    const next = [...prev];
                    const last = next[next.length - 1];
                    next[next.length - 1] = { ...last, content: last.content + delta };
                    return next;
                  });
                }
                break;
              }
              case 'session': {
                // Agent path: confirm/update sessionId
                if (data.sessionId) setSessionId(data.sessionId);
                break;
              }
              case 'tool_start': {
                const label = `Running: ${formatToolName(data.name)}...`;
                setActiveTools((prev) => [...prev, { name: data.name, label }]);
                break;
              }
              case 'tool_input_progress': {
                const label = `Preparing: ${formatToolName(data.name)}...`;
                setActiveTools((prev) => {
                  const next = [...prev];
                  const idx = next.findLastIndex((t) => t.name === data.name);
                  if (idx !== -1) next[idx] = { ...next[idx], label };
                  return next;
                });
                break;
              }
              case 'tool_complete': {
                setActiveTools((prev) => prev.filter((t) => t.name !== data.name));
                setCompleted((prev) => [...prev, { name: data.name, result: data.result, index: prev.length }]);
                break;
              }
              case 'tool_request': {
                // v1: client-side tool execution not supported
                // TODO: local tool execution hook — intercept here, call your own handler,
                // then POST back to /api/chat/stream with the tool result and sessionId.
                setError(`Agent requested client-side tool "${data.name}" (not supported in this starter kit)`);
                break;
              }
              case 'orchestration_status': {
                // May be emitted by some portal relay configurations
                if (data.message) setOrchStatus(data.message);
                break;
              }
              case 'done': {
                if (data.complete === true) {
                  finalizeTurn();
                } else if (data.complete === false && data.stopReason === 'tool_request') {
                  // TODO: local tool execution hook — intercept pendingTools here,
                  // run your own handlers, POST results back to continue the conversation.
                  setError('Agent requested a client-side tool (not supported in this starter kit)');
                  finalizeTurn();
                } else if (data.complete === false && data.orchestration?.pollUrl) {
                  // SSE stream closes here; poll for completion via backend proxy
                  startOrchestrationPoll(data.orchestration.pollUrl);
                  // Note: finalizeTurn() is called by the poll handler when complete —
                  // streaming intentionally stays true (spinner remains) during polling
                }
                break;
              }
              case 'error': {
                setError(data.error ?? 'An error occurred');
                finalizeTurn();
                break;
              }
              // start, turn_start, tool_round, keepalive: informational, no UI action
              default: break;
            }
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Stream failed');
      finalizeTurn();
    }
  }, [input, streaming, sessionId, selectedModel, selectedAgent, finalizeTurn, startOrchestrationPoll]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return html`
    <div class="app">
      <header class="toolbar">
        <span class="logo">AI Chat</span>
        <${AgentPicker} agents=${agents} selectedAgent=${selectedAgent} onChange=${handleAgentChange} />
        <${ModelPicker}
          models=${models}
          selectedModel=${selectedModel}
          onChange=${handleModelChange}
          disabled=${!!selectedAgent}
        />
      </header>

      <${ChatWindow}
        messages=${messages}
        activeTools=${activeTools}
        completedTools=${completedTools}
        orchStatus=${orchStatus}
        toolsFading=${toolsFading}
        streaming=${streaming}
      />

      ${error && html`<div class="error-bar" role="alert">${error} <button onClick=${() => setError(null)}>✕</button></div>`}

      <div class="input-bar">
        <textarea
          class="input-field"
          placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
          value=${input}
          onInput=${(e) => setInput(e.target.value)}
          onKeyDown=${handleKeyDown}
          disabled=${streaming}
          rows="1"
        />
        <button
          class="send-btn"
          onClick=${sendMessage}
          disabled=${streaming || !input.trim()}
        >
          ${streaming ? '…' : 'Send'}
        </button>
      </div>
    </div>
  `;
}

render(html`<${App} />`, document.getElementById('app'));
