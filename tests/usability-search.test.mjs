import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import express from "express";
import { installKnowledge } from "../server/knowledge.mjs";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES ('alice'), ('bob');",
  );
  const knowledge = installKnowledge(express(), db, (_req, _res, next) =>
    next(),
  );
  return { db, knowledge };
}

test("retake question does not quote an unrelated booking rule merely containing a date", () => {
  const { db, knowledge } = fixture();
  try {
    const result = knowledge.search(
      "alice",
      "Где и когда узнать дату пересдачи?",
    );
    assert.equal(result.hasResults, true);
    assert.ok(
      result.sources.every(
        (source) => source.documentId === "demo-assessment-policy",
      ),
      JSON.stringify(result.sources),
    );
    assert.match(result.sources[0].quote, /Даты пересдач.*не установлены/);
  } finally {
    db.close();
  }
});

test("a focused scholarship and debt question does not substitute academic leave or a certificate", () => {
  const { db, knowledge } = fixture();
  try {
    for (const query of [
      "академическая задолженность стипендия",
      "стипендия при академической задолженности",
    ]) {
      const result = knowledge.search("alice", query);
      assert.equal(result.hasResults, true);
      assert.ok(
        result.sources.every((source) => /задолженности/.test(source.quote)),
        JSON.stringify(result.sources),
      );
      assert.match(
        result.sources[0].quote,
        /при отсутствии академической задолженности/,
      );
    }
  } finally {
    db.close();
  }
});

test("topic filtering works for newly imported documents and keeps authorization before ranking", async () => {
  const { db, knowledge } = fixture();
  try {
    const { document } = await knowledge.importDocument("alice", {
      title: "Вымышленный астрономический клуб",
      text: "1. Астрономический клуб встречается по четвергам. Дату следующего собрания публикуют в его учебном календаре.",
    });
    await knowledge.importDocument("alice", {
      title: "Даты спортивного турнира",
      text: "1. Дату и время вымышленного турнира определяют в конце месяца. Участникам нужно узнать дату заранее.",
    });
    const query = "Где узнать дату астрономического клуба?";
    const result = knowledge.search("alice", query);
    assert.equal(result.hasResults, true);
    assert.ok(
      result.sources.every((source) => source.documentId === document.id),
    );
    assert.equal(knowledge.search("bob", query).hasResults, false);
    assert.equal(
      knowledge.search("alice", "дата").hasResults,
      true,
      "A broad date-only search remains possible",
    );
  } finally {
    db.close();
  }
});

test("a broad question can still retrieve different topics when no clause covers them together", () => {
  const { db, knowledge } = fixture();
  try {
    const result = knowledge.search(
      "alice",
      "Найди правила стипендии и общежития",
    );
    const ids = new Set(result.sources.map((source) => source.documentId));
    assert.ok(ids.has("demo-scholarship-policy"));
    assert.ok(ids.has("demo-housing-policy"));
  } finally {
    db.close();
  }
});
