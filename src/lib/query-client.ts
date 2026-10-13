import { QueryClient } from "@tanstack/react-query";

/**
 * 이 앱의 QueryClient 기본 옵션.
 *
 * - networkMode "always": 기본값("online")은 오프라인이면 fetch를 시작하지 않고 pending에서 멈춘다.
 *   이 앱은 fetch가 실패해야 내장 운동 목록 fallback으로 가므로 오프라인에서도 queryFn을 실행한다.
 * - retry false: 기존 조회에는 자동 재시도가 없다. 재시도는 fallback 시점을 늦추므로 query별로 근거가 있을 때만 켠다.
 * - refetchOnWindowFocus false: PWA는 visibilitychange가 잦아 지금 없는 재요청이 생긴다.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: "always",
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });
}
