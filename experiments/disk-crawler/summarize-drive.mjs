// Publish aggregate measurements and memory traces, never inventory paths.
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { createRequire } from "node:module"
const [directory, destination, exploratoryReport] = process.argv.slice(2)
if (!destination)
  throw new Error(
    "Usage: node experiments/disk-crawler/summarize-drive.mjs BENCHMARK_DIRECTORY EXISTING_RESULTS_DIRECTORY"
  )
const report = JSON.parse(readFileSync(join(directory, "report.json"), "utf8"))
const coverage = JSON.parse(
  readFileSync(join(directory, "coverage.json"), "utf8")
).summary
if (
  report.status !== "complete" ||
  report.results.some((r) => r.status !== "complete")
)
  throw new Error("Only completed benchmark sequences can be published")
const rust = report.results.filter((r) => r.engine === "rust")
const node = report.results.filter((r) => r.engine === "node-inventory")
const mean = (rows, key) => rows.reduce((s, r) => s + r[key], 0) / rows.length
const summary = {
  elapsedTimeReduction: 1 - mean(rust, "endToEndMs") / mean(node, "endToEndMs"),
  cpuTimeReduction: 1 - mean(rust, "cpuMs") / mean(node, "cpuMs"),
  peakRssReduction:
    1 - mean(rust, "peakRssUpperBoundKiB") / mean(node, "peakRssUpperBoundKiB"),
  peakRssFactor:
    mean(node, "peakRssUpperBoundKiB") / mean(rust, "peakRssUpperBoundKiB"),
}
const caveats = [
  "Two repetitions per configuration, live APFS volume, no cache purge. The volume gained about 489,000 file paths between adjacent pairs; use timing ranges, not a universal speedup claim.",
  "Node uses the current app default of eight workers; Rust uses four. Both Node runtimes have a 12 GiB old-space limit, topFiles=32, no custom exclusions, and persist their results.",
  "RSS covers scanner processes, not OS file caches or the full desktop application. Rust's OS figure sums the independent peaks of controller and helper; one-second simultaneous process-tree samples are also retained.",
  "A superseded 2.3 GiB exploratory export was unlinked during the first corrected Node pass to recover disk space. This maintenance and other background activity limit timing precision; the second Node pass has no such maintenance.",
  "Exploratory measurements before the EINTR retry fix are excluded. Unit tests inject an interruption mid-directory and verify that all entries remain available. Neither corrected Rust pass encountered an interruption (retry count zero).",
]
const integrityPath = join(directory, "integrity.json")
const integrity = existsSync(integrityPath)
  ? JSON.parse(readFileSync(integrityPath, "utf8"))
  : undefined
const reference = exploratoryReport
  ? JSON.parse(readFileSync(exploratoryReport, "utf8")).results.find(
      (r) =>
        r.engine === "node-inventory" &&
        r.workers === 4 &&
        r.status === "complete"
    )
  : undefined
const exploratoryNode4 = reference
  ? {
      ...reference,
      caveat:
        "One earlier run on the live volume, not part of the balanced corrected sequence and not included in the mean comparisons.",
    }
  : undefined
writeFileSync(
  join(destination, "full-drive.json"),
  JSON.stringify(
    { ...report, summary, coverage, caveats, integrity, exploratoryNode4 },
    null,
    2
  ) + "\n",
  { flag: "wx" }
)
const rows = ["run,engine,workers,elapsed_ms,rss_kib,file_paths"]
const series = []
for (const result of report.results) {
  let files = 0
  const data = []
  for (const line of readFileSync(
    join(directory, `run-${result.run}.samples.jsonl`),
    "utf8"
  )
    .trim()
    .split("\n")) {
    const point = JSON.parse(line)
    if (Number.isFinite(point.progress?.files)) files = point.progress.files
    rows.push(
      [
        result.run,
        result.engine,
        result.workers,
        point.elapsedMs,
        point.rssKiB,
        files,
      ].join(",")
    )
    if (point.rssKiB > 0) data.push([files / 1e6, point.rssKiB / 1024])
  }
  series.push({
    name: `${result.engine === "rust" ? "Rust + SQLite, 4 workers" : "Node inventory, 8 workers"} (run ${result.run})`,
    type: "line",
    data,
    showSymbol: false,
    lineStyle: {
      width: 2.5,
      type: result.run > 2 ? "dashed" : "solid",
      color: result.engine === "rust" ? "#087f5b" : "#2563eb",
    },
    itemStyle: { color: result.engine === "rust" ? "#087f5b" : "#2563eb" },
  })
}
writeFileSync(
  join(destination, "full-drive-memory.csv"),
  rows.join("\n") + "\n",
  { flag: "wx" }
)
const require = createRequire(
  new URL("../../packages/whyfull/package.json", import.meta.url)
)
const echarts = require("echarts")
const chart = echarts.init(null, null, {
  renderer: "svg",
  ssr: true,
  width: 1050,
  height: 580,
})
chart.setOption({
  animation: false,
  backgroundColor: "#fff",
  title: {
    text: "Full-drive scanner memory",
    subtext:
      "27.97–28.46 million file paths · measured scanner process-tree RSS · logarithmic memory axis",
    left: 28,
    top: 18,
  },
  legend: {
    top: 80,
    left: 70,
    orient: "vertical",
    itemWidth: 32,
    textStyle: { fontSize: 12 },
  },
  grid: { left: 96, right: 34, top: 195, bottom: 86 },
  xAxis: {
    type: "value",
    name: "File paths processed (millions)",
    nameLocation: "middle",
    nameGap: 36,
    min: 0,
    max: 30,
    interval: 5,
  },
  yAxis: {
    type: "log",
    logBase: 2,
    min: 32,
    max: 8192,
    axisLabel: {
      formatter: (v) => (v >= 1024 ? `${v / 1024} GiB` : `${v} MiB`),
    },
    splitLine: { show: true },
  },
  series,
  graphic: [
    {
      type: "text",
      left: 28,
      bottom: 14,
      style: {
        text: "1-second samples; Node includes worker threads. Rust includes Node controller + native helper. OS file cache is separate.",
        fontSize: 12,
        fill: "#475569",
      },
    },
  ],
})
writeFileSync(
  join(destination, "full-drive-memory.svg"),
  chart.renderToSVGString(),
  { flag: "wx" }
)
chart.dispose()
console.log(JSON.stringify({ summary, coverage, samples: rows.length - 1 }))
