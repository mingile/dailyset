// Webpack profiling 빌드용 React 렌더 측정 v2.
// measure-render.mjs 와 달리 commit 단위로 기록해서 (1) 1초 타이머 tick commit을 분리하고
// (2) action 스텝별 commit과 그 commit에서 렌더된 컴포넌트/Row를 연결한다.
// interaction(Event Timing / Long Task)은 측정하지 않는다 — 그 baseline은 Turbopack + measure-render.mjs 가 맡는다.
// 사용: node scripts/perf/measure-render-commits.mjs --base http://127.0.0.1:3101/dailyset \
//         [--runs 5] [--throttle 4] [--scenario toggle-done] [--label baseline-v2] [--out result.json] [--log]
import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { buildDraft, buildSessions, SEED_SUMMARY } from "./seed.mjs";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const base = arg("base", "http://127.0.0.1:3101/dailyset");
const runs = Number(arg("runs", "5"));
const throttle = Number(arg("throttle", "4"));
const only = arg("scenario");
const label = arg("label", "");
const out = arg("out");
const printLog = process.argv.includes("--log");

const TICK_PERIOD_MS = 1000;
const TICK_TOLERANCE_MS = 60;
const SETTLE_MS = 1000;

const EXERCISE_NAMES = ["벤치프레스", "랫풀다운", "레그프레스", "숄더프레스"];

const openExercise = (n) => async (page) => {
  await page
    .locator("button[aria-expanded]")
    .filter({ hasText: EXERCISE_NAMES[n - 1] })
    .first()
    .click();
};

const toggleDone = (set) => async (page) => {
  await page.getByRole("checkbox", { name: `세트 ${set} 완료` }).click();
};

const editWeight = (set, value) => async (page) => {
  await page
    .getByRole("button", { name: `세트 ${set} 무게`, exact: true })
    .click();
  const input = page.getByRole("textbox", {
    name: `세트 ${set} 무게`,
    exact: true,
  });
  await input.fill(value);
  await input.press("Enter");
};

const addSet = async (page) => {
  await page.getByRole("button", { name: "세트 추가" }).click();
};

const openYesterday = async (page) => {
  await page
    .locator('div.overflow-x-auto button[aria-current="date"]')
    .locator("xpath=preceding-sibling::button[1]")
    .click();
};

// target(step, rowId): 해당 스텝의 조작 대상 Row 인가. 대상이 아닌 Row가 렌더되면 nonTargetRowRenders 로 센다.
// Row id 는 `Row:{운동 index}:{세트 index}` (0-based). 시드는 운동당 세트 5개.
const SCENARIOS = [
  { id: "load", measureLoad: true, target: () => false },
  {
    id: "toggle-done",
    setup: [openExercise(1)],
    act: [toggleDone(1), toggleDone(2), toggleDone(3)],
    target: (step, id) => id === `Row:0:${step}`,
  },
  {
    id: "edit-weight",
    setup: [openExercise(1)],
    act: [editWeight(1, "65"), editWeight(2, "67.5"), editWeight(3, "70")],
    target: (step, id) => id === `Row:0:${step}`,
  },
  {
    id: "add-set",
    setup: [openExercise(1)],
    act: [addSet, addSet, addSet],
    target: (step, id) => id === `Row:0:${5 + step}`,
  },
  {
    id: "switch-exercise",
    setup: [openExercise(1)],
    act: [openExercise(2), openExercise(3)],
    target: (step, id) => id.startsWith(`Row:${step + 1}:`),
  },
  { id: "open-history", setup: [], act: [openYesterday], target: () => false },
];

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function installPage(context) {
  await context.addInitScript(
    ({ draft, sessions }) => {
      localStorage.setItem("pwa.installPrompt.dismissed.v1", "true");
      localStorage.setItem("workout.currentSession.v1", JSON.stringify(draft));
      localStorage.setItem("workout.sessions.v1", JSON.stringify(sessions));
      window.__PERF_RENDERS__ = [];
      window.__PERF_MARKS__ = [];
    },
    { draft: buildDraft(), sessions: buildSessions() },
  );
}

