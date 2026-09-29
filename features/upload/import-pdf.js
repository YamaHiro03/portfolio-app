import { libraryRepository } from '../../library-repository';

// The current product accepts PDFs only. Conversion remains a separate server capability.
export async function importPdfFile(file, title, parentId = null) {
  if (file.size > 50 * 1024 * 1024) throw Error('50 MB以下のファイルを選択してください');
  if (!file.name.toLowerCase().endsWith('.pdf')) throw Error('現在はPDFのみ取り込めます。');
  if ((await file.slice(0, 5).text()) !== '%PDF-') throw Error('有効なPDFではありません。');
  const id = crypto.randomUUID();
  const doc = {
    id,
    parentId,
    title: title || file.name,
    originalName: file.name,
    date: new Date().toISOString().slice(0, 10),
    size: `${(file.size / 1024 / 1024).toFixed(1)} MB`,
    star: false,
    note: '',
    storedPdf: true,
    mime: 'application/pdf',
    text: '',
  };
  return { result: await libraryRepository.importFile(doc, file), id };
}
