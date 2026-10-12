/**
 * 운동 완료 시 사용자 대기 시간 비교: 동기 방식 vs 큐 방식 (세트 N개 기준)
 *
 * - 동기 방식: 큐 도입 전 클라이언트 흐름 그대로
 *     POST /api/notion/session-ensure → POST /api/notion/write
 *   두 요청이 끝날 때까지가 사용자가 기다리던 시간.
 * - 큐 방식: 현재 흐름
 *     POST /api/sync/enqueue
 *   이 요청이 끝날 때까지가 사용자가 기다리는 시간.
 *   추가로, 노션에 세트가 모두 들어올 때까지의 백그라운드 처리 시간도 폴링으로 잰다.
 *
 * 실행 후 [BENCH] 세션과 그 세트는 노션에서 보관(archive) 처리한다.
 *
 * 실행:
 *   node --env-file=.env.local scripts/bench-notion-sync.mjs
 * 환경변수(선택):
 *   BASE_URL  기본 https://daily.mingile.com/dailyset
 *   USER_KEY  기본: connections_info에 연결이 1개면 그것을 사용
 *   RUNS      방식별 반복 횟수, 기본 3
 *   SETS      세트 수, 기본 20 (운동 5개에 나눠 담음)
 */
import { MongoClient } from "mongodb";

const BASE_URL = (process.env.BASE_URL ?? "https://daily.mingile.com/dailyset").replace(/\/$/, "");
const RUNS = Number(process.env.RUNS ?? 3);
const SETS = Number(process.env.SETS ?? 20);
const EXERCISE_COUNT = 5;
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 180_000;
const NOTION_VERSION = "2022-06-28";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ---------- Mongo: 노션 연결 정보 ----------
async function loadConnection() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI 없음 (.env.local 확인)");
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const col = client.db("notion").collection("connections_info");
    let conn;
    if (process.env.USER_KEY) {
      conn = await col.findOne({ user_key: process.env.USER_KEY });
    } else {
      const all = await col.find({ access_token: { $exists: true } }).toArray();
      if (all.length !== 1) {
        console.log(`노션 연결이 ${all.length}개 있습니다. 측정할 user_key를 USER_KEY로 지정하세요.\n`);
        for (const c of all) {
          const dbs = ["workout_sets_db_id", "workout_session_db_id", "workout_exercise_db_id"]
            .map((k) => (c[k] ? "O" : "X"))
            .join("");
          const ts = c._id?.getTimestamp?.()?.toISOString?.() ?? "-";
          console.log(`  user_key=${c.user_key}  생성 ${ts}  DB(sets/session/exercise)=${dbs}`);
        }
        process.exit(1);
      }
      conn = all[0];
    }
    if (!conn?.access_token) throw new Error("노션 연결 정보를 찾지 못했습니다.");
    for (const k of ["workout_sets_db_id", "workout_session_db_id", "workout_exercise_db_id"]) {
      if (!conn[k]) throw new Error(`${k} 없음 — 노션 DB 연결을 먼저 완료하세요.`);
    }
    return conn;
  } finally {
    await client.close();
  }
}

// ---------- Notion 직접 호출 (준비·폴링·정리용, 측정 대상 아님) ----------
function notion(token) {
  return async (path, method = "GET", body) => {
    const res = await fetch(`https://api.notion.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Notion ${method} ${path} ${res.status}: ${JSON.stringify(data)}`);
    return data;
  };
}

async function findSessionPageId(n, sessionDbId, sessionId) {
  const data = await n(`/databases/${sessionDbId}/query`, "POST", {
    filter: { property: "Session ID", rich_text: { equals: sessionId } },
  });
  return data.results?.[0]?.id ?? null;
}

