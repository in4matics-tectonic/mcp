#!/usr/bin/env -S npx tsx
// Two ways to run:
//  - stdio (default): local agents (Claude Desktop/Code, Codex, Cursor…) start this process. Logs in as the customer.
//  - http:            remote MCP endpoint at POST /mcp. The caller sends the customer's own KBC token as Bearer.
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ApiError, KbcApi } from './api.ts';
import { createServer } from './tools.ts';

try {
  process.loadEnvFile();
} catch {
  // no .env file: rely on the real environment
}

const env = process.env;
const API = (env.KBC_API_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
// stdout is the MCP channel in stdio mode, so everything human-readable goes to stderr
const log = (...a: unknown[]) => console.error('[kbc-mcp]', ...a);

const isLocal = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(API);
if (!API.startsWith('https://') && !isLocal) {
  log(`Refusing to send customer tokens over plain http to ${API}. Use https.`);
  process.exit(1);
}

if ((env.MCP_TRANSPORT ?? 'stdio') === 'stdio') {
  const api = env.KBC_TOKEN
    ? new KbcApi(API, { token: env.KBC_TOKEN })
    : new KbcApi(API, { login: { username: env.KBC_USERNAME ?? '', password: env.KBC_PASSWORD ?? '' } });
  if (!env.KBC_TOKEN && !(env.KBC_USERNAME && env.KBC_PASSWORD)) {
    log('Set KBC_USERNAME + KBC_PASSWORD (or KBC_TOKEN) for the customer this AI acts for.');
    process.exit(1);
  }
  await createServer(api).connect(new StdioServerTransport());
  log(`stdio server ready, backend ${API}`);
} else {
  const host = env.HOST ?? '127.0.0.1';
  const port = Number(env.PORT ?? 3001);
  const allowedHosts = env.ALLOWED_HOSTS?.split(',').map((h) => h.trim()).filter(Boolean);
  // Localhost binding gets DNS-rebinding protection automatically; on 0.0.0.0 set ALLOWED_HOSTS
  const app = createMcpExpressApp({ host, allowedHosts });

  // Stateless: every request brings its own customer token, a fresh server acts only for that customer
  app.post('/mcp', async (req, res) => {
    const token = /^Bearer ([\w.-]+)$/.exec(req.headers.authorization ?? '')?.[1];
    if (!token) {
      res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: 'unauthorized' });
      return;
    }
    const api = new KbcApi(API, { token });
    try {
      await api.klant(); // validates the token and that it belongs to a customer
    } catch (e) {
      const status = e instanceof ApiError && e.status === 403 ? 403 : 401;
      res.status(status).json({ error: status === 403 ? 'forbidden' : 'unauthorized' });
      return;
    }
    const server = createServer(api);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      log('request failed', e instanceof Error ? e.message : e);
      if (!res.headersSent) res.status(500).json({ error: 'internal_error' });
    }
  });
  app.all('/mcp', (_req, res) => {
    res.status(405).set('Allow', 'POST').json({ error: 'method_not_allowed' });
  });
  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.listen(port, host, () => log(`http server on http://${host}:${port}/mcp, backend ${API}`));
}
