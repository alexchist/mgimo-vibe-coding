import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createGigaChat } from "../server/gigachat.mjs";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApp } from "../server/app.mjs";

const user = "student-alisa";
function fixture(t, { answer, ...options } = {}) {
  const requests = [];
  const app = createApp({
    databasePath: ":memory:",
    assistant: {
      now: () => Date.parse("2026-11-16T06:00:00Z"),
      gigachat: {
        credentials: randomUUID(),
        scope: "GIGACHAT_API_PERS",
        model: "GigaChat-3-Pro",
        caFile: "",
        async postJson(url, { body }) {
          requests.push({ url, body });
          if (new URL(url).pathname.endsWith("/oauth"))
            return {
              status: 200,
              payload: {
                access_token: randomUUID(),
                expires_at: Date.now() + 600_000,
              },
            };
          return {
            status: 200,
            payload: {
              model: "GigaChat-3-Pro",
              choices: [
                {
                  finish_reason: "stop",
                  message: {
                    role: "assistant",
                    content: answer
                      ? answer(JSON.parse(body).messages)
                      : JSON.stringify({
                          answer: "Откройте «Навигатор».",
                          citationIds: ["assistant"],
                        }),
                  },
                },
              ],
            },
          };
        },
        ...options,
      },
    },
  });
  t.after(() => app.locals.close());
  return { ...app.locals.services, requests };
}

test("GigaChat only receives opted-in questions and bounded public evidence", async (t) => {
  const { assistant, requests } = fixture(t);
  assert.equal(assistant.status().mode, "gigachat");
  const message = "Что ты умеешь?";
  assert.equal((await assistant.chat(user, { message })).mode, "local");
  assert.equal(
    (await assistant.chat(user, { message, shareQuestion: false })).mode,
    "local",
  );
  assert.equal(requests.length, 0);
  const result = await assistant.chat(user, {
    message,
    shareQuestion: true,
    history: [{ role: "user", content: "PRIVATE-HISTORY" }],
  });
  assert.equal(result.mode, "gigachat");
  assert.equal(result.model, "GigaChat-3-Pro");
  assert.equal(result.links[0].route, "assistant");
  assert.equal(requests.length, 2);
  const envelope = JSON.parse(requests[1].body);
  assert.equal(envelope.function_call, "none");
  assert.equal(envelope.tools, undefined);
  assert.equal(JSON.parse(envelope.messages[1].content).question, message);
  assert.doesNotMatch(requests[1].body, /PRIVATE-HISTORY|student-alisa|Алиса/);
  const followup = await assistant.chat(user, {
    message: "А как?",
    shareQuestion: true,
    conversationId: result.conversationId,
  });
  assert.equal(followup.mode, "gigachat");
  assert.equal(
    JSON.parse(JSON.parse(requests[2].body).messages[1].content)
      .previousQuestion,
    message,
  );
});

test("private matches, account lookups and write proposals stay local with GigaChat enabled", async (t) => {
  const { assistant, knowledge, requests } = fixture(t);
  await knowledge.importDocument(user, {
    title: "Звездолист",
    text: "Звездолист — учебный маркер закрытого документа.",
  });
  const query = "Звездолист";
  assert.equal(
    knowledge.search(user, query, { scope: "shared" }).sources.length,
    0,
  );
  assert.equal(
    knowledge.search("student-mark", query, { scope: "private" }).sources
      .length,
    0,
  );
  const privateReply = await assistant.chat(user, {
    message: query,
    shareQuestion: true,
  });
  assert.equal(privateReply.mode, "local");
  assert.match(privateReply.sources[0].quote, /закрытого документа/);
  await assistant.chat(user, {
    message: "А где?",
    conversationId: privateReply.conversationId,
    shareQuestion: true,
  });
  const schedule = await assistant.chat(user, {
    message: "Моё расписание на завтра",
    shareQuestion: true,
  });
  assert.equal(schedule.links[0].focusId, "day-2");
  const proposal = await assistant.chat(user, {
    message: "Подготовь справку об обучении для учебного клуба",
    shareQuestion: true,
  });
  assert.equal(proposal.mode, "local");
  assert.equal(proposal.action.type, "request.create");
  assert.equal(requests.length, 0);
});

