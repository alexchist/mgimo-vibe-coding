import { test, expect } from "@playwright/test";

test("a student can discard one preparation and use the form without submitting either draft", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByRole("button", {
      name: "АМ Алиса Международные отношения",
      exact: true,
    })
    .click();
  await expect(page.getByRole("heading", { name: "С возвращением, Алиса." })).toBeVisible();
  const before = (await (await page.request.get("/api/bootstrap")).json())
    .requests.length;
  await page.goto("/#assistant");
  for (const purpose of ["конкурса Вега", "стажировки Лира"]) {
    await page
      .getByLabel("Ваш вопрос навигатору", { exact: true })
      .fill(`Подготовь справку об обучении для ${purpose}`);
    await page
      .getByRole("button", { name: "Задать вопрос", exact: true })
      .click();
    await expect(
      page.locator(".ai-action").filter({ hasText: purpose }),
    ).toBeVisible();
  }
  const first = page.locator(".ai-action").filter({ hasText: "конкурса Вега" });
  const second = page
    .locator(".ai-action")
    .filter({ hasText: "стажировки Лира" });
  await first
    .getByRole("button", { name: "Отменить подготовку", exact: true })
    .click();
  await expect(
    first.getByRole("button", { name: "Подтвердить действие", exact: true }),
  ).toHaveCount(0);
  await expect(
    second.getByRole("button", { name: "Подтвердить действие", exact: true }),
  ).toBeEnabled();
  await second
    .getByRole("button", { name: "Отменить и заполнить вручную", exact: true })
    .click();
  await expect(page).toHaveURL(/#requests$/);
  await expect(
    page.getByLabel("Куда предоставить", { exact: false }),
  ).toBeVisible();
  expect(
    (await (await page.request.get("/api/bootstrap")).json()).requests.length,
  ).toBe(before);
  await page.screenshot({
    path: testInfo.outputPath("manual-after-cancel.png"),
  });
  await page.goto("/#assistant");
  await page.reload();
  await expect(
    page.getByLabel("Ваш вопрос навигатору", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".ai-action")
      .filter({ hasText: /конкурса Вега|стажировки Лира/ }),
  ).toHaveCount(0);
});

test("opening a confirmed request on mobile keeps its card in view", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto("/");
  await page
    .getByRole("button", {
      name: "АМ Алиса Международные отношения",
      exact: true,
    })
    .click();
  await page.goto("/#assistant");
  await page
    .getByLabel("Ваш вопрос навигатору", { exact: true })
    .fill("Закажи справку об обучении для вымышленного конкурса Лира");
  await page
    .getByRole("button", { name: "Задать вопрос", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Подтвердить действие", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Открыть заявку", exact: true })
    .click();
  const toggle = page.locator(".svc-request-open .svc-request-toggle");
  await expect(toggle).toBeFocused();
  await expect(toggle).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: testInfo.outputPath("request-in-view.png") });
});

test("the mobile room-change link reveals and focuses the actual lesson", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByRole("button", {
      name: "АМ Алиса Международные отношения",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: /Изменение аудитории/ }).click();
  const lesson = page.locator(".ac-lesson-changed");
  await expect(lesson).toBeFocused();
  await expect(lesson).toContainText("208");
  await expect(lesson).toContainText("215");
  const box = await lesson.boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(60);
  expect(box.y + box.height).toBeLessThanOrEqual(780);
  await page.screenshot({ path: testInfo.outputPath("target-lesson.png") });
  await page.reload();
  await expect(lesson).toBeFocused();
  await page.getByRole("button", { name: "Показать", exact: true }).click();
  await expect(lesson).toBeFocused();
  await expect(lesson).toBeInViewport({ ratio: 1 });
});

test("a lesson keeps its original daily number when the schedule is filtered", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("Логин", { exact: true }).fill("alisa@demo.orbita");
  await page.getByLabel("Пароль", { exact: true }).fill("Orbita2026!");
  await page
    .getByRole("button", { name: "Войти в кабинет", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Мобильная навигация" })
    .getByRole("link", { name: "Расписание", exact: true })
    .click();
  const changed = page.locator(".ac-lesson-changed");
  await expect(changed).toContainText("2 пара");
  await page
    .getByRole("button", { name: "Только изменения", exact: true })
    .click();
  await changed.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("filtered-schedule.png") });
  await expect(changed).toContainText("2 пара");
  await page.getByRole("button", { name: "Вся неделя", exact: true }).click();
  await expect(changed).toContainText("2 пара");
});
