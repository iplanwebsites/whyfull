// Publish aggregate results; filenames from the inventory remain private.
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { createRequire } from "node:module"
const [source, destination] = process.argv.slice(2)
if (!destination)
  throw new Error(
    "Usage: node summarize-shared.mjs BENCHMARK_DIRECTORY EXISTING_RESULTS_DIRECTORY"
  )
const report = JSON.parse(readFileSync(join(source, "report.json"), "utf8"))
if (
  report.status !== "complete" ||
  report.results.length !== 4 ||
  report.results.some((r) => r.integrity !== "ok" || r.exit.code !== 0)
)
  throw new Error("Four completed verified runs are required")
const coverage = JSON.parse(
  readFileSync(join(source, "coverage.json"), "utf8")
).summary
const coverageFirstPair = existsSync(join(source, "coverage-pair-1.json"))
  ? JSON.parse(readFileSync(join(source, "coverage-pair-1.json"), "utf8"))
      .summary
  : null
const mean = (rows, get) =>
  rows.reduce((sum, row) => sum + get(row), 0) / rows.length
const averages = Object.fromEntries(
  ["node", "rust"].map((scanner) => {
    const rows = report.results.filter((r) => r.scanner === scanner)
    return [
      scanner,
      {
        runs: rows.length,
        endToEndSeconds: mean(rows, (r) => r.timings.endToEndMs) / 1000,
        crawlSeconds: mean(rows, (r) => r.timings.crawlMs) / 1000,
        aggregationSeconds: mean(rows, (r) => r.timings.aggregationMs) / 1000,
        indexingSeconds: mean(rows, (r) => r.timings.indexingMs) / 1000,
        finalizeSeconds: mean(rows, (r) => r.timings.finalizeMs) / 1000,
        peakSampledTreeRssMiB: mean(rows, (r) => r.sampledPeakTreeRssMiB),
        cpuSeconds: mean(rows, (r) => r.cpu.userSeconds + r.cpu.sysSeconds),
      },
    ]
  })
)
const summary = {
  averages,
  rustElapsedReduction:
    1 - averages.rust.endToEndSeconds / averages.node.endToEndSeconds,
  rustPeakRssReduction:
    1 -
    averages.rust.peakSampledTreeRssMiB / averages.node.peakSampledTreeRssMiB,
  rustCpuReduction: 1 - averages.rust.cpuSeconds / averages.node.cpuSeconds,
}
const caveats = [
  "Two repetitions per scanner, live APFS drive, no cache purge or warmup. Other activity, changing file counts and existing swap pressure limit timing precision; this is not a universal speedup or cold-cache claim.",
  "A short 32 MiB fixture/lifecycle regression check overlapped the beginning of run 1. Full-drive scans did not overlap; broad tests and desktop builds were deferred until the timed sequence finished.",
  "The final Node pass recorded four extra error directories, all ENOENT (paths disappeared between enumeration and opening). Rust later found one file in one of them. Both adjacent pairs matched all 422 Rust directories with errors; no files were hidden behind a Rust-only unreadable directory.",
  "Both configurations use four workers, a 512 MiB main old-space setting, topFiles=32 and identical policies. Node workers also inherit the heap setting; Rust has no V8 heap.",
  "End-to-end timing includes the scan API through the same SQLite rollup, indexing, final checkpoint and atomic cache publication; it excludes JSON export and independent integrity checks. Process wall time includes process startup and those checks.",
  "RSS is sampled once a second across the scanner process tree, including the Rust helper or Node worker threads, and the small time wrapper. Short-lived peaks may be missed; Node OS high-water RSS is also retained. OS file cache and the browser/desktop process are outside this measurement.",
  "Both scanners share the SQLite schema and lifecycle; Node additionally writes its pending frontier to that database, while Rust uses its bounded queue/local DFS. This compares the implemented pipelines, not isolated language runtimes.",
]
writeFileSync(
  join(destination, "shared-storage-full-drive.json"),
  JSON.stringify(
    { ...report, summary, coverage, coverageFirstPair, caveats },
    null,
    2
  ) + "\n",
  { flag: "wx" }
)
const csv = ["run,scanner,workers,elapsed_ms,rss_kib,file_paths"],
  series = []
