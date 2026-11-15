import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createApp } from "../server/app.mjs";

test("local stdio bridge speaks MCP to the HTTP server without exposing the bearer token", async () => {
  const app = createApp({
    databasePath: ":memory:",
    campus: { paymentMode: "demo" },
    assistant: { yandex: { apiKey: "", folderId: "", model: "" } },
  });
  const listener = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${listener.address().port}`;
  const client = new Client({ name: "stdio-review", version: "1.0.0" });
  let transport,
    stderr = "";
  try {
    const login = await fetch(`${base}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        login: "alisa@demo.orbita",
        password: "Orbita2026!",
      }),
    });
    const session = await login.json();
    const minted = await fetch(`${base}/api/mcp/tokens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: login.headers.get("set-cookie").split(";")[0],
        "X-CSRF-Token": session.csrfToken,
      },
      body: JSON.stringify({
        name: "Stdio проверка",
        scopes: ["schedule:read"],
      }),
    });
    assert.equal(minted.status, 201);
    const { token, record } = await minted.json();
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve("scripts/mcp-stdio.mjs")],
      env: { ORBITA_MCP_URL: `${base}/mcp`, ORBITA_MCP_TOKEN: token },
      stderr: "pipe",
    });
    transport.stderr?.on("data", (part) => {
      stderr += part.toString();
    });
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "get_schedule"));
    const result = await client.callTool({
      name: "get_schedule",
      arguments: { date: "2026-11-17" },
    });
    assert.notEqual(result.isError, true);
    assert.equal(result.structuredContent.date, "2026-11-17");
    assert.ok(result.structuredContent.lessons.length > 0);
    assert.equal(
      (await client.callTool({ name: "get_profile", arguments: {} })).isError,
      true,
    );
    const row = app.locals.db
      .prepare("SELECT * FROM mcp_tokens WHERE id=?")
      .get(record.id);
    assert.equal(JSON.stringify(row).includes(token), false);
    app.locals.db
      .prepare("UPDATE mcp_tokens SET expires_at=0 WHERE id=?")
      .run(record.id);
    await assert.rejects(
      client.callTool({ name: "get_schedule", arguments: {} }),
    );
    assert.equal(stderr.includes(token), false);
  } finally {
    await client.close();
    await transport?.close();
    await new Promise((resolve) => listener.close(resolve));
    await app.locals.close();
  }
});

test("booking confirmation rechecks availability and a failed proposal can safely be retried", async () => {
  const app = createApp({
    databasePath: ":memory:",
    campus: { paymentMode: "demo" },
  });
  try {
    const { campus, actions } = app.locals.services;
    const [alisa, mark] = app.locals.db
      .prepare("SELECT id FROM users ORDER BY login")
      .all()
      .map((row) => row.id);
    const roomId = campus.listRooms(alisa).rooms[0].id;
    const params = {
      roomId,
      date: "2026-11-20",
      start: "10:00",
      end: "11:00",
      purpose: "Учебная встреча",
    };
    const { action } = await actions.prepare(alisa, {
      type: "booking.create",
      params,
    });
    const { booking } = campus.createBooking(
      mark,
      params,
      "second_student_claim",
    );
    await assert.rejects(
      actions.confirm(alisa, action.id),
      (error) => error.status === 409,
    );
    assert.equal(actions.get(alisa, action.id).action.status, "pending");
    campus.cancelBooking(mark, booking.id);
    const result = await actions.confirm(alisa, action.id);
    const repeated = await actions.confirm(alisa, action.id);
    assert.equal(repeated.result.booking.id, result.result.booking.id);
    assert.equal(campus.listBookings(alisa).bookings.length, 1);
    await assert.rejects(
      actions.prepare(alisa, {
        type: "booking.create",
        params: { ...params, start: "12:01", end: "13:00" },
      }),
      (error) => error.status === 400,
    );
  } finally {
    await app.locals.close();
  }
});

test("framework errors never expose server paths as public domain validation messages", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "orbita-static-review-"));
  await writeFile(
    path.join(folder, "index.html"),
    "<html lang='ru'><title>Демо</title></html>",
  );
  const app = createApp({ databasePath: ":memory:", distPath: folder });
  const listener = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    await rm(path.join(folder, "index.html"));
    const response = await fetch(
      `http://127.0.0.1:${listener.address().port}/`,
      { headers: { Accept: "text/html" } },
    );
    assert.equal(response.status, 500);
    const body = await response.text();
    assert.ok(body.includes("Не удалось выполнить запрос"));
    assert.equal(body.includes(folder), false);
    assert.equal(body.includes("ENOENT"), false);
  } finally {
    await new Promise((resolve) => listener.close(resolve));
    await app.locals.close();
    await rm(folder, { recursive: true, force: true });
  }
});
