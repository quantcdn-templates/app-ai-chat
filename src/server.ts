import 'dotenv/config';
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
const BASE_URL      = process.env.QUANT_BASE_URL ?? 'https://dashboard.quantcdn.io';
const DEFAULT_MODEL = process.env.QUANT_DEFAULT_MODEL ?? 'amazon.nova-lite-v1:0';
const MAX_TOKENS    = parseInt(process.env.QUANT_MAX_TOKENS ?? '8192', 10);

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

const IS_PROD    = process.env.NODE_ENV === 'production';
const STATIC_ROOT = IS_PROD ? '.' : 'src';
const INDEX_HTML  = readFileSync(resolve(IS_PROD ? 'public' : 'src/public', 'index.html'), 'utf-8');

// --- Simple TTL cache for static-ish lists ---
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T> { data: T; at: number; }
let modelsCache: CacheEntry<unknown> | null = null;
let agentsCache: CacheEntry<unknown> | null = null;

async function fetchModels() {
  const res = await modelsApi.listAIModels(ORG, 'chat');
  modelsCache = { data: res.data, at: Date.now() };
  return modelsCache.data;
}

async function fetchAgents() {
  const res = await agentsApi.listAIAgents(ORG);
  const data = res.data as any;
  const agents = (data.agents ?? []).filter((a: any) => !a.isGlobal);
  agentsCache = { data: { agents }, at: Date.now() };
  return agentsCache.data;
}

// Pre-warm both caches at startup so first page load is instant
if (ORG) Promise.all([fetchModels(), fetchAgents()]).catch(() => {});

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
  const fresh = modelsCache && Date.now() - modelsCache.at < CACHE_TTL_MS;
  const data = fresh ? modelsCache!.data : await fetchModels();
  return c.json(data);
});

app.get('/api/agents', async (c) => {
  const fresh = agentsCache && Date.now() - agentsCache.at < CACHE_TTL_MS;
  const data = fresh ? agentsCache!.data : await fetchAgents();
  return c.json(data);
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

// File attachment descriptor sent by the frontend
interface FileAttachment {
  kind: 'image' | 'document';
  format: string;  // e.g. 'jpeg', 'png', 'pdf'
  name: string;
  data: string;    // base64-encoded bytes
}

// Build a multimodal content array from files + text
function buildContent(files: FileAttachment[], text: string) {
  const blocks: object[] = files.map((f) =>
    f.kind === 'image'
      ? { image: { format: f.format, source: { bytes: f.data } } }
      : { document: { format: f.format, name: f.name, source: { bytes: f.data } } },
  );
  if (text) blocks.push({ text });
  return blocks;
}

app.post('/api/chat/stream', async (c) => {
  const { message, sessionId, modelId, agentId, files } = await c.req.json<{
    message: string;
    sessionId: string | null;
    modelId: string | null;
    agentId: string | null;
    files?: FileAttachment[];
  }>();

  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');

  // Both direct inference and agent paths use chatInferenceStream.
  // Agents are selected by passing agentId in the request body (undocumented
  // but supported field — the agent's system prompt, model, and tools are
  // applied server-side and the response is true SSE).
  const userContent = files?.length ? buildContent(files, message) : message;

  const requestBody: any = {
    messages: [{ role: 'user', content: userContent }],
    modelId: modelId ?? DEFAULT_MODEL,
    sessionId: sessionId ?? undefined,
    maxTokens: MAX_TOKENS,
  };

  if (agentId) {
    requestBody.agentId = agentId;
  } else if (process.env.QUANT_SYSTEM_PROMPT) {
    requestBody.systemPrompt = process.env.QUANT_SYSTEM_PROMPT;
  }

  const upstream = await inferenceApi.chatInferenceStream(
    ORG,
    requestBody,
    {
      responseType: 'stream' as const,
      headers: { Accept: 'text/event-stream' },
    },
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