test("invalid GigaChat configuration falls back locally; invalid citations cannot become a route or action", async (t) => {
  const partial = fixture(t, { scope: "", caFile: "" });
  assert.equal(partial.assistant.status().mode, "local");
  const noCa = fixture(t, { caFile: "/missing-gigachat-test-ca.pem" });
  assert.equal(noCa.assistant.status().mode, "local");
  const invalid = fixture(t, {
    async postJson(url) {
      return url.endsWith("/oauth")
        ? {
            status: 200,
            payload: {
              access_token: randomUUID(),
              expires_at: Date.now() + 600_000,
            },
          }
        : {
            status: 200,
            payload: {
              model: "GigaChat-3-Pro",
              choices: [
                {
                  finish_reason: "stop",
                  message: {
                    role: "assistant",
                    content: JSON.stringify({
                      answer: "Выполнено",
                      citationIds: ["invented"],
                    }),
                  },
                },
              ],
            },
          };
    },
  });
  const answer = await invalid.assistant.chat(user, {
    message: "Что ты умеешь?",
    shareQuestion: true,
  });
  assert.equal(answer.mode, "local");
  assert.equal(answer.action, undefined);
  assert.doesNotMatch(answer.reply, /Выполнено/);
});

const messages = [{ role: "user", content: "Мои пары" }];
const model = "GigaChat-3-Pro";
const completion = {
  status: 200,
  payload: {
    model,
    choices: [
      {
        finish_reason: "stop",
        message: { role: "assistant", content: "schedule" },
      },
    ],
  },
};
const settings = {
  credentials: "fixture-key",
  scope: "GIGACHAT_API_PERS",
  model,
  caFile: "",
};

test("native GigaChat authenticates, caches tokens, bounds requests and shares its rolling quota", async (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  let clock = Date.parse("2026-11-19T00:00:00Z");
  const calls = [];
  const options = {
    ...settings,
    now: () => clock,
    postJson: async (url, call) => {
      calls.push({ url, ...call });
      if (url.endsWith("/oauth"))
        return {
          status: 200,
          payload: {
            access_token: "fixture-token",
            expires_at: Math.floor(clock / 1000) + 1800,
          },
        };
      return completion;
    },
  };
  const first = createGigaChat(db, options);
  const second = createGigaChat(db, options);
  assert.deepEqual(await first.complete(messages), {
    model,
    content: "schedule",
  });
  assert.equal(
    calls[0].url,
    "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
  );
  assert.equal(calls[0].body, "scope=GIGACHAT_API_PERS");
  assert.equal(calls[0].headers.Authorization, "Basic fixture-key");
  assert.match(calls[0].headers.RqUID, /^[0-9a-f-]{36}$/i);
  assert.equal(calls[1].url, "https://api.giga.chat/v1/chat/completions");
  assert.equal(calls[1].headers.Authorization, "Bearer fixture-token");
  assert.equal(calls[0].signal, calls[1].signal);
  assert.deepEqual(JSON.parse(calls[1].body), {
    model,
    messages,
    temperature: 0.1,
    max_tokens: 320,
    stream: false,
    function_call: "none",
  });
  await assert.rejects(
    first.complete([{ role: "user", content: "я".repeat(4096) }]),
    /Oversized/,
  );
  for (let index = 0; index < 5; index++) await first.complete(messages);
  assert.equal(calls.length, 7);
  assert.deepEqual(await second.complete(messages), { limited: true });
  for (let minute = 1; minute <= 9; minute++) {
    clock += 60_000;
    for (let index = 0; index < 6; index++) await second.complete(messages);
  }
  clock += 60_000;
  assert.deepEqual(await first.complete(messages), { limited: true });
  clock += 24 * 60 * 60_000;
  assert.deepEqual(await first.complete(messages), {
    model,
    content: "schedule",
  });
  assert.equal(calls.filter((call) => call.url.endsWith("/oauth")).length, 3);
});

