# AI Chat Starter Kit

A streaming AI chat interface built with [Hono](https://hono.dev) and [Preact](https://preactjs.com). No frontend build step — the browser imports Preact directly via an import map.

**Features:**
- Real-time streaming responses (SSE)
- Model selection (any model available in your Quant Cloud org)
- Agent selection (agents configured in Quant Cloud)
- Rich tool execution UI — live running pills, completed chips, result drill-down
- Multimodal file attachments — drag-and-drop, paste, or click to attach images and documents
- Async orchestration polling
- Session management

---

## Local development

```bash
git clone <this-repo> my-ai-chat
cd my-ai-chat
cp .env.example .env
# Edit .env — fill in QUANT_API_TOKEN and QUANT_ORGANISATION at minimum
npm install
npm run dev
```

Open [http://localhost:3001](http://localhost:3001).

### With Docker Compose

```bash
docker compose up
```

Open [http://localhost:3000](http://localhost:3000) (proxied through the Quant entrypoint).

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `QUANT_API_TOKEN` | **Yes** | — | Your Quant Cloud API token |
| `QUANT_ORGANISATION` | **Yes** | — | Your organisation machine name (e.g. `acme`) |
| `QUANT_DEFAULT_MODEL` | No | `amazon.nova-lite-v1:0` | Model ID pre-selected on load |
| `QUANT_SYSTEM_PROMPT` | No | — | System prompt injected for direct model chat (ignored when an agent is selected) |
| `QUANT_MAX_TOKENS` | No | `8192` | Maximum tokens per response |
| `QUANT_BASE_URL` | No | `https://dashboard.quantcdn.io` | API base URL — only change this for on-premise deployments |
| `PORT` | No | `3001` | Port the Node server listens on |

---

## Deploying to Quant Cloud

### 1. Create the application in Quant Cloud

In the Quant Cloud dashboard, create a new **App** application. Note the application slug — it's set automatically from the repo name.

### 2. Configure GitHub repository secrets

In your GitHub repo → **Settings → Secrets and variables → Actions**, add:

| Type | Name | Value |
|---|---|---|
| Secret | `QUANT_API_KEY` | Your Quant Cloud API key (from the dashboard) |
| Variable | `QUANT_ORGANIZATION` | Your org machine name — note US spelling, required by the CI actions |

### 3. Add runtime secrets in Quant Cloud

In the Quant Cloud dashboard → your application → **Configuration → Environment variables**, add:

| Variable | Value |
|---|---|
| `QUANT_API_TOKEN` | Your Quant Cloud API token |
| `QUANT_ORGANISATION` | Your organisation machine name |
| `QUANT_DEFAULT_MODEL` | *(optional)* e.g. `anthropic.claude-sonnet-4-5` |
| `QUANT_SYSTEM_PROMPT` | *(optional)* Any fixed system prompt |
| `QUANT_MAX_TOKENS` | *(optional)* e.g. `16384` for longer responses |

Mark `QUANT_API_TOKEN` as a **secret** so it is encrypted at rest and never exposed in logs.

### 4. Push to deploy

```bash
git push origin main
```

The included GitHub Actions workflow (`.github/workflows/build-deploy.yaml`) builds the Docker image and deploys it automatically on every push to `main` or `develop`.

---

## Architecture

```
Browser (Preact, no build)
    │
    ├── GET /api/config        → default model ID
    ├── GET /api/models        → available models (cached 5 min)
    ├── GET /api/agents        → org agents, excluding global ones (cached 5 min)
    ├── POST /api/sessions     → create a session (direct model path only)
    ├── POST /api/chat/stream  → SSE relay to Quant AI inference
    └── GET /api/orchestration/poll → async orchestration proxy

Node server (Hono + @quantcdn/quant-client)
    │
    └── Quant Cloud AI API (Bedrock / Anthropic models, agents, tools)
```

**Key design decisions:**

- `QUANT_API_TOKEN` never leaves the server — all API calls are proxied
- Models and agents are cached in memory at startup (5-minute TTL) so the UI loads instantly
- Agent streaming uses `chatInferenceStream` with `agentId` in the request body — this is the correct path for true SSE with agents
- The frontend has no build step: Preact and marked are loaded via CDN import map in `index.html`

### File structure

```
src/
├── server.ts                  # Hono server — all API routes
└── public/
    ├── index.html             # Import map + app mount point
    ├── app.js                 # Root Preact component, state, SSE parser
    ├── style.css              # All styles
    └── components/
        ├── ChatWindow.js      # Message list + scroll management
        ├── MessageBubble.js   # User / assistant bubble rendering (markdown)
        ├── AgentPicker.js     # Agent selector
        ├── ModelPicker.js     # Model selector
        ├── ToolCallBlock.js   # Tool execution UI (pills + result chips)
        └── ThinkingDots.js    # Animated loading indicator
```

---

## Extending

The server is intentionally thin. Common extension points:

### Custom system prompt per request

In `server.ts`, replace the static `QUANT_SYSTEM_PROMPT` env var with dynamic logic:

```typescript
requestBody.systemPrompt = buildSystemPrompt(c.req.header('x-user-id'));
```

### Client-side tool execution

The SSE stream emits `tool_request` events when an agent needs the client to run a tool (e.g. browser interaction). In `app.js`, handle these in the `switch (currentEvent)` block:

```javascript
case 'tool_request': {
  const result = await myLocalTool(data.name, data.input);
  // POST result back to /api/chat/tool-result (you'd add this route)
  break;
}
```

### Authentication

Add a Hono middleware before the `/api/*` routes in `server.ts`:

```typescript
app.use('/api/*', async (c, next) => {
  const token = c.req.header('Authorization');
  if (!isValid(token)) return c.json({ error: 'Unauthorized' }, 401);
  await next();
});
```

### Multi-conversation history

The current implementation stores one active `sessionId` in `sessionStorage`. To support a conversation list:
1. Persist sessions to `localStorage` with their message history
2. Add a sidebar component that lists sessions and calls `setSessionId` + `setMessages` on selection

### Different models per message

The model is fixed at the start of a conversation (changing it clears the session). To allow mid-conversation model switching, remove the `clearSession()` call from `handleModelChange` and pass `modelId` per-message rather than as component state.
