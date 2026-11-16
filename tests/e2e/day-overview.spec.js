import { test, expect } from '@playwright/test';

for (const student of ['Алиса', 'Марк']) {
  test(`day overview: ${student}, mobile first screen and real navigation`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await expect(page).toHaveTitle(/Курсом/);
    await page.getByRole('button', { name: new RegExp(student) }).click();
    await page.locator('.day-focus').waitFor();
    const response = await page.request.get('/api/bootstrap');
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    const first = data.schedule.filter(item => item.date === data.referenceDate).sort((a,b) => a.start.localeCompare(b.start))[0];
    const focus = page.locator('.day-focus');
    await expect(focus).toContainText(first.subject);
    await expect(focus).toContainText(first.start);
    await expect(focus).toContainText(`Аудитория ${first.room}`);
    expect(await focus.locator('.departure-place').evaluate(el => el.getBoundingClientRect().bottom)).toBeLessThan(732);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
    await focus.getByRole('button', { name: 'Открыть расписание', exact: true }).click();
    await expect(page).toHaveURL(/#schedule$/);
    await expect(page.getByRole('heading', {name: 'Расписание', exact: true})).toBeVisible();
    await page.goto('/#dashboard');
    await page.getByRole('button', { name: 'Мой следующий шаг', exact: true }).click();
    await expect(page).toHaveURL(/#plan\//);
    expect(errors).toEqual([]);
  });
}

test('overview handles empty schedule and a long subject without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: /Алиса/ }).click();
  await page.locator('.day-focus').waitFor();
  let empty = false;
  await page.route('**/api/bootstrap', async route => {
    const response = await route.fetch();
    const data = await response.json();
    data.schedule = empty ? [] : data.schedule.map(item => ({...item, subject: 'Междисциплинарные исследования международных отношений и сравнительный анализ современных дипломатических практик'}));
    await route.fulfill({ response, json: data });
  });
  await page.reload();
  await expect(page.locator('.day-focus h2')).toContainText('Междисциплинарные');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(820);
  empty = true;
  await page.reload();
  await expect(page.locator('.day-focus h2')).toHaveText('Сегодня без пар');
  await page.locator('.day-focus').getByRole('button', { name: 'Посмотреть неделю' }).click();
  await expect(page).toHaveURL(/#schedule\/week$/);
});
