import { html } from 'htm/preact';
import { useEffect, useRef } from 'preact/hooks';
import { MessageBubble } from './MessageBubble.js';
import { ToolCallBlock } from './ToolCallBlock.js';

export function ChatWindow({ messages, activeTools, completedTools, orchStatus, toolsFading, streaming }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeTools, completedTools, orchStatus]);

  return html`
    <div class="chat-window" role="log" aria-live="polite">
      ${messages.map((msg, i) => html`
        <${MessageBubble} key=${i} message=${msg} />
      `)}
      ${(streaming || activeTools.length > 0 || completedTools.length > 0 || orchStatus) && html`
        <${ToolCallBlock}
          activeTools=${activeTools}
          completedTools=${completedTools}
          orchStatus=${orchStatus}
          fading=${toolsFading}
        />
      `}
      <div ref=${bottomRef} />
    </div>
  `;
}
