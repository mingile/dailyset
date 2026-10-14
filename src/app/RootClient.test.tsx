import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "@/components/ui/sonner";
import { EXERCISE_LIBRARY_QUERY_KEY } from "@/hooks/useExerciseLibrary";
import {
  NOTION_DB_CONNECTED_KEY,
  NOTION_OUTBOX_KEY,
  type NotionOutboxJob,
} from "@/lib/notion-outbox";
import { createQueryWrapper } from "@/test-utils/query";
import { RootClient } from "./RootClient";
import type { Session, SessionDraft } from "./types";

// RootClient가 연결하는 것(localStorage, fetch, toast, 화면 전환)만 검증한다.
// payload 변환·dirty 판정·outbox 상태 전이·세트 단위 interaction은 각각의 unit/component 테스트가 보장한다.

const DRAFT_KEY = "workout.currentSession.v1";
const SESSIONS_KEY = "workout.sessions.v1";

// ---- 경계 stub ----

type FetchOptions = {
  notionConnected?: boolean;
  enqueueStatus?: number;
  disconnectStatus?: number;
  /** 처음 status 조회의 HTTP 상태 (기본 200) */
  statusHttp?: number;
  /** status 조회가 네트워크 오류로 실패 */
  statusThrows?: boolean;
  /** 연결 해제 뒤 다시 확인하는 status 조회의 HTTP 상태 (기본 200 = 연결 안 됨 응답) */
  statusHttpAfterDisconnect?: number;
  /** workout-records 응답 (호출 순서를 1부터 받는다). 기본은 빈 결과 */
  workoutRecords?: (callNumber: number) => Response | Promise<Response>;
  /** exercise-read가 돌려줄 Notion 운동 행. 기본은 랫풀다운 한 행 */
  exerciseRows?: unknown[];
};

// Notion exercise DB 한 행. 연결된 상태에서 라이브러리가 렌더될 때 쓰인다.
const notionExerciseRow = {
  id: "notion-page-lat",
  properties: {
    exercise_id: { rich_text: [{ plain_text: "lat-pulldown" }] },
    이름: { title: [{ plain_text: "랫풀다운" }] },
    카테고리: { select: { name: "등" } },
    장비: { select: { name: "케이블" } },
  },
};

