export const DEMO_WEEK_START = "2026-11-16";
export const DEMO_WEEK_END = "2026-11-22";
export const DEMO_WEEK_LABEL = "16–22 ноября 2026";
export const SCHEDULE_RANGE_LABEL = "16–29 ноября 2026";

const moscowCalendar = new Intl.DateTimeFormat("sv-SE", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Europe/Moscow",
});

export function moscowDate(instant = Date.now()) {
  return moscowClock(instant).date;
}

export function moscowClock(instant = Date.now()) {
  const parts = Object.fromEntries(
    moscowCalendar
      .formatToParts(instant)
      .map(({ type, value }) => [type, value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

export function addCalendarDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function relativeDate(query, today) {
  if (/послезавтра/.test(query)) return addCalendarDays(today, 2);
  if (/завтра/.test(query)) return addCalendarDays(today, 1);
  if (/вчера/.test(query)) return addCalendarDays(today, -1);
  return today;
}

export const demoWeekDates = Array.from({ length: 7 }, (_, index) =>
  addCalendarDays(DEMO_WEEK_START, index),
);

export const scheduleWeeks = [
  { context: "week", label: DEMO_WEEK_LABEL, dates: demoWeekDates },
  {
    context: "week-2",
    label: "23–29 ноября 2026",
    dates: demoWeekDates.map((date) => addCalendarDays(date, 7)),
  },
];

export function scheduleWeek(date) {
  return scheduleWeeks.find((week) => week.dates.includes(date));
}

export function defaultScheduleWeek(date) {
  return (
    scheduleWeek(date) ||
    (date < DEMO_WEEK_START ? scheduleWeeks[0] : scheduleWeeks.at(-1))
  );
}

export function scheduleContext(date) {
  const week = scheduleWeek(date);
  if (!week) return null;
  return week === scheduleWeeks[0]
    ? `day-${week.dates.indexOf(date) + 1}`
    : date;
}

export function scheduleDayFromContext(context) {
  if (/^day-[1-7]$/.test(context || ""))
    return demoWeekDates[Number(context.slice(-1)) - 1];
  return scheduleWeek(context) ? context : null;
}

export const lessonStatusLabels = {
  current: "Идёт сейчас",
  next: "Следующая пара",
  done: "Завершена",
};

export const scheduleEmptyLabels = {
  done: "Пары на сегодня закончились",
  empty: "Сегодня без пар",
  unavailable: "На сегодня нет расписания",
};

export function todaySchedule(schedule, { date, time }) {
  const lessons = schedule
    .filter((lesson) => lesson.date === date)
    .sort((a, b) => a.start.localeCompare(b.start));
  const current = lessons.find(
    (lesson) => lesson.start <= time && time < lesson.end,
  );
  const next = lessons.find((lesson) => lesson.start > time);
  const status = current
    ? "current"
    : next
      ? "next"
      : lessons.length
        ? "done"
        : scheduleWeek(date)
          ? "empty"
          : "unavailable";
  return {
    lessons,
    status,
    focus: current || next,
    next,
    lessonStatus(lesson) {
      if (lesson.date !== date) return null;
      if (lesson === current) return "current";
      if (lesson.end <= time) return "done";
      if (lesson === next) return "next";
      return null;
    },
  };
}

export function isOverdue(item, today) {
  return !item.completed && !!item.dueDate && item.dueDate < today;
}

export function calendarLabel(date, options = {}) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    ...options,
  }).format(new Date(`${date}T00:00:00Z`));
}
