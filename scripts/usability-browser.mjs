// Browser-only operator for independent usability sessions; no app API/evaluate action.
import http from "node:http";
import path from "node:path";
import { mkdir, appendFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { createApp } from "../server/app.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = 3199;
const [sessionId, action, raw = "{}"] = process.argv.slice(2);
if (sessionId && sessionId !== "serve") {
  const response = await fetch(`http://127.0.0.1:${PORT}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, action, ...JSON.parse(raw) }),
  });
  const output = await response.text();
  console.log(output);
  if (!response.ok || JSON.parse(output).error) process.exitCode = 1;
} else {
  // Do not load .env or enable external services in disposable usability instances.
  for (const key of [
    "YANDEX_API_KEY",
    "YANDEX_FOLDER_ID",
    "YANDEX_MODEL_URI",
    "TELEGRAM_BOT_TOKEN",
    "VK_GROUP_TOKEN",
    "YOOKASSA_SHOP_ID",
    "YOOKASSA_SECRET_KEY",
  ])
    process.env[key] = "";
  process.env.PAYMENTS_MODE = "demo";
  process.env.ALLOW_REAL_CHANNEL_LINKING = "false";
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const sessions = new Map();
  let stopping = false;
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    for (const s of sessions.values()) {
      await s.context.tracing
        .stop({ path: path.join(s.dir, "trace.zip") })
        .catch(() => {});
    }
    await browser.close().catch(() => {});
    process.exit(0);
  }
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  let nextPort = 3201;
  function target(page, input) {
    let locator;
    if (input.role)
      locator = page.getByRole(input.role, {
        name: input.name,
        exact: input.exact !== false,
      });
    else if (input.label)
      locator = page.getByLabel(input.label, { exact: input.exact !== false });
    else if (input.placeholder)
      locator = page.getByPlaceholder(input.placeholder, {
        exact: input.exact !== false,
      });
    else if (input.text)
      locator = page.getByText(input.text, { exact: input.exact !== false });
    else
      throw new Error("Use a visible role/name, label, placeholder or text.");
    return input.nth === undefined ? locator : locator.nth(input.nth);
  }
  async function operate(input) {
    const { sessionId: id, action } = input;
    if (!/^[a-z0-9-]+$/.test(id)) throw new Error("Invalid session ID");
    let s = sessions.get(id);
    if (action === "start") {
      if (s) throw new Error("Session already started");
      const batch = id.split("-")[0];
      const dir = path.join(ROOT, "docs/usability", batch, id);
      await mkdir(dir, { recursive: true });
      const app = createApp({
        databasePath: ":memory:",
        appOrigin: "",
        secureCookies: false,
        trustProxy: false,
      });
      const port = nextPort++;
      const server = await new Promise((resolve) => {
        const server = app.listen(port, "127.0.0.1", () => resolve(server));
      });
      const context = await browser.newContext({
        viewport: { width: input.width || 1440, height: input.height || 900 },
        locale: "ru-RU",
        timezoneId: "Europe/Moscow",
        acceptDownloads: true,
      });
      await context.tracing.start({
        screenshots: true,
        snapshots: true,
        sources: false,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      s = {
        dir,
        app,
        server,
        context,
        page,
        port,
        count: 0,
        downloads: [],
        errors: [],
        actionErrors: [],
      };
      sessions.set(id, s);
      page.on("pageerror", (error) => {
        s.errors.push(error.message);
      });
      page.on("download", async (download) => {
        const filename = path.basename(download.suggestedFilename());
        const file = path.join(dir, `download-${filename}`);
        await download.saveAs(file);
        s.downloads.push({ filename, path: file });
      });
      await page.goto(`http://127.0.0.1:${port}`, { waitUntil: "networkidle" });
    }
    if (!s) throw new Error("No prepared session");
    if (action === "finish") {
      await s.context.tracing.stop({ path: path.join(s.dir, "trace.zip") });
      await writeFile(
        path.join(s.dir, "summary.json"),
        JSON.stringify(
          {
            actions: s.count,
            pageErrors: s.errors,
            operatorErrors: s.actionErrors,
            downloads: s.downloads,
          },
          null,
          2,
        ),
      );
      await s.context.close();
      await new Promise((resolve) => s.server.close(resolve));
      await s.app.locals.close();
      sessions.delete(id);
      return {
        finished: true,
        directory: s.dir,
        actions: s.count,
        pageErrors: s.errors,
        operatorErrors: s.actionErrors,
        downloads: s.downloads,
      };
    }
    const { page } = s;
    let error;
    try {
      if (action === "click") await target(page, input).click();
      else if (action === "fill") await target(page, input).fill(input.value);
      else if (action === "select")
        await target(page, input).selectOption({ label: input.value });
      else if (action === "check") {
        const checkbox = target(page, input);
        if ((await checkbox.isChecked()) !== (input.checked !== false))
          await checkbox.click();
      } else if (action === "press") {
        if (input.role || input.label || input.placeholder || input.text)
          await target(page, input).press(input.key);
        else await page.keyboard.press(input.key);
      } else if (action === "scroll")
        await page.mouse.wheel(0, Number(input.y || 600));
      else if (action === "reload")
        await page.reload({ waitUntil: "networkidle" });
      else if (action === "back") await page.goBack();
      else if (!["start", "snapshot"].includes(action))
        throw new Error("Unsupported browser action");
      await page.waitForTimeout(200);
    } catch (e) {
      error = e.message;
    }
    const snapshot = await page.locator("body").ariaSnapshot();
    const step = String(++s.count).padStart(3, "0");
    if (error) s.actionErrors.push({ step, action, error });
    const screenshot = path.join(s.dir, `${step}.jpg`);
    await page.screenshot({
      path: screenshot,
      type: "jpeg",
      quality: 60,
      fullPage: false,
    });
    const safeInput = { ...input };
    if (/парол|password/i.test(input.label || input.name || ""))
      safeInput.value = "[public demo password redacted]";
    const record = {
      step,
      at: new Date().toISOString(),
      input: safeInput,
      url: page.url(),
      error,
      snapshot,
      screenshot,
      downloads: [...s.downloads],
    };
    await appendFile(
      path.join(s.dir, "actions.jsonl"),
      JSON.stringify(record) + "\n",
    );
    return record;
  }
  http
    .createServer(async (req, res) => {
      if (req.method !== "POST") {
        res.writeHead(405).end();
        return;
      }
      try {
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 16000) throw new Error("Input too large");
        }
        const result = await operate(JSON.parse(body));
        res
          .writeHead(200, { "Content-Type": "application/json" })
          .end(JSON.stringify(result));
      } catch (error) {
        res
          .writeHead(400, { "Content-Type": "application/json" })
          .end(JSON.stringify({ error: error.message }));
      }
    })
    .listen(PORT, "127.0.0.1", () =>
      console.log(`Browser operator ready on ${PORT}`),
    );
}
