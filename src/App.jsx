import React, { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Bell,
  Building2,
  LibraryBig,
  Plug,
  Wallet,
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  ListTodo,
  FileText,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserRound,
  X,
} from "lucide-react";
import api from "./api";
import { Schedule, Grades } from "./components/Academics";
import { Planner } from "./components/Planner";
import { Requests, Notifications, Profile } from "./components/Services";
import { Campus, Housing } from "./components/Campus";
import { Knowledge } from "./components/Knowledge";
import { Connections } from "./components/Connections";
import { AIAssistant } from "./components/AIAssistant";
import "./styles.css";
import "./course.css";

const navigation = [
  {
    id: "dashboard",
    title: "Главная",
    icon: LayoutDashboard,
    hint: "Всё важное на сегодня",
  },
  {
    id: "schedule",
    title: "Расписание",
    icon: CalendarDays,
    hint: "Пары, аудитории и преподаватели",
    searchTerms: "расписания занятия занятий перенос пары",
  },
  {
    id: "grades",
    title: "Успеваемость",
    icon: GraduationCap,
    hint: "Оценки, зачёты и сессия",
    searchTerms: "оценок экзамен экзамены сессии сессию",
  },
  {
    id: "requests",
    title: "Заявки и справки",
    icon: FileText,
    hint: "Заказать документ и проверить статус",
    searchTerms: "справка справку справок заявка заявку документы выписка",
  },
  {
    id: "plan",
    title: "Мой план",
    icon: ListTodo,
    hint: "Личные дела, подготовка и учебные сроки",
    searchTerms: "задача задачи задачу дедлайн дедлайны",
  },
  {
    id: "notifications",
    title: "Уведомления",
    icon: Bell,
    hint: "Новости и важные изменения",
  },
  {
    id: "campus",
    title: "Кампус",
    icon: Building2,
    hint: "Общественные помещения и бронирования",
    searchTerms: "комната комнаты комнату бронь брони забронировать",
  },
  {
    id: "housing",
    title: "Общежитие",
    icon: Wallet,
    hint: "Начисления, оплата и квитанции",
    searchTerms: "общежития общежитию проживание оплатить оплаты квитанция",
  },
  {
    id: "knowledge",
    title: "База знаний",
    icon: LibraryBig,
    hint: "Поиск в приказах, правилах и своих документах",
    searchTerms: "приказы правила документы документов",
  },
  {
    id: "connections",
    title: "Подключения",
    icon: Plug,
    hint: "Уведомления Telegram, VK и MCP для своего ИИ",
    searchTerms: "телеграм вк подключение",
  },
  {
    id: "assistant",
    title: "Навигатор",
    icon: Sparkles,
    hint: "ИИ-помощник: расписание, документы, заявки и брони",
  },
  {
    id: "profile",
    title: "Мой профиль",
    icon: UserRound,
    hint: "Ваши учебные данные",
  },
];
const searchWords = (value) =>
  value.toLocaleLowerCase("ru-RU").replaceAll("ё", "е").match(/[\p{L}\p{N}]+/gu) || [];
const getRoute = () => {
  const route = window.location.hash.slice(1).split("/")[0];
  return navigation.some((n) => n.id === route) ? route : "dashboard";
};
const getRouteContext = () => {
  try {
    return (
      decodeURIComponent(
        window.location.hash.slice(1).split("/").slice(1).join("/"),
      ) || null
    );
  } catch {
    return "unavailable";
  }
};
const requestNames = {
  enrollment: "Справка об обучении",
  scholarship: "Справка о стипендии",
  transcript: "Выписка об успеваемости",
  leave: "Заявление на отпуск",
};
const statusNames = {
  submitted: "Заявка принята",
  processing: "Готовится",
  ready: "Готово к скачиванию",
};
function Brand() {
  return (
    <span className="brand">
      <svg className="course-mark" viewBox="0 0 36 36" fill="none" aria-hidden="true">
        <path d="M7 27V9h9v9h13M22 11l7 7-7 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>курсом<span className="brand-dot">.</span></span>
    </span>
  );
}
function CourseArt() {
  return (
    <div className="course-art" aria-hidden="true">
      <span>Учебный маршрут</span>
      <div><CalendarDays size={22} /><strong>Пары</strong><ArrowRight size={18} /><FileText size={22} /><strong>Дела</strong><ArrowRight size={18} /><Check size={22} /></div>
      <p>От расписания — к следующему действию.</p>
    </div>
  );
}

