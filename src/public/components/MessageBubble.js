import { html } from 'htm/preact';
import { marked } from 'marked';

marked.setOptions({ breaks: true, gfm: true });

export function MessageBubble({ message, isLast }) {
  const isUser = message.role === 'user';

  if (isUser) {
    return html`
      <div class="message message-user">
        <div class="bubble-user">${message.content}</div>
      </div>
    `;
  }

  const html_content = marked.parse(message.content || '');

  return html`
    <div class="message message-assistant">
      <div
        class=${'bubble-assistant' + (isLast ? ' streaming' : '')}
        dangerouslySetInnerHTML=${{ __html: html_content }}
      />
    </div>
  `;
}