async function mockApi(context) {
  await context.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    const body = url.pathname.endsWith("/notion/status")
      ? { notionConnected: false, dbConnected: false }
      : { results: [], data: [] };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

const mark = (page, step) =>
  page.evaluate((s) => {
    window.__PERF_MARKS__.push({ step: s, t: performance.now() });
  }, step);

// ---- commit 단위 분석 ----------------------------------------------------

// 같은 commitTime 을 가진 onRender 호출은 한 commit 이다.
function groupCommits(renders) {
  const byTime = new Map();
  for (const r of renders) {
    if (!byTime.has(r.commitTime)) byTime.set(r.commitTime, []);
    byTime.get(r.commitTime).push(r);
  }
  return [...byTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, rs]) => ({ t, renders: rs, ids: new Set(rs.map((r) => r.id)) }));
}

// tick 후보 시그니처: Row 없이 RootClient + (HeaderControls 하나 | WorkoutSessionClient 하나)만 호출된 commit.
// HeaderControls 는 SessionClock, WorkoutSessionClient 는 ExerciseElapsedTime 의 1초 tick 이 만든다.
function tickSignature(commit) {
  const ids = [...commit.ids];
  if (ids.some((id) => id.startsWith("Row:"))) return null;
  const mids = ids.filter((id) => id !== "RootClient");
  if (mids.length === 1 && (mids[0] === "HeaderControls" || mids[0] === "WorkoutSessionClient")) {
    return mids[0];
  }
  return null;
}

// tick: 시그니처가 맞고, 같은 시그니처의 다른 commit 과 1000±60ms 간격이 있다.
// ambiguous: 시그니처는 맞지만 주기 근거가 없다(조용히 분류하지 않고 따로 센다).
// action: 그 외 모두.
function classify(commits) {
  const candidates = { HeaderControls: [], WorkoutSessionClient: [] };
  for (const c of commits) {
    c.sig = tickSignature(c);
    if (c.sig) candidates[c.sig].push(c);
  }
  for (const list of Object.values(candidates)) {
    for (const c of list) {
      const periodic = list.some(
        (d) => d !== c && Math.abs(Math.abs(d.t - c.t) - TICK_PERIOD_MS) <= TICK_TOLERANCE_MS,
      );
      c.kind = periodic ? "tick" : "ambiguous";
    }
  }
  for (const c of commits) c.kind ??= "action";
}

function addTo(map, id, ms) {
  map[id] ??= { count: 0, ms: 0 };
  map[id].count += 1;
  map[id].ms += ms;
}

