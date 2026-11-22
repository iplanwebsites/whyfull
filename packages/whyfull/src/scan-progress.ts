import type { DiskSnapshot } from "./filesystem-types"

export interface ScanProgressSample {
  elapsedMs: number
  status: DiskSnapshot["status"]
  discoveredDirectories: number
  completedDirectories: number
  files: number
  bytes: number
  activeWorkers: number
  currentPath: string | null
  lastWorkerActivityMs?: number
}

export interface ScanProgress extends ScanProgressSample {
  phase:
    | "discovering"
    | "estimating"
    | "reading"
    | "finalizing"
    | "waiting"
    | "complete"
    | "stopped"
  pendingDirectories: number
  percent: number | null
  estimateBasis?: "history" | "live" | "previous"
  remainingMs: { min: number; max: number } | null
  filesPerSecond: number | null
  directoriesPerSecond: number | null
  lastActivityAgoMs: number
}

/** Estimate traversal work, not bytes: a huge file needs one metadata lookup.
 * Stay indeterminate until both halves of a recent window drain the frontier.
 * A discovery burst or slow directory revokes the estimate instead of pinning 99%.
 */
export class ScanProgressTracker {
  private samples: ScanProgressSample[] = []
  private lastActivityMs = 0
  private lastDirectoryMs = 0

  update(sample: ScanProgressSample): ScanProgress {
    const previous = this.samples.at(-1)
    if (
      !previous ||
      sample.files !== previous.files ||
      sample.completedDirectories !== previous.completedDirectories ||
      sample.discoveredDirectories !== previous.discoveredDirectories
    )
      this.lastActivityMs = sample.elapsedMs
    this.lastActivityMs = Math.max(
      this.lastActivityMs,
      sample.lastWorkerActivityMs ?? 0
    )
    if (
      !previous ||
      sample.completedDirectories !== previous.completedDirectories
    )
      this.lastDirectoryMs = sample.elapsedMs
    // Bound memory even when a consumer samples more often than the scanner.
    if (!previous || sample.elapsedMs - previous.elapsedMs >= 250)
      this.samples.push(sample)
    while (
      this.samples.length > 1 &&
      this.samples[1].elapsedMs < sample.elapsedMs - 10000
    )
      this.samples.shift()
    const oldest = this.samples[0]
    const seconds = (sample.elapsedMs - oldest.elapsedMs) / 1000
    const pending = Math.max(
      0,
      sample.discoveredDirectories - sample.completedDirectories
    )
    const directoryRate =
      seconds > 0
        ? (sample.completedDirectories - oldest.completedDirectories) / seconds
        : 0
    const fileRate = seconds > 0 ? (sample.files - oldest.files) / seconds : 0
    const idleMs = Math.max(0, sample.elapsedMs - this.lastActivityMs)
    const reading = sample.elapsedMs - this.lastDirectoryMs >= 4000
    const result: ScanProgress = {
      ...sample,
      phase:
        sample.status === "complete"
          ? "complete"
          : sample.status !== "scanning"
            ? "stopped"
            : idleMs >= 6000
              ? "waiting"
              : reading
                ? "reading"
                : "discovering",
      pendingDirectories: pending,
      percent: sample.status === "complete" ? 100 : null,
      remainingMs: null,
      filesPerSecond: seconds >= 1 ? Math.max(0, fileRate) : null,
      directoriesPerSecond: seconds >= 1 ? Math.max(0, directoryRate) : null,
      lastActivityAgoMs: idleMs,
    }
    if (
      sample.status !== "scanning" ||
      seconds < 6 ||
      pending === 0 ||
      reading ||
      !sample.activeWorkers
    )
      return result
    const midpoint = this.samples.find(
      (s) => s.elapsedMs >= (oldest.elapsedMs + sample.elapsedMs) / 2
    )!
    // A delayed timer can leave too few observations to estimate either half.
    if (
      midpoint.elapsedMs - oldest.elapsedMs < 1000 ||
      sample.elapsedMs - midpoint.elapsedMs < 1000
    )
      return result
    const drainRate = (from: ScanProgressSample, to: ScanProgressSample) =>
      ((to.completedDirectories -
        from.completedDirectories -
        (to.discoveredDirectories - from.discoveredDirectories)) *
        1000) /
      (to.elapsedMs - from.elapsedMs)
    const rates = [drainRate(oldest, midpoint), drainRate(midpoint, sample)]
    const slow = Math.min(...rates),
      fast = Math.max(...rates)
    // New work in any recent interval can invalidate an otherwise rosy window.
    const recent = this.samples.filter(
      (s) => s.elapsedMs >= sample.elapsedMs - 2000
    )
    if (
      slow <= 0 ||
      slow / fast < 0.5 ||
      recent.some(
        (s, i) =>
          i > 0 &&
          s.discoveredDirectories - s.completedDirectories >
            recent[i - 1].discoveredDirectories -
              recent[i - 1].completedDirectories
      )
    )
      return result
    const netRate = drainRate(oldest, sample)
    // Observed new children per completed folder predict further undiscovered work.
    const estimatedRemaining = pending * Math.max(1, directoryRate / netRate)
    result.phase = "estimating"
    result.percent = Math.min(
      99,
      Math.floor(
        (sample.completedDirectories /
          (sample.completedDirectories + estimatedRemaining)) *
          100
      )
    )
    result.remainingMs = {
      min: (pending / (fast * 1.2)) * 1000,
      max: (pending / (slow * 0.8)) * 1000,
    }
    return result
  }
}

/** Keep a visible estimate between live estimates. A completed inventory gives
 * reruns a baseline even while the traversal frontier is still growing. */
export class ScanCompletionEstimate {
  private lastPercent: number | null = null
  constructor(private previousDirectories: number | null = null) {}

  update(
    progress: ScanProgress
  ): Pick<ScanProgress, "percent" | "estimateBasis"> {
    if (progress.status !== "scanning")
      return { percent: progress.status === "complete" ? 100 : null }
    if (this.previousDirectories !== null && this.previousDirectories > 0) {
      const total = Math.max(
        this.previousDirectories,
        progress.discoveredDirectories
      )
      const percent = Math.max(
        0,
        Math.min(99, Math.floor((progress.completedDirectories / total) * 100))
      )
      this.lastPercent = percent
      return { percent, estimateBasis: "history" }
    }
    if (progress.percent !== null) {
      this.lastPercent = progress.percent
      return { percent: progress.percent, estimateBasis: "live" }
    }
    return {
      percent: this.lastPercent,
      ...(this.lastPercent !== null
        ? { estimateBasis: "previous" as const }
        : {}),
    }
  }
}
