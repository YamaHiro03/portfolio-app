import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
async function upload(page, file, title) {
  await page.goto('http://localhost:5173');
  if (await page.locator('.pdf-viewer').count())
    await page.getByRole('button', { name: 'PDFを閉じる', exact: true }).click();
  await page.getByRole('button', { name: '資料を追加', exact: true }).click();
  // Conversion API is retained for future integration; the current UI accepts only PDFs.
  const response = await page.request.post('http://localhost:3001/api/convert', {
    multipart: {
      file: {
        name: file,
        mimeType: 'application/octet-stream',
        buffer: await readFile('tests/fixtures/' + file),
      },
    },
  });
  expect(response.status()).toBe(200);
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: title, mimeType: 'application/pdf', buffer: await response.body() });
  await page.getByRole('button', { name: '追加する', exact: true }).click();
  await expect(page.locator('.pdf-header h2')).toHaveText(title);
  await expect(page.locator('.pdf-loading')).toHaveCount(0);
}
async function pdfContent(page) {
  return page.evaluate(async () => {
    const { read } = await import('/storage.js');
    const { getDocument, GlobalWorkerOptions } = await import(
      '/node_modules/pdfjs-dist/build/pdf.mjs'
    );
    GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
    const file = await read('files', JSON.parse(localStorage.getItem('folio-open-doc')));
    const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    try {
      const pdf = await task.promise;
      const pages = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        const content = await (await pdf.getPage(n)).getTextContent();
        pages.push(content.items.map((i) => i.str).join(''));
      }
      return pages;
    } finally {
      await task.destroy();
    }
  });
}
test('normal startup converts Japanese DOCX, preserves readable Japanese text @office', async ({
  page,
}) => {
  await upload(page, 'lecture-ja.docx', 'lecture-ja.pdf');
  const pages = await pdfContent(page);
  expect(pages).toHaveLength(1);
  expect(pages[0]).toContain('需要と供給');
  expect(pages[0]).toContain('価格弾力性');
  await page.screenshot({ path: '.runtime/word-docx.png' });
});
test('legacy DOC is readable as PDF @office', async ({ page }) => {
  await upload(page, 'legacy-simple.doc', 'legacy-simple.pdf');
  const pages = await pdfContent(page);
  expect(pages.join('').toLowerCase()).toContain('simple');
});
test('Word tables, embedded image, Japanese and page breaks survive conversion @office', async ({
  page,
}) => {
  await upload(page, 'lecture-layout.docx', 'lecture-layout.pdf');
  const pages = await pdfContent(page);
  expect(pages).toHaveLength(2);
  expect(pages[0]).toContain('需要曲線');
  expect(pages[0]).toContain('価格が上がると需要量は減少する');
  expect(pages[1]).toContain('復習問題');
  const greenPixels = await page.locator('.pdf-sheet > canvas:first-child').evaluate((c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let count = 0;
    for (let i = 0; i < d.length; i += 4)
      if (d[i + 1] > d[i] * 1.4 && d[i + 1] > d[i + 2] * 1.2 && d[i + 1] < 150) count++;
    return count;
  });
  expect(greenPixels).toBeGreaterThan(200);
  await page.screenshot({ path: '.runtime/word-layout.png' });
});
test('conversion API rejects corrupt Word without returning a PDF', async ({ request }) => {
  const response = await request.post('http://localhost:3001/api/convert', {
    multipart: {
      file: {
        name: 'broken.docx',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from('not a Word file'),
      },
    },
  });
  expect(response.status()).toBe(422);
  expect(response.headers()['content-type']).toContain('application/json');
  expect((await response.json()).error).toBeTruthy();
});
