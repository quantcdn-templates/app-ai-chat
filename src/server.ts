import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import {
  AIAgentsApi,
  AIInferenceApi,
  AIModelsApi,
  AISessionsApi,
  Configuration,
} from '@quantcdn/quant-client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// --- SDK setup ---
const config = new Configuration({
  basePath: process.env.QUANT_BASE_URL ?? 'https://dashboard.quantcdn.io',
  accessToken: process.env.QUANT_API_TOKEN,
});

const modelsApi    = new AIModelsApi(config);
const agentsApi    = new AIAgentsApi(config);
const inferenceApi = new AIInferenceApi(config);
const sessionsApi  = new AISessionsApi(config);

const ORG   = process.env.QUANT_ORGANISATION ?? '';
const TOKEN = process.env.QUANT_API_TOKEN ?? '';

// Static assets:
//   dev  (NODE_ENV unset): tsx runs from project root, files are at src/public/
//   prod (NODE_ENV=production): Dockerfile copies src/public/ to /app/public/
// serveStatic root is the *parent* of the public/ folder so that the
// /public/* URL prefix maps to the correct directory on disk.
const IS_PROD   = process.env.NODE_ENV === 'production';
const STATIC_ROOT = IS_PROD ? '.' : 'src';   // /public/x -> ./public/x or src/public/x
const INDEX_HTML  = resolve(IS_PROD ? 'public' : 'src/public', 'index.html');

// --- App ---
const app = new Hono();

app.use('/public/*', serveStatic({ root: STATIC_ROOT }));

app.get('/', (c) => c.html(readFileSync(INDEX_HTML, 'utf-8')));

app.get('/health', (c) => c.json({ status: 'ok' }));

// Expose non-secret config values to the frontend
app.get('/api/config', (c) => c.json({
  defaultModel: process.env.QUANT_DEFAULT_MODEL ?? 'amazon.nova-lite-v1:0',
}));

app.get('/api/models', async (c) => {
  if (!ORG) return c.json({ error: 'QUANT_ORGANISATION not set' }, 500);
  const res = await modelsApi.listAIModels(ORG, 'chat');
  return c.json(res.data);
});

app.get('/api/agents', async (c) => {
  if (!ORG) return c.json({ error: 'QUANT_ORGANISATION not set' }, 500);
  const res = await agentsApi.listAIAgents(ORG);
  return c.json(res.data);
});

// --- API routes (Tasks 4–5) ---

// --- Start server ---
const port = parseInt(process.env.PORT ?? '3001', 10);
serve({ fetch: app.fetch, port }, () => {
  console.log(`Server running on http://localhost:${port}`);
});

export default app;
