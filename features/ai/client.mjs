import { DEFAULT_SETTINGS, AiError, normalizeBaseUrl, validateSettings } from './protocol.mjs';
const storageKey = 'folio-ai-settings-v1';
let memoryKey = '';
export function loadSettings(storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage.getItem(storageKey) || '{}');
    return {
      ...DEFAULT_SETTINGS,
      baseUrl: normalizeBaseUrl(value.baseUrl || DEFAULT_SETTINGS.baseUrl),
      model:
        typeof value.model === 'string' && value.model.trim()
          ? value.model
          : DEFAULT_SETTINGS.model,
      apiKey: memoryKey,
    };
  } catch {
    return { ...DEFAULT_SETTINGS, apiKey: memoryKey };
  }
}
export function saveSettings(value, storage = globalThis.localStorage) {
  const checked = validateSettings(value);
  // Credentials are deliberately session memory only, never Web Storage or IndexedDB.
  storage.setItem(storageKey, JSON.stringify({ baseUrl: checked.baseUrl, model: checked.model }));
  memoryKey = checked.apiKey;
  return checked;
}
export function createAiClient({ fetchImpl = fetch, timeoutMs = 65000 } = {}) {
  let active = null;
  async function request(operation, settings, payload = {}) {
    if (active) throw new AiError('busy', '別のAI処理が実行中です。');
    validateSettings(settings);
    const controller = new AbortController();
    active = controller;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const response = await fetchImpl('/api/ai/' + operation, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Folio-AI': '1' },
        body: JSON.stringify({ settings, ...payload }),
        signal: controller.signal,
      });
      let data;
      try {
        data = await response.json();
      } catch {
        throw new AiError('format', 'サーバーの応答形式が不正です。');
      }
      if (!response.ok)
        throw new AiError(data.code || 'gateway', data.error || 'AI接続に失敗しました。');
      if (
        operation === 'message'
          ? typeof data.text !== 'string' || !data.text.trim() || typeof data.model !== 'string'
          : !Array.isArray(data.models) || data.models.some((m) => typeof m !== 'string')
      )
        throw new AiError('format', 'サーバーの応答形式が不正です。');
      return data;
    } catch (error) {
      if (controller.signal.aborted)
        throw new AiError(
          timedOut ? 'timeout' : 'cancelled',
          timedOut
            ? 'タイムアウトしました。自動再送信はしません。'
            : '送信をキャンセルしました。Gatewayで開始済みの処理や利用枠消費の取り消しは保証できません。',
        );
      if (error instanceof AiError) throw error;
      throw new AiError(
        'unavailable',
        'Folioサーバーに接続できません。npm run dev または npm start の起動状態を確認してください。',
      );
    } finally {
      clearTimeout(timer);
      if (active === controller) active = null;
    }
  }
  return {
    getModels: (s) => request('models', s),
    testConnection: (s) => request('test', s),
    sendMessage: (s, p) => request('message', s, p),
    cancelRequest: () => active?.abort(),
  };
}
