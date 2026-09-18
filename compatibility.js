// WKWebView / older Android WebView require these standard JS APIs for PDF.js.
import 'core-js/actual';
if(!AbortSignal.timeout){AbortSignal.timeout=milliseconds=>{const controller=new AbortController();setTimeout(()=>controller.abort(new DOMException('Timed out','TimeoutError')),milliseconds);return controller.signal}}
