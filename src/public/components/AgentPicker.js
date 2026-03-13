import { html } from 'htm/preact';

export function AgentPicker({ agents, selectedAgent, onChange }) {
  const loading = agents === null;
  return html`
    <div class="picker">
      <label for="agent-select">
        Agent${loading ? html` <span class="picker-spinner" aria-hidden="true" />` : ''}
      </label>
      <select
        id="agent-select"
        value=${selectedAgent ?? ''}
        onChange=${(e) => onChange(e.target.value || null)}
        disabled=${loading}
      >
        ${loading
          ? html`<option>Loading…</option>`
          : html`
            <option value="">No agent (direct model)</option>
            ${agents.map((a) => html`
              <option key=${a.agentId} value=${a.agentId}>
                ${a.name ?? a.agentId}
              </option>
            `)}
          `}
      </select>
    </div>
  `;
}
