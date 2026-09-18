import {Capacitor,registerPlugin} from '@capacitor/core';
export const isNativeApp=()=>Capacitor.isNativePlatform();
const NativeFiles=registerPlugin('FolioFiles');
export function blobBase64(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('PDFデータを読み込めませんでした。'));reader.readAsDataURL(blob)})}
export async function saveNativeFile(blob,name){
 const result=await NativeFiles.saveFile({name,mimeType:blob.type||'application/octet-stream',data:await blobBase64(blob)});
 return result.cancelled?'保存をキャンセルしました。編集内容は端末に保持しています。':'端末の保存先にファイルを保存しました。';
}
