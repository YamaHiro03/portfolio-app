import React, { useEffect, useRef, useState } from 'react';
import { isNativeApp } from '../../mobile-runtime';
import { loadConversation, saveConversation } from '../../storage';
import { createAiClient, loadSettings, saveSettings } from './client.mjs';
import { buildMessages, MAX_QUESTION_CHARS } from './protocol.mjs';
import { extractDocumentContext } from './pdf-context';
import './ai.css';

export default function AiAssistant({ docs, documentId, onDocumentChange }) {
  const [settings, setSettings] = useState(loadSettings);
  const [models, setModels] = useState([]),
    [notice, setNotice] = useState(''),
    [error, setError] = useState('');
  const [turns, setTurns] = useState([]),
    [historyReady, setHistoryReady] = useState(false);
  const [question, setQuestion] = useState(''),
    [from, setFrom] = useState(1),
    [to, setTo] = useState(1);
  const [context, setContext] = useState(null),
    [confirmed, setConfirmed] = useState(false),
    [historyCount, setHistoryCount] = useState(0);
  const [busy, setBusy] = useState(''),
    [unsaved, setUnsaved] = useState(null);
  const client = useRef(null);
  if (!client.current) client.current = createAiClient();
  const extraction = useRef(null),
    alive = useRef(true);
  const doc = docs.find(
    (d) => d.id === documentId && (d.storedPdf || d.mime === 'application/pdf'),
  );
  const disabled =
    isNativeApp() || !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      client.current.cancelRequest();
      extraction.current?.abort();
    };
  }, []);
  useEffect(() => {
    let current = true;
    setHistoryReady(false);
    setTurns([]);
    setContext(null);
    setConfirmed(false);
    setQuestion('');
    setFrom(1);
    setTo(1);
    setError('');
    setUnsaved(null);
    if (!doc) {
      setHistoryReady(true);
      return;
    }
    loadConversation(doc.id)
      .then((value) => {
        if (current) {
          setTurns(value);
          setHistoryReady(true);
        }
      })
      .catch(() => {
        if (current) setError('会話履歴を読み込めませんでした。再度この画面を開いてください。');
      });
    return () => {
      current = false;
    };
  }, [doc?.id]);
  useEffect(() => {
    setContext(null);
    setConfirmed(false);
  }, [doc?.revision]);
  async function perform(label, action) {
    setError('');
    setNotice('');
    setBusy(label);
    try {
      await action();
    } catch (e) {
      if (alive.current)
        setError(
          e.name === 'AbortError'
            ? 'PDF本文の抽出をキャンセルしました。'
            : e.message || 'AI処理に失敗しました。',
        );
    } finally {
      if (alive.current) setBusy('');
    }
  }
  function changeSettings(key, value) {
    setSettings((s) => ({ ...s, [key]: value }));
    setConfirmed(false);
  }
  function persistSettings() {
    const saved = saveSettings(settings);
    setSettings(saved);
    return saved;
  }
  const selectedHistory = historyCount ? turns.slice(-historyCount) : [];
  const history = selectedHistory.flatMap((t) => [
    { role: 'user', content: t.question },
    { role: 'assistant', content: t.answer },
  ]);
  async function submit(e) {
    e.preventDefault();
    if (busy || !confirmed || !context || !doc || !historyReady || unsaved || disabled) return;
    await perform('回答を生成しています…', async () => {
      const currentSettings = persistSettings();
      buildMessages(context.text, question, history);
      const response = await client.current.sendMessage(currentSettings, {
        context: context.text,
        question,
        history,
      });
      if (!alive.current) return;
      const turn = {
        id: crypto.randomUUID(),
        documentId: doc.id,
        revision: doc.revision ?? null,
        model: response.model,
        returnedModel: response.returnedModel,
        createdAt: new Date().toISOString(),
        question: question.trim(),
        answer: response.text,
        context: context.text,
        from,
        to,
      };
      const next = [...turns, turn];
      setTurns(next);
      setQuestion('');
      setConfirmed(false);
      try {
        await saveConversation(doc.id, next);
      } catch (e) {
        setUnsaved(next);
        throw e;
      }
    });
  }
  return (
    <section className="ai-work folio-ai" aria-label="PDF AIアシスタント">
      <aside className="ai-source">
        <h3>質問するPDF</h3>
        <label>
          対象資料
          <select
            aria-label="AIの対象資料"
            value={doc?.id ?? ''}
            disabled={!!busy || !!unsaved}
            onChange={(e) =>
              onDocumentChange(docs.find((d) => String(d.id) === e.target.value)?.id ?? null)
            }
          >
            <option value="">PDFを選択してください</option>
            {docs
              .filter((d) => d.storedPdf || d.mime === 'application/pdf')
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
          </select>
        </label>
        {doc && <p>対象：{doc.title}</p>}
        <details open>
          <summary>CLIProxyAPI接続設定</summary>
          <label>
            Gateway URL
            <input
              aria-label="Gateway URL"
              value={settings.baseUrl}
              disabled={!!busy || disabled}
              onChange={(e) => changeSettings('baseUrl', e.target.value)}
            />
          </label>
          <label>
            ローカルAPIキー
            <input
              aria-label="ローカルAPIキー"
              type="password"
              autoComplete="off"
              value={settings.apiKey}
              disabled={!!busy || disabled}
              onChange={(e) => changeSettings('apiKey', e.target.value)}
            />
          </label>
          <small>キーはメモリ内のみ保持します。再読み込み後は再入力してください。</small>
          <label>
            使用モデル
            <input
              aria-label="使用モデル"
              list="folio-ai-models"
              value={settings.model}
              disabled={!!busy || disabled}
              onChange={(e) => changeSettings('model', e.target.value)}
            />
          </label>
          <datalist id="folio-ai-models">
            {[...new Set(['gpt-6-luna', 'gpt-6-astra', ...models])].map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
          <button
            type="button"
            disabled={!!busy || disabled}
            onClick={() =>
              perform('設定を保存しています…', async () => {
                persistSettings();
                setNotice('URLとモデルを保存しました。キーはメモリ内のみです。');
              })
            }
          >
            接続設定を保存
          </button>
          <button
            type="button"
            disabled={!!busy || disabled}
            onClick={() =>
              perform('接続を確認しています…', async () => {
                await client.current.testConnection(persistSettings());
                if (alive.current)
                  setNotice(
                    '接続と指定モデルの一覧掲載を確認しました。推論の実行可否・残量は未確認です。',
                  );
              })
            }
          >
            接続テスト
          </button>
          <button
            type="button"
            disabled={!!busy || disabled}
            onClick={() =>
              perform('モデル一覧を取得しています…', async () => {
                const result = await client.current.getModels(persistSettings());
                if (alive.current) {
                  setModels(result.models);
                  setNotice('モデル一覧を取得しました。使用モデルは自動変更しません。');
                }
              })
            }
          >
            モデル一覧を取得
          </button>
          {!!models.length && (
            <ul aria-label="利用可能モデル一覧">
              {models.map((id) => (
                <li key={id}>{id}</li>
              ))}
            </ul>
          )}
        </details>
        <p className="ai-policy">
          有料APIへのフォールバック・自動モデル変更・自動再試行は行いません。利用枠残量は取得できないため表示しません。Gateway側の課金設定や請求額は保証できません。
        </p>
      </aside>
      <div className="chat">
        <h2>PDFについて質問する</h2>
        <p>
          使用モデル：<strong>{settings.model}</strong>
        </p>
        {disabled && (
          <p role="alert">
            AI機能はWindows＋WSL2などのPC上のlocalhost版専用です。Android /
            iOS・LAN・公開版では接続できません。
          </p>
        )}
        {!doc && <p>PDFを開いて「このPDFに質問」から開始するか、対象資料を選んでください。</p>}
        <fieldset disabled={!!busy || !doc || disabled}>
          <legend>送信する本文を準備（最大5ページ・12,000文字）</legend>
          <label>
            開始ページ
            <input
              aria-label="開始ページ"
              type="number"
              min="1"
              value={from}
              onChange={(e) => {
                setFrom(Number(e.target.value));
                setContext(null);
                setConfirmed(false);
              }}
            />
          </label>
          <label>
            終了ページ
            <input
              aria-label="終了ページ"
              type="number"
              min="1"
              value={to}
              onChange={(e) => {
                setTo(Number(e.target.value));
                setContext(null);
                setConfirmed(false);
              }}
            />
          </label>
          <button
            type="button"
            onClick={() =>
              perform('PDF本文を抽出しています…', async () => {
                setContext(null);
                setConfirmed(false);
                const controller = new AbortController();
                extraction.current = controller;
                const result = await extractDocumentContext(doc, from, to, {
                  signal: controller.signal,
                });
                if (alive.current) setContext(result);
              })
            }
          >
            本文を抽出
          </button>
        </fieldset>
        {context && (
          <div className="ai-preview">
            <p>
              {doc.title}：{from}〜{to}ページ（全{context.numPages}ページ）／{context.text.length}
              文字。元PDFの文字のみを送り、手書き・画像・テキストメモは含めません。
            </p>
            <label>
              送信するPDF本文
              <textarea aria-label="送信するPDF本文" readOnly value={context.text} />
            </label>
          </div>
        )}
        <label>
          送信する過去の会話
          <select
            aria-label="送信する過去の会話"
            value={historyCount}
            disabled={!!busy}
            onChange={(e) => {
              setHistoryCount(Number(e.target.value));
              setConfirmed(false);
            }}
          >
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? '送信しない' : `直近${n}往復（実際は${Math.min(n, turns.length)}往復）`}
              </option>
            ))}
          </select>
        </label>
        {!!selectedHistory.length && (
          <details>
            <summary>送信履歴を確認</summary>
            {selectedHistory.map((t) => (
              <div key={t.id}>
                <p>質問：{t.question}</p>
                <p>回答：{t.answer}</p>
              </div>
            ))}
          </details>
        )}
        <div className="ai-transcript" aria-label="会話履歴">
          {turns.map((t) => (
            <article key={t.id}>
              <small>
                {t.model}／{t.from}〜{t.to}ページ／{new Date(t.createdAt).toLocaleString()}
                {t.returnedModel && t.returnedModel !== t.model
                  ? `（Gateway応答モデル：${t.returnedModel}）`
                  : ''}
              </small>
              <div className="message user">{t.question}</div>
              <div className="message ai">{t.answer}</div>
              <details>
                <summary>この回答に送った本文</summary>
                <pre>{t.context}</pre>
              </details>
            </article>
          ))}
        </div>
        <form onSubmit={submit}>
          <label>
            質問
            <textarea
              aria-label="AIへの指示"
              maxLength={MAX_QUESTION_CHARS}
              value={question}
              disabled={!!busy || disabled}
              onChange={(e) => {
                setQuestion(e.target.value);
                setConfirmed(false);
              }}
              placeholder="このページで説明されている内容を教えて"
            />
          </label>
          <label className="ai-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={!context || !!busy || disabled}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            対象資料・本文・質問・送信履歴・モデルを確認し、Gatewayへ送信します
          </label>
          <button
            className="primary"
            aria-label="送信"
            disabled={
              !!busy || !confirmed || !question.trim() || !historyReady || !!unsaved || disabled
            }
          >
            送信
          </button>
        </form>
        {busy && (
          <div role="status">
            {busy}
            <button
              onClick={() => {
                client.current.cancelRequest();
                extraction.current?.abort();
              }}
            >
              送信キャンセル
            </button>
          </div>
        )}
        {notice && <p role="status">{notice}</p>}
        {error && (
          <p className="upload-error" role="alert">
            {error}
          </p>
        )}
        {unsaved && (
          <button
            disabled={!!busy}
            onClick={() =>
              perform('履歴を保存しています…', async () => {
                await saveConversation(doc.id, unsaved);
                setUnsaved(null);
                setNotice('会話履歴を保存しました。再送信はしていません。');
              })
            }
          >
            履歴保存のみ再試行
          </button>
        )}
      </div>
    </section>
  );
}
