import type { ReactNode } from "react"
import { HardDrive, House, FolderOpen } from "lucide-react"
import { diskUsage } from "@/lib/destinations"
import { formatSize } from "@/lib/format-size"
import type { ViewerStatus } from "@/lib/api"

/** The same identity/capacity hierarchy in the picker and the scan screen. */
export function DriveCapacity({
  name,
  volume,
  compact = false,
  home = false,
  directory = false,
  trailing,
}: {
  name: string
  volume: ViewerStatus["volume"]
  compact?: boolean
  home?: boolean
  directory?: boolean
  trailing?: ReactNode
}) {
  const usage = diskUsage(volume)
  const Icon = directory ? FolderOpen : home ? House : HardDrive
  return (
    <div
      className={
        compact
          ? "flex w-full min-w-0 items-center gap-2.5 text-left"
          : "flex items-center gap-4 rounded-2xl border bg-muted/20 p-5 text-left"
      }
    >
      <div
        className={
          compact
            ? "shrink-0 text-muted-foreground"
            : "grid size-14 shrink-0 place-items-center rounded-xl border bg-background shadow-sm"
        }
        aria-hidden="true"
      >
        <Icon
          className={compact ? "size-4" : "size-7 text-muted-foreground"}
          strokeWidth={1.5}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span
            className={`truncate font-medium ${compact ? "text-sm" : "text-base"}`}
          >
            {name}
          </span>
          {usage && volume && (
            <span
              className={`shrink-0 text-muted-foreground tabular-nums ${compact ? "text-[11px]" : "text-xs"}`}
            >
              · {formatSize(volume.total)}
            </span>
          )}
        </div>
        <div
          className={`mt-1 flex flex-wrap items-baseline gap-x-1.5 text-muted-foreground tabular-nums ${compact ? "text-[11px]" : "text-xs"}`}
        >
          {usage && volume ? (
            <>
              <span className={usage.full ? "text-destructive" : ""}>
                {usage.label}
              </span>
              <span aria-hidden="true">·</span>
              <span>{formatSize(volume.free)} free</span>
            </>
          ) : (
            <span>
              {directory ? "Folder scan" : "Disk capacity unavailable"}
            </span>
          )}
        </div>
        {!compact && usage && volume && (
          <div
            role="meter"
            aria-label={`${name} disk usage`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={usage.percent}
            aria-valuetext={`${usage.label}, ${formatSize(volume.free)} free`}
            className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <div
              className={`h-full rounded-full ${usage.full ? "bg-destructive" : "bg-foreground/60"}`}
              style={{ width: `${usage.percent}%` }}
            />
          </div>
        )}
      </div>
      {trailing && (
        <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
          {trailing}
        </div>
      )}
    </div>
  )
}
