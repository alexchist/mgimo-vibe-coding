import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const errors = new WeakMap();
test.beforeEach(({ page }) => {
  const list = [];
  errors.set(page, list);
  page.on("pageerror", (error) => list.push(error.message));
});
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));

async function signIn(page) {
  const response = await page.request.post("/api/login", {
    data: { login: "alisa@demo.orbita", password: "Orbita2026!" },
  });
  expect(response.status()).toBe(200);
  return response.json();
}
async function ask(page, question) {
  await page
    .getByLabel("Ваш вопрос навигатору", { exact: true })
    .fill(question);
  await page
    .getByRole("button", { name: "Задать вопрос", exact: true })
    .click();
  return page.locator(".svc-answer").last();
}
async function readyRequest(page, session) {
  const headers = { "X-CSRF-Token": session.csrfToken };
  const created = await page.request.post("/api/requests", {
    headers,
    data: { type: "enrollment", purpose: "Проверка адресного перехода" },
  });
  expect(created.status()).toBe(201);
  const { request } = await created.json();
  for (let i = 0; i < 2; i++)
    expect(
      (
        await page.request.post(`/api/requests/${request.id}/demo-advance`, {
          headers,
          data: {},
        })
      ).status(),
    ).toBe(200);
  return request;
}

for (const width of [1440, 360])
  test(`action links preserve document, week, exam and deadline context at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const session = await signIn(page);
    const request = await readyRequest(page, session);
    const data = await (await page.request.get("/api/bootstrap")).json();
    await page.goto("/#dashboard");
    await page.getByRole("button", { name: /Ваш документ готов/ }).click();
    await expect(page).toHaveURL(new RegExp(`#requests/${request.id}$`));
    await expect(page.locator(`#request-toggle-${request.id}`)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(
      page.getByRole("link", { name: "Скачать демодокумент", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("link", { name: "Скачать демодокумент", exact: true }),
    ).toBeVisible();
    await page.goto("/#dashboard");
    await page.getByRole("button", { name: "Вся неделя", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Вся неделя", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.goto("/#assistant");
    let answer = await ask(page, "Какие пары завтра?");
    await expect(answer).toContainText("17 ноября");
    await answer
      .getByRole("button", { name: "Открыть расписание", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Вторник", exact: true }),
    ).toBeVisible();
    await page.goto("/#assistant");
    answer = await ask(page, "Когда ближайший экзамен по английскому?");
    await expect(answer).toContainText("18 декабря");
    await expect(answer).not.toContainText("История международных отношений");
    await answer
      .getByRole("button", { name: "Посмотреть сессию", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Сессия", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.goto("/#assistant");
    answer = await ask(page, "Какой срок изготовления справки?");
    await expect(answer).toContainText("3 рабочих дня");
    await expect(answer).not.toContainText("Эссе");
    await page.goto("/#notifications");
    const notice = data.notifications.find(
      (item) => item.category === "deadline",
    );
    await page
      .getByRole("article")
      .filter({
        has: page.getByRole("heading", { name: notice.title, exact: true }),
      })
      .getByRole("link")
      .click();
    await expect(page).toHaveURL(new RegExp(`#plan/${notice.focusId}$`));
    await expect(page.locator(`#plan-item-${notice.focusId}`)).toBeFocused();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width + 1);
  });

for (const failure of ["connection-reset", "invalid-json"])
  test(`retry after ${failure} preserves one saved task and a Russian error`, async ({
    page,
  }) => {
    const session = await signIn(page);
    await page.goto("/#plan");
    const title = `Потерянный ответ ${failure} ${Date.now()}`;
    await page.getByLabel("Название задачи", { exact: true }).fill(title);
    let firstId;
    const keys = [];
    try {
      await page.route("**/api/plan", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        keys.push(route.request().headers()["idempotency-key"]);
        if (!firstId) {
          const response = await route.fetch();
          expect(response.status()).toBe(201);
          firstId = (await response.json()).item.id;
          if (failure === "connection-reset")
            await route.abort("connectionreset");
          else
            await route.fulfill({
              status: 201,
              contentType: "application/json",
              body: "{",
            });
        } else await route.continue();
      });
      const add = page.getByRole("button", {
        name: "Добавить задачу",
        exact: true,
      });
      await add.click();
      await expect(page.getByRole("alert")).toContainText(
        failure === "connection-reset"
          ? "Проверьте соединение"
          : "Не удалось прочитать ответ сервера",
      );
      await expect(
        page.getByLabel("Название задачи", { exact: true }),
      ).toHaveValue(title);
      await add.click();
      await expect(
        page.getByLabel("Название задачи", { exact: true }),
      ).toHaveValue("");
      const plan = await (await page.request.get("/api/plan")).json();
      expect(
        plan.items
          .filter((item) => item.title === title)
          .map((item) => item.id),
      ).toEqual([firstId]);
      expect(keys).toHaveLength(2);
      expect(keys[1]).toBe(keys[0]);
      expect(keys[0]).toBeTruthy();
      await page.reload();
      await expect(page.locator(`#plan-item-${firstId}`)).toHaveCount(1);
    } finally {
      if (firstId)
        await page.request.delete(`/api/plan/${firstId}`, {
          headers: { "X-CSRF-Token": session.csrfToken },
          data: {},
        });
    }
  });

test("archiving keeps the document, survives reload and opens from its notification on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const session = await signIn(page);
  const request = await readyRequest(page, session);
  await page.goto("/#requests");
  await page.getByRole("button", { name: "Мои заявки", exact: true }).click();
  const listHeading = page.getByRole("heading", { name: /^Мои заявки/ });
  await expect(listHeading).toBeFocused();
  await expect(listHeading).toBeInViewport({ ratio: 1 });
  await page.goto(`/#requests/${request.id}`);
  await page.getByRole("button", { name: "В архив", exact: true }).click();
  await expect(
    page.getByText("Перенести заявку в архив общего демоаккаунта?", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  expect(
    (await (await page.request.get(`/api/requests/${request.id}`)).json())
      .request.archived,
  ).not.toBe(true);
  await page.getByRole("button", { name: "В архив", exact: true }).click();
  await page
    .getByRole("button", { name: "Подтвердить перенос", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Архив", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Архив", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("link", { name: "Скачать демодокумент", exact: true }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Скачать демодокумент", exact: true })
    .click();
  expect((await download).suggestedFilename()).toContain(request.id);
  await page.goto("/#notifications");
  await page
    .getByRole("article")
    .filter({ hasText: request.number })
    .filter({
      has: page.getByRole("heading", { name: "Документ готов", exact: true }),
    })
    .getByRole("link")
    .click();
  await expect(page).toHaveURL(new RegExp(`#requests/${request.id}$`));
  await expect(
    page.getByRole("link", { name: "Скачать демодокумент", exact: true }),
  ).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(361);
  await page.goto("/#requests/student-mark-request-ready");
  await expect(
    page.getByText("Заявка недоступна.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Скачать демодокумент", exact: true }),
  ).toHaveCount(0);
});

test("coursework scores and pending, passed or failed assessments remain separate", async ({
  page,
}) => {
  await signIn(page);
  await page.route("**/api/bootstrap", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    const passes = data.grades.filter((item) => item.assessment === "Зачёт");
    passes[0].assessmentStatus = "passed";
    passes[1].assessmentStatus = "failed";
    await route.fulfill({ response, json: data });
  });
  await page.goto("/#grades");
  await expect(page.getByText("Зачтено", { exact: true })).toBeVisible();
  await expect(page.getByText("Не зачтено", { exact: true })).toBeVisible();
  await expect(page.getByText("Ещё не проходил", { exact: true })).toHaveCount(
    4,
  );
  await page.getByRole("button", { name: /Политическая география/ }).click();
  await expect(
    page.getByText("Текущий балл складывается", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Дисциплина", { exact: true }).locator("option"),
  ).toHaveCount(4);
});