test("GigaChat does not retry, fails on silent model downgrade and releases its in-flight slot", async (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const calls = [];
  const provider = createGigaChat(db, {
    ...settings,
    timeoutMs: 30,
    async postJson(url, { signal }) {
      calls.push(url);
      if (url.endsWith("/oauth"))
        return {
          status: 200,
          payload: { access_token: "fixture", expires_at: Date.now() + 60_000 },
        };
      if (calls.length === 2)
        return new Promise((_, reject) => {
          const keepAlive = setTimeout(() => {}, 1000);
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(keepAlive);
              reject(signal.reason);
            },
            { once: true },
          );
        });
      if (calls.length === 3) return { status: 401 };
      return {
        ...completion,
        payload: { ...completion.payload, model: "GigaChat-2-Pro" },
      };
    },
  });
  const pending = provider.complete(messages);
  assert.deepEqual(await provider.complete(messages), { busy: true });
  await assert.rejects(pending, { name: "TimeoutError" });
  await assert.rejects(
    provider.complete(messages),
    /Unexpected GigaChat response/,
  );
  assert.equal(calls.length, 3);
  await assert.rejects(
    provider.complete(messages),
    /Unexpected GigaChat response/,
  );
  assert.equal(calls.length, 5);
  assert.equal(calls.filter((url) => url.endsWith("/oauth")).length, 2);
});

test("GigaChat stays disabled with incomplete settings or an unreadable CA", (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  for (const options of [
    { ...settings, scope: "" },
    { ...settings, caFile: "/dev/null" },
  ]) {
    const provider = createGigaChat(db, options);
    assert.equal(provider.requested, true);
    assert.equal(provider.status().configured, false);
    assert.equal(provider.status().mode, "local");
  }
  assert.equal(
    createGigaChat(db, { ...settings, scope: "", credentials: "" }).requested,
    false,
  );
});

test("opted-in general questions receive model text without portal sources, tools or browser history", async (t) => {
  const cases = new Map([
    ["Сколько будет 2 + 1?", "3"],
    ["Сколько будет 2 + 2?", "4"],
    ["Напиши 5", "5"],
    [
      "Как мне подготовиться к экзамену?",
      "Начните с самопроверки по одному билету.",
    ],
    ["Объясни, что такое инфляция", "Инфляция — рост общего уровня цен."],
    ["Реши задачу: сколько будет 7 минус 3?", "Ответ тестовой модели"],
  ]);
  const { assistant, requests } = fixture(t, {
    answer(messages) {
      assert.equal(messages.length, 2);
      assert.equal(messages[0].role, "system");
      assert.doesNotMatch(
        messages[0].content,
        /citationIds|откройте|источни|JSON/,
      );
      const input = JSON.parse(messages[1].content);
      assert.deepEqual(Object.keys(input), ["question"]);
      return cases.get(input.question);
    },
  });
  for (const [message, reply] of cases) {
    const result = await assistant.chat(user, {
      message,
      shareQuestion: true,
      history: [{ role: "assistant", content: "PRIVATE-BROWSER-CONTENT" }],
    });
    assert.equal(result.mode, "gigachat", message);
    assert.equal(result.reply, reply);
    assert.deepEqual(result.links, []);
    assert.deepEqual(result.sources, []);
    assert.equal(result.action, undefined);
  }
  const calls = requests.filter(({ url }) => !url.endsWith("/oauth"));
  assert.equal(calls.length, cases.size);
  for (const { body } of calls) {
    assert.equal(JSON.parse(body).function_call, "none");
    assert.doesNotMatch(
      body,
      /PRIVATE-BROWSER-CONTENT|student-alisa|Алиса|демодокумент/,
    );
  }
});

test("general follow-ups can use the last shared question, and an unshared turn cannot be replayed", async (t) => {
  const { assistant, requests } = fixture(t, {
    answer: () => "Продолжение модели",
  });
  const ask = (message, conversationId, shareQuestion = true) =>
    assistant.chat(user, { message, conversationId, shareQuestion });
  const first = await ask("Объясни инфляцию");
  const second = await ask("А почему?", first.conversationId);
  assert.equal(second.mode, "gigachat");
  const followup = JSON.parse(
    JSON.parse(requests.at(-1).body).messages[1].content,
  );
  assert.deepEqual(followup, {
    question: "А почему?",
    previousQuestion: "Объясни инфляцию",
  });

  const unshared = await ask(
    "Объясни PRIVATE-LOCAL-QUESTION",
    first.conversationId,
    false,
  );
  assert.equal(unshared.mode, "local");
  assert.deepEqual(unshared.links, []);
  assert.doesNotMatch(unshared.reply, /не нашёл подтверждения/);
  const after = await ask("Расскажи подробнее", first.conversationId);
  assert.equal(after.mode, "local");
  assert.equal(requests.length, 3);
  const independent = await ask("Напиши слово ЗЕБРА", first.conversationId);
  assert.equal(independent.mode, "gigachat");
  assert.doesNotMatch(
    requests.at(-1).body,
    /PRIVATE-LOCAL-QUESTION|инфляцию|подробнее/,
  );
});

