import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

const PROVIDERS = ["telegram", "vk"];
const TITLES = { telegram: "Telegram", vk: "VK" };
const hash = (value) => createHash("sha256").update(value).digest("hex");
const fail = (status, message) => {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  throw error;
};
const constantEqual = (left, right) => {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left),
    b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
const positiveId = (value) =>
  Number.isSafeInteger(Number(value)) && Number(value) > 0;
const emptyBody = (body) =>
  !body ||
  (typeof body === "object" &&
    !Array.isArray(body) &&
    Object.keys(body).length === 0);

/** Durable, per-account delivery. No worker or external request starts on installation. */
export function installChannels(app, db, authenticate, options = {}) {
  const config = {
    telegramToken: process.env.TELEGRAM_BOT_TOKEN || "",
    telegramUsername: process.env.TELEGRAM_BOT_USERNAME || "",
    telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || "",
    vkToken: process.env.VK_GROUP_TOKEN || "",
    vkGroupId: process.env.VK_GROUP_ID || "",
    vkWebhookSecret: process.env.VK_WEBHOOK_SECRET || "",
    vkConfirmationToken: process.env.VK_CONFIRMATION_TOKEN || "",
    vkApiVersion: process.env.VK_API_VERSION || "5.199",
    allowRealLinking: process.env.ALLOW_REAL_CHANNEL_LINKING === "true",
    ...options.config,
  };
  const now = options.now || Date.now;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  let timer = null,
    flushing = null,
    closed = false;
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_bindings (
      user_id TEXT NOT NULL REFERENCES users(id), provider TEXT NOT NULL,
      id TEXT NOT NULL UNIQUE, mode TEXT NOT NULL, recipient TEXT NOT NULL,
      connected_at INTEGER NOT NULL, PRIMARY KEY(user_id, provider), UNIQUE(provider, recipient)
    );
    CREATE TABLE IF NOT EXISTS channel_pairings (
      code_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      session_hash TEXT NOT NULL, provider TEXT NOT NULL,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS channel_pairings_owner ON channel_pairings(user_id, provider);
    CREATE TABLE IF NOT EXISTS channel_outbox (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
      provider TEXT NOT NULL, binding_id TEXT NOT NULL, mode TEXT NOT NULL,
      title TEXT NOT NULL, body TEXT NOT NULL, category TEXT NOT NULL,
      status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, next_attempt_at INTEGER NOT NULL,
      lease_until INTEGER, provider_message_id TEXT, error_code TEXT,
      UNIQUE(user_id, event_id, provider)
    );
    CREATE INDEX IF NOT EXISTS channel_outbox_due ON channel_outbox(status, next_attempt_at);
    CREATE INDEX IF NOT EXISTS channel_outbox_owner ON channel_outbox(user_id, created_at);
    CREATE TABLE IF NOT EXISTS channel_webhook_receipts (
      provider TEXT NOT NULL, event_id TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY(provider, event_id)
    );
  `);

  function provider(value) {
    if (!PROVIDERS.includes(value)) fail(404, "Такой канал недоступен.");
    return value;
  }
  function missingSettings(name) {
    const required =
      name === "telegram"
        ? [
            ["TELEGRAM_BOT_TOKEN", config.telegramToken],
            ["TELEGRAM_BOT_USERNAME", config.telegramUsername],
            ["TELEGRAM_WEBHOOK_SECRET", config.telegramWebhookSecret],
          ]
        : [
            ["VK_GROUP_TOKEN", config.vkToken],
            ["VK_GROUP_ID", config.vkGroupId],
            ["VK_WEBHOOK_SECRET", config.vkWebhookSecret],
            ["VK_CONFIRMATION_TOKEN", config.vkConfirmationToken],
          ];
    return required.filter(([, value]) => !value).map(([key]) => key);
  }
  function configured(name) {
    if (missingSettings(name).length) return false;
    return name === "telegram"
      ? /^[A-Za-z0-9_]{5,32}$/.test(config.telegramUsername) &&
          /^[A-Za-z0-9_-]{16,256}$/.test(config.telegramWebhookSecret)
      : positiveId(config.vkGroupId) && config.vkWebhookSecret.length >= 16;
  }
  function binding(userId, name) {
    return db
      .prepare(
        "SELECT * FROM channel_bindings WHERE user_id = ? AND provider = ?",
      )
      .get(userId, name);
  }
  function listEvents(userId) {
    return db
      .prepare(
        `SELECT id, event_id AS eventId, provider, mode, title, body, category,
      status, attempts, created_at AS createdAt, updated_at AS updatedAt, error_code AS errorCode
      FROM channel_outbox WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 50`,
      )
      .all(userId);
  }
  function snapshot(userId) {
    return {
      realLinkingAllowed: config.allowRealLinking === true,
      channels: PROVIDERS.map((name) => {
        const row = binding(userId, name);
        return {
          provider: name,
          title: TITLES[name],
          configured: configured(name),
          liveAllowed: configured(name) && config.allowRealLinking === true,
          missingSettings: missingSettings(name),
          connection: row
            ? {
                mode: row.mode,
                connectedAt: row.connected_at,
                recipientLabel:
                  row.mode === "demo"
                    ? "Локальный демоканал"
                    : `Личный диалог · …${row.recipient.slice(-4)}`,
              }
            : null,
        };
      }),
      events: listEvents(userId),
    };
  }
  function cancelPending(userId, name) {
    db.prepare(
      "UPDATE channel_outbox SET status = 'cancelled', updated_at = ?, error_code = 'disconnected' WHERE user_id = ? AND provider = ? AND status = 'pending'",
    ).run(now(), userId, name);
    // A request already handed to the provider cannot be recalled by unlinking.
    // Preserve this uncertainty rather than claiming that it was cancelled.
    db.prepare(
      "UPDATE channel_outbox SET status = 'uncertain', updated_at = ?, error_code = 'disconnected_in_flight', lease_until = NULL WHERE user_id = ? AND provider = ? AND status = 'processing'",
    ).run(now(), userId, name);
  }
  function disconnect(userId, name) {
    provider(name);
    cancelPending(userId, name);
    db.prepare(
      "DELETE FROM channel_bindings WHERE user_id = ? AND provider = ?",
    ).run(userId, name);
    db.prepare(
      "DELETE FROM channel_pairings WHERE user_id = ? AND provider = ?",
    ).run(userId, name);
    return { ok: true };
  }
  function connectDemo(userId, name) {
    provider(name);
    cancelPending(userId, name);
    db.prepare(
      `INSERT INTO channel_bindings (user_id, provider, id, mode, recipient, connected_at)
      VALUES (?, ?, ?, 'demo', ?, ?) ON CONFLICT(user_id, provider) DO UPDATE SET
      id = excluded.id, mode = excluded.mode, recipient = excluded.recipient, connected_at = excluded.connected_at`,
    ).run(userId, name, randomUUID(), `demo:${userId}`, now());
    db.prepare(
      "DELETE FROM channel_pairings WHERE user_id = ? AND provider = ?",
    ).run(userId, name);
    return snapshot(userId);
  }
  function createPairing(userId, sessionHash, name) {
    provider(name);
    if (!config.allowRealLinking)
      fail(
        403,
        "Настоящие каналы отключены для общих демоаккаунтов. Доступен безопасный деморежим.",
      );
    if (!configured(name))
      fail(503, "Серверное подключение канала ещё не настроено.");
    const session = db
      .prepare(
        "SELECT 1 FROM sessions WHERE token_hash = ? AND user_id = ? AND expires_at > ?",
      )
      .get(sessionHash, userId, now());
    if (!session)
      fail(401, "Сессия закончилась. Войдите снова, чтобы подключить канал.");
    const previous = db
      .prepare(
        "SELECT created_at FROM channel_pairings WHERE user_id = ? AND provider = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(userId, name);
    if (previous && now() - previous.created_at < 5000)
      fail(429, "Подождите несколько секунд перед созданием нового кода.");
    const code = `orbita_${randomBytes(16).toString("hex")}`;
    const expiresAt = now() + 10 * 60 * 1000;
    db.prepare(
      "DELETE FROM channel_pairings WHERE user_id = ? AND provider = ?",
    ).run(userId, name);
    db.prepare(
      "INSERT INTO channel_pairings (code_hash, user_id, session_hash, provider, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(hash(code), userId, sessionHash, name, now(), expiresAt);
    return {
      provider: name,
      code,
      expiresAt,
      url:
        name === "telegram"
          ? `https://t.me/${config.telegramUsername}?start=${code}`
          : `https://vk.com/im?sel=-${config.vkGroupId}`,
      instructions:
        name === "telegram"
          ? "Откройте личный диалог с ботом и нажмите «Начать». Затем обновите статус здесь."
          : "Откройте сообщения сообщества и отправьте код одним сообщением. Затем обновите статус здесь.",
    };
  }
  function consumePairing(name, code, recipient, eventId) {
    db.exec("BEGIN IMMEDIATE");
    try {
      if (
        !acknowledgeEvent(name, eventId) ||
        !config.allowRealLinking ||
        !configured(name) ||
        !/^orbita_[a-f0-9]{32}$/.test(code) ||
        !positiveId(recipient)
      ) {
        db.exec("COMMIT");
        return false;
      }
      const pair = db
        .prepare(
          `SELECT p.* FROM channel_pairings p JOIN sessions s
        ON s.token_hash = p.session_hash AND s.user_id = p.user_id
        WHERE p.code_hash = ? AND p.provider = ? AND p.consumed_at IS NULL AND p.expires_at > ? AND s.expires_at > ?`,
        )
        .get(hash(code), name, now(), now());
      if (!pair) {
        db.exec("COMMIT");
        return false;
      }
      const occupied = db
        .prepare(
          "SELECT user_id FROM channel_bindings WHERE provider = ? AND recipient = ? AND user_id != ?",
        )
        .get(name, String(recipient), pair.user_id);
      if (occupied) {
        db.exec("COMMIT");
        return false;
      }
      const changed = db
        .prepare(
          "UPDATE channel_pairings SET consumed_at = ? WHERE code_hash = ? AND consumed_at IS NULL AND expires_at > ?",
        )
        .run(now(), pair.code_hash, now());
      if (!changed.changes) {
        db.exec("COMMIT");
        return false;
      }
      cancelPending(pair.user_id, name);
      db.prepare(
        `INSERT INTO channel_bindings (user_id, provider, id, mode, recipient, connected_at)
        VALUES (?, ?, ?, 'live', ?, ?) ON CONFLICT(user_id, provider) DO UPDATE SET
        id = excluded.id, mode = excluded.mode, recipient = excluded.recipient, connected_at = excluded.connected_at`,
      ).run(pair.user_id, name, randomUUID(), String(recipient), now());
      db.exec("COMMIT");
      return true;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  function acknowledgeEvent(name, eventId) {
    return (
      db
        .prepare(
          "INSERT OR IGNORE INTO channel_webhook_receipts (provider, event_id, created_at) VALUES (?, ?, ?)",
        )
        .run(name, eventId, now()).changes > 0
    );
  }

  function enqueue(userId, event) {
    if (
      !event ||
      typeof event.title !== "string" ||
      typeof event.body !== "string"
    )
      return [];
    const eventId =
      typeof event.id === "string" && event.id.length <= 100
        ? event.id
        : randomUUID();
    const rows = db
      .prepare("SELECT * FROM channel_bindings WHERE user_id = ?")
      .all(userId);
    const ids = [];
    for (const row of rows) {
      const id = randomUUID();
      const status = row.mode === "demo" ? "demo" : "pending";
      const inserted = db
        .prepare(
          `INSERT OR IGNORE INTO channel_outbox
        (id,event_id,user_id,provider,binding_id,mode,title,body,category,status,created_at,updated_at,next_attempt_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          eventId,
          userId,
          row.provider,
          row.id,
          row.mode,
          event.title.slice(0, 160),
          event.body.slice(0, 1500),
          String(event.category || "news").slice(0, 30),
          status,
          now(),
          now(),
          now(),
        );
      if (inserted.changes) ids.push(id);
    }
    return ids;
  }
  function finish(id, status, code = null, messageId = null) {
    db.prepare(
      "UPDATE channel_outbox SET status = ?, error_code = ?, provider_message_id = ?, updated_at = ?, lease_until = NULL WHERE id = ? AND status = 'processing'",
    ).run(status, code, messageId, now(), id);
  }
  async function deliver(row, target) {
    const text = `Орбита · конкурсный концепт\n${row.title}\n${row.body}`;
    const request =
      row.provider === "telegram"
        ? {
            url: `https://api.telegram.org/bot${config.telegramToken}/sendMessage`,
            body: JSON.stringify({
              chat_id: target.recipient,
              text,
              protect_content: true,
            }),
            headers: { "Content-Type": "application/json" },
          }
        : {
            url: "https://api.vk.com/method/messages.send",
            body: new URLSearchParams({
              access_token: config.vkToken,
              v: config.vkApiVersion,
              peer_id: target.recipient,
              random_id: String(
                (Number.parseInt(hash(row.id).slice(0, 8), 16) % 2147483646) +
                  1,
              ),
              message: text,
            }),
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
          };
    try {
      const response = await fetchImpl(request.url, {
        method: "POST",
        headers: request.headers,
        body: request.body,
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      let data;
      try {
        data = await response.json();
      } catch {
        finish(row.id, "uncertain", "unreadable_response");
        return;
      }
      const success =
        response.ok &&
        (row.provider === "telegram"
          ? data.ok === true && Number.isSafeInteger(data.result?.message_id)
          : !data.error &&
            Number.isSafeInteger(data.response) &&
            data.response > 0);
      if (success) {
        finish(
          row.id,
          "delivered",
          null,
          String(
            row.provider === "telegram"
              ? data.result.message_id
              : data.response,
          ),
        );
        return;
      }
      const rateLimited =
        response.status === 429 ||
        (row.provider === "telegram"
          ? data.error_code === 429
          : data.error?.error_code === 6);
      if (rateLimited && row.attempts < 3) {
        const delay = Math.min(
          3600,
          Math.max(
            10,
            Number(data.parameters?.retry_after) || 30 * row.attempts,
          ),
        );
        db.prepare(
          "UPDATE channel_outbox SET status='pending', error_code='rate_limited', next_attempt_at=?, updated_at=?, lease_until=NULL WHERE id=? AND status='processing'",
        ).run(now() + delay * 1000, now(), row.id);
      } else if (response.status >= 500)
        finish(row.id, "uncertain", "provider_unavailable");
      else
        finish(
          row.id,
          "failed",
          rateLimited ? "retry_limit" : "provider_rejected",
        );
    } catch {
      // Telegram has no idempotency key. A timeout can follow successful delivery.
      // Do not automatically resend an ambiguous outcome and risk duplicate messages.
      finish(row.id, "uncertain", "response_lost");
    }
  }
  async function runFlush() {
    if (closed) return;
    db.prepare(
      "UPDATE channel_outbox SET status='uncertain', error_code='interrupted', updated_at=?, lease_until=NULL WHERE status='processing' AND lease_until < ?",
    ).run(now(), now());
    db.prepare("DELETE FROM channel_pairings WHERE expires_at < ?").run(
      now() - 86400000,
    );
    db.prepare("DELETE FROM channel_webhook_receipts WHERE created_at < ?").run(
      now() - 7 * 86400000,
    );
    const pending = db
      .prepare(
        "SELECT * FROM channel_outbox WHERE status='pending' AND next_attempt_at <= ? ORDER BY created_at, rowid LIMIT 20",
      )
      .all(now());
    for (const item of pending) {
      if (closed) break;
      const target = binding(item.user_id, item.provider);
      if (!target || target.id !== item.binding_id || target.mode !== "live") {
        db.prepare(
          "UPDATE channel_outbox SET status='cancelled', error_code='disconnected', updated_at=? WHERE id=? AND status='pending'",
        ).run(now(), item.id);
        continue;
      }
      if (!config.allowRealLinking || !configured(item.provider)) {
        db.prepare(
          "UPDATE channel_outbox SET error_code='provider_not_configured', next_attempt_at=?, updated_at=? WHERE id=? AND status='pending'",
        ).run(now() + 60000, now(), item.id);
        continue;
      }
      const claim = db
        .prepare(
          "UPDATE channel_outbox SET status='processing', attempts=attempts+1, lease_until=?, updated_at=? WHERE id=? AND status='pending'",
        )
        .run(now() + 30000, now(), item.id);
      if (!claim.changes) continue;
      await deliver({ ...item, attempts: item.attempts + 1 }, target);
    }
  }
  function flush() {
    if (!flushing)
      flushing = runFlush().finally(() => {
        flushing = null;
      });
    return flushing;
  }
  function start() {
    if (timer || closed) return;
    timer = setInterval(() => {
      flush().catch(() => {});
    }, 5000);
    timer.unref();
  }
  async function close() {
    closed = true;
    if (timer) clearInterval(timer);
    timer = null;
    if (flushing) await flushing;
  }

  app.get("/api/channels", authenticate, (req, res) =>
    res.json(snapshot(req.user.id)),
  );
  app.post("/api/channels/:provider/demo-connect", authenticate, (req, res) => {
    if (!emptyBody(req.body))
      fail(
        400,
        "Получатель определяется сервером; дополнительные поля не допускаются.",
      );
    res.json(connectDemo(req.user.id, req.params.provider));
  });
  app.post("/api/channels/:provider/pair", authenticate, (req, res) => {
    if (!emptyBody(req.body))
      fail(400, "Не передавайте ID получателя. Используйте одноразовый код.");
    res.json(
      createPairing(req.user.id, req.session.token_hash, req.params.provider),
    );
  });
  app.delete("/api/channels/:provider", authenticate, (req, res) =>
    res.json(disconnect(req.user.id, req.params.provider)),
  );
  app.post("/api/channels/test", authenticate, (req, res) => {
    if (!emptyBody(req.body))
      fail(
        400,
        "Тестовое уведомление не принимает текст или чужие идентификаторы.",
      );
    if (
      !db
        .prepare("SELECT 1 FROM channel_bindings WHERE user_id = ?")
        .get(req.user.id)
    )
      fail(400, "Сначала подключите хотя бы один демоканал.");
    const recent = db
      .prepare(
        "SELECT created_at FROM channel_outbox WHERE user_id=? AND category='test' ORDER BY created_at DESC LIMIT 1",
      )
      .get(req.user.id);
    if (recent && now() - recent.created_at < 5000)
      fail(
        429,
        "Тестовое уведомление уже подготовлено. Подождите несколько секунд.",
      );
    enqueue(req.user.id, {
      id: randomUUID(),
      title: "Проверка уведомлений",
      body: "Это тестовое событие конкурсного прототипа. Учебные данные не изменялись.",
      category: "test",
    });
    res.json(snapshot(req.user.id));
  });
  app.post("/api/channels/telegram/webhook", (req, res) => {
    if (
      !config.telegramWebhookSecret ||
      !constantEqual(
        req.get("X-Telegram-Bot-Api-Secret-Token"),
        config.telegramWebhookSecret,
      )
    )
      return res.status(403).json({ error: "Webhook не авторизован." });
    const body = req.body;
    if (!Number.isSafeInteger(body?.update_id) || body.update_id < 0)
      return res.status(400).json({ error: "Некорректное событие." });
    const message = body.message;
    if (
      message?.chat?.type !== "private" ||
      !positiveId(message.chat.id) ||
      Number(message.from?.id) !== Number(message.chat.id) ||
      typeof message.text !== "string"
    )
      return res.json({ ok: true });
    const match = message.text
      .trim()
      .match(/^(?:\/start(?:@[A-Za-z0-9_]+)?\s+)?(orbita_[a-f0-9]{32})$/);
    if (match)
      consumePairing(
        "telegram",
        match[1],
        message.chat.id,
        String(body.update_id),
      );
    else acknowledgeEvent("telegram", String(body.update_id));
    res.json({ ok: true });
  });
  app.post("/api/channels/vk/webhook", (req, res) => {
    const body = req.body;
    if (
      !config.vkWebhookSecret ||
      !constantEqual(body?.secret, config.vkWebhookSecret) ||
      !positiveId(body?.group_id) ||
      String(body.group_id) !== String(config.vkGroupId)
    )
      return res.status(403).json({ error: "Webhook не авторизован." });
    if (body.type === "confirmation")
      return res
        .type("text")
        .send(config.vkConfirmationToken || "not-configured");
    if (body.type !== "message_new") return res.type("text").send("ok");
    const message = body.object?.message;
    if (
      !message ||
      !positiveId(message.from_id) ||
      Number(message.peer_id) !== Number(message.from_id) ||
      typeof message.text !== "string"
    )
      return res.type("text").send("ok");
    const messageId = message.conversation_message_id || message.id;
    const eventId =
      body.event_id ||
      (positiveId(messageId)
        ? `${body.group_id}:${message.from_id}:${messageId}`
        : null);
    if (typeof eventId !== "string" || !eventId || eventId.length > 200)
      return res.type("text").send("ok");
    const match = message.text.trim().match(/^(orbita_[a-f0-9]{32})$/);
    if (match) consumePairing("vk", match[1], message.from_id, eventId);
    else acknowledgeEvent("vk", eventId);
    res.type("text").send("ok");
  });

  return {
    enqueue,
    flush,
    start,
    close,
    snapshot,
    connectDemo,
    createPairing,
    disconnect,
  };
}
