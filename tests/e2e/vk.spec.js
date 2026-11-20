import { once } from "node:events";
import { test, expect } from "@playwright/test";
import { createApp } from "../../server/app.mjs";

test("a student upgrades a demo VK channel, confirms in the private dialog and tests delivery", async ({
  page,
}) => {
  const group = 123456;
  const user = 71823;
  const secret = "example-webhook-secret-for-test";
  const messages = [];
  const app = createApp({
    databasePath: ":memory:",
    secureCookies: false,
    channels: {
      config: {
        allowRealLinking: true,
        vkGroupId: String(group),
        vkWebhookSecret: secret,
        vkConfirmationToken: "example-confirmation",
        vkToken: "example-group-token",
        vkApiVersion: "5.199",
      },
      fetchImpl: async (url, { body }) => {
        expect(url).toBe("https://api.vk.com/method/messages.send");
        messages.push({ peer: body.get("peer_id"), text: body.get("message") });
        return Response.json({ response: 42 });
      },
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const login = await page.request.post(`${base}/api/login`, {
      data: { login: "alisa@demo.orbita", password: "Orbita2026!" },
    });
    expect(login.ok()).toBe(true);
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`${base}/#connections`);
    const vk = page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: "VK", exact: true }) });
    await vk.getByRole("button", { name: "Подключить демо VK" }).click();
    await expect(vk.getByText("Демоканал подключён")).toBeVisible();
    await vk
      .getByRole("button", { name: "Подключить VK", exact: true })
      .click();
    const code = await vk.getByLabel("Одноразовый код VK").inputValue();
    const link = vk.getByRole("link", { name: "Открыть диалог VK" });
    await expect(link).toHaveAttribute("href", `https://vk.me/club${group}`);
    await vk.getByRole("button", { name: "Проверить подключение VK" }).click();
    await expect(
      vk.getByText(/Подтверждение из VK пока не получено/),
    ).toBeVisible();
    await expect(
      vk.getByRole("button", { name: "Отправить тест в VK" }),
    ).toHaveCount(0);
    const callback = await page.request.post(
      `${base}/api/channels/vk/webhook`,
      {
        data: {
          type: "message_new",
          group_id: group,
          secret,
          event_id: "callback-pair",
          v: "5.199",
          object: {
            message: {
              from_id: user,
              peer_id: user,
              conversation_message_id: 1,
              text: code,
            },
          },
        },
      },
    );
    expect(await callback.text()).toBe("ok");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(vk.getByText("Личный диалог подключён")).toBeVisible();
    await expect(vk.getByLabel("Одноразовый код VK")).toHaveCount(0);
    await vk.getByRole("button", { name: "Отправить тест в VK" }).click();
    const entry = page
      .getByRole("listitem")
      .filter({ hasText: "Проверка уведомлений" });
    await expect(entry).toContainText("В очереди");
    await app.locals.services.channels.flush();
    await page.getByRole("button", { name: "Обновить статус" }).click();
    await expect(entry).toContainText("Принято провайдером");
    expect(messages).toContainEqual({
      peer: String(user),
      text: expect.stringContaining("Проверка уведомлений"),
    });
    await vk.getByRole("button", { name: "Отключить VK" }).click();
    await vk.getByRole("button", { name: "Подтвердить отключение" }).click();
    await expect(vk.getByText("Не подключён", { exact: true })).toBeVisible();
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await app.locals.close();
  }
});
