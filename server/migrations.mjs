// Add metadata to existing demos without resetting grades, requests or read state.
export function upgradeDemoRecords(db) {
  const save = db.prepare(
    "UPDATE records SET payload_json = ? WHERE id = ? AND user_id = ?",
  );
  db.exec("BEGIN IMMEDIATE");
  try {
    const rows = db.prepare("SELECT * FROM records").all();
    for (const row of rows) {
      const item = JSON.parse(row.payload_json);
      const before = JSON.stringify(item);
      if (row.kind === "grades" && !item.assessmentStatus) {
        // Existing scores describe coursework; they do not prove an exam/pass result.
        item.assessmentStatus = "pending";
        item.assessmentResult = null;
      }
      if (row.kind === "notifications" && !item.focusId) {
        if (row.id === `${row.user_id}-notice-1`) item.focusId = "day-1";
        if (row.id === `${row.user_id}-notice-3`) {
          item.route = "plan";
          item.focusId = `${row.user_id}-deadline-1`;
        }
        if (row.id === `${row.user_id}-notice-5`) item.focusId = "session";
        if (item.category === "request") {
          const request = rows
            .filter(
              (candidate) =>
                candidate.user_id === row.user_id &&
                candidate.kind === "requests",
            )
            .map((candidate) => JSON.parse(candidate.payload_json))
            .find(
              (candidate) =>
                item.body.includes(candidate.number) ||
                (row.id === `${row.user_id}-notice-2` &&
                  candidate.id === `${row.user_id}-request-ready`),
            );
          if (request) item.focusId = request.id;
        }
      }
      if (JSON.stringify(item) !== before)
        save.run(JSON.stringify(item), row.id, row.user_id);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
