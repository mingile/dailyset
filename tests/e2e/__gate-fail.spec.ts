import { expect, test } from "@playwright/test";
import { withBasePath } from "../helpers";

// CI gate 검증용 임시 spec: 의도적 실패 (page를 써서 trace가 남게 한다)
test("fails on purpose", async ({ page }) => {
  await page.goto(withBasePath("/"));
  await expect(page.getByText("__gate_fail_never_exists__")).toBeVisible({
    timeout: 2_000,
  });
});
