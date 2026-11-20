import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.mjs";
import { moscowDate } from "../src/calendar.js";

test("student workflows, authorization and persistence", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "orbita-api-"));
  const databasePath = join(dir, "test.sqlite");
  let app, server, base;
  async function boot() {
    app = await createApp({ databasePath, secureCookies: false });
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    await new Promise((resolve) => server.close(resolve));
    await app.locals.close();
  }
  async function call(
    path,
    { method = "GET", body, session, headers = {} } = {},
  ) {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(session
          ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf }
          : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { res, json, text };
  }
  async function login(login) {
    const result = await call("/login", {
      method: "POST",
      body: { login, password: "Orbita2026!" },
    });
    assert.equal(result.res.status, 200, result.text);
    const setCookie = result.res.headers.get("set-cookie");
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=(Strict|Lax)/i);
    assert.ok(result.json.csrfToken);
    return {
      cookie: setCookie.split(";")[0],
      csrf: result.json.csrfToken,
      user: result.json.user,
    };
  }
  await boot();
  try {
    await t.test(
      "unauthenticated data is protected and wrong password is rejected",
      async () => {
        assert.equal((await call("/bootstrap")).res.status, 401);
        assert.equal((await call("/requests/1")).res.status, 401);
        assert.equal(
          (
            await call("/login", {
              method: "POST",
              body: { login: "alisa@demo.orbita", password: "wrong-password" },
            })
          ).res.status,
          401,
        );
      },
    );
    const alisa = await login("alisa@demo.orbita");
    const mark = await login("mark@demo.orbita");
    let a, b, requestId;
    await t.test(
      "two accounts have distinct private profiles, grades and requests",
      async () => {
        a = (await call("/bootstrap", { session: alisa })).json;
        b = (await call("/bootstrap", { session: mark })).json;
        assert.notEqual(a.user.id, b.user.id);
        assert.notEqual(a.user.fullName, b.user.fullName);
        assert.ok(a.schedule.length > 0 && b.schedule.length > 0);
        assert.ok(a.grades.length > 0 && b.grades.length > 0);
        assert.notDeepEqual(a.grades, b.grades);
        assert.ok(a.requests.length > 0 && b.requests.length > 0);
        assert.equal(
          a.requests.some((r) => b.requests.some((s) => s.id === r.id)),
          false,
        );
        assert.equal(a.referenceDate, "2026-11-16");
        assert.equal(a.todayDate, moscowDate());
        assert.equal(JSON.stringify(a).includes("password"), false);
      },
    );
    await t.test("CSRF and cross-origin writes are blocked", async () => {
      const missing = await call("/requests", {
        method: "POST",
        headers: { Cookie: alisa.cookie },
        body: { type: "enrollment", purpose: "По месту требования" },
      });
      assert.equal(missing.res.status, 403);
      const foreign = await call("/requests", {
        method: "POST",
        session: alisa,
        headers: { Origin: "https://attacker.invalid" },
        body: { type: "enrollment", purpose: "По месту требования" },
      });
      assert.equal(foreign.res.status, 403);
    });
    await t.test("invalid form data is rejected on the server", async () => {
      const result = await call("/requests", {
        method: "POST",
        session: alisa,
        body: { type: "nonexistent", purpose: "" },
      });
      assert.ok([400, 422].includes(result.res.status), result.text);
    });
    await t.test(
      "request is created once with an idempotency key and belongs to authenticated user",
      async () => {
        const options = {
          method: "POST",
          session: alisa,
          headers: { "Idempotency-Key": "api-integration-unique-request" },
          body: {
            type: "enrollment",
            purpose: "По месту требования",
            comment: "<script>alert(1)</script>",
            userId: b.user.id,
          },
        };
        const first = await call("/requests", options);
        assert.ok([200, 201].includes(first.res.status), first.text);
        requestId = first.json.request.id;
        assert.equal(first.json.request.status, "submitted");
        const repeat = await call("/requests", options);
        assert.equal(repeat.json.request.id, requestId);
        assert.equal(
          (await call(`/requests/${requestId}`, { session: alisa })).res.status,
          200,
        );
      },
    );
    await t.test(
      "foreign direct URLs, downloads and mutations return 404",
      async () => {
        for (const suffix of ["", "/document"]) {
          assert.equal(
            (await call(`/requests/${requestId}${suffix}`, { session: mark }))
              .res.status,
            404,
          );
        }
        assert.equal(
          (
            await call(`/requests/${requestId}/demo-advance`, {
              method: "POST",
              session: mark,
              body: {},
            })
          ).res.status,
          404,
        );
        assert.equal(
          (await call(`/requests/${b.requests[0].id}`, { session: alisa })).res
            .status,
          404,
        );
      },
    );
    await t.test(
      "demo request progresses with history and produces a safe marked document",
      async () => {
        assert.ok(
          [400, 409].includes(
            (await call(`/requests/${requestId}/document`, { session: alisa }))
              .res.status,
          ),
        );
        for (const status of ["processing", "ready"]) {
          const result = await call(`/requests/${requestId}/demo-advance`, {
            method: "POST",
            session: alisa,
            body: {},
          });
          assert.equal(result.res.status, 200, result.text);
          assert.equal(result.json.request.status, status);
        }
        const detail = await call(`/requests/${requestId}`, { session: alisa });
        assert.equal(detail.json.request.history.length, 3);
        const doc = await call(`/requests/${requestId}/document`, {
          session: alisa,
        });
        assert.equal(doc.res.status, 200);
        assert.match(doc.res.headers.get("content-disposition"), /attachment/i);
        assert.match(doc.text, /демо|образец|вымышлен|не является/iu);
        assert.equal(doc.text.includes("<script>alert(1)</script>"), false);
      },
    );
    await t.test(
      "notification read state is persistent and private",
      async () => {
        const n = a.notifications.find((item) => !item.read);
        const read = await call("/notifications/read", {
          method: "POST",
          session: alisa,
          body: { id: n.id },
        });
        assert.equal(read.res.status, 200, read.text);
        const fresh = (await call("/bootstrap", { session: alisa })).json;
        assert.equal(fresh.notifications.find((x) => x.id === n.id).read, true);
        const other = await call("/notifications/read", {
          method: "POST",
          session: mark,
          body: { id: n.id },
        });
        assert.equal(other.res.status, 404);
      },
    );
    await t.test(
      "saved changes survive logout, relogin and server restart",
      async () => {
        const task = await call("/plan", {
          method: "POST",
          session: alisa,
          body: { title: "Сохранённая задача", dueDate: null },
          headers: { "Idempotency-Key": "persistent-task-test" },
        });
        assert.equal(task.res.status, 201);
        const taskId = task.json.item.id;
        assert.equal(
          (
            await call(`/plan/${taskId}`, {
              method: "PATCH",
              session: alisa,
              body: { completed: true },
            })
          ).res.status,
          200,
        );
        assert.equal(
          (await call("/logout", { method: "POST", session: alisa, body: {} }))
            .res.status,
          200,
        );
        assert.equal(
          (await call("/bootstrap", { session: alisa })).res.status,
          401,
        );
        await stop();
        await boot();
        const fresh = await login("alisa@demo.orbita");
        const saved = await call(`/requests/${requestId}`, { session: fresh });
        assert.equal(saved.res.status, 200);
        assert.equal(saved.json.request.status, "ready");
        const restored = await call("/bootstrap", { session: fresh });
        assert.equal(
          restored.json.plan.items.find((item) => item.id === taskId).completed,
          true,
        );
        const noticeId = a.notifications.find((item) => !item.read).id;
        assert.equal(
          restored.json.notifications.find((item) => item.id === noticeId).read,
          true,
        );
        const other = await call("/bootstrap", { session: mark });
        assert.equal(other.res.status, 200);
        assert.ok(!other.json.plan.items.some((item) => item.id === taskId));
        assert.equal(
          (await call(`/requests/${requestId}`, { session: mark })).res.status,
          404,
        );
      },
    );
    await t.test("logout invalidates the server-side session", async () => {
      const session = await login("mark@demo.orbita");
      assert.equal(
        (await call("/logout", { method: "POST", session, body: {} })).res
          .status,
        200,
      );
      assert.equal((await call("/bootstrap", { session })).res.status, 401);
    });
  } finally {
    await stop();
    await rm(dir, { recursive: true, force: true });
  }
});
