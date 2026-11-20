import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
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
    "New feature flows must not throw in the browser",
  ).toEqual([]);
});

async function login(page) {
  const response = await page.request.post("/api/login", {
    data: { login: "mark@demo.orbita", password: "Orbita2026!" },
  });
  expect(response.status()).toBe(200);
  return response.json();
}
async function open(page, route, heading) {
  await page.goto(`/#${route}`);
  await expect(
    page.getByRole("heading", { level: 1, name: heading, exact: true }),
  ).toBeVisible();
}
async function checkWidth(page) {
  const sizes = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(
    sizes.width,
    "The entire page must fit a 360 px viewport",
  ).toBeLessThanOrEqual(sizes.viewport + 1);
}

test("student reserves and cancels a room using the actual campus form", async ({
  page,
}) => {
  const session = await login(page);
  let booking;
  try {
    await open(page, "campus", "Кампус");
    await page
      .getByRole("button", {
        name: "Выбрать Переговорная «Диалог»",
        exact: true,
      })
      .click();
    await page
      .getByLabel("Дата бронирования", { exact: true })
      .fill("2026-11-20");
    await page
      .getByRole("button", { name: "09:00, свободно", exact: true })
      .click();
    await page
      .getByLabel("Цель бронирования", { exact: true })
      .fill("Браузерная проверка вымышленного клуба");
    const creation = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/campus/bookings") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Забронировать", exact: true })
      .click();
    const response = await creation;
    expect(response.status()).toBe(200);
    booking = (await response.json()).booking;
    const card = page
      .locator("article")
      .filter({ hasText: "Браузерная проверка вымышленного клуба" });
    await expect(card).toContainText("09:00");
    await page.reload();
    await expect(card).toBeVisible();
    await card
      .getByRole("button", { name: "Отменить бронь", exact: true })
      .click();
    await card
      .getByRole("button", { name: "Да, отменить", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Вся история", exact: true })
      .click();
    await expect(card).toContainText(/Отменен[ао]|Отменён[ао]/i);
    const saved = (
      await (await page.request.get("/api/campus/bookings")).json()
    ).bookings.find((item) => item.id === booking.id);
    expect(saved.status).toBe("cancelled");
  } finally {
    if (booking)
      await page.request.post(`/api/campus/bookings/${booking.id}/cancel`, {
        headers: { "X-CSRF-Token": session.csrfToken },
        data: {},
      });
  }
});

test("private uploaded TXT is searchable, displayed as text, and removed through the interface", async ({
  page,
}) => {
  const session = await login(page);
  const title = "Личный тест клуба Кварцеплаватель";
  const marker = "Кварцеплаватель";
  let documentId;
  try {
    await open(page, "knowledge", "База знаний");
    await expect(
      page.getByText("Файлы видны всем, кто использует этот демоаккаунт.", {
        exact: false,
      }),
    ).toBeVisible();
    await page.getByLabel("Название документа", { exact: true }).fill(title);
    await page
      .getByLabel("Файл TXT, MD или PDF", { exact: true })
      .setInputFiles({
        name: "club.txt",
        mimeType: "text/plain",
        buffer: Buffer.from(
          `${marker}: учебный клуб встречается по пятницам. <img src=x onerror="window.uploadExecuted=true"> Это вымышленные правила для проверки.`,
        ),
      });
    const creation = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/knowledge/documents") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Добавить в базу", exact: true })
      .click();
    const response = await creation;
    expect(response.status()).toBe(201);
    documentId = (await response.json()).document.id;
    await expect(
      page.getByRole("heading", { level: 2, name: title, exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Вопрос или ключевые слова", { exact: true })
      .fill(marker);
    await page.getByRole("button", { name: "Найти", exact: true }).click();
    await expect(
      page.locator(".knowledge-source").filter({ hasText: title }),
    ).toContainText("учебный клуб встречается по пятницам");
    await page
      .getByRole("button", { name: new RegExp(`Открыть источник ${title}`) })
      .click();
    await expect(page.locator(".knowledge-reader")).toContainText(
      '<img src=x onerror="window.uploadExecuted=true">',
    );
    expect(await page.evaluate(() => window.uploadExecuted)).toBeUndefined();
    await page
      .getByRole("button", { name: `Удалить документ «${title}»`, exact: true })
      .click();
    await page
      .getByRole("button", { name: "Да, удалить документ", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: `Удалить документ «${title}»`,
        exact: true,
      }),
    ).toHaveCount(0);
    expect(
      (
        await page.request.get(`/api/knowledge/documents/${documentId}`)
      ).status(),
    ).toBe(404);
  } finally {
    if (documentId)
      await page.request.delete(`/api/knowledge/documents/${documentId}`, {
        headers: { "X-CSRF-Token": session.csrfToken },
        data: {},
      });
  }
});

