import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.mjs";
import { navigatorAnswer } from "../src/navigator.js";

async function start(databasePath = ":memory:", options = {}) {
  const app = createApp({ databasePath, secureCookies: false, ...options });
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (
    path,
    { method = "GET", session, body, headers = {} } = {},
  ) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(session
          ? { cookie: session.cookie, "X-CSRF-Token": session.csrfToken }
          : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    return {
      status: response.status,
      json: response.headers.get("content-type")?.includes("application/json")
        ? JSON.parse(text)
        : null,
      text,
    };
  };
  return {
    app,
    call,
    login: async (login = "alisa@demo.orbita") => {
      const response = await fetch(base + "/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login, password: "Orbita2026!" }),
      });
      assert.equal(response.status, 200);
      return {
        ...(await response.json()),
        cookie: response.headers.get("set-cookie").split(";")[0],
      };
    },
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await app.locals.close();
    },
  };
}

test("planner retries survive restart, isolate keys and never resurrect deleted tasks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "orbita-retry-"));
  const path = join(directory, "demo.sqlite");
  let service = await start(path);
  try {
    const session = await service.login();
    const options = {
      method: "POST",
      session,
      headers: { "Idempotency-Key": "audit-plan-operation" },
      body: { title: "Повторить конспект", dueDate: null },
    };
    const first = await service.call("/plan", options);
    assert.equal(first.status, 201);
    await service.close();
    service = await start(path);
    const retry = await service.call("/plan", options);
    assert.equal(retry.status, 200);
    assert.equal(retry.json.item.id, first.json.item.id);
    assert.equal(
      (await service.call("/plan", { session })).json.items.filter(
        (item) => item.title === options.body.title,
      ).length,
      1,
    );
    assert.equal(
      (
        await service.call("/plan", {
          ...options,
          body: { ...options.body, title: "Другая задача" },
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await service.call("/plan", {
          ...options,
          headers: { "Idempotency-Key": "bad" },
        })
      ).status,
      400,
    );
    const mark = await service.login("mark@demo.orbita");
    const other = await service.call("/plan", { ...options, session: mark });
    assert.equal(other.status, 201);
    assert.notEqual(other.json.item.id, first.json.item.id);
    assert.equal(
      (
        await service.call(`/plan/${first.json.item.id}`, {
          method: "DELETE",
          session,
          body: {},
        })
      ).status,
      200,
    );
    assert.equal((await service.call("/plan", options)).status, 410);
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("archiving is private, preserves documents and releases the request quota", async () => {
  const service = await start();
  try {
    const session = await service.login();
    const mark = await service.login("mark@demo.orbita");
    const data = (await service.call("/bootstrap", { session })).json;
    const ready = data.requests.find((item) => item.status === "ready");
    const pending = data.requests.find((item) => item.status === "submitted");
    const archive = `/requests/${ready.id}/archive`;
    const options = { method: "POST", session, body: {} };
    assert.equal(
      (await service.call(archive, { ...options, session: null })).status,
      401,
    );
    assert.equal(
      (await service.call(archive, { ...options, session: mark })).status,
      404,
    );
    assert.equal(
      (
        await service.call(archive, {
          ...options,
          headers: { "X-CSRF-Token": "invalid" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await service.call(archive, {
          ...options,
          headers: { Origin: "https://other.invalid" },
        })
      ).status,
      403,
    );
    assert.equal(
      (await service.call(`/requests/${pending.id}/archive`, options)).status,
      409,
    );
    const insert = service.app.locals.db.prepare(
      "INSERT INTO records (id, user_id, kind, payload_json) VALUES (?, ?, 'requests', ?)",
    );
    for (let i = data.requests.length; i < 200; i++) {
      const item = { ...pending, id: `quota-${i}`, number: `AUDIT-${i}` };
      insert.run(item.id, session.user.id, JSON.stringify(item));
    }
    const create = {
      ...options,
      body: { type: "enrollment", purpose: "Для демонстрации" },
    };
    assert.equal((await service.call("/requests", create)).status, 429);
    assert.equal(
      (await service.call(archive, options)).json.request.archived,
      true,
    );
    assert.equal((await service.call(archive, options)).status, 200);
    const preserved = (await service.call(`/requests/${ready.id}`, { session }))
      .json.request;
    assert.deepEqual(preserved.history, ready.history);
    assert.equal(
      (await service.call(`/requests/${ready.id}/document`, { session }))
        .status,
      200,
    );
    assert.equal(
      (await service.call(`/requests/${ready.id}/document`, { session: mark }))
        .status,
      404,
    );
    const created = await service.call("/requests", create);
    assert.equal(created.status, 201);
    const notice = (
      await service.call("/bootstrap", { session })
    ).json.notifications.find(
      (item) => item.focusId === created.json.request.id,
    );
    assert.ok(notice);
  } finally {
    await service.close();
  }
});

test("academic leave requires a nonblank reason on the server", async () => {
  const service = await start();
  try {
    const session = await service.login();
    for (const comment of [undefined, "", "          ", "123456789"]) {
      const response = await service.call("/requests", {
        method: "POST",
        session,
        body: { type: "leave", purpose: "Учебный пример", comment },
      });
      assert.equal(response.status, 400);
    }
    assert.equal(
      (
        await service.call("/requests", {
          method: "POST",
          session,
          body: {
            type: "leave",
            purpose: "Учебный пример",
            comment: "Вымышленная экспедиция",
          },
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await service.call("/requests", {
          method: "POST",
          session,
          body: { type: "enrollment", purpose: "Учебный пример" },
        })
      ).status,
      201,
    );
  } finally {
    await service.close();
  }
});

test("upgrading an old database preserves user state and adds assessment and notification context", async () => {
  const directory = await mkdtemp(join(tmpdir(), "orbita-upgrade-"));
  const path = join(directory, "old.sqlite");
  let service = await start(path);
  try {
    const session = await service.login();
    const before = (await service.call("/bootstrap", { session })).json;
    const write = service.app.locals.db.prepare(
      "UPDATE records SET payload_json = ? WHERE id = ?",
    );
    for (const grade of before.grades) {
      const legacy = { ...grade };
      delete legacy.assessmentStatus;
      delete legacy.assessmentResult;
      write.run(JSON.stringify(legacy), grade.id);
    }
    const notice = before.notifications.find(
      (item) => item.category === "deadline",
    );
    const legacyNotice = { ...notice, route: "grades", read: true };
    delete legacyNotice.focusId;
    write.run(JSON.stringify(legacyNotice), notice.id);
    await service.close();
    service = await start(path);
    const after = (await service.call("/bootstrap", { session })).json;
    assert.deepEqual(after.requests, before.requests);
    assert.deepEqual(after.plan, before.plan);
    for (const grade of after.grades) {
      assert.equal(grade.assessmentStatus, "pending");
      assert.equal(grade.assessmentResult, null);
      assert.equal(
        grade.score,
        before.grades.find((item) => item.id === grade.id).score,
      );
    }
    const updated = after.notifications.find((item) => item.id === notice.id);
    assert.equal(updated.read, true);
    assert.equal(updated.route, "plan");
    assert.ok(after.plan.items.some((item) => item.id === updated.focusId));
    // A subsequent boot must preserve explicitly recorded assessment results.
    const grade = {
      ...after.grades[0],
      assessmentStatus: "passed",
      assessmentResult: "Отлично",
    };
    service.app.locals.db
      .prepare("UPDATE records SET payload_json = ? WHERE id = ?")
      .run(JSON.stringify(grade), grade.id);
    await service.close();
    service = await start(path);
    assert.deepEqual(
      (await service.call("/bootstrap", { session })).json.grades[0],
      grade,
    );
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("navigator respects document intent, relative dates, subject and missing information", async () => {
  const service = await start();
  try {
    const session = await service.login();
    const data = (await service.call("/bootstrap", { session })).json;
    data.todayDate = "2026-11-16";
    const tomorrow = navigatorAnswer("Какие пары завтра?", data);
    assert.match(tomorrow.text, /17 ноября/);
    assert.equal(tomorrow.focusId, "day-2");
    const document = navigatorAnswer("Какой срок изготовления справки?", data);
    assert.equal(document.route, "requests");
    assert.match(document.text, /3 рабочих дня/);
    assert.doesNotMatch(document.text, /эссе/i);
    const english = navigatorAnswer(
      "Какой у меня ближайший экзамен по английскому?",
      data,
    );
    assert.match(english.text, /Английский язык.*18 декабря/);
    assert.equal(english.focusId, "session");
    assert.doesNotMatch(english.text, /История международных отношений/);
    assert.match(
      navigatorAnswer("Когда экзамен по физике?", data).text,
      /Уточните/,
    );
    assert.match(
      navigatorAnswer("Когда экзамен по международной дисциплине?", data).text,
      /Уточните/,
    );
    assert.match(
      navigatorAnswer("Какие экзамены сегодня?", data).text,
      /на 16 ноября.*нет/,
    );
    const judgingWeek = navigatorAnswer("Какие пары на следующей неделе?", data);
    assert.match(judgingWeek.text, /23–29 ноября 2026/);
    assert.equal(judgingWeek.focusId, "week-2");
    assert.equal(navigatorAnswer("Какие пары в среду?", data).focusId, "day-3");
    data.todayDate = "2026-11-22";
    const nextMonday = navigatorAnswer("Какие пары завтра?", data);
    assert.match(nextMonday.text, /23 ноября.*09:00/);
    assert.equal(nextMonday.focusId, "2026-11-23");
    data.todayDate = "2026-11-29";
    const afterWeek = navigatorAnswer("Какие пары завтра?", data);
    assert.match(afterWeek.text, /30 ноября.*расписания нет/);
    assert.equal(afterWeek.focusId, "week-2");
  } finally {
    await service.close();
  }
});

test("existing databases receive both judging schedules without rewriting stored state", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "orbita-schedule-upgrade-"));
  const path = join(directory, "demo.sqlite");
  let service = await start(path);
  t.after(async () => {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  });
  const sessions = await Promise.all(["alisa", "mark"].map((name) =>
    service.login(`${name}@demo.orbita`),
  ));
  const db = service.app.locals.db;
  db.prepare("DELETE FROM records WHERE kind = 'schedule' AND id LIKE '%-lesson-w2-%'").run();
  const mark = (await service.call("/bootstrap", { session: sessions[1] })).json;
  const updated = await service.call(`/plan/${mark.plan.items[0].id}`, {
    method: "PATCH", session: sessions[1], body: { completed: true },
  });
  assert.equal(updated.status, 200);
  const saved = await service.call("/plan", {
    method: "POST", session: sessions[0],
    headers: { "Idempotency-Key": "before-judging-upgrade" },
    body: { title: "Сохранённая задача", dueDate: "2026-11-20" },
  });
  assert.equal(saved.status, 201);
  const tables = ["users", "records", "sessions", "planner_keys", "request_keys"];
  function snapshot(db) {
    return tables.map((table) => db.prepare(
      `SELECT * FROM ${table}${table === "records" ? " WHERE id NOT LIKE '%-lesson-w2-%'" : ""} ORDER BY rowid`,
    ).all());
  }
  const previousState = snapshot(db);
  for (let attempt = 0; attempt < 2; attempt++) {
    await service.close();
    service = await start(path);
    assert.deepEqual(snapshot(service.app.locals.db), previousState);
    for (const session of sessions) {
      const response = await service.call("/bootstrap", { session });
      assert.equal(response.status, 200);
      const { schedule, user } = response.json;
      assert.ok(schedule.every(({ id }) => id.startsWith(user.id)));
      assert.equal(schedule.filter(({ date }) => date < "2026-11-23").length, 13);
      assert.equal(schedule.filter(({ date }) => date >= "2026-11-23").length, 13);
      assert.equal(new Set(schedule.map(({ id }) => id)).size, 26);
    }
  }
});

test("Navigator tracks Moscow class boundaries and separates overdue tasks for both accounts", async (t) => {
  let time;
  const service = await start(":memory:", { assistant: { now: () => Date.parse(time) } });
  t.after(() => service.close());
  for (const [login, subject] of [
    ["alisa", "История международных отношений"],
    ["mark", "Мировые финансовые рынки"],
  ]) {
    const session = await service.login(`${login}@demo.orbita`);
    const ask = async (message) => {
      const result = await service.call("/assistant/chat", {
        method: "POST", session, body: { message },
      });
      assert.equal(result.status, 200);
      return result.json;
    };
    for (const [date, focusId] of [["2026-11-16", "day-1"], ["2026-11-23", "2026-11-23"]]) {
      for (const [utc, expected] of [
        ["05:59:59", new RegExp(`Следующая пара.*${subject}`)],
        ["06:00:00", new RegExp(`Идёт сейчас.*${subject}`)],
        ["07:20:00", /Следующая пара.*Английский язык/],
        ["10:45:00", /Пары на сегодня закончились/],
      ]) {
        time = `${date}T${utc}Z`;
        const answer = await ask("Какая сейчас пара?");
        assert.match(answer.reply, expected);
        assert.equal(answer.links[0].focusId, focusId);
      }
    }
    time = "2026-11-23T06:00:00Z";
    assert.match((await ask("Какая следующая пара?")).reply, /Следующая пара.*Английский язык/);
    time = "2026-11-22T20:59:59Z";
    assert.match((await ask("Какие пары сегодня?")).reply, /Сегодня без пар/);
    time = "2026-11-22T21:00:00Z";
    assert.equal((await ask("Какие пары сегодня?")).links[0].focusId, "2026-11-23");
    const overdue = await ask("Какие дедлайны просрочены?");
    assert.match(overdue.reply, /Просрочено.*17 ноября/);
    assert.match((await ask("Какой ближайший дедлайн?")).reply, /Ближайших учебных дедлайнов в плане нет.*Просрочено дел: 3/);
    time = "2026-11-29T21:00:00Z";
    assert.match((await ask("Какие пары сегодня?")).reply, /На сегодня нет расписания/);
  }
});
