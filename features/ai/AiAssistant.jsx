import React, { useEffect, useRef, useState } from 'react';
import { isNativeApp } from '../../mobile-runtime';
import { loadConversation, saveConversation } from '../../storage';
import { getAiClient, backendOrigin } from './client.mjs';
import { buildMessages, MAX_QUESTION_CHARS } from './protocol.mjs';
import { extractDocumentContext } from './pdf-context';
import './ai.css';

export default function AiAssistant({ docs, documentId, onDocumentChange }) {
  const [password, setPassword] = useState(''),
    [authenticated, setAuthenticated] = useState(false),
    [connection, setConnection] = useState('未接続');
  const [notice, setNotice] = useState(''),
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
  let unavailable = false;
  let baseUrl = '';
  try {
    baseUrl = backendOrigin({
      configured: import.meta.env.VITE_FOLIO_BACKEND_URL || '',
      native: isNativeApp(),
      development: import.meta.env.DEV,
      origin: location.origin,
    });
  } catch {
    unavailable = true;
  }
  if (!client.current) client.current = getAiClient(baseUrl);
  const extraction = useRef(null),
    alive = useRef(true);
  const doc = docs.find(
    (d) => d.id === documentId && (d.storedPdf || d.mime === 'application/pdf'),
  );
  const disabled = unavailable;
  useEffect(() => {
    try {
      localStorage.removeItem('folio-ai-settings-v1');
    } catch {}
    setAuthenticated(client.current.isAuthenticated());
    if (client.current.isAuthenticated()) setConnection('ログイン済み');
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
      if (alive.current) {
        setAuthenticated(client.current.isAuthenticated());
        setConnection(e.code === 'session' ? 'ログインが必要です' : '接続を確認してください');
      }
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
  const selectedHistory = historyCount ? turns.slice(-historyCount) : [];
  const history = selectedHistory.flatMap((t) => [
    { role: 'user', content: t.question },
    { role: 'assistant', content: t.answer },
  ]);
  async function submit(e) {
    e.preventDefault();
    if (
      busy ||
      !confirmed ||
      !context ||
      !doc ||
      !historyReady ||
      unsaved ||
      disabled ||
      !authenticated
    )
      return;
    await perform('回答を生成しています…', async () => {
      buildMessages(context.text, question, history);
      const response = await client.current.sendMessage({
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
        <p role="status">{disabled ? 'AIは現在利用できません' : connection}</p>
        {!authenticated && !disabled && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (busy) return;
              perform('ログインしています…', async () => {
                const accessCode = password;
                setPassword('');
                await client.current.login(accessCode);
                if (!alive.current) return;
                setAuthenticated(true);
                const result = await client.current.status();
                if (alive.current)
                  setConnection(result.ready ? '接続済み' : '接続を確認してください');
              });
            }}
          >
            <label>
              デモのアクセスコード
              <input
                aria-label="デモのアクセスコード"
                type="password"
                autoComplete="off"
                value={password}
                disabled={!!busy}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button disabled={!!busy || !password}>ログイン</button>
          </form>
        )}
        {authenticated && (
          <button
            disabled={!!busy}
            onClick={() =>
              perform('ログアウトしています…', async () => {
                try {
                  await client.current.logout();
                } finally {
                  setAuthenticated(false);
                  setConnection('未接続');
                }
              })
            }
          >
            ログアウト
          </button>
        )}
        <p className="ai-policy">
          自動再送信や追加課金への切り替えは行いません。利用枠残量は表示しません。
        </p>
      </aside>
      <div className="chat">
        <h2>PDFについて質問する</h2>
        {disabled && (
          <p role="alert">AIは現在利用できません。管理者に接続状態を確認してください。</p>
        )}
        {!doc && <p>PDFを開いて「このPDFに質問」から開始するか、対象資料を選んでください。</p>}
        <fieldset disabled={!!busy || !doc || disabled || !authenticated}>
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
                AI／{t.from}〜{t.to}ページ／{new Date(t.createdAt).toLocaleString()}
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
              disabled={!!busy || disabled || !authenticated}
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
              disabled={!context || !!busy || disabled || !authenticated}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            対象資料・本文・質問・送信履歴を確認し、AIへ送信します
          </label>
          <button
            className="primary"
            aria-label="送信"
            disabled={
              !!busy ||
              !confirmed ||
              !question.trim() ||
              !historyReady ||
              !!unsaved ||
              disabled ||
              !authenticated
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
