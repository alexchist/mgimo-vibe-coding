import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApp } from "../server/app.mjs";

const user = "student-alisa";
function fixture(t, options = {}) {
  const requests = [];
  const app = createApp({
    databasePath: ":memory:",
    assistant: {
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
                    content: JSON.stringify({
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