test("each answer type has its own validation and failure explanation", async (t) => {
  const invalid = fixture(t, {
    answer: () =>
      JSON.stringify({ answer: "ПОДМЕНА", citationIds: [], action: {} }),
  });
  const timedOut = fixture(t, {
    postJson: async () => {
      throw new DOMException("sensitive provider detail", "TimeoutError");
    },
  });
  const broken = fixture(t, { answer: () => "" });
  for (const [service, reason] of [
    [invalid, /формата/],
    [timedOut, /не успел/],
    [broken, /неполный|неподдерживаемый/],
  ]) {
    const answer = await service.assistant.chat(user, {
      message: "Напиши число",
      shareQuestion: true,
    });
    assert.equal(answer.mode, "local");
    assert.match(answer.warning, reason);
    assert.deepEqual(answer.links, []);
    assert.deepEqual(answer.sources, []);
    assert.equal(answer.action, undefined);
    assert.doesNotMatch(
      JSON.stringify(answer),
      /ПОДМЕНА|sensitive provider detail|не нашёл подтверждения/,
    );
  }
  const fabricated = fixture(t, {
    answer: () => "Отмена разрешена за минуту до начала.",
  });
  const policy = await fabricated.assistant.chat(user, {
    message: "Какие правила бронирования?",
    shareQuestion: true,
  });
  assert.equal(policy.mode, "local");
  assert.match(policy.warning, /проверку источников/);
  assert.ok(policy.sources.length);
  assert.doesNotMatch(policy.reply, /за минуту/);
});

test("portal facts require document citations and pending drafts keep unrelated inputs on the server", async (t) => {
  const { assistant, requests } = fixture(t, {
    answer: () =>
      JSON.stringify({ answer: "ПОДМЕНА", citationIds: ["campus"] }),
  });
  const rules = await assistant.chat(user, {
    message: "Какие правила бронирования?",
    shareQuestion: true,
  });
  assert.match(rules.warning, /проверку источников/);
  assert.doesNotMatch(rules.reply, /ПОДМЕНА/);
  const start = requests.length;
  const draft = await assistant.chat(user, {
    message: "Закажи справку об обучении",
    shareQuestion: true,
  });
  assert.match(draft.reply, /Уточните/);
  const question = await assistant.chat(user, {
    conversationId: draft.conversationId,
    message: "PRIVATE-DRAFT-CONTEXT",
    shareQuestion: true,
  });
  assert.equal(question.mode, "local");
  const prepared = await assistant.chat(user, {
    conversationId: draft.conversationId,
    message: "Для учебного клуба",
    shareQuestion: true,
  });
  assert.equal(prepared.action.type, "request.create");
  assert.equal(requests.length, start);
  assert.doesNotMatch(
    JSON.stringify(requests),
    /PRIVATE-DRAFT-CONTEXT|учебного клуба/,
  );
});

test("a new topic discards prior context, including after a local search in a private document", async (t) => {
  const { assistant, knowledge, requests } = fixture(t, {
    answer: () => "Ответ модели",
  });
  const ask = (message, conversationId, shareQuestion) =>
    assistant.chat(user, { message, conversationId, shareQuestion });
  const first = await ask("Объясни фотосинтез", undefined, true);
  const arithmetic = "А сколько будет 2 + 2?";
  await ask(arithmetic, first.conversationId, true);
  const packet = () =>
    JSON.parse(JSON.parse(requests.at(-1).body).messages[1].content);
  assert.deepEqual(packet(), { question: arithmetic });
  await knowledge.importDocument(user, {
    title: "Папоротник",
    text: "Папоротник — ПРИВАТНАЯ ЦИТАТА.",
  });
  const privateResult = await ask("Папоротник", first.conversationId, false);
  assert.match(privateResult.sources[0].quote, /ПРИВАТНАЯ ЦИТАТА/);
  const before = requests.length;
  assert.equal(
    (await ask("А что там написано?", first.conversationId, false)).mode,
    "local",
  );
  assert.equal(
    (await ask("Расскажи подробнее", first.conversationId, true)).mode,
    "local",
  );
  assert.equal(requests.length, before);
  assert.equal(
    (await ask(arithmetic, first.conversationId, true)).mode,
    "gigachat",
  );
  assert.deepEqual(packet(), { question: arithmetic });
  assert.doesNotMatch(JSON.stringify(requests), /Папоротник|ПРИВАТНАЯ ЦИТАТА/);
});

