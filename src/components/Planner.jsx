import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  Circle,
  ClipboardList,
  GraduationCap,
  Info,
  ListTodo,
  LoaderCircle,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import api from "../api";
import "./planner.css";

const lastDemoDate = "2026-11-22";
const dateLabel = (value) =>
  value
    ? new Intl.DateTimeFormat("ru-RU", {
        day: "numeric",
        month: "long",
        timeZone: "UTC",
      }).format(new Date(`${value}T12:00:00Z`))
    : "Без срока";
const orderItems = (a, b) =>
  Number(a.completed) - Number(b.completed) ||
  (a.dueDate || "9999").localeCompare(b.dueDate || "9999") ||
  a.id.localeCompare(b.id);

export function Planner({ data, refresh, notify, focusId }) {
  const referenceDate =
    data.plan?.referenceDate || data.referenceDate || "2026-11-16";
  const [items, setItems] = useState(data.plan?.items || []);
  const [filter, setFilter] = useState("active");
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState(referenceDate);
  const [busy, setBusy] = useState(null);
  const [formError, setFormError] = useState("");
  const [actionError, setActionError] = useState("");
  const [stale, setStale] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [focused, setFocused] = useState(focusId || null);
  const pending = useRef(false);
  const idempotency = useRef(null);
  const newTaskInput = useRef(null);
  const filterBar = useRef(null);
  const lastFocused = useRef(null);
  useEffect(() => {
    setItems(data.plan?.items || []);
  }, [data.plan]);
  useEffect(() => {
    setFocused(focusId || null);
    if (focusId) setFilter("all");
  }, [focusId]);
  useEffect(() => {
    if (
      !focused ||
      lastFocused.current === focused ||
      !items.some((item) => item.id === focused)
    )
      return;
    const node = document.getElementById(`plan-item-${focused}`);
    if (!node) return;
    lastFocused.current = focused;
    node.focus({ preventScroll: true });
    node.scrollIntoView({
      block: "center",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }, [focused, items, filter]);

  const completed = items.filter((item) => item.completed).length;
  const active = items.length - completed;
  const visible = [...items]
    .filter(
      (item) =>
        filter === "all" ||
        (filter === "done" ? item.completed : !item.completed),
    )
    .sort(orderItems);
  const missingFocus = focused && !items.some((item) => item.id === focused);

  async function reload() {
    try {
      await refresh();
      setStale(false);
    } catch {
      setStale(true);
    }
  }
  function focusCurrentFilter() {
    requestAnimationFrame(() =>
      filterBar.current
        ?.querySelector('[aria-pressed="true"]')
        ?.focus({ preventScroll: true }),
    );
  }
  async function updateItem(item) {
    if (pending.current) return;
    pending.current = true;
    setBusy(item.id);
    setActionError("");
    try {
      const result = await api(`/plan/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        body: { completed: !item.completed },
      });
      setItems((current) =>
        current.map((value) =>
          value.id === item.id
            ? result.item || { ...value, completed: !item.completed }
            : value,
        ),
      );
      notify?.(
        item.completed
          ? "Задача снова в работе"
          : item.kind === "deadline"
            ? "Личная готовность отмечена. Это не отправка работы."
            : "Задача отмечена как готовая",
      );
      await reload();
      if (
        (filter === "active" && !item.completed) ||
        (filter === "done" && item.completed)
      )
        focusCurrentFilter();
    } catch (error) {
      setActionError(
        error.message || "Не получилось изменить отметку. Попробуйте ещё раз.",
      );
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }
  async function addItem(event) {
    event.preventDefault();
    if (pending.current) return;
    setFormError("");
    if (!title.trim() || title.trim().length > 120) {
      setFormError("Введите название: от 1 до 120 символов.");
      return;
    }
    if (dueDate && (dueDate < referenceDate || dueDate > lastDemoDate)) {
      setFormError("Выберите дату с 16 по 22 ноября или оставьте срок пустым.");
      return;
    }
    pending.current = true;
    setBusy("create");
    setActionError("");
    try {
      const body = { title: title.trim(), dueDate: dueDate || null };
      const fingerprint = JSON.stringify(body);
      if (idempotency.current?.fingerprint !== fingerprint)
        idempotency.current = { fingerprint, key: crypto.randomUUID() };
      const result = await api("/plan", {
        method: "POST",
        headers: { "Idempotency-Key": idempotency.current.key },
        body,
      });
      idempotency.current = null;
      setItems((current) =>
        current.some((item) => item.id === result.item.id)
          ? current
          : [...current, result.item],
      );
      setTitle("");
      setFilter("active");
      setFocused(result.item.id);
      notify?.("Задача добавлена в ваш план");
      await reload();
    } catch (error) {
      setFormError(
        error.message ||
          "Не получилось сохранить задачу. Текст остался в форме.",
      );
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }
  async function deleteItem(item) {
    if (pending.current || item.kind !== "personal") return;
    pending.current = true;
    setBusy(item.id);
    setActionError("");
    try {
      await api(`/plan/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      setItems((current) => current.filter((value) => value.id !== item.id));
      setConfirmDelete(null);
      if (focused === item.id) {
        setFocused(null);
        if (focusId) window.location.hash = "plan";
      }
      notify?.("Личная задача удалена");
      await reload();
      focusCurrentFilter();
    } catch (error) {
      setActionError(
        error.message || "Не получилось удалить задачу. Попробуйте ещё раз.",
      );
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }
  function selectFilter(value) {
    setFilter(value);
    setConfirmDelete(null);
  }
  function clearFocus() {
    setFocused(null);
    lastFocused.current = null;
    window.location.hash = "plan";
  }
  function focusForm() {
    newTaskInput.current?.focus();
    newTaskInput.current?.scrollIntoView({
      block: "center",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }

  return (
    <div className="plan-page">
      <header className="plan-heading">
        <div>
          <p className="plan-eyebrow">Из «надо бы» — в понятный шаг</p>
          <h1>Мой план</h1>
          <p>Учебные сроки и ваши задачи. В одном спокойном списке.</p>
        </div>
        <span className="plan-week">
          <CalendarDays size={16} aria-hidden="true" />
          Демо-неделя · 16–22 ноября
        </span>
      </header>
      <div className="plan-honesty">
        <Info size={18} aria-hidden="true" />
        <p>
          <strong>Отметка — для вас.</strong> «Готово» у учебного срока означает
          личную готовность. Она не отправляет работу преподавателю и не меняет
          оценки.
        </p>
      </div>
      {stale && (
        <div className="plan-warning" role="status">
          <p>
            Изменение сохранено, но не удалось обновить весь список. Повторная
            отправка не нужна.
          </p>
          <button className="plan-text-button" onClick={reload}>
            Обновить список
            <RotateCcw size={15} aria-hidden="true" />
          </button>
        </div>
      )}
      {missingFocus && (
        <div className="plan-warning" role="status">
          <p>
            <strong>Задача недоступна.</strong> Ссылка могла устареть. Ниже —
            ваш собственный план.
          </p>
          <button className="plan-text-button" onClick={clearFocus}>
            Вернуться к списку
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="plan-layout">
        <section className="card plan-board" aria-labelledby="plan-board-title">
          <div className="plan-board-heading">
            <div>
              <span className="plan-eyebrow">Двигаемся в своём темпе</span>
              <h2 id="plan-board-title">Один шаг за другим</h2>
            </div>
            <span className="plan-completion" role="status" aria-live="polite">
              <CheckCircle2 size={17} aria-hidden="true" />
              {completed} из {items.length} готово
            </span>
          </div>
          <div
            className="plan-progress"
            role="img"
            aria-label={`Готово задач: ${completed} из ${items.length}`}
          >
            <span
              style={{
                width: `${items.length ? (completed / items.length) * 100 : 0}%`,
              }}
            />
          </div>
          <div className="plan-toolbar">
            <div
              ref={filterBar}
              className="plan-filters"
              role="group"
              aria-label="Показать задачи"
            >
              {[
                ["active", "В работе", active],
                ["done", "Готово", completed],
                ["all", "Все", items.length],
              ].map(([value, label, count]) => (
                <button
                  key={value}
                  aria-pressed={filter === value}
                  className={filter === value ? "plan-filter-active" : ""}
                  onClick={() => selectFilter(value)}
                >
                  {label}
                  <span>{count}</span>
                </button>
              ))}
            </div>
            <button
              className="plan-text-button plan-add-shortcut"
              onClick={focusForm}
            >
              <Plus size={16} aria-hidden="true" />
              Новая задача
            </button>
          </div>
          {actionError && (
            <p className="plan-error" role="alert">
              {actionError}
            </p>
          )}
          <div className="plan-items">
            {visible.map((item) => (
              <article
                className={`plan-item ${item.completed ? "plan-item-done" : ""} ${focused === item.id ? "plan-focused" : ""}`}
                id={`plan-item-${item.id}`}
                key={item.id}
                tabIndex={-1}
              >
                <div className="plan-item-main">
                  <label className="plan-check-label">
                    <input
                      type="checkbox"
                      checked={item.completed}
                      onChange={() => updateItem(item)}
                      disabled={!!busy}
                    />
                    <span className="plan-custom-check" aria-hidden="true">
                      {item.completed && <Check size={15} />}
                    </span>
                    <span className="plan-item-title">{item.title}</span>
                  </label>
                  {item.kind === "personal" && (
                    <button
                      className="plan-delete"
                      aria-label={`Удалить задачу: ${item.title}`}
                      disabled={!!busy}
                      onClick={() =>
                        setConfirmDelete(
                          confirmDelete === item.id ? null : item.id,
                        )
                      }
                    >
                      <Trash2 size={17} aria-hidden="true" />
                    </button>
                  )}
                </div>
                <div className="plan-item-info">
                  <span className={`plan-kind plan-kind-${item.kind}`}>
                    {item.kind === "deadline" ? (
                      <GraduationCap size={13} aria-hidden="true" />
                    ) : (
                      <ListTodo size={13} aria-hidden="true" />
                    )}
                    {item.kind === "deadline" ? "Учебный срок" : "Моя задача"}
                  </span>
                  <span className="plan-item-date">
                    <CalendarDays size={13} aria-hidden="true" />
                    {dateLabel(item.dueDate)}
                  </span>
                  {item.completed && (
                    <span className="plan-done-label">
                      <Check size={13} aria-hidden="true" />
                      Готово
                    </span>
                  )}
                </div>
                {item.subject && <p className="plan-subject">{item.subject}</p>}
                {item.kind === "deadline" && item.sourceRoute && (
                  <a className="plan-source" href={`#${item.sourceRoute}`}>
                    {item.sourceRoute === "schedule"
                      ? "Открыть расписание"
                      : "Открыть успеваемость"}
                    <ArrowRight size={13} aria-hidden="true" />
                  </a>
                )}
                {busy === item.id && (
                  <span className="plan-pending" role="status">
                    <LoaderCircle size={14} aria-hidden="true" />
                    Сохраняем…
                  </span>
                )}
                {confirmDelete === item.id && (
                  <div className="plan-delete-confirm">
                    <p>
                      Удалить личную задачу «{item.title}»? Это действие нельзя
                      отменить.
                    </p>
                    <div>
                      <button
                        className="button plan-danger"
                        disabled={!!busy}
                        onClick={() => deleteItem(item)}
                      >
                        Удалить
                      </button>
                      <button
                        className="button secondary"
                        disabled={!!busy}
                        onClick={() => setConfirmDelete(null)}
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
          {!visible.length && (
            <div className="plan-empty">
              <span>
                {filter === "done" ? (
                  <CheckCircle2 size={30} aria-hidden="true" />
                ) : (
                  <ClipboardList size={30} aria-hidden="true" />
                )}
              </span>
              <h3>
                {filter === "done"
                  ? "Первый готовый шаг впереди"
                  : filter === "active" && items.length
                    ? "Всё, что было в плане, готово"
                    : "Начните с одной задачи"}
              </h3>
              <p>
                {filter === "done"
                  ? "Отмечайте выполненные задачи — они появятся здесь. Отметку всегда можно снять."
                  : filter === "active" && items.length
                    ? "Можно выдохнуть. Добавьте новую задачу, когда она появится."
                    : "Например, повторить конспект или подготовить вопрос к семинару."}
              </p>
              <button
                className="button secondary"
                onClick={
                  filter === "done" ? () => selectFilter("active") : focusForm
                }
              >
                {filter === "done"
                  ? "К задачам в работе"
                  : "Добавить первую задачу"}
                <ArrowRight size={15} aria-hidden="true" />
              </button>
            </div>
          )}
          <footer className="plan-board-footer">
            <Circle size={13} aria-hidden="true" />
            <span>
              Без срока — тоже план. Такие задачи находятся в конце списка.
            </span>
          </footer>
        </section>
        <aside className="card plan-create" aria-labelledby="plan-create-title">
          <span className="plan-create-icon">
            <Plus size={23} aria-hidden="true" />
          </span>
          <p className="plan-eyebrow">Маленький шаг — ваше решение</p>
          <h2 id="plan-create-title">Добавить своё</h2>
          <p className="plan-create-description">
            Планируйте не только пары: подготовку, вопросы и всё, что не хочется
            забыть.
          </p>
          <form onSubmit={addItem}>
            <div className="plan-field">
              <label htmlFor="plan-title">Название задачи</label>
              <input
                ref={newTaskInput}
                id="plan-title"
                type="text"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setFormError("");
                }}
                placeholder="Например, повторить конспект"
                maxLength={120}
                required
                disabled={busy === "create"}
                aria-describedby="plan-title-hint"
              />
              <small id="plan-title-hint">
                До 120 символов · только вымышленные сведения
              </small>
            </div>
            <div className="plan-field">
              <label htmlFor="plan-date">
                Срок <span>необязательно</span>
              </label>
              <input
                id="plan-date"
                type="date"
                min={referenceDate}
                max={lastDemoDate}
                value={dueDate}
                onChange={(e) => {
                  setDueDate(e.target.value);
                  setFormError("");
                }}
                disabled={busy === "create"}
                aria-describedby="plan-date-hint"
              />
              <small id="plan-date-hint">
                В пределах демо-недели 16–22 ноября 2026. Оставьте пустым, если
                срок не нужен.
              </small>
              {dueDate && (
                <button
                  type="button"
                  className="plan-text-button"
                  onClick={() => setDueDate("")}
                  disabled={busy === "create"}
                >
                  Убрать срок
                </button>
              )}
            </div>
            {formError && (
              <p className="plan-error" role="alert">
                {formError}
              </p>
            )}
            <button
              className="button plan-submit"
              type="submit"
              disabled={!!busy}
            >
              {busy === "create" ? (
                <LoaderCircle size={17} aria-hidden="true" />
              ) : (
                <Plus size={17} aria-hidden="true" />
              )}
              {busy === "create" ? "Сохраняем…" : "Добавить задачу"}
            </button>
          </form>
          <p className="plan-storage-note">
            <Info size={15} aria-hidden="true" />
            Задачи и отметки сохраняются в вашем аккаунте. Учебные сроки
            добавлены из демоданных и не редактируются.
          </p>
        </aside>
      </div>
    </div>
  );
}
