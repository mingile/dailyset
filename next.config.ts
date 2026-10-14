import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: "/dailyset",
  // 성능 측정용 빌드가 기본 .next(실행 중인 서버)를 덮어쓰지 않도록 출력 위치를 바꿀 수 있게 한다.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // webpack 빌드는 기존 queue route의 타입 오류로 실패한다. 측정용(profiling) 빌드에서만 건너뛴다.
  typescript: {
    ignoreBuildErrors: process.env.NEXT_PUBLIC_PERF_PROFILE === "1",
  },
  headers: async () => [
    {
      source: "/sw.js",
      headers: [
        {
          key: "Cache-Control",
          value: "public, max-age=0, must-revalidate",
        },
        {
          key: "Service-Worker-Allowed",
          value: "/dailyset/",
        },
      ],
    },
  ],
};

export default nextConfig;
