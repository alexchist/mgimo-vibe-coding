import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const desktopRoutes = [
  "dashboard",
  "schedule",
  "grades",
  "requests",
  "notifications",
  "profile",
  "assistant",
];
const mobileRoutes = [
  "dashboard",
  "schedule",
  "grades",
  "requests",
  "assistant",
];

async function signIn(page) {
  const response = await page.request.post("/api/login", {
    data: { login: "alisa@demo.orbita", password: "Orbita2026!" },
  });
  expect(
    response.status(),
    "Demo account must authenticate before scanning private content",
  ).toBe(200);
}

async function checkAccessibility(page, testInfo, name) {
  // Scan the settled UI, not an intermediate opacity during entrance transitions.
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) => animation.effect?.getTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  const results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
  await testInfo.attach(`axe-${name}.json`, {
    body: JSON.stringify(
      {
        url: results.url,
        timestamp: results.timestamp,
        standards: wcagTags,
        passedRules: results.passes.length,
        violations: results.violations,
        needsManualReview: results.incomplete.map(
          ({ id, impact, description, nodes }) => ({
            id,
            impact,
            description,
            targets: nodes.map((node) => node.target),
          }),
        ),
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
  const violations = results.violations.map(
    ({ id, impact, description, helpUrl, nodes }) => ({
      id,
      impact,
      description,
      helpUrl,
      nodes: nodes.map(({ target, failureSummary }) => ({
        target,
        failureSummary,
      })),
    }),
  );
  expect(
    violations,
    `${name}: every automatically detected WCAG A/AA violation must be resolved`,
  ).toEqual([]);
}

for (const viewport of [
  { label: "desktop", width: 1440, height: 1000, routes: desktopRoutes },
  { label: "mobile", width: 360, height: 800, routes: mobileRoutes },
]) {
  test.describe(`WCAG 2.1 AA — ${viewport.label}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("login", async ({ page }, testInfo) => {
      await page.goto("/");
      await expect(page.getByRole("textbox").first()).toBeVisible();
      await checkAccessibility(page, testInfo, `${viewport.label}-login`);
    });

    for (const route of viewport.routes) {
      test(route, async ({ page }, testInfo) => {
        await signIn(page);
        await Promise.all([
          page.waitForResponse(
            (response) =>
              response.url().endsWith("/api/bootstrap") &&
              response.status() === 200,
          ),
          page.goto(`/#${route}`),
        ]);
        await expect(page.getByRole("main")).toBeVisible();
        await expect(page.locator("h1")).toBeVisible();
        await checkAccessibility(page, testInfo, `${viewport.label}-${route}`);
      });
    }
  });
}

// Automated scans complement keyboard, focus-order, touch-target and screen-reader
// checks; they do not establish full WCAG conformance on their own.
