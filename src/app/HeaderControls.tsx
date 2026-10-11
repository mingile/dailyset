"use client";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { Session, SessionMetadata, DateInfo } from "./types";
import React, { useState, useRef, useEffect, useMemo } from "react";
import { useTheme } from "next-themes";
import { WorkoutHistoryClient } from "./WorkoutHistoryClient";
import { toast } from "sonner";
import { withBasePath } from "@/lib/base-path";

const HEADER_TEXT_BUTTON =
  "h-11 min-w-11 gap-1 rounded-none px-2 text-sm font-semibold tracking-[0.1em]";

function formatClock(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");

  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

function formatSessionDateLabel(startedAt: string): string {
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return "";

  const dayOfWeek = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][
    date.getDay()
  ];

  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()} ${dayOfWeek}`;
}

export function HeaderControls({
  notionReady,
  setNotionReady,
  sessionMetadata,
  changeSessionName,
  selectedDate,
  setSelectedDate,
  showHistory,
  setShowHistory,
  historyVersion,
  currentDurationSeconds,
  onHistoryChanged,
  onStartNewSession,
}: {
  notionReady: boolean;
  setNotionReady: (notionReady: boolean) => void;
  sessionMetadata: SessionMetadata | null;
  changeSessionName: (newName: string) => void;
  selectedDate: string | null;
  setSelectedDate: (date: string | null) => void;
  showHistory: boolean;
  setShowHistory: (show: boolean) => void;
  historyVersion: number;
  currentDurationSeconds: number;
  onHistoryChanged?: () => void;
  onStartNewSession: () => void;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [sessionNameInput, setSessionNameInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const { theme, setTheme } = useTheme();
  const [themeMounted, setThemeMounted] = useState(false);

  useEffect(() => {
    setThemeMounted(true);
  }, []);

  useEffect(() => {
    if (sessionMetadata) {
      setSessionNameInput(sessionMetadata.sessionName);
    }
  }, [sessionMetadata]);

  // 세션 날짜 맵 로드
  const sessionsMap = useMemo(() => {
    const sessionKey = "workout.sessions.v1";
    const sessionsJson = localStorage.getItem(sessionKey);

    if (!sessionsJson) return new Map<string, boolean>();

    try {
      const sessions: Session[] = JSON.parse(sessionsJson);
      const map = new Map<string, boolean>();

      sessions.forEach((session) => {
        const date = new Date(session.savedAt);
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        map.set(dateStr, true);
      });

      return map;
    } catch (e) {
      return new Map<string, boolean>();
    }
  }, [historyVersion]);

  // 날짜 범위 생성
  const dateRange = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const PAST_DAYS = 14;
    const FUTURE_DAYS = 7;
    const dates: DateInfo[] = [];

    for (let i = -PAST_DAYS; i <= FUTURE_DAYS; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i);

      const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

      dates.push({
        date: date,
        dayOfMonth: date.getDate(),
        dayOfWeek: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][
          date.getDay()
        ],
        hasSession: sessionsMap.has(dateStr),
        isToday: i === 0,
        isFuture: i > 0,
      });
    }

    return dates;
  }, [sessionsMap]);

  useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer) return;

    const todayIndex = dateRange.findIndex((d) => d.isToday);
    if (todayIndex === -1) return;

    const cardWidth = 44;
    const gap = 4;
    const scrollPosition =
      (cardWidth + gap) * todayIndex -
      scrollContainer.offsetWidth / 2 +
      cardWidth / 2;

    setTimeout(() => {
      scrollContainer.scrollTo({
        left: Math.max(0, scrollPosition),
        behavior: "smooth",
      });
    }, 100);
  }, [dateRange]);

  function getDefaultSessionName(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes} 세션`;
  }

  function handleSessionNameBlur() {
    const trimmed = sessionNameInput.trim();
    if (trimmed === "") {
      const defaultName = getDefaultSessionName();
      setSessionNameInput(defaultName);
      changeSessionName(defaultName);
    } else {
      changeSessionName(trimmed);
    }
  }

  function handleDateClick(dateInfo: DateInfo) {
    if (dateInfo.isFuture) return;

    const dateStr = `${dateInfo.date.getFullYear()}-${String(dateInfo.date.getMonth() + 1).padStart(2, "0")}-${String(dateInfo.date.getDate()).padStart(2, "0")}`;

    if (dateInfo.isToday) {
      setSelectedDate(null);
      setShowHistory(false);
    } else {
      setSelectedDate(dateStr);
      setShowHistory(true);
    }
  }

  function formatDateString(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    }

    if (isMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isMenuOpen]);

  return (
    <>
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex min-h-14 items-center justify-between px-4">
          <span className="flex items-center gap-1.5 font-(family-name:--font-brand) text-xl font-medium tracking-[0.2em]">
            <span className="size-2 rounded-full bg-(--session-accent)" />
            <span>daily</span>
            <span className="text-(--session-muted)">set</span>
          </span>
          <div className="flex items-center">
            <Sheet open={showAllHistory} onOpenChange={setShowAllHistory}>
              <SheetTrigger asChild>
                <Button variant="ghost" className={HEADER_TEXT_BUTTON}>
                  기록
                </Button>
              </SheetTrigger>
              <SheetContent
                side="bottom"
                showCloseButton={false}
                className="session-surface session-font h-[85vh]"
              >
                <SheetHeader className="flex-row items-center justify-between pb-0">
                  <SheetTitle className="text-2xl font-bold tracking-tight">
                    전체 운동 기록
                  </SheetTitle>
                  <SheetClose asChild>
                    <Button variant="ghost" className={HEADER_TEXT_BUTTON}>
                      닫기
                    </Button>
                  </SheetClose>
                </SheetHeader>
                <div className="mt-4 overflow-y-auto h-full pb-20">
                  <WorkoutHistoryClient
                    showHistory={true}
                    historyVersion={historyVersion}
                    selectedDate={null}
                    notionReady={notionReady}
                    onHistoryChanged={onHistoryChanged}
                  />
                </div>
              </SheetContent>
            </Sheet>
            {!showHistory && (
              <Button
                variant="ghost"
                className={HEADER_TEXT_BUTTON}
                onClick={onStartNewSession}
              >
                새 세션
              </Button>
            )}
            <div className="relative" ref={menuRef}>
              <Button
                variant="ghost"
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className={HEADER_TEXT_BUTTON}
              >
                설정
                <span
                  className={`size-1.5 rounded-full ${
                    notionReady ? "bg-green-500" : "bg-red-500"
                  }`}
                />
              </Button>

              {isMenuOpen && (
                <div className="absolute right-0 top-full z-50 mt-2 w-64 border border-foreground bg-background">
                  <div className="px-4 py-3 border-b border-border">
                    <div className="flex items-center gap-2">
                      <div
                        className={`size-2 rounded-full ${
                          notionReady ? "bg-green-500" : "bg-red-500"
                        }`}
                      />
                      <span className="text-sm font-medium">
                        Notion {notionReady ? "연결됨" : "연결 안됨"}
                      </span>
                    </div>
                  </div>

                  {themeMounted && (
                    <div className="px-4 py-3 border-b border-border">
                      <span className="mb-2 block text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground">
                        테마
                      </span>
                      <div
                        className="grid grid-cols-3 gap-1"
                        role="group"
                        aria-label="테마 선택"
                      >
                        {(
                          [
                            { value: "light", label: "라이트" },
                            { value: "dark", label: "다크" },
                            { value: "system", label: "시스템" },
                          ] as const
                        ).map(({ value, label }) => (
                          <button
                            key={value}
                            type="button"
                            className={`h-11 border text-sm font-semibold ${
                              theme === value
                                ? "border-foreground bg-foreground text-background"
                                : "border-border"
                            }`}
                            aria-label={label}
                            aria-pressed={theme === value}
                            onClick={() => setTheme(value)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="px-2 py-1">
                    <Button
                      variant="ghost"
                      className="h-11 w-full justify-start rounded-none text-sm font-semibold"
                      onClick={() => {
                        window.location.href = withBasePath("/settings/notion");
                        setIsMenuOpen(false);
                      }}
                    >
                      Notion 연동 설정
                    </Button>
                    <Button
                      variant="ghost"
                      className="h-11 w-full justify-start rounded-none text-sm font-semibold"
                      onClick={() => {
                        fetch(withBasePath("/api/notion/disconnect"), {
                          method: "POST",
                        })
                          .then((data) => {
                            if (data.ok) {
                              toast.success("Notion 연결 해제 완료", {
                                duration: 1000,
                              });
                              checkNotionStatus();
                              setIsMenuOpen(false);
                            }
                          })
                          .catch((err) => {
                            toast.error(
                              "Notion 연결 해제 중 오류가 발생했습니다.",
                              {
                                duration: 1000,
                              },
                            );
                          });
                      }}
                    >
                      연결 해제
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="space-y-3 px-4 pt-1 pb-2">
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-7">
            {sessionMetadata && (
              <div className="px-1 text-sm text-muted-foreground">
                {formatSessionDateLabel(sessionMetadata.startedAt)}
              </div>
            )}
            <input
              type="text"
              value={sessionNameInput}
              onChange={(e) => setSessionNameInput(e.target.value)}
              onBlur={handleSessionNameBlur}
              placeholder="세션 이름을 입력하세요"
              className="w-full truncate bg-transparent px-1 py-1 text-2xl font-bold tracking-tight rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="min-w-0 flex-3 whitespace-nowrap pb-2 text-right text-2xl font-bold tabular-nums leading-none">
            {formatClock(currentDurationSeconds)}
          </div>
        </div>

        <div className="border-b border-foreground" />

        <div
          ref={scrollRef}
          className="overflow-x-auto scrollbar-hide"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          <div className="flex gap-1 min-w-min">
            {dateRange.map((dateInfo) => {
              const dateStr = formatDateString(dateInfo.date);
              const isViewed =
                selectedDate === dateStr ||
                (dateInfo.isToday && selectedDate === null);
              const showSessionDot =
                dateInfo.hasSession && !dateInfo.isToday && !dateInfo.isFuture;

              return (
                <button
                  key={dateStr}
                  disabled={dateInfo.isFuture}
                  onClick={() => handleDateClick(dateInfo)}
                  aria-current={isViewed ? "date" : undefined}
                  className={`flex h-11 min-w-11 shrink-0 flex-col items-center justify-center transition-colors ${
                    dateInfo.isFuture
                      ? "cursor-not-allowed text-muted-foreground opacity-40"
                      : "text-foreground hover:bg-accent"
                  }`}
                >
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {dateInfo.dayOfWeek}
                  </span>
                  <span
                    className={`border-b-2 px-0.5 text-base leading-tight tabular-nums ${
                      isViewed ? "border-foreground" : "border-transparent"
                    } ${isViewed || dateInfo.isToday ? "font-bold" : "font-medium"}`}
                  >
                    {dateInfo.dayOfMonth}
                  </span>
                  <span
                    className={`mt-0.5 size-1 rounded-full ${
                      showSessionDot ? "bg-foreground" : "bg-transparent"
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );

  async function checkNotionStatus() {
    const response = await fetch(withBasePath("/api/notion/status"));
    const data = await response.json();
    setNotionReady(data.notionConnected && data.dbConnected);
  }
}
