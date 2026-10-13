import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom에는 matchMedia가 없다. sonner의 Toaster가 theme="system"일 때 호출하므로 최소 구현만 둔다.
if (!window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

// jsdom에는 Element.scrollTo도 없다. HeaderControls가 날짜 스트립을 오늘로 스크롤할 때 호출한다.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}

// globals를 쓰지 않으므로 RTL의 자동 cleanup이 동작하지 않는다. 직접 등록한다.
afterEach(() => {
  cleanup();
});
