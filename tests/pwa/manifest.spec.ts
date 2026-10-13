import { expect, test } from "@playwright/test";
import { withBasePath } from "../helpers";

test.describe("PWA manifest", () => {
  test("returns required manifest fields and icon URLs", async ({
    request,
  }) => {
    const response = await request.get(withBasePath("/manifest.webmanifest"));
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