// 랫풀다운과 같은 카테고리(등)라 탭을 바꾸지 않고 고를 수 있다.
const seatedRowExerciseRow = {
  id: "notion-page-row",
  properties: {
    exercise_id: { rich_text: [{ plain_text: "seated-row" }] },
    이름: { title: [{ plain_text: "시티드로우" }] },
    카테고리: { select: { name: "등" } },
    장비: { select: { name: "케이블" } },
  },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Notion workout-records 한 행. 해당 운동의 가장 최근 기록으로 쓰인다.
function workoutRecordsResponse(exercisePageId: string, weight: number) {
  return jsonResponse({
    results: [
      {
        properties: {
          Name: { title: [{ plain_text: "기록" }] },
          "Set No": { number: 1 },
          Weight: { number: weight },
          Reps: { number: 8 },
          Date: { date: { start: "2026-10-01" } },
          Exercise: { relation: [{ id: exercisePageId }] },
        },
      },
    ],
  });
}

function stubFetch({
  notionConnected = false,
  enqueueStatus = 200,
  disconnectStatus = 200,
  statusHttp = 200,
  statusThrows = false,
  statusHttpAfterDisconnect = 200,
  workoutRecords = () => jsonResponse({ results: [] }),
  exerciseRows = [notionExerciseRow],
}: FetchOptions = {}) {
  let disconnected = false;
  let workoutRecordsCalls = 0;
  // init은 쓰지 않지만 mock.calls의 타입에 요청 옵션(body)이 포함되도록 선언한다
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/notion/status")) {
        if (statusThrows) throw new TypeError("Failed to fetch");
        const http = disconnected ? statusHttpAfterDisconnect : statusHttp;
        if (http !== 200) return jsonResponse({ error: "status failed" }, http);
        const connected = notionConnected && !disconnected;
        return jsonResponse({
          notionConnected: connected,
          dbConnected: connected,
        });
      }
      if (url.includes("/api/notion/exercise-read")) {
        return jsonResponse({ data: exerciseRows });
      }
      if (url.includes("/api/notion/disconnect")) {
        if (disconnectStatus !== 200) {
          return jsonResponse({ error: "disconnect failed" }, disconnectStatus);
        }
        disconnected = true;
        return jsonResponse({ ok: true });
      }
      if (url.includes("/api/sync/enqueue")) {
        return enqueueStatus === 200
          ? jsonResponse({ ok: true })
          : jsonResponse({ error: "queue unavailable" }, enqueueStatus);
      }
      if (url.includes("/api/sync/status")) return jsonResponse({ jobs: [] });
      if (url.includes("/api/notion/workout-records")) {
        workoutRecordsCalls += 1;
        return workoutRecords(workoutRecordsCalls);
      }
      throw new Error(`stub되지 않은 요청: ${url}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function getCalls(fetchMock: ReturnType<typeof stubFetch>, path: string) {
  return fetchMock.mock.calls.filter(([input]) => String(input).includes(path));
}

function getEnqueueCalls(fetchMock: ReturnType<typeof stubFetch>) {
  return getCalls(fetchMock, "/api/sync/enqueue");
}

// ---- 픽스처 ----

function makeDraft(
  options: { exercisePageId?: string; doneSets?: number } = {},
): SessionDraft {
  const { exercisePageId, doneSets = 1 } = options;
  return {
    session: {
      sessionId: "draft-session",
      sessionName: "복원된 세션",
      startedAt: new Date().toISOString(),
    },
    exercises: [
      {
        id: "ex-bench",
        name: "벤치프레스",
        part: "가슴",
        exercisePageId,
        targetMainSetCount: 2,
        targetWarmupSetCount: 0,
        sets: [0, 1].map((index) => ({
          weight: 60,
          reps: 10,
          done: index < doneSets,
          synced: false,
          equipment: "barbell",
          memo: "",
          unit: "kg" as const,
          setType: "main" as const,
        })),
      },
    ],
  };
}

function seedDraft(draft: SessionDraft) {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

function makeSavedSession(
  id: string,
  name: string,
  savedAt: string,
  exerciseName = "스쿼트",
): Session {
  return {
    id,
    savedAt,
    sessionName: name,
    exercises: [
      {
        id: `${id}-ex`,
        name: exerciseName,
        part: "하체",
        sets: [
          { setNo: 1, weight: 100, reps: 5, memo: "", equipment: "barbell" },
          { setNo: 2, weight: 105, reps: 5, memo: "", equipment: "barbell" },
        ],
      },
    ],
  };
}

function seedSessions(sessions: Session[]) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

function readSessions(): Session[] {
  return JSON.parse(localStorage.getItem(SESSIONS_KEY) ?? "[]");
}

/** 완료한 세션 하나를 Notion으로 보내는 outbox 작업 */
function makeOutboxJob(
  sessionId: string,
  status: NotionOutboxJob["status"],
  savedAt = "2026-09-20T03:00:00.000Z",
): NotionOutboxJob {
  return {
    sessionId,
    savedAt,
    payload: {
      sessionId,
      sessionName: "보낼 세션",
      startedAt: savedAt,
      savedAt,
      exercises: [
        {
          id: `${sessionId}-ex`,
          name: "스쿼트",
          part: "하체",
          exercisePageId: "notion-page-squat",
          sets: [
            { setNo: 1, weight: 100, reps: 5, memo: "", equipment: "barbell" },
          ],
        },
      ],
    },
    status,
    attempts: status === "failed" ? 3 : 0,
    ...(status === "failed" ? { failedReason: "HTTP 400" } : {}),
    createdAt: savedAt,
    updatedAt: savedAt,
  };
}

function seedOutbox(jobs: NotionOutboxJob[]) {
  localStorage.setItem(NOTION_OUTBOX_KEY, JSON.stringify(jobs));
}

function readOutboxJobs(): NotionOutboxJob[] {
  return JSON.parse(localStorage.getItem(NOTION_OUTBOX_KEY) ?? "[]");
}

function enqueueBody(call: ReturnType<typeof getEnqueueCalls>[number]) {
  return JSON.parse(String(call[1]?.body));
}

function renderRootWithClient() {
  const user = userEvent.setup();
  const { queryClient, Wrapper } = createQueryWrapper();
  render(
    <>
      <RootClient />
      <Toaster position="top-center" />
    </>,
    { wrapper: Wrapper },
  );
  return { user, queryClient };
}

function renderRoot() {
  return renderRootWithClient().user;
}

/** 세션 화면까지 뜨기를 기다린다 (Loading... → 세션) */
async function waitForSessionScreen() {
  await screen.findByRole("button", { name: "운동 완료" });
}

beforeEach(() => {
  localStorage.clear();
  // 라이브러리 → 세션 흐름 등에서 쓰는 콘솔 에러는 테스트 출력에서 제외한다
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("RootClient — 초기 진입", () => {
  it("저장된 draft가 없으면 운동 라이브러리를 보여준다", async () => {
    stubFetch();
    renderRoot();

    expect(
      await screen.findByRole("heading", { name: "운동 라이브러리" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "선택 완료 (0)" }),
    ).toBeInTheDocument();
  });

  it("진행 중인 draft가 있으면 세션 화면으로 복원한다", async () => {
    stubFetch();
    seedDraft(makeDraft({ doneSets: 1 }));
    renderRoot();

    await waitForSessionScreen();

    expect(screen.getByText("벤치프레스")).toBeInTheDocument();
    expect(screen.getByText("1 / 2 SETS")).toBeInTheDocument();
    expect(screen.getByDisplayValue("복원된 세션")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "운동 라이브러리" }),
    ).toBeNull();
  });

  it("손상된 draft는 버리고 라이브러리로 시작한다", async () => {
    stubFetch();
    localStorage.setItem(DRAFT_KEY, "{not json");
    renderRoot();

    expect(
      await screen.findByRole("heading", { name: "운동 라이브러리" }),
    ).toBeInTheDocument();
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it("형식이 맞지 않는 draft도 버리고 라이브러리로 시작한다", async () => {
    stubFetch();
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ session: {}, exercises: [] }),
    );
    renderRoot();

    expect(
      await screen.findByRole("heading", { name: "운동 라이브러리" }),
    ).toBeInTheDocument();
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });
});

describe("RootClient — 라이브러리에서 세션 시작", () => {
  it("운동을 선택하고 선택 완료를 누르면 세션 화면이 열리고 draft가 저장된다", async () => {
    stubFetch();
    const user = renderRoot();
    await screen.findByRole("heading", { name: "운동 라이브러리" });

    // 제목은 먼저 뜨고 첫 카테고리의 운동 목록은 effect 이후에 채워지므로 기다린다
    await user.click(await screen.findByText("랫풀다운", { exact: true }));
    expect(
      screen.getByRole("button", { name: "선택 완료 (1)" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "선택 완료 (1)" }));

    await waitForSessionScreen();
    expect(screen.getByText("랫풀다운")).toBeInTheDocument();
    const draft: SessionDraft = JSON.parse(
      localStorage.getItem(DRAFT_KEY) ?? "null",
    );
    expect(draft.exercises.map((ex) => ex.name)).toEqual(["랫풀다운"]);
  });

  it("아무것도 선택하지 않고 선택 완료를 누르면 안내 문구를 보여준다", async () => {
    stubFetch();
    const user = renderRoot();
    await screen.findByRole("heading", { name: "운동 라이브러리" });

    await user.click(screen.getByRole("button", { name: "선택 완료 (0)" }));

    expect(
      screen.getByText("운동을 최소 1개 이상 선택해주세요"),
    ).toBeInTheDocument();
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  // 라이브러리·운동 추가 시트가 Notion page id를 세션 운동에 넘기지 않으면 Notion 동기화가 통째로 건너뛰어진다.
  it("Notion 목록에서 고른 운동과 운동 추가로 더한 운동이 Notion page id를 갖고 enqueue된다", async () => {
    const fetchMock = stubFetch({
      notionConnected: true,
      exerciseRows: [notionExerciseRow, seatedRowExerciseRow],
    });
    const user = renderRoot();
    await screen.findByRole("heading", { name: "운동 라이브러리" });

    await user.click(await screen.findByText("랫풀다운", { exact: true }));
    await user.click(screen.getByRole("button", { name: "선택 완료 (1)" }));
    await waitForSessionScreen();

    await user.click(screen.getByRole("button", { name: "운동 추가" }));
    const sheet = await screen.findByRole("dialog");
    await user.click(
      await within(sheet).findByText("시티드로우", { exact: true }),
    );
    // 이미 세션에 있는 운동은 시트 목록에서 빠진다 (중복 추가 방지)
    expect(within(sheet).queryByText("랫풀다운", { exact: true })).toBeNull();
    await user.click(
      within(sheet).getByRole("button", { name: "추가하기 (1)" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    for (const name of ["랫풀다운", "시티드로우"]) {
      await user.click(screen.getByRole("button", { name: new RegExp(name) }));
      await user.click(screen.getByRole("checkbox", { name: "세트 1 완료" }));
    }
    await user.click(screen.getByRole("button", { name: "운동 완료" }));

    expect(
      await screen.findByText("Notion 동기화 요청 완료"),
    ).toBeInTheDocument();
    const calls = getEnqueueCalls(fetchMock);
    expect(calls).toHaveLength(1);
    expect(
      enqueueBody(calls[0]).exercises.map(
        (ex: { name: string; exercisePageId?: string }) => [
          ex.name,
          ex.exercisePageId,
        ],
      ),
    ).toEqual([
      ["랫풀다운", "notion-page-lat"],
      ["시티드로우", "notion-page-row"],
    ]);
  });
});

describe("RootClient — 운동 완료", () => {
  it("완료한 세트만 history에 저장하고 draft를 지운 뒤 라이브러리로 돌아간다", async () => {
    stubFetch();
    seedDraft(makeDraft({ doneSets: 1 }));
    const user = renderRoot();
    await waitForSessionScreen();

    await user.click(screen.getByRole("button", { name: "운동 완료" }));

    expect(
      await screen.findByRole("heading", { name: "운동 라이브러리" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("운동을 완료했습니다")).toBeInTheDocument();
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();

    const sessions = readSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe("draft-session");
    expect(sessions[0].sessionName).toBe("복원된 세션");
    expect(sessions[0].exercises).toHaveLength(1);
    expect(sessions[0].exercises[0].name).toBe("벤치프레스");
    expect(sessions[0].exercises[0].sets).toHaveLength(1);
  });

  it("기존 history 앞에 새 세션을 추가한다", async () => {
    stubFetch();
    seedSessions([
      makeSavedSession("past-1", "지난 세션", "2026-09-20T03:00:00.000Z"),
    ]);
    seedDraft(makeDraft());
    const user = renderRoot();
    await waitForSessionScreen();

    await user.click(screen.getByRole("button", { name: "운동 완료" }));
    await screen.findByRole("heading", { name: "운동 라이브러리" });

    expect(readSessions().map((s) => s.id)).toEqual([
      "draft-session",
      "past-1",
    ]);
  });

  it("완료한 세트가 없으면 저장하지 않고 안내를 보여주며 세션을 유지한다", async () => {
    stubFetch();
    seedDraft(makeDraft({ doneSets: 0 }));
    const user = renderRoot();
    await waitForSessionScreen();

    await user.click(screen.getByRole("button", { name: "운동 완료" }));

    expect(
      await screen.findByText("저장할 내용이 없습니다."),
    ).toBeInTheDocument();
    expect(localStorage.getItem(SESSIONS_KEY)).toBeNull();
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull();
    expect(screen.getByRole("button", { name: "운동 완료" })).toBeEnabled();
  });

  it("Notion이 연결되어 있지 않으면 enqueue를 요청하지 않고 로컬 저장만 안내한다", async () => {
    const fetchMock = stubFetch({ notionConnected: false });
    seedDraft(makeDraft());
    const user = renderRoot();
    await waitForSessionScreen();

    await user.click(screen.getByRole("button", { name: "운동 완료" }));

    expect(await screen.findByText("Notion 미연결")).toBeInTheDocument();
    expect(getEnqueueCalls(fetchMock)).toHaveLength(0);
  });

  it("Notion이 연결되어 있으면 완료한 세트만 enqueue로 보내고 성공을 안내한다", async () => {
    const fetchMock = stubFetch({ notionConnected: true });
    seedDraft(makeDraft({ exercisePageId: "notion-page-1", doneSets: 1 }));
    const user = renderRoot();
    await waitForSessionScreen();

    await user.click(screen.getByRole("button", { name: "운동 완료" }));

    expect(
      await screen.findByText("Notion 동기화 요청 완료"),
    ).toBeInTheDocument();
    const calls = getEnqueueCalls(fetchMock);
    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0][1]?.body));
    expect(body.sessionId).toBe("draft-session");
    expect(body.exercises[0].exercisePageId).toBe("notion-page-1");
    expect(body.exercises[0].sets).toHaveLength(1);
    expect(readSessions()).toHaveLength(1);
  });

  it("enqueue가 실패해도 로컬 history는 유지하고 실패를 안내한다", async () => {
    stubFetch({ notionConnected: true, enqueueStatus: 500 });
    seedDraft(makeDraft({ exercisePageId: "notion-page-1" }));
    const user = renderRoot();
    await waitForSessionScreen();

    await user.click(screen.getByRole("button", { name: "운동 완료" }));

    expect(
      await screen.findByText("Notion 동기화 요청 실패"),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "운동 라이브러리" }),
    ).toBeInTheDocument();
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
    expect(readSessions().map((s) => s.id)).toEqual(["draft-session"]);
  });

  it("Exercise 정보가 없는 운동이 있으면 enqueue 없이 로컬만 저장하고 안내한다", async () => {
    const fetchMock = stubFetch({ notionConnected: true });
    seedDraft(makeDraft({ exercisePageId: undefined }));
    const user = renderRoot();
    await waitForSessionScreen();

    await user.click(screen.getByRole("button", { name: "운동 완료" }));

    expect(
      await screen.findByText("일부 운동에 Exercise 정보가 없습니다."),
    ).toBeInTheDocument();
    expect(getEnqueueCalls(fetchMock)).toHaveLength(0);
    expect(readSessions()).toHaveLength(1);
  });
});

describe("RootClient — 새 세션", () => {
  it("확인하면 draft를 지우고 라이브러리로 돌아간다", async () => {
    stubFetch();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    seedDraft(makeDraft());
    const user = renderRoot();
    await waitForSessionScreen();

    await user.click(screen.getByRole("button", { name: "새 세션" }));

    expect(
      await screen.findByRole("heading", { name: "운동 라이브러리" }),
    ).toBeInTheDocument();
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it("취소하면 현재 세션을 그대로 유지한다", async () => {
    stubFetch();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    seedDraft(makeDraft());
    const user = renderRoot();
    await waitForSessionScreen();

    await user.click(screen.getByRole("button", { name: "새 세션" }));

    expect(
      screen.getByRole("button", { name: "운동 완료" }),
    ).toBeInTheDocument();
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull();
  });
});

describe("RootClient — 기록(History)", () => {
  async function openHistorySheet(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: /^기록/ }));
    return screen.findByRole("dialog");
  }

  it("기록 버튼을 누르면 저장된 세션이 날짜별로 보인다", async () => {
    stubFetch();
    const savedAt = "2026-09-20T03:00:00.000Z";
    seedSessions([makeSavedSession("past-1", "지난 하체 운동", savedAt)]);
    seedDraft(makeDraft());
    const user = renderRoot();
    await waitForSessionScreen();

    const sheet = await openHistorySheet(user);

    const date = new Date(savedAt);
    expect(
      within(sheet).getByText(
        `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`,
      ),
    ).toBeInTheDocument();
    expect(within(sheet).getByText("지난 하체 운동")).toBeInTheDocument();
    expect(
      within(sheet).getByText(/1 exercises · 2\s+sets/),
    ).toBeInTheDocument();
    expect(within(sheet).getByText("스쿼트")).toBeInTheDocument();
  });

  it("저장된 기록이 없으면 빈 상태를 보여준다", async () => {
    stubFetch();
    seedDraft(makeDraft());
    const user = renderRoot();
    await waitForSessionScreen();

    const sheet = await openHistorySheet(user);

    expect(
      within(sheet).getByText("저장된 운동 기록이 없습니다."),
    ).toBeInTheDocument();
  });

  it("세션 삭제를 누르면 목록과 저장소에서 사라지고 Notion 재전송 대상에서도 빠진다", async () => {
    stubFetch();
    seedSessions([
      makeSavedSession("past-1", "지울 세션", "2026-09-20T03:00:00.000Z"),
      makeSavedSession("past-2", "남길 세션", "2026-09-19T03:00:00.000Z"),
    ]);
    seedOutbox([
      makeOutboxJob("past-1", "failed", "2026-09-20T03:00:00.000Z"),
      makeOutboxJob("past-2", "failed", "2026-09-19T03:00:00.000Z"),
    ]);
    seedDraft(makeDraft());
    const user = renderRoot();
    await waitForSessionScreen();
    const sheet = await openHistorySheet(user);
    expect(within(sheet).getAllByText("노션 미동기화")).toHaveLength(2);

    const target = within(sheet)
      .getByText("지울 세션")
      .closest("div.border-b") as HTMLElement;
    await user.click(within(target).getByTitle("세션 삭제"));

    await waitFor(() =>
      expect(within(sheet).queryByText("지울 세션")).toBeNull(),
    );
    expect(within(sheet).getByText("남길 세션")).toBeInTheDocument();
    expect(readSessions().map((s) => s.id)).toEqual(["past-2"]);
    // 로컬에서 지운 세션은 나중에 자동 재전송으로 Notion에 생기면 안 된다
    expect(readOutboxJobs().map((job) => job.sessionId)).toEqual(["past-2"]);
    expect(within(sheet).getAllByText("노션 미동기화")).toHaveLength(1);
  });

  it("Notion에 보내지 못한 세션이 있으면 기록 버튼에 건수가 표시되고 다시 보내기가 보인다", async () => {
    stubFetch();
    seedSessions([
      makeSavedSession("past-1", "미동기화 세션", "2026-09-20T03:00:00.000Z"),
    ]);
    localStorage.setItem(
      NOTION_OUTBOX_KEY,
      JSON.stringify([
        {
          sessionId: "past-1",
          savedAt: "2026-09-20T03:00:00.000Z",
          payload: { sessionId: "past-1", exercises: [] },
          status: "failed",
          attempts: 3,
          lastError: "HTTP 400",
          createdAt: "2026-09-20T03:00:00.000Z",
          updatedAt: "2026-09-20T03:00:00.000Z",
        },
      ]),
    );
    seedDraft(makeDraft());
    const user = renderRoot();
    await waitForSessionScreen();

    expect(
      screen.getByRole("button", { name: "기록, Notion 미동기화 1건" }),
    ).toBeInTheDocument();

    const sheet = await openHistorySheet(user);
    expect(within(sheet).getByText("노션 미동기화")).toBeInTheDocument();
    expect(
      within(sheet).getByRole("button", { name: "다시 보내기" }),
    ).toBeInTheDocument();
  });

  it("지난 날짜를 누르면 그날의 기록이 보이고, 오늘을 누르면 세션 화면으로 돌아온다", async () => {
    stubFetch();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(12, 0, 0, 0);
    seedSessions([
      makeSavedSession("past-1", "어제 세션", yesterday.toISOString()),
    ]);
    seedDraft(makeDraft());
    const user = renderRoot();
    await waitForSessionScreen();

    // 요일과 날짜가 별도 span이라 접근성 이름에는 공백이 없다 (예: "TUE13")
    const dayName = (date: Date) =>
      `${["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][date.getDay()]}${date.getDate()}`;
    await user.click(screen.getByRole("button", { name: dayName(yesterday) }));

    expect(await screen.findByText("어제 세션")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "운동 완료" })).toBeNull();

    await user.click(screen.getByRole("button", { name: dayName(new Date()) }));

    expect(
      await screen.findByRole("button", { name: "운동 완료" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("어제 세션")).toBeNull();
  });
});

