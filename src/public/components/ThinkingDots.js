import { html } from 'htm/preact';

export function ThinkingDots() {
  return html`
    <div class="thinking-dots" aria-label="Thinking…" role="status">
      <span class="thinking-dot"></span>
      <span class="thinking-dot"></span>
      <span class="thinking-dot"></span>
    </div>
  `;
}
