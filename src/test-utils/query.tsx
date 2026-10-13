import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createQueryClient } from "@/lib/query-client";

/**
 * query를 쓰는 컴포넌트·hook을 RTL로 렌더할 때 쓰는 wrapper.
 * 테스트마다 새 QueryClient를 만들어 캐시가 테스트 사이에 섞이지 않게 한다.
 * 운영과 같은 기본 옵션(createQueryClient)을 그대로 쓴다.
 */
export function createQueryWrapper() {
  const queryClient = createQueryClient();

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  return { queryClient, Wrapper };
}
