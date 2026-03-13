import { html } from 'htm/preact';

export function ModelPicker({ models, selectedModel, onChange, disabled }) {
  if (disabled) return null;
  const loading = models === null;
  return html`
    <div class="picker">
      <label for="model-select">
        Model${loading ? html` <span class="picker-spinner" aria-hidden="true" />` : ''}
      </label>
      <select
        id="model-select"
        value=${selectedModel ?? ''}
        onChange=${(e) => onChange(e.target.value)}
        disabled=${loading}
      >
        ${loading
          ? html`<option>Loading…</option>`
          : models.map((m) => html`
            <option key=${m.id} value=${m.id}>${m.name ?? m.id}</option>
          `)}
      </select>
    </div>
  `;
}
