import {isNativeApp} from './mobile-runtime';
const key='folio-conversion-server';
export function normalizeServer(value){const raw=String(value||'').trim();if(!raw)return '';let url;try{url=new URL(raw)}catch{throw Error('変換サーバーのHTTPS URLを入力してください。')}if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('ユーザー情報・クエリを含まないHTTPS URLを入力してください。');return url.href.replace(/\/+$/,'')}
export function getServer(){try{return localStorage.getItem(key)||import.meta.env.VITE_CONVERSION_SERVER||''}catch{return import.meta.env.VITE_CONVERSION_SERVER||''}}
export function setServer(value){const url=normalizeServer(value);if(url)localStorage.setItem(key,url);else localStorage.removeItem(key);window.dispatchEvent(new Event('folio-server-changed'));return url}
export async function apiFetch(path,options={}){const base=normalizeServer(getServer());if(!base&&isNativeApp())return Promise.reject(Error('画像・Wordの変換には、変換サーバーの接続先を設定してください。'));return fetch(base+path,options)}
