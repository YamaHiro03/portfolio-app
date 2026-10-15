import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { createAiRouter } from '../server/ai.mjs';
import {
  DEFAULT_SETTINGS,
  buildMessages,
  normalizeBaseUrl,
  upstreamError,
} from '../features/ai/protocol.mjs';
import { createAiClient, loadSettings, saveSettings } from '../features/ai/client.mjs';
import { extractPages } from '../features/ai/extract-pages.mjs';
const settings = { ...DEFAULT_SETTINGS, apiKey: 'test-local-gateway-key' };
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

test('settings default to Luna, persist endpoint/model, and never persist key', () => {
  const values = new Map();
  const storage = { getItem: (k) => values.get(k), setItem: (k, v) => values.set(k, v) };
  assert.equal(loadSettings(storage).model, 'gpt-6-luna');
  saveSettings({ ...settings, model: 'custom-local-model' }, storage);
  assert.equal(loadSettings(storage).model, 'custom-local-model');
  assert.ok(!JSON.stringify([...values.values()]).includes(settings.apiKey));
  values.set('folio-ai-settings-v1', 'broken');
  assert.equal(loadSettings(storage).baseUrl, DEFAULT_SETTINGS.baseUrl);
  for (const url of [
    'https://api.openai.com/v1',
    'http://127.0.0.1.evil/v1',
    'http://user:pass@localhost:8317/v1',
    'http://192.168.1.1/v1',
  ])
    assert.throws(() => normalizeBaseUrl(url));
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
async function withRelay(fetchImpl, fn, timeoutMs = 1000) {
  const app = express();
  app.use('/api/ai', createAiRouter({ fetchImpl, timeoutMs }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (operation, body = {}, headers = {}) =>
    fetch(base + '/api/ai/' + operation, {
      method: 'POST',
      headers: { Origin: base, 'X-Folio-AI': '1', 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ settings, ...body }),
    });
  try {
    await fn(call);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
test('relay fetches models, tests the explicit model, and sends one bounded request with a bearer key', async () => {
  const calls = [];
  await withRelay(
    async (url, options) => {
      calls.push({ url, options });
      return url.endsWith('/models')
        ? json({ data: [{ id: 'gpt-6-luna' }, { id: 'gpt-6-astra' }] })
        : json({
            model: 'gpt-6-luna',
            choices: [{ message: { content: '資料の回答' }, finish_reason: 'stop' }],
          });
    },
    async (call) => {
      assert.deepEqual((await (await call('models')).json()).models, ['gpt-6-luna', 'gpt-6-astra']);
      assert.equal((await call('test')).status, 200);
      const result = await (
        await call('message', { context: '[ページ 1] 資料', question: '説明して' })
      ).json();
      assert.equal(result.text, '資料の回答');
      assert.equal(result.model, 'gpt-6-luna');
      assert.equal(calls[2].options.headers.Authorization, `Bearer ${settings.apiKey}`);
      assert.equal(JSON.parse(calls[2].options.body).model, 'gpt-6-luna');
      assert.equal(calls[2].options.redirect, 'error');
      assert.equal(calls.length, 3);
    },
  );
});
test('relay rejects non-local destinations, untrusted origins and unauthenticated requests before contacting Gateway', async () => {
  let count = 0;
  await withRelay(
    async () => {
      count++;
      return json({ data: [] });
    },
    async (call) => {
      assert.equal((await call('models', {}, { Origin: 'https://untrusted.example' })).status, 403);
      assert.equal((await call('models', {}, { 'X-Folio-AI': '' })).status, 403);
      assert.equal((await call('models', {}, { 'X-Forwarded-For': '198.51.100.1' })).status, 403);
      assert.equal((await call('models', { settings: { ...settings, apiKey: '' } })).status, 401);
      assert.equal(
        (await call('models', { settings: { ...settings, baseUrl: 'https://api.openai.com/v1' } }))
          .status,
        400,
      );
      assert.equal(count, 0);
    },
  );
});
test('quota errors stop after one request; authentication, model, context and malformed response errors stay distinct', async () => {
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
      async (call) => {
        const response = await call('message', { context: '本文', question: '質問' });
        assert.equal((await response.json()).code, code);
        assert.equal(count, 1);
      },
    );
  }
  assert.equal(upstreamError(402, {}).code, 'limit');
});
test('server timeout aborts upstream once and returns an explicit error', async () => {
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
    async (call) => {
      const result = await call('message', { context: '本文', question: '質問' });
      assert.equal(result.status, 504);
      assert.equal((await result.json()).code, 'timeout');
      assert.equal(count, 1);
      assert.ok(aborted);
    },
    20,
  );
});
test('client models, message parsing, no retries on quota or malformed replies', async () => {
  let count = 0;
  const client = createAiClient({
    fetchImpl: async (url) => {
      count++;
      return url.endsWith('models')
        ? json({ models: ['gpt-6-luna'] })
        : json({ code: 'limit', error: '上限到達' }, 429);
    },
  });
  assert.deepEqual((await client.getModels(settings)).models, ['gpt-6-luna']);
  await assert.rejects(client.sendMessage(settings, {}), (e) => e.code === 'limit');
  assert.equal(count, 2);
  const bad = createAiClient({ fetchImpl: async () => json({ text: null }) });
  await assert.rejects(bad.sendMessage(settings, {}), (e) => e.code === 'format');
});
test('client timeout and user cancellation abort rather than re-send', async () => {
  for (const cancel of [false, true]) {
    let count = 0;
    const client = createAiClient({
      timeoutMs: 20,
      fetchImpl: (url, { signal }) => {
        count++;
        return new Promise((resolve, reject) =>
          signal.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError'))),
        );
      },
    });
    const pending = client.sendMessage(settings, {});
    if (cancel) client.cancelRequest();
    await assert.rejects(pending, (e) => e.code === (cancel ? 'cancelled' : 'timeout'));
    assert.equal(count, 1);
  }
});
