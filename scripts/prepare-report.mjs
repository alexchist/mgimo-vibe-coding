import { readFile, writeFile, access } from "node:fs/promises";
import { marked } from "marked";
import { chromium } from "@playwright/test";

const captures = [
  [
    "01-first-dashboard.png",
    "Первая интегрированная версия главной до финального прохода проверки",
  ],
  ["02-dashboard.png", "Главная: расписание, ближайший шаг и документы"],
  ["03-schedule.png", "Расписание и явное изменение аудитории"],
  [
    "04-grades.png",
    "Успеваемость, компоненты результата и гипотетическая модель",
  ],
  ["05-requests.png", "Создание заявки и прозрачная история статусов"],
  ["06-mobile.png", "Главная на телефоне шириной 360 px"],
  [
    "07-second-account.png",
    "Другой студент: отдельные данные второго аккаунта",
  ],
];
const md = await readFile("docs/PROCESS.md", "utf8");
let gallery = "";
for (const [filename, caption] of captures) {
  try {
    await access(`docs/screenshots/${filename}`);
  } catch {
    continue;
  }
  gallery += `<section class="capture"><h2>${caption}</h2><p>${filename} · реальный браузер Chromium · вымышленные данные</p><img src="screenshots/${filename}" alt="${caption}" /></section>`;
}
const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Орбита — процесс создания</title><style>
@page{size:A4;margin:18mm 16mm}*{box-sizing:border-box}body{font:13px/1.6 Arial, sans-serif;color:#162333;max-width:900px;margin:auto}h1{font-size:30px;color:#147d73}h2{font-size:20px;color:#147d73;margin-top:28px;break-after:avoid}h3{font-size:14px;break-after:avoid}p,li{orphans:3;widows:3}a{color:#147d73;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;font-size:10px;table-layout:fixed;margin:14px 0}td,th{border:1px solid #dce4e4;padding:7px;vertical-align:top;overflow-wrap:anywhere}th{background:#eaf5f0;text-align:left}tr{break-inside:avoid}code{font:9px monospace;background:#eef3f3;overflow-wrap:anywhere}pre{white-space:pre-wrap;background:#eef3f3;padding:12px}.capture{break-before:page}.capture p{color:#526272}.capture img{display:block;max-width:100%;max-height:220mm;object-fit:contain;margin:10px auto}blockquote{border-left:3px solid #147d73;padding-left:12px;color:#526272}.cover-tag{letter-spacing:2px;font-size:10px;color:#147d73}
</style></head><body><p class="cover-tag">ЦИФРОВОЙ ДЕКАНАТ БУДУЩЕГО · КОНКУРСНЫЙ КОНЦЕПТ</p>${marked.parse(md)}${gallery}</body></html>`;
await writeFile("docs/PROCESS.html", html);
let printHtml = html;
for (const [filename] of captures) {
  try {
    const data = await readFile(`docs/screenshots/${filename}`);
    printHtml = printHtml.replaceAll(
      `src="screenshots/${filename}"`,
      `src="data:image/png;base64,${data.toString("base64")}"`,
    );
  } catch {
    /* Missing optional captures are omitted from the gallery above. */
  }
}
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage();
  await page.setContent(printHtml, {
    waitUntil: "networkidle",
  });
  await page.evaluate(() =>
    Promise.all([...document.images].map((image) => image.decode())),
  );
  await page.pdf({
    path: "docs/PROCESS.pdf",
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate:
      '<div style="font:8px Arial;color:#526272;width:100%;text-align:center">Орбита · процесс создания · <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
  });
} finally {
  await browser.close();
}
console.log("Saved docs/PROCESS.html and docs/PROCESS.pdf");
