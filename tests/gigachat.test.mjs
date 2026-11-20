import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createGigaChat } from "../server/gigachat.mjs";

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
