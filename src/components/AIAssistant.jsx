import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Compass,
  LoaderCircle,
} from "lucide-react";
import api from "../api.js";
import "./ai-assistant.css";

const prompts = [
  "Что ты умеешь?",
  "Какие пары в понедельник?",
  "Как у меня с оценками?",
  "Как заказать справку?",
  "Какой ближайший дедлайн?",
  "Какие помещения доступны?",
  "Где найти правила оплаты общежития?",
];
const types = {
  enrollment: "Справка об обучении",
  scholarship: "Справка о стипендии",
  transcript: "Выписка об успеваемости",
  leave: "Академический отпуск",
};
const fields = {
  type: "Документ",
  purpose: "Цель",
  comment: "Комментарий",
  date: "Дата",
  start: "Начало, МСК",
  end: "Конец, МСК",
};

function ActionCard({ action, result, busy, error, onConfirm, navigate }) {
  const completed = action.status === "completed" || Boolean(result);
  const expired =
    !completed && new Date(action.expiresAt).getTime() <= Date.now();
  return (
    <section className="ai-action" aria-label="Подтверждение действия">
      <h3>
        {completed
          ? "Действие выполнено"
          : expired
            ? "Предложение истекло"
            : "Проверьте перед подтверждением"}
      </h3>
      <p>{action.summary}</p>
      <dl>
        {Object.entries(action.params || {})
          .filter(([key]) => fields[key])
          .map(([key, value]) => (
            <div key={key}>
              <dt>{fields[key]}</dt>
              <dd>{key === "type" ? types[value] || value : value}</dd>
            </div>
          ))}
      </dl>
      {completed ? (
        <>
          <p className="ai-success">
            <CheckCircle2 size={17} aria-hidden="true" />
            {result?.request
              ? "Демонстрационная заявка создана."
              : result?.booking?.status === "cancelled"
                ? "Бронирование отменено."
                : "Бронирование подтверждено."}
          </p>
          <button
            type="button"
            className="ai-link"
            onClick={() =>
              navigate(
                result?.request ? "requests" : "campus",
                result?.request?.id,
              )
            }
          >
            {result?.request ? "Открыть заявку" : "Мои бронирования"}
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        </>
      ) : (
        <>
          <p className="ai-note">
            {expired
              ? "Отправьте запрос ещё раз, чтобы проверить условия заново."
              : "Нажатие создаст демо-заявку или изменит бронирование. Предложение действует 10 минут. Доступность проверяется повторно."}
          </p>
          <button
            type="button"
            className="button ai-confirm"
            disabled={busy || expired}
            onClick={() => onConfirm(action)}
          >
            {busy && (
              <LoaderCircle size={16} className="ai-spin" aria-hidden="true" />
            )}
            {busy ? "Подтверждаем…" : "Подтвердить действие"}
          </button>
        </>
      )}
      {error && (
        <p className="ai-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function AIAssistant({ data, onNavigate, notify, refresh, session, query, setQuery }) {
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState("");
  const [messages, setMessages] = useState(session.messages || []);
  const [restoredActions, setRestoredActions] = useState([]);
  const [results, setResults] = useState(session.results || {});
  const [actionErrors, setActionErrors] = useState({});
  const [confirming, setConfirming] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const confirmLock = useRef(false);
  const inputRef = useRef(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    let active = true;
    Promise.allSettled([
      api("/assistant/status"),
      api("/assistant/actions"),
    ]).then(([state, actions]) => {
      if (!active) return;
      if (state.status === "fulfilled") setStatus(state.value);
      else setStatusError(state.reason.message);
      if (actions.status === "fulfilled")
        setRestoredActions(actions.value.actions);
      else
        setStatusError(
          (current) =>
            current ||
            "Не удалось загрузить ожидающие подтверждения действия. Обновите раздел.",
        );
    });
    return () => {
      active = false;
      alive.current = false;
    };
  }, []);

  function navigate(route, focusId) {
    if (onNavigate) onNavigate(route, focusId);
    else
      window.location.hash = focusId
        ? `${route}/${encodeURIComponent(focusId)}`
        : route;
  }
  async function ask(text, shareQuestion = false) {
    if (lock.current) return;
    const value = text.trim();
    if (!value) {
      setError("Напишите вопрос или выберите подсказку.");
      inputRef.current?.focus();
      return;
    }
    lock.current = true;
    setLoading(true);
    setError("");
    setQuery(value);
    try {
      const answer = await api("/assistant/chat", {
        method: "POST",
        body: {
          message: value,
          shareQuestion: status?.configured === true && shareQuestion,
          ...(session.conversationId ? { conversationId: session.conversationId } : {}),
        },
      });
      session.messages = [
        ...(session.messages || []),
        { id: crypto.randomUUID(), question: value, answer },
      ];
      session.conversationId = answer.conversationId;
      if (!alive.current) return;
      setMessages(session.messages);
      setQuery("");
      inputRef.current?.focus();
    } catch (cause) {
      if (!alive.current) return;
      setError(cause.message);
      if (cause.status === 404) delete session.conversationId;
    } finally {
      lock.current = false;
      if (alive.current) setLoading(false);
    }
  }
  async function confirm(action) {
    if (confirmLock.current) return;
    confirmLock.current = true;
    setConfirming(action.id);
    setActionErrors((current) => ({ ...current, [action.id]: "" }));
    try {
      const response = await api(
        `/assistant/actions/${encodeURIComponent(action.id)}/confirm`,
        { method: "POST", body: { confirmed: true } },
      );
      if (!alive.current) return;
      session.results = { ...session.results, [action.id]: response.result };
      setResults(session.results);
      notify?.("Действие подтверждено и выполнено.");
      try {
        await refresh?.();
      } catch {
        if (alive.current)
          setActionErrors((current) => ({
            ...current,
            [action.id]:
              "Действие выполнено, но данные кабинета не обновились. Обновите страницу.",
          }));
      }
    } catch (cause) {
      if (alive.current)
        setActionErrors((current) => ({
          ...current,
          [action.id]: `${cause.message}${cause.status ? "" : " Повторное подтверждение этой карточки безопасно: действие не продублируется."}`,
        }));
    } finally {
      confirmLock.current = false;
      if (alive.current) setConfirming("");
    }
  }
  function actionCard(action) {
    return (
      <ActionCard
        key={action.id}
        action={action}
        result={results[action.id]}
        busy={Boolean(confirming)}
        error={actionErrors[action.id]}
        onConfirm={confirm}
        navigate={navigate}
      />
    );
  }
  const visibleIds = new Set(messages.map((item) => item.answer.action?.id));
  return (
    <div className="ai-page">
      <div className="page-heading">
        <div>
          <h1>Навигатор</h1>
        </div>
      </div>
      <section
        className="card ai-panel"
        aria-label="Навигатор по личному кабинету"
      >
        <div className="ai-intro">
          <span className="ai-symbol">
            <Compass size={30} aria-hidden="true" />
          </span>
          <div>
            <h2>
              С чего начнём
              {data?.user?.firstName ? `, ${data.user.firstName}` : ""}?
            </h2>
            <p>
              Найду раздел или документ и отвечу на уточнения.
            </p>
          </div>
        </div>
        {statusError && (
          <p className="ai-error" role="alert">
            {statusError}
          </p>
        )}
        <div className="ai-prompts" role="group" aria-label="Примеры вопросов">
          {prompts.map((prompt) => (
            <button
              type="button"
              key={prompt}
              disabled={loading}
              onClick={() => { if (!status?.configured) return ask(prompt); setQuery(prompt); inputRef.current?.focus(); }}
            >
              {prompt}
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          ))}
        </div>
        {restoredActions.filter((action) => !visibleIds.has(action.id)).length >
          0 && (
          <div className="ai-restored">
            <h2>Ожидают вашего подтверждения</h2>
            {restoredActions
              .filter((action) => !visibleIds.has(action.id))
              .map(actionCard)}
          </div>
        )}
        <div
          className="ai-conversation"
          role="log"
          aria-live="polite"
          aria-label="Ответы навигатора"
          aria-busy={loading}
        >
          {messages.length === 0 && (
            <p className="ai-empty">
              Например: «Закажи справку об обучении для банка» или «Как отменить
              бронь комнаты?»
            </p>
          )}
          {messages.map((message) => (
            <div className="ai-exchange" key={message.id}>
              <p className="ai-question">
                <span className="ai-sr-only">Ваш вопрос: </span>
                {message.question}
              </p>
              <div className="svc-answer ai-answer">
                <Compass size={19} aria-hidden="true" />
                <div className="ai-answer-content">
                  <span className="ai-mode">
                    {message.answer.mode === "gigachat"
                      ? `Ответ ${message.answer.model}`
                      : message.answer.mode === "yandex"
                        ? "С помощью Yandex AI"
                        : "Локальный ответ"}
                  </span>
                  <p className="ai-reply">{message.answer.reply}</p>
                  {message.answer.warning && (
                    <p className="ai-warning">{message.answer.warning}</p>
                  )}
                  {message.answer.sources?.length > 0 && (
                    <div className="ai-sources">
                      <h3>
                        <BookOpen size={16} aria-hidden="true" />
                        Источники
                      </h3>
                      {message.answer.sources.map((source) => (
                        <details
                          key={`${source.documentId}-${source.chunkId}`}
                          open
                        >
                          <summary>
                            {source.title} · {source.section}
                            {source.fictional
                              ? " · демодокумент"
                              : " · ваш документ"}
                          </summary>
                          <blockquote>{source.quote}</blockquote>
                          <p className="ai-note">
                            Версия: {source.version || "не указана"}
                          </p>
                          <button
                            type="button"
                            className="ai-link"
                            onClick={() =>
                              navigate("knowledge", source.documentId)
                            }
                          >
                            Открыть документ
                            <ArrowRight size={14} aria-hidden="true" />
                          </button>
                        </details>
                      ))}
                    </div>
                  )}
                  {message.answer.action && actionCard(message.answer.action)}
                  {message.answer.links?.length > 0 && (
                    <div className="ai-links">
                      {message.answer.links.map((item) => (
                        <button
                          type="button"
                          className="ai-link"
                          key={`${item.route}-${item.focusId || item.label}`}
                          onClick={() => navigate(item.route, item.focusId)}
                        >
                          {item.label}
                          <ArrowRight size={15} aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
        {loading && (
          <p className="ai-loading" role="status">
            <LoaderCircle size={17} className="ai-spin" aria-hidden="true" />
            Проверяю ваши данные…
          </p>
        )}
        <form
          className="ai-form"
          onSubmit={(event) => {
            event.preventDefault();
            ask(query, event.nativeEvent.submitter?.value === "external");
          }}
        >
          <label htmlFor="ai-query">Ваш вопрос навигатору</label>
          <div>
            <textarea
              id="ai-query"
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="Какое у меня завтра расписание?"
              aria-describedby="ai-chat-note"
            />
            <button
              className="button"
              type="submit"
              disabled={loading}
              value={status?.configured ? "external" : "local"}
            >
              <ArrowRight size={20} aria-hidden="true" />
              <span>{status?.configured ? `Спросить ${status.provider}` : "Задать вопрос"}</span>
            </button>
          </div>
          {status?.configured && <button type="submit" value="local" className="ai-link" disabled={loading}>Искать локально</button>}
        </form>
        {error && (
          <p className="ai-error" role="alert">
            {error}
          </p>
        )}
        <p className="ai-note" id="ai-chat-note">
          {status?.configured ? status.disclosure : "Локальный демопомощник"}
          {" · Чат хранится до выхода из аккаунта или обновления страницы."}
        </p>
      </section>
    </div>
  );
}
