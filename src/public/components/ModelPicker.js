import { html } from 'htm/preact';

export function ModelPicker({ models, selectedModel, onChange, disabled }) {
  if (disabled) return null;
  return html`
    <div class="picker">
      <label for="model-select">Model</label>
      <select
        id="model-select"
        value=${selectedModel ?? ''}
        onChange=${(e) => onChange(e.target.value)}
      >
        ${models.map((m) => html`
          <option key=${m.id} value=${m.id}>${m.name ?? m.id}</option>
        `)}
      </select>
    </div>
  `;
}