test("a general question above the provider byte budget reports its length locally", async (t) => {
  const { assistant, requests } = fixture(t);
  // The request is within the character limit; escaping it in the envelope exceeds 8 KiB.
  const message = "Повтори " + "\\".repeat(1980);
  const result = await assistant.chat(user, { message, shareQuestion: true });
  assert.equal(result.mode, "local");
  assert.match(result.warning, /Сократите текст/);
  assert.doesNotMatch(result.warning, /источник/);
  assert.deepEqual(result.links, []);
  assert.deepEqual(requests, []);
});

test("calculation and research methods go to the model while personal rooms and grades stay local", async (t) => {
  const { assistant, requests } = fixture(t, {
    answer: () => "Ответ модели о методе",
  });
  for (const message of [
    "Как определить целевую аудиторию проекта?",
    "Как вычислить средний балл по трём числам?",
    "Как посчитать площадь комнаты?",
  ]) {
    const result = await assistant.chat(user, { message, shareQuestion: true });
    assert.equal(result.mode, "gigachat", message);
    assert.equal(result.reply, "Ответ модели о методе");
    assert.deepEqual(
      JSON.parse(JSON.parse(requests.at(-1).body).messages[1].content),
      { question: message },
    );
  }
  const sent = requests.length;
  for (const [message, route, output] of [
    ["В какой аудитории моя первая пара?", "schedule", /аудитория/],
    ["Какой у меня средний балл?", "grades", /из 100/],
    ["Посчитай мой средний балл", "grades", /из 100/],
    ["Какие помещения кампуса доступны?", "campus", /помещения/],
  ]) {
    const result = await assistant.chat(user, { message, shareQuestion: true });
    assert.equal(result.mode, "local", message);
    assert.equal(result.links[0].route, route, message);
    assert.match(result.reply, output, message);
  }
  assert.equal(requests.length, sent);
});

test("personal document plurals and follow-ups search only the owner's uploads", async (t) => {
  const { assistant, knowledge, requests } = fixture(t);
  await knowledge.importDocument(user, {
    title: "О конференции",
    text: "Лимит участия в конференции — двое студентов.",
  });
  const message = "Что сказано в моих документах о конференции?";
  const found = await assistant.chat(user, { message, shareQuestion: true });
  assert.equal(found.mode, "local");
  assert.match(found.sources[0].quote, /двое студентов/);
  assert.equal(found.links[0].route, "knowledge");
  const followup = await assistant.chat(user, {
    message: "А какое в нём главное требование?",
    conversationId: found.conversationId,
    shareQuestion: true,
  });
  assert.equal(followup.sources[0].documentId, found.sources[0].documentId);
  const empty = await assistant.chat("student-mark", {
    message,
    shareQuestion: true,
  });
  assert.equal(empty.mode, "local");
  assert.deepEqual(empty.sources, []);
  assert.deepEqual(requests, []);
});

test("a teacher follow-up resolves another subject locally until the topic changes", async (t) => {
  const { assistant, requests } = fixture(t, {
    answer: () => "Общий ответ модели",
  });
  const first = await assistant.chat(user, {
    message: "Как зовут преподавателя по географии?",
    shareQuestion: false,
  });
  assert.match(first.reply, /Есения Радова/);
  const ask = (message) =>
    assistant.chat(user, {
      message,
      conversationId: first.conversationId,
      shareQuestion: true,
    });
  const second = await ask("А по английскому?");
  assert.equal(second.mode, "local");
  assert.match(second.reply, /Даниил Леснев/);
  assert.notEqual(second.links[0].focusId, first.links[0].focusId);
  assert.deepEqual(requests, []);
  assert.equal((await ask("Напиши число")).mode, "gigachat");
  assert.equal((await ask("А по английскому?")).mode, "gigachat");
  assert.doesNotMatch(JSON.stringify(requests), /Есения|Леснев|по географии/);
});
