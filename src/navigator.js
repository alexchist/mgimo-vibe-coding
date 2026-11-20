import {
  calendarLabel as dateLabel,
  addCalendarDays,
  defaultScheduleWeek,
  isOverdue,
  lessonStatusLabels,
  moscowClock,
  relativeDate,
  SCHEDULE_RANGE_LABEL,
  scheduleContext,
  scheduleEmptyLabels,
  scheduleWeek,
  todaySchedule,
} from "./calendar.js";

const normalize = (text) => text.toLocaleLowerCase("ru").replaceAll("ё", "е");
const weekdays = [
  /понедельник/,
  /вторник/,
  /сред[ауеы]/,
  /четверг/,
  /пятниц/,
  /суббот/,
  /воскресен/,
];
const months = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];
const writtenDate = new RegExp(
  `(?:^|[^0-9])(\\d{1,2})\\s+(${months.join("|")})(?:\\s+(20\\d{2}))?(?![а-я0-9])`,
);

export function explicitCalendarDate(query, today) {
  const iso = query.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const day = query.match(writtenDate);
  if (!day) return null;
  const month = String(months.indexOf(day[2]) + 1).padStart(2, "0");
  return `${day[3] || today.slice(0, 4)}-${month}-${day[1].padStart(2, "0")}`;
}

export const scheduleQuestion =
  /расписан|(?:^|[^а-я])пар(?:а|ы|у|е|ой|ах)?(?=$|[^а-я])|заняти|аудитор|где\s+теперь.*практик/;

// Definitions and requests for study advice do not require account records.
const generalStudyQuestion =
  /(?:^|\s)(?:что такое|что значит|что означает|кто так(?:ой|ая)|чем отличается|какие бывают|как (?:мне )?(?:подготовиться|готовиться|составить|спланировать|написать|улучшить|повысить|стать)|(?:составь|придумай|предложи|напиши|реши)(?:те)?|(?:объясни|разбери)(?:те)? (?:мне )?(?:задачу|задание|тему)|помоги(?:те)? (?:мне )?(?:составить|подготовиться|написать))(?:\s|[!?,.]|$)/;

// Requests for a method or calculation are general unless the user asks us
// to use their own records (for example, «посчитай мой средний балл»).
const calculationQuestion =
  /(?:^|\s)(?:как (?:можно |мне )?(?:вычислить|рассчитать|посчитать|измерить|определить)|(?:вычисли|рассчитай|посчитай|измерь|определи)(?:те)?)(?=\s|$)/;
const ownRecord =
  /(?:^|\s)(?:у меня|мо(?:й|я|и|ю|е|ем|ей|их|им|его|ему|ими)|сво(?:й|я|и|ю|е|ем|ей|их|им|его|ему|ими))(?=\s|[?.!]|$)/;

export function isGeneralStudyQuestion(text) {
  const query = normalize(text);
  return (
    generalStudyQuestion.test(query) ||
    (calculationQuestion.test(query) && !ownRecord.test(query))
  );
}

export function isScheduleQuestion(text) {
  const query = normalize(text).trim();
  if (isGeneralStudyQuestion(query)) return false;
  return (
    scheduleQuestion.test(query) ||
    /^(?:(?:а |и )?(?:что |какие предметы |что у меня |что у нас )?(?:на )?(?:сегодня|завтра|послезавтра|вчера))[?!.\s]*$/.test(
      query,
    )
  );
}

export function isTeacherQuestion(text) {
  const query = normalize(text).trim();
  if (isGeneralStudyQuestion(query)) return false;
  if (
    /(?:кто|что|какой предмет|какую дисциплину).*?(?:ведет|ведут|преподает|преподают|читает|читают)|кто (?:у меня |у нас )?по /.test(
      query,
    )
  )
    return true;
  const role = /преподавател|учител|лектор|(?:^|\s)препод(?=$|[\s?!])/;
  return (
    role.test(query) &&
    /фамили|как зовут|имя|фио|(?:^|\s)(?:кто|какой|какая|назови|напомни|подскажи)|^(?:наш |мой )?(?:препод|учител|лектор)/.test(
      query,
    )
  );
}

