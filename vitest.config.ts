import path from "node:path";
import { defineConfig } from "vitest/config";

// Vitest는 src 안의 테스트만 수집한다. tests/ 는 Playwright(E2E) 영역이다.
export default defineConfig({
  // tsconfig는 Next용 jsx: "preserve"라 vite가 .tsx를 변환하지 못한다. 테스트에서만 덮어쓴다.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "component",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./vitest.setup.ts"],
        },
      },
    ],
  },
});