function analyze(renders, marks, scenario) {
  const commits = groupCommits(renders);
  classify(commits);

  const numericMarks = marks.filter((m) => typeof m.step === "number");
  const end = marks.find((m) => m.step === "end").t;
  const start = scenario.measureLoad ? Number.NEGATIVE_INFINITY : numericMarks[0].t;
  const stepCount = scenario.measureLoad ? 1 : scenario.act.length;
  const stepOf = (t) => {
    let step = 0;
    for (const m of numericMarks) if (m.t <= t) step = m.step;
    return step;
  };

  const perStep = Array.from({ length: stepCount }, () => ({
    actionCommits: 0,
    rowRenders: 0,
    targetRowRenders: 0,
    nonTargetRowRenders: 0,
    rowMs: 0,
    byId: {},
  }));
  const total = {
    windowCommits: 0,
    actionCommits: 0,
    tickSessionClock: 0,
    tickExerciseElapsed: 0,
    ambiguous: 0,
    rowRenders: 0,
    nonTargetRowRenders: 0,
    rowMs: 0,
    byId: {},
  };
  const legacy = { commits: 0, rowRenders: 0, rowMs: 0 };
  const commitLog = [];
  const t0 = Number.isFinite(start) ? start : commits[0]?.t ?? 0;

  for (const c of commits) {
    if (c.t < start || c.t > end) continue;
    total.windowCommits += 1;
    legacy.commits += 1;
    const step = scenario.measureLoad ? 0 : stepOf(c.t);
    for (const r of c.renders) {
      if (r.id.startsWith("Row:")) {
        legacy.rowRenders += 1;
        legacy.rowMs += r.actualDuration;
      }
    }
    if (c.kind === "tick") {
      if (c.sig === "HeaderControls") total.tickSessionClock += 1;
      else total.tickExerciseElapsed += 1;
    } else if (c.kind === "ambiguous") {
      total.ambiguous += 1;
    } else {
      total.actionCommits += 1;
      const s = perStep[step];
      s.actionCommits += 1;
      for (const r of c.renders) {
        if (r.id.startsWith("Row:")) {
          const isTarget = scenario.target(step, r.id);
          s.rowRenders += 1;
          s.rowMs += r.actualDuration;
          total.rowRenders += 1;
          total.rowMs += r.actualDuration;
          if (isTarget) s.targetRowRenders += 1;
          else {
            s.nonTargetRowRenders += 1;
            total.nonTargetRowRenders += 1;
          }
        } else {
          addTo(s.byId, r.id, r.actualDuration);
          addTo(total.byId, r.id, r.actualDuration);
        }
      }
    }
    commitLog.push({
      step,
      tMs: Math.round(c.t - t0),
      kind: c.kind,
      components: Object.fromEntries(
        c.renders.filter((r) => !r.id.startsWith("Row:")).map((r) => [r.id, Number(r.actualDuration.toFixed(2))]),
      ),
      rows: c.renders
        .filter((r) => r.id.startsWith("Row:"))
        .map((r) => [r.id, r.phase, Number(r.actualDuration.toFixed(2))]),
    });
  }
  return { windowMs: Math.round(end - (Number.isFinite(start) ? start : t0)), ...total, legacy, perStep, commitLog };
}

async function runScenario(browser, scenario) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await installPage(context);
    await mockApi(context);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });

    await page.goto(`${base}/app`);
    await page.getByText(EXERCISE_NAMES[0], { exact: true }).first().waitFor();
    await page.waitForTimeout(SETTLE_MS);

    if (!scenario.measureLoad) {
      for (const step of scenario.setup ?? []) {
        await step(page);
        await page.waitForTimeout(300);
      }
      await page.waitForTimeout(SETTLE_MS);
      for (let i = 0; i < scenario.act.length; i++) {
        await mark(page, i);
        await scenario.act[i](page);
        await page.waitForTimeout(300);
      }
      await page.waitForTimeout(SETTLE_MS);
    }
    await mark(page, "end");
    const { renders, marks } = await page.evaluate(() => ({
      renders: window.__PERF_RENDERS__ ?? [],
      marks: window.__PERF_MARKS__ ?? [],
    }));
    return analyze(renders, marks, scenario);
  } finally {
    await context.close();
  }
}

function summarize(runResults) {
  const med = (f) => median(runResults.map(f));
  const ids = new Set(runResults.flatMap((r) => Object.keys(r.byId)));
  const byId = {};
  for (const id of ids) {
    byId[id] = {
      count: med((r) => r.byId[id]?.count ?? 0),
      ms: med((r) => r.byId[id]?.ms ?? 0),
    };
  }
  const stepCount = runResults[0].perStep.length;
  const perStep = Array.from({ length: stepCount }, (_, k) => {
    const sids = new Set(runResults.flatMap((r) => Object.keys(r.perStep[k].byId)));
    const sById = {};
    for (const id of sids) {
      sById[id] = {
        count: med((r) => r.perStep[k].byId[id]?.count ?? 0),
        ms: med((r) => r.perStep[k].byId[id]?.ms ?? 0),
      };
    }
    return {
      actionCommits: med((r) => r.perStep[k].actionCommits),
      rowRenders: med((r) => r.perStep[k].rowRenders),
      targetRowRenders: med((r) => r.perStep[k].targetRowRenders),
      nonTargetRowRenders: med((r) => r.perStep[k].nonTargetRowRenders),
      rowMs: med((r) => r.perStep[k].rowMs),
      byId: sById,
    };
  });
  return {
    windowMs: med((r) => r.windowMs),
    windowCommits: med((r) => r.windowCommits),
    actionCommits: med((r) => r.actionCommits),
    tickSessionClock: med((r) => r.tickSessionClock),
    tickExerciseElapsed: med((r) => r.tickExerciseElapsed),
    ambiguous: med((r) => r.ambiguous),
    rowRenders: med((r) => r.rowRenders),
    nonTargetRowRenders: med((r) => r.nonTargetRowRenders),
    rowMs: med((r) => r.rowMs),
    byId,
    perStep,
    legacy: {
      commits: med((r) => r.legacy.commits),
      rowRenders: med((r) => r.legacy.rowRenders),
      rowMs: med((r) => r.legacy.rowMs),
    },
  };
}

