import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { AiError } from '../features/ai/protocol.mjs';
// Private server configuration is outside Vite's env files and never bundled.
export function loadPrivateAiEnvironment() {
  try {
    loadEnvFile(fileURLToPath(new URL('../.private/ai.env', import.meta.url)));
  } catch (error) {
    if (error.code !== 'ENOENT') throw Error('Private AI configuration could not be loaded');
  }
}
export function readAiConfig(env = process.env) {
  return {
    baseUrl: env.FOLIO_AI_GATEWAY_URL || 'http://127.0.0.1:8317/v1',
    apiKey: env.FOLIO_AI_GATEWAY_KEY || '',
    model: env.FOLIO_AI_MODEL || 'gpt-6-luna',
    password: env.FOLIO_AI_DEMO_PASSWORD || '',
    publicOrigin: env.FOLIO_AI_PUBLIC_ORIGIN || '',
    remoteEnabled: env.FOLIO_AI_REMOTE_ENABLED === 'true',
    keyRotated: env.FOLIO_AI_KEY_ROTATED === 'true',
    trustLocalProxy: env.FOLIO_AI_TRUST_LOCAL_PROXY === 'true',
    allowLocalHttp: env.NODE_ENV !== 'production' && env.FOLIO_AI_ALLOW_LOCAL_HTTP === 'true',
  };
}
export function gatewaySettings(config) {
  let url;
  try {
    url = new URL(config.baseUrl);
  } catch {
    throw new AiError('configuration', 'AI接続はまだ準備されていません。', 503);
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !config.apiKey ||
    /[\r\n]/.test(config.apiKey) ||
    !config.model?.trim()
  )
    throw new AiError('configuration', 'AI接続はまだ準備されていません。', 503);
  return {
    baseUrl: url.href.replace(/\/+$/, ''),
    apiKey: config.apiKey,
    model: config.model.trim(),
  };
}
