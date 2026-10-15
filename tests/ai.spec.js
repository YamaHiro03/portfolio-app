import { test as base, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { PDFDocument } from 'pdf-lib';
import { pdfFixture } from './fixtures';
const test = base.extend({
  gateway: async ({}, use) => {
    const state = { requests: [], mode: 'answer' };
    const server = createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      state.requests.push({
        url: req.url,
        auth: req.headers.authorization,
        body: body ? JSON.parse(body) : null,
      });
      res.setHeader('Content-Type', 'application/json');
      if (req.headers.authorization !== 'Bearer local-test-key') {
        res.writeHead(401);
        res.end(JSON.stringify({ error: { code: 'invalid_api_key' } }));
        return;
      }
      if (req.url === '/v1/models') {
        res.end(JSON.stringify({ data: [{ id: 'gpt-6-luna' }, { id: 'gpt-6-astra' }] }));
        return;
      }
      if (state.mode === 'quota') {
        res.writeHead(429);
        res.end(JSON.stringify({ error: { code: 'insufficient_quota' } }));
        return;
      }
      if (state.mode === 'delay') {
        req.on('close', () => {});
        return;
      }
      res.end(
        JSON.stringify({
          model: 'gpt-6-luna',
          choices: [
            {
              message: { content: '資料の1ページにはFolio annotation testと書かれています。' },
              finish_reason: 'stop',
            },
          ],
        }),
      );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    state.url = `http://127.0.0.1:${server.address().port}/v1`;
    try {
      await use(state);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  },
});
async function openAi(page, buffer = pdfFixture()) {
  await page.goto('http://localhost:5173');
  await page.getByRole('button', { name: '資料を追加', exact: true }).click();
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'AI資料.pdf', mimeType: 'application/pdf', buffer });
  await page.getByRole('button', { name: '追加する', exact: true }).click();
  await expect(page.locator('.pdf-loading')).toHaveCount(0);
  await page.getByRole('button', { name: 'このPDFに質問', exact: true }).click();
  await expect(page.getByLabel('AIの対象資料')).toHaveValue(/.+/);
}
async function configure(page, gateway) {
  await page.getByLabel('Gateway URL', { exact: true }).fill(gateway.url);
  await page.getByLabel('ローカルAPIキー', { exact: true }).fill('local-test-key');
}
async function prepare(page) {
  await page.getByRole('button', { name: '本文を抽出', exact: true }).click();
  await expect(page.getByLabel('送信するPDF本文')).toContainText('Folio annotation test');
  await page.getByLabel('AIへの指示').fill('このページの内容を教えて');
  await page.getByRole('checkbox').check();
}
async function pdfSnapshot(page, id) {
  return page.evaluate(async (id) => {
    const { read } = await import('/storage.js');
    return {
      bytes: Array.from(new Uint8Array(await (await read('files', id)).arrayBuffer())),
      annotations: await read('annotations', id),
      draft: await read('drafts', id),
    };
  }, id);
}
test('PDF -> real Express relay -> mock Gateway -> answer, per-document persistence and deletion', async ({
  page,
  gateway,
}) => {
  await openAi(page);
  const id = await page.getByLabel('AIの対象資料').inputValue();
  const originalPdf = await pdfSnapshot(page, id);
  await configure(page, gateway);
  await expect(page.getByLabel('使用モデル', { exact: true })).toHaveValue('gpt-6-luna');
  await page.getByRole('button', { name: 'モデル一覧を取得', exact: true }).click();
  await expect(page.getByLabel('利用可能モデル一覧')).toContainText('gpt-6-astra');
  await expect(page.getByLabel('使用モデル', { exact: true })).toHaveValue('gpt-6-luna');
  await page.getByRole('button', { name: '接続テスト', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('指定モデル');
  await prepare(page);
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect(page.locator('.ai-transcript .message.ai')).toContainText('1ページ');
  const request = gateway.requests.find((r) => r.url.endsWith('/chat/completions'));
  expect(request.body.model).toBe('gpt-6-luna');
  expect(request.body.messages[1].content).toContain('[ページ 1]');
  expect(request.body.messages[1].content).not.toContain('[ページ 2]');
  const saved = await page.evaluate(async (id) => {
    const { read } = await import('/storage.js');
    const entry = await read('aiConversations', id);
    return { entry, settings: localStorage.getItem('folio-ai-settings-v1') };
  }, id);
  expect(await pdfSnapshot(page, id)).toEqual(originalPdf);
  expect(saved.entry[0].documentId).toBe(id);
  expect(saved.entry[0].model).toBe('gpt-6-luna');
  expect(JSON.stringify(saved)).not.toContain('local-test-key');
  await page.reload();
  await page.getByRole('button', { name: 'AIアシスタント', exact: false }).first().click();
  await page.getByLabel('AIの対象資料').selectOption(id);
  await expect(page.locator('.ai-transcript .message.ai')).toContainText('1ページ');
  await expect(page.getByLabel('ローカルAPIキー', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Gateway URL', { exact: true })).toHaveValue(gateway.url);
  // Copies have independent histories; deleting a PDF deletes its history, not unrelated PDFs.
  const state = await page.evaluate(async (id) => {
    const { libraryRepository: r } = await import('/library-repository.js');
    const { read, saveConversation } = await import('/storage.js');
    const result = await r.duplicate(id);
    const copy = result.entry.id;
    const blank = await read('aiConversations', copy);
    await r.remove(id);
    let rejected = false;
    try {
      await saveConversation(id, []);
    } catch {
      rejected = true;
    }
    return {
      blank,
      deleted: await read('aiConversations', id),
      rejected,
      copyExists: !!(await r.list()).entries.find((e) => e.id === copy),
    };
  }, id);
  expect(state.blank).toBeUndefined();
  expect(state.deleted).toBeUndefined();
  expect(state.rejected).toBe(true);
  expect(state.copyExists).toBe(true);
});
test('quota stops without a second request, cancellation keeps the question and does not save a fake answer', async ({
  page,
  gateway,
}) => {
  await openAi(page);
  await configure(page, gateway);
  await prepare(page);
  gateway.mode = 'quota';
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('利用上限');
  await page.waitForTimeout(300);
  expect(gateway.requests.filter((r) => r.url.endsWith('/chat/completions'))).toHaveLength(1);
  gateway.mode = 'delay';
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect(page.getByRole('button', { name: '送信キャンセル', exact: true })).toBeVisible();
  await expect
    .poll(() => gateway.requests.filter((r) => r.url.endsWith('/chat/completions')).length)
    .toBe(2);
  await page.getByRole('button', { name: '送信キャンセル', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('キャンセル');
  await expect(page.locator('.ai-transcript .message')).toHaveCount(0);
  await expect(page.getByLabel('AIへの指示')).not.toHaveValue('');
  expect(gateway.requests.filter((r) => r.url.endsWith('/chat/completions'))).toHaveLength(2);
});
test('image-only PDF refuses text submission with a page-specific OCR message', async ({
  page,
}) => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  await openAi(page, Buffer.from(await pdf.save()));
  await page.getByRole('button', { name: '本文を抽出', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('1ページ');
  await expect(page.getByRole('alert')).toContainText('OCR');
  await expect(page.getByRole('button', { name: '送信', exact: true })).toBeDisabled();
});
test('native mobile builds disable AI connection and inference', async ({ page }) => {
  await page.addInitScript(() => {
    window.CapacitorCustomPlatform = { name: 'ios' };
  });
  await page.goto('http://localhost:5173');
  await page.getByRole('button', { name: 'AIアシスタント', exact: false }).first().click();
  await expect(page.getByRole('alert')).toContainText('PC上のlocalhost');
  await expect(page.getByRole('button', { name: '接続テスト', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '送信', exact: true })).toBeDisabled();
});
