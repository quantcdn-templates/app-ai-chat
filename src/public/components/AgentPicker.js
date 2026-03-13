import { html } from 'htm/preact';

export function AgentPicker({ agents, selectedAgent, onChange }) {
  return html`
    <div class="picker">
      <label for="agent-select">Agent</label>
      <select
        id="agent-select"
        value=${selectedAgent ?? ''}
        onChange=${(e) => onChange(e.target.value || null)}
      >
        <option value="">No agent (direct model)</option>
        ${agents.map((a) => html`
          <option key=${a.agentId} value=${a.agentId}>
            ${a.name ?? a.agentId}
          </option>
        `)}
      </select>
    </div>
  `;
}