export function isAcademicRecordQuestion(text) {
  const query = normalize(text);
  if (isGeneralStudyQuestion(query)) return false;
  if (
    /сесси|экзам|зачет|оцен[кочи]|успеваем|балл|дедлайн|просроч|(?:^|[^а-я])план(?:а|е|ы|у|ом)?(?=$|[^а-я])|ближайш.*(?:дело|дела)/.test(
      query,
    )
  )
    return true;
  return (
    /срок|успеть|задани|задач/.test(query) &&
    /у меня|(?:^|\s)мо(?:й|и|я|е|их|ей)(?:\s|$)|учебн|ближайш|на (?:сегодня|завтра)|покажи|список|когда (?:сдавать|сдать)|что .*успеть/.test(
      query,
    )
  );
}

export function scheduleSelection(message, today) {
  const query = normalize(message);
  const date = explicitCalendarDate(query, today);
  if (date)
    return /недел|\d\s*[–—-]\s*\d{1,2}\s+[а-я]/.test(query)
      ? { weekDate: date }
      : { date };
  if (/сегодня|завтра|вчера/.test(query))
    return { date: relativeDate(query, today) };

  const nextWeek =
    /(?:следующ|будущ)[а-я]*\s+(?:учебн[а-я]*\s+)?недел|через\s+(?:одну\s+)?недел/;
  const lastWeek =
    /(?:прошл|предыдущ|минувш)[а-я]*\s+(?:учебн[а-я]*\s+)?недел|недел[а-я]*\s+назад/;
  const weekOffset = nextWeek.test(query) ? 7 : lastWeek.test(query) ? -7 : 0;
  const weekday = weekdays.findIndex((expression) => expression.test(query));
  if (weekday >= 0) {
    const indexToday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
    return { date: addCalendarDays(today, weekday - indexToday + weekOffset) };
  }
  if (/недел/.test(query))
    return { weekDate: addCalendarDays(today, weekOffset) };
  return null;
}

function unavailableSchedule(date, weekDate, today) {
  const instant = date && new Date(`${date}T00:00:00Z`);
  const displayDate =
    instant &&
    Number.isFinite(+instant) &&
    instant.toISOString().startsWith(date)
      ? dateLabel(date)
      : date;
  const heading =
    date === today
      ? scheduleEmptyLabels.unavailable
      : date
        ? `На ${displayDate} расписания нет`
        : "Для этой недели данных расписания нет";
  return {
    text: `${heading}. Демо-расписание доступно на ${SCHEDULE_RANGE_LABEL}.`,
    route: "schedule",
    focusId: defaultScheduleWeek(date || weekDate || today).context,
    action: "Открыть демо-неделю",
  };
}

function lessonLine(lesson) {
  const change =
    lesson.changed && lesson.changeNote
      ? ` Изменение: ${lesson.changeNote}`
      : "";
  return `${lesson.start}–${lesson.end} — ${lesson.subject}, аудитория ${lesson.room}, ${lesson.teacher}.${change}`;
}

