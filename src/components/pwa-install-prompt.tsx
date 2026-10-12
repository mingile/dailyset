"use client";

import { Download, Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePwaInstall } from "@/hooks/usePwaInstall";

export function PwaInstallPrompt() {
  const { showInstallPrompt, showIosGuide, install, dismiss } = usePwaInstall();

  if (!showInstallPrompt && !showIosGuide) {
    return null;
  }

  return (
    <div className="session-surface fixed inset-x-0 bottom-0 z-50 border-t bg-card/95 p-4 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <div className="mx-auto flex max-w-lg items-start gap-3">
        <div className="mt-0.5 shrink-0 text-primary">
          {showInstallPrompt ? (
            <Download className="size-5" aria-hidden="true" />
          ) : (
            <Share className="size-5" aria-hidden="true" />
          )}
        </div>

        <div className="session-font min-w-0 flex-1 space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-medium">Daily Set 앱으로 설치</p>
            {showInstallPrompt ? (
              <p className="text-xs text-muted-foreground">
                홈 화면에 추가하면 더 빠르게 운동 기록을 시작할 수 있습니다.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Safari 하단 공유 버튼을 누른 뒤 &quot;홈 화면에 추가&quot;를
                선택하세요.
              </p>
            )}
          </div>

          {showInstallPrompt ? (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void install()}>
                설치
              </Button>
              <Button size="sm" variant="ghost" onClick={dismiss}>
                나중에
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="secondary" onClick={dismiss}>
              확인
            </Button>
          )}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          aria-label="설치 안내 닫기"
          onClick={dismiss}
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}
