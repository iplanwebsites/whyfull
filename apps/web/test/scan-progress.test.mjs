import test from "node:test"
import assert from "node:assert/strict"
import {
  historicalScanTiming,
  elapsedLabel,
  remainingLabel,
  scanUpdatesAreLate,
  diskSpaceCoverage,
} from "../src/lib/scan-progress.ts"

test("disk coverage compares found bytes with system-used space, rather than free or total capacity", () => {
  assert.deepEqual(diskSpaceCoverage(250, 1000), { percent: 25, barValue: 25 })
  assert.deepEqual(diskSpaceCoverage(0, 1000), { percent: 0, barValue: 0 })
})

test("unavailable disk usage stays indeterminate and overlapping allocation is not hidden", () => {
  for (const used of [null, undefined, 0, -1, NaN, Infinity])
    assert.equal(diskSpaceCoverage(250, used), null)
  assert.equal(diskSpaceCoverage(NaN, 1000), null)
  assert.deepEqual(diskSpaceCoverage(1200, 1000), {
    percent: 120,
    barValue: 100,
  })
})

test("missing server updates withdraw progress after six seconds and recover with a fresh sample", () => {
  assert.equal(scanUpdatesAreLate(1000, 6999), false)
  assert.equal(scanUpdatesAreLate(1000, 7000), true)
  assert.equal(scanUpdatesAreLate(1000, 20000), true)
  assert.equal(scanUpdatesAreLate(19500, 20000), false)
  assert.equal(scanUpdatesAreLate(undefined, 20000), false)
})

test("elapsed time stays readable through long scans", () => {
  assert.equal(elapsedLabel(59000), "59s")
  assert.equal(elapsedLabel(61000), "1m 1s")
  assert.equal(elapsedLabel(3661000), "1h 1m")
})

test("remaining time is rounded into a range rather than a precise countdown", () => {
  assert.equal(remainingLabel({ min: 10100, max: 19100 }), "≈ 10–20s left")
  assert.equal(remainingLabel({ min: 65000, max: 140000 }), "≈ 1–3m left")
  assert.equal(remainingLabel({ min: 100, max: 500 }), "≈ 5s left")
})

test("rerun timing uses the previous full scan as an explicitly approximate baseline", () => {
  assert.equal(
    historicalScanTiming(300000, 180000, true),
    "Last scan took 5 min · Running for 3 min · About 2 min remaining"
  )
  assert.equal(historicalScanTiming(300000, 0, false), "Last scan took 5 min")
  assert.equal(
    historicalScanTiming(300000, 300000, true),
    "Last scan took 5 min · Running for 5 min · Taking longer than last time"
  )
  assert.equal(
    historicalScanTiming(300000, 420000, true),
    "Last scan took 5 min · Running for 7 min · Taking longer than last time"
  )
})

test("missing history and delayed updates never invent a remaining duration", () => {
  for (const previous of [null, undefined, 0, -1, NaN, Infinity]) {
    assert.equal(
      historicalScanTiming(previous, 180000, true),
      "Running for 3 min"
    )
    assert.equal(historicalScanTiming(previous, 0, false), "")
  }
  assert.equal(
    historicalScanTiming(300000, 180000, true, true),
    "Last scan took 5 min · Running for 3 min · Waiting for scan updates"
  )
  assert.equal(
    historicalScanTiming(5000, 0, true),
    "Last scan took 5 sec · Running for less than 1 sec · About 5 sec remaining"
  )
})

test("displayed scan estimates never move backwards and give up after a large regression", async () => {
  const { steadyPercent } = await import("../src/lib/scan-progress.ts")
  let track = steadyPercent(null, "a", 20)
  assert.equal(track.shown, 20)
  track = steadyPercent(track, "a", 48)
  assert.equal(track.shown, 48)
  track = steadyPercent(track, "a", 46)
  assert.equal(track.shown, 48, "small dips hold the previous value")
  track = steadyPercent(track, "a", null)
  assert.equal(track.shown, 48)
  track = steadyPercent(track, "a", 24)
  assert.equal(track.unreliable, true)
  assert.equal(track.shown, null)
  track = steadyPercent(track, "a", 30)
  assert.equal(track.shown, null, "an unreliable estimate stays hidden")
  track = steadyPercent(track, "b", 5)
  assert.deepEqual(track, { key: "b", shown: 5, unreliable: false })
})
