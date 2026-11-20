import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { test, expect } from "@playwright/test";
import { createApp } from "../../server/app.mjs";

test("Navigator sends an ordinary question to GigaChat and answers a teacher lookup locally", async ({ page }) => {
  const prompts = [];
  const app = createApp({
    databasePath: ":memory:",
    secureCookies: false,
    now: () => Date.parse("2026-11-20T09:00:00Z"),
    assistant: {
      gigachat: {
        credentials: randomUUID(),
        scope: "GIGACHAT_API_PERS",
        caFile: "",
        async postJson(url, { body }) {
          if (new URL(url).pathname.endsWith("/oauth"))
            return { status: 200, payload: { access_token: randomUUID(), expires_at: Date.now() + 600000 } };
          prompts.push(JSON.parse(body).messages);
          return {
            status: 200,
            payload: {
              model: "GigaChat-3-Pro",
              choices: [{ finish_reason: "stop", message: { role: "assistant", content: "4" } }],
            },
          };
        },
      },
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const login = await page.request.post(`${origin}/api/login`, {
      data: { login: "alisa@demo.orbita", password: "Orbita2026!" },
    });
    expect(login.ok()).toBe(true);
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`${origin}/#assistant`);
    const question = page.getByLabel("Ваш вопрос навигатору");
    const send = page.getByRole("button", { name: "Спросить GigaChat", exact: true });
    const reply = page.getByRole("log").locator(".ai-answer").last();
    const arithmetic = "Сколько будет 2 + 2?";

    await question.fill(arithmetic);
    await page.getByRole("button", { name: "Искать локально" }).click();
    await expect(reply).toContainText("Локальный ответ");
    expect(prompts).toHaveLength(0);

    await question.fill(arithmetic);
    await send.click();
    await expect(reply).toContainText("Ответ GigaChat-3-Pro");
    await expect(reply.locator(".ai-reply")).toHaveText("4");
    await expect(reply.getByRole("button")).toHaveCount(0);
    expect(JSON.stringify(prompts[0])).toContain(arithmetic);

    await question.fill("Как зовут преподавателя по географии?");
    await send.click();
    await expect(reply).toContainText("Есения Радова");
    await expect(reply).toContainText("Локальный ответ");
    expect(prompts).toHaveLength(1);
  } finally {
    await new Promise((done) => server.close(done));
    await app.locals.close();
  }
});
