import express from 'express';
import { AiError, buildMessages, upstreamError } from '../features/ai/protocol.mjs';
import { readAiConfig, gatewaySettings } from './ai-config.mjs';
import { createAiAccess } from './ai-access.mjs';
export function createAiRouter({
  fetchImpl = fetch,
  timeoutMs = 60000,
  config = readAiConfig(),
  log,
  now,
} = {}) {
  const router = express.Router();
  const access = createAiAccess(config, { log, now });
  router.use(access.guard);
  router.use(express.json({ limit: '128kb' }));
  router.post('/session', access.login);
  router.use(access.authenticate);
  router.delete('/session', access.logout);
  let active = 0;
  router.post('/:operation', async (req, res) => {
    if (active >= 2)
      return res.status(429).json({
        code: 'request_limit',
        error: 'AIが処理中です。しばらく待って手動で送信してください。',
      });
    active++;
    const controller = new AbortController();
    const disconnected = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on('close', disconnected);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))
        throw new AiError('format', 'リクエストの形式が不正です。');
      if (req.body.settings !== undefined)
        throw new AiError('format', '接続設定はクライアントから変更できません。');
      const { baseUrl, apiKey, model } = gatewaySettings(config);
      const operation = req.params.operation;
      if (!['models', 'test', 'status', 'message'].includes(operation))
        throw new AiError('format', '不明な操作です。');
      const path = operation === 'message' ? '/chat/completions' : '/models';
      const payload =
        operation === 'message'
          ? {
              model,
              stream: false,
              messages: buildMessages(req.body.context, req.body.question, req.body.history),
            }
          : undefined;
      const response = await fetchImpl(baseUrl + path, {
        method: payload ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
        signal: controller.signal,
        redirect: 'error',
      });
      // Bound Gateway responses too. No raw upstream text or credential-bearing errors are logged.
      let raw = '';
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          raw += decoder.decode(value, { stream: true });
          if (raw.length > 200000) {
            await reader.cancel();
            throw new AiError('format', 'Gatewayの応答が大きすぎます。', 502);
          }
        }
        raw += decoder.decode();
      } finally {
        reader.releaseLock();
      }
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new AiError('format', 'Gatewayの応答形式が不正です。', 502);
      }
      if (!response.ok || data.error) throw upstreamError(response.status, data);
      if (operation !== 'message') {
        if (!Array.isArray(data.data) || data.data.some((m) => typeof m.id !== 'string'))
          throw new AiError('format', 'モデル一覧の形式が不正です。', 502);
        const models = data.data.map((m) => m.id);
        if (['test', 'status'].includes(operation) && !models.includes(model))
          throw new AiError('model', '現在のAIを利用できません。管理者に確認してください。');
        return res.json(operation === 'models' ? { models } : { ready: true, model });
      }
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim())
        throw new AiError('format', '回答本文を取得できませんでした。', 502);
      if (data.choices[0].finish_reason === 'length')
        throw new AiError(
          'context',
          '回答が上限で途切れました。質問または対象範囲を減らしてください。',
          400,
        );
      res.json({ text, model, returnedModel: typeof data.model === 'string' ? data.model : null });
    } catch (error) {
      if (res.destroyed) return;
      const known =
        error instanceof AiError
          ? error
          : timedOut
            ? new AiError(
                'timeout',
                'タイムアウトしました。結果は不明です。再送信はユーザー操作で行ってください。',
                504,
              )
            : new AiError(
                'unavailable',
                'AIに接続できないか通信が中断されました。管理者に確認してください。自動再送信はしません。',
                502,
              );
      res
        .status(known.status)
        .json({ code: known.code, error: known.message, requestId: res.locals.aiRequestId });
    } finally {
      active--;
      clearTimeout(timer);
      res.off('close', disconnected);
    }
  });
  router.use((error, req, res, next) =>
    res.status(400).json({ code: 'format', error: 'リクエストの形式またはサイズが不正です。' }),
  );
  return router;
}
