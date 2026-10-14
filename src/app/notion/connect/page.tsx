"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { withBasePath } from "@/lib/base-path";
import {
  buildHandoffAuthUrl,
  clearNotionConnectSession,
  createHandoffAndNavigate,
  getSafariHandoffAuthUrl,
  getSafariSettingsUrl,
  getStoredHandoffId,
  isHandoffLaunched,
  isHandoffSessionExpired,
  markHandoffLaunch,
  SAFARI_FALLBACK_DELAY_MS,
  storeHandoffId,
} from "@/lib/notion-connect-session";
import {
  getNotionConnectUiCopy,
  resolveNotionConnectUiStatus,
  type NotionConnectStatusSnapshot,
} from "@/lib/notion-connect-ui-status";

export default function NotionConnectPage() {
  const [handoffId, setHandoffId] = useState<string | null>(null);
  const [handoffLaunched, setHandoffLaunched] = useState(false);
  const [handoffExpired, setHandoffExpired] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const [status, setStatus] = useState<NotionConnectStatusSnapshot | null>(
    null,
  );
  const [statusFetchFailed, setStatusFetchFailed] = useState(false);
  const [retryLoading, setRetryLoading] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  const uiStatus = useMemo(
    () =>
      resolveNotionConnectUiStatus({
        handoffId,
        handoffLaunched,
        handoffExpired,
        statusFetchFailed,
        status,
      }),
    [handoffExpired, handoffId, handoffLaunched, status, statusFetchFailed],
  );

  const copy = getNotionConnectUiCopy(uiStatus);

  const safariAuthUrl = handoffId ? getSafariHandoffAuthUrl(handoffId) : null;
  const httpsAuthUrl = handoffId ? buildHandoffAuthUrl(handoffId) : null;

  const refreshStatus = useCallback(async () => {
    try {
      setStatusFetchFailed(false);
      const res = await fetch(withBasePath("/api/notion/status"), {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      if (!res.ok) {
        setStatusFetchFailed(true);
        return;
      }

      const data = (await res.json()) as NotionConnectStatusSnapshot;
      setStatus({
        notionConnected: !!data.notionConnected,
        dbConnected: !!data.dbConnected,
      });

      if (data.dbConnected) {
        clearNotionConnectSession();
      }
    } catch {
      setStatusFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const queryHandoff = params.get("handoff");

    if (queryHandoff) {
      storeHandoffId(queryHandoff);
      const cleanUrl = withBasePath("/notion/connect");
      window.history.replaceState({}, "", cleanUrl);
      setHandoffId(queryHandoff);
    } else {
      setHandoffId(getStoredHandoffId());
    }

    setHandoffLaunched(isHandoffLaunched());
    setHandoffExpired(isHandoffSessionExpired());
  }, []);

  useEffect(() => {
    if (!handoffId || handoffExpired) {
      return;
    }

    if (isHandoffLaunched()) {
      setHandoffLaunched(true);
      void refreshStatus();
      return;
    }

    markHandoffLaunch(handoffId);
    setHandoffLaunched(true);

    const fallbackTimer = window.setTimeout(() => {
      setShowFallback(true);
    }, SAFARI_FALLBACK_DELAY_MS);

    window.location.replace(getSafariHandoffAuthUrl(handoffId));

    return () => {
      window.clearTimeout(fallbackTimer);
    };
  }, [handoffExpired, handoffId, refreshStatus]);

  useEffect(() => {
    if (!handoffLaunched || handoffExpired || uiStatus === "connected") {
      return;
    }

    void refreshStatus();

    const handleResume = () => {
      void refreshStatus();
    };

    document.addEventListener("visibilitychange", handleResume);
    window.addEventListener("focus", handleResume);
    window.addEventListener("pageshow", handleResume);

    return () => {
      document.removeEventListener("visibilitychange", handleResume);
      window.removeEventListener("focus", handleResume);
      window.removeEventListener("pageshow", handleResume);
    };
  }, [handoffExpired, handoffLaunched, refreshStatus, uiStatus]);

  useEffect(() => {
    if (handoffLaunched && isHandoffSessionExpired()) {
      setHandoffExpired(true);
    }
  }, [handoffLaunched, status]);

  const handleRetry = async () => {
    try {
      setRetryLoading(true);
      clearNotionConnectSession();
      await createHandoffAndNavigate();
    } catch {
      setRetryLoading(false);
    }
  };

  const handleCopyAuthUrl = async () => {
    if (!httpsAuthUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(httpsAuthUrl);
      setCopyMessage(
        "연결 주소를 복사했어요. Safari 주소창에 붙여넣어 주세요.",
      );
    } catch {
      setCopyMessage(
        "주소 복사에 실패했어요. 아래 링크를 길게 눌러 복사해 주세요.",
      );
    }
  };

  const showSafariFallback =
    showFallback &&
    handoffId &&
    (uiStatus === "starting" || uiStatus === "handoff_started");

  return (
    <div className="session-surface session-font min-h-screen">
      <div className="mx-auto max-w-lg space-y-6 px-4 pb-10">
        <div className="flex min-h-14 items-center">
          <span className="flex items-center gap-1.5 font-(family-name:--font-brand) text-xl font-medium tracking-[0.2em]">
            <span className="size-2 rounded-full bg-(--session-accent)" />
            <span>daily</span>
            <span className="text-(--session-muted)">set</span>
          </span>
        </div>

        <div className="border-b border-foreground pb-4">
          <h1 className="text-2xl font-bold tracking-tight">{copy.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {copy.description}
          </p>
        </div>

        {uiStatus === "notion_authorized" && (
          <div className="space-y-3">
            <a href={getSafariSettingsUrl()} className={cn(buttonVariants({ variant: "accent", size: "cta" }))}>
              Safari에서 DB 선택하기
            </a>
            <p className="text-xs text-muted-foreground">
              Safari에서 운동 DB 3개를 모두 선택해야 연결이 완료됩니다.
            </p>
          </div>
        )}

        {(uiStatus === "handoff_started" || showSafariFallback) &&
          safariAuthUrl && (
            <div className="space-y-3 border-l-2 border-(--session-accent) pl-3 text-sm">
              <p className="font-medium text-foreground">
                {uiStatus === "handoff_started"
                  ? "Safari에서 연결을 이어가세요"
                  : "Safari가 자동으로 열리지 않나요?"}
              </p>
              <div className="flex flex-col gap-2">
                <a href={safariAuthUrl} className={cn(buttonVariants({ variant: "outline-strong", size: "touch" }))}>
                  Safari에서 다시 열기
                </a>
                <button
                  type="button"
                  onClick={handleCopyAuthUrl}
                  className={cn(buttonVariants({ variant: "outline-strong", size: "touch" }))}
                >
                  연결 주소 복사
                </button>
              </div>
              {copyMessage && (
                <p className="text-xs text-muted-foreground">{copyMessage}</p>
              )}
              {httpsAuthUrl && (
                <p className="break-all text-xs text-muted-foreground">
                  {httpsAuthUrl}
                </p>
              )}
            </div>
          )}

        {/*
          handoff 는 서버에서 1회만 소비된다(findOneAndDelete). Safari 를 다시
          열거나 새로고침하면 그 id 는 이미 없어서 "유효하지 않은 링크"가 뜨는데,
          PWA 쪽 sessionStorage 에는 launched=1 이 남아 있어 계속 handoff_started
          로 보인다. 그 상태에서 화면에 남는 링크·복사 주소는 전부 죽은 id 를
          가리키므로, 재시작 버튼이 없으면 10분을 기다리거나 PWA 를 완전히 종료하는
          것 말고는 빠져나갈 방법이 없다. 그래서 handoff_started 에서도 노출한다.
        */}
        {(uiStatus === "expired" ||
          uiStatus === "failed" ||
          uiStatus === "handoff_started") && (
          <div className="flex flex-col gap-2 sm:flex-row">
            {uiStatus !== "failed" && (
              <button
                type="button"
                onClick={handleRetry}
                disabled={retryLoading}
                className={cn(buttonVariants({ variant: "accent", size: "cta" }))}
              >
                {retryLoading
                  ? "다시 준비 중..."
                  : uiStatus === "handoff_started"
                    ? "연결이 막혔나요? 처음부터 다시 연결"
                    : "처음부터 다시 연결"}
              </button>
            )}
            <Link href={"/settings/notion"} className={cn(buttonVariants({ variant: "outline-strong", size: "touch" }))}>
              Notion 설정으로
            </Link>
          </div>
        )}

        {uiStatus === "connected" && (
          <Link href={"/app"} className={cn(buttonVariants({ variant: "accent", size: "cta" }))}>
            Dailyset 홈으로
          </Link>
        )}

        {uiStatus === "handoff_started" && (
          <p className="text-xs text-muted-foreground">
            Safari에서 작업을 마친 뒤 홈 화면의 Dailyset 아이콘을 눌러 이
            화면으로 돌아오세요.
          </p>
        )}
      </div>
    </div>
  );
}
