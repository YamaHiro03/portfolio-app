import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
const loopbackNames = new Set(['localhost', '127.0.0.1', '[::1]']);
const nativeOrigins = new Set(['capacitor://localhost', 'https://localhost']);
export const isLoopback = (address) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
function parseOrigin(value) {
  if (nativeOrigins.has(value)) return new URL(value);
  try {
    const u = new URL(value);
    return u.origin === value && !u.username && !u.password ? u : null;
  } catch {
    return null;
  }
}
export function createAiAccess(
  config,
  { log = (entry) => console.info(JSON.stringify(entry)), now = Date.now } = {},
) {
  const sessions = new Map();
  let failedLogins = [];
  const requests = new Map();
  function failure(res, status, code, error) {
    return res.status(status).json({ code, error, requestId: res.locals.aiRequestId });
  }
  function publicUrl() {
    const u = parseOrigin(config.publicOrigin);
    return u?.protocol === 'https:' && !loopbackNames.has(u.hostname) ? u : null;
  }
  function remoteReady() {
    return (
      config.remoteEnabled &&
      config.keyRotated &&
      config.password.length >= 24 &&
      config.password !== config.apiKey &&
      config.apiKey.length >= 24 &&
      publicUrl()
    );
  }
  function permitted(req) {
    const origin = req.get('origin');
    const parsed = parseOrigin(origin);
    if (!parsed) {
      req.aiAccessReason = 'origin_denied';
      return false;
    }
    const host = req.get('host');
    const peerLocal = isLoopback(req.socket.remoteAddress);
    const publicOrigin = publicUrl();
    const secure =
      !!req.socket.encrypted ||
      (config.trustLocalProxy && peerLocal && req.get('x-forwarded-proto') === 'https');
    const publicHost =
      publicOrigin &&
      (host === publicOrigin.host ||
        (config.trustLocalProxy && peerLocal && req.get('x-forwarded-host') === publicOrigin.host));
    if (
      remoteReady() &&
      secure &&
      publicHost &&
      (origin === config.publicOrigin || nativeOrigins.has(origin))
    )
      return true;
    // HTTP is a deliberately opt-in development exception; never allowed for phone/native origins.
    req.aiAccessReason = !config.remoteEnabled
      ? 'remote_disabled'
      : !config.keyRotated
        ? 'rotation_required'
        : !publicOrigin
          ? 'server_not_configured'
          : !secure
            ? 'https_required'
            : !publicHost
              ? 'host_denied'
              : 'origin_denied';
    const localAllowed =
      config.allowLocalHttp &&
      peerLocal &&
      !req.get('x-forwarded-for') &&
      loopbackNames.has(req.hostname) &&
      loopbackNames.has(parsed.hostname) &&
      parsed.protocol === 'http:' &&
      !nativeOrigins.has(origin);
    if (
      !localAllowed &&
      config.remoteEnabled &&
      config.keyRotated &&
      !req.socket.encrypted &&
      req.get('x-forwarded-proto') === 'https' &&
      (!config.trustLocalProxy || !peerLocal)
    )
      req.aiAccessReason = 'proxy_not_trusted';
    if (localAllowed) req.aiAccessReason = 'local_development';
    return localAllowed;
  }
  function guard(req, res, next) {
    const started = now();
    const id = randomUUID();
    res.locals.aiRequestId = id;
    res.set({ 'Cache-Control': 'no-store', 'X-Request-ID': id });
    const action = /^\/(session|status|test|models|message)$/.test(req.path)
      ? req.path.slice(1)
      : 'unknown';
    res.on('finish', () => {
      log({
        event: 'folio_ai',
        requestId: id,
        action,
        status: res.statusCode,
        code: res.locals.aiCode || null,
        reason: req.aiAccessReason || null,
        durationMs: now() - started,
      });
    });
    res.on('close', () => {
      if (!res.writableEnded)
        log({
          event: 'folio_ai',
          requestId: id,
          action,
          status: 499,
          code: 'client_disconnected',
          durationMs: now() - started,
        });
    });
    const originalJson = res.json.bind(res);
    res.json = (data) => {
      if (data?.code) res.locals.aiCode = data.code;
      return originalJson(data);
    };
    if (!permitted(req))
      return failure(
        res,
        403,
        'access_denied',
        'AIへの接続が許可されていません。管理者に接続状態を確認してください。',
      );
    res.set({
      'Access-Control-Allow-Origin': req.get('origin'),
      Vary: 'Origin',
      'Access-Control-Expose-Headers': 'X-Request-ID',
    });
    if (req.method === 'OPTIONS')
      return res
        .set({
          'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Folio-AI',
          'Access-Control-Max-Age': '600',
        })
        .sendStatus(204);
    if (req.get('x-folio-ai') !== '1' || !req.is('application/json'))
      return failure(res, 415, 'format', 'リクエストの形式が不正です。');
    next();
  }
  function login(req, res) {
    if (config.password.length < 24 || config.password === config.apiKey)
      return failure(res, 503, 'configuration', 'デモへの接続はまだ準備されていません。');
    failedLogins = failedLogins.filter((time) => time > now() - 15 * 60 * 1000);
    if (failedLogins.length >= 5)
      return failure(
        res,
        429,
        'login_limit',
        'ログイン試行の上限です。15分後に手動で再度お試しください。',
      );
    const input =
      typeof req.body?.password === 'string' ? Buffer.from(req.body.password) : Buffer.alloc(0);
    const expected = Buffer.from(config.password);
    if (input.length !== expected.length || !timingSafeEqual(input, expected)) {
      failedLogins.push(now());
      return failure(res, 401, 'session', 'アクセスコードを確認してください。');
    }
    for (const [key, value] of sessions)
      if (value.expiresAt <= now()) {
        sessions.delete(key);
        requests.delete(key);
      }
    if (sessions.size >= 32) {
      const oldest = sessions.keys().next().value;
      sessions.delete(oldest);
      requests.delete(oldest);
    }
    const token = randomBytes(32).toString('hex');
    const expiresAt = now() + 60 * 60 * 1000;
    sessions.set(token, { expiresAt });
    res.json({ token, expiresAt });
  }
  function authenticate(req, res, next) {
    const token = req.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    const session = sessions.get(token);
    if (!session || session.expiresAt <= now()) {
      if (token) {
        sessions.delete(token);
        requests.delete(token);
      }
      return failure(res, 401, 'session', 'デモにログインしてください。');
    }
    req.aiSessionToken = token;
    const times = (requests.get(token) || []).filter((time) => time > now() - 60000);
    if (times.length >= 10)
      return failure(
        res,
        429,
        'request_limit',
        '短時間の利用上限です。しばらく待って手動で送信してください。',
      );
    times.push(now());
    requests.set(token, times);
    next();
  }
  function logout(req, res) {
    sessions.delete(req.aiSessionToken);
    requests.delete(req.aiSessionToken);
    res.json({ ok: true });
  }
  return { guard, login, authenticate, logout };
}
