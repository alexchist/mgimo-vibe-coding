import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Real browser interactions captured as frames; no mocked screens or external accounts.
const base = process.env.DEMO_BASE_URL || "http://127.0.0.1:3001";
const temp = await mkdtemp(join(tmpdir(), "orbita-film-"));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
async function run(program, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: ["ignore", "ignore", "pipe"] });
    let error = "";
    child.stderr.on("data", (data) => {
      error += data;
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(error)),
    );
  });
}
async function record(label, viewport, actions) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const frames = join(temp, label);
  await mkdir(frames);
  await page.goto(base);
  await page.getByLabel("Логин", { exact: true }).waitFor();
  let recording = true,
    index = 0;
  const capture = (async () => {
    while (recording) {
      const started = Date.now();
      await page.screenshot({
        path: join(frames, `${String(index++).padStart(5, "0")}.png`),
      });
      await delay(Math.max(0, 200 - (Date.now() - started)));
    }
  })();
  try {
    await actions(page);
  } finally {
    recording = false;
    await capture;
    await context.close();
  }
  const file = join(temp, `${label}.mp4`);
  await run("ffmpeg", [
    "-y",
    "-framerate",
    "5",
    "-i",
    join(frames, "%05d.png"),
    "-vf",
    "scale=1280:800:force_original_aspect_ratio=decrease,pad=1280:800:(ow-iw)/2:(oh-ih)/2:color=0xf6f7f9",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "24",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "25",
    file,
  ]);
  return file;
}
async function caption(page, text) {
  await page.evaluate((text) => {
    let banner = document.getElementById("recording-caption");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "recording-caption";
      document.body.appendChild(banner);
    }
    banner.textContent = text;
    banner.style.cssText =
      "position:fixed;bottom:76px;left:16px;right:16px;z-index:99999;background:#163f38;color:white;padding:12px 18px;border-radius:12px;font:600 14px/1.5 Arial;box-shadow:0 3px 20px #0002;pointer-events:none;text-align:center";
  }, text);
}
async function scene(page, route, text, ms = 2200) {
  await page.evaluate((route) => {
    location.hash = route;
  }, route);
  await page.locator("main h1").waitFor();
  await caption(page, text);
  await delay(ms);
}
try {
  const desktop = await record(
    "desktop",
    { width: 1280, height: 800 },
    async (page) => {
      await caption(page, "Орбита — конкурсный концепт. Все данные вымышлены.");
      await delay(1800);
      await page.getByLabel("Логин", { exact: true }).fill("alisa@demo.orbita");
      await page.getByLabel("Пароль", { exact: true }).fill("Orbita2026!");
      await page
        .getByRole("button", { name: "Войти в кабинет", exact: true })
        .click();
      await page.getByRole("heading", { name: /С возвращением/ }).waitFor();
      await caption(page, "Всё важное: расписание, сроки и готовые документы.");
      await delay(2600);
      await scene(
        page,
        "schedule",
        "Изменение аудитории заметно сразу. Неделя и календарь — рядом.",
      );
      await page
        .getByRole("button", { name: "Вся неделя", exact: true })
        .click();
      await delay(1500);
      await scene(
        page,
        "grades",
        "Понятная успеваемость и условный калькулятор цели.",
      );
      await page
        .getByRole("button", { name: /История международных отношений/ })
        .click();
      await delay(1800);
      await scene(
        page,
        "requests",
        "Заявка онлайн. Она сохраняется на сервере.",
      );
      await page
        .getByLabel("Куда предоставить", { exact: false })
        .fill("Для демонстрации жюри");
      await page
        .getByLabel("Комментарий", { exact: false })
        .fill("Вымышленная заявка для видеодемонстрации.");
      await page
        .getByRole("button", { name: "Подать заявку", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Демо: следующий этап", exact: true })
        .waitFor();
      await caption(
        page,
        "История статусов без звонков. Кнопка явно обозначена как демосимуляция.",
      );
      await delay(2200);
      await page
        .getByRole("button", { name: "Демо: следующий этап", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Готовим документ", exact: true })
        .waitFor();
      await delay(1500);
      await page
        .getByRole("button", { name: "Демо: следующий этап", exact: true })
        .click();
      await page
        .getByRole("link", { name: "Скачать демодокумент", exact: true })
        .waitFor();
      await caption(page, "Готовый образец доступен только владельцу заявки.");
      await delay(2200);
      const download = page.waitForEvent("download");
      await page
        .getByRole("link", { name: "Скачать демодокумент", exact: true })
        .click();
      await download;
      await scene(
        page,
        "notifications",
        "Уведомления связаны с документами и учёбой.",
      );
      await scene(
        page,
        "assistant",
        "Локальный навигатор по своим данным. Внешнего ИИ нет.",
      );
      await page
        .getByRole("button", { name: "Как заказать справку?", exact: true })
        .click();
      await delay(1800);
      await page
        .getByRole("button", { name: "Выйти из аккаунта", exact: true })
        .click();
      await page.getByRole("button", { name: /Марк/ }).click();
      await page
        .getByRole("heading", { name: /С возвращением, Марк/ })
        .waitFor();
      await scene(
        page,
        "profile",
        "Второй аккаунт — другой студент, отдельные оценки и заявки.",
        2800,
      );
    },
  );
  const mobile = await record(
    "mobile",
    { width: 360, height: 800 },
    async (page) => {
      await page.getByRole("button", { name: /Алиса/ }).click();
      await page.getByRole("heading", { name: /С возвращением/ }).waitFor();
      await caption(page, "Те же сценарии на телефоне шириной 360 px.");
      await delay(2600);
      await page
        .getByRole("navigation", { name: "Мобильная навигация" })
        .getByRole("link", { name: "Расписание" })
        .click();
      await caption(page, "Пары и изменения — удобно с телефона.");
      await delay(2400);
      await page
        .getByRole("navigation", { name: "Мобильная навигация" })
        .getByRole("link", { name: "Заявки", exact: true })
        .click();
      await caption(page, "Заявки доступны из нижнего меню.");
      await delay(2200);
      await page
        .getByLabel("Куда предоставить", { exact: false })
        .scrollIntoViewIfNeeded();
      await delay(1800);
      await scene(
        page,
        "dashboard",
        "Орбита. Меньше суеты — больше своего времени.",
        2400,
      );
    },
  );
  const list = join(temp, "concat.txt");
  await writeFile(list, `file '${desktop}'\nfile '${mobile}'\n`);
  await run("ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    list,
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    "docs/DEMO.mp4",
  ]);
  console.log(
    "Saved docs/DEMO.mp4 — actual browser walkthrough, fictional demo data.",
  );
} finally {
  await browser.close();
  await rm(temp, { recursive: true, force: true });
}