// outbox 상태 전이 자체는 notion-outbox.test.ts가 보장한다. 여기서는 RootClient가 언제 재전송을 시작하는지만 본다.
describe("RootClient — Notion 재전송(outbox)", () => {
  it("앱을 열면 outbox에 남은 pending 작업을 다시 보낸다", async () => {
    const fetchMock = stubFetch({ notionConnected: true });
    seedOutbox([makeOutboxJob("past-1", "pending")]);
    seedDraft(makeDraft());
    renderRoot();
    await waitForSessionScreen();

    expect(
      await screen.findByText("Notion 동기화 요청 1건 완료"),
    ).toBeInTheDocument();
    const calls = getEnqueueCalls(fetchMock);
    expect(calls).toHaveLength(1);
    expect(enqueueBody(calls[0]).sessionId).toBe("past-1");
    expect(enqueueBody(calls[0])).not.toHaveProperty("retryNo");
    expect(readOutboxJobs()).toMatchObject([
      { sessionId: "past-1", status: "queued" },
    ]);
  });

  it("오프라인에서 완료한 세션은 outbox에 남았다가 온라인이 되면 보낸다", async () => {
    // 오프라인이면 status 조회도 실패한다. 마지막으로 확인한 연결 상태(연결됨)로 동기화 대상을 판단한다.
    const fetchMock = stubFetch({ statusThrows: true });
    localStorage.setItem(NOTION_DB_CONNECTED_KEY, "true");
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    seedDraft(makeDraft({ exercisePageId: "notion-page-1" }));
    const user = renderRoot();
    await waitForSessionScreen();

    await user.click(screen.getByRole("button", { name: "운동 완료" }));

    expect(
      await screen.findByText("연결되면 Notion에 자동으로 저장됩니다."),
    ).toBeInTheDocument();
    await screen.findByRole("heading", { name: "운동 라이브러리" });
    expect(getEnqueueCalls(fetchMock)).toHaveLength(0);
    expect(readSessions().map((s) => s.id)).toEqual(["draft-session"]);
    expect(readOutboxJobs()).toMatchObject([
      { sessionId: "draft-session", status: "pending" },
    ]);

    onLine.mockReturnValue(true);
    window.dispatchEvent(new Event("online"));

    await waitFor(() => expect(getEnqueueCalls(fetchMock)).toHaveLength(1));
    const body = enqueueBody(getEnqueueCalls(fetchMock)[0]);
    expect(body.sessionId).toBe("draft-session");
    expect(body.exercises[0].exercisePageId).toBe("notion-page-1");
    await waitFor(() =>
      expect(readOutboxJobs()).toMatchObject([
        { sessionId: "draft-session", status: "queued" },
      ]),
    );
  });

  it("다시 보내기를 누르면 실패한 작업을 다시 보내고 미동기화 표시를 지운다", async () => {
    const fetchMock = stubFetch({ notionConnected: true });
    seedSessions([
      makeSavedSession("past-1", "미동기화 세션", "2026-09-20T03:00:00.000Z"),
    ]);
    seedOutbox([makeOutboxJob("past-1", "failed")]);
    seedDraft(makeDraft());
    const user = renderRoot();
    await waitForSessionScreen();

    await user.click(
      screen.getByRole("button", { name: "기록, Notion 미동기화 1건" }),
    );
    const sheet = await screen.findByRole("dialog");
    await user.click(
      within(sheet).getByRole("button", { name: "다시 보내기" }),
    );

    expect(
      await screen.findByText("Notion 동기화 요청 완료"),
    ).toBeInTheDocument();
    const calls = getEnqueueCalls(fetchMock);
    expect(calls).toHaveLength(1);
    expect(enqueueBody(calls[0])).toMatchObject({
      sessionId: "past-1",
      retryNo: 1,
    });
    expect(within(sheet).queryByText("노션 미동기화")).toBeNull();
    expect(readOutboxJobs()).toMatchObject([
      { sessionId: "past-1", status: "queued", retryCount: 1 },
    ]);
  });
});

