import { test, expect } from "@playwright/test";

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
