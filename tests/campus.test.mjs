import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { createApp } from "../server/app.mjs";
import { openDatabase } from "../server/database.mjs";
import { installCampus } from "../server/campus.mjs";

const ALISA = "student-alisa";
const MARK = "student-mark";
const invoiceId = `${ALISA}-housing-2026-11`;
const bookingInput = {
  roomId: "room-dialog",
  date: "2026-11-16",
  start: "09:00",
  end: "10:00",
  purpose: "Подготовка учебного проекта",
};

function fixture(t, options = {}) {
  const db = openDatabase(":memory:");
  const events = [];
  const service = installCampus(express(), db, (_req, _res, next) => next(), {
    paymentMode: "demo",
    notify: (userId, event) => events.push({ userId, ...event }),
    ...options,
  });
  t.after(() => db.close());
  return { db, service, events };
}
const providerOptions = (fetchImpl) => ({
  paymentMode: "yookassa-test",
  shopId: "123456",
  secretKey: "test_campus_fixture",
  returnUrl: "https://demo.example/#housing",
  fetchImpl,
});
const remotePayment = (body, changes = {}) => ({
  id: "provider-payment-1",
  test: true,
  status: "pending",
  paid: false,
  amount: body.amount,
  metadata: body.metadata,
  confirmation: {
    confirmation_url:
      "https://yoomoney.ru/checkout/payments/v2/contract?orderId=demo",
  },
  ...changes,
});
const jsonResponse = (body) => ({ ok: true, json: async () => body });

