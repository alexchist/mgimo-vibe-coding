// All identities, schedules and records in this fixture are fictional.
export const REFERENCE_DATE = "2026-11-16";
export const SEMESTER = "Осенний семестр 2026";

const students = [
  {
    id: "student-alisa",
    firstName: "Алиса",
    lastName: "Миронова",
    middleName: "Андреевна",
    fullName: "Миронова Алиса Андреевна",
    initials: "АМ",
    faculty: "Международные отношения",
    program: "Международные отношения",
    year: 2,
    group: "МО-24-03",
    email: "alisa@demo.orbita",
    studentNumber: "DEMO-2024-0142",
    avatarColor: "#147d73",
    passwordHash:
      "scrypt:orbita-demo-alisa-v1:fc48487262107cd74df64ff1ee50efc54cba32b19da49b84a097cb4928e85d21be1c0e33adad77a8a22c92c90aca05f4bec2b1d6f25db88c474d0cd23ad74a9f",
  },
  {
    id: "student-mark",
    firstName: "Марк",
    lastName: "Ветров",
    middleName: "Ильич",
    fullName: "Ветров Марк Ильич",
    initials: "МВ",
    faculty: "Международные экономические отношения",
    program: "Мировая экономика",
    year: 3,
    group: "МЭО-23-02",
    email: "mark@demo.orbita",
    studentNumber: "DEMO-2023-0286",
    avatarColor: "#b76a3c",
    passwordHash:
      "scrypt:orbita-demo-mark-v1:d829fd84452649b6553e92b85c8148d0aae327cf3807e29c315d0e761e068538d1d19b8aa3a50207102a194980586df7143d15af62ab442d0f57df37d1082984",
  },
];

const catalog = [
  [
    "История международных отношений",
    "Вера Лисовская",
    92,
    96,
    "Экзамен",
    "2026-12-15",
    "#147d73",
  ],
  [
    "Английский язык",
    "Даниил Леснев",
    88,
    100,
    "Экзамен",
    "2026-12-18",
    "#6f65ab",
  ],
  [
    "Международное право",
    "Аркадий Светлов",
    84,
    92,
    "Экзамен",
    "2026-12-22",
    "#b77947",
  ],
  [
    "Политическая география",
    "Есения Радова",
    95,
    100,
    "Зачёт",
    "2026-12-11",
    "#52927e",
  ],
  [
    "Экономическая теория",
    "Мирон Вельский",
    76,
    88,
    "Экзамен",
    "2026-12-24",
    "#b76a3c",
  ],
  [
    "Второй иностранный язык",
    "Лада Зорина",
    90,
    96,
    "Зачёт",
    "2026-12-10",
    "#667fa5",
  ],
];

function scheduleFor(student, index) {
  const rows = [
    [1, "09:00", "10:20", 0, "Лекция", "314", false],
    [1, "10:35", "11:55", 1, "Практика", "215", true],
    [1, "12:25", "13:45", 2, "Семинар", "402", false],
    [2, "09:00", "10:20", 4, "Лекция", "А-12", false],
    [2, "10:35", "11:55", 5, "Практика", "318", false],
    [2, "12:25", "13:45", 3, "Семинар", "210", false],
    [3, "10:35", "11:55", 0, "Семинар", "314", false],
    [3, "12:25", "13:45", 1, "Практика", "215", false],
    [4, "09:00", "10:20", 2, "Лекция", "А-08", false],
    [4, "10:35", "11:55", 4, "Семинар", "409", false],
    [4, "14:00", "15:20", 5, "Практика", "318", false],
    [5, "10:35", "11:55", 3, "Лекция", "210", false],
    [5, "12:25", "13:45", 1, "Практика", "215", false],
  ];
  return rows.map(([day, start, end, course, type, room, changed], i) => ({
    id: `${student.id}-lesson-${i + 1}`,
    day,
    date: `2026-11-${15 + day}`,
    start,
    end,
    subject:
      index === 1 && course === 0
        ? "Мировые финансовые рынки"
        : catalog[course][0],
    type,
    teacher: catalog[course][1],
    room: index ? `${Number.parseInt(room, 10) || 110}Б` : room,
    building: "Главный корпус",
    color: catalog[course][6],
    changed,
    changeNote: changed
      ? "Занятие перенесено из аудитории 208. Время не изменилось."
      : "",
    originalRoom: changed ? "208" : "",
  }));
}