describe("RootClient — Notion 연결 해제", () => {
  const libraryIsCached = (
    queryClient: ReturnType<typeof renderRootWithClient>["queryClient"],
  ) => queryClient.getQueryState(EXERCISE_LIBRARY_QUERY_KEY) !== undefined;

  async function openMenuAndDisconnect(user: ReturnType<typeof renderRoot>) {
    await user.click(screen.getByRole("button", { name: /설정/ }));
    await user.click(screen.getByRole("button", { name: "연결 해제" }));
  }

  it("연결 해제에 성공하면 캐시된 운동 라이브러리를 지운다", async () => {
    stubFetch({ notionConnected: true });
    seedDraft(makeDraft({ exercisePageId: "notion-page-1" }));
    const { user, queryClient } = renderRootWithClient();
    await waitForSessionScreen();
    queryClient.setQueryData(EXERCISE_LIBRARY_QUERY_KEY, { status: "empty" });
    expect(libraryIsCached(queryClient)).toBe(true);

    await openMenuAndDisconnect(user);

    expect(
      await screen.findByText("Notion 연결 해제 완료"),
    ).toBeInTheDocument();
    expect(libraryIsCached(queryClient)).toBe(false);
  });

  it("연결 해제 요청이 실패하면 캐시를 그대로 둔다", async () => {
    const fetchMock = stubFetch({
      notionConnected: true,
      disconnectStatus: 500,
    });
    seedDraft(makeDraft({ exercisePageId: "notion-page-1" }));
    const { user, queryClient } = renderRootWithClient();
    await waitForSessionScreen();
    queryClient.setQueryData(EXERCISE_LIBRARY_QUERY_KEY, { status: "empty" });

    await openMenuAndDisconnect(user);

    // 요청이 나가고 응답 처리(then)가 끝날 때까지 기다린 뒤 확인한다
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([input]) =>
          String(input).includes("/api/notion/disconnect"),
        ),
      ).toHaveLength(1),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.queryByText("Notion 연결 해제 완료")).not.toBeInTheDocument();
    expect(libraryIsCached(queryClient)).toBe(true);
  });
});