test("campus HTTP: sessions, CSRF, private occupancy, competing bookings and durable demo receipts", async (t) => {
  const app = createApp({
    databasePath: ":memory:",
    secureCookies: false,
    campus: { paymentMode: "demo" },
  });
  const server = await new Promise((resolve) => {
    const value = app.listen(0, "127.0.0.1", () => resolve(value));
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await app.locals.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(
    path,
    { method = "GET", body, session, headers = {} } = {},
  ) {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(session
          ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf }
          : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: response.status, json, text, headers: response.headers };
  }
  async function login(login) {
    const result = await call("/login", {
      method: "POST",
      body: { login, password: "Orbita2026!" },
    });
    assert.equal(result.status, 200, result.text);
    return {
      cookie: result.headers.get("set-cookie").split(";")[0],
      csrf: result.json.csrfToken,
    };
  }
  const alisa = await login("alisa@demo.orbita");
  const mark = await login("mark@demo.orbita");
  await t.test(
    "all private campus and housing reads require a session",
    async () => {
      for (const path of [
        "/campus/rooms",
        "/campus/bookings",
        "/campus/availability?roomId=room-dialog&date=2026-11-16",
        "/housing",
        `/housing/invoices/${invoiceId}/receipt`,
      ])
        assert.equal((await call(path)).status, 401, path);
      const result = await call("/campus/bookings", {
        method: "POST",
        body: bookingInput,
        session: { ...alisa, csrf: "incorrect" },
      });
      assert.equal(result.status, 403);
      const injected = await call("/campus/bookings", {
        method: "POST",
        body: { ...bookingInput, userId: MARK },
        session: alisa,
      });
      assert.equal(injected.status, 400);
    },
  );
  let booking;
  await t.test(
    "overlapping parallel POSTs have exactly one winner; free slots reveal no other user's data",
    async () => {
      const results = await Promise.all(
        [alisa, mark].map((session, index) =>
          call("/campus/bookings", {
            method: "POST",
            body: bookingInput,
            session,
            headers: { "Idempotency-Key": `race-key-${index}` },
          }),
        ),
      );
      assert.deepEqual(results.map((item) => item.status).sort(), [200, 409]);
      const winnerIndex = results.findIndex((item) => item.status === 200);
      booking = {
        ...results[winnerIndex].json.booking,
        owner: [alisa, mark][winnerIndex],
        stranger: [mark, alisa][winnerIndex],
      };
      const availability = await call(
        "/campus/availability?roomId=room-dialog&date=2026-11-16",
        { session: booking.stranger },
      );
      assert.equal(availability.status, 200);
      assert.equal(availability.json.slots[0].available, false);
      assert.equal(availability.json.slots[1].available, false);
      assert.equal(availability.json.slots[2].available, true);
      assert.ok(
        availability.json.slots.every(
          (slot) =>
            Object.keys(slot).sort().join(",") === "available,end,start",
        ),
      );
      assert.ok(!availability.text.includes(bookingInput.purpose));
      assert.ok(!availability.text.includes(ALISA));
      const strangerBookings = await call("/campus/bookings", {
        session: booking.stranger,
      });
      assert.equal(strangerBookings.json.bookings.length, 0);
    },
  );
  await t.test(
    "foreign cancellation is denied, own cancellation frees slots and retains history",
    async () => {
      assert.equal(
        (
          await call(`/campus/bookings/${booking.id}/cancel`, {
            method: "POST",
            body: {},
            session: booking.stranger,
          })
        ).status,
        404,
      );
      const cancellation = await call(`/campus/bookings/${booking.id}/cancel`, {
        method: "POST",
        body: {},
        session: booking.owner,
      });
      assert.equal(cancellation.json.booking.status, "cancelled");
      assert.equal(
        (
          await call(`/campus/bookings/${booking.id}/cancel`, {
            method: "POST",
            body: {},
            session: booking.owner,
          })
        ).status,
        200,
      );
      const availability = await call(
        "/campus/availability?roomId=room-dialog&date=2026-11-16",
        { session: booking.stranger },
      );
      assert.ok(availability.json.slots.every((slot) => slot.available));
      const history = await call("/campus/bookings", {
        session: booking.owner,
      });
      assert.equal(history.json.bookings[0].status, "cancelled");
    },
  );
  await t.test(
    "paying concurrently with distinct keys produces one receipt; foreign invoices and receipts are denied",
    async () => {
      const path = `/housing/invoices/${invoiceId}/demo-pay`;
      assert.equal(
        (await call(path, { method: "POST", body: {}, session: mark })).status,
        404,
      );
      assert.equal(
        (
          await call(path, {
            method: "POST",
            body: { amountMinor: 1 },
            session: alisa,
          })
        ).status,
        400,
      );
      const results = await Promise.all(
        ["payment-key-one", "payment-key-two"].map((key) =>
          call(path, {
            method: "POST",
            body: {},
            session: alisa,
            headers: { "Idempotency-Key": key },
          }),
        ),
      );
      assert.deepEqual(
        results.map((item) => item.status),
        [200, 200],
      );
      assert.equal(results[0].json.receipt.id, results[1].json.receipt.id);
      assert.equal(results[0].json.invoice.amountMinor, 385000);
      assert.equal(results[0].json.invoice.status, "paid");
      const housing = await call("/housing", { session: alisa });
      assert.equal(
        housing.json.payments.filter(
          (payment) => payment.invoiceId === invoiceId,
        ).length,
        1,
      );
      assert.equal(
        (
          await call(`/housing/invoices/${invoiceId}/receipt`, {
            session: mark,
          })
        ).status,
        404,
      );
      const receipt = await call(`/housing/invoices/${invoiceId}/receipt`, {
        session: alisa,
      });
      assert.equal(receipt.status, 200);
      assert.match(receipt.headers.get("content-disposition"), /^attachment;/);
      assert.match(receipt.text, /НЕ ЯВЛЯЕТСЯ ПЛАТЁЖНЫМ ДОКУМЕНТОМ/);
      assert.match(receipt.text, /3850\.00 RUB/);
      assert.match(receipt.text, /Настоящие деньги не списывались/);
      assert.equal(
        (
          await call(`/housing/invoices/${ALISA}-housing-2026-10/demo-pay`, {
            method: "POST",
            body: {},
            session: alisa,
            headers: { "Idempotency-Key": "payment-key-two" },
          })
        ).status,
        409,
      );
      const notifications = app.locals.db
        .prepare(
          "SELECT payload_json FROM records WHERE user_id=? AND kind='notifications'",
        )
        .all(ALISA);
      assert.equal(
        notifications.filter(
          (row) => JSON.parse(row.payload_json).title === "Демооплата учтена",
        ).length,
        1,
      );
    },
  );
});

test("booking validation, half-open adjacency, quotas and retry key semantics", (t) => {
  const { service, events } = fixture(t);
  for (const changes of [
    { date: "2026-11-23" },
    { date: "2026-11-00" },
    { start: "08:30" },
    { end: "21:30" },
    { start: "09:15" },
    { end: "09:00" },
    { end: "11:30" },
    { purpose: "  " },
    { purpose: "я".repeat(161) },
    { userId: MARK },
  ])
    assert.throws(
      () =>
        service.createBooking(
          ALISA,
          { ...bookingInput, ...changes },
          "bad-key-one",
        ),
      (error) => error.status === 400,
    );
  assert.throws(
    () =>
      service.createBooking(
        ALISA,
        { ...bookingInput, roomId: "missing-room" },
        "bad-key-two",
      ),
    (error) => error.status === 404,
  );
  const first = service.createBooking(
    ALISA,
    bookingInput,
    "same-key-one",
  ).booking;
  assert.equal(
    service.createBooking(
      ALISA,
      { ...bookingInput, purpose: ` ${bookingInput.purpose} ` },
      "same-key-one",
    ).booking.id,
    first.id,
  );
  assert.throws(
    () =>
      service.createBooking(
        ALISA,
        { ...bookingInput, purpose: "Другая цель" },
        "same-key-one",
      ),
    (error) => error.status === 409,
  );
  const adjacent = service.createBooking(
    MARK,
    { ...bookingInput, start: "10:00", end: "10:30" },
    "same-key-one",
  ).booking;
  assert.notEqual(adjacent.id, first.id);
  service.createBooking(
    ALISA,
    { ...bookingInput, roomId: "room-orbit" },
    "next-key-one",
  );
  service.createBooking(
    ALISA,
    { ...bookingInput, roomId: "room-quiet" },
    "next-key-two",
  );
  assert.throws(
    () =>
      service.createBooking(
        ALISA,
        { ...bookingInput, start: "13:00", end: "14:00" },
        "fourth-booking",
      ),
    (error) => error.status === 429,
  );
  service.cancelBooking(ALISA, first.id);
  assert.equal(
    service.createBooking(ALISA, bookingInput, "same-key-one").booking.status,
    "cancelled",
  );
  service.createBooking(
    ALISA,
    { ...bookingInput, start: "13:00", end: "14:00" },
    "fourth-booking",
  );
  assert.equal(
    service
      .listBookings(ALISA)
      .bookings.filter((item) => item.status === "confirmed").length,
    3,
  );
  assert.equal(
    events.filter((event) => event.id === `booking-${first.id}-created`).length,
    1,
  );
});

test("a failed notification write rolls back the booking and key together", (t) => {
  const { service, db } = fixture(t, {
    notify: () => {
      throw new Error("simulated DB notification failure");
    },
  });
  assert.throws(
    () => service.createBooking(ALISA, bookingInput, "rollback-key"),
    /simulated/,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM campus_bookings").get().n,
    0,
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM campus_keys").get().n, 0);
});

test("installing the campus module on an existing database preserves previous records and paid invoices", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "orbita-campus-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "existing.sqlite");
  let db = openDatabase(path);
  const originalRecords = db
    .prepare("SELECT COUNT(*) AS n FROM records")
    .get().n;
  let service = installCampus(express(), db, () => {}, { paymentMode: "demo" });
  const originalBooking = service.createBooking(
    ALISA,
    bookingInput,
    "persist-booking",
  ).booking;
  const originalReceipt = service.payDemo(
    ALISA,
    invoiceId,
    "persist-payment",
  ).receipt;
  db.close();
  db = openDatabase(path);
  t.after(() => db.close());
  service = installCampus(express(), db, () => {}, { paymentMode: "demo" });
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM records").get().n,
    originalRecords,
  );
  assert.equal(
    service.createBooking(ALISA, bookingInput, "persist-booking").booking.id,
    originalBooking.id,
  );
  assert.equal(
    service.payDemo(ALISA, invoiceId, "persist-payment").receipt.id,
    originalReceipt.id,
  );
  assert.equal(
    service.getHousing(ALISA).invoices.find((item) => item.id === invoiceId)
      .status,
    "paid",
  );
  assert.equal(
    service
      .getHousing(ALISA)
      .payments.filter((item) => item.invoiceId === invoiceId).length,
    1,
  );
});

