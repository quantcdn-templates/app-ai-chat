import { html } from 'htm/preact';
import { marked } from 'marked';

marked.setOptions({ breaks: true, gfm: true });

export function MessageBubble({ message }) {
  const isUser = message.role === 'user';

  if (isUser) {
    return html`
      <div class="message message-user">
        <div class="bubble bubble-user">${message.content}</div>
      </div>
    `;
  }

  // Assistant: render markdown safely via innerHTML
  const html_content = marked.parse(message.content || '');

  return html`
    <div class="message message-assistant">
      <div
        class="bubble bubble-assistant"
        dangerouslySetInnerHTML=${{ __html: html_content }}
      />
    </div>
  `;
}