function gradesFor(student, index) {
  return catalog.map(
    ([subject, teacher, base, attendance, assessment, examDate], i) => {
      const score = base - (index ? 9 + (i % 3) : 0);
      const seminar = Math.round(score * 0.4);
      const test = Math.round(score * 0.35);
      return {
        id: `${student.id}-course-${i + 1}`,
        subject: index === 1 && i === 0 ? "Мировые финансовые рынки" : subject,
        teacher,
        score,
        grade:
          score >= 86
            ? "Отлично"
            : score >= 71
              ? "Хорошо"
              : "Удовлетворительно",
        credits: i === 1 ? 6 : i === 5 ? 3 : 4,
        attendance: attendance - (index ? 8 : 0),
        examDate,
        assessment,
        trend: [6, 4, 3, 2, -2, 5][i],
        components: [
          { label: "Семинары", score: seminar, max: 40 },
          { label: "Контрольные работы", score: test, max: 35 },
          { label: "Проект", score: score - seminar - test, max: 25 },
        ],
      };
    },
  );
}

function requestsFor(student, index) {
  return [
    {
      id: `${student.id}-request-ready`,
      number: `ОРБ-${index ? "0201" : "0101"}`,
      type: "enrollment",
      purpose: "Для предоставления по месту требования",
      comment: "",
      status: "ready",
      createdAt: "2026-11-12T09:00:00.000Z",
      updatedAt: "2026-11-13T10:30:00.000Z",
      estimatedDate: "2026-11-16",
      history: [
        {
          status: "submitted",
          at: "2026-11-12T09:00:00.000Z",
          text: "Демонстрационная заявка принята",
        },
        {
          status: "processing",
          at: "2026-11-12T12:15:00.000Z",
          text: "Макет справки готовится",
        },
        {
          status: "ready",
          at: "2026-11-13T10:30:00.000Z",
          text: "Демонстрационный документ готов к скачиванию",
        },
      ],
    },
    {
      id: `${student.id}-request-processing`,
      number: `ОРБ-${index ? "0202" : "0102"}`,
      type: index ? "transcript" : "scholarship",
      purpose: index
        ? "Для личного портфолио"
        : "Для оформления учебного гранта",
      comment: "",
      status: "processing",
      createdAt: "2026-11-13T11:00:00.000Z",
      updatedAt: "2026-11-13T13:00:00.000Z",
      estimatedDate: "2026-11-18",
      history: [
        {
          status: "submitted",
          at: "2026-11-13T11:00:00.000Z",
          text: "Демонстрационная заявка принята",
        },
        {
          status: "processing",
          at: "2026-11-13T13:00:00.000Z",
          text: "Макет документа готовится",
        },
      ],
    },
    {
      id: `${student.id}-request-submitted`,
      number: `ОРБ-${index ? "0203" : "0103"}`,
      type: "transcript",
      purpose: "Для участия в программе обмена",
      comment: "Данные вымышлены.",
      status: "submitted",
      createdAt: "2026-11-14T08:00:00.000Z",
      updatedAt: "2026-11-14T08:00:00.000Z",
      estimatedDate: "2026-11-19",
      history: [
        {
          status: "submitted",
          at: "2026-11-14T08:00:00.000Z",
          text: "Демонстрационная заявка принята",
        },
      ],
    },
  ];
}