for (const run of report.results) {
  const points = readFileSync(
    join(source, `run-${run.run}.samples.jsonl`),
    "utf8"
  )
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))
  for (const p of points)
    csv.push(
      [
        run.run,
        run.scanner,
        4,
        p.elapsedMs,
        p.rssKiB,
        p.progress?.files ?? 0,
      ].join(",")
    )
  series.push({
    name: `${run.scanner === "rust" ? "Rust" : "Node"} + SQLite (run ${run.run})`,
    type: "line",
    showSymbol: false,
    data: points.map((p) => [p.elapsedMs / 1000, p.rssKiB / 1024]),
    lineStyle: {
      width: 2.5,
      type: run.run > 2 ? "dashed" : "solid",
      color: run.scanner === "rust" ? "#087f5b" : "#2563eb",
    },
    itemStyle: { color: run.scanner === "rust" ? "#087f5b" : "#2563eb" },
  })
}
writeFileSync(
  join(destination, "shared-storage-memory.csv"),
  csv.join("\n") + "\n",
  { flag: "wx" }
)
const require = createRequire(
    new URL("../../packages/whyfull/package.json", import.meta.url)
  ),
  echarts = require("echarts")
const chart = echarts.init(null, null, {
  renderer: "svg",
  ssr: true,
  width: 1050,
  height: 560,
})
chart.setOption({
  animation: false,
  backgroundColor: "#fff",
  title: {
    text: "Shared SQLite storage: full-drive scanner memory",
    subtext:
      "Four workers each · complete scanner process tree · aggregation and indexing included",
    left: 28,
    top: 18,
  },
  legend: {
    top: 78,
    left: 70,
    orient: "vertical",
    itemWidth: 32,
    textStyle: { fontSize: 12 },
  },
  grid: { left: 95, right: 35, top: 185, bottom: 88 },
  xAxis: {
    type: "value",
    name: "Elapsed time (seconds)",
    nameLocation: "middle",
    nameGap: 34,
    min: 0,
  },
  yAxis: {
    type: "value",
    name: "RSS (MiB)",
    min: 0,
    splitLine: { show: true },
  },
  series,
  graphic: [
    {
      type: "text",
      left: 28,
      bottom: 16,
      style: {
        text: "1-second samples. Node includes worker threads; Rust includes controller + helper. OS filesystem cache is separate.",
        fontSize: 12,
        fill: "#475569",
      },
    },
  ],
})
writeFileSync(
  join(destination, "shared-storage-memory.svg"),
  chart.renderToSVGString(),
  { flag: "wx" }
)
chart.dispose()
const fmt = (n) => n.toFixed(2)
const lines = [
  "# Shared SQLite full-drive comparison",
  "",
  `Scanned \`${report.root}\` with four workers per scanner, in R4 N4 N4 R4 order.`,
  "",
  "| Run | Scanner | Files | Crawl | Aggregate | Index | Finalize | End to end | Peak sampled RSS | CPU |",
  "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ...report.results.map(
    (r) =>
      `| ${r.run} | ${r.scanner} | ${r.files.toLocaleString("en-US")} | ${fmt(r.timings.crawlMs / 1000)} s | ${fmt(r.timings.aggregationMs / 1000)} s | ${fmt(r.timings.indexingMs / 1000)} s | ${fmt(r.timings.finalizeMs / 1000)} s | ${fmt(r.timings.endToEndMs / 1000)} s | ${fmt(r.sampledPeakTreeRssMiB)} MiB | ${fmt(r.cpu.userSeconds + r.cpu.sysSeconds)} s |`
  ),
  "",
  `Mean Rust elapsed reduction: **${fmt(summary.rustElapsedReduction * 100)}%**. Mean peak sampled RSS reduction: **${fmt(summary.rustPeakRssReduction * 100)}%**. Mean CPU reduction: **${fmt(summary.rustCpuReduction * 100)}%**.`,
  "",
  "All four inventories passed SQLite quick_check, independent root/direct-total checks, and final-index checks. Error-directory coverage audit:",
  "",
  "```json",
  JSON.stringify(coverage, null, 2),
  "```",
  "",
  "![Process-tree memory](shared-storage-memory.svg)",
  "",
  "Caveats:",
  "",
  ...caveats.map((c) => "- " + c),
  "",
  "[Raw aggregate results](shared-storage-full-drive.json) · [Memory samples](shared-storage-memory.csv)",
  "",
]
writeFileSync(
  join(destination, "shared-storage-full-drive.md"),
  lines.join("\n"),
  { flag: "wx" }
)
console.log(JSON.stringify({ summary, coverage, samples: csv.length - 1 }))
