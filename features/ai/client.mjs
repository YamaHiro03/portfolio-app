import { AiError } from './protocol.mjs';
// Only an origin is public build configuration. No Gateway URL or credential enters the app.
export function backendOrigin({
  configured = '',
  native = false,
  development = false,
  origin = globalThis.location?.origin || '',
} = {}) {
  if (configured) {
    let url;
    try {
      url = new URL(configured);
    } catch {
      throw new AiError('configuration', 'AIは現在利用できません。');
    }
    if (
      url.protocol !== 'https:' ||
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      throw new AiError('configuration', 'AIは現在利用できません。');
    return url.origin;
  }
  if (native) throw new AiError('configuration', 'AIは現在利用できません。');
  const url = new URL(origin);
  if (url.protocol === 'https:') return url.origin;
  if (
    development &&
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  )
    return url.origin;
  throw new AiError('configuration', 'AIは現在利用できません。');
}
export function createAiClient({
  fetchImpl = fetch,
  timeoutMs = 65000,
  baseUrl = '',
  diagnostic = (entry) => console.warn('Folio AI', entry),
} = {}) {
  let active = null,
    token = '',
    expiresAt = 0;
  async function request(operation, payload = {}, method = 'POST') {
    if (active) throw new AiError('busy', '別のAI処理が実行中です。');
    const controller = new AbortController();
    active = controller;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const response = await fetchImpl(baseUrl + '/api/ai/' + operation, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Folio-AI': '1',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
        credentials: 'omit',
        redirect: 'error',
      });
      let data;
      try {
        data = await response.json();
      } catch {
        throw new AiError('format', 'サーバーの応答を確認できませんでした。');
      }
      if (!response.ok) {
        if (response.status === 401) {
          token = '';
          expiresAt = 0;
        }
        const e = new AiError(data.code || 'gateway', data.error || 'AIに接続できませんでした。');
        e.requestId = data.requestId || response.headers.get('x-request-id');
        throw e;
      }
      if (operation === 'session' && method === 'POST') {
        if (
          typeof data.token !== 'string' ||
          !/^[a-f0-9]{64}$/.test(data.token) ||
          typeof data.expiresAt !== 'number'
        )
          throw new AiError('format', 'ログイン結果を確認できませんでした。');
        token = data.token;
        expiresAt = data.expiresAt;
        return { authenticated: true };
      }
      if (
        operation === 'message' &&
        (typeof data.text !== 'string' || !data.text.trim() || typeof data.model !== 'string')
      )
        throw new AiError('format', '回答の形式が不正です。');
      if (['status', 'test'].includes(operation) && data.ready !== true)
        throw new AiError('format', '接続状態を確認できませんでした。');
      if (
        operation === 'models' &&
        (!Array.isArray(data.models) || data.models.some((m) => typeof m !== 'string'))
      )
        throw new AiError('format', 'モデル一覧の形式が不正です。');
      return data;
    } catch (error) {
      if (controller.signal.aborted)
        throw new AiError(
          timedOut ? 'timeout' : 'cancelled',
          timedOut
            ? '時間内に回答を取得できませんでした。自動再送信はしません。'
            : '送信をキャンセルしました。開始済みの処理の取り消しは保証できません。',
        );
      const known =
        error instanceof AiError
          ? error
          : new AiError(
              'unavailable',
              'AIに接続できません。通信環境とサーバーの状態を確認してください。',
            );
      // Never log bodies, URLs, tokens, API keys or raw transport exceptions.
      diagnostic({
        event: 'ai_connection_error',
        code: known.code,
        requestId: known.requestId || null,
      });
      throw known;
    } finally {
      clearTimeout(timer);
      if (active === controller) active = null;
    }
  }
  return {
    login: (password) => request('session', { password }),
    logout: async () => {
      try {
        return await request('session', {}, 'DELETE');
      } finally {
        token = '';
        expiresAt = 0;
      }
    },
    isAuthenticated: () => !!token && expiresAt > Date.now(),
    status: () => request('status'),
    getModels: () => request('models'),
    testConnection: () => request('test'),
    sendMessage: (payload) => request('message', payload),
    cancelRequest: () => active?.abort(),
  };
}

// In-memory sessions survive navigation, but never survive a page reload or app restart.
const clients = new Map();
export function getAiClient(baseUrl) {
  if (!clients.has(baseUrl)) clients.set(baseUrl, createAiClient({ baseUrl }));
  return clients.get(baseUrl);
}
