// production 빌드 산출물(distDir)에서 route별 First Load 크기를 집계한다.
// 사용: NEXT_DIST_DIR=.next-perf-bundle npm run build 후
//   node scripts/perf/measure-bundle.mjs --dist .next-perf-bundle [--out result.json]
import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const dist = path.resolve(arg("dist", ".next"));
const out = arg("out");

const appManifest = JSON.parse(
  readFileSync(path.join(dist, "app-build-manifest.json"), "utf8"),
);

const sizeCache = new Map();
function fileSizes(file) {
  if (!sizeCache.has(file)) {
    const full = path.join(dist, file);
    const raw = statSync(full).size;
    const gzip = gzipSync(readFileSync(full), { level: 9 }).length;
    sizeCache.set(file, { raw, gzip });
  }
  return sizeCache.get(file);
}

function sum(files, filter) {
  return files.filter(filter).reduce(
    (acc, file) => {
      const { raw, gzip } = fileSizes(file);
      return {
        raw: acc.raw + raw,
        gzip: acc.gzip + gzip,
        files: acc.files + 1,
      };
    },
    { raw: 0, gzip: 0, files: 0 },
  );
}

const isJs = (f) => f.endsWith(".js");
const isCss = (f) => f.endsWith(".css");

// route(page) 하나가 처음 로드하는 파일 = 해당 page의 manifest 항목(layout 청크 포함).
// nomodule polyfill은 제외한다. js gzip 합이 `next build` 표의 First Load JS와 같은 정의다(css는 별도 열).
const routes = {};
for (const [page, files] of Object.entries(appManifest.pages)) {
  const all = [...new Set(files)];
  routes[page] = {
    js: sum(all, isJs),
    css: sum(all, isCss),
    total: sum(all, () => true),
  };
}

const allStatic = Object.values(appManifest.pages).flat();
const result = {
  dist,
  routes,
  allClientFiles: {
    js: sum([...new Set(allStatic)], isJs),
    css: sum([...new Set(allStatic)], isCss),
  },
};

const kb = (n) => `${(n / 1000).toFixed(1)} kB`;
console.log(
  "route".padEnd(28),
  "files",
  "js gzip",
  "css gzip",
  "total gzip",
  "total raw",
);
for (const [page, r] of Object.entries(routes)) {
  console.log(
    page.padEnd(28),
    String(r.total.files).padStart(5),
    kb(r.js.gzip).padStart(9),
    kb(r.css.gzip).padStart(9),
    kb(r.total.gzip).padStart(11),
    kb(r.total.raw).padStart(10),
  );
}

if (out) writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
