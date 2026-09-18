import {isNativeApp,saveNativeFile} from './mobile-runtime';
// OS filenames are stricter than legacy document display titles. Never rename the app entry.
export function externalPdfName(value){
 const stem=String(value||'資料').normalize('NFC').replace(/\.pdf$/i,'').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').replace(/[. ]+$/g,'').trim()||'資料';
 const safe=/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)?'_'+stem:stem;
 let result='',bytes=0;const encoder=new TextEncoder();for(const char of safe){const length=encoder.encode(char).length;if(bytes+length>240)break;result+=char;bytes+=length}return result+'.pdf';
}
export function externalSaveError(error,stage){
 const detail=error?.message||'原因不明のエラー';
 if(error?.name==='SecurityError')return 'この画面ではブラウザが保存先の選択を許可していません。アプリを通常のブラウザで直接開き、保存をやり直してください。';
 if(error?.name==='NotAllowedError')return '保存先へのアクセスが許可されていません。ブラウザの保存先設定とアクセス権限を確認してください。';
 if(error?.name==='QuotaExceededError')return '保存先の空き容量が不足しています。空き容量を確保するか別の保存先を選んでください。';
 return `${stage==='picker'?'保存先を開けませんでした':stage==='generate'?'PDFを作成できませんでした':'PDFを書き出せませんでした'}：${detail}`;
}
export const externalStorage={
 canChooseLocation:()=>typeof window.showSaveFilePicker==='function'&&window.isSecureContext,
 // Invoke the picker during the click, before awaiting PDF generation.
 chooseDestination(name){const safeName=externalPdfName(name);if(this.canChooseLocation())return window.showSaveFilePicker({suggestedName:safeName,types:[{description:'PDF',accept:{'application/pdf':['.pdf']}}],excludeAcceptAllOption:true}).then(handle=>({kind:'file-handle',handle}));return Promise.resolve({kind:'download',name:safeName})},
 async write(destination,blob){
  if(destination.kind==='file-handle'){
   let stream;
   try{stream=await destination.handle.createWritable();await stream.write(blob);await stream.close()}
   catch(error){try{await stream?.abort()}catch{}throw error}
   return '外部フォルダにPDFを保存しました。アプリ内の下書きは保持しています。';
  }
  if(isNativeApp())return saveNativeFile(blob,externalPdfName(destination.name));
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=externalPdfName(destination.name);document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  return 'PDFのダウンロードを開始しました。アプリ内の下書きは保持しています。';
 }
};
