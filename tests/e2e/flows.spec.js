import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const runtimeErrors = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = [];
  runtimeErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(
    runtimeErrors.get(page),
    "The completed browser flow must have no uncaught JavaScript errors",
  ).toEqual([]);
});

async function seedSession(page, login = "alisa@demo.orbita") {
  const response = await page.request.post("/api/login", {
    data: { login, password: "Orbita2026!" },
  });
  expect(response.status()).toBe(200);
  return response.json();
}

async function loginThroughForm(page, login = "alisa@demo.orbita") {
  await page.getByLabel("Логин", { exact: true }).fill(login);
  await page.getByLabel("Пароль", { exact: true }).fill("Orbita2026!");
  await page
    .getByRole("button", { name: "Войти в кабинет", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: login.startsWith("alisa")
        ? /^С возвращением, Алиса/
        : /^С возвращением, Марк/,
      level: 1,
    }),
  ).toBeVisible();
}

async function openSection(page, route, title) {
  await page.goto(`/#${route}`);
  await expect(
    page.getByRole("heading", { name: title, exact: true, level: 1 }),
  ).toBeVisible();
}

async function noHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(
    dimensions.content,
    "Page must fit the mobile viewport without horizontal page scrolling",
  ).toBeLessThanOrEqual(dimensions.viewport + 1);
}

async function createRequest(page, purpose) {
  await page.getByLabel("Куда предоставить", { exact: false }).fill(purpose);
  await page
    .getByLabel("Комментарий", { exact: false })
    .fill("Вымышленные сведения для проверки конкурсного прототипа.");
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/requests") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Подать заявку", exact: true })
    .click();
  const response = await created;
  expect(response.status()).toBe(201);
  const { request } = await response.json();
  await expect(
    page.getByRole("button", { name: new RegExp(request.number) }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(`[id="request-${request.id}"]`)).toContainText(
    purpose,
  );
  return request;
}

