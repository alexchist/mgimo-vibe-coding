import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../server/app.mjs";

test("a paired VK user receives a certificate request notification through the running worker", async (t) => {
  const recipient = 800001;
  const config = {
    vkToken: "test-community-token",
    vkGroupId: "123456",
    vkWebhookSecret: "test_vk_callback_secret",
    vkConfirmationToken: "test-confirmation",
    vkApiVersion: "5.199",
    allowRealLinking: true,
  };
  const sent = [];
  const app = createApp({
    databasePath: ":memory:",
    secureCookies: false,
    channels: {
      config,
      fetchImpl: async (url, request) => {
        sent.push({
          url,
          method: request.method,
          form: new URLSearchParams(request.body),
        });
        return Response.json({ response: sent.length });
      },
    },
  });
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  t.after(async () => {
    await app.locals.close();
    await new Promise((resolve) => server.close(resolve));
  });
  app.locals.startWorkers();
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const post = (path, body, headers = {}) =>
    fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  const credentials = { login: "alisa@demo.orbita", password: "Orbita2026!" };
  const login = await post("/login", credentials);
  assert.equal(login.status, 200);
  const session = {
    Cookie: login.headers.get("set-cookie").split(";")[0],
    "X-CSRF-Token": (await login.json()).csrfToken,
  };
  const callback = (event) =>
    post("/channels/vk/webhook", {
      group_id: Number(config.vkGroupId),
      secret: config.vkWebhookSecret,
      ...event,
    });
  const confirmation = await callback({ type: "confirmation" });
  assert.equal(confirmation.status, 200);
  assert.equal(await confirmation.text(), config.vkConfirmationToken);
  const pair = await post("/channels/vk/pair", {}, session);
  assert.equal(pair.status, 200);
  const acknowledgement = await callback({
    type: "message_new",
    event_id: "test-private-dialog-message",
    object: {
      message: {
        from_id: recipient,
        peer_id: recipient,
        out: 0,
        conversation_message_id: 15,
        text: (await pair.json()).code,
      },
    },
  });
  assert.equal(acknowledgement.status, 200);
  assert.equal(await acknowledgement.text(), "ok");

  const submission = await post(
    "/requests",
    {
      type: "enrollment",
      purpose: "Проверка учебного сценария",
    },
    session,
  );
  assert.equal(submission.status, 201);
  const { request } = await submission.json();
  await t.waitFor(
    async () => {
      const status = await fetch(base + "/channels", { headers: session });
      assert.equal(status.status, 200);
      const { events } = await status.json();
      const delivered = events.find(
        (event) =>
          event.provider === "vk" && event.body.includes(request.number),
      );
      assert.equal(delivered?.status, "delivered");
      assert.equal(delivered.attempts, 1);
    },
    { interval: 100, timeout: 15000 },
  );

  const deliveries = sent.filter(({ form }) =>
    form.get("message")?.includes(request.number),
  );
  assert.equal(deliveries.length, 1);
  const [{ url, method, form }] = deliveries;
  assert.equal(url, "https://api.vk.com/method/messages.send");
  assert.equal(method, "POST");
  assert.equal(form.get("peer_id"), String(recipient));
  assert.equal(form.get("v"), config.vkApiVersion);
  assert.match(form.get("random_id"), /^[1-9]\d*$/);
  assert.match(form.get("message"), /Справка об обучении/);
});