function Login({ onLogin }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event, demoLogin) {
    event?.preventDefault();
    setError("");
    setPending(true);
    try {
      const session = await api("/login", {
        method: "POST",
        body: {
          login: demoLogin || login,
          password: demoLogin ? "Orbita2026!" : password,
        },
      });
      api.setCsrf(session.csrfToken);
      await onLogin();
    } catch (e) {
      setError(
        e.status === 401
          ? "Логин или пароль не подошли. Проверьте данные и попробуйте ещё раз."
          : e.message || "Не удалось войти. Попробуйте ещё раз.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="login-page">
      <div className="login-story">
        <a
          className="brand-link"
          href="#dashboard"
          aria-label="Курсом — главная"
        >
          <Brand />
        </a>
        <div className="login-story-body">
          <span className="eyebrow">КУРСОМ · КАБИНЕТ СТУДЕНТА</span>
          <h1>
            Учёба сложная.
            <br />
            Кабинет —<br />
            <em>простой.</em>
          </h1>
          <p>
            Расписание, оценки и документы.
            <br />
            Ваш учебный день — понятным маршрутом.
          </p>
          <CourseArt />
        </div>
        <div className="login-story-footer">
          <span>
            <ShieldCheck size={17} /> Вымышленные учебные данные
          </span>
          <span>Больше времени на главное</span>
        </div>
      </div>
      <main className="login-main">
        <span className="concept-pill">
          <span /> Концепт · неофициальный сервис
        </span>
        <div className="login-form-wrap">
          <span className="eyebrow">ВАШ УЧЕБНЫЙ МАРШРУТ</span>
          <h2>Рады вас видеть</h2>
          <p className="muted">
            Войдите, чтобы собрать учебный день в одном месте.
          </p>
          <form onSubmit={submit} className="login-form">
            <label htmlFor="login">
              Логин
              <input
                id="login"
                name="login"
                type="text"
                autoComplete="username"
                placeholder="Ваш учебный логин"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                required
                disabled={pending}
              />
            </label>
            <label htmlFor="password">
              Пароль
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="Введите пароль"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={pending}
              />
            </label>
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <button
              type="submit"
              className="button login-submit"
              disabled={pending}
            >
              {pending ? "Входим…" : "Войти в кабинет"}
              {!pending && <ArrowRight size={18} />}
            </button>
          </form>
          <div className="demo-divider">
            <span>ПОСМОТРЕТЬ ДЕМО</span>
          </div>
          <p className="demo-intro">
            Выберите студента. Это общие демоаккаунты: другие посетители с тем
            же логином видят изменения.
          </p>
          <div className="demo-accounts">
            <button
              className="demo-account"
              onClick={() => submit(null, "alisa@demo.orbita")}
              disabled={pending}
            >
              <span className="avatar peach">АМ</span>
              <span>
                <strong>Алиса</strong>
                <small>Международные отношения</small>
              </span>
              <ArrowRight size={17} />
            </button>
            <button
              className="demo-account"
              onClick={() => submit(null, "mark@demo.orbita")}
              disabled={pending}
            >
              <span className="avatar lilac">МВ</span>
              <span>
                <strong>Марк</strong>
                <small>Международная экономика</small>
              </span>
              <ArrowRight size={17} />
            </button>
          </div>
          <details className="demo-credentials">
            <summary>Тестовые логины и пароль для жюри</summary>
            <p>
              <code>alisa@demo.orbita</code>
              <br />
              <code>mark@demo.orbita</code>
              <br />
              Пароль обоих аккаунтов: <code>Orbita2026!</code>
            </p>
          </details>
          <p className="login-disclaimer">
            <ShieldCheck size={16} /> Все имена, оценки и документы вымышлены.
            Не используйте реальные логины и персональные данные.
          </p>
        </div>
        <p className="login-bottom">
          Независимый конкурсный концепт для студентов МГИМО
        </p>
      </main>
    </div>
  );
}

function Dashboard({ data, onNavigate }) {
  const { user } = data;
  const schedule = data.schedule || [];
  const today = schedule
    .filter(
      (item) =>
        item.date === data.referenceDate || (!item.date && item.day === 1),
    )
    .sort((a, b) => a.start.localeCompare(b.start));
  const next = today[0];
  const changed = today.find((item) => item.changed);
  const grades = data.grades || [];
  const mean = grades.length
    ? Math.round(
        grades.reduce((sum, item) => sum + item.score, 0) / grades.length,
      )
    : 0;
  const attendance = grades.length
    ? Math.round(
        grades.reduce((sum, item) => sum + item.attendance, 0) / grades.length,
      )
    : 0;
  const pendingRequests = (data.requests || []).filter(
    (item) => !item.archived && item.status !== "ready",
  );
  const readyRequest = (data.requests || []).find(
    (item) => !item.archived && item.status === "ready",
  );
  const planItems = data.plan?.items || [];
  const openItems = planItems
    .filter((item) => !item.completed)
    .sort(
      (a, b) =>
        (a.dueDate || "9999").localeCompare(b.dueDate || "9999") ||
        a.id.localeCompare(b.id),
    );
  const deadline = openItems[0];
  const daysLeft = deadline?.dueDate
    ? Math.round(
        (Date.parse(deadline.dueDate) - Date.parse(data.referenceDate)) /
          86400000,
      )
    : null;
  const planDateLabel =
    daysLeft === null
      ? "Без срока"
      : daysLeft === 0
        ? "Сегодня в демо"
        : `Через ${daysLeft} дн. в демо`;
  return (
    <div className="dashboard">
      <div className="dashboard-heading">
        <div>
          <div className="eyebrow">ВАШ ДЕНЬ В КАМПУСЕ</div>
          <h1>
            С возвращением, {user.firstName}
            <span className="greeting-dot">.</span>
          </h1>
          <p>Всё важное на сегодня — без лишнего шума.</p>
        </div>
        <span className="date-chip">
          <CalendarDays size={16} /> Понедельник, 16 ноября
        </span>
      </div>
      <div className="day-overview">
        <section className="day-focus" aria-labelledby="day-focus-title">
          <span className="day-kicker">Первая пара демо-дня</span>
          {next ? <>
            <div className="departure-time">{next.start}<span>— {next.end}</span></div>
            <h2 id="day-focus-title">{next.subject}</h2>
            <p className="departure-place"><MapPin size={18} /> Аудитория {next.room}</p>
            <p className="departure-teacher">{next.teacher} · {next.type}</p>
            <button className="button" onClick={() => onNavigate("schedule")}>
              Открыть расписание <ArrowRight size={17} />
            </button>
          </> : <>
            <h2 id="day-focus-title">Сегодня без пар</h2>
            <p>Посмотрите другие дни демо-недели или займитесь личным планом.</p>
            <button className="button" onClick={() => onNavigate("schedule", "week")}>Посмотреть неделю <ArrowRight size={17} /></button>
          </>}
          {changed && <button className="day-change" onClick={() => onNavigate("schedule", `lesson-${changed.id}`)}>
            <span><strong>Изменение аудитории</strong><br />{changed.subject} · {changed.start} · теперь {changed.room}</span><ArrowRight size={18} />
          </button>}
        </section>
      <section className="welcome-card">
        <div className="welcome-copy">
          <span className="mini-label">
            <span /> ЛИЧНЫЙ ПЛАН · ДЕМО-НЕДЕЛЯ
          </span>
          <h2>
            {deadline ? "Следующее дело" : "Можно немного выдохнуть"}
          </h2>
          <p>
            <strong>
              {deadline ? deadline.title : "В личном плане всё отмечено"}
            </strong>
            <br />
            {deadline ? `${planDateLabel} · ` : ""}
            {planItems.length - openItems.length} из {planItems.length} дел
            отмечено вами.
          </p>
          <p className="plan-summary-note">Личная отметка не означает сдачу преподавателю.</p>
          <button
            className="button welcome-button"
            onClick={() => onNavigate("plan", deadline?.id)}
          >
            {deadline ? "Мой следующий шаг" : "Открыть мой план"} <ArrowRight size={17} />
          </button>
        </div>
      </section>
      </div>
      <div className="dashboard-columns">
        <div className="dashboard-main-column">
          <section className="card today-card">
            <div className="section-heading">
              <div>
                <span className="eyebrow">ПЛАН НА ДЕНЬ</span>
                <h2>
                  Сегодня в расписании{" "}
                  <span className="count-pill">{today.length}</span>
                </h2>
              </div>
              <button
                className="text-button"
                onClick={() => onNavigate("schedule", "week")}
              >
                Вся неделя <ArrowRight size={16} />
              </button>
            </div>
            <div className="today-lessons">
              {today.length ? (
                today.map((lesson, index) => (
                  <button
                    key={lesson.id}
                    className={`today-lesson ${index === 0 ? "first" : ""}`}
                    onClick={() => onNavigate("schedule")}
                  >
                    <span className="lesson-time">
                      <strong>{lesson.start}</strong>
                      <small>{lesson.end}</small>
                    </span>
                    <span className={`lesson-bar lesson-bar-${index % 3}`} />
                    <span className="lesson-info">
                      <span className="lesson-kind">
                        {lesson.type}
                        {index === 0 && <span>Первая пара</span>}
                      </span>
                      <strong>{lesson.subject}</strong>
                      <span className="lesson-details">
                        <span>
                          <MapPin size={13} />
                          {lesson.room}
                        </span>
                        <span className="lesson-teacher">{lesson.teacher}</span>
                      </span>
                    </span>
                    <ChevronRight size={16} className="lesson-chevron" />
                  </button>
                ))
              ) : (
                <div className="empty-state">
                  <CalendarDays size={28} />
                  <h3>Сегодня без пар</h3>
                  <p>Можно выдохнуть или посмотреть план на неделю.</p>
                </div>
              )}
            </div>
            <div className="today-footer">
              <span>
                <Clock3 size={14} /> Демо-неделя · 16–22 ноября
              </span>
              <span>Все изменения — в одном месте</span>
            </div>
          </section>
          <section className="quick-actions">
            <button
              className="quick-action document-action"
              onClick={() => onNavigate("requests")}
            >
              <span className="quick-icon">
                <FileText size={24} />
              </span>
              <div>
                <span className="eyebrow">БЕЗ ОЧЕРЕДИ В ДЕКАНАТ</span>
                <h3>Нужна справка?</h3>
                <p>Закажите онлайн. Мы покажем каждый шаг.</p>
              </div>
              <ArrowRight size={20} />
            </button>
            <button
              className="quick-action navigator-action"
              onClick={() => onNavigate("assistant")}
            >
              <span className="quick-icon">
                <Sparkles size={24} />
              </span>
              <div>
                <span className="eyebrow">ЕСТЬ ВОПРОС?</span>
                <h3>Найдём ответ</h3>
                <p>Навигатор знает, где что находится.</p>
              </div>
              <ArrowRight size={20} />
            </button>
          </section>
        </div>
        <div className="dashboard-side-column">
          <section className="card semester-card">
            <div className="section-heading">
              <h2>Ваш учебный ритм</h2>
              <button
                className="icon-button"
                aria-label="Открыть успеваемость"
                onClick={() => onNavigate("grades")}
              >
                <ArrowRight size={17} />
              </button>
            </div>
            <div className="semester-content">
              <div className="score-ring" style={{ "--score": `${mean}%` }}>
                <span>
                  <strong>{mean}</strong>
                  <small>из 100</small>
                </span>
              </div>
              <div>
                <span className="badge good">
                  {mean >= 80 ? "Так держать" : "Есть куда расти"}
                </span>
                <h3>{mean >= 80 ? "Уверенный темп" : "Каждый шаг важен"}</h3>
                <p>
                  Посещаемость <strong>{attendance}%</strong>
                  <br />
                  {grades.length} дисциплин в семестре
                </p>
              </div>
            </div>
            <div className="semester-footer">
              Оценки — ориентир, а не повод для тревоги.
            </div>
          </section>
          {readyRequest && (
            <button
              className="document-ready"
              onClick={() => onNavigate("requests", readyRequest.id)}
            >
              <span className="ready-icon">
                <Check size={18} />
              </span>
              <span>
                <strong>Ваш документ готов</strong>
                <small>
                  {requestNames[readyRequest.type] || readyRequest.type}
                </small>
              </span>
              <ArrowDownToLine size={18} />
            </button>
          )}
        </div>
      </div>
      <div className="dashboard-stats">
        <button className="stat-card" onClick={() => onNavigate("schedule")}>
          <span className="stat-icon mint">
            <CalendarDays size={21} />
          </span>
          <span className="stat-copy">
            <strong>
              {today.length}
              <small> пары на сегодня</small>
            </strong>
            <span>
              {today.length
                ? `${today[0].start} — ${today[today.length - 1].end}`
                : "Время для себя"}
            </span>
          </span>
          <ChevronRight size={17} />
        </button>
        <button className="stat-card" onClick={() => onNavigate("grades")}>
          <span className="stat-icon lilac">
            <TrendingUp size={21} />
          </span>
          <span className="stat-copy">
            <strong>
              {mean}
              <small> средний балл</small>
            </strong>
            <span>{data.semester || "Осенний семестр 2026"}</span>
          </span>
          <ChevronRight size={17} />
        </button>
        <button className="stat-card" onClick={() => onNavigate("requests")}>
          <span className="stat-icon peach">
            <FileText size={21} />
          </span>
          <span className="stat-copy">
            <strong>
              {pendingRequests.length}
              <small>
                {" "}
                {pendingRequests.length === 1
                  ? "заявка в работе"
                  : "заявки в работе"}
              </small>
            </strong>
            <span>
              {readyRequest ? "Есть готовый документ" : "Все статусы — онлайн"}
            </span>
          </span>
          <ChevronRight size={17} />
        </button>
      </div>
      <footer className="dashboard-footnote">
        <span>
          <ShieldCheck size={14} /> Общий демоаккаунт · только вымышленные
          данные
        </span>
        <span>Демонстрационные данные · не официальный сервис МГИМО</span>
      </footer>
    </div>
  );
}

export default function App() {
  const [phase, setPhase] = useState("loading");
  const [data, setData] = useState(null);
  const [route, setRoute] = useState(getRoute);
  const [routeContext, setRouteContext] = useState(getRouteContext);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const toastTimer = useRef(null);
  const searchRef = useRef(null);
  const sidebarRef = useRef(null);
  const authGeneration = useRef(0);
  async function refresh(generation = authGeneration.current) {
    const result = await api("/bootstrap");
    if (generation === authGeneration.current) {
      setData(result);
      setPhase("ready");
    }
    return result;
  }
  async function initialize() {
    const generation = ++authGeneration.current;
    setPhase("loading");
    setLoadError("");
    try {
      const session = await api("/session");
      if (generation !== authGeneration.current) return;
      api.setCsrf(session.csrfToken);
      await refresh(generation);
    } catch (e) {
      if (generation !== authGeneration.current) return;
      if (e.status === 401) {
        setPhase("login");
        setData(null);
      } else {
        setLoadError(e.message || "Сервис временно недоступен.");
        setPhase("error");
      }
    }
  }
  useEffect(() => {
    initialize();
    const hashChange = () => {
      setRoute(getRoute());
      const context = getRouteContext();
      setRouteContext(context);
      setMobileOpen(false);
      setQuery("");
      setSearchFocused(false);
      // Object links manage their own focus/scroll. A later hashchange must not
      // undo that positioning after the target card has already been focused.
      if (!context || /^(week|session|day-[1-7])$/.test(context)) window.scrollTo(0, 0);
    };
    const unauthorized = () => {
      ++authGeneration.current;
      setMobileOpen(false);
      setData(null);
      setPhase("login");
      api.setCsrf("");
    };
    window.addEventListener("hashchange", hashChange);
    window.addEventListener("orbita:unauthorized", unauthorized);
    return () => {
      window.removeEventListener("hashchange", hashChange);
      window.removeEventListener("orbita:unauthorized", unauthorized);
      clearTimeout(toastTimer.current);
    };
  }, []);
  useEffect(() => {
    document.title =
      phase === "ready"
        ? `${navigation.find((n) => n.id === route)?.title || "Главная"} · Курсом`
        : "Курсом — кабинет студента";
  }, [route, phase]);
  useEffect(() => {
    if (!mobileOpen) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const sidebar = sidebarRef.current;
    sidebar?.querySelector("button")?.focus();
    const close = (e) => {
      if (e.key === "Escape") setMobileOpen(false);
      if (e.key === "Tab") {
        const items = [
          ...sidebar.querySelectorAll("a[href], button:not([disabled])"),
        ].filter(
          (item) =>
            item.getClientRects().length &&
            getComputedStyle(item).visibility !== "hidden",
        );
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("keydown", close);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [mobileOpen]);
  function navigate(id, focusId = null) {
    if (!navigation.some((item) => item.id === id)) id = "dashboard";
    window.location.hash = focusId
      ? `${id}/${encodeURIComponent(focusId)}`
      : id;
    setRoute(id);
    setRouteContext(focusId);
    setMobileOpen(false);
    setQuery("");
    setSearchFocused(false);
    window.scrollTo(0, 0);
  }
  function notify(message) {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 5000);
  }
  async function logout() {
    ++authGeneration.current;
    setLoggingOut(true);
    try {
      await api("/logout", { method: "POST" });
      api.setCsrf("");
      setMobileOpen(false);
      setData(null);
      setPhase("login");
      setRoute("dashboard");
      window.location.hash = "";
    } catch (e) {
      notify(e.message || "Не удалось выйти. Попробуйте ещё раз.");
    } finally {
      setLoggingOut(false);
    }
  }
  if (phase === "loading")
    return (
      <main className="loading-screen" aria-busy="true">
        <Brand />
        <span className="loading-orbit" />
        <p>Загружаем ваш учебный день…</p>
      </main>
    );
  if (phase === "error")
    return (
      <main className="loading-screen">
        <Brand />
        <div className="connection-error">
          <CircleHelp size={35} />
          <h1>Пока не удалось подключиться</h1>
          <p>{loadError}</p>
          <button className="button" onClick={initialize}>
            Попробовать ещё раз
          </button>
        </div>
      </main>
    );
  if (phase === "login" || !data)
    return <Login onLogin={() => refresh(++authGeneration.current)} />;
  const unread = data.notifications.filter((item) => !item.read).length;
  const activeItem = navigation.find((item) => item.id === route);
  const queryWords = searchWords(query);
  const searchResults = navigation.filter((item) => {
    const words = searchWords(`${item.title} ${item.hint} ${item.searchTerms || ""}`);
    return queryWords.every((term) => words.some((word) => word.startsWith(term)));
  });
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Перейти к содержимому
      </a>
      {mobileOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="Закрыть меню"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        ref={sidebarRef}
        className={`sidebar ${mobileOpen ? "is-open" : ""}`}
        role={mobileOpen ? "dialog" : undefined}
        aria-modal={mobileOpen || undefined}
        aria-label={mobileOpen ? "Меню кабинета" : undefined}
      >
        <div className="sidebar-brand">
          <a
            href="#dashboard"
            aria-label="Курсом — главная"
            onClick={(e) => {
              e.preventDefault();
              navigate("dashboard");
            }}
          >
            <Brand />
          </a>
          <button
            className="icon-button sidebar-close"
            aria-label="Закрыть меню"
            onClick={() => setMobileOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <div className="university-label">ДЛЯ СТУДЕНТОВ МГИМО</div>
        <div className="sidebar-separator" />
        <div className="nav-section-label">МОЙ КАБИНЕТ</div>
        <nav className="desktop-nav" aria-label="Основная навигация">
          {navigation.slice(0, 6).map(({ id, title, icon: Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              onClick={(e) => {
                e.preventDefault();
                navigate(id);
              }}
              className={`nav-link ${route === id ? "active" : ""}`}
              aria-current={route === id ? "page" : undefined}
            >
              <Icon size={20} strokeWidth={1.7} />
              <span>{title}</span>
              {id === "notifications" && unread > 0 && (
                <span className="nav-count">{unread}</span>
              )}
            </a>
          ))}
        </nav>
        <div className="sidebar-secondary">
          <div className="nav-section-label">ВАШЕ ПРОСТРАНСТВО</div>
          {navigation.slice(6).map(({ id, title, icon: Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              onClick={(e) => {
                e.preventDefault();
                navigate(id);
              }}
              className={`nav-link ${route === id ? "active" : ""}`}
              aria-current={route === id ? "page" : undefined}
            >
              <Icon size={20} strokeWidth={1.7} />
              <span>{title}</span>
            </a>
          ))}
        </div>
        <div className="sidebar-bottom">
          <button
            className="sidebar-help"
            onClick={() => navigate("assistant")}
          >
            <span className="sidebar-help-icon">
              <Sparkles size={19} />
            </span>
            <strong>Чуть меньше забот</strong>
            <p>Найдём нужное и подскажем следующий шаг.</p>
            <span>
              Открыть навигатор <ArrowRight size={14} />
            </span>
          </button>
          <div className="sidebar-profile">
            <button
              className="sidebar-profile-open"
              onClick={() => navigate("profile")}
              title="Открыть мой профиль"
            >
              <span className="avatar peach">{data.user.initials}</span>
              <span>
                <strong>
                  {data.user.firstName} {data.user.lastName}
                </strong>
                <small>
                  {data.user.year} курс · {data.user.group}
                </small>
              </span>
            </button>
            <button
              className="icon-button"
              aria-label="Выйти из аккаунта"
              title="Выйти"
              disabled={loggingOut}
              onClick={logout}
            >
              <LogOut size={17} />
            </button>
          </div>
          <span className="sidebar-concept">
            Концепт · неофициальный сервис
          </span>
        </div>
      </aside>
      <div className="app-body" inert={mobileOpen}>
        <header className="topbar">
          <div className="topbar-title">
            <button
              className="icon-button mobile-menu-button"
              aria-label="Открыть меню"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={22} />
            </button>
            <span className="desktop-breadcrumb">
              Мой кабинет <ChevronRight size={14} />
            </span>
            <strong>{activeItem?.title}</strong>
          </div>
          <div className="topbar-actions">
            <div
              className="global-search"
              ref={searchRef}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget))
                  setSearchFocused(false);
              }}
            >
              <Search size={17} />
              <input
                aria-label="Найти раздел в кабинете"
                placeholder="Найти в кабинете"
                value={query}
                onFocus={() => setSearchFocused(true)}
                onClick={() => setSearchFocused(true)}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSearchFocused(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setSearchFocused(false);
                  if (e.key === "Enter" && searchResults[0])
                    navigate(searchResults[0].id);
                }}
              />
              {searchFocused && (
                <div className="search-results">
                  <span>РАЗДЕЛЫ КАБИНЕТА</span>
                  {searchResults.length ? (
                    searchResults.map(({ id, title, icon: Icon }) => (
                      <button
                        key={id}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => navigate(id)}
                      >
                        <Icon size={16} />
                        {title}
                        <ChevronRight size={14} />
                      </button>
                    ))
                  ) : (
                    <p>Ничего не нашли. Попробуйте «справки» или «оценки».</p>
                  )}
                  {searchResults.length > 0 && <p>Enter откроет первый раздел.</p>}
                </div>
              )}
            </div>
            <button
              className="notification-button icon-button"
              onClick={() => navigate("notifications")}
              aria-label={`Уведомления, ${unread} непрочитанных`}
            >
              <Bell size={21} />
              {unread > 0 && <span />}
            </button>
            <button
              className="topbar-profile"
              onClick={() => navigate("profile")}
              aria-label={`Мой профиль, ${data.user.initials}`}
            >
              <span className="avatar peach">{data.user.initials}</span>
              <ChevronDown size={14} />
            </button>
          </div>
        </header>
        <div className="demo-strip">
          <span>
            <span className="demo-indicator" /> Демо-неделя · 16–22 ноября
          </span>
          <span>
            Все данные вымышлены <ShieldCheck size={13} />
          </span>
        </div>
        <main id="main-content" className="page-content" tabIndex={-1}>
          {route === "dashboard" && (
            <Dashboard data={data} onNavigate={navigate} />
          )}{" "}
          {route === "schedule" && (
            <Schedule data={data} viewContext={routeContext} />
          )}{" "}
          {route === "grades" && (
            <Grades data={data} viewContext={routeContext} />
          )}{" "}
          {route === "plan" && (
            <Planner
              data={data}
              refresh={refresh}
              notify={notify}
              focusId={routeContext}
            />
          )}{" "}
          {route === "requests" && (
            <Requests
              data={data}
              refresh={refresh}
              notify={notify}
              focusId={routeContext}
            />
          )}{" "}
          {route === "notifications" && (
            <Notifications data={data} refresh={refresh} notify={notify} />
          )}{" "}
          {route === "campus" && (
            <Campus notify={notify} refresh={refresh} focusId={routeContext} />
          )}
          {route === "housing" && (
            <Housing notify={notify} refresh={refresh} focusId={routeContext} />
          )}
          {route === "knowledge" && (
            <Knowledge notify={notify} focusId={routeContext} />
          )}
          {route === "connections" && <Connections notify={notify} />}
          {route === "profile" && <Profile data={data} />}{" "}
          {route === "assistant" && (
            <AIAssistant
              data={data}
              onNavigate={navigate}
              refresh={refresh}
              notify={notify}
            />
          )}
        </main>
      </div>
      <nav
        className="mobile-bottom-nav"
        aria-label="Мобильная навигация"
        inert={mobileOpen}
      >
        {navigation.slice(0, 4).map(({ id, title, icon: Icon }) => (
          <a
            key={id}
            href={`#${id}`}
            className={route === id ? "active" : ""}
            aria-current={route === id ? "page" : undefined}
          >
            <Icon size={21} />
            <span>
              {id === "requests"
                ? "Заявки"
                : id === "grades"
                  ? "Оценки"
                  : title}
            </span>
          </a>
        ))}
        <button onClick={() => setMobileOpen(true)} aria-label="Ещё разделы">
          <Menu size={21} />
          <span>Ещё</span>
        </button>
      </nav>
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          <span>{toast}</span>
          <button aria-label="Закрыть уведомление" onClick={() => setToast("")}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
