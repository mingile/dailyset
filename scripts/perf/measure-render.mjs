// 렌더/interaction 측정. NEXT_PUBLIC_PERF_PROFILE=1 로 빌드한 서버를 대상으로 시나리오를 반복 실행한다.
// 사용: node scripts/perf/measure-render.mjs --base http://127.0.0.1:3101/dailyset \
//         [--runs 5] [--throttle 4] [--scenario toggle-done] [--label baseline] [--out result.json]
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

// setup은 측정 전에 실행하고, act만 측정한다. load는 페이지 진입부터 안정될 때까지를 측정한다.
const SCENARIOS = [
  { id: "load", measureLoad: true },
  {
    id: "toggle-done",
    setup: [openExercise(1)],
    act: [toggleDone(1), toggleDone(2), toggleDone(3)],
  },
  {
    id: "edit-weight",
    setup: [openExercise(1)],
    act: [editWeight(1, "65"), editWeight(2, "67.5"), editWeight(3, "70")],
  },
  { id: "add-set", setup: [openExercise(1)], act: [addSet, addSet, addSet] },
  {
    id: "switch-exercise",
    setup: [openExercise(1)],
    act: [openExercise(2), openExercise(3)],
  },
  { id: "open-history", setup: [], act: [openYesterday] },
];

const SETTLE_MS = 1000;

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function installObservers(context) {
  await context.addInitScript(
    ({ draft, sessions }) => {
      localStorage.setItem("pwa.installPrompt.dismissed.v1", "true");
      localStorage.setItem("workout.currentSession.v1", JSON.stringify(draft));
      localStorage.setItem("workout.sessions.v1", JSON.stringify(sessions));
      window.__PERF_RENDERS__ = [];
      window.__PERF_EVENTS__ = [];
      window.__PERF_LONGTASKS__ = [];
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            if (e.interactionId > 0) {
              window.__PERF_EVENTS__.push({
                name: e.name,
                interactionId: e.interactionId,
                duration: e.duration,
              });
            }
          }
        }).observe({ type: "event", durationThreshold: 16, buffered: true });
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            window.__PERF_LONGTASKS__.push({ duration: e.duration });
          }
        }).observe({ type: "longtask", buffered: true });
      } catch {}
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

async function resetRecords(page) {
  await page.evaluate(() => {
    window.__PERF_RENDERS__ = [];
    window.__PERF_EVENTS__ = [];
    window.__PERF_LONGTASKS__ = [];
  });
}

async function collect(page) {
  return page.evaluate(() => ({
    renders: window.__PERF_RENDERS__ ?? [],
    events: window.__PERF_EVENTS__ ?? [],
    longTasks: window.__PERF_LONGTASKS__ ?? [],
  }));
}

function summarizeRun({ renders, events, longTasks }) {
  const commits = new Set(renders.map((r) => r.commitTime)).size;
  const byId = {};
  let rowRenders = 0;
  let rowActualMs = 0;
  for (const r of renders) {
    if (r.id.startsWith("Row:")) {
      rowRenders += 1;
      rowActualMs += r.actualDuration;
      continue;
    }
    byId[r.id] ??= { count: 0, actualMs: 0 };
    byId[r.id].count += 1;
    byId[r.id].actualMs += r.actualDuration;
  }
  const perInteraction = new Map();
  for (const e of events) {
    perInteraction.set(
      e.interactionId,
      Math.max(perInteraction.get(e.interactionId) ?? 0, e.duration),
    );
  }
  const interactionMs = [...perInteraction.values()];
  return {
    commits,
    rowRenders,
    rowActualMs,
    byId,
    slowInteractions: interactionMs.length,
    maxInteractionMs: interactionMs.length ? Math.max(...interactionMs) : 0,
    longTaskCount: longTasks.length,
    longTaskMs: longTasks.reduce((sum, t) => sum + t.duration, 0),
  };
}

async function runScenario(browser, scenario) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  try {
    await installObservers(context);
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
      await resetRecords(page);
      for (const step of scenario.act) {
        await step(page);
        await page.waitForTimeout(300);
      }
      await page.waitForTimeout(SETTLE_MS);
    }
    return summarizeRun(await collect(page));
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch();
const results = [];
try {
  for (const scenario of SCENARIOS) {
    if (only && scenario.id !== only) continue;
    const runResults = [];
    for (let i = 0; i < runs; i++) {
      runResults.push(await runScenario(browser, scenario));
    }
    results.push({ scenario: scenario.id, runs: runResults });
  }
} finally {
  await browser.close();
}

function summarize(runResults) {
  const ids = new Set(runResults.flatMap((r) => Object.keys(r.byId)));
  const byId = {};
  for (const id of ids) {
    byId[id] = {
      count: median(runResults.map((r) => r.byId[id]?.count ?? 0)),
      actualMs: median(runResults.map((r) => r.byId[id]?.actualMs ?? 0)),
    };
  }
  return {
    commits: median(runResults.map((r) => r.commits)),
    rowRenders: median(runResults.map((r) => r.rowRenders)),
    rowActualMs: median(runResults.map((r) => r.rowActualMs)),
    maxInteractionMs: median(runResults.map((r) => r.maxInteractionMs)),
    longTaskCount: median(runResults.map((r) => r.longTaskCount)),
    longTaskMs: median(runResults.map((r) => r.longTaskMs)),
    byId,
  };
}

const report = {
  label,
  base,
  runs,
  throttle,
  seed: SEED_SUMMARY,
  scenarios: results.map((r) => ({
    scenario: r.scenario,
    median: summarize(r.runs),
    runs: r.runs,
  })),
};

const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
console.log(
  `label=${label || "-"} base=${base} runs=${runs} cpuThrottle=${throttle}x seed=${JSON.stringify(SEED_SUMMARY)}`,
);
console.log(
  "scenario".padEnd(18),
  "commits".padStart(8),
  "rowRenders".padStart(11),
  "rowMs".padStart(7),
  "maxInteractionMs".padStart(17),
  "longTasks".padStart(10),
  "  per-component renders (median count / actualMs)",
);
for (const s of report.scenarios) {
  const m = s.median;
  const comps = Object.entries(m.byId)
    .map(([id, v]) => `${id} ${fmt(v.count)}/${fmt(v.actualMs)}`)
    .join("  ");
  console.log(
    s.scenario.padEnd(18),
    fmt(m.commits).padStart(8),
    fmt(m.rowRenders).padStart(11),
    fmt(m.rowActualMs).padStart(7),
    fmt(m.maxInteractionMs).padStart(17),
    fmt(m.longTaskCount).padStart(10),
    " ",
    comps,
  );
}

if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
