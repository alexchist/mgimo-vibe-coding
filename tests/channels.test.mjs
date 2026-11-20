import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { installChannels } from "../server/channels.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const configured = {
  telegramToken: "test-telegram-token",
  telegramUsername: "orbita_test_bot",
  telegramWebhookSecret: "test_telegram_webhook_secret",
  vkToken: "test-vk-token",
  vkGroupId: "123456",
  vkWebhookSecret: "test_vk_webhook_secret",
  vkConfirmationToken: "test-confirmation",
  vkApiVersion: "5.199",
  allowRealLinking: true,
};
const noConfig = {
  telegramToken: "",
  telegramUsername: "",
  telegramWebhookSecret: "",
  vkToken: "",
  vkGroupId: "",
  vkWebhookSecret: "",
  vkConfirmationToken: "",
  allowRealLinking: false,
};
const sample = (id = "event-1") => ({
  id,
  title: "Бронь подтверждена",
  body: "Ваша переговорная забронирована.",
  category: "booking",
});

async function harness(t, options = {}) {
  const db = new DatabaseSync(options.databasePath || ":memory:");
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf_token TEXT NOT NULL,expires_at INTEGER NOT NULL);
    INSERT OR IGNORE INTO users VALUES ('alice'),('bob');`);
  let current = Date.UTC(2026, 10, 16, 8);
  for (const user of ["alice", "bob"])
    db.prepare("INSERT OR IGNORE INTO sessions VALUES (?,?,?,?)").run(
      sha(user),
      user,
      `csrf-${user}`,
      current + 86400000,
    );
  const app = express();
  app.use(express.json({ limit: "16kb" }));
  const authenticate = (req, res, next) => {
    const session = db
      .prepare("SELECT * FROM sessions WHERE token_hash=? AND expires_at>?")
      .get(sha(req.get("X-Test-Session") || ""), current);
    if (!session) return res.status(401).json({ error: "Нет сессии" });
    if (
      !["GET", "HEAD"].includes(req.method) &&
      req.get("X-CSRF-Token") !== session.csrf_token
    )
      return res.status(403).json({ error: "Нет CSRF" });
    req.user = { id: session.user_id };
    req.session = session;
    next();
  };
  const calls = [];
  const service = installChannels(app, db, authenticate, {
    config: { ...noConfig, ...options.config },
    now: () => current,
    fetchImpl: async (...args) => {
      calls.push(args);
      if (!options.fetchImpl)
        throw new Error(
          "Unexpected provider request: network disabled in tests",
        );
      return options.fetchImpl(...args);
    },
  });
  app.use((error, req, res, next) =>
    res.status(error.status || 500).json({ error: error.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await service.close();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  };
  t.after(close);
  const request = async (
    route,
    { user = "alice", method = "GET", body, headers = {}, csrf = true } = {},
  ) => {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(user ? { "X-Test-Session": user } : {}),
        ...(csrf && user ? { "X-CSRF-Token": `csrf-${user}` } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: response.status, data };
  };
  let nextUpdate = 1;
  const telegram = (
    code,
    {
      recipient = 700001,
      from = recipient,
      type = "private",
      updateId = nextUpdate++,
      secret = configured.telegramWebhookSecret,
    } = {},
  ) =>
    request("/api/channels/telegram/webhook", {
      user: null,
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": secret },
      body: {
        update_id: updateId,
        message: {
          from: { id: from },
          chat: { id: recipient, type },
          text: `/start ${code}`,
        },
      },
    });
  const vk = (
    code,
    {
      recipient = 800001,
      peer = recipient,
      eventId = `event-${nextUpdate++}`,
      groupId = Number(configured.vkGroupId),
      secret = configured.vkWebhookSecret,
    } = {},
  ) =>
    request("/api/channels/vk/webhook", {
      user: null,
      method: "POST",
      body: {
        type: "message_new",
        group_id: groupId,
        secret,
        event_id: eventId,
        object: { message: { from_id: recipient, peer_id: peer, text: code } },
      },
    });
  const pair = (provider = "telegram", user = "alice") =>
    service.createPairing(user, sha(user), provider);
  return {
    db,
    service,
    calls,
    request,
    telegram,
    vk,
    pair,
    close,
    advance: (ms) => {
      current += ms;
    },
  };
}

test("demo channel delivery is durable, isolated, idempotent and never sends externally", async (t) => {
  const h = await harness(t);
  assert.equal((await h.request("/api/channels", { user: null })).status, 401);
  assert.equal(
    (
      await h.request("/api/channels/telegram/demo-connect", {
        method: "POST",
        body: {},
        csrf: false,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await h.request("/api/channels/telegram/demo-connect", {
        method: "POST",
        body: { userId: "bob", recipient: "123" },
      })
    ).status,
    400,
  );
  await h.request("/api/channels/telegram/demo-connect", {
    method: "POST",
    body: {},
  });
  h.service.connectDemo("alice", "vk");
  h.db.exec("BEGIN IMMEDIATE");
  assert.equal(h.service.enqueue("alice", sample()).length, 2);
  assert.deepEqual(h.service.enqueue("alice", sample()), []);
  h.db.exec("COMMIT");
  await h.service.flush();
  assert.equal(h.calls.length, 0);
  assert.equal(h.service.snapshot("alice").events.length, 2);
  assert.ok(
    h.service
      .snapshot("alice")
      .events.every((event) => event.status === "demo" && event.attempts === 0),
  );
  assert.deepEqual(h.service.snapshot("bob").events, []);
  assert.ok(
    h.service
      .snapshot("bob")
      .channels.every((channel) => channel.connection === null),
  );
  assert.equal(
    (
      await h.request("/api/channels/telegram/pair", {
        method: "POST",
        body: {},
      })
    ).status,
    403,
  );
  assert.equal(
    (await h.request("/api/channels/test", { method: "POST", body: {} }))
      .status,
    200,
  );
  assert.equal(
    (await h.request("/api/channels/test", { method: "POST", body: {} }))
      .status,
    429,
  );
});

test("even configured adapters need the explicit real linking flag", async (t) => {
  const h = await harness(t, {
    config: { ...configured, allowRealLinking: false },
  });
  const status = h.service.snapshot("alice");
  assert.ok(
    status.channels.every(
      (channel) => channel.configured && !channel.liveAllowed,
    ),
  );
  assert.throws(() => h.pair(), { status: 403 });
  const json = JSON.stringify(status);
  for (const secret of [
    configured.telegramToken,
    configured.vkToken,
    configured.telegramWebhookSecret,
    configured.vkWebhookSecret,
  ])
    assert.equal(json.includes(secret), false);
  h.service.connectDemo("alice", "telegram");
  h.service.enqueue("alice", sample());
  await h.service.flush();
  assert.equal(h.calls.length, 0);
});

test("Telegram pairing requires secret, private matching sender, single-use code and session ownership", async (t) => {
  const h = await harness(t, { config: configured });
  const pair = h.pair();
  assert.match(
    pair.url,
    /^https:\/\/t\.me\/orbita_test_bot\?start=orbita_[a-f0-9]{32}$/,
  );
  assert.equal(
    h.db.prepare("SELECT code_hash FROM channel_pairings").get().code_hash,
    sha(pair.code),
  );
  assert.throws(
    () => h.service.createPairing("bob", sha("alice"), "telegram"),
    { status: 401 },
  );
  assert.throws(() => h.pair(), { status: 429 });
  assert.equal((await h.telegram(pair.code, { secret: "wrong" })).status, 403);
  await h.telegram(pair.code, { type: "group" });
  await h.telegram(pair.code, { from: 700002 });
  assert.equal(h.service.snapshot("alice").channels[0].connection, null);
  await h.telegram(pair.code, { updateId: 100 });
  const bound = h.db
    .prepare("SELECT * FROM channel_bindings WHERE provider='telegram'")
    .get();
  assert.equal(bound.user_id, "alice");
  assert.equal(bound.recipient, "700001");
  assert.equal(
    h.service.snapshot("alice").channels[0].connection.recipientLabel,
    "Личный диалог · …0001",
  );
  await h.telegram(pair.code, { updateId: 100, recipient: 999999 });
  await h.telegram(pair.code, { updateId: 101, recipient: 999999 });
  assert.equal(
    h.db.prepare("SELECT id FROM channel_bindings").get().id,
    bound.id,
  );
  assert.equal(h.service.snapshot("bob").channels[0].connection, null);
  const bob = h.pair("telegram", "bob");
  await h.telegram(bob.code, { updateId: 102 });
  assert.equal(
    h.service.snapshot("bob").channels[0].connection,
    null,
    "one recipient cannot bind another account",
  );
  h.service.disconnect("alice", "telegram");
  assert.equal(
    h.db
      .prepare(
        "SELECT COUNT(*) AS n FROM channel_pairings WHERE user_id='alice'",
      )
      .get().n,
    0,
  );
});

test("pairing expires, is provider-bound, and cannot survive originating session logout", async (t) => {
  const h = await harness(t, { config: configured });
  const expired = h.pair();
  await h.vk(expired.code);
  assert.ok(
    h.service
      .snapshot("alice")
      .channels.every((channel) => !channel.connection),
  );
  h.advance(10 * 60000 + 1);
  await h.telegram(expired.code);
  assert.equal(h.service.snapshot("alice").channels[0].connection, null);
  const loggedOut = h.pair();
  h.db.prepare("DELETE FROM sessions WHERE user_id='alice'").run();
  await h.telegram(loggedOut.code);
  assert.equal(h.service.snapshot("alice").channels[0].connection, null);
});

test("VK verifies group, secret, private sender and deduplicates callback IDs", async (t) => {
  const h = await harness(t, { config: configured });
  const confirmation = await h.request("/api/channels/vk/webhook", {
    user: null,
    method: "POST",
    body: {
      type: "confirmation",
      group_id: Number(configured.vkGroupId),
      secret: configured.vkWebhookSecret,
    },
  });
  assert.equal(confirmation.data, configured.vkConfirmationToken);
  const pair = h.pair("vk");
  assert.equal(pair.url, "https://vk.me/club123456");
  assert.equal((await h.vk(pair.code, { secret: "wrong" })).status, 403);
  assert.equal((await h.vk(pair.code, { groupId: 123457 })).status, 403);
  await h.vk(pair.code, { peer: 2000000001 });
  await h.vk(pair.code, { recipient: -800001 });
  await h.vk(pair.code, { recipient: 2000000001 });
  assert.equal(h.service.snapshot("alice").channels[1].connection, null);
  assert.equal((await h.vk(pair.code, { eventId: "callback-1" })).data, "ok");
  const id = h.db.prepare("SELECT id FROM channel_bindings").get().id;
  await h.vk(pair.code, { eventId: "callback-1", recipient: 800002 });
  assert.equal(h.db.prepare("SELECT id FROM channel_bindings").get().id, id);
  assert.equal(
    h.db.prepare("SELECT recipient FROM channel_bindings").get().recipient,
    "800001",
  );
});

test("VK reports invalid configuration and only confirms a correctly configured callback", async (t) => {
  const callback = {
    type: "confirmation",
    group_id: Number(configured.vkGroupId),
    secret: configured.vkWebhookSecret,
  };
  const invalid = await harness(t, {
    config: {
      ...configured,
      vkGroupId: "club123456",
      vkWebhookSecret: "x".repeat(51),
      vkApiVersion: "version",
    },
  });
  const channel = invalid.service
    .snapshot("alice")
    .channels.find((row) => row.provider === "vk");
  assert.equal(channel.liveAllowed, false);
  assert.deepEqual(channel.invalidSettings.sort(), [
    "VK_API_VERSION",
    "VK_GROUP_ID",
    "VK_WEBHOOK_SECRET",
  ]);
  const incomplete = await harness(t, {
    config: { ...configured, vkConfirmationToken: "" },
  });
  const confirm = (h, body) =>
    h.request("/api/channels/vk/webhook", { user: null, method: "POST", body });
  assert.equal((await confirm(incomplete, callback)).status, 503);
  const disabled = await harness(t, {
    config: { ...configured, vkToken: "", allowRealLinking: false },
  });
  assert.equal(
    (await confirm(disabled, callback)).data,
    configured.vkConfirmationToken,
  );
  assert.equal(
    (await confirm(disabled, { ...callback, secret: "wrong" })).status,
    403,
  );
});

test("a VK-only test cannot reach another channel and distinguishes acceptance, rejection and ambiguous responses", async (t) => {
  let reply = { response: 0 };
  const h = await harness(t, {
    config: configured,
    fetchImpl: async () => Response.json(reply),
  });
  const send = (body = {}) =>
    h.request("/api/channels/vk/test", { method: "POST", body });
  h.service.connectDemo("alice", "telegram");
  assert.equal((await send()).status, 400);
  await h.vk(h.pair("vk").code);
  assert.equal((await send({ peer_id: 123456 })).status, 400);
  for (const [response, status, errorCode] of [
    [{ response: 0 }, "delivered", null],
    [{ response: 35 }, "delivered", null],
    [{ error: { error_code: 901 } }, "failed", "vk_messages_denied"],
    [{}, "uncertain", "unreadable_response"],
    [{ response: "1" }, "uncertain", "unreadable_response"],
    [{ response: -1 }, "uncertain", "unreadable_response"],
  ]) {
    h.advance(6000);
    reply = response;
    assert.equal((await send()).status, 200);
    await h.service.flush();
    const event = h.service.snapshot("alice").events[0];
    assert.equal(event.status, status);
    assert.equal(event.errorCode, errorCode);
  }
  assert.ok(
    h.service.snapshot("alice").events.every((row) => row.provider === "vk"),
  );
  assert.deepEqual(h.service.snapshot("bob").events, []);
});

test("VK message_deny checks current permission and removes only the binding that was checked", async (t) => {
  let permission = () => Response.json({ response: { is_allowed: 1 } });
  const h = await harness(t, {
    config: configured,
    fetchImpl: async (url, request) => {
      assert.equal(
        url,
        "https://api.vk.com/method/messages.isMessagesFromGroupAllowed",
      );
      assert.equal(request.method, "POST");
      assert.equal(request.redirect, "error");
      const body = new URLSearchParams(request.body);
      assert.equal(body.get("user_id"), "800001");
      assert.equal(body.get("group_id"), configured.vkGroupId);
      assert.equal(body.get("access_token"), configured.vkToken);
      return permission();
    },
  });
  const deny = (id) =>
    h.request("/api/channels/vk/webhook", {
      user: null,
      method: "POST",
      body: {
        type: "message_deny",
        group_id: 123456,
        event_id: id,
        secret: configured.vkWebhookSecret,
        object: { user_id: 800001 },
      },
    });
  const account = () =>
    h.service.snapshot("alice").channels.find((row) => row.provider === "vk")
      .connection;
  await h.vk(h.pair("vk").code);
  await deny("out-of-order"); // User already granted permission again.
  assert.equal(account().mode, "live");
  permission = () => Response.json({ error: { error_code: 6 } });
  assert.equal((await deny("retry")).status, 503);
  assert.equal(account().mode, "live");
  let unblock;
  let queryStarted;
  const checking = new Promise((resolve) => {
    queryStarted = resolve;
  });
  permission = () =>
    new Promise((resolve) => {
      unblock = resolve;
      queryStarted();
    });
  const inFlight = deny("race");
  await checking;
  h.advance(6000);
  await h.vk(h.pair("vk").code);
  unblock(Response.json({ response: { is_allowed: 0 } }));
  assert.equal((await inFlight).data, "ok");
  assert.equal(account().mode, "live");
  h.service.enqueue("alice", sample());
  permission = () => Response.json({ response: { is_allowed: 0 } });
  assert.equal((await deny("retry")).data, "ok");
  assert.equal(account(), null);
  assert.equal(h.service.snapshot("alice").events[0].status, "cancelled");
  h.advance(6000);
  await h.vk(h.pair("vk").code);
  const previousCalls = h.calls.length;
  assert.equal((await deny("retry")).data, "ok");
  assert.equal(account().mode, "live");
  assert.equal(h.calls.length, previousCalls);
});

test("outbox sends once per event, serializes flushes and cancels stale bindings", async (t) => {
  const h = await harness(t, {
    config: configured,
    fetchImpl: async () =>
      Response.json({ ok: true, result: { message_id: 44 } }),
  });
  await h.telegram(h.pair().code);
  h.service.enqueue("alice", sample());
  h.service.enqueue("alice", sample());
  await Promise.all([h.service.flush(), h.service.flush()]);
  assert.equal(h.calls.length, 1);
  const [url, request] = h.calls[0];
  assert.equal(
    url,
    `https://api.telegram.org/bot${configured.telegramToken}/sendMessage`,
  );
  assert.equal(request.method, "POST");
  assert.equal(
    request.redirect,
    "error",
    "provider credentials cannot follow redirects",
  );
  assert.equal(JSON.parse(request.body).chat_id, "700001");
  assert.equal(JSON.parse(request.body).protect_content, true);
  assert.equal(h.service.snapshot("alice").events[0].status, "delivered");
  h.service.enqueue("alice", sample("cancelled-event"));
  h.service.disconnect("alice", "telegram");
  await h.service.flush();
  assert.equal(h.calls.length, 1);
  assert.equal(h.service.snapshot("alice").events[0].status, "cancelled");
  h.service.connectDemo("alice", "telegram");
  await h.service.flush();
  assert.equal(h.calls.length, 1);
});