test("YooKassa: no configured test secret means no external calls, even if a live secret was supplied", async (t) => {
  for (const secretKey of [undefined, "live_accidental_secret"]) {
    const { service } = fixture(t, {
      ...providerOptions(() => {
        assert.fail("must not call live provider");
      }),
      secretKey,
    });
    assert.equal(service.getHousing(ALISA).providerConfigured, false);
    await assert.rejects(
      service.createCheckout(ALISA, invoiceId, "no-live-key"),
      (error) => error.status === 503,
    );
    assert.throws(
      () => service.payDemo(ALISA, invoiceId, "demo-disabled"),
      (error) => error.status === 409,
    );
  }
});

test("YooKassa: checkout and return URL never mark invoice paid; only verified server GET succeeds once", async (t) => {
  const calls = [];
  let remote;
  const { service, events } = fixture(
    t,
    providerOptions(async (url, options) => {
      calls.push({ url, options });
      if (options.method === "POST")
        remote = remotePayment(JSON.parse(options.body), {
          status: "succeeded",
          paid: true,
        });
      return jsonResponse(remote);
    }),
  );
  const checkout = await service.createCheckout(
    ALISA,
    invoiceId,
    "checkout-demo-one",
  );
  assert.equal(checkout.payment.status, "pending");
  assert.equal(
    service.getHousing(ALISA).invoices.find((item) => item.id === invoiceId)
      .status,
    "unpaid",
  );
  assert.equal(
    (await service.createCheckout(ALISA, invoiceId, "checkout-demo-two"))
      .payment.id,
    checkout.payment.id,
  );
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(calls[0].url, "https://api.yookassa.ru/v3/payments");
  assert.equal(body.amount.value, "3850.00");
  assert.equal(body.amount.currency, "RUB");
  assert.equal(body.capture, true);
  assert.equal(body.confirmation.return_url, "https://demo.example/#housing");
  assert.equal(body.metadata.orbita_user_id, ALISA);
  assert.ok(calls[0].options.headers.Authorization.startsWith("Basic "));
  assert.ok(calls[0].options.headers["Idempotence-Key"].length <= 64);
  assert.equal(calls[0].options.redirect, "error");
  await assert.rejects(
    service.syncPayment(MARK, checkout.payment.id),
    (error) => error.status === 404,
  );
  const result = await service.syncPayment(ALISA, checkout.payment.id);
  assert.equal(result.invoice.status, "paid");
  assert.equal(result.payment.status, "succeeded");
  assert.equal(calls[1].options.method, "GET");
  assert.equal(
    calls[1].url,
    "https://api.yookassa.ru/v3/payments/provider-payment-1",
  );
  await service.syncPayment(ALISA, checkout.payment.id);
  assert.equal(calls.length, 2);
  assert.equal(
    events.filter((item) => item.title === "Тестовая оплата подтверждена")
      .length,
    1,
  );
});

