import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  GraduationCap,
  Info,
  MapPin,
  Search,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  UserRound,
} from "lucide-react";
import "./academics.css";

const weekdays = [
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
  "Воскресенье",
];
const shortDays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const dateLabel = (value, options = { day: "numeric", month: "long" }) =>
  value
    ? new Intl.DateTimeFormat("ru-RU", { ...options, timeZone: "UTC" }).format(
        new Date(`${String(value).slice(0, 10)}T12:00:00Z`),
      )
    : "Дата уточняется";
const sortLessons = (a, b) =>
  a.date.localeCompare(b.date) || a.start.localeCompare(b.start);

function escapeCalendar(value) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("\r", "")
    .replaceAll("\n", "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");
}

function foldCalendarLine(line) {
  const encoder = new TextEncoder();
  let result = "",
    current = "",
    length = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (length + size > 75) {
      result += `${current}\r\n`;
      current = " ";
      length = 1;
    }
    current += char;
    length += size;
  }
  return result + current;
}

function exportCalendar(lessons) {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Orbita Concept//Student Calendar//RU",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Курсом — демонстрационное расписание",
    "X-WR-TIMEZONE:Europe/Moscow",
  ];
  for (const lesson of lessons) {
    const utcTime = (time) =>
      new Date(`${lesson.date}T${time}:00+03:00`)
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}/, "");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeCalendar(lesson.id)}@demo.orbita`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${utcTime(lesson.start)}`,
      `DTEND:${utcTime(lesson.end)}`,
      `SUMMARY:${escapeCalendar(lesson.subject)}`,
      `LOCATION:${escapeCalendar([lesson.building, lesson.room].filter(Boolean).join(", "))}`,
      `DESCRIPTION:${escapeCalendar([lesson.type, `Преподаватель: ${lesson.teacher}`, lesson.changeNote, "Вымышленные данные. Концепт, не официальное расписание."].filter(Boolean).join("\n"))}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  const blob = new Blob([lines.map(foldCalendarLine).join("\r\n") + "\r\n"], {
    type: "text/calendar;charset=utf-8",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "orbita-demo-16-22-november.ics";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function Lesson({ lesson, number }) {
  return (
    <article
      className={`ac-lesson ${lesson.changed ? "ac-lesson-changed" : ""}`}
    >
      <div className="ac-lesson-time">
        <strong>{lesson.start}</strong>
        <span>{lesson.end}</span>
        <span className="ac-lesson-number">{number} пара</span>
      </div>
      <div className="ac-lesson-content">
        <div className="ac-lesson-top">
          <span className="ac-kind">{lesson.type}</span>
          {lesson.changed && (
            <span className="ac-change-badge">
              <Info size={13} aria-hidden="true" />
              Есть изменение
            </span>
          )}
        </div>
        <h3>{lesson.subject}</h3>
        <div className="ac-lesson-meta">
          <span>
            <UserRound size={15} aria-hidden="true" />
            {lesson.teacher}
          </span>
          <span>
            <MapPin size={15} aria-hidden="true" />
            {lesson.changed && lesson.originalRoom && (
              <>
                <s>{lesson.originalRoom}</s>
                <ArrowRight size={12} aria-hidden="true" />
              </>
            )}
            <strong>Ауд. {lesson.room}</strong>
            {lesson.building && (
              <span className="ac-building">· {lesson.building}</span>
            )}
          </span>
        </div>
        {lesson.changed && lesson.changeNote && (
          <p className="ac-change-note">{lesson.changeNote}</p>
        )}
      </div>
    </article>
  );
}

export function Schedule({ data, viewContext }) {
  const [view, setView] = useState("today");
  const [day, setDay] = useState(1);
  const [search, setSearch] = useState("");
  const [changedOnly, setChangedOnly] = useState(false);
  const [exported, setExported] = useState(false);
  useEffect(() => {
    setView(viewContext === "week" ? "week" : "today");
    setDay(
      /^day-[1-7]$/.test(viewContext || "") ? Number(viewContext.slice(-1)) : 1,
    );
    setSearch("");
    setChangedOnly(false);
  }, [viewContext]);
  const lessons = useMemo(
    () => [...(data.schedule || [])].sort(sortLessons),
    [data.schedule],
  );
  const lessonNumbers = useMemo(() => {
    const perDay = new Map();
    return new Map(
      lessons.map((lesson) => {
        const number = (perDay.get(lesson.day) || 0) + 1;
        perDay.set(lesson.day, number);
        return [lesson.id, number];
      }),
    );
  }, [lessons]);
  const filtered = lessons.filter(
    (lesson) =>
      (!changedOnly || lesson.changed) &&
      `${lesson.subject} ${lesson.teacher} ${lesson.room}`
        .toLocaleLowerCase("ru")
        .includes(search.toLocaleLowerCase("ru").trim()),
  );
  const dates = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${data.referenceDate || "2026-11-16"}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
  const visible =
    view === "today"
      ? filtered.filter((lesson) => lesson.day === day)
      : filtered;
  const changedCount = lessons.filter((lesson) => lesson.changed).length;

  return (
    <div className="ac-page">
      <div className="ac-page-top">
        <div>
          <p className="ac-eyebrow">Учёба в вашем ритме</p>
          <h1 className="page-heading">Расписание</h1>
          <p className="ac-subtitle">
            Демо-неделя · 16–22 ноября 2026 · время московское
          </p>
        </div>
        <button
          className="button secondary ac-export"
          disabled={!lessons.length}
          onClick={() => {
            exportCalendar(lessons);
            setExported(true);
          }}
        >
          <ArrowDownToLine size={17} aria-hidden="true" />
          Экспорт недели
        </button>
      </div>
      {exported && (
        <p className="ac-export-note" role="status">
          <Check size={16} aria-hidden="true" />
          Файл .ics подготовлен — его можно открыть в календаре.
        </p>
      )}
      {changedCount > 0 && (
        <div className="ac-schedule-notice">
          <span className="ac-notice-icon">
            <Info size={20} aria-hidden="true" />
          </span>
          <div>
            <strong>Перед парой — проверьте аудиторию</strong>
            <p>
              {changedCount === 1
                ? "В расписании есть одно изменение."
                : `Изменений в расписании: ${changedCount}.`}{" "}
              Обновлённые занятия выделены цветом.
            </p>
          </div>
          <button
            className="ac-text-button"
            onClick={() => {
              setChangedOnly(true);
              setView("week");
            }}
          >
            Показать
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      )}
      <section
        className="card ac-calendar"
        aria-label="Занятия на демонстрационной неделе"
      >
        <div className="ac-calendar-toolbar">
          <div className="ac-segmented" aria-label="Вид расписания">
            <button
              className={view === "today" ? "active" : ""}
              aria-pressed={view === "today"}
              onClick={() => {
                setView("today");
                setDay(1);
              }}
            >
              Сегодня в демо
            </button>
            <button
              className={view === "week" ? "active" : ""}
              aria-pressed={view === "week"}
              onClick={() => setView("week")}
            >
              Вся неделя
            </button>
          </div>
          <span className="ac-calendar-range">
            <CalendarDays size={16} aria-hidden="true" />
            16 — 22 ноября
          </span>
        </div>
        <div className="ac-weekdays" aria-label="День недели">
          {shortDays.map((label, index) => (
            <button
              key={label}
              className={
                view === "today" && day === index + 1 ? "selected" : ""
              }
              onClick={() => {
                setDay(index + 1);
                setView("today");
              }}
              aria-pressed={view === "today" && day === index + 1}
              aria-label={`${label} ${16 + index}, ${weekdays[index]}, ${dateLabel(dates[index])}`}
            >
              <span>{label}</span> <strong>{16 + index}</strong>
              <span
                className={`ac-day-dot ${lessons.some((lesson) => lesson.day === index + 1) ? "has-classes" : ""}`}
              />
            </button>
          ))}
        </div>
        <div className="ac-filters">
          <label className="ac-search">
            <Search size={17} aria-hidden="true" />
            <span className="ac-sr-only">
              Найти дисциплину, преподавателя или аудиторию
            </span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Дисциплина, преподаватель…"
              type="search"
            />
          </label>
          <button
            className={`ac-filter-button ${changedOnly ? "selected" : ""}`}
            aria-pressed={changedOnly}
            onClick={() => setChangedOnly(!changedOnly)}
          >
            <SlidersHorizontal size={16} aria-hidden="true" />
            Только изменения
            {changedOnly && <Check size={14} aria-hidden="true" />}
          </button>
        </div>
        <div className="ac-schedule-body" aria-live="polite">
          {visible.length === 0 ? (
            <div className="empty-state ac-empty">
              <span className="ac-empty-icon">
                <CalendarDays size={28} aria-hidden="true" />
              </span>
              <h2>
                {search || changedOnly
                  ? "По этим фильтрам занятий нет"
                  : "День без пар"}
              </h2>
              <p>
                {search || changedOnly
                  ? "Попробуйте другую дисциплину или снимите фильтр изменений."
                  : "Можно выдохнуть, подготовиться к семинару или заняться своими планами."}
              </p>
              {(search || changedOnly) && (
                <button
                  className="button secondary"
                  onClick={() => {
                    setSearch("");
                    setChangedOnly(false);
                  }}
                >
                  Сбросить фильтры
                </button>
              )}
            </div>
          ) : view === "today" ? (
            <>
              <div className="ac-day-title">
                <h2>{weekdays[day - 1]}</h2>
                <span>
                  {visible.length}{" "}
                  {visible.length === 1
                    ? "занятие"
                    : visible.length < 5
                      ? "занятия"
                      : "занятий"}
                </span>
              </div>
              <div className="ac-lessons">
                {visible.map((lesson) => (
                  <Lesson
                    key={lesson.id}
                    lesson={lesson}
                    number={lessonNumbers.get(lesson.id)}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="ac-week-list">
              {weekdays.map((label, index) => {
                const dayLessons = visible.filter(
                  (lesson) => lesson.day === index + 1,
                );
                return dayLessons.length ? (
                  <section key={label} className="ac-week-day">
                    <div className="ac-day-title">
                      <h2>{label}</h2>
                      <span>{dateLabel(dates[index])}</span>
                    </div>
                    <div className="ac-lessons">
                      {dayLessons.map((lesson) => (
                        <Lesson
                          key={lesson.id}
                          lesson={lesson}
                          number={lessonNumbers.get(lesson.id)}
                        />
                      ))}
                    </div>
                  </section>
                ) : null;
              })}
            </div>
          )}
        </div>
      </section>
      <p className="ac-footnote">
        <Info size={15} aria-hidden="true" />
        Расписание вымышленное. Экспорт содержит всю демонстрационную неделю.
      </p>
    </div>
  );
}

function ScoreRing({ score }) {
  const circumference = 2 * Math.PI * 37;
  return (
    <div className="ac-score-ring">
      <svg viewBox="0 0 88 88" aria-hidden="true">
        <circle cx="44" cy="44" r="37" className="ac-ring-track" />
        <circle
          cx="44"
          cy="44"
          r="37"
          className="ac-ring-value"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - score / 100)}
        />
      </svg>
      <span>
        <strong>{score}</strong>
        <small>из 100</small>
      </span>
    </div>
  );
}

function GradeCalculator({ grades }) {
  const [subjectId, setSubjectId] = useState(grades[0]?.id || "");
  const [examScore, setExamScore] = useState(85);
  const [goal, setGoal] = useState(85);
  const subject = grades.find((grade) => grade.id === subjectId) || grades[0];
  if (!subject) return null;
  const result = Math.round(subject.score * 0.6 + examScore * 0.4);
  const needed = Math.max(0, Math.ceil((goal - subject.score * 0.6) / 0.4));
  return (
    <section
      className="card ac-calculator"
      aria-labelledby="ac-calculator-heading"
    >
      <div className="ac-calculator-heading">
        <span className="ac-feature-icon">
          <Sparkles size={21} aria-hidden="true" />
        </span>
        <div>
          <span className="ac-eyebrow">Что, если…</span>
          <h2 id="ac-calculator-heading">План на хороший результат</h2>
        </div>
        <span className="ac-demo-label">Модель</span>
      </div>
      <p className="ac-calculator-intro">
        Посмотрите, как результат экзамена мог бы повлиять на итог.
      </p>
      <label className="ac-field">
        <span id="ac-calculator-subject-label">Дисциплина</span>
        <select
          aria-labelledby="ac-calculator-subject-label"
          value={subject.id}
          onChange={(event) => setSubjectId(event.target.value)}
        >
          {grades.map((grade) => (
            <option value={grade.id} key={grade.id}>
              {grade.subject}
            </option>
          ))}
        </select>
      </label>
      <div className="ac-range-label">
        <label htmlFor="ac-exam-score">Предполагаемый балл за экзамен</label>
        <output htmlFor="ac-exam-score">{examScore}</output>
      </div>
      <input
        className="ac-range"
        id="ac-exam-score"
        type="range"
        min="0"
        max="100"
        value={examScore}
        onChange={(event) => setExamScore(Number(event.target.value))}
      />
      <div className="ac-range-ends">
        <span>0</span>
        <span>100</span>
      </div>
      <div className="ac-calculator-result" aria-live="polite">
        <div>
          <span>Прогноз итога</span>
          <strong>
            {result}
            <small> / 100</small>
          </strong>
        </div>
        <span className="ac-result-formula">
          {subject.score} × 60%
          <br />+ {examScore} × 40%
        </span>
      </div>
      <label className="ac-goal-field">
        <span>Моя цель</span>
        <select
          value={goal}
          onChange={(event) => setGoal(Number(event.target.value))}
        >
          <option value={60}>60 баллов</option>
          <option value={75}>75 баллов</option>
          <option value={85}>85 баллов</option>
          <option value={90}>90 баллов</option>
        </select>
      </label>
      <p className="ac-goal-hint" aria-live="polite">
        {needed > 100 ? (
          "В этой модели одной оценки за экзамен недостаточно. Нужно улучшить семестровый результат."
        ) : needed === 0 ? (
          "В этой модели цель уже достигнута за счёт семестрового результата."
        ) : (
          <>
            Для цели нужно не менее <strong>{needed} баллов</strong> за экзамен.
          </>
        )}
      </p>
      <p className="ac-calculator-disclaimer">
        <Info size={14} aria-hidden="true" />
        Условная формула: текущий балл — 60%, экзамен — 40%. Это не правило
        вуза; реальные оценки не меняются.
      </p>
    </section>
  );
}

function assessmentLabel(grade) {
  if (grade.assessmentStatus === "pending" || !grade.assessmentStatus)
    return "Ещё не проходил";
  if (grade.assessment === "Зачёт")
    return grade.assessmentStatus === "passed" ? "Зачтено" : "Не зачтено";
  return (
    grade.assessmentResult ||
    (grade.assessmentStatus === "failed" ? "Не сдан" : "Сдан")
  );
}

export function Grades({ data, viewContext }) {
  const grades = data.grades || [];
  const [tab, setTab] = useState("subjects");
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState(null);
  useEffect(() => {
    setTab(viewContext === "session" ? "session" : "subjects");
    setFilter("all");
  }, [viewContext]);
  const credits = grades.reduce(
    (sum, grade) => sum + Number(grade.credits || 0),
    0,
  );
  const average = grades.length
    ? Math.round(
        credits > 0
          ? grades.reduce(
              (sum, grade) => sum + grade.score * grade.credits,
              0,
            ) / credits
          : grades.reduce((sum, grade) => sum + grade.score, 0) / grades.length,
      )
    : 0;
  const attendance = grades.length
    ? Math.round(
        grades.reduce((sum, grade) => sum + grade.attendance, 0) /
          grades.length,
      )
    : 0;
  const needsAttention = grades.filter((grade) => grade.score < 75);
  const visibleGrades = filter === "attention" ? needsAttention : grades;
  const session = [...grades].sort((a, b) =>
    (a.examDate || "").localeCompare(b.examDate || ""),
  );

  return (
    <div className="ac-page">
      <div className="ac-page-top">
        <div>
          <p className="ac-eyebrow">Большая цель — маленькие шаги</p>
          <h1 className="page-heading">Успеваемость</h1>
          <p className="ac-subtitle">
            {data.semester || "Осенний семестр 2026"} · демонстрационные данные
          </p>
        </div>
        <span className="ac-semester-badge">
          <GraduationCap size={17} aria-hidden="true" />
          {data.user?.year || 2} курс
        </span>
      </div>
      {!grades.length ? (
        <div className="card empty-state ac-empty">
          <BookOpen size={32} aria-hidden="true" />
          <h2>Оценок пока нет</h2>
          <p>
            Когда появятся результаты, здесь будет видна полная картина по
            дисциплинам.
          </p>
        </div>
      ) : (
        <>
          <div className="ac-grade-summary">
            <section className="card ac-summary-main">
              <ScoreRing score={average} />
              <div>
                <span className="ac-summary-label">Средневзвешенный балл</span>
                <h2>
                  {average >= 85
                    ? "Отличный темп!"
                    : average >= 70
                      ? "Вы на верном пути"
                      : "Двигаемся шаг за шагом"}
                </h2>
                <p>С учётом зачётных единиц дисциплин</p>
              </div>
            </section>
            <section className="card ac-summary-small">
              <span className="ac-summary-icon">
                <BookOpen size={20} aria-hidden="true" />
              </span>
              <span className="ac-summary-label">Дисциплины</span>
              <strong>
                {grades.length}
                <small>в семестре</small>
              </strong>
              <span className="ac-summary-caption">
                {credits} зачётных единиц
              </span>
            </section>
            <section className="card ac-summary-small">
              <span className="ac-summary-icon ac-icon-peach">
                <Check size={20} aria-hidden="true" />
              </span>
              <span className="ac-summary-label">Посещаемость</span>
              <strong>
                {attendance}
                <small>%</small>
              </strong>
              <span className="ac-summary-caption">Среднее по дисциплинам</span>
            </section>
          </div>
          <div className="ac-grades-layout">
            <section className="card ac-grade-list">
              <div className="ac-grades-toolbar">
                <div className="ac-segmented" aria-label="Раздел успеваемости">
                  <button
                    className={tab === "subjects" ? "active" : ""}
                    aria-pressed={tab === "subjects"}
                    onClick={() => setTab("subjects")}
                  >
                    Дисциплины
                  </button>
                  <button
                    className={tab === "session" ? "active" : ""}
                    aria-pressed={tab === "session"}
                    onClick={() => setTab("session")}
                  >
                    Сессия
                  </button>
                </div>
                <span className="ac-small-muted">Демо-семестр</span>
              </div>
              {tab === "subjects" ? (
                <>
                  <div className="ac-grade-filters">
                    <button
                      className={filter === "all" ? "active" : ""}
                      aria-pressed={filter === "all"}
                      onClick={() => setFilter("all")}
                    >
                      Все <span>{grades.length}</span>
                    </button>
                    <button
                      className={filter === "attention" ? "active" : ""}
                      aria-pressed={filter === "attention"}
                      onClick={() => setFilter("attention")}
                    >
                      Нужен фокус <span>{needsAttention.length}</span>
                    </button>
                  </div>
                  <div className="ac-grade-table-head">
                    <span>Дисциплина</span>
                    <span>Текущий балл · аттестация</span>
                  </div>
                  {!visibleGrades.length ? (
                    <div className="empty-state ac-empty">
                      <Check size={28} aria-hidden="true" />
                      <h2>Всё под контролем</h2>
                      <p>По всем дисциплинам у вас не менее 75 баллов.</p>
                    </div>
                  ) : (
                    visibleGrades.map((grade) => (
                      <article className="ac-grade-row" key={grade.id}>
                        <button
                          className="ac-grade-toggle"
                          onClick={() =>
                            setExpanded(expanded === grade.id ? null : grade.id)
                          }
                          aria-expanded={expanded === grade.id}
                          aria-controls={`ac-details-${grade.id}`}
                        >
                          <span
                            className={`ac-subject-symbol ${grade.score < 75 ? "ac-subject-attention" : ""}`}
                          >
                            <BookOpen size={19} aria-hidden="true" />
                          </span>
                          <span className="ac-grade-subject">
                            <strong>{grade.subject}</strong>
                            <span>
                              {grade.assessment} · {grade.credits} з. е.
                            </span>
                          </span>
                          <span className="ac-grade-score">
                            <strong
                              className={
                                grade.score < 75 ? "ac-score-attention" : ""
                              }
                            >
                              {grade.score}
                            </strong>
                            <span>{assessmentLabel(grade)}</span>
                          </span>
                          <ChevronDown
                            size={17}
                            className={
                              expanded === grade.id ? "ac-chevron-open" : ""
                            }
                            aria-hidden="true"
                          />
                        </button>
                        {expanded === grade.id && (
                          <div
                            className="ac-grade-details"
                            id={`ac-details-${grade.id}`}
                          >
                            <p className="ac-teacher">
                              <UserRound size={15} aria-hidden="true" />
                              {grade.teacher}
                            </p>
                            <p>
                              Форма контроля: {grade.assessment}. Результат
                              аттестации: {assessmentLabel(grade)}. Текущий балл
                              складывается из учебных работ и не означает сдачу
                              аттестации.
                            </p>
                            {(grade.components || []).map(
                              (component, index) => (
                                <div
                                  className="ac-component"
                                  key={`${component.label}-${index}`}
                                >
                                  <div>
                                    <span>{component.label}</span>
                                    <strong>
                                      {component.score} / {component.max}
                                    </strong>
                                  </div>
                                  <div className="ac-progress-track">
                                    <span
                                      style={{
                                        width: `${component.max ? Math.max(0, Math.min(100, (component.score / component.max) * 100)) : 0}%`,
                                      }}
                                    />
                                  </div>
                                </div>
                              ),
                            )}
                            <div className="ac-grade-detail-bottom">
                              <span>
                                Посещаемость:{" "}
                                <strong>{grade.attendance}%</strong>
                              </span>
                              <span>
                                <CalendarDays size={14} aria-hidden="true" />
                                {dateLabel(grade.examDate)}
                              </span>
                              {grade.trend !== 0 && (
                                <span
                                  className={
                                    grade.trend > 0 ? "ac-positive" : ""
                                  }
                                >
                                  <TrendingUp size={14} aria-hidden="true" />
                                  {grade.trend > 0 ? "+" : ""}
                                  {grade.trend} к прошлому срезу
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </article>
                    ))
                  )}
                  <p className="ac-list-footnote">
                    Нажмите на дисциплину, чтобы увидеть, из чего складывается
                    результат. «Нужен фокус» — балл ниже 75 в демо-модели.
                  </p>
                </>
              ) : (
                <>
                  <div className="ac-session-intro">
                    <CalendarDays size={22} aria-hidden="true" />
                    <div>
                      <strong>Сессия без сюрпризов</strong>
                      <p>Все демонстрационные аттестации — в одном списке.</p>
                    </div>
                  </div>
                  <div className="ac-session-list">
                    {session.map((grade) => (
                      <article className="ac-session-item" key={grade.id}>
                        <div className="ac-session-date">
                          <strong>
                            {grade.examDate
                              ? new Date(
                                  `${grade.examDate}T12:00:00Z`,
                                ).getUTCDate()
                              : "—"}
                          </strong>
                          <span>
                            {grade.examDate
                              ? dateLabel(grade.examDate, { month: "short" })
                              : "позже"}
                          </span>
                        </div>
                        <div>
                          <span className="ac-kind">{grade.assessment}</span>
                          <h3>{grade.subject}</h3>
                          <p>{grade.teacher}</p>
                        </div>
                        <span className="ac-session-score">
                          {grade.score}
                          <small>текущий балл</small>
                          <small>{assessmentLabel(grade)}</small>
                        </span>
                      </article>
                    ))}
                  </div>
                  <p className="ac-list-footnote">
                    <Info size={14} aria-hidden="true" />
                    Даты вымышленные. Время и аудитории экзаменов в прототипе не
                    назначены.
                  </p>
                </>
              )}
            </section>
            <GradeCalculator
              grades={grades.filter((grade) => grade.assessment === "Экзамен")}
            />
          </div>
        </>
      )}
    </div>
  );
}