describe("RootClient — Notion 연결 상태와 운동 라이브러리", () => {
  const STATUS = "/api/notion/status";
  const READ = "/api/notion/exercise-read";

  it("연결 안 됨이면 라이브러리 진입 시 status를 한 번만 조회하고 미연동 안내를 보여준다", async () => {
    const fetchMock = stubFetch({ notionConnected: false });
    renderRoot();

    expect(await screen.findByText(/노션 미연동/)).toBeInTheDocument();
    expect(getCalls(fetchMock, STATUS)).toHaveLength(1);
    expect(getCalls(fetchMock, READ)).toHaveLength(0);
  });

  it("연결되어 있으면 status 1번 + exercise-read 1번으로 Notion 목록을 보여준다", async () => {
    const fetchMock = stubFetch({ notionConnected: true });
    renderRoot();

    expect(await screen.findByText("랫풀다운")).toBeInTheDocument();
    expect(
      screen.queryByText(/기본 운동 목록을 사용 중/),
    ).not.toBeInTheDocument();
    expect(getCalls(fetchMock, STATUS)).toHaveLength(1);
    expect(getCalls(fetchMock, READ)).toHaveLength(1);
  });

  it("status가 401(연결한 적 없음)이면 네트워크 문제가 아니라 미연동으로 안내한다", async () => {
    const fetchMock = stubFetch({ statusHttp: 401 });
    renderRoot();

    expect(await screen.findByText(/노션 미연동/)).toBeInTheDocument();
    expect(screen.queryByText(/네트워크 연결 없음/)).not.toBeInTheDocument();
    expect(getCalls(fetchMock, STATUS)).toHaveLength(1);
  });

  it("status가 서버 오류(500)이면 연결 안 됨이 아니라 확인 못 함으로 안내한다", async () => {
    const fetchMock = stubFetch({ statusHttp: 500 });
    renderRoot();

    expect(await screen.findByText(/네트워크 연결 없음/)).toBeInTheDocument();
    expect(getCalls(fetchMock, STATUS)).toHaveLength(1);
    expect(getCalls(fetchMock, READ)).toHaveLength(0);
  });

  it("status 조회가 네트워크 오류로 실패해도 한 번만 조회하고 확인 못 함으로 안내한다", async () => {
    const fetchMock = stubFetch({ statusThrows: true });
    renderRoot();

    expect(await screen.findByText(/네트워크 연결 없음/)).toBeInTheDocument();
    expect(getCalls(fetchMock, STATUS)).toHaveLength(1);
  });

  it("세션 화면에서 운동 추가 시트를 열고 닫고 다시 열어도 status·exercise-read를 더 부르지 않는다", async () => {
    const fetchMock = stubFetch({ notionConnected: true });
    seedDraft(makeDraft({ exercisePageId: "notion-page-1" }));
    const user = renderRoot();
    await waitForSessionScreen();
    expect(getCalls(fetchMock, STATUS)).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: /운동 추가/ }));
    expect(await screen.findByText("랫풀다운")).toBeInTheDocument();
    expect(getCalls(fetchMock, READ)).toHaveLength(1);

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByText("랫풀다운")).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: /운동 추가/ }));
    expect(await screen.findByText("랫풀다운")).toBeInTheDocument();

    expect(getCalls(fetchMock, STATUS)).toHaveLength(1);
    expect(getCalls(fetchMock, READ)).toHaveLength(1);
  });

  describe("연결 해제 뒤 상태 재확인", () => {
    const dotClass = () =>
      screen.getByRole("button", { name: /설정/ }).querySelector("span")
        ?.className ?? "";

    it.each([
      ["연결 안 됨 응답(200)", 200, "bg-red-500"],
      ["연결 정보 없음(401)", 401, "bg-red-500"],
      [
        "서버 오류(500) — 확인 못 했으므로 기존 상태를 덮어쓰지 않는다",
        500,
        "bg-green-500",
      ],
    ])(
      "재확인 결과가 %s이면 연결 표시를 올바르게 반영한다 (HTTP %i)",
      async (_name, http, expected) => {
        const fetchMock = stubFetch({
          notionConnected: true,
          statusHttpAfterDisconnect: http,
        });
        seedDraft(makeDraft({ exercisePageId: "notion-page-1" }));
        const user = renderRootWithClient().user;
        await waitForSessionScreen();
        expect(dotClass()).toContain("bg-green-500");

        await user.click(screen.getByRole("button", { name: /설정/ }));
        await user.click(screen.getByRole("button", { name: "연결 해제" }));

        // 연결 해제 뒤 status를 한 번 더 확인한 결과가 반영될 때까지 기다린다
        await waitFor(() =>
          expect(getCalls(fetchMock, STATUS)).toHaveLength(2),
        );
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(dotClass()).toContain(expected);
      },
    );
  });
});

