import { html } from 'htm/preact';
import { useState } from 'preact/hooks';

function ToolChip({ tool }) {
  const [open, setOpen] = useState(false);
  const label = (tool.name || '').replace(/_/g, ' ');

  return html`
    <div class="tool-chip-wrap">
      <button
        class="tool-chip"
        onClick=${() => setOpen(!open)}
        title="Click to ${open ? 'collapse' : 'expand'} result"
      >
        <span class="tool-chip-check">✓</span>
        ${label}
      </button>
      ${open && html`
        <pre class="tool-result">${
          typeof tool.result === 'string'
            ? tool.result
            : JSON.stringify(tool.result, null, 2)
        }</pre>
      `}
    </div>
  `;
}

export function ToolCallBlock({ activeTools, completedTools, orchStatus, fading }) {
  const hasActive = activeTools.length > 0;
  const hasCompleted = completedTools.length > 0;

  if (!hasActive && !hasCompleted && !orchStatus) return null;

  return html`
    <div class="tool-block">
      ${(hasActive || orchStatus) && html`
        <div class="tool-status">
          <span class="spinner" aria-hidden="true"></span>
          <span>${orchStatus ?? (activeTools[activeTools.length - 1]?.label ?? 'Working...')}</span>
        </div>
      `}
      ${hasCompleted && html`
        <div class=${"tool-chips" + (fading ? " fading" : "")}>
          ${completedTools.map((t) => html`<${ToolChip} key=${t.name + t.index} tool=${t} />`)}
        </div>
      `}
    </div>
  `;
}