const browser = await chromium.launch();
const results = [];
try {
  for (const scenario of SCENARIOS) {
    if (only && scenario.id !== only) continue;
    const runResults = [];
    for (let i = 0; i < runs; i++) runResults.push(await runScenario(browser, scenario));
    results.push({ scenario: scenario.id, runs: runResults });
  }
} finally {
  await browser.close();
}

const report = {
  label,
  base,
  runs,
  throttle,
  seed: SEED_SUMMARY,
  tickRule: {
    signature: "no Row:*, ids = RootClient + exactly one of HeaderControls | WorkoutSessionClient",
    periodMs: TICK_PERIOD_MS,
    toleranceMs: TICK_TOLERANCE_MS,
  },
  scenarios: results.map((r) => ({
    scenario: r.scenario,
    median: summarize(r.runs),
    runs: r.runs,
  })),
};

const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
console.log(`label=${label || "-"} base=${base} runs=${runs} cpuThrottle=${throttle}x seed=${JSON.stringify(SEED_SUMMARY)}`);
console.log(
  "scenario".padEnd(16),
  "window".padStart(7),
  "all".padStart(4),
  "action".padStart(7),
  "tickSC".padStart(7),
  "tickEE".padStart(7),
  "ambig".padStart(6),
  "rows".padStart(5),
  "nonTgt".padStart(7),
  "rowMs".padStart(6),
);
for (const s of report.scenarios) {
  const m = s.median;
  console.log(
    s.scenario.padEnd(16),
    fmt(m.windowMs).padStart(7),
    fmt(m.windowCommits).padStart(4),
    fmt(m.actionCommits).padStart(7),
    fmt(m.tickSessionClock).padStart(7),
    fmt(m.tickExerciseElapsed).padStart(7),
    fmt(m.ambiguous).padStart(6),
    fmt(m.rowRenders).padStart(5),
    fmt(m.nonTargetRowRenders).padStart(7),
    fmt(m.rowMs).padStart(6),
  );
  m.perStep.forEach((p, k) => {
    const comps = Object.entries(p.byId).map(([id, v]) => `${id} ${fmt(v.count)}/${fmt(v.ms)}`).join(" ");
    console.log(
      "   step",
      k,
      `actionCommits=${fmt(p.actionCommits)} rows=${fmt(p.rowRenders)} (target ${fmt(p.targetRowRenders)}, nonTarget ${fmt(p.nonTargetRowRenders)}) |`,
      comps,
    );
  });
}
if (printLog) {
  for (const s of report.scenarios) {
    console.log(`\n-- commit log, ${s.scenario}, run 1`);
    for (const c of s.runs[0].commitLog) {
      const comps = Object.entries(c.components).map(([k, v]) => `${k}:${v}`).join(" ");
      console.log(`  step ${c.step} +${String(c.tMs).padStart(5)}ms ${c.kind.padEnd(9)} ${comps} rows=${c.rows.length}${c.rows.length ? ` [${c.rows.map((r) => `${r[0].slice(4)}${r[1] === "mount" ? "m" : ""}`).join(",")}]` : ""}`);
    }
  }
}

if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
