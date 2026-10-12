import { expect, test } from "@playwright/test";
import { dismissInstallPrompt, mockNotionDisconnected, withBasePath } from "./helpers";

test.describe("PWA manifest", () => {
  test("returns required manifest fields and icon URLs", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.ok()).toBeTruthy();

    const manifest = await response.json();
    expect(manifest.name).toBe("Daily Set");
    expect(manifest.short_name).toBe("Daily Set");
    expect(manifest.start_url).toBe(withBasePath("/app"));
    expect(manifest.display).toBe("standalone");
    expect(Array.isArray(manifest.icons)).toBeTruthy();
    expect(manifest.icons.length).toBeGreaterThan(0);

    for (const icon of manifest.icons) {
      const iconResponse = await request.get(icon.src);
      expect(iconResponse.ok()).toBeTruthy();
    }
  });
});

test.describe("PWA landing", () => {
  test("loads the landing page shell", async ({ page }) => {
    await page.goto(withBasePath("/"));
    await expect(
      page.getByRole("heading", { name: /저번에.*했더라/ }),
    ).toBeVisible();
  });
});

test.describe("PWA app loading", () => {
  test("loads the library shell", async ({ page }) => {
    await dismissInstallPrompt(page);
    await mockNotionDisconnected(page);
    await page.goto("/app");

    await expect(page.getByRole("heading", { name: "운동 라이브러리" })).toBeVisible();
    await expect(page.getByText("랫풀다운", { exact: true })).toBeVisible();
  });
});
