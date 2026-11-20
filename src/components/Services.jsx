import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Compass,
  FileCheck2,
  FileText,
  GraduationCap,
  Info,
  LoaderCircle,
  LockKeyhole,
  MessageCircle,
  Plus,
  Send,
  ShieldCheck,
  UserRound,
  Wallet,
} from "lucide-react";
import api from "../api";
import { navigatorAnswer } from "../navigator.js";
import "./services.css";

const TYPES = {
  enrollment: {
    title: "Справка об обучении",
    description: "Для работы, банка или по месту требования",
    Icon: GraduationCap,
    estimate: "Демо-срок: 3 рабочих дня",
  },
  scholarship: {
    title: "Справка о стипендии",
    description: "Подтверждение стипендиальных выплат",
    Icon: Wallet,
    estimate: "Демо-срок: 3 рабочих дня",
  },
  transcript: {
    title: "Выписка об успеваемости",
    description: "Дисциплины, оценки и зачётные единицы",
    Icon: BookOpen,
    estimate: "Демо-срок: 3 рабочих дня",
  },
  leave: {
    title: "Заявление на академический отпуск",
    description: "Учебный пример заявления с вымышленной причиной",
    Icon: MessageCircle,
    estimate: "Демо-срок: 3 рабочих дня",
  },
};
const STATUSES = {
  submitted: {
    title: "Заявка принята",
    short: "Принята",
    description: "Всё на месте. Заявка ожидает обработки.",
    Icon: FileText,
  },
  processing: {
    title: "Готовим документ",
    short: "В работе",
    description: "Сотрудник проверяет данные и готовит ответ.",
    Icon: Clock3,
  },
  ready: {
    title: "Документ готов",
    short: "Готово",
    description: "Можно скачать демонстрационный документ.",
    Icon: CheckCircle2,
  },
};
const STATUS_ORDER = ["submitted", "processing", "ready"];
const CATEGORY = {
  schedule: { title: "Расписание", Icon: CalendarDays },
  request: { title: "Документы", Icon: FileText },
  deadline: { title: "Дедлайн", Icon: Clock3 },
  news: { title: "Новости", Icon: Bell },
};
const dateLabel = (value, options = {}) => {
  if (!value) return "Уточняется";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Уточняется"
    : new Intl.DateTimeFormat("ru-RU", {
        day: "numeric",
        month: "long",
        timeZone: "Europe/Moscow",
        ...options,
      }).format(date);
};
const errorText = (error) =>
  error?.message || "Не удалось выполнить действие. Попробуйте ещё раз.";

function StatusBadge({ status }) {
  const { short, Icon } = STATUSES[status] || STATUSES.submitted;
  return (
    <span className={`svc-status svc-status-${status}`}>
      <Icon size={13} aria-hidden="true" />
      {short}
    </span>
  );
}

