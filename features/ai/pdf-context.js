import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { libraryRepository } from '../../library-repository';
import { extractPages } from './extract-pages.mjs';
import { AiError } from './protocol.mjs';
GlobalWorkerOptions.workerSrc = workerUrl;
export async function extractDocumentContext(doc, from, to, { signal } = {}) {
  let task;
  const abort = () => task?.destroy();
  try {
    const blob = await libraryRepository.loadFile(doc);
    if (!blob) throw Error('missing');
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    task = getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false });
    task.onPassword = () => {
      task.destroy();
    };
    signal?.addEventListener('abort', abort, { once: true });
    const pdf = await task.promise;
    return { text: await extractPages(pdf, from, to, { signal }), numPages: pdf.numPages };
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (error instanceof AiError) throw error;
    throw new AiError(
      'pdf',
      `「${doc.title}」のPDFを解析できませんでした。破損・パスワード保護を確認してください。`,
    );
  } finally {
    signal?.removeEventListener('abort', abort);
    await task?.destroy();
  }
}
