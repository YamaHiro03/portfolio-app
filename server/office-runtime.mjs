import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
const managed=fileURLToPath(new URL('../.runtime/office/soffice',import.meta.url));
export function officeExecutable(){if(process.env.LIBREOFFICE_BIN)return process.env.LIBREOFFICE_BIN;return existsSync(managed)?managed:process.platform==='darwin'?'/Applications/LibreOffice.app/Contents/MacOS/soffice':process.platform==='win32'?'C:\\Program Files\\LibreOffice\\program\\soffice.exe':'libreoffice'}
let cachedHealth, healthCheckedAt=0, healthCheck;
export async function officeHealth({force=false}={}){
 if(!force&&cachedHealth&&Date.now()-healthCheckedAt<30000)return cachedHealth;
 if(healthCheck)return healthCheck;
 healthCheck=(async()=>{try{
  const {stdout}=await execute(officeExecutable(),['--headless','--version'],{timeout:10000,maxBuffer:32768});
  const {convert}=await import('./convert.mjs');
  const probe=await readFile(new URL('./assets/health-check.docx',import.meta.url));
  const output=await convert(probe,'health-check.docx');
  if(output.subarray(0,5).toString()!=='%PDF-')throw Error('Invalid PDF output');
  return {available:true,version:stdout.trim(),verified:'docx-to-pdf'};
 }catch{return {available:false,message:'Word・PowerPointのPDF変換を確認できませんでした。サーバーで npm run setup:office を実行してから再起動してください。'}}})();
 try{cachedHealth=await healthCheck;healthCheckedAt=Date.now();return cachedHealth}finally{healthCheck=null}
}