test("YooKassa: mismatched test flag, amount, currency, owner and invoice cannot create a trusted checkout", async (t) => {
  const changes = [
    { test: false },
    { amount: { value: "1.00", currency: "RUB" } },
    { amount: { value: "3850.00", currency: "USD" } },
    { metadata: { orbita_invoice_id: invoiceId, orbita_user_id: MARK } },
    {
      metadata: {
        orbita_invoice_id: `${MARK}-housing-2026-11`,
        orbita_user_id: ALISA,
      },
    },
    {
      confirmation: {
        confirmation_url: "https://yoomoney.ru.evil.example/checkout",
      },
    },
    { confirmation: { confirmation_url: "javascript:alert(1)" } },
  ];
  for (const change of changes) {
    const { service, db } = fixture(
      t,
      providerOptions(async (_url, options) =>
        jsonResponse(remotePayment(JSON.parse(options.body), change)),
      ),
    );
    await assert.rejects(
      service.createCheckout(ALISA, invoiceId, "untrusted-response"),
      (error) => error.status === 502,
    );
    assert.equal(
      service.getHousing(ALISA).invoices.find((item) => item.id === invoiceId)
        .status,
      "unpaid",
    );
    assert.equal(
      db
        .prepare("SELECT status FROM housing_payments WHERE invoice_id=?")
        .get(invoiceId).status,
      "creating",
    );
  }
});

