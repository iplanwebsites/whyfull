/** Disk coverage is a byte ratio, independent of scan-time estimates. */
export function diskSpaceCoverage(
  foundBytes: number,
  usedBytes: number | null | undefined
) {
  if (
    !Number.isFinite(foundBytes) ||
    foundBytes < 0 ||
    usedBytes == null ||
    !Number.isFinite(usedBytes) ||
    usedBytes <= 0
  )
    return null
  const percent = (foundBytes / usedBytes) * 100
  if (!Number.isFinite(percent)) return null
  // Shared allocations and changing system usage can produce a ratio over 100%.
  return { percent, barValue: Math.min(100, percent) }
}

export function scanUpdatesAreLate(
  lastUpdatedAt: number | undefined,
  now: number
): boolean {
  return lastUpdatedAt !== undefined && now - lastUpdatedAt >= 6000
}

export function elapsedLabel(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  if (minutes < 1) return `${seconds}s`
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** Coarse ranges avoid pretending that traversal timing is precise. */
export function remainingLabel(range: { min: number; max: number }): string {
  const unit = range.max < 60000 ? 1000 : range.max < 3600000 ? 60000 : 3600000
  const step = unit === 1000 ? 5 : 1
  const lower = Math.max(step, Math.floor(range.min / unit / step) * step)
  const upper = Math.max(lower, Math.ceil(range.max / unit / step) * step)
  const suffix = unit === 1000 ? "s" : unit === 60000 ? "m" : "h"
  return `≈ ${lower === upper ? lower : `${lower}–${upper}`}${suffix} left`
}

function durationWords(
  ms: number,
  round: "nearest" | "down" | "up" = "nearest"
) {
  const rounding =
    round === "up" ? Math.ceil : round === "down" ? Math.floor : Math.round
  if (ms < 60000) return `${Math.max(1, rounding(ms / 1000))} sec`
  if (ms < 3600000) return `${Math.max(1, rounding(ms / 60000))} min`
  const minutes = rounding(ms / 60000)
  return `${Math.floor(minutes / 60)} hr${minutes % 60 ? ` ${minutes % 60} min` : ""}`
}

/** Friendly scan age, refreshed by the UI even while no scan is running. */
export function relativeScanTime(
  completedAt: string | null | undefined,
  now = Date.now()
): string | null {
  if (!completedAt || !Number.isFinite(now)) return null
  const completed = Date.parse(completedAt)
  if (!Number.isFinite(completed)) return null
  const seconds = Math.max(0, (now - completed) / 1000)
  if (seconds < 60) return "just now"
  const units: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [365 * 86400, "year"],
    [30 * 86400, "month"],
    [7 * 86400, "week"],
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
  ]
  const [size, unit] = units.find(([size]) => seconds >= size)!
  return new Intl.RelativeTimeFormat("en", { numeric: "always" }).format(
    -Math.floor(seconds / size),
    unit
  )
}

/** A previous full scan is a baseline, never a promise of completion. */
export function historicalScanTiming(
  previousDurationMs: number | null | undefined,
  elapsedMs: number,
  running: boolean,
  updatesLate = false,
  completedAgo?: string | null,
  showHistory = true
): string {
  const previous =
    previousDurationMs != null &&
    Number.isFinite(previousDurationMs) &&
    previousDurationMs > 0
      ? previousDurationMs
      : null
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0
  const parts = showHistory && completedAgo ? [`Last scan ${completedAgo}`] : []
  if (showHistory && previous !== null)
    parts.push(
      `${completedAgo ? "Took" : "Last scan took"} ${durationWords(previous)}`
    )
  if (!running) return parts.join(" · ")
  parts.push(
    `Running for ${elapsed < 1000 ? "less than 1 sec" : durationWords(elapsed, "down")}`
  )
  if (updatesLate) parts.push("Waiting for scan updates")
  else if (previous !== null) {
    if (elapsed >= previous) parts.push("Taking longer than last time")
    else
      parts.push(`About ${durationWords(previous - elapsed, "up")} remaining`)
  }
  return parts.join(" · ")
}

export interface SteadyPercent {
  key: string
  shown: number | null
  unreliable: boolean
}

/**
 * Scan estimates can swing on large drives. The displayed value never moves
 * backwards: small dips hold the previous value, and a large drop marks the
 * estimate unreliable so the UI falls back to an indeterminate bar for the
 * rest of that scan.
 */
export function steadyPercent(
  previous: SteadyPercent | null,
  key: string,
  next: number | null | undefined,
  tolerance = 5
): SteadyPercent {
  const value =
    next != null && Number.isFinite(next)
      ? Math.min(100, Math.max(0, next))
      : null
  if (!previous || previous.key !== key)
    return { key, shown: value, unreliable: false }
  if (previous.unreliable || value === null) return previous
  if (previous.shown !== null && value < previous.shown - tolerance)
    return { key, shown: null, unreliable: true }
  return {
    key,
    shown: Math.max(previous.shown ?? 0, value),
    unreliable: false,
  }
}
