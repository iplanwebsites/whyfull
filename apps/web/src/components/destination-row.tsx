import { useId } from "react"
import { Check, LoaderCircle, Square } from "lucide-react"
import { DropdownMenuItem } from "@workspace/ui/components/dropdown-menu"
import type { ScanDrive } from "@/lib/api"
import { DriveCapacity } from "./drive-capacity"
import { ScanTimingText } from "./scan-timing"

function DestinationScan({ destination }: { destination: ScanDrive }) {
  const scan = destination.scan
  if (!scan)
    return (
      <span className="rounded border px-2 py-0.5 text-foreground">Scan</span>
    )
  if (scan.status === "scanning") {
    const percent = scan.progress?.percent
    return (
      <span
        className="flex items-center gap-1.5"
        title={
          scan.progress?.estimateBasis === "history"
            ? "Approximate completion based on the previous scan’s folder count"
            : scan.progress?.estimateBasis === "previous"
              ? "Last available estimate; newly discovered folders may change it"
              : "Approximate scan completion"
        }
        aria-label={
          percent == null
            ? "Scanning"
            : `Scanning, approximately ${Math.round(percent)} percent complete`
        }
      >
        <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" />
        {percent == null
          ? "Scanning…"
          : `Scanning… ~${Math.round(percent)}% complete`}
      </span>
    )
  }
  return (
    <span>
      {scan.status === "complete"
        ? "Ready"
        : scan.status === "cancelled"
          ? "Stopped"
          : "Failed"}
    </span>
  )
}

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
  const details = !!scan && (running || !!scan.lastCompletedAt)
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
              <DestinationScan destination={destination} />
            </>
          }
        />
        {details && (
          <div
            id={detailsId}
            className={`mt-1.5 pl-6 text-[11px] leading-relaxed text-muted-foreground ${running && scan.canCancel ? "pr-14" : ""}`}
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
      {running && scan.canCancel && (
        <DropdownMenuItem
          render={<button type="button" />}
          nativeButton
          disabled={disabled || stopping}
          closeOnClick={false}
          onClick={onStop}
          aria-label={`Stop scan for ${name}`}
          label={`Stop ${name}`}
          className="pointer-events-none absolute right-2 bottom-2 gap-1 rounded border bg-background px-2 py-1 text-xs opacity-0 transition-opacity group-hover/drive:pointer-events-auto group-hover/drive:opacity-100 group-focus-within/drive:pointer-events-auto group-focus-within/drive:opacity-100 data-[highlighted]:pointer-events-auto data-[highlighted]:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
        >
          {stopping ? (
            <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" />
          ) : (
            <Square className="size-3" />
          )}
          Stop
        </DropdownMenuItem>
      )}
    </div>
  )
}
