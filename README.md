# AI Chat Starter Kit

A lean, hackable AI chat interface built with [Hono](https://hono.dev) and [Preact](https://preactjs.com). Streams responses in real time, supports Quant Cloud agents, model selection, and shows rich tool execution UI.

## Getting started

```bash
git clone <this-repo> my-ai-chat
cd my-ai-chat
cp .env.example .env
# Fill in QUANT_API_TOKEN and QUANT_ORGANISATION in .env
npm install
npm run dev
```

Open http://localhost:3001 (direct app port in dev).
With Docker (`docker compose up`), open http://localhost:3000 (via proxy).

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `QUANT_API_TOKEN` | Yes | Your Quant Cloud API token |
| `QUANT_ORGANISATION` | Yes | Your organisation machine name |
| `QUANT_SYSTEM_PROMPT` | No | System prompt for direct model chat |
| `QUANT_DEFAULT_MODEL` | No | Default model ID (default: `amazon.nova-lite-v1:0`) |
| `QUANT_BASE_URL` | No | API base URL (default: `https://dashboard.quantcdn.io`) |
| `PORT` | No | App port (default: `3001`) |

## Deploying to Quant Cloud

Push to `main` — the included GitHub Actions workflow builds and deploys automatically.

Set these in your GitHub repo settings:
- **Secret:** `QUANT_API_KEY`
- **Variable:** `QUANT_ORGANIZATION` (note: American spelling — required by the Quant CI actions)

Runtime environment variables (`QUANT_API_TOKEN`, `QUANT_ORGANISATION`, etc.) are configured in the Quant Cloud dashboard and injected at deploy time.

## Extending

The codebase is intentionally small. Key extension points (marked with `// TODO` comments in the code):

- **Local tool execution** — `src/server.ts`: intercept `tool_request` SSE events and run your own handlers
- **Auth** — add Hono middleware before the `/api/*` routes
- **System prompt** — inject dynamic context per-request in the SSE relay body
- **Multi-conversation** — swap `sessionStorage` for `localStorage` + a session list sidebar
