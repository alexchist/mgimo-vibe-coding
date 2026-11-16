import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.mjs";

const USER = "student-alisa";
function fixture(t) {
  const app = createApp({
    databasePath: ":memory:",
    assistant: {
      ai: {
        configured: false,
        status: () => ({ configured: false, mode: "local" }),
      },
    },
  });
  t.after(() => app.locals.close());
  return { ...app.locals.services, db: app.locals.db };
}

test("scholarship eligibility questions cite policy instead of offering an unrelated ready certificate", async (t) => {
  const f = fixture(t);
  for (const message of [
    "Как академическая задолженность влияет на стипендию?",
    "При задолженности мне положена стипендия?",
    "Когда назначают стипендию?",
  ]) {
    const result = await f.assistant.chat(USER, { message });
    assert.equal(result.mode, "local");
    assert.equal(result.action, undefined);
    assert.ok(
      result.sources?.some(
        (source) => source.documentId === "demo-scholarship-policy",
      ),
      JSON.stringify(result),
    );
    assert.ok(result.links.some((link) => link.route === "knowledge"));
    assert.ok(result.links.every((link) => link.route !== "requests"));
    assert.doesNotMatch(result.reply, /Готовых документов|отправьте заявку/);
  }
});

test("a policy question during a draft does not replace its details; scholarship requests still need confirmation", async (t) => {
  const f = fixture(t);
  const count = () =>
    f.db
      .prepare(
        "SELECT COUNT(*) AS n FROM records WHERE user_id=? AND kind='requests'",
      )
      .get(USER).n;
  const before = count();
  const draft = await f.assistant.chat(USER, {
    message: "Закажи справку о стипендии",
  });
  assert.equal(draft.action, undefined);
  assert.match(draft.reply, /Уточните.*цель/);
  const policy = await f.assistant.chat(USER, {
    message: "Как задолженность влияет на стипендию?",
    conversationId: draft.conversationId,
  });
  assert.ok(
    policy.sources?.some((source) => /задолженности/.test(source.quote)),
    JSON.stringify(policy),
  );
  assert.equal(policy.action, undefined);
  const prepared = await f.assistant.chat(USER, {
    message: "Для учебной стажировки",
    conversationId: draft.conversationId,
  });
  assert.equal(prepared.action.type, "request.create");
  assert.equal(prepared.action.params.type, "scholarship");
  assert.equal(prepared.action.params.purpose, "учебной стажировки");
  assert.equal(count(), before);
  const first = await f.actions.confirm(USER, prepared.action.id);
  const second = await f.actions.confirm(USER, prepared.action.id);
  assert.equal(first.result.request.id, second.result.request.id);
  assert.equal(count(), before + 1);
});

test("explicit certificate help, grades and a greeting remain read-only", async (t) => {
  const f = fixture(t);
  for (const message of [
    "Как заказать справку о стипендии?",
    "Где готовая справка о стипендии?",
  ]) {
    const answer = await f.assistant.chat(USER, { message });
    assert.ok(answer.links.some((link) => link.route === "requests"));
    assert.equal(answer.action, undefined);
  }
  const grades = await f.assistant.chat(USER, {
    message: "Как у меня с оценками?",
  });
  assert.ok(grades.links.some((link) => link.route === "grades"));
  assert.equal(grades.action, undefined);
  const greeting = await f.assistant.chat(USER, { message: "Привет" });
  assert.ok(greeting.reply);
  assert.equal(greeting.action, undefined);
  assert.equal((await f.actions.list(USER)).actions.length, 0);
});
