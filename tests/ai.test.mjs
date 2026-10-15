import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { createAiRouter } from '../server/ai.mjs';
import { readAiConfig, gatewaySettings } from '../server/ai-config.mjs';
import { buildMessages, upstreamError } from '../features/ai/protocol.mjs';
import { createAiClient, backendOrigin } from '../features/ai/client.mjs';
import { extractPages } from '../features/ai/extract-pages.mjs';
const config = {
  baseUrl: 'http://127.0.0.1:8317/v1',
  apiKey: 'test-gateway-key-not-for-production-123456',
  model: 'gpt-6-luna',
  password: 'test-demo-access-not-for-production-123456',
  allowLocalHttp: true,
  remoteEnabled: false,
  keyRotated: false,
  trustLocalProxy: false,
  publicOrigin: '',
};
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const quiet = () => {};

test('backend env owns Gateway credentials and model; frontend only accepts a public HTTPS origin', () => {
  const value = readAiConfig({
    FOLIO_AI_GATEWAY_KEY: 'server-only',
    FOLIO_AI_DEMO_PASSWORD: config.password,
  });
  assert.equal(value.model, 'gpt-6-luna');
  assert.equal(value.apiKey, 'server-only');
  assert.equal(value.remoteEnabled, false);
  assert.equal(
    readAiConfig({ NODE_ENV: 'production', FOLIO_AI_ALLOW_LOCAL_HTTP: 'true' }).allowLocalHttp,
    false,
  );
  assert.equal(gatewaySettings(config).model, 'gpt-6-luna');
  for (const url of [
    'https://api.openai.com/v1',
    'http://127.0.0.1.evil/v1',
    'http://user:pass@localhost:8317/v1',
  ])
    assert.throws(() => gatewaySettings({ ...config, baseUrl: url }));
  assert.equal(
    backendOrigin({ configured: 'https://demo.example', native: true }),
    'https://demo.example',
  );
  assert.throws(() =>
    backendOrigin({ native: true, development: true, origin: 'capacitor://localhost' }),
  );
  assert.throws(() => backendOrigin({ configured: 'http://demo.example' }));
  assert.throws(() => backendOrigin({ configured: 'https://localhost:3001', native: true }));
  assert.throws(() => backendOrigin({ origin: 'http://localhost:5173', development: false }));
  assert.equal(
    backendOrigin({ origin: 'http://localhost:5173', development: true }),
    'http://localhost:5173',
  );
});
test('bounded PDF extraction preserves page attribution and rejects image-only/out-of-range/oversized pages', async () => {
  let cleaned = 0;
  const pdf = {
    numPages: 9,
    getPage: async (n) => ({
      getTextContent: async () => ({
        items: [{ str: `page ${n}`, hasEOL: true }, { str: '資料' }],
      }),
      cleanup: () => cleaned++,
    }),
  };
  assert.match(await extractPages(pdf, 2, 3), /\[ページ 2\]\npage 2\n資料/);
  assert.equal(cleaned, 2);
  await assert.rejects(extractPages(pdf, 1, 6), /最大5/);
  await assert.rejects(
    extractPages(
      { ...pdf, getPage: async () => ({ getTextContent: async () => ({ items: [] }) }) },
      1,
      1,
    ),
    /OCR/,
  );
  await assert.rejects(
    extractPages(
      {
        ...pdf,
        getPage: async () => ({
          getTextContent: async () => ({ items: [{ str: 'a'.repeat(12001) }] }),
        }),
      },
      1,
      1,
    ),
    /12,000/,
  );
});
test('context and history limits never silently truncate or add unknown facts', () => {
  const messages = buildMessages('[ページ 1] 本文', '質問', [
    { role: 'assistant', content: '前の回答' },
  ]);
  assert.equal(messages.at(-1).content, '質問');
  assert.match(messages[0].content, /本文にない情報/);
  assert.throws(() => buildMessages('a'.repeat(12001), '質問'), /上限/);
  assert.throws(
    () => buildMessages('a', '質問', [{ role: 'assistant', content: 'b'.repeat(24000) }]),
    /上限/,
  );
  assert.throws(() => buildMessages('a', '質問', [{ role: 'system', content: 'inject' }]));
});
async function withRelay(
  fetchImpl,
  fn,
  { overrides = {}, timeoutMs = 1000, log = quiet, now } = {},
) {
  const app = express();
  app.use(
    '/api/ai',
    createAiRouter({ fetchImpl, timeoutMs, config: { ...config, ...overrides }, log, now }),
  );
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  let token = '';
  const call = (operation, body = {}, headers = {}, method = 'POST') =>
    fetch(origin + '/api/ai/' + operation, {
      method,
      headers: {
        Origin: origin,
        'X-Folio-AI': '1',
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...headers,
      },
      body: JSON.stringify(body),
    });
  const login = async (headers = {}) => {
    const response = await call('session', { password: config.password }, headers);
    const data = await response.json();
    if (data.token) token = data.token;
    return { response, data };
  };
  try {
    await fn({ call, login, origin });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
test('unauthenticated AI cannot reach Gateway; valid session uses only backend settings', async () => {
  const calls = [];
  await withRelay(
    async (url, options) => {
      calls.push({ url, options });
      return url.endsWith('/models')
        ? json({ data: [{ id: 'gpt-6-luna' }] })
        : json({
            model: 'gpt-6-luna',
            choices: [{ message: { content: '資料の回答' }, finish_reason: 'stop' }],
          });
    },
    async ({ call, login }) => {
      assert.equal((await call('message', { context: '本文', question: '質問' })).status, 401);
      assert.equal(calls.length, 0);
      assert.equal((await login()).response.status, 200);
      assert.equal((await call('status')).status, 200);
      const reply = await (await call('message', { context: '本文', question: '質問' })).json();
      assert.equal(reply.text, '資料の回答');
      assert.equal(reply.model, 'gpt-6-luna');
      assert.equal(calls[1].options.headers.Authorization, 'Bearer ' + config.apiKey);
      assert.equal(JSON.parse(calls[1].options.body).model, 'gpt-6-luna');
      assert.equal(calls[1].options.redirect, 'error');
      assert.equal(
        (
          await call('message', {
            settings: { apiKey: 'override', model: 'gpt-6-astra' },
            context: '本文',
            question: '質問',
          })
        ).status,
        400,
      );
      assert.equal(calls.length, 2);
      await call('session', {}, {}, 'DELETE');
      assert.equal((await call('status')).status, 401);
    },
  );
});
test('HTTPS remote access requires explicit enablement, rotation, trusted proxy, allowed origin and login', async () => {
  const logs = [];
  const remote = {
    remoteEnabled: true,
    keyRotated: true,
    trustLocalProxy: true,
    allowLocalHttp: false,
    publicOrigin: 'https://folio.demo.test',
  };
  const headers = {
    Origin: 'capacitor://localhost',
    Host: 'folio.demo.test',
    'X-Forwarded-Host': 'folio.demo.test',
    'X-Forwarded-Proto': 'https',
  };
  for (const overrides of [
    { ...remote, remoteEnabled: false },
    { ...remote, keyRotated: false },
    { ...remote, trustLocalProxy: false },
  ]) {
    await withRelay(
      async () => {
        throw Error('must not call Gateway');
      },
      async ({ login }) => {
        assert.equal((await login(headers)).response.status, 403);
      },
      { overrides, log: (e) => logs.push(e) },
    );
  }
  await withRelay(
    async () => json({ data: [{ id: 'gpt-6-luna' }] }),
    async ({ call, login }) => {
      assert.equal((await login({ ...headers, 'X-Forwarded-Proto': 'http' })).response.status, 403);
      assert.equal(
        (await login({ ...headers, Origin: 'https://untrusted.example' })).response.status,
        403,
      );
      assert.equal((await call('status', {}, headers)).status, 401, JSON.stringify(logs));
      const auth = await login(headers);
      assert.equal(auth.response.status, 200);
      assert.ok(auth.data.token);
      const status = await call('status', {}, headers);
      assert.equal(status.status, 200);
      assert.equal(status.headers.get('access-control-allow-origin'), 'capacitor://localhost');
      assert.equal(status.headers.get('access-control-expose-headers'), 'X-Request-ID');
    },
    { overrides: remote, log: (e) => logs.push(e) },
  );
  const recorded = JSON.stringify(logs);
  assert.ok(!recorded.includes(config.password));
  assert.ok(!recorded.includes(config.apiKey));
  assert.ok(!recorded.includes('Bearer'));
  assert.ok(!recorded.includes('本文'));
  assert.ok(logs.some((e) => e.reason === 'rotation_required'));
});
test('login attempts and inference requests are bounded; expired sessions fail closed', async () => {
  await withRelay(
    async () => json({ data: [{ id: 'gpt-6-luna' }] }),
    async ({ call, login }) => {
      for (let i = 0; i < 5; i++)
        assert.equal((await call('session', { password: 'wrong' })).status, 401);
      assert.equal((await login()).response.status, 429);
    },
  );
  let clock = 100000;
  await withRelay(
    async () => json({ data: [{ id: 'gpt-6-luna' }] }),
    async ({ call, login }) => {
      await login();
      for (let i = 0; i < 10; i++) assert.equal((await call('status')).status, 200);
      assert.equal((await call('status')).status, 429);
      clock += 3600001;
      assert.equal((await call('status')).status, 401);
    },
    { now: () => clock },
  );
});
test('quota stops after one request; authentication/model/context/format errors remain distinct', async () => {
  for (const [status, data, code] of [
    [429, { error: { code: 'insufficient_quota' } }, 'limit'],
    [401, {}, 'authentication'],
    [404, {}, 'model'],
    [400, { error: { code: 'context_length_exceeded' } }, 'context'],
    [200, { choices: [{ message: { content: null } }] }, 'format'],
  ]) {
    let count = 0;
    await withRelay(
      async () => {
        count++;
        return json(data, status);
      },
      async ({ call, login }) => {
        await login();
        const response = await call('message', { context: '本文', question: '質問' });
        assert.equal((await response.json()).code, code);
        assert.equal(count, 1);
      },
    );
  }
  assert.equal(upstreamError(402, {}).code, 'limit');
});
test('server timeout aborts Gateway once with diagnostic request ID', async () => {
  let count = 0,
    aborted = false;
  await withRelay(
    (url, { signal }) => {
      count++;
      return new Promise((resolve, reject) =>
        signal.addEventListener('abort', () => {
          aborted = true;
          reject(new DOMException('abort', 'AbortError'));
        }),
      );
    },
    async ({ call, login }) => {
      await login();
      const response = await call('message', { context: '本文', question: '質問' });
      const data = await response.json();
      assert.equal(response.status, 504);
      assert.equal(data.code, 'timeout');
      assert.ok(data.requestId);
      assert.equal(count, 1);
      assert.ok(aborted);
    },
    { timeoutMs: 20 },
  );
});
test('client logs in with a separate access code and sends no Gateway key/model/URL', async () => {
  const calls = [];
  const token = 'a'.repeat(64);
  const client = createAiClient({
    baseUrl: 'https://demo.test',
    diagnostic: quiet,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('session')) return json({ token, expiresAt: Date.now() + 60000 });
      if (url.endsWith('status')) return json({ ready: true });
      return json({ model: 'gpt-6-luna', text: '回答' });
    },
  });
  await client.login(config.password);
  assert.equal(client.isAuthenticated(), true);
  await client.status();
  await client.sendMessage({ context: '本文', question: '質問' });
  assert.equal(calls[2].options.headers.Authorization, 'Bearer ' + token);
  assert.deepEqual(JSON.parse(calls[2].options.body), { context: '本文', question: '質問' });
  assert.equal(calls[2].options.credentials, 'omit');
  assert.ok(!JSON.stringify(calls).includes(config.apiKey));
  const second = createAiClient();
  assert.equal(second.isAuthenticated(), false);
});
test('client quota and malformed reply never retry; diagnostics omit credentials and content', async () => {
  let count = 0;
  const logs = [];
  const client = createAiClient({
    diagnostic: (e) => logs.push(e),
    fetchImpl: async () => {
      count++;
      return json({ code: 'limit', error: '上限到達', requestId: 'safe-id' }, 429);
    },
  });
  await assert.rejects(
    client.sendMessage({ context: 'PRIVATE-CONTENT' }),
    (e) => e.code === 'limit',
  );
  assert.equal(count, 1);
  assert.equal(logs[0].requestId, 'safe-id');
  assert.ok(!JSON.stringify(logs).includes('PRIVATE-CONTENT'));
  const bad = createAiClient({ diagnostic: quiet, fetchImpl: async () => json({ text: null }) });
  await assert.rejects(bad.sendMessage({}), (e) => e.code === 'format');
});
test('client timeout and cancellation abort without resending', async () => {
  for (const cancel of [false, true]) {
    let count = 0;
    const client = createAiClient({
      diagnostic: quiet,
      timeoutMs: 20,
      fetchImpl: (url, { signal }) => {
        count++;
        return new Promise((resolve, reject) =>
          signal.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError'))),
        );
      },
    });
    const pending = client.sendMessage({});
    if (cancel) client.cancelRequest();
    await assert.rejects(pending, (e) => e.code === (cancel ? 'cancelled' : 'timeout'));
    assert.equal(count, 1);
  }
});

test('demo access code must never be the Gateway key', async () => {
  await withRelay(
    async () => {
      throw Error('must not reach Gateway');
    },
    async ({ login }) => {
      assert.equal((await login()).response.status, 503);
    },
    { overrides: { password: config.apiKey } },
  );
});
