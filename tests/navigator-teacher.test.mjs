import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../server/database.mjs";
import { moscowClock } from "../src/calendar.js";
import {
  isAcademicRecordQuestion,
  isScheduleQuestion,
  isTeacherQuestion,
  navigatorAnswer,
} from "../src/navigator.js";

test("teacher lookup uses each account's inflected course names and links to its own record", (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  function account(id) {
    const get = (kind) =>
      db
        .prepare("SELECT payload_json FROM records WHERE user_id=? AND kind=?")
        .all(id, kind)
        .map(({ payload_json }) => JSON.parse(payload_json));
    return { grades: get("grades"), schedule: get("schedule") };
  }
  const alice = account("student-alisa");
  const mark = account("student-mark");
  for (const message of [
    "Как зовут преподавателя по географии?",
    "Фамилия преподавателя по политической географии",
    "Кто ведёт политическую географию?",
    "Что преподаёт Радова?",
    "А какой у меня преподаватель по географии?",
  ]) {
    const answer = navigatorAnswer(message, alice);
    assert.equal(answer.text, "«Политическая география» — Есения Радова.");
    assert.equal(answer.route, "grades");
    assert.equal(answer.focusId, "student-alisa-course-4");
  }
  assert.equal(
    navigatorAnswer("Кто преподаёт географию?", mark).focusId,
    "student-mark-course-4",
  );
  assert.equal(navigatorAnswer("Кто ведёт историю?", mark).focusId, undefined);
  assert.equal(
    navigatorAnswer("Кто ведёт историю?", alice).focusId,
    "student-alisa-course-1",
  );
  for (const question of [
    "Кто ведёт физику?",
    "Кто ведёт физическую географию?",
  ]) {
    const result = navigatorAnswer(question, alice);
    assert.match(result.text, /такого совпадения нет/);
    assert.doesNotMatch(result.text, /Радова/);
    assert.equal(result.focusId, undefined);
  }
  const ambiguous = navigatorAnswer("Кто преподаёт язык?", alice);
  assert.match(ambiguous.text, /Английский язык.*Леснев/);
  assert.match(ambiguous.text, /Второй иностранный язык.*Зорина/);
  assert.equal(ambiguous.focusId, undefined);
});

test("teachers recorded only in the schedule deep-link to their lesson and keep distinct instructors", () => {
  const lesson = {
    id: "class-23",
    date: "2026-11-23",
    subject: "Физическая география",
    teacher: "Анна Соколова",
  };
  const secondLesson = { ...lesson, id: "class-24", date: "2026-11-24" };
  const data = { schedule: [lesson, secondLesson] };
  const result = navigatorAnswer("Кто у нас по географии?", data);
  assert.equal(result.focusId, "lesson-class-23");
  assert.equal(result.route, "schedule");
  const differentTeacher = { ...secondLesson, teacher: "Яна Ракова" };
  const ambiguous = navigatorAnswer("Как зовут преподавателя по географии?", {
    schedule: [lesson, differentTeacher],
  });
  assert.match(ambiguous.text, /Соколова/);
  assert.match(ambiguous.text, /Ракова/);
  assert.equal(ambiguous.focusId, undefined);
});

test("tomorrow follows the Moscow calendar at midnight and general study advice stays separate", () => {
  const tomorrow = (at) =>
    navigatorAnswer("А что завтра?", {
      referenceDate: "2026-11-16",
      clock: moscowClock(new Date(at)),
      schedule: [],
    });
  assert.equal(tomorrow("2026-11-21T20:59:59Z").focusId, "day-7");
  assert.equal(tomorrow("2026-11-21T21:00:00Z").focusId, "2026-11-23");
  for (const message of [
    "Как составить расписание?",
    "Что такое парадигма?",
    "Как подготовиться к экзамену?",
    "Составь план занятий по географии",
    "Что такое сессия?",
    "Как стать преподавателем?",
    "Реши задачу: сколько будет 2+1?",
    "Объясни задание",
    "Какие бывают сроки?",
    "Напиши поздравление преподавателю",
  ]) {
    assert.equal(
      isScheduleQuestion(message) ||
        isTeacherQuestion(message) ||
        isAcademicRecordQuestion(message),
      false,
      message,
    );
    assert.equal(navigatorAnswer(message, {}).route, null, message);
  }
});