test("housing demo payment waits for confirmation and produces a visibly marked downloadable receipt", async ({
  page,
}) => {
  await login(page);
  const before = await (await page.request.get("/api/housing")).json();
  const invoice = before.invoices.find((item) => item.status === "unpaid");
  expect(invoice).toBeTruthy();
  await open(page, "housing", "Общежитие");
  await expect(
    page.getByText("Демо без настоящих платежей.", { exact: true }),
  ).toBeVisible();
  const card = page.locator(`[id="housing-invoice-${invoice.id}"]`);
  await card
    .getByRole("button", { name: "Демо: оплатить", exact: true })
    .click();
  await expect(
    card.getByRole("button", { name: "Подтвердить демооплату", exact: true }),
  ).toBeVisible();
  expect(
    (await (await page.request.get("/api/housing")).json()).invoices.find(
      (item) => item.id === invoice.id,
    ).status,
  ).toBe("unpaid");
  await card
    .getByRole("button", { name: "Подтвердить демооплату", exact: true })
    .click();
  await expect(card).toContainText("Оплачено · демо");
  const downloadPromise = page.waitForEvent("download");
  await card
    .getByRole("link", { name: "Скачать образец квитанции", exact: true })
    .click();
  const download = await downloadPromise;
  const receipt = await readFile(await download.path(), "utf8");
  expect(receipt).toContain("ОБРАЗЕЦ · НЕ ЯВЛЯЕТСЯ ПЛАТЁЖНЫМ ДОКУМЕНТОМ");
  expect(receipt).toContain("Настоящие деньги не списывались");
  await page.reload();
  await expect(card).toContainText("Оплачено · демо");
  expect(
    (await (await page.request.get("/api/housing")).json()).payments.length,
  ).toBe(before.payments.length + 1);
});

test("demo notifications stay local and MCP secrets disappear on reload and can be revoked", async ({
  page,
}) => {
  const session = await login(page);
  let recordId;
  try {
    await open(page, "connections", "Подключения");
    await page
      .getByRole("button", { name: "Подключить демо Telegram", exact: true })
      .click();
    await expect(
      page.getByText("Демоканал подключён", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Тест уведомления", exact: true })
      .click();
    await expect(
      page.getByText("Демо · сохранено локально", { exact: true }).first(),
    ).toBeVisible();
    const name = "Браузерный доступ только к расписанию";
    await page.getByLabel("Название подключения", { exact: true }).fill(name);
    await page
      .getByRole("checkbox", { name: "Смотреть свои брони", exact: true })
      .uncheck();
    await page
      .getByRole("checkbox", {
        name: "Искать в доступных документах",
        exact: true,
      })
      .uncheck();
    const minting = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/mcp/tokens") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Создать MCP-токен", exact: true })
      .click();
    const minted = await (await minting).json();
    recordId = minted.record.id;
    expect(minted.record.scopes).toEqual(["schedule:read"]);
    await expect(
      page.getByRole("textbox", { name: "Новый MCP-токен", exact: true }),
    ).toHaveValue(minted.token);
    const stored = await page.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
      }),
    );
    expect(stored).not.toContain(minted.token);
    await page.reload();
    await expect(
      page.getByRole("textbox", { name: "Новый MCP-токен", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: `Отозвать «${name}»`, exact: true })
      .click();
    await page
      .getByRole("button", { name: "Подтвердить отзыв", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: `Отозвать «${name}»`, exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Отключить Telegram", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Подтвердить отключение", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Подключить демо Telegram",
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await page.request.delete("/api/channels/telegram", {
      headers: { "X-CSRF-Token": session.csrfToken },
      data: {},
    });
    if (recordId)
      await page.request.delete(`/api/mcp/tokens/${recordId}`, {
        headers: { "X-CSRF-Token": session.csrfToken },
        data: {},
      });
  }
});

