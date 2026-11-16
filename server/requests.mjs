import { createHash, randomUUID } from "node:crypto";

export const REQUEST_TYPES = {
  enrollment: "Справка об обучении",
  scholarship: "Справка о стипендии",
  transcript: "Выписка об успеваемости",
  leave: "Заявление на академический отпуск",
};
const moscowCalendar = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Moscow",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status, expose: true });
};
export function validateRequest(body) {
  const { type, purpose, comment = "" } = body || {};
  if (typeof type !== "string" || !Object.hasOwn(REQUEST_TYPES, type))
    fail(400, "Выберите доступный тип документа.");
  if (
    typeof purpose !== "string" ||
    purpose.trim().length < 3 ||
    purpose.trim().length > 160
  )
    fail(400, "Укажите цель получения: от 3 до 160 символов.");
  if (typeof comment !== "string" || comment.length > 1000)
    fail(400, "Комментарий должен быть не длиннее 1000 символов.");
  if (type === "leave" && comment.trim().length < 10)
    fail(400, "Укажите вымышленную причину отпуска: не менее 10 символов.");
  return { type, purpose: purpose.trim(), comment: comment.trim() };
}

// Shared by the normal form, assistant confirmations and MCP; one set of rules.
export function createRequestService(db, { notify }) {
  function create(userId, body, idempotencyKey) {
    const normalized = validateRequest(body);
    if (idempotencyKey && !/^[a-zA-Z0-9_-]{8,100}$/.test(idempotencyKey))
      fail(400, "Некорректный идентификатор отправки.");
    const bodyHash = createHash("sha256")
      .update(JSON.stringify(normalized))
      .digest("hex");
    if (idempotencyKey) {
      const previous = db
        .prepare("SELECT * FROM request_keys WHERE user_id = ? AND key = ?")
        .get(userId, idempotencyKey);
      if (previous) {
        if (previous.body_hash !== bodyHash)
          fail(409, "Этот идентификатор уже использован для другой заявки.");
        const row = db
          .prepare(
            "SELECT payload_json FROM records WHERE id = ? AND user_id = ? AND kind = 'requests'",
          )
          .get(previous.request_id, userId);
        if (!row) fail(410, "Ранее созданная заявка больше недоступна.");
        return { request: JSON.parse(row.payload_json), status: 200 };
      }
    }
    const count = db
      .prepare(
        "SELECT COUNT(*) AS n FROM records WHERE user_id = ? AND kind = 'requests' AND COALESCE(json_extract(payload_json, '$.archived'), 0) = 0",
      )
      .get(userId).n;
    if (count >= 200)
      fail(
        429,
        "Достигнут лимит в 200 заявок вне архива. Перенесите готовые заявки в архив; незавершённые можно довести до готовности кнопкой «Демо: следующий этап».",
      );
    const now = new Date();
    const calendar = Object.fromEntries(
      moscowCalendar.formatToParts(now).map(({ type, value }) => [type, value]),
    );
    // A date-only calendar anchor, not a conversion of the stored UTC timestamp.
    // The demo counts Monday–Friday; it does not model an official holiday calendar.
    const estimated = new Date(
      `${calendar.year}-${calendar.month}-${calendar.day}T00:00:00.000Z`,
    );
    let businessDays = 0;
    while (businessDays < 3) {
      estimated.setUTCDate(estimated.getUTCDate() + 1);
      if (![0, 6].includes(estimated.getUTCDay())) businessDays++;
    }
    const id = randomUUID();
    const request = {
      id,
      number: `ОРБ-${id.slice(0, 8).toUpperCase()}`,
      ...normalized,
      status: "submitted",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      estimatedDate: estimated.toISOString().slice(0, 10),
      history: [
        {
          status: "submitted",
          at: now.toISOString(),
          text: "Демонстрационная заявка принята. В настоящий деканат ничего не отправлено.",
        },
      ],
    };
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "INSERT INTO records (id, user_id, kind, payload_json) VALUES (?, ?, 'requests', ?)",
      ).run(id, userId, JSON.stringify(request));
      if (idempotencyKey)
        db.prepare(
          "INSERT INTO request_keys (user_id, key, body_hash, request_id) VALUES (?, ?, ?, ?)",
        ).run(userId, idempotencyKey, bodyHash, id);
      notify(userId, {
        title: "Заявка принята",
        body: `${REQUEST_TYPES[normalized.type]} · ${request.number}. Статус можно проверить в разделе заявок.`,
        category: "request",
        route: "requests",
        focusId: id,
      });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { request, status: 201 };
  }
  return { create };
}