export function navigatorSchedule(
  schedule,
  clock,
  { date, weekDate, changesOnly, focusOnly, nextOnly } = {},
) {
  const week = scheduleWeek(date || weekDate || clock.date);
  if (!week && (date || weekDate))
    return unavailableSchedule(date, weekDate, clock.date);
  const selectedWeek = week || defaultScheduleWeek(clock.date);
  const lessons = schedule
    .filter(
      (lesson) =>
        (date
          ? lesson.date === date
          : selectedWeek.dates.includes(lesson.date)) &&
        (!changesOnly || lesson.changed),
    )
    .sort(
      (a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start),
    );
  const title = date
    ? dateLabel(date, { weekday: "long" })
    : `Демо-неделя ${selectedWeek.label}`;
  const day =
    date === clock.date && !changesOnly ? todaySchedule(schedule, clock) : null;
  const summaryLesson = nextOnly ? day?.next : day?.focus;
  const summaryStatus = nextOnly && summaryLesson ? "next" : day?.status;
  const summary =
    day &&
    (summaryLesson
      ? `${lessonStatusLabels[summaryStatus]} · ${lessonLine(summaryLesson)}`
      : day.status === "current"
        ? "Идёт последняя пара. Следующих пар сегодня нет."
        : `${scheduleEmptyLabels[day.status]}.`);
  const lines = lessons
    .filter((lesson) => lesson !== day?.focus)
    .map((lesson) =>
      date
        ? lessonLine(lesson)
        : `${dateLabel(lesson.date)} · ${lessonLine(lesson)}`,
    );
  const detail =
    summary && (focusOnly || !lines.length)
      ? summary
      : lines.length
        ? [summary, ...lines].filter(Boolean).join("\n")
        : changesOnly
          ? "Изменений расписания нет."
          : "Занятий нет.";
  return {
    text: `${title}. ${detail}\nВремя московское.`,
    route: "schedule",
    focusId: date ? scheduleContext(date) : selectedWeek.context,
    action: "Открыть расписание",
  };
}

export function navigatorScheduleQuery(message, schedule, clock) {
  const query = normalize(message);
  const selection = scheduleSelection(query, clock.date);
  const changesOnly =
    /перенос|перенес|смен[а-я]*\s+аудитор|измен[а-я]*\s+(?:в\s+)?расписан|где\s+теперь/.test(
      query,
    );
  const focusOnly = /сейчас|ближайш|следующ/.test(query);
  const nextOnly = !/сейчас/.test(query) && /ближайш|следующ/.test(query);
  return navigatorSchedule(schedule, clock, {
    ...(selection || (changesOnly ? {} : { date: clock.date })),
    changesOnly,
    focusOnly,
    nextOnly,
  });
}

// Compare inflected subject names and surnames to the actual records in this account.
// Requiring every requested term avoids substituting political for physical geography.
function nameTerms(value) {
  return (normalize(value).match(/[а-яa-z]+/g) || []).map((word) =>
    word.replace(
      /(?:иями|иям|иях|ием|ией|ого|его|ому|ему|ыми|ими|ым|им|ая|яя|ое|ее|ые|ий|ый|ой|ую|юю|ых|их|ия|ию|ии|ие|ья|ью|ьи|ей|ам|ям|ом|ем|ах|ях|[аяыиуеюоь])$/,
      "",
    ),
  );
}

const teacherQuestionWords = new Set(
  (
    "а и в из на по у мне меня нас мой моя мои моего моему как кто что какой какая какое каких какие какую чья " +
    "имя отчество фио зовут звать ведет ведут читает читают пожалуйста курс пара пару пары занятия лекции"
  ).split(" "),
);
const teacherQuestionForms =
  /^(?:фамили[а-я]*|наш[а-я]*|препод[а-я]*|учител[а-я]*|лектор[а-я]*|предмет[а-я]*|дисциплин[а-я]*|(?:назови|скажи|подскажи|напомни)(?:те)?)$/;