test("on 360 px Navigator asks for GigaChat consent and links to generated sources", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await login(page);
  await page.route("**/api/assistant/status", (route) => route.fulfill({
    json: {
      mode: "gigachat",
      configured: true,
      provider: "GigaChat",
      model: "GigaChat-3-Pro",
      disclosure: "GigaChat получает вопрос и цитаты из демодокументов. Загруженные файлы остаются в кабинете.",
    },
  }));
  const submissions = [];
  await page.route("**/api/assistant/chat", (route) => {
    const body = route.request().postDataJSON();
    submissions.push(body);
    if (!body.shareQuestion) return route.continue();
    return route.fulfill({
      json: {
        reply: "По демодокументу справка готовится за 3 рабочих дня.",
        mode: "gigachat",
        model: "GigaChat-3-Pro:1.2",
        conversationId: body.conversationId,
        sources: [{
          documentId: "demo-document-orders",
          chunkId: "fixture-chunk",
          title: "Порядок выдачи справок и подачи заявлений",
          section: "Пункт 2",
          quote: "Справка готовится за 3 рабочих дня.",
          fictional: true,
        }],
        links: [{ route: "requests", label: "Заявки и справки" }],
      },
    });
  });
  await open(page, "assistant", "Навигатор");
  await page.getByRole("button", { name: "Что ты умеешь?" }).click();
  await page.getByRole("button", { name: "Искать локально" }).click();
  await expect(page.getByText("Локальный ответ", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Как заказать справку?" }).click();
  await page.getByRole("button", { name: "Спросить GigaChat" }).click();
  await expect(page.getByText("Ответ GigaChat-3-Pro:1.2", { exact: true })).toBeVisible();
  await expect(page.locator("blockquote")).toHaveText("Справка готовится за 3 рабочих дня.");
  expect(submissions.map(({ shareQuestion }) => shareQuestion)).toEqual([false, true]);
  expect(submissions[1]).not.toHaveProperty("history");
  await checkWidth(page);
  await page.getByRole("button", { name: "Открыть документ" }).click();
  await expect(page).toHaveURL(/#knowledge\/demo-document-orders$/);
  await open(page, "assistant", "Навигатор");
  await expect(page.locator(".ai-exchange")).toHaveCount(2);
});

test("on 360 px the assistant prepares a request and waits for a separate confirmation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const session = await login(page);
  let request;
  try {
    await open(page, "assistant", "Навигатор");
    await expect(
      page.getByText(/Локальный демопомощник/),
    ).toBeVisible();
    const before = (await (await page.request.get("/api/bootstrap")).json())
      .requests.length;
    await page
      .getByLabel("Ваш вопрос навигатору", { exact: true })
      .fill("Закажи справку об обучении для мобильной проверки клуба");
    await page
      .getByRole("button", { name: "Задать вопрос", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Подтвердить действие", exact: true }),
    ).toBeVisible();
    expect(
      (await (await page.request.get("/api/bootstrap")).json()).requests.length,
    ).toBe(before);
    await checkWidth(page);
    const confirmation = page.waitForResponse(
      (response) =>
        /\/api\/assistant\/actions\/[^/]+\/confirm$/.test(response.url()) &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Подтвердить действие", exact: true })
      .click();
    const response = await confirmation;
    expect(response.status()).toBe(200);
    request = (await response.json()).result.request;
    await expect(page.locator(".svc-answer").last()).toContainText(
      /выполнено|принят|создан/i,
    );
    expect(
      (await (await page.request.get("/api/bootstrap")).json()).requests.length,
    ).toBe(before + 1);
    await checkWidth(page);
  } finally {
    if (request) {
      for (let i = 0; i < 2; i++)
        await page.request.post(`/api/requests/${request.id}/demo-advance`, {
          headers: { "X-CSRF-Token": session.csrfToken },
          data: {},
        });
      await page.request.post(`/api/requests/${request.id}/archive`, {
        headers: { "X-CSRF-Token": session.csrfToken },
        data: {},
      });
    }
  }
});

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 360, height: 800 },
]) {
  test(`five new sections fit ${viewport.width} px and pass automated WCAG A/AA checks`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(60000);
    await page.setViewportSize(viewport);
    await login(page);
    for (const [route, heading, ready] of [
      ["campus", "Кампус", ".campus-slots"],
      ["housing", "Общежитие", ".housing-invoices"],
      ["knowledge", "База знаний", ".knowledge-documents li"],
      ["connections", "Подключения", ".connections-token-form"],
      ["assistant", "Навигатор", ".ai-form"],
    ]) {
      await open(page, route, heading);
      await expect(page.locator(ready).first()).toBeVisible();
      if (route === "assistant")
        await expect(
          page.getByText(/Локальный демопомощник/),
        ).toBeVisible();
      await page.evaluate(async () => {
        await Promise.all(
          document
            .getAnimations()
            .filter(
              (animation) =>
                animation.effect?.getTiming().iterations !== Infinity,
            )
            .map((animation) => animation.finished.catch(() => {})),
        );
      });
      await checkWidth(page);
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const violations = result.violations.map(({ id, impact, nodes }) => ({
        id,
        impact,
        nodes: nodes.map(({ target, failureSummary }) => ({
          target,
          failureSummary,
        })),
      }));
      await testInfo.attach(`features-axe-${route}-${viewport.width}.json`, {
        body: JSON.stringify({
          violations,
          incomplete: result.incomplete.map(({ id }) => id),
          passedRules: result.passes.length,
        }),
        contentType: "application/json",
      });
      expect.soft(violations, `${route} at ${viewport.width} px`).toEqual([]);
    }
  });
}
