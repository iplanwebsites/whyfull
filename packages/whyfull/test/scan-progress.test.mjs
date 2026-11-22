import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { ScanProgressTracker } from "../dist/index.mjs"

const sample = (elapsedMs, completed, discovered, extra = {}) => ({
  elapsedMs,
  status: "scanning",
  discoveredDirectories: discovered,
  completedDirectories: completed,
  files: completed * 10,
  bytes: completed * 4096,
  activeWorkers: 2,
  currentPath: "/fixture/large-folder",
  ...extra,
})
function draining(tracker) {
  let result
  for (let seconds = 0; seconds <= 6; seconds++)
    result = tracker.update(
      sample(seconds * 1000, seconds * 100, 1000 + seconds * 20)
    )
  return result
}

test("a growing frontier has no misleading overall percentage, even with half of known folders checked", () => {
  const tracker = new ScanProgressTracker()
  for (let seconds = 0; seconds < 20; seconds++) {
    const result = tracker.update(
      sample(seconds * 1000, seconds * 100, seconds * 200 + 1)
    )
    assert.equal(result.percent, null)
    assert.equal(result.remainingMs, null)
    assert.equal(result.phase, "discovering")
  }
})

test("a consistently draining frontier produces a work estimate and a coarse time range", () => {
  const tracker = new ScanProgressTracker()
  const result = draining(tracker)
  assert.equal(result.phase, "estimating")
  assert.ok(result.percent > 0 && result.percent < 100)
  assert.ok(result.remainingMs.min > 0)
  assert.ok(result.remainingMs.max > result.remainingMs.min)
  assert.equal(result.filesPerSecond, 1000)
  assert.equal(result.pendingDirectories, 520)
  assert.equal(result.currentPath, "/fixture/large-folder")
  const next = tracker.update(sample(7000, 700, 1140))
  assert.ok(next.percent > result.percent)
  assert.ok(next.remainingMs.max < result.remainingMs.max)
})

test("late discovery revokes an estimate immediately and can later recover", () => {
  const tracker = new ScanProgressTracker()
  assert.equal(draining(tracker).phase, "estimating")
  const burst = tracker.update(sample(7000, 700, 5000))
  assert.equal(burst.phase, "discovering")
  assert.equal(burst.percent, null)
  assert.equal(burst.remainingMs, null)
  let recovered
  for (let seconds = 8; seconds <= 20; seconds++)
    recovered = tracker.update(
      sample(seconds * 1000, seconds * 100, 5000 + (seconds - 7) * 20)
    )
  assert.equal(recovered.phase, "estimating")
  assert.ok(recovered.percent < 100)
})

test("an indefinitely deeper tree never reports a nearly complete scan", () => {
  const tracker = new ScanProgressTracker()
  for (let seconds = 0; seconds < 100; seconds++) {
    const progress = tracker.update(
      sample(seconds * 1000, seconds, seconds + 1)
    )
    assert.equal(progress.percent, null)
    assert.equal(progress.remainingMs, null)
  }
})

test("slow folders withdraw a stale ETA, distinguish file activity from no new results, and never fake completion", () => {
  const tracker = new ScanProgressTracker()
  draining(tracker)
  for (let seconds = 7; seconds <= 11; seconds++) {
    const reading = tracker.update(
      sample(seconds * 1000, 600, 1120, { files: seconds * 1000 })
    )
    if (seconds >= 10) {
      assert.equal(reading.phase, "reading")
      assert.equal(reading.percent, null)
      assert.equal(reading.remainingMs, null)
      assert.equal(reading.lastActivityAgoMs, 0)
    }
  }
  let waiting
  for (let seconds = 12; seconds <= 18; seconds++)
    waiting = tracker.update(
      sample(seconds * 1000, 600, 1120, { files: 11000 })
    )
  assert.equal(waiting.phase, "waiting")
  assert.ok(waiting.lastActivityAgoMs >= 6000)
  assert.equal(waiting.percent, null)
})

test("only a completed scan reaches 100%; cancellations and failures have no ETA", () => {
  for (const status of ["cancelled", "failed", "complete"]) {
    const tracker = new ScanProgressTracker()
    draining(tracker)
    const progress = tracker.update(
      sample(7000, 700, 1140, { status, activeWorkers: 0 })
    )
    assert.equal(progress.percent, status === "complete" ? 100 : null)
    assert.equal(progress.phase, status === "complete" ? "complete" : "stopped")
    assert.equal(progress.remainingMs, null)
  }
})