test("YooKassa: succeeded status with wrong ID or metadata cannot settle a pending invoice", async (t) => {
  let remote;
  let bad = {};
  const { service } = fixture(
    t,
    providerOptions(async (_url, options) => {
      if (options.method === "POST") {
        remote = remotePayment(JSON.parse(options.body));
        return jsonResponse(remote);
      }
      return jsonResponse({
        ...remote,
        status: "succeeded",
        paid: true,
        ...bad,
      });
    }),
  );
  const checkout = await service.createCheckout(
    ALISA,
    invoiceId,
    "mismatched-sync",
  );
  for (const change of [
    { id: "other-operation" },
    { test: false },
    { amount: { value: "0.01", currency: "RUB" } },
    { metadata: { orbita_invoice_id: invoiceId, orbita_user_id: MARK } },
  ]) {
    bad = change;
    await assert.rejects(
      service.syncPayment(ALISA, checkout.payment.id),
      (error) => error.status === 502,
    );
    assert.equal(
      service.getHousing(ALISA).invoices.find((item) => item.id === invoiceId)
        .status,
      "unpaid",
    );
  }
  bad = { paid: false };
  assert.equal(
    (await service.syncPayment(ALISA, checkout.payment.id)).invoice.status,
    "unpaid",
  );
  bad = { status: "canceled", paid: false };
  assert.equal(
    (await service.syncPayment(ALISA, checkout.payment.id)).payment.status,
    "canceled",
  );
});

test("YooKassa: network failures retry the saved provider key; stale uncertain attempts never create a second charge", async (t) => {
  const keys = [];
  let fail = true;
  const { service, db } = fixture(
    t,
    providerOptions(async (_url, options) => {
      keys.push(options.headers["Idempotence-Key"]);
      if (fail) throw new Error("network failure with unknown server result");
      return jsonResponse(remotePayment(JSON.parse(options.body)));
    }),
  );
  await assert.rejects(
    service.createCheckout(ALISA, invoiceId, "uncertain-checkout"),
    (error) => error.status === 502,
  );
  fail = false;
  const checkout = await service.createCheckout(
    ALISA,
    invoiceId,
    "another-browser-key",
  );
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS n FROM housing_payments WHERE invoice_id=?")
      .get(invoiceId).n,
    1,
  );
  db.prepare(
    "UPDATE housing_payments SET status='creating',provider_id=NULL,created_at=? WHERE id=?",
  ).run(
    new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    checkout.payment.id,
  );
  await assert.rejects(
    service.createCheckout(ALISA, invoiceId, "third-browser-key"),
    (error) => error.status === 409,
  );
  assert.equal(keys.length, 2);
});