test("VK rate limits retry at most three times using the same random_id", async (t) => {
  const h = await harness(t, {
    config: configured,
    fetchImpl: async () => Response.json({ error: { error_code: 6 } }),
  });
  await h.vk(h.pair("vk").code);
  h.service.enqueue("alice", sample());
  await h.service.flush();
  assert.equal(h.service.snapshot("alice").events[0].status, "pending");
  await h.service.flush();
  assert.equal(h.calls.length, 1, "respect retry delay");
  h.advance(31000);
  await h.service.flush();
  h.advance(61000);
  await h.service.flush();
  h.advance(3600000);
  await h.service.flush();
  assert.equal(h.calls.length, 3);
  const bodies = h.calls.map(([url, request]) => {
    assert.equal(url, "https://api.vk.com/method/messages.send");
    assert.equal(request.redirect, "error");
    return new URLSearchParams(request.body);
  });
  assert.equal(new Set(bodies.map((body) => body.get("random_id"))).size, 1);
  assert.equal(bodies[0].get("access_token"), configured.vkToken);
  assert.equal(bodies[0].get("v"), "5.199");
  assert.equal(bodies[0].get("peer_id"), "800001");
  const event = h.service.snapshot("alice").events[0];
  assert.equal(event.status, "failed");
  assert.equal(event.errorCode, "retry_limit");
  assert.equal(event.attempts, 3);
});