test("delayed progress callbacks cannot produce a NaN percentage or remaining time", () => {
  const tracker = new ScanProgressTracker()
  tracker.update(sample(0, 0, 1000))
  const result = tracker.update(sample(9000, 800, 1100))
  assert.equal(result.percent, null)
  assert.equal(result.remainingMs, null)
})

test("worker activity while enumerating only subfolders is not mistaken for a stalled filesystem", () => {
  const tracker = new ScanProgressTracker()
  let progress
  for (let seconds = 0; seconds <= 10; seconds++)
    progress = tracker.update(
      sample(seconds * 1000, 0, 1, {
        files: 0,
        lastWorkerActivityMs: seconds * 1000,
      })
    )
  assert.equal(progress.phase, "reading")
  assert.equal(progress.lastActivityAgoMs, 0)
  assert.equal(progress.percent, null)
})

test("large-directory activity is reported before that directory finishes without double-counting files or bytes", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "whyfull-progress-"))
  const root = join(temporary, "scan")
  mkdirSync(root)
  for (let i = 0; i < 160; i++)
    writeFileSync(join(root, `file-${i}`), "fixture")
  const preload = join(temporary, "slow-metadata.cjs")
  // Simulate slow metadata in an isolated process and its worker.
  writeFileSync(
    preload,
    `
    const fs = require('node:fs');
    const original = fs.lstatSync;
    const pause = new Int32Array(new SharedArrayBuffer(4));
    fs.lstatSync = (...args) => { Atomics.wait(pause, 0, 0, 7); return original(...args); };
    require('node:module').syncBuiltinESMExports();
  `
  )
  try {
    const runner = join(temporary, "run.mjs")
    writeFileSync(
      runner,
      `
      import { DiskScanner } from ${JSON.stringify(new URL("../dist/index.mjs", import.meta.url).href)};
      const scanner = new DiskScanner({root: ${JSON.stringify(root)}, workers: 1});
      let activityBeforeCompletion = false;
      scanner.on('progress', () => {
        if (scanner.scanProgress.completedDirectories === 0 && scanner.scanProgress.files > 0)
          activityBeforeCompletion = true;
      });
      const snapshot = await scanner.run();
      console.log(JSON.stringify({activityBeforeCompletion, progress: scanner.scanProgress,
        files: snapshot.files, bytes: snapshot.directories[0].bytes}));
    `
    )
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ["--require", preload, runner],
      { timeout: 15000 }
    )
    const result = JSON.parse(stdout)
    assert.equal(result.activityBeforeCompletion, true)
    assert.equal(result.files, 160)
    assert.equal(result.progress.files, result.files)
    assert.equal(result.progress.bytes, result.bytes)
    assert.equal(result.progress.pendingDirectories, 0)
    assert.equal(result.progress.percent, 100)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})

test("rerun completion stays visible during discovery and uses actual folders checked", async () => {
  const { ScanCompletionEstimate } = await import("../dist/index.mjs")
  const estimate = new ScanCompletionEstimate(1000)
  const tracker = new ScanProgressTracker()
  assert.deepEqual(estimate.update(tracker.update(sample(3000, 830, 900))), {
    percent: 83,
    estimateBasis: "history",
  })
  assert.deepEqual(estimate.update(tracker.update(sample(4000, 850, 2000))), {
    percent: 42,
    estimateBasis: "history",
  })
  assert.equal(
    estimate.update(tracker.update(sample(5000, 2000, 2000))).percent,
    99
  )
  assert.equal(
    estimate.update(
      tracker.update(sample(6000, 2000, 2000, { status: "complete" }))
    ).percent,
    100
  )
})

test("a first scan retains its last available estimate instead of reverting to an empty status", async () => {
  const { ScanCompletionEstimate } = await import("../dist/index.mjs")
  const estimate = new ScanCompletionEstimate()
  const tracker = new ScanProgressTracker()
  assert.equal(
    estimate.update(tracker.update(sample(0, 0, 1000))).percent,
    null
  )
  const stable = draining(tracker)
  assert.equal(estimate.update(stable).estimateBasis, "live")
  const discovery = tracker.update(sample(7000, 700, 5000))
  assert.equal(discovery.percent, null)
  assert.deepEqual(estimate.update(discovery), {
    percent: stable.percent,
    estimateBasis: "previous",
  })
  assert.equal(
    estimate.update(
      tracker.update(sample(8000, 700, 5000, { status: "cancelled" }))
    ).percent,
    null
  )
})
