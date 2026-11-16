import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Compass,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import api from "../api.js";
import "./ai-assistant.css";

const prompts = [
  "Какие пары в понедельник?",
  "Как у меня с оценками?",
  "Как заказать справку?",
  "Какой ближайший дедлайн?",
  "Какие помещения доступны?",
  "Когда оплачивать общежитие?",
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

function ActionCard({
  action,
  result,
  busy,
  error,
  onConfirm,
  onCancel,
  navigate,
}) {
  const cardRef = useRef(null);
  const completed = action.status === "completed" || Boolean(result);
  const cancelled = action.status === "cancelled";
  const expired =
    !completed &&
    !cancelled &&
    new Date(action.expiresAt).getTime() <= Date.now();
  useEffect(() => {
    if (cancelled) cardRef.current?.focus({ preventScroll: true });
  }, [cancelled]);
  return (
    <section
      className="ai-action"
      aria-label="Подтверждение действия"
      ref={cardRef}
      tabIndex={-1}
    >
      <h3>
        {completed
          ? "Действие выполнено"
          : cancelled
            ? "Подготовка отменена"
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
      ) : cancelled ? (
        <p className="ai-note" role="status">
          Эта карточка больше не может создать заявку или изменить бронь. Другие
          подготовленные действия сохранены.
        </p>
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
            {busy ? "Подождите…" : "Подтвердить действие"}
          </button>
          {!expired && (
            <div className="ai-action-controls">
              <button
                type="button"
                className="button secondary"
                disabled={busy || action.status !== "pending"}
                onClick={() => onCancel(action)}
              >
                Отменить подготовку
              </button>
              {action.type === "request.create" && (
                <>
                  <p className="ai-note">
                    Назначение неточное? В форме можно заново выбрать документ и
                    указать назначение. Другие карточки останутся без изменений.
                  </p>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy || action.status !== "pending"}
                    onClick={() => onCancel(action, true)}
                  >
                    Отменить и заполнить вручную
                  </button>
                </>
              )}
            </div>
          )}
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

export function AIAssistant({ data, onNavigate, notify, refresh }) {
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState("");
  const [messages, setMessages] = useState([]);
  const [restoredActions, setRestoredActions] = useState([]);
  const [results, setResults] = useState({});
  const [actionErrors, setActionErrors] = useState({});
  const [actionStates, setActionStates] = useState({});
  const [confirming, setConfirming] = useState("");
  const [conversationId, setConversationId] = useState(undefined);
  const [query, setQuery] = useState("");
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
  async function ask(text) {
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
      const history = messages.slice(-6).flatMap((item) => [
        { role: "user", content: item.question.slice(0, 2000) },
        { role: "assistant", content: item.answer.reply.slice(0, 2000) },
      ]);
      const answer = await api("/assistant/chat", {
        method: "POST",
        body: {
          message: value,
          history,
          ...(conversationId ? { conversationId } : {}),
        },
      });
      if (!alive.current) return;
      setMessages((current) => [
        ...current.slice(-11),
        { id: crypto.randomUUID(), question: value, answer },
      ]);
      setConversationId(answer.conversationId);
      setQuery("");
      inputRef.current?.focus();
    } catch (cause) {
      if (!alive.current) return;
      setError(cause.message);
      if (cause.status === 404) setConversationId(undefined);
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
      setResults((current) => ({ ...current, [action.id]: response.result }));
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
  async function cancel(action, openForm = false) {
    if (confirmLock.current) return;
    confirmLock.current = true;
    setConfirming(action.id);
    setActionErrors((current) => ({ ...current, [action.id]: "" }));
    try {
      const response = await api(
        `/assistant/actions/${encodeURIComponent(action.id)}/cancel`,
        { method: "POST", body: {} },
      );
      if (response.action?.status !== "cancelled")
        throw new Error(
          "Не удалось подтвердить отмену подготовки. Повторите попытку.",
        );
      if (!alive.current) return;
      setActionStates((current) => ({
        ...current,
        [action.id]: response.action,
      }));
      notify?.("Выбранная подготовка отменена.");
      if (openForm) navigate("requests");
    } catch (cause) {
      if (alive.current)
        setActionErrors((current) => ({
          ...current,
          [action.id]: cause.message,
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
        action={actionStates[action.id] || action}
        result={results[action.id]}
        busy={Boolean(confirming)}
        error={actionErrors[action.id]}
        onConfirm={confirm}
        onCancel={cancel}
        navigate={navigate}
      />
    );
  }
  const visibleIds = new Set(messages.map((item) => item.answer.action?.id));
  return (
    <div className="ai-page">
      <div className="page-heading">
        <div>
          <span className="ai-eyebrow">Ответы и действия в одном месте</span>
          <h1>Навигатор</h1>
          <p className="muted">
            Ваш помощник по расписанию, документам и кампусу.
          </p>
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
              Найду нужный раздел или правило, помогу подготовить справку и
              бронь. Каждое действие вы подтверждаете сами.
            </p>
          </div>
        </div>
        <div className="ai-disclosure">
          <ShieldCheck size={18} aria-hidden="true" />
          <div>
            <strong>
              {status
                ? status.configured
                  ? `Yandex AI${status.model ? ` · ${status.model}` : ""}`
                  : "Локальный демопомощник"
                : "Проверяем режим помощника…"}
            </strong>
            <p>
              {status?.disclosure ||
                "Подключение к внешней модели проверяется сервером."}
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
              onClick={() => ask(prompt)}
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
                    {message.answer.mode === "yandex"
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
            ask(query);
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
              aria-label="Задать вопрос"
            >
              <ArrowRight size={20} aria-hidden="true" />
              <span>Задать вопрос</span>
            </button>
          </div>
        </form>
        {error && (
          <p className="ai-error" role="alert">
            {error}
          </p>
        )}
        <p className="ai-note" id="ai-chat-note">
          В демо «сегодня» — 16 ноября 2026, время московское. Используйте
          вымышленные сведения. История чата исчезнет при выходе из раздела;
          подготовленные действия доступны 10 минут.
        </p>
      </section>
    </div>
  );
}
