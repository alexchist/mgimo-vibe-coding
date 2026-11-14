import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const errorsByPage = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = [];
  errorsByPage.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(
    errorsByPage.get(page),
    "Planner flows must not throw browser errors",
  ).toEqual([]);
});

async function signIn(request, login = "alisa@demo.orbita") {
  const response = await request.post("/api/login", {
    data: { login, password: "Orbita2026!" },
  });
  expect(response.status()).toBe(200);
  return response.json();
}
async function getPlan(request) {
  const response = await request.get("/api/plan");
  expect(response.status()).toBe(200);
  return response.json();
}
async function setCompleted(request, csrfToken, id, completed) {
  const response = await request.patch(`/api/plan/${id}`, {
    headers: { "X-CSRF-Token": csrfToken },
    data: { completed },
  });
  expect(response.status()).toBe(200);
}
async function openPlan(page, id = "") {
  await page.goto(`/#plan${id ? `/${encodeURIComponent(id)}` : ""}`);
  await expect(
    page.getByRole("heading", { name: "Мой план", level: 1, exact: true }),
  ).toBeVisible();
}
function rowFor(page, id) {
  return page.locator(`[id="plan-item-${id}"]`);
}
async function changeCheckbox(page, item, checked) {
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/plan/${item.id}`) &&
      response.request().method() === "PATCH",
  );
  const checkbox = rowFor(page, item.id).getByRole("checkbox", {
    name: item.title,
    exact: true,
  });
  if (checked) await expect(checkbox).not.toBeChecked();
  else await expect(checkbox).toBeChecked();
  // The controlled value changes only after the server confirms the write.
  await checkbox.click();
  expect((await saved).status()).toBe(200);
  await expect
    .poll(
      async () =>
        (await getPlan(page.request)).items.find(
          (value) => value.id === item.id,
        )?.completed,
    )
    .toBe(checked);
  if (checked) await expect(checkbox).toBeChecked();
  else await expect(checkbox).not.toBeChecked();
}
async function noHorizontalOverflow(page) {
  const size = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(size.width).toBeLessThanOrEqual(size.viewport + 1);
}
async function scan(page, testInfo, name) {
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) => animation.effect?.getTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  await testInfo.attach(`axe-${name}.json`, {
    body: JSON.stringify(
      { violations: result.violations, incomplete: result.incomplete },
      null,
      2,
    ),
    contentType: "application/json",
  });
  expect(
    result.violations.map(({ id, nodes }) => ({
      id,
      nodes: nodes.map((node) => ({
        target: node.target,
        failureSummary: node.failureSummary,
      })),
    })),
  ).toEqual([]);
}

test("the next step opens its real task; personal completion persists, advances and can be undone", async ({
  page,
}) => {
  const { csrfToken } = await signIn(page.request);
  const original = await getPlan(page.request);
  const initial = await (await page.request.get("/api/bootstrap")).json();
  const academic = original.items.filter((item) => item.kind === "deadline");
  expect(academic.length).toBeGreaterThan(1);
  for (const item of academic)
    await setCompleted(page.request, csrfToken, item.id, false);
  try {
    const ordered = (await getPlan(page.request)).items.filter(
      (item) => !item.completed,
    );
    const first = ordered[0];
    await page.goto("/#dashboard");
    await expect(page.locator(".welcome-copy")).toContainText(first.title);
    await page
      .getByRole("button", { name: "Мой следующий шаг", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`#plan/${first.id}$`));
    await expect(rowFor(page, first.id)).toBeFocused();
    await expect(page.locator(".plan-honesty")).toContainText(
      "не отправляет работу преподавателю и не меняет оценки",
    );
    await expect(
      rowFor(page, first.id).getByRole("button", { name: /^Удалить задачу:/ }),
    ).toHaveCount(0);
    await changeCheckbox(page, first, true);

    await page.goto("/#dashboard");
    const remaining = (await getPlan(page.request)).items.filter(
      (item) => !item.completed,
    );
    await expect(page.locator(".welcome-copy")).toContainText(
      remaining[0].title,
    );
    await expect(page.locator(".welcome-copy")).not.toContainText(first.title);
    await openPlan(page, first.id);
    await expect(rowFor(page, first.id)).toBeFocused();
    await expect(rowFor(page, first.id).getByRole("checkbox")).toBeChecked();
    await page.reload();
    await expect(rowFor(page, first.id).getByRole("checkbox")).toBeChecked();
    await changeCheckbox(page, first, false);
    await page.reload();
    await expect(
      rowFor(page, first.id).getByRole("checkbox"),
    ).not.toBeChecked();
    const fresh = await (await page.request.get("/api/bootstrap")).json();
    expect(fresh.deadlines).toEqual(initial.deadlines);
    expect(fresh.grades).toEqual(initial.grades);

    await page.goto("/#assistant");
    await page
      .getByRole("button", { name: "Какой ближайший дедлайн?", exact: true })
      .click();
    await expect(page.getByRole("log")).toContainText(
      "Личная отметка не означает сдачу работы",
    );
    await page
      .getByRole("button", { name: "Открыть дело в плане", exact: true })
      .click();
    const earliestAcademic = [...initial.deadlines].sort((a, b) =>
      a.date.localeCompare(b.date),
    )[0];
    await expect(page).toHaveURL(new RegExp(`#plan/${earliestAcademic.id}$`));
    await expect(rowFor(page, earliestAcademic.id)).toBeFocused();

    // Empty-state fixture uses the real API; completion controls were exercised above.
    for (const item of original.items)
      await setCompleted(page.request, csrfToken, item.id, true);
    await page.goto("/#dashboard");
    // API fixture writes bypass React state; load a fresh bootstrap for this state.
    await page.reload();
    await expect(
      page.getByRole("heading", {
        name: "Можно немного выдохнуть",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Открыть мой план", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Всё, что было в плане, готово",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: /^Готово/ }).click();
    await expect(
      rowFor(page, academic[0].id).getByRole("checkbox"),
    ).toBeChecked();
  } finally {
    for (const item of original.items)
      await setCompleted(page.request, csrfToken, item.id, item.completed);
  }
});