function RequestDetails({ request, busy, onAdvance, onArchive }) {
  const [confirmArchive, setConfirmArchive] = useState(false);
  const status = STATUSES[request.status] || STATUSES.submitted;
  const current = STATUS_ORDER.indexOf(request.status);
  return (
    <div className="svc-request-details">
      <div className="svc-request-summary">
        <div>
          <span className="svc-eyebrow">Следующий шаг</span>
          <h4>{status.title}</h4>
          <p>{status.description}</p>
        </div>
        {request.status !== "ready" && (
          <div className="svc-estimate">
            <Clock3 size={16} aria-hidden="true" />
            <span>
              Ориентир
              <br />
              <strong>{dateLabel(request.estimatedDate)}</strong>
            </span>
          </div>
        )}
      </div>
      <ol className="svc-status-track" aria-label="Этапы заявки">
        {STATUS_ORDER.map((step, index) => (
          <li
            key={step}
            className={index <= current ? "svc-step-done" : ""}
            aria-current={index === current ? "step" : undefined}
          >
            <span className="svc-step-dot">
              {index < current ? (
                <Check size={12} aria-hidden="true" />
              ) : (
                index + 1
              )}
            </span>
            <span>{STATUSES[step].short}</span>
          </li>
        ))}
      </ol>
      <dl className="svc-request-fields">
        <div>
          <dt>Куда предоставить</dt>
          <dd>{request.purpose}</dd>
        </div>
        {request.comment && (
          <div>
            <dt>Комментарий</dt>
            <dd>{request.comment}</dd>
          </div>
        )}
      </dl>
      {request.history?.length > 0 && (
        <div className="svc-history">
          <h5>История без звонков в деканат</h5>
          <ul>
            {request.history.map((entry, index) => (
              <li key={`${entry.at}-${index}`}>
                <span className="svc-history-dot" />
                <div>
                  <p>{entry.text || STATUSES[entry.status]?.title}</p>
                  <time dateTime={entry.at}>
                    {dateLabel(entry.at, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {request.status === "ready" ? (
        <a
          className="button svc-download"
          href={`/api/requests/${encodeURIComponent(request.id)}/document`}
          download
        >
          <ArrowDownToLine size={17} aria-hidden="true" />
          Скачать демодокумент
        </a>
      ) : (
        <button
          className="button secondary svc-demo-advance"
          disabled={busy}
          onClick={() => onAdvance(request.id)}
        >
          {busy ? (
            <LoaderCircle className="svc-spin" size={16} aria-hidden="true" />
          ) : (
            <ArrowRight size={16} aria-hidden="true" />
          )}
          Демо: следующий этап
        </button>
      )}
      <p className="svc-small-note">
        {request.status === "ready"
          ? "Учебный документ с отметкой «ОБРАЗЕЦ». Не имеет юридической силы."
          : "Кнопка имитирует работу сотрудника только в этом прототипе."}
      </p>
      {request.archived ? (
        <p className="svc-small-note">
          В архиве. История и документ сохранены; заявка не занимает место в
          лимите.
        </p>
      ) : (
        request.status === "ready" && (
          <div className="svc-archive">
            {confirmArchive ? (
              <>
                <p>
                  Перенести заявку в архив общего демоаккаунта? История и
                  документ останутся во вкладке «Архив», освободится место для
                  новой заявки.
                </p>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => onArchive(request.id)}
                >
                  Подтвердить перенос
                </button>{" "}
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => setConfirmArchive(false)}
                >
                  Отмена
                </button>
              </>
            ) : (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setConfirmArchive(true)}
              >
                В архив
              </button>
            )}
          </div>
        )
      )}
    </div>
  );
}

export function Requests({ data, refresh, notify, focusId }) {
  const [type, setType] = useState("enrollment");
  const [purpose, setPurpose] = useState("");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [advancing, setAdvancing] = useState(null);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [requestUpdates, setRequestUpdates] = useState({});
  const [selected, setSelected] = useState(
    focusId || data.requests?.find((item) => !item.archived)?.id || null,
  );
  const [filter, setFilter] = useState("all");
  const submittingRef = useRef(false);
  const formRef = useRef(null);
  const idempotency = useRef(null);
  const requests = [
    ...(data.requests || []).map((item) => requestUpdates[item.id] || item),
    ...Object.values(requestUpdates).filter(
      (item) => !data.requests?.some((value) => value.id === item.id),
    ),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  useEffect(() => {
    setRequestUpdates({});
  }, [data.requests]);
  useEffect(() => {
    if (!focusId) return;
    setSelected(focusId);
    setFilter(
      data.requests?.find((item) => item.id === focusId)?.archived
        ? "archived"
        : "all",
    );
    const frame = requestAnimationFrame(() => {
      const button = document.getElementById(`request-toggle-${focusId}`);
      button?.focus({ preventScroll: true });
      button?.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusId]);
  const filtered = requests.filter((request) =>
    filter === "archived"
      ? request.archived
      : !request.archived &&
        (filter === "all" ||
          (filter === "active"
            ? request.status !== "ready"
            : request.status === "ready")),
  );

  function resetIdempotency() {
    idempotency.current = null;
  }

  async function submit(event) {
    event.preventDefault();
    if (submittingRef.current) return;
    setError("");
    if (purpose.trim().length < 3) {
      setError("Укажите, куда нужна справка: не менее 3 символов.");
      return;
    }
    if (type === "leave" && comment.trim().length < 10) {
      setError("Укажите вымышленную причину отпуска: не менее 10 символов.");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    idempotency.current ||= crypto.randomUUID();
    try {
      const result = await api("/requests", {
        method: "POST",
        headers: { "Idempotency-Key": idempotency.current },
        body: { type, purpose: purpose.trim(), comment: comment.trim() },
      });
      setRequestUpdates((current) => ({
        ...current,
        [result.request.id]: result.request,
      }));
      setSelected(result.request.id);
      setFilter("all");
      setPurpose("");
      setComment("");
      resetIdempotency();
      notify?.(
        `Заявка ${result.request.number} принята. Следите за статусом здесь.`,
      );
      try {
        await refresh();
      } catch {
        setActionError(
          `Заявка ${result.request.number} сохранена. Не удалось обновить остальные данные — обновите страницу, когда соединение восстановится. Повторно подавать заявку не нужно.`,
        );
      }
      requestAnimationFrame(() => {
        const button = document.getElementById(
          `request-toggle-${result.request.id}`,
        );
        button?.focus({ preventScroll: true });
        button?.scrollIntoView({
          block: "start",
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "auto"
            : "smooth",
        });
      });
    } catch (err) {
      setError(errorText(err));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function advance(id) {
    if (advancing) return;
    setAdvancing(id);
    setActionError("");
    try {
      const result = await api(
        `/requests/${encodeURIComponent(id)}/demo-advance`,
        {
          method: "POST",
          body: {},
        },
      );
      setRequestUpdates((current) => ({ ...current, [id]: result.request }));
      try {
        await refresh();
      } catch {
        setActionError(
          "Статус сохранён, но остальные данные не обновились. Обновите страницу, когда соединение восстановится.",
        );
      }
      notify?.("Демонстрационный статус обновлён");
    } catch (err) {
      setActionError(errorText(err));
    } finally {
      setAdvancing(null);
    }
  }

  async function archive(id) {
    if (advancing) return;
    setAdvancing(id);
    setActionError("");
    try {
      const result = await api(`/requests/${encodeURIComponent(id)}/archive`, {
        method: "POST",
      });
      setRequestUpdates((current) => ({ ...current, [id]: result.request }));
      setFilter("archived");
      notify?.("Заявка в архиве. История и документ сохранены.");
      try {
        await refresh();
      } catch {
        setActionError(
          "Заявка перенесена в архив. Обновите страницу, когда соединение восстановится.",
        );
      }
    } catch (err) {
      setActionError(errorText(err));
    } finally {
      setAdvancing(null);
    }
  }

  return (
    <div className="svc-page svc-requests-page">
      <div className="page-heading">
        <div>
          <span className="svc-eyebrow">Без очередей и бумажек</span>
          <h1>Документы и заявки</h1>
          <p className="muted">
            Закажите нужное здесь. Мы покажем каждый этап.
          </p>
        </div>
        <span className="svc-private-label">
          <LockKeyhole size={14} aria-hidden="true" />
          Только ваши заявки
        </span>
      </div>
      <div className="svc-request-layout">
        <section
          className="card svc-request-form"
          aria-labelledby="new-request-title"
          ref={formRef}
        >
          <div className="svc-card-heading">
            <span className="svc-icon-tile">
              <Plus size={20} aria-hidden="true" />
            </span>
            <div>
              <h2 id="new-request-title">Что вам нужно?</h2>
              <p>Выберите документ и оставьте детали</p>
            </div>
          </div>
          <form onSubmit={submit}>
            <fieldset className="svc-type-options">
              <legend className="svc-sr-only">Тип документа</legend>
              {Object.entries(TYPES).map(([key, item]) => (
                <label
                  className={`svc-type-option ${type === key ? "svc-type-selected" : ""}`}
                  key={key}
                >
                  <input
                    type="radio"
                    name="request-type"
                    value={key}
                    checked={type === key}
                    onChange={() => {
                      setType(key);
                      resetIdempotency();
                      setError("");
                    }}
                    disabled={submitting}
                  />
                  <span className="svc-type-icon">
                    <item.Icon size={20} aria-hidden="true" />
                  </span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.description}</small>
                  </span>
                  <span className="svc-radio-dot" aria-hidden="true">
                    {type === key && <Check size={12} />}
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="svc-form-field">
              <label htmlFor="request-purpose">
                Куда предоставить <span aria-hidden="true">*</span>
              </label>
              <input
                id="request-purpose"
                placeholder="Например, по месту работы"
                value={purpose}
                onChange={(event) => {
                  setPurpose(event.target.value);
                  resetIdempotency();
                }}
                required
                minLength={3}
                maxLength={160}
                disabled={submitting}
                autoComplete="off"
                aria-describedby="request-purpose-hint"
              />
              <small id="request-purpose-hint">
                Укажите организацию или «по месту требования»
              </small>
            </div>
            <div className="svc-form-field">
              <label htmlFor="request-comment">
                {type === "leave"
                  ? "Вымышленная причина отпуска *"
                  : "Комментарий"}
                <span className="svc-optional">
                  {type === "leave" ? "от 10 символов" : "необязательно"}
                </span>
              </label>
              <textarea
                id="request-comment"
                rows={3}
                placeholder={
                  type === "leave"
                    ? "Например: участие в вымышленной исследовательской экспедиции. Не вводите медицинские или другие личные сведения."
                    : "Пожелания или детали, которые важно учесть…"
                }
                value={comment}
                onChange={(event) => {
                  setComment(event.target.value);
                  resetIdempotency();
                }}
                maxLength={1000}
                minLength={type === "leave" ? 10 : undefined}
                required={type === "leave"}
                disabled={submitting}
              />
              <small className="svc-counter">{comment.length}/1000</small>
            </div>
            <div className="svc-form-estimate">
              <Clock3 size={16} aria-hidden="true" />
              <span>{TYPES[type].estimate}</span>
            </div>
            {error && (
              <p className="svc-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="button svc-submit"
              type="submit"
              disabled={submitting}
            >
              {submitting ? (
                <LoaderCircle
                  className="svc-spin"
                  size={17}
                  aria-hidden="true"
                />
              ) : (
                <Send size={17} aria-hidden="true" />
              )}
              {submitting ? "Отправляем…" : "Подать заявку"}
            </button>
            <p className="svc-small-note">
              <Info size={13} aria-hidden="true" />
              Это демонстрация. Заявка сохранится в вашем учебном аккаунте и не
              уйдёт в настоящий деканат. Не вводите реальные персональные
              данные.
            </p>
          </form>
        </section>
        <section
          className="svc-request-list-section"
          aria-labelledby="my-requests-title"
        >
          <div className="svc-list-heading">
            <h2 id="my-requests-title">
              Мои заявки <span>{requests.length}</span>
            </h2>
            <span className="svc-eyebrow">Всё под контролем</span>
          </div>
          <p className="svc-small-note">
            Вне архива: {requests.filter((item) => !item.archived).length} из
            200. Готовые заявки можно перенести в архив, сохранив документы.
          </p>
          {focusId && !requests.some((item) => item.id === focusId) && (
            <p className="svc-error" role="status">
              Заявка недоступна. Ссылка могла устареть. Ниже — только заявки
              вашего аккаунта.
            </p>
          )}
          <div
            className="svc-filter-row"
            role="group"
            aria-label="Фильтр заявок"
          >
            {[
              ["all", "Все"],
              ["active", "В работе"],
              ["ready", "Готовые"],
              ["archived", "Архив"],
            ].map(([value, label]) => (
              <button
                key={value}
                className={filter === value ? "svc-filter-active" : ""}
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
              >
                {label}
                {value === "ready" && (
                  <span>
                    {
                      requests.filter(
                        (r) => !r.archived && r.status === "ready",
                      ).length
                    }
                  </span>
                )}
              </button>
            ))}
          </div>
          {actionError && (
            <p className="svc-error" role="alert">
              {actionError}
            </p>
          )}
          <div className="svc-requests-stack">
            {filtered.map((request) => (
              <article
                className={`card svc-request ${selected === request.id ? "svc-request-open" : ""}`}
                key={request.id}
              >
                <button
                  id={`request-toggle-${request.id}`}
                  className="svc-request-toggle"
                  onClick={() =>
                    setSelected(selected === request.id ? null : request.id)
                  }
                  aria-expanded={selected === request.id}
                  aria-controls={`request-${request.id}`}
                >
                  <span
                    className={`svc-request-icon svc-request-icon-${request.status}`}
                  >
                    <FileText size={20} aria-hidden="true" />
                  </span>
                  <span className="svc-request-title">
                    <strong>{TYPES[request.type]?.title || "Заявление"}</strong>
                    <span>
                      {request.number} · {dateLabel(request.createdAt)}
                    </span>
                    <StatusBadge status={request.status} />
                  </span>
                  <ChevronDown
                    className={selected === request.id ? "svc-rotated" : ""}
                    size={18}
                    aria-hidden="true"
                  />
                </button>
                {selected === request.id && (
                  <div id={`request-${request.id}`}>
                    <RequestDetails
                      request={request}
                      busy={advancing === request.id}
                      onAdvance={advance}
                      onArchive={archive}
                    />
                  </div>
                )}
              </article>
            ))}
          </div>
          {filtered.length === 0 && (
            <div className="card svc-empty">
              <FileCheck2 size={32} aria-hidden="true" />
              <h3>
                {filter === "archived"
                  ? "Архив пока пуст"
                  : filter === "all"
                    ? "Пока без заявок"
                    : filter === "ready"
                      ? "Готовых документов пока нет"
                      : "Все вопросы решены"}
              </h3>
              <p>
                {filter === "archived"
                  ? "Перенесите сюда готовые заявки, чтобы освободить место для новых. Документы останутся доступными."
                  : filter === "all"
                    ? "Выберите документ в форме — первый шаг займёт пару минут."
                    : filter === "ready"
                      ? "Здесь появятся документы, которые можно скачать."
                      : "Новых заявок в работе нет. Готовые документы доступны во вкладке «Готовые»."}
              </p>
              {filter !== "all" && (
                <button
                  className="button secondary"
                  onClick={() => setFilter("all")}
                >
                  Показать все заявки
                </button>
              )}
            </div>
          )}
          <div className="svc-help-card">
            <ShieldCheck size={22} aria-hidden="true" />
            <div>
              <h3>Вы знаете, что происходит</h3>
              <p>
                Статусы и история собраны в карточке заявки. Готовый
                демодокумент можно скачать прямо здесь.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export function Notifications({ data, refresh, notify }) {
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");
  const items = data.notifications || [];
  const unread = items.filter((item) => !item.read).length;
  const filtered = items.filter(
    (item) =>
      filter === "all" ||
      (filter === "unread" ? !item.read : item.category === filter),
  );
  async function markRead(id) {
    if (busy) return;
    setBusy(id || "all");
    setError("");
    try {
      await api("/notifications/read", {
        method: "POST",
        body: id ? { id } : { all: true },
      });
      await refresh();
      notify?.(id ? "Уведомление прочитано" : "Все уведомления прочитаны");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="svc-page">
      <div className="page-heading">
        <div>
          <span className="svc-eyebrow">Не потеряется в чатах</span>
          <h1>Уведомления</h1>
          <p className="muted">Изменения, документы и важное от деканата.</p>
        </div>
        <button
          className="button secondary"
          onClick={() => markRead()}
          disabled={!unread || !!busy}
        >
          <CheckCheck size={17} aria-hidden="true" />
          Прочитать все{unread > 0 && ` · ${unread}`}
        </button>
      </div>
      <div className="svc-notifications-layout">
        <section aria-label="Список уведомлений">
          <div
            className="svc-filter-row svc-filter-wrap"
            role="group"
            aria-label="Фильтр уведомлений"
          >
            {[
              ["all", "Все"],
              ["unread", "Непрочитанные"],
              ["schedule", "Расписание"],
              ["deadline", "Дедлайны"],
              ["request", "Документы"],
              ["news", "Новости"],
            ].map(([key, title]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={filter === key ? "svc-filter-active" : ""}
                aria-pressed={filter === key}
              >
                {title}
                {key === "unread" && unread > 0 && <span>{unread}</span>}
              </button>
            ))}
          </div>
          {error && (
            <p className="svc-error" role="alert">
              {error}
            </p>
          )}
          <div className="svc-notification-stack">
            {filtered.map((item) => {
              const category = CATEGORY[item.category] || CATEGORY.news;
              return (
                <article
                  className={`card svc-notification ${!item.read ? "svc-unread" : ""}`}
                  key={item.id}
                >
                  <span
                    className={`svc-notification-icon svc-notification-${item.category}`}
                  >
                    <category.Icon size={21} aria-hidden="true" />
                  </span>
                  <div className="svc-notification-body">
                    <div className="svc-notification-meta">
                      <span>{category.title}</span>
                      <time dateTime={item.createdAt}>
                        {dateLabel(item.createdAt)}
                      </time>
                      {!item.read && (
                        <span className="svc-unread-label">Новое</span>
                      )}
                    </div>
                    <h2>{item.title}</h2>
                    <p>{item.body}</p>
                    <div className="svc-notification-actions">
                      {item.route && (
                        <a
                          href={`#${item.route}${item.focusId ? `/${encodeURIComponent(item.focusId)}` : ""}`}
                          className="svc-text-button"
                        >
                          {item.route === "schedule"
                            ? "В расписание"
                            : item.route === "requests"
                              ? "К заявкам"
                              : item.route === "plan"
                                ? "Открыть дело в плане"
                                : "К успеваемости"}
                          <ArrowRight size={15} aria-hidden="true" />
                        </a>
                      )}
                      {!item.read && (
                        <button
                          className="svc-text-button svc-text-muted"
                          disabled={!!busy}
                          onClick={() => markRead(item.id)}
                        >
                          <Check size={15} aria-hidden="true" />
                          Прочитано
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          {!filtered.length && (
            <div className="card svc-empty">
              <Bell size={32} aria-hidden="true" />
              <h2>
                {filter === "unread" ? "Вы всё прочитали" : "Здесь пока тихо"}
              </h2>
              <p>
                {filter === "unread"
                  ? "Можно спокойно вернуться к учёбе. Новое появится здесь."
                  : "Уведомлений в этой категории пока нет."}
              </p>
              <button
                className="button secondary"
                onClick={() => setFilter("all")}
              >
                Все уведомления
              </button>
            </div>
          )}
        </section>
        <aside className="card svc-notification-aside">
          <span className="svc-icon-tile">
            <Bell size={22} aria-hidden="true" />
          </span>
          <h2>Только то, что важно</h2>
          <p>
            Новое место занятия, готовая справка, близкий дедлайн. Всё связано с
            вашими учебными задачами.
          </p>
          <div className="svc-aside-note">
            <Info size={17} aria-hidden="true" />
            <p>
              Демонстрационные новости и сроки. Демо-неделя · 16–22 ноября. Push
              и email-рассылка в прототипе не подключены.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

export function Profile({ data }) {
  const user = data.user;
  const fields = [
    ["Факультет", user.faculty],
    ["Направление", user.program],
    ["Курс", `${user.year} курс`],
    ["Группа", user.group],
    ["Номер студенческого", user.studentNumber],
    ["Учебная почта", user.email],
  ];
  return (
    <div className="svc-page">
      <div className="page-heading">
        <div>
          <span className="svc-eyebrow">Ваш учебный профиль</span>
          <h1>Мой профиль</h1>
          <p className="muted">Главное о вашей учёбе — в одной карточке.</p>
        </div>
        <span className="svc-private-label">
          <ShieldCheck size={15} aria-hidden="true" />
          Учебный аккаунт
        </span>
      </div>
      <div className="svc-profile-layout">
        <section
          className="card svc-profile-main"
          aria-labelledby="profile-name"
        >
          <div className="svc-profile-banner">
            <span className="svc-profile-orbit svc-profile-orbit-one" />
            <span className="svc-profile-orbit svc-profile-orbit-two" />
            <span className="svc-profile-banner-label">Ваш маршрут в университете</span>
          </div>
          <div className="svc-profile-content">
            <div
              className="svc-profile-avatar"
              style={{ background: user.avatarColor || "#147d73" }}
              aria-hidden="true"
            >
              {user.initials ||
                `${user.firstName?.[0] || ""}${user.lastName?.[0] || ""}`}
            </div>
            <span className="svc-profile-role">Студент · {user.year} курс</span>
            <h2 id="profile-name">
              {user.fullName ||
                `${user.lastName} ${user.firstName} ${user.middleName || ""}`}
            </h2>
            <p className="svc-profile-faculty">{user.faculty}</p>
            <dl className="svc-profile-fields">
              {fields.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value || "Не указано"}</dd>
                </div>
              ))}
            </dl>
            <div className="svc-profile-data-note">
              <Info size={17} aria-hidden="true" />
              <p>
                Все данные вымышлены. Профиль — часть конкурсного прототипа, он
                не связан с базами университета.
              </p>
            </div>
          </div>
        </section>
        <aside className="svc-profile-side">
          <section className="card svc-profile-security">
            <span className="svc-icon-tile">
              <LockKeyhole size={22} aria-hidden="true" />
            </span>
            <h2>Личное остаётся личным</h2>
            <p>Расписание, оценки и заявки связаны с выбранным аккаунтом.</p>
            <ul>
              <li>
                <CheckCircle2 size={17} aria-hidden="true" />
                Чужую заявку нельзя открыть по ссылке
              </li>
              <li>
                <CheckCircle2 size={17} aria-hidden="true" />
                Пароль не хранится открытым текстом
              </li>
              <li>
                <CheckCircle2 size={17} aria-hidden="true" />
                Выход завершает текущую сессию
              </li>
            </ul>
            <div className="svc-aside-note">
              <Info size={17} aria-hidden="true" />
              <p>
                Демоаккаунты общедоступны для жюри. Используйте только
                вымышленные данные и выходите из кабинета на общем устройстве.
              </p>
            </div>
          </section>
          <section className="svc-profile-help">
            <UserRound size={21} aria-hidden="true" />
            <h3>Нужна справка?</h3>
            <p>
              Профиль автоматически подставляется в учебный демодокумент.
              Закажите справку и проследите её путь до готовности.
            </p>
            <a className="svc-text-button" href="#requests">
              Открыть заявки
              <ArrowRight size={15} aria-hidden="true" />
            </a>
          </section>
        </aside>
      </div>
    </div>
  );
}

export function Assistant({ data, onNavigate }) {
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState("");
  const inputRef = useRef(null);
  const prompts = [
    "Какие пары в понедельник?",
    "Как у меня с оценками?",
    "Как заказать справку?",
    "Какой ближайший дедлайн?",
  ];
  function ask(text) {
    const value = text.trim();
    if (!value) {
      setError("Напишите вопрос или выберите подсказку.");
      inputRef.current?.focus();
      return;
    }
    setError("");
    setMessages((current) => [
      ...current.slice(-5),
      {
        question: value,
        answer: navigatorAnswer(value, data),
        id: crypto.randomUUID(),
      },
    ]);
    setQuery("");
  }
  function navigate(route, focusId) {
    if (onNavigate) onNavigate(route, focusId);
    else
      window.location.hash = focusId
        ? `${route}/${encodeURIComponent(focusId)}`
        : route;
  }
  return (
    <div className="svc-page svc-navigator-page">
      <div className="page-heading">
        <div>
          <span className="svc-eyebrow">Меньше искать. Больше успевать.</span>
          <h1>Навигатор</h1>
          <p className="muted">Короткий путь к ответам в вашем кабинете.</p>
        </div>
        <span className="svc-private-label">
          <Compass size={15} aria-hidden="true" />
          Всегда по делу
        </span>
      </div>
      <section
        className="card svc-navigator"
        aria-label="Навигатор по личному кабинету"
      >
        <div className="svc-navigator-intro">
          <span className="svc-navigator-symbol">
            <Compass size={32} aria-hidden="true" />
          </span>
          <div>
            <h2>С чего начнём, {data.user.firstName}?</h2>
            <p>
              Подскажу, что с расписанием, оценками и документами, и сразу
              покажу нужный раздел.
            </p>
            <span className="svc-navigator-disclosure">
              <ShieldCheck size={13} aria-hidden="true" />
              Навигатор по вашим данным · без внешнего ИИ
            </span>
          </div>
        </div>
        <div className="svc-prompts" role="group" aria-label="Примеры вопросов">
          {prompts.map((prompt) => (
            <button key={prompt} onClick={() => ask(prompt)}>
              {prompt}
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          ))}
        </div>
        {messages.length > 0 && (
          <div
            className="svc-conversation"
            role="log"
            aria-live="polite"
            aria-label="Ответы навигатора"
          >
            {messages.map((message) => (
              <div className="svc-exchange" key={message.id}>
                <p className="svc-question">
                  <span className="svc-sr-only">Ваш вопрос: </span>
                  {message.question}
                </p>
                <div className="svc-answer">
                  <span className="svc-answer-icon">
                    <Compass size={18} aria-hidden="true" />
                  </span>
                  <div>
                    <p>{message.answer.text}</p>
                    {message.answer.route && (
                      <button
                        className="svc-text-button"
                        onClick={() =>
                          navigate(message.answer.route, message.answer.focusId)
                        }
                      >
                        {message.answer.action}
                        <ArrowRight size={15} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <form
          className="svc-navigator-form"
          onSubmit={(event) => {
            event.preventDefault();
            ask(query);
          }}
        >
          <label htmlFor="navigator-query" className="svc-sr-only">
            Ваш вопрос навигатору
          </label>
          <input
            id="navigator-query"
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Например: когда ближайший экзамен?"
            maxLength={300}
            autoComplete="off"
          />
          <button className="button" type="submit" aria-label="Задать вопрос">
            <ArrowRight size={20} aria-hidden="true" />
          </button>
        </form>
        {error && (
          <p className="svc-error" role="alert">
            {error}
          </p>
        )}
        <p className="svc-small-note">
          Локальные подсказки по демонстрационным данным. Вопросы не
          отправляются внешним сервисам и исчезнут при выходе из раздела. Не
          вводите личные сведения.
        </p>
      </section>
      <div className="svc-navigator-footnotes">
        <div>
          <CalendarDays size={20} aria-hidden="true" />
          <strong>Контекст под рукой</strong>
          <span>Ваши предметы, даты и заявки</span>
        </div>
        <div>
          <ArrowRight size={20} aria-hidden="true" />
          <strong>От вопроса к делу</strong>
          <span>Ответ сразу ведёт в нужный раздел</span>
        </div>
        <div>
          <ShieldCheck size={20} aria-hidden="true" />
          <strong>Понятные границы</strong>
          <span>Без выдуманных правил университета</span>
        </div>
      </div>
    </div>
  );
}
