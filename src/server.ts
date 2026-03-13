import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
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
const BASE_URL     = process.env.QUANT_BASE_URL ?? 'https://dashboard.quantcdn.io';
const DEFAULT_MODEL = process.env.QUANT_DEFAULT_MODEL ?? 'amazon.nova-lite-v1:0';

const config = new Configuration({
  basePath: BASE_URL,
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
const IS_PROD    = process.env.NODE_ENV === 'production';
const STATIC_ROOT = IS_PROD ? '.' : 'src';   // /public/x -> ./public/x or src/public/x
const INDEX_HTML  = readFileSync(resolve(IS_PROD ? 'public' : 'src/public', 'index.html'), 'utf-8');

// --- App ---
const app = new Hono();

app.use('/public/*', serveStatic({ root: STATIC_ROOT }));

app.get('/', (c) => c.html(INDEX_HTML));

app.get('/health', (c) => c.json({ status: 'ok' }));

// Guard routes that require QUANT_ORGANISATION
const requireOrg: MiddlewareHandler = async (c, next) => {
  if (!ORG) return c.json({ error: 'QUANT_ORGANISATION not set' }, 500);
  await next();
};
app.use('/api/models', requireOrg);
app.use('/api/agents', requireOrg);
app.use('/api/sessions', requireOrg);
app.use('/api/chat/*', requireOrg);

// Expose non-secret config values to the frontend
app.get('/api/config', (c) => c.json({ defaultModel: DEFAULT_MODEL }));

app.get('/api/models', async (c) => {
  const res = await modelsApi.listAIModels(ORG, 'chat');
  return c.json(res.data);
});

app.get('/api/agents', async (c) => {
  const res = await agentsApi.listAIAgents(ORG);
  return c.json(res.data);
});

app.post('/api/sessions', async (c) => {
  const res = await sessionsApi.createAISession(ORG, {
    userId: 'anonymous',
    sessionGroup: 'ai-chat',
    expirationMinutes: 60,
  });
  return c.json({ sessionId: res.data.sessionId });
});

// Proxy for async orchestration polling — keeps QUANT_API_TOKEN server-side
app.get('/api/orchestration/poll', async (c) => {
  const pollUrl = c.req.query('url');
  if (!pollUrl) return c.json({ error: 'url query param required' }, 400);
  if (!pollUrl.startsWith(BASE_URL)) return c.json({ error: 'Invalid poll URL' }, 400);
  const res = await fetch(pollUrl, {
    headers: { 'Authorization': `Bearer ${TOKEN}` },
  });
  return c.json(await res.json());
});

app.post('/api/chat/stream', async (c) => {
  const { message, sessionId, modelId, agentId } = await c.req.json<{
    message: string;
    sessionId: string | null;
    modelId: string | null;
    agentId: string | null;
  }>();

  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');

  const axiosOpts = { responseType: 'stream' as const };

  const upstream = agentId
    ? await agentsApi.chatWithAIAgent(
        ORG,
        agentId,
        { message, sessionId: sessionId ?? undefined, stream: true },
        axiosOpts,
      )
    : await inferenceApi.chatInferenceStream(
        ORG,
        {
          messages: [{ role: 'user', content: message }],
          modelId: modelId ?? DEFAULT_MODEL,
          sessionId: sessionId ?? undefined,
          systemPrompt: process.env.QUANT_SYSTEM_PROMPT,
        },
        axiosOpts,
      );

  return stream(c, async (s) => {
    for await (const chunk of upstream.data as AsyncIterable<Buffer>) {
      await s.write(chunk);
    }
  });
});

// --- Start server ---
const port = parseInt(process.env.PORT ?? '3001', 10);
serve({ fetch: app.fetch, port }, () => {
  console.log(`Server running on http://localhost:${port}`);
});

export default app;