function notificationsFor(student) {
  return [
    {
      id: `${student.id}-notice-1`,
      title: "Английский — в другой аудитории",
      body: "В понедельник, 16 ноября, занятие в 10:35 пройдёт в аудитории 215 вместо 208. Время прежнее.",
      category: "schedule",
      createdAt: "2026-11-14T10:00:00.000Z",
      read: false,
      route: "schedule",
    },
    {
      id: `${student.id}-notice-2`,
      title: "Ваша справка готова",
      body: "Демонстрационную справку об обучении можно скачать в разделе «Заявки и справки».",
      category: "request",
      createdAt: "2026-11-13T10:30:00.000Z",
      read: false,
      route: "requests",
    },
    {
      id: `${student.id}-notice-3`,
      title: "Эссе — до вторника",
      body: "Загрузите учебное эссе по истории международных отношений до 17 ноября. Это напоминание о вымышленном задании.",
      category: "deadline",
      createdAt: "2026-11-13T09:00:00.000Z",
      read: false,
      route: "grades",
    },
    {
      id: `${student.id}-notice-4`,
      title: "Неделя международного диалога",
      body: "В демонстрационном кампусе запланирована встреча студенческих клубов. Подробности появятся в ленте новостей.",
      category: "news",
      createdAt: "2026-11-12T12:00:00.000Z",
      read: true,
      route: "schedule",
    },
    {
      id: `${student.id}-notice-5`,
      title: "Расписание сессии опубликовано",
      body: "Даты учебных экзаменов и зачётов доступны в разделе «Успеваемость». Планируйте подготовку заранее.",
      category: "news",
      createdAt: "2026-11-11T09:00:00.000Z",
      read: true,
      route: "grades",
    },
  ];
}

export function seedDatabase(db) {
  if (db.prepare("SELECT COUNT(*) AS n FROM users").get().n > 0) return;
  const addUser = db.prepare(
    "INSERT INTO users (id, login, password_hash, profile_json) VALUES (?, ?, ?, ?)",
  );
  const addRecord = db.prepare(
    "INSERT INTO records (id, user_id, kind, payload_json) VALUES (?, ?, ?, ?)",
  );
  db.exec("BEGIN IMMEDIATE");
  try {
    students.forEach((student, index) => {
      const { passwordHash, ...profile } = student;
      addUser.run(
        profile.id,
        profile.email,
        passwordHash,
        JSON.stringify(profile),
      );
      const notices = notificationsFor(student);
      if (index) {
        notices[0].body = notices[0].body.replace("215", "215Б");
        notices[2].title = "Аналитическая записка — до вторника";
        notices[2].body =
          "Подготовьте аналитическую записку по мировым финансовым рынкам до 17 ноября. Это вымышленное учебное задание.";
      }
      const records = {
        schedule: scheduleFor(student, index),
        grades: gradesFor(student, index),
        requests: requestsFor(student, index),
        notifications: notices,
        deadlines: [
          {
            id: `${student.id}-deadline-1`,
            title: index
              ? "Аналитическая записка"
              : "Эссе о международном диалоге",
            subject: index
              ? "Мировые финансовые рынки"
              : "История международных отношений",
            date: "2026-11-17",
            daysLeft: 1,
            priority: "high",
            route: "grades",
          },
          {
            id: `${student.id}-deadline-2`,
            title: "Подготовка к дискуссии",
            subject: "Английский язык",
            date: "2026-11-18",
            daysLeft: 2,
            priority: "normal",
            route: "schedule",
          },
          {
            id: `${student.id}-deadline-3`,
            title: "Тест по экономике",
            subject: "Экономическая теория",
            date: "2026-11-20",
            daysLeft: 4,
            priority: "normal",
            route: "grades",
          },
        ],
      };
      for (const [kind, items] of Object.entries(records)) {
        for (const item of items)
          addRecord.run(item.id, profile.id, kind, JSON.stringify(item));
      }
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