test("a personal task keeps input on error, accepts no date and asks before deletion", async ({
  page,
}) => {
  await signIn(page.request);
  await openPlan(page);
  const titleInput = page.getByLabel("Название задачи", { exact: true });
  const add = page.getByRole("button", {
    name: "Добавить задачу",
    exact: true,
  });
  await titleInput.fill("   ");
  await add.click();
  await expect(page.getByRole("alert")).toContainText("Введите название");
  const title = `Личная подготовка ${Date.now()}`;
  await titleInput.fill(title);
  await page.getByRole("button", { name: "Убрать срок", exact: true }).click();
  await expect(page.getByLabel(/^Срок/)).toHaveValue("");
  await page.route("**/api/plan", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Временная ошибка сохранения плана" }),
        })
      : route.continue(),
  );
  await add.click();
  await expect(page.getByRole("alert")).toContainText(
    "Временная ошибка сохранения плана",
  );
  await expect(titleInput).toHaveValue(title);
  await expect(page.getByLabel(/^Срок/)).toHaveValue("");
  expect(
    (await getPlan(page.request)).items.some((item) => item.title === title),
  ).toBe(false);
  await page.unroute("**/api/plan");
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/plan") &&
      response.request().method() === "POST",
  );
  await add.click();
  const response = await created;
  expect(response.status()).toBe(201);
  const { item } = await response.json();
  expect(item.dueDate).toBeNull();
  expect(item.kind).toBe("personal");
  const row = rowFor(page, item.id);
  await expect(row).toBeVisible();
  await expect(row).toBeFocused();
  await expect(row).toContainText("Без срока");
  await expect(row).not.toContainText("Просроч");
  await page.reload();
  await expect(row).toContainText(title);
  await row
    .getByRole("button", { name: `Удалить задачу: ${title}`, exact: true })
    .click();
  await expect(row).toContainText("Это действие нельзя отменить");
  await row.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(row).toBeVisible();
  await row
    .getByRole("button", { name: `Удалить задачу: ${title}`, exact: true })
    .click();
  const removed = page.waitForResponse(
    (result) =>
      result.url().endsWith(`/api/plan/${item.id}`) &&
      result.request().method() === "DELETE",
  );
  await row.getByRole("button", { name: "Удалить", exact: true }).click();
  expect((await removed).status()).toBe(200);
  await expect(row).toHaveCount(0);
  expect(
    (await getPlan(page.request)).items.some((value) => value.id === item.id),
  ).toBe(false);
});

