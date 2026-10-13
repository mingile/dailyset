import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "@/components/ui/sonner";
import { NOTION_OUTBOX_KEY } from "@/lib/notion-outbox";
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
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubFetch({
  notionConnected = false,
  enqueueStatus = 200,
}: FetchOptions = {}) {
  // init은 쓰지 않지만 mock.calls의 타입에 요청 옵션(body)이 포함되도록 선언한다
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/notion/status")) {
        return jsonResponse({ notionConnected, dbConnected: notionConnected });
      }
      if (url.includes("/api/sync/enqueue")) {
        return enqueueStatus === 200
          ? jsonResponse({ ok: true })
          : jsonResponse({ error: "queue unavailable" }, enqueueStatus);
      }
      if (url.includes("/api/sync/status")) return jsonResponse({ jobs: [] });
      if (url.includes("/api/notion/workout-records")) {
        return jsonResponse({ results: [] });
      }
      throw new Error(`stub되지 않은 요청: ${url}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function getEnqueueCalls(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls.filter(([input]) =>
    String(input).includes("/api/sync/enqueue"),
  );
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

function renderRoot() {
  const user = userEvent.setup();
  render(
    <>
      <RootClient />
      <Toaster position="top-center" />
    </>,
  );
  return user;
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

  it("세션 삭제를 누르면 목록과 저장소에서 사라진다", async () => {
    stubFetch();
    seedSessions([
      makeSavedSession("past-1", "지울 세션", "2026-09-20T03:00:00.000Z"),
      makeSavedSession("past-2", "남길 세션", "2026-09-19T03:00:00.000Z"),
    ]);
    seedDraft(makeDraft());
    const user = renderRoot();
    await waitForSessionScreen();
    const sheet = await openHistorySheet(user);

    const target = within(sheet)
      .getByText("지울 세션")
      .closest("div.border-b") as HTMLElement;
    await user.click(within(target).getByTitle("세션 삭제"));

    await waitFor(() =>
      expect(within(sheet).queryByText("지울 세션")).toBeNull(),
    );
    expect(within(sheet).getByText("남길 세션")).toBeInTheDocument();
    expect(readSessions().map((s) => s.id)).toEqual(["past-2"]);
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