async function listSetPageIds(n, setsDbId, sessionPageId) {
  const ids = [];
  let cursor;
  do {
    const data = await n(`/databases/${setsDbId}/query`, "POST", {
      page_size: 100,
      filter: { property: "Session", relation: { contains: sessionPageId } },
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    ids.push(...data.results.map((p) => p.id));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return ids;
}

// ---------- 페이로드 ----------
function buildExercises(exercisePageIds) {
  const perExercise = Math.ceil(SETS / exercisePageIds.length);
  let remaining = SETS;
  return exercisePageIds.map((pageId, i) => {
    const count = Math.min(perExercise, remaining);
    remaining -= count;
    return {
      id: `bench-ex-${i}`,
      name: `[BENCH] Exercise ${i + 1}`,
      part: "기타",
      exercisePageId: pageId,
      sets: Array.from({ length: count }, (_, j) => ({
        setNo: j + 1,
        weight: 20,
        reps: 10,
        memo: "",
        equipment: "",
      })),
    };
  }).filter((e) => e.sets.length > 0);
}

async function post(path, cookie, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `user_key=${cookie}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

// ---------- 측정 ----------
async function runSync(userKey, exercises, tag) {
  const sessionId = `bench-sync-${tag}`;
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  const ensured = await post("/api/notion/session-ensure", userKey, {
    sessionId,
    sessionName: `[BENCH] sync ${tag}`,
    startedAt,
  });
  const result = await post("/api/notion/write", userKey, {
    saved_at: new Date().toISOString(),
    exercises,
    sessionPageId: ensured.pageId,
  });
  const waitMs = performance.now() - t0;
  return { sessionId, waitMs, created: result.created_count };
}

async function runQueue(userKey, exercises, tag, n, conn) {
  const sessionId = `bench-queue-${tag}`;
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  await post("/api/sync/enqueue", userKey, {
    sessionId,
    sessionName: `[BENCH] queue ${tag}`,
    startedAt,
    savedAt: new Date().toISOString(),
    exercises,
  });
  const waitMs = performance.now() - t0;

  // 백그라운드 처리 완료까지 폴링 (해상도 약 POLL_INTERVAL_MS)
  let backgroundMs = null;
  let count = 0;
  while (performance.now() - t0 < POLL_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);
    const pageId = await findSessionPageId(n, conn.workout_session_db_id, sessionId);
    if (!pageId) continue;
    count = (await listSetPageIds(n, conn.workout_sets_db_id, pageId)).length;
    if (count >= SETS) {
      backgroundMs = performance.now() - t0;
      break;
    }
  }
  return { sessionId, waitMs, backgroundMs, created: count };
}

async function cleanup(n, conn, sessionIds) {
  let archived = 0;
  for (const sessionId of sessionIds) {
    const pageId = await findSessionPageId(n, conn.workout_session_db_id, sessionId);
    if (!pageId) continue;
    for (const id of await listSetPageIds(n, conn.workout_sets_db_id, pageId)) {
      await n(`/pages/${id}`, "PATCH", { archived: true });
      archived++;
      await sleep(350); // 호출 제한(초당 약 3회) 회피
    }
    await n(`/pages/${pageId}`, "PATCH", { archived: true });
    archived++;
    await sleep(350);
  }
  return archived;
}

async function main() {
  const conn = await loadConnection();
  const userKey = conn.user_key;
  const n = notion(conn.access_token);

  const exData = await n(`/databases/${conn.workout_exercise_db_id}/query`, "POST", {
    page_size: EXERCISE_COUNT,
  });
  const exercisePageIds = exData.results.map((p) => p.id);
  if (exercisePageIds.length === 0) throw new Error("Exercise DB가 비어 있습니다.");
  const exercises = buildExercises(exercisePageIds);

  console.log(`BASE_URL=${BASE_URL}  세트 ${SETS}개 (운동 ${exercises.length}개)  방식별 ${RUNS}회\n`);

  const syncResults = [];
  const queueResults = [];
  const sessionIds = [];
  const stamp = Date.now();

  try {
    for (let i = 1; i <= RUNS; i++) {
      const s = await runSync(userKey, exercises, `${stamp}-${i}`);
      sessionIds.push(s.sessionId);
      syncResults.push(s);
      console.log(`[동기 ${i}] 대기 ${s.waitMs.toFixed(0)}ms (생성 ${s.created})`);

      const q = await runQueue(userKey, exercises, `${stamp}-${i}`, n, conn);
      sessionIds.push(q.sessionId);
      queueResults.push(q);
      console.log(
        `[큐   ${i}] 대기 ${q.waitMs.toFixed(0)}ms / 백그라운드 완료 ${
          q.backgroundMs === null ? `시간 초과(${q.created}/${SETS})` : `약 ${(q.backgroundMs / 1000).toFixed(1)}s`
        }`,
      );
    }

    const sw = syncResults.map((r) => r.waitMs);
    const qw = queueResults.map((r) => r.waitMs);
    const qb = queueResults.map((r) => r.backgroundMs).filter((x) => x !== null);
    console.log("\n=== 요약 (중앙값) ===");
    console.log(`동기 방식 사용자 대기: ${median(sw).toFixed(0)}ms  (각 회: ${sw.map((x) => x.toFixed(0)).join(", ")})`);
    console.log(`큐 방식 사용자 대기:   ${median(qw).toFixed(0)}ms  (각 회: ${qw.map((x) => x.toFixed(0)).join(", ")})`);
    if (qb.length) console.log(`큐 백그라운드 처리:   약 ${(median(qb) / 1000).toFixed(1)}s (폴링 간격 ${POLL_INTERVAL_MS / 1000}s 단위)`);
    console.log("※ 1회차에는 콜드 스타트가 포함될 수 있습니다.");
  } finally {
    console.log("\n정리 중... (노션 보관 처리)");
    const archived = await cleanup(n, conn, sessionIds);
    console.log(`보관 처리한 페이지: ${archived}개`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
