"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { withBasePath } from "@/lib/base-path";
import { shouldUseSafariHandoffFlow } from "@/lib/is-standalone-pwa";
import { startNotionConnect } from "@/lib/notion-connect-session";

const FIELD_LABEL =
  "block text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground";
const FIELD_SELECT =
  "h-12 w-full rounded-none border-0 border-b border-foreground bg-transparent text-base outline-none focus-visible:border-b-2";

function NotionPageShell({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="session-surface session-font min-h-screen">
      <div className="mx-auto max-w-3xl px-4 pb-10">
        <div className="flex min-h-14 items-center justify-between">
          <span className="flex items-center gap-1.5 font-(family-name:--font-brand) text-xl font-medium tracking-[0.2em]">
            <span className="size-2 rounded-full bg-(--session-accent)" />
            <span>daily</span>
            <span className="text-(--session-muted)">set</span>
          </span>
          <div className="flex items-center">{actions}</div>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        <div className="mt-4 border-b border-foreground" />
        {children}
      </div>
    </div>
  );
}

type DatabaseOption = {
  id: string;
  title: string;
};

type NotionSettingsPageProps = {
  notionConnected: boolean;
  dbConnected: boolean;
  onConnectionComplete: () => void | Promise<void>;
};

export default function NotionSettingsPage({
  notionConnected,
  dbConnected,
  onConnectionComplete,
}: NotionSettingsPageProps) {
  const [databases, setDatabases] = useState<DatabaseOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [selectedSetsDbId, setSelectedSetsDbId] = useState("");
  const [selectedExerciseDbId, setSelectedExerciseDbId] = useState("");
  const [selectedSessionDbId, setSelectedSessionDbId] = useState("");
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [usesSafariHandoff, setUsesSafariHandoff] = useState(false);

  useEffect(() => {
    setUsesSafariHandoff(shouldUseSafariHandoffFlow());
  }, []);

  const handleNotionConnect = async () => {
    try {
      setConnectLoading(true);
      setConnectError(null);
      await startNotionConnect();
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Notion 연결을 시작할 수 없습니다.";
      setConnectError(message);
    } finally {
      setConnectLoading(false);
    }
  };

  const handleCompleteConnection = async () => {
    if (!selectedSetsDbId || !selectedExerciseDbId || !selectedSessionDbId)
      return;
    const ids = [selectedSetsDbId, selectedExerciseDbId, selectedSessionDbId];
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length) return;

    try {
      setSubmitting(true);
      setSubmitError(null);

      const res = await fetch(withBasePath("/api/notion/connection"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workout_sets_db_id: selectedSetsDbId,
          workout_exercise_db_id: selectedExerciseDbId,
          workout_session_db_id: selectedSessionDbId,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "연결 저장 실패");
      }

      await onConnectionComplete();
      window.location.href = withBasePath("/app");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.";
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const fetchDatabaseOptions = async (
    mode: "initial" | "refresh" = "initial",
  ) => {
    try {
      if (mode === "initial") {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      setError(null);

      const res = await fetch(withBasePath("/api/notion/database-options"), {
        method: "GET",
        cache: "no-store",
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "DB 목록 조회 실패");
      }

      setDatabases(data.data ?? []);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.";
      setError(message);
    } finally {
      if (mode === "initial") {
        setLoading(false);
      } else {
        setRefreshing(false);
      }
    }
  };

  useEffect(() => {
    if (!notionConnected || dbConnected) {
      setLoading(false);
      return;
    }

    fetchDatabaseOptions("initial");
  }, [notionConnected, dbConnected]);

  const setsOptions = databases.filter(
    (db) => db.id !== selectedExerciseDbId && db.id !== selectedSessionDbId,
  );
  const exerciseOptions = databases.filter(
    (db) => db.id !== selectedSetsDbId && db.id !== selectedSessionDbId,
  );

  const sessionOptions = databases.filter(
    (db) => db.id !== selectedSetsDbId && db.id !== selectedExerciseDbId,
  );

  const selectedSetsDb =
    databases.find((db) => db.id === selectedSetsDbId) ?? null;
  const selectedExerciseDb =
    databases.find((db) => db.id === selectedExerciseDbId) ?? null;
  const selectedSessionDb =
    databases.find((db) => db.id === selectedSessionDbId) ?? null;

  const isCompleteEnabled =
    !!selectedSetsDbId &&
    !!selectedExerciseDbId &&
    !!selectedSessionDbId &&
    new Set([selectedSetsDbId, selectedExerciseDbId, selectedSessionDbId])
      .size === 3;

  if (!notionConnected) {
    return (
      <NotionPageShell
        title="Notion 연결"
        description="먼저 Notion OAuth 연결을 완료해야 데이터베이스를 선택할 수 있습니다."
        actions={
          <Link href="/app" className={cn(buttonVariants({ variant: "ghost", size: "text" }))}>
            홈으로
          </Link>
        }
      >
        <div className="space-y-4 border-b border-border py-6">
          <div>
            <h2 className="text-lg font-bold tracking-tight">
              1단계. Notion 계정 연결
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              아래 버튼을 눌러 Notion 계정을 연결한 뒤 다시 돌아오세요.
            </p>
          </div>

          <div>
            <button
              type="button"
              onClick={handleNotionConnect}
              disabled={connectLoading}
              className={cn(buttonVariants({ variant: "accent", size: "cta" }))}
            >
              {connectLoading ? "연결 준비 중..." : "Notion 연동하기"}
            </button>
            {connectError && (
              <p className="mt-3 border-l-2 border-destructive pl-3 text-sm text-destructive">
                {connectError}
              </p>
            )}
          </div>
        </div>

        {usesSafariHandoff && (
          <div className="mt-6 border-l-2 border-(--session-accent) pl-3 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">
              iOS 홈 화면 앱에서 연결하기
            </p>
            <p className="mt-2">
              Notion 연동은 Safari에서 진행됩니다. Safari에서 계정 승인과 DB
              선택을 마친 뒤, 홈 화면 Dailyset 아이콘으로 돌아오세요.
            </p>
          </div>
        )}
      </NotionPageShell>
    );
  }

  if (loading) {
    return (
      <NotionPageShell
        title="Notion DB 연결"
        description="Notion 데이터베이스 목록을 불러오는 중입니다."
      />
    );
  }

  return (
    <NotionPageShell
      title="Notion DB 연결"
      description="운동 기록용 DB, 운동 목록 DB, 세션 DB를 각각 선택하세요."
      actions={
        <>
          <button
            type="button"
            onClick={() => fetchDatabaseOptions("refresh")}
            disabled={refreshing}
            className={cn(buttonVariants({ variant: "ghost", size: "text" }))}
          >
            {refreshing ? "새로고침 중..." : "목록 새로고침"}
          </button>

          <Link href="/app" className={cn(buttonVariants({ variant: "ghost", size: "text" }))}>
            홈으로
          </Link>
        </>
      }
    >
      {error && (
        <div className="mt-6 space-y-3 border-l-2 border-destructive pl-3 text-sm text-destructive">
          <div>에러: {error}</div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleNotionConnect}
              disabled={connectLoading}
              className={cn(buttonVariants({ variant: "outline-strong", size: "touch" }))}
            >
              {connectLoading ? "연결 준비 중..." : "Notion 연동 다시 하기"}
            </button>

            <Link href="/app" className={cn(buttonVariants({ variant: "outline-strong", size: "touch" }))}>
              홈으로
            </Link>
          </div>
        </div>
      )}

      <div>
        <div className="space-y-2 border-b border-border py-5">
          <label htmlFor="exercise-db" className={FIELD_LABEL}>
            Workout Exercise DB
          </label>
          <select
            id="exercise-db"
            value={selectedExerciseDbId}
            onChange={(e) => setSelectedExerciseDbId(e.target.value)}
            className={FIELD_SELECT}
          >
            <option value="">선택하세요</option>
            {exerciseOptions.map((db) => (
              <option key={db.id} value={db.id}>
                {db.title}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            운동 목록과 카테고리 정보를 읽어올 데이터베이스를 선택합니다.
          </p>
        </div>

        <div className="space-y-2 border-b border-border py-5">
          <label htmlFor="session-db" className={FIELD_LABEL}>
            Workout Session DB
          </label>
          <select
            id="session-db"
            value={selectedSessionDbId}
            onChange={(e) => setSelectedSessionDbId(e.target.value)}
            className={FIELD_SELECT}
          >
            <option value="">선택하세요</option>
            {sessionOptions.map((db) => (
              <option key={db.id} value={db.id}>
                {db.title}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            세션 정보가 저장될 데이터베이스를 선택합니다. (Sets를 묶는 상위
            레코드)
          </p>
        </div>

        <div className="space-y-2 border-b border-border py-5">
          <label htmlFor="sets-db" className={FIELD_LABEL}>
            Workout Set DB
          </label>
          <select
            id="sets-db"
            value={selectedSetsDbId}
            onChange={(e) => setSelectedSetsDbId(e.target.value)}
            className={FIELD_SELECT}
          >
            <option value="">선택하세요</option>
            {setsOptions.map((db) => (
              <option key={db.id} value={db.id}>
                {db.title}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            세트 기록이 저장될 데이터베이스를 선택합니다.
          </p>
        </div>

        <div className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            같은 데이터베이스는 여러 역할에 중복 선택할 수 없습니다.
          </p>

          <button
            type="button"
            onClick={handleCompleteConnection}
            disabled={!isCompleteEnabled || submitting}
            className={cn(buttonVariants({ variant: "accent", size: "cta" }))}
          >
            {submitting ? "저장 중..." : "연결 완료"}
          </button>
        </div>
      </div>

      {submitError && (
        <p className="border-l-2 border-destructive pl-3 text-sm text-destructive">
          에러: {submitError}
        </p>
      )}
    </NotionPageShell>
  );
}
