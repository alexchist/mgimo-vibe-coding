import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.mjs";
import { navigatorAnswer } from "../src/navigator.js";

async function start(databasePath = ":memory:") {
  const app = createApp({ databasePath, secureCookies: false });
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
      app.locals.close();
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
    assert.match(
      navigatorAnswer("Какие пары на следующей неделе?", data).text,
      /Для других дат данных нет/,
    );
    assert.equal(navigatorAnswer("Какие пары в среду?", data).focusId, "day-3");
  } finally {
    await service.close();
  }
});
