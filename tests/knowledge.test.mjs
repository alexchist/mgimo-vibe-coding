import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { installKnowledge } from "../server/knowledge.mjs";

function fixture(databasePath = ":memory:", options = {}) {
  const db = new DatabaseSync(databasePath);
  db.exec(
    "PRAGMA foreign_keys = ON; CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY); INSERT OR IGNORE INTO users VALUES ('alice'), ('bob');",
  );
  const app = express();
  app.use(express.json({ limit: "3mb" }));
  const authenticate = (req, res, next) => {
    if (!["alice", "bob"].includes(req.headers["x-test-user"]))
      return res.status(401).json({ error: "Нужен вход" });
    req.user = { id: req.headers["x-test-user"] };
    if (req.method !== "GET" && req.headers["x-test-csrf"] !== "valid")
      return res.status(403).json({ error: "Нужен CSRF" });
    next();
  };
  const knowledge = installKnowledge(app, db, authenticate, options);
  app.use((error, req, res, next) =>
    res.status(error.status || 500).json({ error: error.message }),
  );
  return { db, app, knowledge };
}

function pdfFixture(
  text = "The fictional astronomy club opens its reading room every Thursday.",
  pages = 1,
  padding = 0,
) {
  const stream = text
    ? `BT /F1 14 Tf 40 100 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`
    : "";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${i + 5} 0 R`).join(" ")}] /Count ${pages} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    ...Array.from(
      { length: pages },
      () =>
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>",
    ),
  ];
  let result = `%PDF-1.4\n${padding ? `%${" ".repeat(padding)}\n` : ""}`;
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(result));
    result += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(result);
  result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join(
      "",
    )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(result).toString("base64");
}

test("demo retrieval returns relevant Russian clauses, exact citations and explicitly fictional versions", () => {
  const { knowledge, db } = fixture();
  try {
    assert.equal(knowledge.listDocuments("alice").documents.length, 5);
    const cases = [
      ["Как отменить бронь комнаты?", "demo-room-rules", /Отменить свою бронь/],
      ["Когда оплачивать общежитие?", "demo-housing-policy", /25 ноября 2026/],
      [
        "За сколько дней готовят справку?",
        "demo-document-orders",
        /три рабочих дня/,
      ],
    ];
    for (const [question, documentId, quote] of cases) {
      const result = knowledge.search("alice", question);
      assert.equal(result.hasResults, true);
      assert.equal(result.sources[0].documentId, documentId, question);
      assert.match(result.sources[0].quote, quote, question);
      for (const source of result.sources) {
        const document = knowledge.getDocument(
          "alice",
          source.documentId,
        ).document;
        assert.equal(
          source.quote,
          document.sections.find(
            (section) => section.chunkId === source.chunkId,
          ).text,
        );
        assert.ok(source.section && source.version && source.updatedAt);
        assert.equal(source.fictional, true);
      }
    }
    assert.deepEqual(
      knowledge.search("alice", "Стоимость квантовой телепортации").sources,
      [],
    );
    assert.equal(knowledge.search("alice", "и или на").hasResults, false);
    assert.equal(
      knowledge.search("alice", "Когда появится квантовая телепортация?")
        .hasResults,
      false,
    );
    assert.equal(knowledge.search("alice", "когда").hasResults, false);
    assert.throws(() => knowledge.search("alice", "a"), { status: 400 });
    assert.throws(() => knowledge.search("alice", "a".repeat(501)), {
      status: 400,
    });
  } finally {
    db.close();
  }
});

test("private import is isolated before ranking and document access; HTML and SQL remain plain text", async () => {
  const { knowledge, db } = fixture();
  try {
    const text =
      "# Учебный клуб\n\n1. Гелиотропная оранжерея работает по вымышленным четвергам.\n\n2. <script>alert('fictional')</script> — пример текста, не команда.";
    const { document } = await knowledge.importDocument("alice", {
      title: "Учебная оранжерея",
      text,
      fileName: "rules.md",
    });
    assert.equal(document.private, true);
    assert.equal(document.canDelete, true);
    assert.equal(document.format, "md");
    assert.equal(document.sections.length, 2);
    assert.equal(
      knowledge.search("alice", "гелиотропная").sources[0].documentId,
      document.id,
    );
    assert.equal(knowledge.search("bob", "гелиотропная").hasResults, false);
    assert.equal(
      knowledge
        .listDocuments("bob")
        .documents.some((item) => item.id === document.id),
      false,
    );
    assert.throws(() => knowledge.getDocument("bob", document.id), {
      status: 404,
    });
    assert.throws(() => knowledge.deleteDocument("bob", document.id), {
      status: 404,
    });
    assert.throws(() => knowledge.getDocument("alice", "' OR 1=1 --"), {
      status: 404,
    });
    assert.doesNotThrow(() =>
      knowledge.search("bob", "' OR 1=1 -- AND title:*"),
    );
    assert.equal(
      knowledge.getDocument("alice", document.id).document.text,
      text,
    );
    assert.throws(() => knowledge.deleteDocument("alice", "demo-room-rules"), {
      status: 403,
    });
    knowledge.deleteDocument("alice", document.id);
    assert.equal(knowledge.search("alice", "гелиотропная").hasResults, false);
    assert.equal(
      db
        .prepare(
          "SELECT count(*) AS count FROM knowledge_chunks WHERE document_id=?",
        )
        .get(document.id).count,
      0,
    );
  } finally {
    db.close();
  }
});

test("unknown owner fields, empty documents, oversized text and recognizable secrets are rejected", async () => {
  const { knowledge, db } = fixture();
  try {
    const base = {
      title: "Учебное правило",
      text: "Вымышленный учебный клуб встречается по четвергам.",
    };
    for (const body of [
      null,
      [],
      { ...base, userId: "bob" },
      { ...base, title: " " },
      { ...base, text: "123456789012345678901" },
      { ...base, text: 123 },
      { ...base, pdfBase64: "" },
      { ...base, text: "password=very-secret-fictional-password" },
      { ...base, text: "API_KEY = 'fictional-api-key-1234'" },
      {
        ...base,
        text: `Учебный пример секретного значения orbita_mcp_${"a".repeat(64)}`,
      },
      {
        ...base,
        text: `Учебный пример токена бота 123456789:${"x".repeat(35)}`,
      },
    ]) {
      await assert.rejects(knowledge.importDocument("alice", body), {
        status: 400,
      });
    }
    await assert.rejects(
      knowledge.importDocument("alice", { ...base, text: "а".repeat(100_001) }),
      { status: 413 },
    );
    assert.equal(knowledge.listDocuments("alice").documents.length, 5);
  } finally {
    db.close();
  }
});

test("PDF import extracts a real text layer with page citations and rejects scans, malformed files and limits", async () => {
  const { knowledge, db } = fixture();
  try {
    const { document } = await knowledge.importDocument("alice", {
      title: "Fictional astronomy",
      fileName: "club.pdf",
      pdfBase64: pdfFixture(),
    });
    assert.equal(document.format, "pdf");
    assert.match(document.text, /astronomy club/);
    const source = knowledge.search("alice", "astronomy").sources[0];
    assert.equal(source.documentId, document.id);
    assert.equal(source.section, "Страница 1");
    await assert.rejects(
      knowledge.importDocument("alice", {
        title: "Scan",
        pdfBase64: pdfFixture(""),
      }),
      (error) => error.status === 400 && /текстового слоя/.test(error.message),
    );
    await assert.rejects(
      knowledge.importDocument("alice", {
        title: "Broken",
        pdfBase64: Buffer.from("%PDF-1.4 corrupted input, no pages").toString(
          "base64",
        ),
      }),
      { status: 400 },
    );
    await assert.rejects(
      knowledge.importDocument("alice", {
        title: "Wrong format",
        pdfBase64: Buffer.from("This is not a PDF").toString("base64"),
      }),
      { status: 400 },
    );
    await assert.rejects(
      knowledge.importDocument("alice", {
        title: "Invalid base64",
        pdfBase64: "%%%",
      }),
      { status: 400 },
    );
    await assert.rejects(
      knowledge.importDocument("alice", {
        title: "Too big",
        pdfBase64: Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64"),
      }),
      { status: 413 },
    );
    await assert.rejects(
      knowledge.importDocument("alice", {
        title: "Too many pages",
        pdfBase64: pdfFixture(
          "A fictional page contains only harmless study material.",
          81,
        ),
      }),
      { status: 413 },
    );
    assert.equal(knowledge.listDocuments("alice").documents.length, 6);
  } finally {
    db.close();
  }
});

test("large allowed PDFs use bounded parsing and canonical base64 without regex stack overflow", async () => {
  const { knowledge, db } = fixture();
  try {
    const pdfBase64 = pdfFixture(
      "A fictional astronomy society has a harmless learning handbook.",
      1,
      1_900_000,
    );
    assert.ok(Buffer.from(pdfBase64, "base64").length < 2 * 1024 * 1024);
    const { document } = await knowledge.importDocument("alice", {
      title: "Large study PDF",
      pdfBase64,
    });
    assert.match(document.text, /astronomy society/);
    await assert.rejects(
      knowledge.importDocument("alice", {
        title: "Noncanonical",
        pdfBase64: "Zh==",
      }),
      { status: 400 },
    );
  } finally {
    db.close();
  }
});

test("PDF work is limited to two workers, one per account, and a timeout releases its slot", async () => {
  const { knowledge, db } = fixture();
  db.prepare("INSERT INTO users VALUES (?)").run("charlie");
  const body = { title: "Study PDF", pdfBase64: pdfFixture() };
  let pending = [];
  try {
    pending = [
      knowledge.importDocument("alice", body),
      knowledge.importDocument("bob", body),
    ];
    await assert.rejects(knowledge.importDocument("alice", body), {
      status: 429,
    });
    await assert.rejects(knowledge.importDocument("charlie", body), {
      status: 429,
    });
    assert.equal(knowledge.listDocuments("alice").documents.length, 5);
    const completed = await Promise.all(pending);
    assert.ok(completed.every((result) => result.document.format === "pdf"));
    const repeated = await knowledge.importDocument("alice", body);
    assert.equal(repeated.duplicate, true);
  } finally {
    await Promise.allSettled(pending);
    db.close();
  }
  const timeoutFixture = fixture(":memory:", { pdfTimeoutMs: 1 });
  try {
    await assert.rejects(
      timeoutFixture.knowledge.importDocument("alice", body),
      { status: 408 },
    );
    assert.equal(
      timeoutFixture.knowledge.listDocuments("alice").documents.length,
      5,
    );
    await assert.rejects(
      timeoutFixture.knowledge.importDocument("alice", body),
      { status: 408 },
    );
    assert.ok(
      (
        await timeoutFixture.knowledge.importDocument("alice", {
          title: "Text fallback",
          text: "A fictional astronomy society has a harmless learning handbook.",
        })
      ).document,
    );
  } finally {
    timeoutFixture.db.close();
  }
});

test("duplicate import is idempotent across restart and cannot use another account's duplicate", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "orbita-knowledge-"));
  const filename = path.join(directory, "test.sqlite");
  const body = {
    title: "Памятка учебного клуба",
    text: "1. Фиалковый учебный клуб встречается по понедельникам.",
  };
  let fixtureOne = fixture(filename);
  try {
    const first = await fixtureOne.knowledge.importDocument("alice", body);
    fixtureOne.db.close();
    fixtureOne = fixture(filename);
    const second = await fixtureOne.knowledge.importDocument("alice", body);
    assert.equal(second.duplicate, true);
    assert.equal(second.document.id, first.document.id);
    assert.equal(
      fixtureOne.knowledge.listDocuments("alice").documents.length,
      6,
    );
    const bob = await fixtureOne.knowledge.importDocument("bob", body);
    assert.notEqual(bob.document.id, first.document.id);
    assert.equal(
      fixtureOne.knowledge.search("bob", "фиалковый").sources.length,
      1,
    );
    assert.equal(
      fixtureOne.knowledge.search("bob", "фиалковый").sources[0].documentId,
      bob.document.id,
    );
  } finally {
    fixtureOne.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("account quotas preserve existing files and allow deletion followed by another upload", async () => {
  const { knowledge, db } = fixture();
  try {
    let first;
    for (let index = 0; index < 30; index++) {
      const result = await knowledge.importDocument("alice", {
        title: `Учебный документ ${index}`,
        text: "Вымышленная аудитория доступна для учебных проектов.",
      });
      if (!index) first = result.document;
    }
    const next = {
      title: "Следующий учебный документ",
      text: "Вымышленная аудитория доступна для учебных проектов.",
    };
    await assert.rejects(knowledge.importDocument("alice", next), {
      status: 429,
    });
    const duplicate = await knowledge.importDocument("alice", {
      title: first.title,
      text: first.text,
    });
    assert.equal(duplicate.duplicate, true);
    assert.ok((await knowledge.importDocument("bob", next)).document.private);
    knowledge.deleteDocument("alice", first.id);
    assert.ok((await knowledge.importDocument("alice", next)).document.private);
    assert.equal(
      knowledge
        .listDocuments("alice")
        .documents.filter((document) => document.private).length,
      30,
    );
  } finally {
    db.close();
  }
});

test("all HTTP knowledge routes use supplied authentication and write protection", async () => {
  const { app, db } = fixture();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const [url, method] of [
      ["/documents", "GET"],
      ["/documents/demo-room-rules", "GET"],
      ["/search?q=бронь", "GET"],
      ["/documents", "POST"],
      ["/documents/demo-room-rules", "DELETE"],
    ]) {
      const response = await fetch(`${origin}/api/knowledge${url}`, { method });
      assert.equal(response.status, 401, `${method} ${url}`);
    }
    const denied = await fetch(`${origin}/api/knowledge/documents`, {
      method: "POST",
      headers: { "x-test-user": "alice", "content-type": "application/json" },
      body: JSON.stringify({
        title: "Тест",
        text: "Вымышленный учебный клуб встречается по четвергам.",
      }),
    });
    assert.equal(denied.status, 403);
    const headers = {
      "x-test-user": "alice",
      "x-test-csrf": "valid",
      "content-type": "application/json",
    };
    const body = JSON.stringify({
      title: "Тест",
      text: "Вымышленный учебный клуб встречается по четвергам.",
    });
    const created = await fetch(`${origin}/api/knowledge/documents`, {
      method: "POST",
      headers,
      body,
    });
    assert.equal(created.status, 201);
    const { document } = await created.json();
    assert.equal(
      (
        await fetch(`${origin}/api/knowledge/documents/${document.id}`, {
          headers: { "x-test-user": "bob" },
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await fetch(`${origin}/api/knowledge/documents`, {
          method: "POST",
          headers,
          body,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(`${origin}/api/knowledge/documents/${document.id}`, {
          method: "DELETE",
          headers,
        })
      ).status,
      200,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