test("real login form rejects wrong credentials, navigates and switches between isolated accounts", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByText("Концепт · неофициальный сервис", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("Логин", { exact: true }).fill("alisa@demo.orbita");
  await page.getByLabel("Пароль", { exact: true }).fill("incorrect-password");
  await page
    .getByRole("button", { name: "Войти в кабинет", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Логин или пароль не подошли",
  );
  expect((await page.request.get("/api/bootstrap")).status()).toBe(401);
  await loginThroughForm(page);
  await page
    .getByRole("navigation", { name: "Основная навигация", exact: true })
    .getByRole("link", { name: "Расписание", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Расписание", level: 1, exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Мой профиль", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Миронова Алиса Андреевна",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("DEMO-2024-0142", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Мой профиль", level: 1, exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Перейти к содержимому", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  await page
    .getByRole("button", { name: "Выйти из аккаунта", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Войти в кабинет", exact: true }),
  ).toBeVisible();
  expect((await page.request.get("/api/bootstrap")).status()).toBe(401);
  await loginThroughForm(page, "mark@demo.orbita");
  await page.getByRole("link", { name: "Мой профиль", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Ветров Марк Ильич", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("DEMO-2023-0286", { exact: true })).toBeVisible();
  await expect(page.getByText("DEMO-2024-0142", { exact: true })).toHaveCount(
    0,
  );
});

test("a real bootstrap error has a visible retry and recovers", async ({
  page,
}) => {
  await seedSession(page);
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Проверка временной недоступности" }),
    }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Пока не удалось подключиться",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Проверка временной недоступности", { exact: true }),
  ).toBeVisible();
  await page.unroute("**/api/bootstrap");
  await page
    .getByRole("button", { name: "Попробовать ещё раз", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /^С возвращением, Алиса/, level: 1 }),
  ).toBeVisible();
});

test("a delayed data refresh cannot restore private UI after logout", async ({
  page,
}) => {
  await seedSession(page);
  await openSection(page, "requests", "Документы и заявки");
  let release;
  let captured;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const responseCaptured = new Promise((resolve) => {
    captured = resolve;
  });
  await page.route("**/api/bootstrap", async (route) => {
    const response = await route.fetch();
    captured();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await page
      .getByLabel("Куда предоставить", { exact: false })
      .fill(`Проверка выхода ${Date.now()}`);
    await page
      .getByRole("button", { name: "Подать заявку", exact: true })
      .click();
    // The refresh has already read private data on the server, but has not reached React.
    await responseCaptured;
    await page
      .getByRole("button", { name: "Выйти из аккаунта", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Войти в кабинет", exact: true }),
    ).toBeVisible();
    const lateResponse = page.waitForResponse((response) =>
      response.url().endsWith("/api/bootstrap"),
    );
    release();
    await lateResponse;
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByRole("button", { name: "Войти в кабинет", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".app-shell")).toHaveCount(0);
    expect((await page.request.get("/api/bootstrap")).status()).toBe(401);
  } finally {
    release();
    await page.unroute("**/api/bootstrap");
  }
});

test("schedule filters, real calendar download and grade details work", async ({
  page,
}) => {
  await seedSession(page);
  await openSection(page, "schedule", "Расписание");
  await expect(
    page.getByText("Перед парой — проверьте аудиторию", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Воскресенье, 22 ноября/ }).click();
  await expect(
    page.getByRole("heading", { name: "День без пар", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Вся неделя", exact: true }).click();
  await page
    .getByRole("searchbox", {
      name: "Найти дисциплину, преподавателя или аудиторию",
    })
    .fill("Несуществующая дисциплина");
  await expect(
    page.getByRole("heading", {
      name: "По этим фильтрам занятий нет",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Сбросить фильтры", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Только изменения", exact: true })
    .click();
  await expect(page.locator(".ac-lesson")).toHaveCount(1);
  await expect(page.locator(".ac-lesson")).toContainText("208");
  await expect(page.locator(".ac-lesson")).toContainText("215");
  const calendarReady = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Экспорт недели", exact: true })
    .click();
  const calendar = await calendarReady;
  expect(calendar.suggestedFilename()).toMatch(/\.ics$/);
  const calendarText = await readFile(await calendar.path(), "utf8");
  expect(calendarText).toContain("BEGIN:VCALENDAR");
  expect(calendarText).toContain("DTSTART:20261116T060000Z");
  expect(calendarText.match(/BEGIN:VEVENT/g)).toHaveLength(13);

  await openSection(page, "grades", "Успеваемость");
  await page
    .getByRole("button", { name: /История международных отношений/ })
    .click();
  await expect(
    page.getByText("Контрольные работы", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Семинары", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Сессия", exact: true }).click();
  await expect(
    page.getByText("Сессия без сюрпризов", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".ac-session-item")).toHaveCount(6);
  await expect(
    page.getByText(/Это не правило вуза; реальные оценки не меняются/),
  ).toBeVisible();
  await page.getByLabel("Предполагаемый балл за экзамен").fill("100");
  await expect(page.locator(".ac-calculator-result")).toContainText("95");
});

test("a request survives reload, progresses, downloads and remains private", async ({
  page,
  browser,
}) => {
  await seedSession(page);
  await openSection(page, "requests", "Документы и заявки");
  const purpose = `Учебная проверка ${Date.now()}`;
  const request = await createRequest(page, purpose);
  await page.reload();
  const card = page.getByRole("button", { name: new RegExp(request.number) });
  await expect(card).toBeVisible();
  if ((await card.getAttribute("aria-expanded")) !== "true") await card.click();
  const details = page.locator(`[id="request-${request.id}"]`);
  await expect(details).toContainText(purpose);
  for (const status of ["Готовим документ", "Документ готов"]) {
    const updated = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/requests/${request.id}/demo-advance`) &&
        response.request().method() === "POST",
    );
    await details
      .getByRole("button", { name: "Демо: следующий этап", exact: true })
      .click();
    expect((await updated).status()).toBe(200);
    await expect(
      details.getByRole("heading", { name: status, exact: true }),
    ).toBeVisible();
  }
  const documentReady = page.waitForEvent("download");
  await details
    .getByRole("link", { name: "Скачать демодокумент", exact: true })
    .click();
  const document = await documentReady;
  const html = await readFile(await document.path(), "utf8");
  expect(html).toContain("Миронова Алиса Андреевна");
  expect(html).toContain(
    "ОБРАЗЕЦ · ВЫМЫШЛЕННЫЕ ДАННЫЕ · НЕ ЯВЛЯЕТСЯ ДОКУМЕНТОМ",
  );
  expect(html).toContain(purpose);

  const other = await browser.newContext({ baseURL: "http://127.0.0.1:3010" });
  try {
    const response = await other.request.post("/api/login", {
      data: { login: "mark@demo.orbita", password: "Orbita2026!" },
    });
    expect(response.status()).toBe(200);
    const { csrfToken } = await response.json();
    expect(
      (await other.request.get(`/api/requests/${request.id}`)).status(),
    ).toBe(404);
    expect(
      (
        await other.request.get(`/api/requests/${request.id}/document`)
      ).status(),
    ).toBe(404);
    expect(
      (
        await other.request.post(`/api/requests/${request.id}/demo-advance`, {
          headers: { "X-CSRF-Token": csrfToken },
          data: {},
        })
      ).status(),
    ).toBe(404);
    const own = await (await other.request.get("/api/bootstrap")).json();
    expect(own.user.fullName).toBe("Ветров Марк Ильич");
    expect(own.requests.some((item) => item.id === request.id)).toBe(false);
  } finally {
    await other.close();
  }

  await openSection(page, "notifications", "Уведомления");
  const markAll = page.getByRole("button", { name: /^Прочитать все/ });
  await expect(markAll).toBeEnabled();
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/notifications/read") &&
      response.request().method() === "POST",
  );
  await markAll.click();
  expect((await saved).status()).toBe(200);
  await page.reload();
  await page
    .getByRole("button", { name: "Непрочитанные", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Вы всё прочитали", exact: true }),
  ).toBeVisible();
});

test("360px viewport supports every section and a new request without overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  await noHorizontalOverflow(page);
  await loginThroughForm(page, "mark@demo.orbita");
  await noHorizontalOverflow(page);
  await page
    .getByRole("navigation", { name: "Мобильная навигация", exact: true })
    .getByRole("link", { name: "Расписание", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Расписание", exact: true, level: 1 }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Ещё разделы", exact: true }).click();
  await page.getByRole("link", { name: "Мой профиль", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Мой профиль", exact: true, level: 1 }),
  ).toBeVisible();
  const sections = [
    ["schedule", "Расписание"],
    ["grades", "Успеваемость"],
    ["requests", "Документы и заявки"],
    ["notifications", "Уведомления"],
    ["profile", "Мой профиль"],
    ["assistant", "Навигатор"],
  ];
  for (const [route, title] of sections) {
    await openSection(page, route, title);
    await noHorizontalOverflow(page);
  }
  await page
    .getByRole("button", { name: "Как заказать справку?", exact: true })
    .click();
  await expect(page.getByRole("log")).toContainText(
    "Демо-заявки не уходят в настоящий деканат",
  );
  await page
    .getByRole("button", { name: "Посмотреть готовые документы", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Документы и заявки",
      level: 1,
      exact: true,
    }),
  ).toBeVisible();
  await createRequest(page, `Мобильная проверка ${Date.now()}`);
  await noHorizontalOverflow(page);
  await openSection(page, "profile", "Мой профиль");
  await expect(
    page.getByRole("heading", { name: "Ветров Марк Ильич", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("МЭО-23-02", { exact: true })).toBeVisible();
});
