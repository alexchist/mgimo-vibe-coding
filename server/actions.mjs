import { randomUUID } from "node:crypto";
import { validateRequest, REQUEST_TYPES } from "./requests.mjs";

export const ACTION_SCOPES = {
  "request.create": "requests:write",
  "booking.create": "bookings:write",
  "booking.cancel": "bookings:write",
};
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status, expose: true });
};
function onlyKeys(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    fail(400, "Недопустимые параметры действия.");
}
export function createActionService(db, { campus, requests, now = Date.now }) {
  db.exec(`CREATE TABLE IF NOT EXISTS assistant_actions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), actor_id TEXT NOT NULL,
    type TEXT NOT NULL, params_json TEXT NOT NULL, summary TEXT NOT NULL,
    status TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
    started_at INTEGER, result_json TEXT
  ); CREATE INDEX IF NOT EXISTS actions_owner ON assistant_actions(user_id, actor_id, expires_at);`);
  const publicAction = (row) => ({
    id: row.id,
    type: row.type,
    summary: row.summary,
    params: JSON.parse(row.params_json),
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
  });
  const find = (userId, id, actorId) => {
    const row = db
      .prepare(
        "SELECT * FROM assistant_actions WHERE id = ? AND user_id = ? AND actor_id = ?",
      )
      .get(id, userId, actorId);
    if (!row)
      fail(404, "Действие не найдено или недоступно этому подключению.");
    return row;
  };
  async function prepare(userId, input, { actorId = "browser" } = {}) {
    onlyKeys(input, ["type", "params"]);
    const { type } = input;
    if (!Object.hasOwn(ACTION_SCOPES, type))
      fail(400, "Такое действие не поддерживается.");
    let params, summary;
    if (type === "request.create") {
      onlyKeys(input.params, ["type", "purpose", "comment"]);
      params = validateRequest(input.params);
      summary = `${REQUEST_TYPES[params.type]}. Куда предоставить: ${params.purpose}.${params.comment ? ` Комментарий: ${params.comment}` : ""} Это демонстрационная заявка.`;
    } else if (type === "booking.create") {
      onlyKeys(input.params, ["roomId", "date", "start", "end", "purpose"]);
      params = { ...input.params };
      for (const key of ["roomId", "date", "start", "end", "purpose"])
        if (typeof params[key] !== "string" || !params[key].trim())
          fail(400, "Укажите помещение, дату, начало, окончание и цель брони.");
      params.purpose = params.purpose.trim();
      if (
        params.purpose.length < 3 ||
        params.purpose.length > 160 ||
        !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(params.start) ||
        !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(params.end) ||
        params.start >= params.end
      )
        fail(400, "Проверьте время и цель брони.");
      const available = await campus.availability(userId, {
        roomId: params.roomId,
        date: params.date,
      });
      const toMinutes = (time) =>
        Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
      const length = toMinutes(params.end) - toMinutes(params.start);
      if (
        length < 30 ||
        length > 120 ||
        toMinutes(params.start) % 30 ||
        toMinutes(params.end) % 30
      )
        fail(
          400,
          "Бронирование длится от 30 минут до 2 часов с шагом 30 минут.",
        );
      const slots = available.slots.filter(
        (slot) => slot.start >= params.start && slot.end <= params.end,
      );
      if (slots.length !== length / 30)
        fail(400, "Выберите время работы помещения.");
      if (slots.some((slot) => !slot.available))
        fail(409, "Это время уже занято. Выберите другой свободный интервал.");
      summary = `Забронировать «${available.room.name}»: ${params.date}, ${params.start}–${params.end} МСК. Цель: ${params.purpose}.`;
    } else {
      onlyKeys(input.params, ["bookingId"]);
      if (typeof input.params.bookingId !== "string")
        fail(400, "Выберите свою бронь.");
      const booking = (await campus.listBookings(userId)).bookings.find(
        (item) => item.id === input.params.bookingId,
      );
      if (!booking) fail(404, "Бронь недоступна.");
      if (booking.status !== "confirmed") fail(409, "Эта бронь уже отменена.");
      params = { bookingId: booking.id };
      summary = `Отменить бронь «${booking.roomName}»: ${booking.date}, ${booking.start}–${booking.end} МСК.`;
    }
    const count = db
      .prepare(
        "SELECT count(*) AS n FROM assistant_actions WHERE user_id = ? AND status IN ('pending', 'executing') AND expires_at > ?",
      )
      .get(userId, now()).n;
    if (count >= 30)
      fail(
        429,
        "Слишком много неподтверждённых действий. Отмените ненужные, подтвердите нужные или подождите 10 минут.",
      );
    const id = randomUUID(),
      created = now();
    db.prepare(
      "INSERT INTO assistant_actions (id,user_id,actor_id,type,params_json,summary,status,created_at,expires_at) VALUES (?,?,?,?,?,?,'pending',?,?)",
    ).run(
      id,
      userId,
      actorId,
      type,
      JSON.stringify(params),
      summary,
      created,
      created + 600000,
    );
    return { action: publicAction(find(userId, id, actorId)) };
  }
  async function confirm(userId, id, { actorId = "browser" } = {}) {
    const row = find(userId, id, actorId);
    if (row.status === "completed")
      return { action: publicAction(row), result: JSON.parse(row.result_json) };
    if (row.status === "cancelled")
      fail(
        409,
        "Эта подготовка отменена. Для нового действия подготовьте новую карточку.",
      );
    if (row.expires_at <= now())
      fail(410, "Подтверждение устарело. Подготовьте действие заново.");
    const claimed = db
      .prepare(
        "UPDATE assistant_actions SET status = 'executing', started_at = ? WHERE id = ? AND (status = 'pending' OR (status = 'executing' AND started_at < ?))",
      )
      .run(now(), id, now() - 30000);
    if (!claimed.changes)
      fail(409, "Действие уже выполняется. Повторите проверку немного позже.");
    try {
      const params = JSON.parse(row.params_json),
        key = `action_${row.id}`;
      let result;
      if (row.type === "request.create")
        result = {
          request: (await requests.create(userId, params, key)).request,
        };
      else if (row.type === "booking.create")
        result = await campus.createBooking(userId, params, key);
      else result = await campus.cancelBooking(userId, params.bookingId);
      db.prepare(
        "UPDATE assistant_actions SET status = 'completed', result_json = ? WHERE id = ?",
      ).run(JSON.stringify(result), id);
      return { action: publicAction(find(userId, id, actorId)), result };
    } catch (error) {
      db.prepare(
        "UPDATE assistant_actions SET status = 'pending' WHERE id = ?",
      ).run(id);
      throw error;
    }
  }
  function cancel(userId, id, { actorId = "browser" } = {}) {
    const row = find(userId, id, actorId);
    if (row.status === "cancelled") return { action: publicAction(row) };
    if (row.status !== "pending" || row.started_at !== null)
      fail(
        409,
        "Действие уже запускалось или выполнено. Сначала проверьте его результат; отмена подготовки не отменяет поданные заявки и брони.",
      );
    const changed = db
      .prepare(
        "UPDATE assistant_actions SET status = 'cancelled' WHERE id = ? AND user_id = ? AND actor_id = ? AND status = 'pending' AND started_at IS NULL",
      )
      .run(id, userId, actorId);
    if (!changed.changes)
      fail(
        409,
        "Состояние действия изменилось. Обновите раздел перед продолжением.",
      );
    return { action: publicAction(find(userId, id, actorId)) };
  }
  return {
    prepare,
    confirm,
    cancel,
    get(userId, id, { actorId = "browser" } = {}) {
      return { action: publicAction(find(userId, id, actorId)) };
    },
    list(userId, { actorId = "browser" } = {}) {
      return {
        actions: db
          .prepare(
            "SELECT * FROM assistant_actions WHERE user_id = ? AND actor_id = ? AND status IN ('pending', 'executing') AND expires_at > ? ORDER BY created_at DESC LIMIT 30",
          )
          .all(userId, actorId, now())
          .map(publicAction),
      };
    },
  };
}
