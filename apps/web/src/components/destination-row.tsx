import { useId } from "react"
import { Check, Square } from "lucide-react"
import { DropdownMenuItem } from "@workspace/ui/components/dropdown-menu"
import type { ScanDrive } from "@/lib/api"
import { DriveCapacity } from "./drive-capacity"
import { ScanTimingText } from "./scan-timing"
import { ScanActivity } from "./scan-activity"

/** Opening and stopping are sibling menu actions, never nested buttons. */
export function DestinationRow({
  destination,
  home = false,
  selected,
  disabled,
  stopping,
  updatedAt,
  onChoose,
  onStop,
}: {
  destination: ScanDrive
  home?: boolean
  selected: boolean
  disabled: boolean
  stopping: boolean
  updatedAt: number
  onChoose: () => void
  onStop: () => void
}) {
  const detailsId = useId()
  const scan = destination.scan
  const running = scan?.status === "scanning"
  const details = !!scan && !running && !!scan.lastCompletedAt
  const name = home ? "Home" : destination.name
  return (
    <div className="group/drive relative rounded-md hover:bg-accent">
      <DropdownMenuItem
        disabled={disabled}
        onClick={onChoose}
        aria-label={`${scan ? "Open" : "Scan"} ${name}`}
        aria-describedby={details ? detailsId : undefined}
        title={destination.id}
        className="block py-2.5"
      >
        <DriveCapacity
          name={name}
          home={home}
          directory={destination.kind === "directory"}
          compact
          volume={destination.volume}
          trailing={
            <>
              {selected && <Check className="size-3" />}
              <span>
                {running
                  ? scan.lastCompletedAt
                    ? "Saved results"
                    : ""
                  : scan?.status === "complete"
                    ? "Ready"
                    : scan?.status === "cancelled"
                      ? "Stopped"
                      : scan
                        ? "Failed"
                        : "Scan"}
              </span>
            </>
          }
        />
        {details && (
          <div
            id={detailsId}
            className="mt-1.5 pl-6 text-[11px] leading-relaxed text-muted-foreground"
          >
            <ScanTimingText
              running={running}
              previousDurationMs={scan.lastDurationMs}
              completedAt={scan.lastCompletedAt}
              elapsedMs={scan.progress?.elapsedMs ?? 0}
              lastUpdatedAt={updatedAt}
              compactIdle
              stacked
            />
          </div>
        )}
      </DropdownMenuItem>
      {running && (
        <div className="mx-2 mb-2 border-l pl-3">
          <ScanActivity
            compact
            progress={scan.progress}
            usedBytes={scan.progress?.usedBytes ?? destination.volume?.used}
            lastUpdatedAt={updatedAt}
            previousDurationMs={scan.lastDurationMs}
            refreshing={!!scan.lastCompletedAt}
            stopControl={
              scan.canCancel ? (
                <DropdownMenuItem
                  render={<button type="button" />}
                  nativeButton
                  disabled={disabled || stopping}
                  closeOnClick={false}
                  onClick={onStop}
                  aria-label={`Stop scan for ${name}`}
                  className="gap-1.5 rounded-md px-2 py-1.5 text-xs"
                >
                  <Square className="size-3" />
                  Stop scan
                </DropdownMenuItem>
              ) : undefined
            }
          />
        </div>
      )}
    </div>
  )
}
