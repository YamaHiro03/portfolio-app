import { AiError, MAX_CONTEXT_CHARS } from './protocol.mjs';
export async function extractPages(pdf, from, to, { signal } = {}) {
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 1 ||
    to < from ||
    to > pdf.numPages ||
    to - from >= 5
  )
    throw new AiError('pdf', '対象は実在するページを最大5ページまで指定してください。');
  let text = '';
  for (let number = from; number <= to; number++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const page = await pdf.getPage(number);
    try {
      const content = await page.getTextContent();
      const body = content.items
        .filter((i) => typeof i.str === 'string')
        .map((i) => i.str + (i.hasEOL ? '\n' : ' '))
        .join('')
        .trim();
      if (!body)
        throw new AiError(
          'pdf',
          `${number}ページから文字を抽出できません。OCRは未対応です。対象ページを変更してください。`,
        );
      text += `[ページ ${number}]\n${body}\n\n`;
      if (text.length > MAX_CONTEXT_CHARS)
        throw new AiError(
          'context',
          '抽出本文が12,000文字を超えました。対象ページを減らしてください。',
        );
    } finally {
      page.cleanup?.();
    }
  }
  return text.trim();
}
