import {test,expect} from '@playwright/test';
async function upload(page,file,title){
 await page.goto('http://localhost:5173');
 if(await page.locator('.pdf-viewer').count())await page.getByRole('button',{name:'PDFを閉じる',exact:true}).click();
 await page.getByRole('button',{name:'資料を追加',exact:true}).click();
 await expect(page.getByText('Word・PowerPoint変換：利用可能',{exact:true})).toBeVisible();
 await page.locator('input[type=file]').setInputFiles('tests/fixtures/'+file);
 const request=page.waitForResponse(r=>r.url().endsWith('/api/convert'));
 await page.getByRole('button',{name:'追加する',exact:true}).click();
 expect((await request).status()).toBe(200);
 await expect(page.locator('.pdf-header h2')).toHaveText(title);
 await expect(page.locator('.pdf-loading')).toHaveCount(0);
}
async function pdfContent(page){return page.evaluate(async()=>{
 const {read}=await import('/storage.js');
 const {getDocument,GlobalWorkerOptions}=await import('/node_modules/pdfjs-dist/build/pdf.mjs');
 GlobalWorkerOptions.workerSrc='/node_modules/pdfjs-dist/build/pdf.worker.mjs';
 const file=await read('files',JSON.parse(localStorage.getItem('folio-open-doc')));
 const task=getDocument({data:new Uint8Array(await file.arrayBuffer())});
 try{const pdf=await task.promise;const pages=[];for(let n=1;n<=pdf.numPages;n++){const content=await(await pdf.getPage(n)).getTextContent();pages.push(content.items.map(i=>i.str).join(''))}return pages}finally{await task.destroy()}
})}
test('normal startup converts Japanese DOCX, preserves readable Japanese text @office',async({page})=>{
 await upload(page,'lecture-ja.docx','lecture-ja.pdf');
 const pages=await pdfContent(page);expect(pages).toHaveLength(1);expect(pages[0]).toContain('需要と供給');expect(pages[0]).toContain('価格弾力性');
 await page.screenshot({path:'.runtime/word-docx.png'});
});
test('legacy DOC is readable as PDF @office',async({page})=>{
 await upload(page,'legacy-simple.doc','legacy-simple.pdf');
 const pages=await pdfContent(page);expect(pages.join('').toLowerCase()).toContain('simple');
});
test('Word tables, embedded image, Japanese and page breaks survive conversion @office',async({page})=>{
 await upload(page,'lecture-layout.docx','lecture-layout.pdf');
 const pages=await pdfContent(page);expect(pages).toHaveLength(2);expect(pages[0]).toContain('需要曲線');expect(pages[0]).toContain('価格が上がると需要量は減少する');expect(pages[1]).toContain('復習問題');
 const greenPixels=await page.locator('.pdf-sheet > canvas:first-child').evaluate(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let count=0;for(let i=0;i<d.length;i+=4)if(d[i+1]>d[i]*1.4&&d[i+1]>d[i+2]*1.2&&d[i+1]<150)count++;return count});expect(greenPixels).toBeGreaterThan(200);
 await page.screenshot({path:'.runtime/word-layout.png'});
});
test('Word conversion error remains visible and keeps the selected file',async({page})=>{
 await page.route('**/api/convert',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'変換エンジンを起動できませんでした。'})}));await page.goto('http://localhost:5173');await page.getByRole('button',{name:'資料を追加',exact:true}).click();await page.locator('input[type=file]').setInputFiles('tests/fixtures/lecture-ja.docx');await page.getByRole('button',{name:'追加する',exact:true}).click();await expect(page.getByRole('alert')).toHaveText('変換エンジンを起動できませんでした。');await page.waitForTimeout(4000);await expect(page.getByRole('alert')).toBeVisible();expect(await page.locator('input[type=file]').evaluate(el=>el.files[0].name)).toBe('lecture-ja.docx');
});
