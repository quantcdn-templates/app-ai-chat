import { html } from 'htm/preact';
import { render } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { ChatWindow } from './components/ChatWindow.js';
import { AgentPicker } from './components/AgentPicker.js';
import { ModelPicker } from './components/ModelPicker.js';

const formatToolName = (name) => (name ?? '').replace(/_/g, ' ');

// Maps browser MIME types to API { kind, format } descriptors
const MIME_MAP = {
  'image/jpeg':  { kind: 'image',    format: 'jpeg' },
  'image/png':   { kind: 'image',    format: 'png'  },
  'image/gif':   { kind: 'image',    format: 'gif'  },
  'image/webp':  { kind: 'image',    format: 'webp' },
  'application/pdf': { kind: 'document', format: 'pdf'  },
  'text/csv':    { kind: 'document', format: 'csv'  },
  'text/plain':  { kind: 'document', format: 'txt'  },
  'text/markdown': { kind: 'document', format: 'md' },
  'text/html':   { kind: 'document', format: 'html' },
  'application/msword': { kind: 'document', format: 'doc' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { kind: 'document', format: 'docx' },
  'application/vnd.ms-excel': { kind: 'document', format: 'xls' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { kind: 'document', format: 'xlsx' },
};

async function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = (e) => resolve(e.target.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function processFiles(fileList) {
  const result = [];
  for (const file of fileList) {
    const meta = MIME_MAP[file.type];
    if (!meta) continue;
    const data       = await readFileAsBase64(file);
    const previewUrl = meta.kind === 'image' ? URL.createObjectURL(file) : null;
    result.push({ id: crypto.randomUUID(), ...meta, name: file.name, data, previewUrl });
  }
  return result;
}

function App() {
  const [messages, setMessages]           = useState([]);
  const [sessionId, setSessionId]         = useState(() => sessionStorage.getItem('sessionId'));
  const [models, setModels]               = useState(null);
  const [agents, setAgents]               = useState(null);
  const [selectedModel, setSelectedModel] = useState(null);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [streaming, setStreaming]         = useState(false);
  const [thinking, setThinking]           = useState(false);
  const [activeTools, setActiveTools]     = useState([]);
  const [completedTools, setCompleted]    = useState([]);
  const [toolsFading, setFading]          = useState(false);
  const [orchStatus, setOrchStatus]       = useState(null);
  const [input, setInput]                 = useState('');
  const [error, setError]                 = useState(null);
  const [attachments, setAttachments]     = useState([]);
  const [dragActive, setDragActive]       = useState(false);
  const [setupError, setSetupError]       = useState(null);
  const pollRef    = useRef(null);
  const fileInputRef = useRef(null);

  // Load config, models, and agents on mount
  useEffect(() => {
    fetch('/api/config').then((r) => r.json()).catch(() => ({})).then((configData) => {
      if (!configData.configured) {
        setSetupError(configData.missing ?? []);
        return;
      }
      const defaultModelId = configData.defaultModel ?? 'amazon.nova-lite-v1:0';
      Promise.all([
        fetch('/api/models').then((r) => { if (!r.ok) throw new Error(); return r.json(); }).catch(() => null),
        fetch('/api/agents').then((r) => { if (!r.ok) throw new Error(); return r.json(); }).catch(() => null),
      ]).then(([modelsData, agentsData]) => {
        if (modelsData?.models) {
          const list = modelsData.models;
          setModels(list);
          const preferred = list.find((m) => m.id === defaultModelId) ?? list[0];
          setSelectedModel(preferred?.id ?? null);
        } else {
          setError('Failed to load models');
        }
        setAgents(agentsData ? (agentsData.agents ?? []) : []);
      });
    });
  }, []);

  // Clear poll interval on unmount
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
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
    setThinking(false);
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
    setThinking(false);
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
    if ((!text && !attachments.length) || streaming) return;
    setInput('');
    setError(null);

    const pendingAttachments = attachments;
    setAttachments([]);

    // Show user message and thinking state immediately for snappy UX
    setMessages((prev) => [...prev, { role: 'user', content: text, attachments: pendingAttachments }]);
    setStreaming(true);
    setThinking(true);
    setActiveTools([]);
    setCompleted([]);
    setOrchStatus(null);

    // Agents manage their own sessions — only pre-create for direct model path
    let sid = sessionId;
    if (!sid && !selectedAgent) {
      try {
        const r = await fetch('/api/sessions', { method: 'POST' });
        const data = await r.json();
        sid = data.sessionId;
        setSessionId(sid);
      } catch {
        setError('Failed to create session');
        finalizeTurn();
        return;
      }
    }

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
          files: pendingAttachments.length
            ? pendingAttachments.map(({ kind, format, name, data }) => ({ kind, format, name, data }))
            : undefined,
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
            currentEvent = '';
          } else if (line.startsWith('data: ')) {
            const raw = line.slice(6);
            if (raw === '[DONE]') continue;
            let data;
            try { data = JSON.parse(raw); } catch { continue; }

            switch (currentEvent) {
              case 'content': {
                const delta = data.delta ?? '';
                setThinking(false);
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
                if (data.sessionId) setSessionId(data.sessionId);
                break;
              }
              case 'tool_start': {
                setThinking(false);
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
                setError(`Agent requested client-side tool "${data.name}" (not supported in this starter kit)`);
                break;
              }
              case 'orchestration_status': {
                if (data.message) setOrchStatus(data.message);
                break;
              }
              case 'done': {
                if (data.complete === true) {
                  finalizeTurn();
                } else if (data.complete === false && data.stopReason === 'tool_request') {
                  setError('Agent requested a client-side tool (not supported in this starter kit)');
                  finalizeTurn();
                } else if (data.complete === false && data.orchestration?.pollUrl) {
                  startOrchestrationPoll(data.orchestration.pollUrl);
                }
                break;
              }
              case 'error': {
                setError(data.error ?? 'An error occurred');
                finalizeTurn();
                break;
              }
              default: break;
            }
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Stream failed');
      finalizeTurn();
    }
  }, [input, attachments, streaming, sessionId, selectedModel, selectedAgent, finalizeTurn, startOrchestrationPoll]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // --- File handling ---
  const addFiles = useCallback(async (fileList) => {
    const newAttachments = await processFiles(Array.from(fileList));
    if (newAttachments.length) setAttachments((prev) => [...prev, ...newAttachments]);
  }, []);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    setDragActive(false);
    await addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    // Only clear if leaving the container entirely (not entering a child)
    if (!e.currentTarget.contains(e.relatedTarget)) setDragActive(false);
  }, []);

  const handlePaste = useCallback(async (e) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const files = items.filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean);
    if (files.length) await addFiles(files);
  }, [addFiles]);

  const removeAttachment = useCallback((id) => {
    setAttachments((prev) => {
      const removed = prev.find((a) => a.id === id);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  if (setupError) {
    return html`
      <div class="app">
        <div class="app-header">
          <span class="logo">quant<em>AI</em></span>
        </div>
        <div class="chat-window" role="log">
          <div class="setup-banner">
            <h2>Configuration Required</h2>
            <p>This application needs environment variables to connect to the Quant AI API.</p>
            <div class="setup-missing">
              ${setupError.map((v) => html`<code key=${v}>${v}</code>`)}
            </div>
            <p>Set these as <strong>environment variables</strong> or <strong>secrets</strong> in your Quant Cloud application settings, then redeploy.</p>
          </div>
        </div>
      </div>
    `;
  }

  return html`
    <div class="app">
      <div class="app-header">
        <span class="logo" onClick=${clearSession} title="New chat">quant<em>AI</em></span>
        <button class="new-chat-btn" onClick=${clearSession} title="New chat">+</button>
      </div>

      <${ChatWindow}
        messages=${messages}
        activeTools=${activeTools}
        completedTools=${completedTools}
        orchStatus=${orchStatus}
        toolsFading=${toolsFading}
        streaming=${streaming}
        thinking=${thinking}
      />

      ${error && html`
        <div class="error-bar" role="alert">
          ${error}
          <button onClick=${() => setError(null)}>✕</button>
        </div>
      `}

      <div class="input-area">
        <div
          class=${'input-card' + (dragActive ? ' drag-active' : '')}
          onDragOver=${handleDragOver}
          onDragEnter=${handleDragOver}
          onDragLeave=${handleDragLeave}
          onDrop=${handleDrop}
        >
          ${dragActive && html`
            <div class="drop-overlay">
              <span class="drop-label">Drop files here</span>
            </div>
          `}

          ${attachments.length > 0 && html`
            <div class="attachment-bar">
              ${attachments.map((a) => html`
                <div class="attachment-chip" key=${a.id}>
                  ${a.previewUrl
                    ? html`<img class="attachment-thumb" src=${a.previewUrl} alt=${a.name} />`
                    : html`<span class="attachment-icon">${docIcon(a.format)}</span>`
                  }
                  <span class="attachment-name">${a.name}</span>
                  <button class="attachment-remove" onClick=${() => removeAttachment(a.id)} title="Remove">✕</button>
                </div>
              `)}
            </div>
          `}

          <textarea
            class="input-field"
            placeholder="How can I help you today?"
            value=${input}
            onInput=${(e) => setInput(e.target.value)}
            onKeyDown=${handleKeyDown}
            onPaste=${handlePaste}
            disabled=${streaming}
            rows="1"
          />

          <div class="input-footer">
            <button
              class="attach-btn"
              title="Attach file"
              onClick=${() => fileInputRef.current?.click()}
              disabled=${streaming}
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <path d="M13.5 7.5l-6 6a3.5 3.5 0 01-4.95-4.95l6-6a2 2 0 012.83 2.83l-6 6a.5.5 0 01-.71-.71l5.5-5.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <input
              ref=${fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf,.csv,.doc,.docx,.xls,.xlsx,.txt,.md,.html"
              style="display:none"
              onChange=${(e) => { addFiles(e.target.files); e.target.value = ''; }}
            />

            <${AgentPicker} agents=${agents} selectedAgent=${selectedAgent} onChange=${handleAgentChange} />
            <${ModelPicker}
              models=${models}
              selectedModel=${selectedModel}
              onChange=${handleModelChange}
              disabled=${!!selectedAgent}
            />

            <div class="input-spacer" />

            <button
              class="send-btn"
              onClick=${sendMessage}
              disabled=${streaming || (!input.trim() && !attachments.length)}
              title="Send"
            >
              ${streaming
                ? html`<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="3" y="3" width="8" height="8" rx="1.5"/></svg>`
                : html`<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 11V3M3 7l4-4 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function docIcon(format) {
  const icons = { pdf: '📄', csv: '📊', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊', txt: '📄', md: '📄', html: '🌐' };
  return icons[format] ?? '📎';
}

render(html`<${App} />`, document.getElementById('app'));
