"use client";

import { Profiler, type ReactNode } from "react";

export type PerfRenderRecord = {
  id: string;
  phase: "mount" | "update" | "nested-update";
  actualDuration: number;
  baseDuration: number;
  startTime: number;
  commitTime: number;
};

declare global {
  interface Window {
    __PERF_RENDERS__?: PerfRenderRecord[];
  }
}

type PerfProfilerProps = { id: string; children: ReactNode };

function ProfilerWithRecord({ id, children }: PerfProfilerProps) {
  return (
    <Profiler
      id={id}
      onRender={(
        _id,
        phase,
        actualDuration,
        baseDuration,
        startTime,
        commitTime,
      ) => {
        const records = window.__PERF_RENDERS__ ?? [];
        records.push({
          id,
          phase,
          actualDuration,
          baseDuration,
          startTime,
          commitTime,
        });
        window.__PERF_RENDERS__ = records;
      }}
    >
      {children}
    </Profiler>
  );
}

function Passthrough({ children }: PerfProfilerProps) {
  return <>{children}</>;
}

/**
 * 측정용 렌더 기록 래퍼. NEXT_PUBLIC_PERF_PROFILE=1 로 빌드할 때만 Profiler를 쓰고
 * `window.__PERF_RENDERS__`에 commit별 값을 쌓는다. 그 외에는 자식만 그대로 렌더한다.
 */
export const PerfProfiler =
  process.env.NEXT_PUBLIC_PERF_PROFILE === "1"
    ? ProfilerWithRecord
    : Passthrough;
