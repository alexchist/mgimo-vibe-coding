import { randomUUID } from "node:crypto";

const FIRST_DATE = "2026-11-16";
const LAST_DATE = "2026-11-22";
const validObject = (body, keys) =>
  body &&
  typeof body === "object" &&
  !Array.isArray(body) &&
  Object.keys(body).every((key) => keys.includes(key));
function validDate(value) {
  if (value === null) return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    value >= FIRST_DATE &&
    value <= LAST_DATE
  );
}

/** Academic deadlines remain immutable; this module only stores personal planning state. */
export function installPlanner(app, db, authenticate) {
  const records = (userId, kind) =>
    db
      .prepare(
        "SELECT payload_json FROM records WHERE user_id = ? AND kind = ?",
      )
      .all(userId, kind)
      .map((row) => JSON.parse(row.payload_json));
  const getRecord = (userId, id, kind) => {
    const row = db
      .prepare(
        "SELECT payload_json FROM records WHERE user_id = ? AND id = ? AND kind = ?",
      )
      .get(userId, id, kind);
    return row ? JSON.parse(row.payload_json) : null;
  };
  const getPlan = (userId) => {
    const states = new Map(
      records(userId, "planner_state").map((state) => [
        state.sourceId,
        state.completed === true,
      ]),
    );
    const academic = records(userId, "deadlines").map((deadline) => ({
      id: deadline.id,
      kind: "deadline",
      title: deadline.title,
      subject: deadline.subject,
      dueDate: deadline.date,
      completed: states.get(deadline.id) || false,
      sourceRoute: ["grades", "schedule"].includes(deadline.route)
        ? deadline.route
        : undefined,
    }));
    const items = [...academic, ...records(userId, "planner_task")].sort(
      (a, b) =>
        (a.dueDate || "9999").localeCompare(b.dueDate || "9999") ||
        a.id.localeCompare(b.id),
    );
    return { items, referenceDate: FIRST_DATE };
  };
  const find = (userId, id) =>
    getPlan(userId).items.find((item) => item.id === id);
  app.get("/api/plan", authenticate, (req, res) =>
    res.json(getPlan(req.user.id)),
  );
  app.post("/api/plan", authenticate, (req, res) => {
    if (!validObject(req.body, ["title", "dueDate"]))
      return res
        .status(400)
        .json({ error: "Допустимы только название и дата личного дела." });
    const { title, dueDate = null } = req.body;
    if (typeof title !== "string" || !title.trim() || title.trim().length > 120)
      return res
        .status(400)
        .json({ error: "Название должно содержать от 1 до 120 символов." });
    if (!validDate(dueDate))
      return res.status(400).json({
        error:
          "Выберите дату демо-недели 16–22 ноября 2026 или оставьте срок пустым.",
      });
    const count = db
      .prepare(
        "SELECT COUNT(*) AS n FROM records WHERE user_id = ? AND kind = 'planner_task'",
      )
      .get(req.user.id).n;
    if (count >= 100)
      return res.status(429).json({
        error:
          "В личном плане можно хранить до 100 своих дел. Удалите ненужное, чтобы добавить новое.",
      });
    const item = {
      id: randomUUID(),
      kind: "personal",
      title: title.trim(),
      subject: "Личное дело",
      dueDate,
      completed: false,
    };
    db.prepare(
      "INSERT INTO records (id, user_id, kind, payload_json) VALUES (?, ?, ?, ?)",
    ).run(item.id, req.user.id, "planner_task", JSON.stringify(item));
    res.status(201).json({ item });
  });
  app.patch("/api/plan/:id", authenticate, (req, res) => {
    const item = find(req.user.id, req.params.id);
    if (!item)
      return res
        .status(404)
        .json({ error: "Дело недоступно или больше не существует." });
    if (
      !validObject(req.body, ["completed"]) ||
      typeof req.body.completed !== "boolean"
    )
      return res.status(400).json({
        error: "Передайте только личную отметку completed: true или false.",
      });
    if (item.kind === "deadline") {
      const state = { sourceId: item.id, completed: req.body.completed };
      db.prepare(
        `INSERT INTO records (id, user_id, kind, payload_json) VALUES (?, ?, 'planner_state', ?)
        ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json WHERE records.user_id = excluded.user_id AND records.kind = 'planner_state'`,
      ).run(`planner-state:${item.id}`, req.user.id, JSON.stringify(state));
    } else {
      const stored = getRecord(req.user.id, item.id, "planner_task");
      stored.completed = req.body.completed;
      db.prepare(
        "UPDATE records SET payload_json = ? WHERE id = ? AND user_id = ? AND kind = 'planner_task'",
      ).run(JSON.stringify(stored), item.id, req.user.id);
    }
    res.json({ item: { ...item, completed: req.body.completed } });
  });
  app.delete("/api/plan/:id", authenticate, (req, res) => {
    const item = find(req.user.id, req.params.id);
    if (!item)
      return res
        .status(404)
        .json({ error: "Дело недоступно или больше не существует." });
    if (item.kind !== "personal")
      return res.status(409).json({
        error:
          "Учебные сроки нельзя удалять. Можно изменить только личную отметку готовности.",
      });
    db.prepare(
      "DELETE FROM records WHERE id = ? AND user_id = ? AND kind = 'planner_task'",
    ).run(item.id, req.user.id);
    res.json({ ok: true });
  });
  return getPlan;
}
