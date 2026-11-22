import { useEffect, useState } from "react"
import type { ViewerStatus } from "@/lib/api"
import {
  historicalScanTiming,
  relativeScanTime,
  scanUpdatesAreLate,
} from "@/lib/scan-progress"

/** The displayed complete snapshot is also the baseline for its replacement. */
export function ScanTiming({
  status,
  lastUpdatedAt,
}: {
  status: ViewerStatus
  lastUpdatedAt: number
}) {
  return (
    <ScanTimingText
      running={status.status === "scanning" || !!status.cache?.refreshing}
      previousDurationMs={
        status.status === "complete" ? status.durationMs : null
      }
      completedAt={status.status === "complete" ? status.completedAt : null}
      elapsedMs={status.progress?.elapsedMs ?? 0}
      lastUpdatedAt={lastUpdatedAt}
    />
  )
}

export function ScanTimingText({
  running,
  previousDurationMs,
  completedAt,
  elapsedMs,
  lastUpdatedAt,
  compactIdle = false,
  stacked = false,
}: {
  running: boolean
  previousDurationMs: number | null
  completedAt: string | null
  elapsedMs: number
  lastUpdatedAt: number
  compactIdle?: boolean
  stacked?: boolean
}) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), running ? 1000 : 30000)
    return () => clearInterval(timer)
  }, [running])
  const elapsed = elapsedMs + (running ? Math.max(0, now - lastUpdatedAt) : 0)
  const age = relativeScanTime(completedAt, now)
  if (stacked && running) {
    const history = historicalScanTiming(
      previousDurationMs,
      0,
      false,
      false,
      age
    )
    return (
      <span>
        <span className="block text-foreground/80">
          {historicalScanTiming(
            previousDurationMs,
            elapsed,
            true,
            scanUpdatesAreLate(lastUpdatedAt, now),
            undefined,
            false
          )}
        </span>
        {history && (
          <span
            className="mt-0.5 block"
            title={
              completedAt ? new Date(completedAt).toLocaleString() : undefined
            }
          >
            {history}
          </span>
        )}
      </span>
    )
  }
  return (
    <span
      title={completedAt ? new Date(completedAt).toLocaleString() : undefined}
    >
      {compactIdle && !running && age
        ? `Last scan ${age}`
        : historicalScanTiming(
            previousDurationMs,
            elapsed,
            running,
            running && scanUpdatesAreLate(lastUpdatedAt, now),
            age
          )}
    </span>
  )
}
