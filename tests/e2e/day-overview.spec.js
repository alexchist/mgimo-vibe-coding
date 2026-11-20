import { test, expect } from "@playwright/test";

test.use({ timezoneId: "America/Los_Angeles" });

const thursday = new Date("2026-11-19T05:59:00Z");

for (const student of ["Алиса", "Марк"]) {
  for (const date of ["2026-11-19", "2026-11-26"]) {
    test(`day overview: ${student}, ${date}, mobile first screen and real navigation`, async ({
      page,
    }) => {
      await page.clock.setFixedTime(new Date(`${date}T05:59:00Z`));
      await page.setViewportSize({ width: 360, height: 800 });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto("/");
      await expect(page).toHaveTitle(/Курсом/);
      await page.getByRole("button", { name: new RegExp(student) }).click();
      await page.locator(".day-focus").waitFor();
      const response = await page.request.get("/api/bootstrap");
      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      const first = data.schedule
        .filter((item) => item.date === date)
        .sort((a, b) => a.start.localeCompare(b.start))[0];
      const focus = page.locator(".day-focus");
      await expect(focus).toContainText(first.subject);
      await expect(focus).toContainText("Следующая пара");
      await expect(focus).toContainText(first.start);
      await expect(focus).toContainText(`Аудитория ${first.room}`);
      expect(
        await focus
          .locator(".departure-place")
          .evaluate((el) => el.getBoundingClientRect().bottom),
      ).toBeLessThan(732);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(360);
      await focus
        .getByRole("button", { name: "Открыть расписание", exact: true })
        .click();
      await expect(page).toHaveURL((url) => url.hash === `#schedule/lesson-${first.id}`);
      await expect(
        page.getByRole("heading", { name: "Расписание", exact: true }),
      ).toBeVisible();
      const lessonCard = page.locator(`#schedule-item-${first.id}`);
      await expect(lessonCard).toContainText("Следующая пара");
      await expect(lessonCard).toBeFocused();
      await page.goto("/#dashboard");
      await expect(
        page.getByRole("button", { name: /^Просроченные дела/ }),
      ).toBeVisible();
      await page
        .getByRole("button", {
          name:
            date === "2026-11-19" ? "Мой следующий шаг" : /^Просроченные дела/,
        })
        .click();
      await expect(page).toHaveURL(/#plan\//);
      await expect(
        page.getByRole("heading", { name: "Просрочено", exact: true }),
      ).toBeVisible();
      expect(errors).toEqual([]);
    });
  }
}

test("overview handles empty schedule and a long subject without overflow", async ({
  page,
}) => {
  await page.clock.setFixedTime(thursday);
  await page.setViewportSize({ width: 820, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: /Алиса/ }).click();
  await page.locator(".day-focus").waitFor();
  let empty = false;
  await page.route("**/api/bootstrap", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.schedule = empty
      ? []
      : data.schedule.map((item) => ({
          ...item,
          subject:
            "Междисциплинарные исследования международных отношений и сравнительный анализ современных дипломатических практик",
        }));
    await route.fulfill({ response, json: data });
  });
  await page.reload();
  await expect(page.locator(".day-focus h2")).toContainText(
    "Междисциплинарные",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    820,
  );
  empty = true;
  await page.reload();
  await expect(page.locator(".day-focus h2")).toHaveText("Сегодня без пар");
  await page
    .locator(".day-focus")
    .getByRole("button", { name: "Посмотреть неделю" })
    .click();
  await expect(page).toHaveURL(/#schedule\/week$/);
});

test("at Moscow midnight across both weeks, exact date links keep their day", async ({
  page,
}) => {
  const beforeMidnight = new Date("2026-11-22T20:59:55Z");
  await page.clock.install({ time: new Date(beforeMidnight.getTime() - 5000) });
  await page.clock.pauseAt(beforeMidnight);
  const login = await page.request.post("/api/login", {
    data: { login: "alisa@demo.orbita", password: "Orbita2026!" },
  });
  expect(login.ok()).toBeTruthy();
  await page.goto("/#schedule");
  await expect(
    page.getByRole("heading", { name: "Сегодня без пар", exact: true }),
  ).toBeVisible();
  await page.clock.fastForward(5000);
  await expect(
    page.getByRole("button", { name: /Понедельник, 23 ноября/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("heading", { name: "Понедельник", exact: true }),
  ).toBeVisible();
  await page.goto("/#schedule/day-1");
  await expect(
    page.getByRole("heading", { name: "Понедельник", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Сегодня", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Сегодня", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Понедельник, 23 ноября/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.goto("/#schedule/2026-11-24");
  await expect(
    page.getByRole("heading", { name: "Вторник", exact: true }),
  ).toBeVisible();
  await page.clock.setFixedTime(new Date("2026-11-30T09:00:00Z"));
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Вторник", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Сегодня", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "На сегодня нет расписания" }),
  ).toBeVisible();
  await page.goto("/#dashboard");
  await expect(page.locator(".dashboard-heading time")).toHaveAttribute(
    "datetime",
    "2026-11-30",
  );
  await expect(page.locator(".day-focus h2")).toHaveText(
    "На сегодня нет расписания",
  );
});

test("today's lesson changes at its exact Moscow start and end", async ({
  page,
}) => {
  const beforeClass = new Date("2026-11-23T05:59:55Z");
  await page.clock.install({ time: new Date(beforeClass.getTime() - 5000) });
  await page.clock.pauseAt(beforeClass);
  await page.request.post("/api/login", {
    data: { login: "alisa@demo.orbita", password: "Orbita2026!" },
  });
  await page.goto("/#dashboard");
  await expect(page.locator(".day-kicker")).toHaveText("Следующая пара");
  await page.clock.fastForward(5000);
  await expect(page.locator(".day-kicker")).toHaveText("Идёт сейчас");
  await page.goto("/#schedule");
  await expect(page.locator(".ac-lesson").first()).toContainText("Идёт сейчас");
  await page.clock.fastForward(80 * 60 * 1000);
  await expect(page.locator(".ac-lesson").first()).toContainText("Завершена");
  await expect(page.locator(".ac-lesson").nth(1)).toContainText(
    "Следующая пара",
  );
  await page.clock.fastForward((3 * 60 + 25) * 60 * 1000);
  await expect(page.getByText("Пары на сегодня закончились")).toBeVisible();
  await page.goto("/#dashboard");
  await expect(page.locator(".day-focus h2")).toHaveText(
    "Пары на сегодня закончились",
  );
});