function teacherAnswer(query, data) {
  const requested = (query.match(/[а-яa-z]+/g) || []).filter(
    (word) =>
      !teacherQuestionWords.has(word) && !teacherQuestionForms.test(word),
  );
  const terms = nameTerms(requested.join(" "));
  const courses = new Map();
  for (const record of [...(data.grades || []), ...(data.schedule || [])]) {
    if (!record.subject || !record.teacher) continue;
    const key = normalize(record.subject) + "\n" + normalize(record.teacher);
    if (!courses.has(key)) courses.set(key, record);
  }
  const matches = terms.length
    ? [...courses.values()].filter((record) => {
        const names = nameTerms(`${record.subject} ${record.teacher}`);
        return terms.every((term) => names.includes(term));
      })
    : [];
  if (matches.length === 1) {
    const match = matches[0];
    const lesson = (data.schedule || []).includes(match);
    return {
      text: `«${match.subject}» — ${match.teacher}.`,
      route: lesson ? "schedule" : "grades",
      focusId: lesson ? `lesson-${match.id}` : match.id,
      action: lesson ? "Открыть занятие" : "Открыть дисциплину",
    };
  }
  return {
    text: matches.length
      ? `Есть несколько совпадений. Уточните дисциплину или фамилию:\n${matches.map(({ subject, teacher }) => `«${subject}» — ${teacher}`).join("\n")}.`
      : terms.length
        ? "В дисциплинах и расписании вашего аккаунта такого совпадения нет. Уточните название предмета или фамилию преподавателя."
        : "По какой дисциплине найти преподавателя? Можно также указать фамилию.",
    route: "grades",
    action: "Посмотреть дисциплины",
  };
}

function selectSubject(query, grades) {
  const words = query.match(/[а-яa-z]+/g) || [];
  const ranked = grades
    .map((grade) => ({
      grade,
      score: (normalize(grade.subject).match(/[а-яa-z]+/g) || [])
        .filter((word) => word.length >= 4 && word !== "язык")
        .filter((word) =>
          words.some(
            (part) => part.length >= 4 && part.slice(0, 4) === word.slice(0, 4),
          ),
        ).length,
    }))
    .sort((a, b) => b.score - a.score);
  if (ranked[0]?.score && ranked[0].score > (ranked[1]?.score || 0))
    return ranked[0].grade;
  return null;
}

