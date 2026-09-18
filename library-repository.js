// UI contract: implementations return {entries, docs}. A cloud provider can implement
// this interface without exposing its paths/SDKs to the explorer. IDs remain stable.
import * as local from './storage';
import {PDFDocument} from 'pdf-lib';
export const libraryRepository={
 id:'indexeddb',
 createNote:async(parentId=null)=>{const pdf=await PDFDocument.create();pdf.addPage([595.28,841.89]);const blob=new Blob([await pdf.save()],{type:'application/pdf'}),id=crypto.randomUUID();await local.importPdf({id,parentId,title:'新しいメモ.pdf',storedPdf:true,mime:'application/pdf',isHandwrittenNote:true,note:'',star:false},blob);return {...await local.listLibrary(),id}},
 initialize:local.initializeLibrary,
 list:local.listLibrary,
 createFolder:local.createFolder,
 rename:local.renameEntry,
 move:local.moveEntry,
 remove:local.deletePdf,
 duplicate:local.duplicateEntry,
 updateFile:local.updateDocument,
 saveEdition:local.saveEdition,
 importFile:async(doc,blob)=>{await local.importPdf(doc,blob);return local.listLibrary()},
 loadFile:async doc=>doc.data?await(await fetch(doc.data)).blob():local.read('files',doc.storage?.key??doc.id),
};
