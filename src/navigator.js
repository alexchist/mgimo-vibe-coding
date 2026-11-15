const normalize = (text) => text.toLocaleLowerCase("ru").replaceAll("ё", "е");
const dateLabel = (value, options = {}) =>
  new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    ...options,
  }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));

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
  const referenceDate = data.referenceDate || "2026-11-16";
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
  if (/сесси|экзам|зачет/.test(query)) {
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
        grade.examDate >= referenceDate &&
        (!/экзам/.test(query) || grade.assessment === "Экзамен") &&
        (!/зачет/.test(query) || grade.assessment === "Зачёт"),
    );
    const date = new Date(`${referenceDate}T12:00:00Z`);
    if (/послезавтра/.test(query)) date.setUTCDate(date.getUTCDate() + 2);
    else if (/завтра/.test(query)) date.setUTCDate(date.getUTCDate() + 1);
    const exactDay = /сегодня|завтра/.test(query)
      ? date.toISOString().slice(0, 10)
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
  if (/пар[аыуе]|расписан|заняти|аудитор|сегодня|завтра|преподав/.test(query)) {
    if (/следующ.*недел|прошл.*недел|вчера/.test(query))
      return {
        text: "Доступно только демонстрационное расписание 16–22 ноября 2026. Для других дат данных нет.",
        route: "schedule",
        focusId: "week",
        action: "Открыть демо-неделю",
      };
    const days = [
      /понедельник/,
      /вторник/,
      /сред[ауеы]/,
      /четверг/,
      /пятниц/,
      /суббот/,
      /воскресен/,
    ];
    const namedDay = days.findIndex((expression) => expression.test(query));
    if (/недел/.test(query) && namedDay < 0)
      return {
        text: `В демонстрационной неделе 16–22 ноября занятий: ${(data.schedule || []).length}. Изменений: ${(data.schedule || []).filter((item) => item.changed).length}.`,
        route: "schedule",
        focusId: "week",
        action: "Открыть расписание",
      };
    const offset =
      namedDay >= 0
        ? namedDay
        : /послезавтра/.test(query)
          ? 2
          : /завтра/.test(query)
            ? 1
            : 0;
    const date = new Date(`${referenceDate}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    const selectedDate = date.toISOString().slice(0, 10);
    const lessons = (data.schedule || [])
      .filter((item) => item.date === selectedDate)
      .sort((a, b) => a.start.localeCompare(b.start));
    const changed = lessons.find((item) => item.changed);
    return {
      text: `${dateLabel(selectedDate, { weekday: "long" })}: ${lessons.length ? `занятий — ${lessons.length}. Первое — «${lessons[0].subject}» в ${lessons[0].start}, аудитория ${lessons[0].room}.` : "занятий нет."}${changed ? ` Изменение: «${changed.subject}», аудитория ${changed.room}. ${changed.changeNote || ""}` : ""} «Сегодня» в демо — 16 ноября, «завтра» — 17 ноября 2026.`,
      route: "schedule",
      focusId: `day-${offset + 1}`,
      action: "Открыть расписание",
    };
  }
  if (/оцен|успева|балл/.test(query)) {
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
  if (/дедлайн|срок|успеть|план|ближай|задан/.test(query)) {
    const deadline = [...(data.deadlines || [])]
      .filter((item) => item.date >= referenceDate)
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    return deadline
      ? {
          text: `Ближайший учебный срок: «${deadline.title}»${deadline.subject ? ` по предмету «${deadline.subject}»` : ""}, ${dateLabel(deadline.date)}. ${data.plan?.items.find((item) => item.id === deadline.id)?.completed ? "Вы уже отметили личную готовность." : "Подготовку можно отметить в личном плане."} Личная отметка не означает сдачу работы.`,
          route: "plan",
          focusId: deadline.id,
          action: "Открыть дело в плане",
        }
      : {
          text: "Ближайших учебных дедлайнов в демо-данных нет. Свои задачи можно посмотреть в плане.",
          route: "plan",
          action: "Открыть мой план",
        };
  }
  if (/данн|профил|безопас|парол|почт|групп/.test(query))
    return {
      text: `Вы вошли как ${data.user.firstName} ${data.user.lastName}, группа ${data.user.group}. Это вымышленный аккаунт, доступ к нему опубликован для жюри — не вводите настоящую личную информацию.`,
      route: "profile",
      action: "Мой профиль",
    };
  return {
    text: "Я могу подсказать расписание демо-недели, текущие баллы, даты аттестаций, учебные сроки и порядок заказа документов. Уточните вопрос или выберите пример. Внешняя нейросеть не используется; официальных ответов университета здесь нет.",
    route: null,
    action: null,
  };
}