describe("RootClient — Notion 기록으로 첫 세트 채우기", () => {
  const RECORDS = "/api/notion/workout-records";

  const readFirstSetWeight = () => {
    const draft: SessionDraft = JSON.parse(
      localStorage.getItem(DRAFT_KEY) ?? "null",
    );
    return draft.exercises[0].sets[0].weight;
  };

  it("연결되어 있으면 세션 화면에서 최근 기록을 첫 세트에 채운다", async () => {
    const fetchMock = stubFetch({
      notionConnected: true,
      workoutRecords: () => workoutRecordsResponse("notion-page-1", 80),
    });
    seedDraft(makeDraft({ exercisePageId: "notion-page-1", doneSets: 0 }));
    renderRoot();
    await waitForSessionScreen();

    await waitFor(() => expect(readFirstSetWeight()).toBe(80));
    expect(getCalls(fetchMock, RECORDS)).toHaveLength(1);
  });

  it("첫 세트를 이미 완료했다면 기록으로 덮어쓰지 않는다", async () => {
    const fetchMock = stubFetch({
      notionConnected: true,
      workoutRecords: () => workoutRecordsResponse("notion-page-1", 80),
    });
    seedDraft(makeDraft({ exercisePageId: "notion-page-1", doneSets: 1 }));
    renderRoot();
    await waitForSessionScreen();

    await waitFor(() => expect(getCalls(fetchMock, RECORDS)).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(readFirstSetWeight()).toBe(60);
  });

  it("세션이 바뀐 뒤 늦게 도착한 이전 세션의 응답은 적용하지 않는다", async () => {
    let resolveStale: (response: Response) => void = () => {};
    const fetchMock = stubFetch({
      notionConnected: true,
      workoutRecords: (callNumber) =>
        callNumber === 1
          ? new Promise<Response>((resolve) => {
              resolveStale = resolve;
            })
          : workoutRecordsResponse("notion-page-lat", 50),
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    seedDraft(makeDraft({ exercisePageId: "notion-page-lat", doneSets: 0 }));
    const user = renderRoot();
    await waitForSessionScreen();
    await waitFor(() => expect(getCalls(fetchMock, RECORDS)).toHaveLength(1));

    // 첫 응답이 오기 전에 새 세션을 시작하고 같은 운동을 다시 고른다
    await user.click(screen.getByRole("button", { name: "새 세션" }));
    await user.click(await screen.findByText("랫풀다운", { exact: true }));
    await user.click(screen.getByRole("button", { name: "선택 완료 (1)" }));
    await waitForSessionScreen();
    await waitFor(() => expect(readFirstSetWeight()).toBe(50));
    expect(getCalls(fetchMock, RECORDS)).toHaveLength(2);

    // 이전 세션의 응답이 뒤늦게 도착한다
    resolveStale(workoutRecordsResponse("notion-page-lat", 80));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(readFirstSetWeight()).toBe(50);
  });

  it("세션을 떠나면 진행 중이던 기록 요청을 취소한다", async () => {
    const fetchMock = stubFetch({
      notionConnected: true,
      workoutRecords: () => new Promise<Response>(() => {}),
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    seedDraft(makeDraft({ exercisePageId: "notion-page-1" }));
    const user = renderRoot();
    await waitForSessionScreen();
    await waitFor(() => expect(getCalls(fetchMock, RECORDS)).toHaveLength(1));
    const requestSignal = getCalls(fetchMock, RECORDS)[0][1]?.signal;
    expect(requestSignal?.aborted).toBe(false);

    await user.click(screen.getByRole("button", { name: "새 세션" }));
    await screen.findByRole("heading", { name: "운동 라이브러리" });

    expect(requestSignal?.aborted).toBe(true);
  });
});
