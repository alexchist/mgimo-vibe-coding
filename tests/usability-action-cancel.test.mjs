import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.mjs";

const ALICE = "student-alisa";
const BOB = "student-mark";
const request = (purpose = "Учебный конкурс") => ({
  type: "request.create",
  params: { type: "enrollment", purpose },
});
function fixture(t) {
  const app = createApp({
    databasePath: ":memory:",
    appOrigin: "",
    secureCookies: false,
  });
  t.after(() => app.locals.close());
  return { app, ...app.locals.services, db: app.locals.db };
}

test("cancelling one pending action is terminal, retry-safe and leaves independent preparations intact", async (t) => {
  const f = fixture(t);
  const first = (await f.actions.prepare(ALICE, request("Неточное назначение")))
    .action;
  const independent = (
    await f.actions.prepare(ALICE, request("Другая самостоятельная заявка"))
  ).action;
  const count = f.db
    .prepare("SELECT COUNT(*) AS n FROM records WHERE kind='requests'")
    .get().n;
  assert.equal(
    (await f.actions.cancel(ALICE, first.id)).action.status,
    "cancelled",
  );
  assert.equal(
    (await f.actions.cancel(ALICE, first.id)).action.status,
    "cancelled",
  );
  await assert.rejects(f.actions.confirm(ALICE, first.id), { status: 409 });
  assert.deepEqual(
    f.actions.list(ALICE).actions.map((a) => a.id),
    [independent.id],
  );
  assert.equal(
    f.db
      .prepare("SELECT COUNT(*) AS n FROM records WHERE kind='requests'")
      .get().n,
    count,
  );
  assert.equal(
    f.actions.get(ALICE, first.id).action.params.purpose,
    "Неточное назначение",
  );
  const completed = await f.actions.confirm(ALICE, independent.id);
  assert.ok(completed.result.request.id);
  assert.throws(() => f.actions.cancel(ALICE, independent.id), { status: 409 });
});

test("cancellation checks owner and MCP actor before reading or changing an action", async (t) => {
  const f = fixture(t);
  const actor = { actorId: "mcp-test-token-a" };
  const { action } = await f.actions.prepare(ALICE, request(), actor);
  assert.throws(() => f.actions.cancel(BOB, action.id, actor), { status: 404 });
  assert.throws(() => f.actions.cancel(ALICE, action.id), { status: 404 });
  assert.throws(
    () => f.actions.cancel(ALICE, action.id, { actorId: "mcp-test-token-b" }),
    { status: 404 },
  );
  assert.equal(f.actions.list(ALICE).actions.length, 0);
  assert.equal(f.actions.list(ALICE, actor).actions.length, 1);
  assert.equal(
    f.actions.cancel(ALICE, action.id, actor).action.status,
    "cancelled",
  );
  assert.equal(f.actions.list(ALICE, actor).actions.length, 0);
  await assert.rejects(f.actions.confirm(ALICE, action.id, actor), {
    status: 409,
  });
});

test("cancelled preparations release their quota without deleting records", async (t) => {
  const f = fixture(t);
  const ids = [];
  for (let i = 0; i < 30; i++)
    ids.push(
      (await f.actions.prepare(ALICE, request(`Учебная цель ${i}`))).action.id,
    );
  await assert.rejects(f.actions.prepare(ALICE, request()), { status: 429 });
  f.actions.cancel(ALICE, ids[0]);
  await f.actions.prepare(ALICE, request("Новая цель после отмены"));
  assert.equal(f.actions.list(ALICE).actions.length, 30);
  assert.equal(
    f.db
      .prepare("SELECT COUNT(*) AS n FROM assistant_actions WHERE user_id=?")
      .get(ALICE).n,
    31,
  );
});

test("cancellation cannot race past execution or hide a previously started attempt", async (t) => {
  const f = fixture(t);
  const originalCreate = f.requests.create;
  let release;
  const paused = new Promise((resolve) => {
    release = resolve;
  });
  f.requests.create = async (...args) => {
    await paused;
    return originalCreate(...args);
  };
  const { action } = await f.actions.prepare(ALICE, request());
  const confirmation = f.actions.confirm(ALICE, action.id);
  assert.throws(() => f.actions.cancel(ALICE, action.id), { status: 409 });
  release();
  const completed = await confirmation;
  assert.ok(completed.result.request.id);
  f.requests.create = async () => {
    throw new Error("Test: outcome was not received");
  };
  const uncertain = (
    await f.actions.prepare(ALICE, request("Проверка неизвестного исхода"))
  ).action;
  await assert.rejects(
    f.actions.confirm(ALICE, uncertain.id),
    /outcome was not received/,
  );
  assert.equal(f.actions.get(ALICE, uncertain.id).action.status, "pending");
  assert.throws(() => f.actions.cancel(ALICE, uncertain.id), { status: 409 });
  f.requests.create = originalCreate;
  assert.ok((await f.actions.confirm(ALICE, uncertain.id)).result.request.id);
});

test("browser cancellation requires session, CSRF and a strict empty body and cannot cancel MCP actions", async (t) => {
  const f = fixture(t);
  const server = await new Promise((resolve) => {
    const s = f.app.listen(0, "127.0.0.1", () => resolve(s));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = async (name) => {
    const response = await fetch(base + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login: name, password: "Orbita2026!" }),
    });
    return {
      ...(await response.json()),
      cookie: response.headers.get("set-cookie").split(";")[0],
    };
  };
  const alice = await login("alisa@demo.orbita"),
    bob = await login("mark@demo.orbita");
  const call = (id, session, body = {}, csrf = true) =>
    fetch(base + `/api/assistant/actions/${id}/cancel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session
          ? {
              Cookie: session.cookie,
              ...(csrf ? { "X-CSRF-Token": session.csrfToken } : {}),
            }
          : {}),
      },
      body: JSON.stringify(body),
    });
  const { action } = await f.actions.prepare(ALICE, request());
  assert.equal((await call(action.id, null)).status, 401);
  assert.equal((await call(action.id, alice, {}, false)).status, 403);
  assert.equal((await call(action.id, bob)).status, 404);
  assert.equal((await call(action.id, alice, { userId: BOB })).status, 400);
  assert.equal((await call(action.id, alice)).status, 200);
  assert.equal((await call(action.id, alice)).status, 200);
  const foreignActor = (
    await f.actions.prepare(ALICE, request(), { actorId: "mcp-test-token" })
  ).action;
  assert.equal((await call(foreignActor.id, alice)).status, 404);
});