test("ambiguous delivery is not resent and failed provider payloads never reach clients", async (t) => {
  const h = await harness(t, {
    config: configured,
    fetchImpl: async () => {
      throw new Error(`lost response secret=${configured.telegramToken}`);
    },
  });
  await h.telegram(h.pair().code);
  h.service.enqueue("alice", sample());
  await h.service.flush();
  h.advance(3600000);
  await h.service.flush();
  assert.equal(h.calls.length, 1);
  const event = h.service.snapshot("alice").events[0];
  assert.equal(event.status, "uncertain");
  assert.equal(event.errorCode, "response_lost");
  assert.equal(JSON.stringify(event).includes(configured.telegramToken), false);
});

test("unlink during an active send keeps an honest unknown status and prevents retries", async (t) => {
  let finishRequest;
  const response = new Promise((resolve) => {
    finishRequest = resolve;
  });
  const h = await harness(t, {
    config: configured,
    fetchImpl: async () => response,
  });
  await h.telegram(h.pair().code);
  h.service.enqueue("alice", sample());
  const flushing = h.service.flush();
  assert.equal(h.calls.length, 1);
  h.service.disconnect("alice", "telegram");
  finishRequest(Response.json({ ok: true, result: { message_id: 101 } }));
  await flushing;
  const event = h.service.snapshot("alice").events[0];
  assert.equal(event.status, "uncertain");
  assert.equal(event.errorCode, "disconnected_in_flight");
  h.advance(3600000);
  await h.service.flush();
  assert.equal(h.calls.length, 1);
});

test("pending delivery and deduplication survive database reopen without automatic sending", async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "orbita-channel-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const databasePath = path.join(directory, "channels.sqlite");
  const first = await harness(t, { databasePath, config: configured });
  await first.telegram(first.pair().code);
  first.service.enqueue("alice", sample("persisted-event"));
  await first.close();
  const second = await harness(t, {
    databasePath,
    config: configured,
    fetchImpl: async () =>
      Response.json({ ok: true, result: { message_id: 100 } }),
  });
  assert.equal(second.calls.length, 0);
  assert.equal(second.service.snapshot("alice").events[0].status, "pending");
  assert.deepEqual(
    second.service.enqueue("alice", sample("persisted-event")),
    [],
  );
  await second.service.flush();
  assert.equal(second.calls.length, 1);
  assert.equal(second.service.snapshot("alice").events[0].status, "delivered");
  await second.close();
});
