import { createHash, randomUUID } from "node:crypto";
import { createPaymentProvider } from "./payment-provider.mjs";

const FIRST_DATE = "2026-11-16";
const LAST_DATE = "2026-11-22";
const fail = (status, message) =>
  Object.assign(new Error(message), { status, expose: true });
const hash = (body) =>
  createHash("sha256").update(JSON.stringify(body)).digest("hex");
const rooms = [
  {
    id: "room-dialog",
    name: "Переговорная «Диалог»",
    building: "Учебный центр · 2 этаж",
    capacity: 8,
    amenities: ["Экран", "Маркерная доска", "Wi-Fi"],
    description:
      "Для командного проекта, встречи клуба или подготовки презентации.",
    color: "mint",
  },
  {
    id: "room-orbit",
    name: "Коворкинг «Орбита»",
    building: "Студенческий центр · 1 этаж",
    capacity: 16,
    amenities: ["Проектор", "Розетки", "Wi-Fi"],
    description:
      "Общее пространство для совместной работы и учебных обсуждений.",
    color: "peach",
  },
  {
    id: "room-quiet",
    name: "Тихая комната «Фокус»",
    building: "Библиотека · 3 этаж",
    capacity: 4,
    amenities: ["Тихая зона", "Розетки", "Wi-Fi"],
    description: "Небольшая группа, спокойная подготовка и работа с текстами.",
    color: "lilac",
  },
];
const text = (value, min, max, label) => {
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.trim().length > max
  )
    throw fail(400, `${label}: от ${min} до ${max} символов.`);
  return value.trim();
};
const object = (value, keys) => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw fail(400, "В запросе есть неподдерживаемые поля.");
};
function demoDate(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < FIRST_DATE ||
    value > LAST_DATE
  )
    throw fail(
      400,
      "Выберите дату демонстрационной недели: 16–22 ноября 2026.",
    );
  return value;
}
function minutes(value) {
  if (
    typeof value !== "string" ||
    !/^(?:0[9]|1\d|20|21):(?:00|30)$/.test(value)
  )
    throw fail(400, "Время должно быть с 09:00 до 21:00 с шагом 30 минут.");
  const [hours, mins] = value.split(":").map(Number);
  const result = hours * 60 + mins;
  if (result > 1260) throw fail(400, "Помещения открыты до 21:00.");
  return result;
}
const timeLabel = (value) =>
  `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );

export function installCampus(app, db, authenticate, options = {}) {
  const notify = options.notify || (() => {});
  const provider = createPaymentProvider(options);
  db.exec(`
    CREATE TABLE IF NOT EXISTS campus_rooms (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS campus_bookings (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), room_id TEXT NOT NULL REFERENCES campus_rooms(id),
      date TEXT NOT NULL, start_min INTEGER NOT NULL, end_min INTEGER NOT NULL, purpose TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('confirmed','cancelled')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS campus_overlap ON campus_bookings(room_id,date,status,start_min,end_min);
    CREATE INDEX IF NOT EXISTS campus_booking_owner ON campus_bookings(user_id,date);
    CREATE TABLE IF NOT EXISTS campus_keys (
      user_id TEXT NOT NULL REFERENCES users(id), operation TEXT NOT NULL, key TEXT NOT NULL,
      body_hash TEXT NOT NULL, record_id TEXT NOT NULL, PRIMARY KEY(user_id,operation,key)
    );
    CREATE TABLE IF NOT EXISTS housing_accounts (user_id TEXT PRIMARY KEY REFERENCES users(id), payload_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS housing_invoices (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), period TEXT NOT NULL,
      amount_minor INTEGER NOT NULL CHECK(amount_minor>0), due_date TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('unpaid','paid')), paid_at TEXT
    );
    CREATE INDEX IF NOT EXISTS housing_invoice_owner ON housing_invoices(user_id,period);
    CREATE TABLE IF NOT EXISTS housing_payments (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), invoice_id TEXT NOT NULL REFERENCES housing_invoices(id),
      mode TEXT NOT NULL, status TEXT NOT NULL, amount_minor INTEGER NOT NULL,
      provider_key TEXT NOT NULL, provider_id TEXT UNIQUE, redirect_url TEXT,
      receipt_number TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS housing_payment_owner ON housing_payments(user_id,invoice_id,status);
  `);
  const insertRoom = db.prepare(
    "INSERT OR IGNORE INTO campus_rooms (id,payload_json) VALUES (?,?)",
  );
  for (const room of rooms) insertRoom.run(room.id, JSON.stringify(room));
  const users = db
    .prepare("SELECT id, profile_json FROM users ORDER BY id")
    .all();
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const [index, user] of users.entries()) {
      const profile = JSON.parse(user.profile_json);
      const amount = index % 2 ? 420000 : 385000;
      const account = {
        residence: "Общежитие «Северное»",
        room: index % 2 ? "412Б" : "208А",
        contractNumber: `DEMO-ДОГ-${index + 101}`,
        tenant: profile.fullName,
        fictional: true,
      };
      db.prepare("INSERT OR IGNORE INTO housing_accounts VALUES (?,?)").run(
        user.id,
        JSON.stringify(account),
      );
      for (const month of ["10", "11"]) {
        const id = `${user.id}-housing-2026-${month}`;
        db.prepare(
          "INSERT OR IGNORE INTO housing_invoices VALUES (?,?,?,?,?,?,?)",
        ).run(
          id,
          user.id,
          `2026-${month}`,
          amount,
          `2026-${month}-25`,
          month === "10" ? "paid" : "unpaid",
          month === "10" ? "2026-10-20T09:00:00.000Z" : null,
        );
        if (month === "10")
          db.prepare(
            "INSERT OR IGNORE INTO housing_payments VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
          ).run(
            `${id}-seed-payment`,
            user.id,
            id,
            "demo",
            "succeeded",
            amount,
            `${id}-seed`,
            null,
            null,
            `DEMO-${index + 101}-10`,
            "2026-10-20T09:00:00.000Z",
            "2026-10-20T09:00:00.000Z",
          );
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  const ensureUser = (id) => {
    if (!db.prepare("SELECT 1 FROM users WHERE id=?").get(id))
      throw fail(401, "Войдите в кабинет.");
  };
  const getRoom = (id) => {
    const row =
      typeof id === "string" &&
      db.prepare("SELECT payload_json FROM campus_rooms WHERE id=?").get(id);
    if (!row) throw fail(404, "Помещение не найдено.");
    return JSON.parse(row.payload_json);
  };
  function bookingView(row) {
    return {
      id: row.id,
      roomId: row.room_id,
      roomName: getRoom(row.room_id).name,
      date: row.date,
      start: timeLabel(row.start_min),
      end: timeLabel(row.end_min),
      purpose: row.purpose,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
  const ownBooking = (userId, id) => {
    const row = db
      .prepare("SELECT * FROM campus_bookings WHERE id=? AND user_id=?")
      .get(id, userId);
    if (!row) throw fail(404, "Бронирование не найдено.");
    return row;
  };
  function keyLookup(userId, operation, key, body) {
    if (!key) return null;
    if (typeof key !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(key))
      throw fail(400, "Некорректный идентификатор операции.");
    const previous = db
      .prepare(
        "SELECT * FROM campus_keys WHERE user_id=? AND operation=? AND key=?",
      )
      .get(userId, operation, key);
    if (previous && previous.body_hash !== hash(body))
      throw fail(
        409,
        "Идентификатор отправки уже использован для других данных.",
      );
    return previous?.record_id || null;
  }
  const saveKey = (userId, operation, key, body, id) => {
    if (key)
      db.prepare("INSERT INTO campus_keys VALUES (?,?,?,?,?)").run(
        userId,
        operation,
        key,
        hash(body),
        id,
      );
  };
  const ownInvoice = (userId, id) => {
    const row = db
      .prepare("SELECT * FROM housing_invoices WHERE id=? AND user_id=?")
      .get(id, userId);
    if (!row) throw fail(404, "Начисление не найдено.");
    return row;
  };
  const invoiceView = (row) => ({
    id: row.id,
    period: row.period,
    amountMinor: row.amount_minor,
    amountRub: row.amount_minor / 100,
    currency: "RUB",
    dueDate: row.due_date,
    status: row.status,
    paidAt: row.paid_at,
  });
  const paymentView = (row) => ({
    id: row.id,
    invoiceId: row.invoice_id,
    mode: row.mode,
    status: row.status,
    amountMinor: row.amount_minor,
    amountRub: row.amount_minor / 100,
    currency: "RUB",
    number: row.receipt_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    confirmationUrl: row.redirect_url,
  });
  const paidReceipt = (userId, invoiceId) =>
    db
      .prepare(
        "SELECT * FROM housing_payments WHERE user_id=? AND invoice_id=? AND status='succeeded' ORDER BY created_at DESC LIMIT 1",
      )
      .get(userId, invoiceId);

  const service = {
    listRooms(userId, { date } = {}) {
      ensureUser(userId);
      if (date) demoDate(date);
      return {
        rooms: db
          .prepare("SELECT payload_json FROM campus_rooms ORDER BY id")
          .all()
          .map((row) => JSON.parse(row.payload_json)),
        referenceDate: FIRST_DATE,
      };
    },
    availability(userId, { roomId, date }) {
      ensureUser(userId);
      const room = getRoom(roomId);
      demoDate(date);
      const busy = db
        .prepare(
          "SELECT start_min,end_min FROM campus_bookings WHERE room_id=? AND date=? AND status='confirmed'",
        )
        .all(roomId, date);
      return {
        room,
        date,
        slots: Array.from({ length: 24 }, (_, index) => {
          const start = 540 + index * 30;
          const end = start + 30;
          return {
            start: timeLabel(start),
            end: timeLabel(end),
            available: !busy.some(
              (item) => item.start_min < end && item.end_min > start,
            ),
          };
        }),
      };
    },
    listBookings(userId) {
      ensureUser(userId);
      return {
        bookings: db
          .prepare(
            "SELECT * FROM campus_bookings WHERE user_id=? ORDER BY date,start_min,created_at",
          )
          .all(userId)
          .map(bookingView),
      };
    },
    createBooking(userId, input, key) {
      ensureUser(userId);
      object(input, ["roomId", "date", "start", "end", "purpose"]);
      const room = getRoom(input.roomId);
      const date = demoDate(input.date);
      const start = minutes(input.start);
      const end = minutes(input.end);
      if (end - start < 30 || end - start > 120)
        throw fail(400, "Бронирование длится от 30 минут до 2 часов.");
      const purpose = text(input.purpose, 3, 160, "Цель бронирования");
      const body = { roomId: room.id, date, start, end, purpose };
      db.exec("BEGIN IMMEDIATE");
      try {
        const prior = keyLookup(userId, "booking", key, body);
        if (prior) {
          const booking = bookingView(ownBooking(userId, prior));
          db.exec("COMMIT");
          return { booking };
        }
        if (
          db
            .prepare(
              "SELECT 1 FROM campus_bookings WHERE room_id=? AND date=? AND status='confirmed' AND start_min < ? AND end_min > ?",
            )
            .get(room.id, date, end, start)
        )
          throw fail(
            409,
            "Это время уже занято. Выберите другой свободный интервал.",
          );
        if (
          db
            .prepare(
              "SELECT COUNT(*) AS n FROM campus_bookings WHERE user_id=? AND date=? AND status='confirmed'",
            )
            .get(userId, date).n >= 3
        )
          throw fail(
            429,
            "Можно иметь не более трёх активных бронирований в один демодень.",
          );
        const id = randomUUID();
        const now = new Date().toISOString();
        db.prepare(
          "INSERT INTO campus_bookings VALUES (?,?,?,?,?,?,?,?,?,?)",
        ).run(
          id,
          userId,
          room.id,
          date,
          start,
          end,
          purpose,
          "confirmed",
          now,
          now,
        );
        saveKey(userId, "booking", key, body, id);
        notify(userId, {
          id: `booking-${id}-created`,
          title: "Помещение забронировано",
          body: `${room.name} · ${date}, ${input.start}–${input.end}. Демонстрационное бронирование.`,
          category: "campus",
          route: "campus",
          focusId: id,
        });
        const booking = bookingView(ownBooking(userId, id));
        db.exec("COMMIT");
        return { booking };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    cancelBooking(userId, id) {
      ensureUser(userId);
      db.exec("BEGIN IMMEDIATE");
      try {
        const row = ownBooking(userId, id);
        if (row.status !== "cancelled") {
          db.prepare(
            "UPDATE campus_bookings SET status='cancelled',updated_at=? WHERE id=? AND user_id=?",
          ).run(new Date().toISOString(), id, userId);
          notify(userId, {
            id: `booking-${id}-cancelled`,
            title: "Бронирование отменено",
            body: `${getRoom(row.room_id).name} · ${row.date}, ${timeLabel(row.start_min)}. Время снова доступно.`,
            category: "campus",
            route: "campus",
            focusId: id,
          });
        }
        const booking = bookingView(ownBooking(userId, id));
        db.exec("COMMIT");
        return { booking };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    getHousing(userId) {
      ensureUser(userId);
      const account = JSON.parse(
        db
          .prepare("SELECT payload_json FROM housing_accounts WHERE user_id=?")
          .get(userId).payload_json,
      );
      return {
        account,
        invoices: db
          .prepare(
            "SELECT * FROM housing_invoices WHERE user_id=? ORDER BY period DESC",
          )
          .all(userId)
          .map(invoiceView),
        payments: db
          .prepare(
            "SELECT * FROM housing_payments WHERE user_id=? ORDER BY created_at DESC",
          )
          .all(userId)
          .map(paymentView),
        mode: provider.mode,
        providerConfigured: provider.configured,
      };
    },
    payDemo(userId, invoiceId, key) {
      ensureUser(userId);
      if (provider.mode !== "demo")
        throw fail(
          409,
          "Для этого сервера включён тестовый платёжный сервис. Используйте его форму.",
        );
      const body = { invoiceId };
      db.exec("BEGIN IMMEDIATE");
      try {
        const invoice = ownInvoice(userId, invoiceId);
        const previous = keyLookup(userId, "demo-pay", key, body);
        let payment = paidReceipt(userId, invoiceId);
        if (!payment) {
          const id = randomUUID();
          const now = new Date().toISOString();
          db.prepare(
            "INSERT INTO housing_payments VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
          ).run(
            id,
            userId,
            invoiceId,
            "demo",
            "succeeded",
            invoice.amount_minor,
            id,
            null,
            null,
            `DEMO-${id.slice(0, 8).toUpperCase()}`,
            now,
            now,
          );
          db.prepare(
            "UPDATE housing_invoices SET status='paid',paid_at=? WHERE id=? AND user_id=?",
          ).run(now, invoiceId, userId);
          notify(userId, {
            id: `housing-${id}-paid`,
            title: "Демооплата учтена",
            body: `Общежитие за ${invoice.period}: ${(invoice.amount_minor / 100).toFixed(2)} ₽. Деньги не списывались.`,
            category: "housing",
            route: "housing",
            focusId: invoiceId,
          });
          payment = paidReceipt(userId, invoiceId);
        }
        if (!previous) saveKey(userId, "demo-pay", key, body, payment.id);
        const result = {
          invoice: invoiceView(ownInvoice(userId, invoiceId)),
          receipt: paymentView(payment),
        };
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    async createCheckout(userId, invoiceId, key) {
      ensureUser(userId);
      if (!provider.configured)
        throw fail(
          503,
          "Тестовая YooKassa не подключена. Ключи настраиваются только на сервере.",
        );
      const body = { invoiceId };
      let payment;
      db.exec("BEGIN IMMEDIATE");
      try {
        const invoice = ownInvoice(userId, invoiceId);
        const previous = keyLookup(userId, "checkout", key, body);
        payment = previous
          ? db
              .prepare(
                "SELECT * FROM housing_payments WHERE id=? AND user_id=?",
              )
              .get(previous, userId)
          : db
              .prepare(
                "SELECT * FROM housing_payments WHERE user_id=? AND invoice_id=? AND status IN ('creating','pending','succeeded') ORDER BY created_at DESC LIMIT 1",
              )
              .get(userId, invoiceId);
        if (invoice.status === "paid" && !payment)
          throw fail(409, "Начисление уже оплачено в демонстрации.");
        if (!payment) {
          const id = randomUUID();
          const now = new Date().toISOString();
          db.prepare(
            "INSERT INTO housing_payments VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
          ).run(
            id,
            userId,
            invoiceId,
            "yookassa-test",
            "creating",
            invoice.amount_minor,
            randomUUID(),
            null,
            null,
            `TEST-${id.slice(0, 8).toUpperCase()}`,
            now,
            now,
          );
          payment = db
            .prepare("SELECT * FROM housing_payments WHERE id=?")
            .get(id);
        }
        if (!previous) saveKey(userId, "checkout", key, body, payment.id);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      if (payment.status !== "creating")
        return { payment: paymentView(payment) };
      if (Date.now() - Date.parse(payment.created_at) >= 23 * 60 * 60 * 1000)
        throw fail(
          409,
          "Результат создания старого тестового платежа неизвестен. Автоматический повтор остановлен: организатору нужно сверить операцию в тестовом магазине.",
        );
      const remote = await provider.createPayment({
        key: payment.provider_key,
        invoiceId,
        userId,
        amountMinor: payment.amount_minor,
      });
      verifyRemote(remote, payment);
      if (
        !remote.confirmation?.confirmation_url &&
        !["succeeded", "canceled"].includes(remote.status)
      )
        throw fail(
          502,
          "Платёжный сервис не вернул ссылку тестовой оплаты. Повторите запрос позже.",
        );
      db.prepare(
        "UPDATE housing_payments SET provider_id=?,redirect_url=?,status=?,updated_at=? WHERE id=? AND user_id=? AND status='creating'",
      ).run(
        remote.id,
        remote.confirmation?.confirmation_url || null,
        remote.status === "canceled" ? "canceled" : "pending",
        new Date().toISOString(),
        payment.id,
        userId,
      );
      // A checkout response is not accepted as the final receipt: sync reads the payment by ID.
      return {
        payment: paymentView(
          db
            .prepare("SELECT * FROM housing_payments WHERE id=? AND user_id=?")
            .get(payment.id, userId),
        ),
      };
    },
    async syncPayment(userId, paymentId) {
      ensureUser(userId);
      const payment = db
        .prepare("SELECT * FROM housing_payments WHERE id=? AND user_id=?")
        .get(paymentId, userId);
      if (!payment) throw fail(404, "Платёж не найден.");
      if (
        payment.mode !== "yookassa-test" ||
        payment.status === "succeeded" ||
        payment.status === "canceled"
      )
        return {
          payment: paymentView(payment),
          invoice: invoiceView(ownInvoice(userId, payment.invoice_id)),
        };
      if (!payment.provider_id)
        throw fail(
          409,
          "Платёж ещё создаётся. Повторите открытие тестовой оплаты.",
        );
      const remote = await provider.getPayment(payment.provider_id);
      verifyRemote(remote, payment);
      if (remote.id !== payment.provider_id)
        throw fail(
          502,
          "Ответ платёжного сервиса относится к другой операции.",
        );
      db.exec("BEGIN IMMEDIATE");
      try {
        const current = db
          .prepare("SELECT * FROM housing_payments WHERE id=? AND user_id=?")
          .get(paymentId, userId);
        if (
          remote.status === "succeeded" &&
          remote.paid === true &&
          current.status !== "succeeded"
        ) {
          const now = new Date().toISOString();
          db.prepare(
            "UPDATE housing_payments SET status='succeeded',updated_at=? WHERE id=? AND user_id=?",
          ).run(now, paymentId, userId);
          db.prepare(
            "UPDATE housing_invoices SET status='paid',paid_at=? WHERE id=? AND user_id=?",
          ).run(now, payment.invoice_id, userId);
          notify(userId, {
            id: `housing-${paymentId}-test-paid`,
            title: "Тестовая оплата подтверждена",
            body: "YooKassa подтвердила тестовый платёж. Настоящие деньги не списывались.",
            category: "housing",
            route: "housing",
            focusId: payment.invoice_id,
          });
        } else if (
          remote.status === "canceled" &&
          current.status !== "succeeded"
        )
          db.prepare(
            "UPDATE housing_payments SET status='canceled',updated_at=? WHERE id=? AND user_id=?",
          ).run(new Date().toISOString(), paymentId, userId);
        const result = {
          payment: paymentView(
            db
              .prepare(
                "SELECT * FROM housing_payments WHERE id=? AND user_id=?",
              )
              .get(paymentId, userId),
          ),
          invoice: invoiceView(ownInvoice(userId, payment.invoice_id)),
        };
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
  function verifyRemote(remote, payment) {
    if (
      remote.test !== true ||
      remote.amount?.currency !== "RUB" ||
      remote.amount?.value !== (payment.amount_minor / 100).toFixed(2) ||
      remote.metadata?.orbita_invoice_id !== payment.invoice_id ||
      remote.metadata?.orbita_user_id !== payment.user_id
    )
      throw fail(
        502,
        "Данные тестового платежа не совпадают с начислением. Оплата не учтена.",
      );
  }
  const handle = (fn) => async (req, res, next) => {
    try {
      res.json(await fn(req));
    } catch (error) {
      next(error);
    }
  };
  const key = (req) => req.get("idempotency-key");
  app.get(
    "/api/campus/rooms",
    authenticate,
    handle((req) => service.listRooms(req.user.id, req.query)),
  );
  app.get(
    "/api/campus/availability",
    authenticate,
    handle((req) => service.availability(req.user.id, req.query)),
  );
  app.get(
    "/api/campus/bookings",
    authenticate,
    handle((req) => service.listBookings(req.user.id)),
  );
  app.post(
    "/api/campus/bookings",
    authenticate,
    handle((req) => service.createBooking(req.user.id, req.body, key(req))),
  );
  app.post(
    "/api/campus/bookings/:id/cancel",
    authenticate,
    handle((req) => service.cancelBooking(req.user.id, req.params.id)),
  );
  app.get(
    "/api/housing",
    authenticate,
    handle((req) => service.getHousing(req.user.id)),
  );
  app.post(
    "/api/housing/invoices/:id/demo-pay",
    authenticate,
    handle((req) => {
      object(req.body, []);
      return service.payDemo(req.user.id, req.params.id, key(req));
    }),
  );
  app.post(
    "/api/housing/invoices/:id/checkout",
    authenticate,
    handle((req) => {
      object(req.body, []);
      return service.createCheckout(req.user.id, req.params.id, key(req));
    }),
  );
  app.post(
    "/api/housing/payments/:id/sync",
    authenticate,
    handle((req) => {
      object(req.body, []);
      return service.syncPayment(req.user.id, req.params.id);
    }),
  );
  app.get(
    "/api/housing/invoices/:id/receipt",
    authenticate,
    (req, res, next) => {
      try {
        const invoice = ownInvoice(req.user.id, req.params.id);
        const receipt = paidReceipt(req.user.id, invoice.id);
        if (!receipt)
          throw fail(409, "Подтверждённой оплаты этого начисления пока нет.");
        const account = service.getHousing(req.user.id).account;
        res.set(
          "Content-Disposition",
          `attachment; filename="orbita-demo-receipt-${receipt.id}.html"`,
        );
        res
          .type("html")
          .send(
            `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Демонстрационная квитанция · Орбита</title><body style="font:16px/1.7 system-ui;max-width:700px;margin:40px auto;padding:24px"><h1>Демонстрационная квитанция</h1><p><strong>ОБРАЗЕЦ · НЕ ЯВЛЯЕТСЯ ПЛАТЁЖНЫМ ДОКУМЕНТОМ</strong></p><p>Все данные вымышлены. Настоящие деньги не списывались.</p><dl><dt>Номер</dt><dd>${escape(receipt.receipt_number)}</dd><dt>Студент</dt><dd>${escape(account.tenant)}</dd><dt>Период</dt><dd>${escape(invoice.period)}</dd><dt>Сумма</dt><dd>${escape((invoice.amount_minor / 100).toFixed(2))} RUB</dd><dt>Режим</dt><dd>${receipt.mode === "demo" ? "Локальная демооплата" : "Тестовый магазин YooKassa"}</dd></dl></body></html>`,
          );
      } catch (error) {
        next(error);
      }
    },
  );
  return service;
}
