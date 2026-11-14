import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.mjs";
import { openDatabase } from "../server/database.mjs";

test("personal planner preserves academic sources and private persistent state", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "orbita-planner-"));
  const databasePath = join(directory, "existing.sqlite");

  // Model an already published installation, not a fresh seed-only setup.
  const existing = openDatabase(databasePath);
  const oldNoticeRow = existing
    .prepare(
      "SELECT * FROM records WHERE user_id = ? AND kind = 'notifications' LIMIT 1",
    )
    .get("student-alisa");
  const oldNotice = JSON.parse(oldNoticeRow.payload_json);
  oldNotice.read = true;
  existing
    .prepare("UPDATE records SET payload_json = ? WHERE id = ?")
    .run(JSON.stringify(oldNotice), oldNotice.id);
  const oldRequestRow = existing
    .prepare(
      "SELECT * FROM records WHERE user_id = ? AND kind = 'requests' LIMIT 1",
    )
    .get("student-alisa");
  const oldRequest = JSON.parse(oldRequestRow.payload_json);
  oldRequest.comment = "Сохранённые сведения до обновления приложения";
  existing
    .prepare("UPDATE records SET payload_json = ? WHERE id = ?")
    .run(JSON.stringify(oldRequest), oldRequest.id);
  existing.close();

  let app;
  let server;
  let base;
  async function boot() {
    app = createApp({ databasePath, secureCookies: false });
    server = await new Promise((resolve) => {
      const started = app.listen(0, "127.0.0.1", () => resolve(started));
    });
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    if (!server) return;
    await new Promise((resolve) => server.close(resolve));
    app.locals.close();
    server = null;
  }
  async function call(
    path,
    { method = "GET", session, body, csrf = true, headers = {} } = {},
  ) {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(session
          ? {
              Cookie: session.cookie,
              ...(csrf ? { "X-CSRF-Token": session.csrf } : {}),
            }
          : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* DELETE may return an empty 204. */
    }
    return { res, json, text };
  }
  async function login(login) {
    const result = await call("/login", {
      method: "POST",
      body: { login, password: "Orbita2026!" },
    });
    assert.equal(result.res.status, 200, result.text);
    return {
      cookie: result.res.headers.get("set-cookie").split(";")[0],
      csrf: result.json.csrfToken,
    };
  }
  async function plan(session) {
    const result = await call("/plan", { session });
    assert.equal(result.res.status, 200, result.text);
    return result.json;
  }
  await boot();
  try {
    let alisa = await login("alisa@demo.orbita");
    let mark = await login("mark@demo.orbita");
    let academic;
    let academicSource;
    let task;

    await t.test(
      "old installations gain derived academic tasks without resetting saved data",
      async () => {
        const bootstrap = await call("/bootstrap", { session: alisa });
        const current = await plan(alisa);
        assert.deepEqual(bootstrap.json.plan, current);
        assert.equal(current.referenceDate, "2026-11-16");
        assert.equal(
          current.items.filter((item) => item.kind === "deadline").length,
          bootstrap.json.deadlines.length,
        );
        assert.ok(current.items.length > 0);
        academic = current.items.find((item) => item.kind === "deadline");
        academicSource = bootstrap.json.deadlines.find(
          (item) => item.id === academic.id,
        );
        assert.equal(academic.title, academicSource.title);
        assert.equal(academic.dueDate, academicSource.date);
        assert.equal(academic.completed, false);
        assert.equal(
          bootstrap.json.notifications.find((item) => item.id === oldNotice.id)
            .read,
          true,
        );
        assert.equal(
          bootstrap.json.requests.find((item) => item.id === oldRequest.id)
            .comment,
          oldRequest.comment,
        );
        assert.deepEqual(
          await plan(alisa),
          current,
          "Repeated reads must not duplicate or reseed the plan",
        );
      },
    );

    await t.test(
      "every planner route requires authentication and every write requires CSRF and own Origin",
      async () => {
        assert.equal((await call("/plan")).res.status, 401);
        for (const [method, path, body] of [
          ["POST", "/plan", { title: "Проверка доступа", dueDate: null }],
          ["PATCH", `/plan/${academic.id}`, { completed: true }],
          ["DELETE", `/plan/${academic.id}`, {}],
        ]) {
          assert.equal(
            (await call(path, { method, body })).res.status,
            401,
            `${method} without session`,
          );
          assert.equal(
            (await call(path, { method, body, session: alisa, csrf: false }))
              .res.status,
            403,
            `${method} without CSRF`,
          );
          assert.equal(
            (
              await call(path, {
                method,
                body,
                session: alisa,
                headers: { Origin: "https://foreign.invalid" },
              })
            ).res.status,
            403,
            `${method} with foreign Origin`,
          );
        }
      },
    );

    await t.test(
      "server validates text, calendar dates and rejects injected ownership or source fields",
      async () => {
        const invalid = [
          { title: "   " },
          { title: 42 },
          { title: "x".repeat(121) },
          { title: "Задача", dueDate: "2026-11-15" },
          { title: "Задача", dueDate: "2026-11-23" },
          { title: "Задача", dueDate: "2026-11-31" },
          { title: "Задача", dueDate: "2026-11-17T00:00:00Z" },
          { title: "Задача", dueDate: "" },
          { title: "Задача", dueDate: true },
          { title: "Задача", userId: "student-mark" },
          { title: "Задача", sourceId: academic.id },
          { title: "Задача", sourceRoute: "https://foreign.invalid" },
          { title: "Задача", completed: true },
        ];
        const before = await plan(alisa);
        for (const body of invalid) {
          const result = await call("/plan", {
            method: "POST",
            session: alisa,
            body,
          });
          assert.ok(
            [400, 422].includes(result.res.status),
            `${JSON.stringify(body)}: ${result.res.status} ${result.text}`,
          );
        }
        assert.deepEqual(
          await plan(alisa),
          before,
          "Rejected input must not create records",
        );
      },
    );

    await t.test(
      "own tasks accept nullable dates and are isolated from the other student",
      async () => {
        const created = await call("/plan", {
          method: "POST",
          session: alisa,
          body: { title: "  Подготовить вымышленный доклад  ", dueDate: null },
        });
        assert.equal(created.res.status, 201, created.text);
        task = created.json.item;
        assert.ok(task.id);
        assert.equal(task.kind, "personal");
        assert.equal(task.title, "Подготовить вымышленный доклад");
        assert.equal(task.dueDate, null);
        assert.equal(task.completed, false);
        assert.ok(
          (await plan(alisa)).items.some((item) => item.id === task.id),
        );
        assert.equal(
          (await plan(mark)).items.some((item) => item.id === task.id),
          false,
        );
        assert.equal(
          (await plan(mark)).items.some((item) => item.id === academic.id),
          false,
        );
        for (const id of [task.id, academic.id, "unknown-task"]) {
          assert.equal(
            (
              await call(`/plan/${id}`, {
                method: "PATCH",
                session: mark,
                body: { completed: true },
              })
            ).res.status,
            404,
          );
          assert.equal(
            (
              await call(`/plan/${id}`, {
                method: "DELETE",
                session: mark,
                body: {},
              })
            ).res.status,
            404,
          );
        }
      },
    );

    await t.test(
      "personal completion is explicit, repeat-safe, reversible and cannot alter academic source data",
      async () => {
        for (const body of [
          { completed: "true" },
          { completed: 1 },
          {},
          { completed: true, dueDate: "2026-11-22" },
          { completed: true, title: "Изменённый срок" },
        ]) {
          assert.ok(
            [400, 422].includes(
              (
                await call(`/plan/${academic.id}`, {
                  method: "PATCH",
                  session: alisa,
                  body,
                })
              ).res.status,
            ),
          );
        }
        for (const completed of [true, true, false, true]) {
          const updated = await call(`/plan/${academic.id}`, {
            method: "PATCH",
            session: alisa,
            body: { completed },
          });
          assert.equal(updated.res.status, 200, updated.text);
          assert.equal(updated.json.item.completed, completed);
          const current = await plan(alisa);
          assert.equal(
            current.items.filter((item) => item.id === academic.id).length,
            1,
          );
          assert.equal(
            current.items.find((item) => item.id === academic.id).completed,
            completed,
          );
          const bootstrap = await call("/bootstrap", { session: alisa });
          assert.deepEqual(
            bootstrap.json.deadlines.find((item) => item.id === academic.id),
            academicSource,
          );
          assert.deepEqual(bootstrap.json.plan, current);
        }
        assert.equal(
          (
            await call(`/plan/${academic.id}`, {
              method: "DELETE",
              session: alisa,
              body: {},
            })
          ).res.status,
          409,
        );
        const changedTask = await call(`/plan/${task.id}`, {
          method: "PATCH",
          session: alisa,
          body: { completed: true },
        });
        assert.equal(changedTask.res.status, 200);
      },
    );

    await t.test(
      "completion and personal tasks survive restart; undo is also persistent",
      async () => {
        await stop();
        await boot();
        alisa = await login("alisa@demo.orbita");
        mark = await login("mark@demo.orbita");
        const current = await plan(alisa);
        assert.equal(
          current.items.find((item) => item.id === academic.id).completed,
          true,
        );
        assert.equal(
          current.items.find((item) => item.id === task.id).completed,
          true,
        );
        const reverted = await call(`/plan/${academic.id}`, {
          method: "PATCH",
          session: alisa,
          body: { completed: false },
        });
        assert.equal(reverted.res.status, 200);
        await stop();
        await boot();
        alisa = await login("alisa@demo.orbita");
        assert.equal(
          (await plan(alisa)).items.find((item) => item.id === academic.id)
            .completed,
          false,
        );
      },
    );

    await t.test(
      "only own personal tasks can be deleted and stay deleted after restart",
      async () => {
        const deleted = await call(`/plan/${task.id}`, {
          method: "DELETE",
          session: alisa,
          body: {},
        });
        assert.ok([200, 204].includes(deleted.res.status), deleted.text);
        assert.equal(
          (await plan(alisa)).items.some((item) => item.id === task.id),
          false,
        );
        assert.equal(
          (
            await call(`/plan/${task.id}`, {
              method: "PATCH",
              session: alisa,
              body: { completed: false },
            })
          ).res.status,
          404,
        );
        await stop();
        await boot();
        alisa = await login("alisa@demo.orbita");
        assert.equal(
          (await plan(alisa)).items.some((item) => item.id === task.id),
          false,
        );
      },
    );

    await t.test(
      "task count is bounded and valid date-only deadlines keep their exact value",
      async () => {
        const current = await plan(alisa);
        const count = current.items.filter(
          (item) => item.kind === "personal",
        ).length;
        let first;
        for (let i = count; i < 100; i += 1) {
          const created = await call("/plan", {
            method: "POST",
            session: alisa,
            body: {
              title: `Учебная задача ${i + 1}`,
              dueDate: i % 2 ? "2026-11-16" : "2026-11-22",
            },
          });
          assert.equal(created.res.status, 201, created.text);
          assert.equal(
            created.json.item.dueDate,
            i % 2 ? "2026-11-16" : "2026-11-22",
          );
          first ||= created.json.item;
        }
        const overflow = await call("/plan", {
          method: "POST",
          session: alisa,
          body: { title: "Сверх лимита", dueDate: null },
        });
        assert.equal(overflow.res.status, 429, overflow.text);
        assert.equal(
          (await plan(alisa)).items.filter((item) => item.kind === "personal")
            .length,
          100,
        );
        await call(`/plan/${first.id}`, {
          method: "DELETE",
          session: alisa,
          body: {},
        });
        assert.equal(
          (
            await call("/plan", {
              method: "POST",
              session: alisa,
              body: { title: "Снова доступно место" },
            })
          ).res.status,
          201,
        );
      },
    );
  } finally {
    await stop();
    await rm(directory, { recursive: true, force: true });
  }
});