test("unknown and another student's task links reveal only the signed-in student's plan", async ({
  page,
  browser,
}) => {
  const firstSession = await signIn(page.request);
  const title = `Закрытая личная задача Алисы ${Date.now()}`;
  const created = await page.request.post("/api/plan", {
    headers: { "X-CSRF-Token": firstSession.csrfToken },
    data: { title, dueDate: null },
  });
  expect(created.status()).toBe(201);
  const { item } = await created.json();
  const other = await browser.newContext({ baseURL: "http://127.0.0.1:3010" });
  try {
    const otherSession = await signIn(other.request, "mark@demo.orbita");
    const otherPage = await other.newPage();
    const runtimeErrors = [];
    otherPage.on("pageerror", (error) => runtimeErrors.push(error.message));
    await openPlan(otherPage, item.id);
    await expect(
      otherPage.getByText("Задача недоступна.", { exact: true }),
    ).toBeVisible();
    await expect(rowFor(otherPage, item.id)).toHaveCount(0);
    await expect(otherPage.getByText(title, { exact: true })).toHaveCount(0);
    const ownPlan = await getPlan(other.request);
    expect(ownPlan.items.some((value) => value.id === item.id)).toBe(false);
    await expect(rowFor(otherPage, ownPlan.items[0].id)).toBeVisible();
    for (const [method, data] of [
      ["patch", { completed: true }],
      ["delete", {}],
    ]) {
      const response = await other.request[method](`/api/plan/${item.id}`, {
        headers: { "X-CSRF-Token": otherSession.csrfToken },
        data,
      });
      expect(response.status()).toBe(404);
    }
    expect(
      (await getPlan(page.request)).items.find((value) => value.id === item.id)
        ?.completed,
    ).toBe(false);
    await otherPage.goto("/#plan/%E0%A4%A");
    await expect(
      otherPage.getByText("Задача недоступна.", { exact: true }),
    ).toBeVisible();
    await otherPage
      .getByRole("button", { name: "Вернуться к списку", exact: true })
      .click();
    await expect(otherPage).toHaveURL(/#plan$/);
    await expect(
      otherPage.getByText("Задача недоступна.", { exact: true }),
    ).toHaveCount(0);
    expect(runtimeErrors).toEqual([]);
  } finally {
    await other.close();
    const removed = await page.request.delete(`/api/plan/${item.id}`, {
      headers: { "X-CSRF-Token": firstSession.csrfToken },
      data: {},
    });
    expect(removed.status()).toBe(200);
  }
});

test("360px keeps the next action visible, opens the plan through real navigation and preserves requests", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const session = await signIn(page.request, "mark@demo.orbita");
  const first = (await getPlan(page.request)).items.find(
    (item) => !item.completed,
  );
  await page.goto("/#dashboard");
  const nextTitle = page
    .locator(".welcome-copy")
    .getByText(first.title, { exact: true });
  await expect(nextTitle).toBeVisible();
  await expect(nextTitle).toBeInViewport();
  await page.getByRole("button", { name: "Ещё разделы", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Меню кабинета" })
    .getByRole("link", { name: "Мой план", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Мой план", level: 1, exact: true }),
  ).toBeVisible();
  await noHorizontalOverflow(page);
  const title = `Мобильная подготовка ${"длинное название ".repeat(4)}`.trim();
  await page.getByLabel("Название задачи", { exact: true }).fill(title);
  await page.getByLabel(/^Срок/).fill("2026-11-18");
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/plan") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Добавить задачу", exact: true })
    .click();
  const response = await created;
  expect(response.status()).toBe(201);
  const { item } = await response.json();
  try {
    await expect(rowFor(page, item.id)).toContainText(title);
    await noHorizontalOverflow(page);
    await page
      .getByRole("navigation", { name: "Мобильная навигация" })
      .getByRole("link", { name: "Заявки", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Документы и заявки",
        level: 1,
        exact: true,
      }),
    ).toBeVisible();
    await noHorizontalOverflow(page);
  } finally {
    expect(
      (
        await page.request.delete(`/api/plan/${item.id}`, {
          headers: { "X-CSRF-Token": session.csrfToken },
          data: {},
        })
      ).status(),
    ).toBe(200);
  }
});

for (const viewport of [
  { label: "desktop", width: 1440, height: 1000 },
  { label: "mobile", width: 360, height: 800 },
]) {
  test(`personal plan has no detected WCAG A/AA violations at ${viewport.label} width`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await signIn(page.request);
    await openPlan(page);
    await scan(page, testInfo, `plan-${viewport.label}`);
  });
}
