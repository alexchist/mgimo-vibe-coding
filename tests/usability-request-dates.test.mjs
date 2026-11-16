import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../server/database.mjs";
import { createRequestService } from "../server/requests.mjs";

function fixture(t, now) {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(now) });
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  return createRequestService(db, { notify() {} });
}
const body = { type: "enrollment", purpose: "Учебная стажировка" };

test("three working days start from the Moscow creation date, preserving UTC timestamps", (t) => {
  const createdAt = "2026-11-16T21:30:44.000Z"; // Tuesday, 17 November in Moscow.
  const service = fixture(t, createdAt);
  const { request } = service.create("student-alisa", body);
  assert.equal(request.estimatedDate, "2026-11-20"); // Wed, Thu, Fri.
  assert.equal(request.createdAt, createdAt);
  assert.equal(request.updatedAt, createdAt);
  assert.equal(request.history[0].at, createdAt);
});

test("the estimate changes at Moscow midnight rather than UTC midnight", (t) => {
  const service = fixture(t, "2026-11-16T20:59:59.000Z");
  assert.equal(
    service.create("student-alisa", body).request.estimatedDate,
    "2026-11-19",
  );
  t.mock.timers.tick(1000);
  assert.equal(
    service.create("student-alisa", body).request.estimatedDate,
    "2026-11-20",
  );
});

test("Moscow weekend and Monday boundaries still skip Saturday and Sunday", (t) => {
  const service = fixture(t, "2026-11-19T21:30:00.000Z"); // Friday in Moscow.
  assert.equal(
    service.create("student-alisa", body).request.estimatedDate,
    "2026-11-25",
  );
  t.mock.timers.setTime(new Date("2026-11-22T20:59:59.000Z").getTime()); // Sunday.
  assert.equal(
    service.create("student-alisa", body).request.estimatedDate,
    "2026-11-25",
  );
  t.mock.timers.tick(1000); // Monday, 23 November in Moscow.
  assert.equal(
    service.create("student-alisa", body).request.estimatedDate,
    "2026-11-26",
  );
});

test("retrying the same request after Moscow midnight preserves its original estimate", (t) => {
  const service = fixture(t, "2026-11-16T20:59:59.000Z");
  const first = service.create("student-alisa", body, "moscow-request-retry");
  t.mock.timers.tick(1000);
  const retry = service.create("student-alisa", body, "moscow-request-retry");
  assert.equal(retry.status, 200);
  assert.deepEqual(retry.request, first.request);
  assert.equal(retry.request.estimatedDate, "2026-11-19");
});
