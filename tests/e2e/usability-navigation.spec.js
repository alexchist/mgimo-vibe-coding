import { test, expect } from "@playwright/test";

async function login(page) {
  await page.goto("/");
  await page.getByLabel("Логин", { exact: true }).fill("mark@demo.orbita");
  await page.getByLabel("Пароль", { exact: true }).fill("Orbita2026!");
  await page
    .getByRole("button", { name: "Войти в кабинет", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "С возвращением, Марк." }),
  ).toBeVisible();
}

test("section search reopens for another query after selecting a result", async ({
  page,
}, testInfo) => {
  await login(page);
  const search = page.getByRole("textbox", {
    name: "Найти раздел в кабинете",
    exact: true,
  });
  await search.fill("общежитие");
  await page.getByRole("button", { name: "Общежитие", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Общежитие", exact: true }),
  ).toBeVisible();

  // Selecting a result leaves the input focused. A new query must still show
  // its visible destination, without requiring a blur/focus workaround.
  await search.fill("сессия");
  const grades = page.getByRole("button", {
    name: "Успеваемость",
    exact: true,
  });
  await expect(grades).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("second-search.png") });
  await grades.click();
  await expect(
    page.getByRole("heading", { name: "Успеваемость", exact: true }),
  ).toBeVisible();

  await search.fill("расписание");
  const schedule = page.getByRole("button", {
    name: "Расписание",
    exact: true,
  });
  await expect(schedule).toBeVisible();
  await search.press("Escape");
  await expect(schedule).not.toBeVisible();
  await search.click();
  await expect(schedule).toBeVisible();
  await search.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Расписание", exact: true }),
  ).toBeVisible();
  await expect(search).toHaveValue("");
});

test("section search matches combined Russian terms regardless of order", async ({
  page,
}) => {
  await login(page);
  const search = page.getByRole("textbox", {
    name: "Найти раздел в кабинете",
    exact: true,
  });
  const housing = page.getByRole("button", {
    name: "Общежитие",
    exact: true,
  });
  await search.fill("  ОПЛАТА   ОБЩЕЖИТИЯ  ");
  await expect(housing).toBeVisible();
  await search.fill("общежития, оплата");
  await expect(housing).toBeVisible();
  await search.fill("оплата общежития фиолетовая");
  await expect(housing).not.toBeVisible();
  await expect(page.getByText("Ничего не нашли.", { exact: false })).toBeVisible();
  await search.fill("зачеты сессия");
  await expect(
    page.getByRole("button", { name: "Успеваемость", exact: true }),
  ).toBeVisible();
});
