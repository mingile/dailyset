import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// globals를 쓰지 않으므로 RTL의 자동 cleanup이 동작하지 않는다. 직접 등록한다.
afterEach(() => {
  cleanup();
});
