import { useEffect, useState } from "react"
import type { ReactNode } from "react"
import { Square } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Progress, ProgressLabel } from "@workspace/ui/components/progress"
import {
  diskSpaceCoverage,
  elapsedLabel,
  remainingLabel,
  scanUpdatesAreLate,
} from "@/lib/scan-progress"
import { formatCount, formatSize } from "@/lib/format-size"
import type { ViewerStatus } from "@/lib/api"

type ActivityProgress = Pick<
  NonNullable<ViewerStatus["progress"]>,
  "bytes" | "files" | "elapsedMs" | "remainingMs" | "phase"
>

/** Space coverage stays measurable even when traversal-time estimates change. */
export function ScanActivity({
  progress,
  usedBytes,
  lastUpdatedAt,
  previousDurationMs,
  refreshing = false,
  busy = false,
  onStop,
  compact = false,
  stopControl,
}: {
  progress: ActivityProgress | null
  usedBytes?: number | null
  lastUpdatedAt?: number
  previousDurationMs?: number | null
  refreshing?: boolean
  busy?: boolean
  onStop?: () => void
  compact?: boolean
  stopControl?: ReactNode
}) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const late = scanUpdatesAreLate(lastUpdatedAt, now)
  const elapsed =
    (progress?.elapsedMs ?? 0) +
    (lastUpdatedAt === undefined ? 0 : Math.max(0, now - lastUpdatedAt))
  const coverage = diskSpaceCoverage(progress?.bytes ?? 0, usedBytes)
  const historicalRemaining =
    previousDurationMs != null && previousDurationMs > elapsed
      ? { min: previousDurationMs - elapsed, max: previousDurationMs - elapsed }
      : null
  const remaining =
    late || progress?.phase === "finalizing"
      ? null
      : (progress?.remainingMs ?? historicalRemaining)
  return (
    <section
      aria-label="Scan activity"
      className={`scan-progress rounded-xl border bg-muted/20 ${compact ? "p-3" : "p-4"}`}
      data-indeterminate={!coverage || undefined}
    >
      <div className="flex items-center justify-between gap-3">
        <p role="status" className="text-sm font-medium">
          {late
            ? "Waiting for scan updates"
            : progress?.phase === "finalizing"
              ? "Preparing results"
              : progress?.phase === "waiting"
                ? "Waiting for a folder"
                : refreshing
                  ? "Updating scan"
                  : "Scanning"}
        </p>
        {stopControl ??
          (onStop && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={onStop}>
              <Square className="size-3" />
              Stop scan
            </Button>
          ))}
      </div>
      <Progress
        className="mt-3 gap-2"
        value={coverage?.barValue ?? null}
        aria-label="Used disk space found"
        aria-valuetext={
          coverage
            ? `${Math.round(coverage.percent)} percent of used disk space found`
            : "Disk usage unavailable"
        }
      >
        <ProgressLabel
          className="text-xs font-normal text-muted-foreground"
          title="Space found ÷ used space on the drive. Folder scans, exclusions, and unreadable files lower it; shared blocks can raise it."
        >
          {formatSize(progress?.bytes ?? 0)}
          {coverage && usedBytes != null
            ? ` of ${formatSize(usedBytes)} used space found`
            : " found"}
        </ProgressLabel>
        {coverage && (
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {Math.round(coverage.percent)}%
          </span>
        )}
      </Progress>
      <div className="mt-3 flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
        <span>
          {formatCount(progress?.files ?? 0)} files · {elapsedLabel(elapsed)}{" "}
          elapsed
        </span>
        <span>
          {remaining
            ? remainingLabel(remaining)
            : late || progress?.phase === "finalizing"
              ? ""
              : "Estimating time left…"}
        </span>
      </div>
    </section>
  )
}
