import { html } from 'htm/preact';
import { useEffect, useRef } from 'preact/hooks';
import { MessageBubble } from './MessageBubble.js';
import { ToolCallBlock } from './ToolCallBlock.js';
import { ThinkingDots } from './ThinkingDots.js';

export function ChatWindow({ messages, activeTools, completedTools, orchStatus, toolsFading, streaming, thinking }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeTools, completedTools, orchStatus, thinking]);

  const hasContent = messages.length > 0 || streaming || thinking;

  if (!hasContent) {
    return html`
      <div class="chat-window" role="log" aria-live="polite">
        <div class="empty-state">
          <h2>What shall we explore?</h2>
          <p>Ask anything — I'll think it through with you.</p>
        </div>
        <div ref=${bottomRef} />
      </div>
    `;
  }

  const lastIdx = messages.length - 1;

  return html`
    <div class="chat-window" role="log" aria-live="polite">
      ${messages.map((msg, i) => html`
        <${MessageBubble}
          key=${i}
          message=${msg}
          isLast=${i === lastIdx && streaming && msg.role === 'assistant'}
        />
      `)}
      ${thinking && html`<div class="msg-col"><${ThinkingDots} /></div>`}
      ${(activeTools.length > 0 || completedTools.length > 0 || orchStatus) && html`
        <div class="msg-col">
          <${ToolCallBlock}
            activeTools=${activeTools}
            completedTools=${completedTools}
            orchStatus=${orchStatus}
            fading=${toolsFading}
          />
        </div>
      `}
      <div ref=${bottomRef} />
    </div>
  `;
}