export function navigatorAnswer(text, data) {
  const query = normalize(text);
  const clock = data.clock || moscowClock();
  const todayDate = data.todayDate || clock.date;
  // Specific service intents must precede generic words such as «срок».
  if (/справ|заяв|документ|деканат|стипенд/.test(query)) {
    const requests = (data.requests || []).filter((item) => !item.archived);
    const ready = requests.filter((item) => item.status === "ready");
    const active = requests.filter((item) => item.status !== "ready");
    const creating = /заказ|оформ|подать|получить/.test(query);
    const timing = /срок|сколько|долго|изготов|когда/.test(query);
    return {
      text: `${timing ? "Демонстрационный срок изготовления — 3 рабочих дня после подачи заявки. Ориентировочная дата указана в её карточке. " : "Выберите тип документа, укажите цель и отправьте заявку. "}Готовых документов: ${ready.length}, заявок в работе: ${active.length}. В карточке доступны история и статус. Демо-заявки не уходят в настоящий деканат.`,
      route: "requests",
      focusId: !creating && ready.length ? ready[0].id : undefined,
      action:
        !creating && ready.length
          ? "Посмотреть готовый документ"
          : "Открыть заявки",
    };
  }
  if (isTeacherQuestion(query)) return teacherAnswer(query, data);
  const academic = isAcademicRecordQuestion(query);
  if (academic && /сесси|экзам|зачет/.test(query)) {
    const grades = data.grades || [];
    const subject = selectSubject(query, grades);
    const subjectSpecified =
      /(?:^|\s)по\s|англ|язык|истор|прав|географ|эконом|финанс/.test(query);
    if (subjectSpecified && !subject)
      return {
        text: "Уточните полное название дисциплины из раздела «Успеваемость»: я не смог однозначно определить предмет. Не буду подставлять другой экзамен.",
        route: "grades",
        focusId: "session",
        action: "Посмотреть сессию",
      };
    const assessments = grades.filter(
      (grade) =>
        (!subject || grade.id === subject.id) &&
        grade.examDate &&
        grade.examDate >= todayDate &&
        (!/экзам/.test(query) || grade.assessment === "Экзамен") &&
        (!/зачет/.test(query) || grade.assessment === "Зачёт"),
    );
    const exactDay = /сегодня|завтра|вчера/.test(query)
      ? relativeDate(query, todayDate)
      : null;
    const next = assessments
      .filter((grade) => !exactDay || grade.examDate === exactDay)
      .sort((a, b) => a.examDate.localeCompare(b.examDate))[0];
    return {
      text: next
        ? `${subject ? "Аттестация по выбранной дисциплине" : "Ближайшая аттестация"}: «${next.subject}» — ${next.assessment.toLowerCase()}, ${dateLabel(next.examDate)}. Текущий балл: ${next.score} из 100; он не означает сдачу аттестации. Все даты вымышлены.`
        : `Подходящих экзаменов или зачётов${subject ? ` по дисциплине «${subject.subject}»` : ""}${exactDay ? ` на ${dateLabel(exactDay)}` : ""} в демо-данных нет. Доступные аттестации перечислены в сессии.`,
      route: "grades",
      focusId: "session",
      action: "Посмотреть сессию",
    };
  }
  if (isScheduleQuestion(query))
    return navigatorScheduleQuery(text, data.schedule || [], {
      ...clock,
      date: todayDate,
    });
  if (academic && /оцен|успева|балл/.test(query)) {
    const grades = data.grades || [];
    const focus = [...grades].sort((a, b) => a.score - b.score)[0];
    return {
      text: grades.length
        ? `Средний результат по ${grades.length} дисциплинам — ${Math.round(grades.reduce((sum, grade) => sum + grade.score, 0) / grades.length)} из 100 (простое среднее). Больше всего внимания просит «${focus.subject}»: ${focus.score} баллов. Текущий балл и результат аттестации показаны отдельно.`
        : "Оценок пока нет. Когда они появятся, здесь будет понятная картина успеваемости.",
      route: "grades",
      action: "Разобраться с оценками",
    };
  }
  if (academic) {
    const planItems =
      data.plan?.items ||
      (data.deadlines || []).map((item) => ({
        ...item,
        kind: "deadline",
        dueDate: item.date,
      }));
    const overdueOnly = /просроч|срок.*прош/.test(query);
    const academicOnly = /дедлайн|учебн/.test(query);
    const eligible = planItems.filter(
      (item) =>
        !item.completed &&
        item.dueDate &&
        (!academicOnly || item.kind === "deadline"),
    );
    const overdue = eligible.filter((item) => isOverdue(item, todayDate));
    const deadline = (
      overdueOnly
        ? overdue
        : eligible.filter((item) => item.dueDate >= todayDate)
    ).sort(
      (a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id),
    )[0];
    return {
      text: deadline
        ? `${overdueOnly ? "Просрочено" : deadline.kind === "deadline" ? "Ближайший учебный срок" : "Ближайшее дело"}: «${deadline.title}»${deadline.subject ? ` по предмету «${deadline.subject}»` : ""}, ${dateLabel(deadline.dueDate)}. ${deadline.kind === "deadline" ? "Личная отметка не означает сдачу работы." : ""}`.trim()
        : overdueOnly
          ? "Просроченных открытых дел нет."
          : `Ближайших ${academicOnly ? "учебных дедлайнов" : "дел со сроком"} в плане нет.` +
            (overdue.length ? ` Просрочено дел: ${overdue.length}.` : ""),
      route: "plan",
      focusId: deadline?.id,
      action: deadline ? "Открыть дело в плане" : "Открыть мой план",
    };
  }
  if (/данн|профил|безопас|парол|почт|групп/.test(query))
    return {
      text: `Вы вошли как ${data.user.firstName} ${data.user.lastName}, группа ${data.user.group}. Это вымышленный аккаунт, доступ к нему опубликован для жюри — не вводите настоящую личную информацию.`,
      route: "profile",
      action: "Мой профиль",
    };
  return {
    text: "Я могу подсказать демо-расписание, текущие баллы, даты аттестаций, учебные сроки и порядок заказа документов. Уточните вопрос или выберите пример. Внешняя нейросеть не используется; официальных ответов университета здесь нет.",
    route: null,
    action: null,
  };
}
