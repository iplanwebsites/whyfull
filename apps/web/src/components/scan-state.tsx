import type { ReactNode } from "react"
import { HardDrive, RefreshCw, CircleAlert } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { ScanActivity } from "./scan-activity"
import type { ViewerStatus } from "@/lib/api"

export function ScanState({
  status,
  lastUpdatedAt,
  changing = false,
  busy = false,
  error,
  controls,
  onStop,
  onRestart,
}: {
  status?: ViewerStatus
  lastUpdatedAt?: number
  changing?: boolean
  busy?: boolean
  error?: string
  controls?: ReactNode
  onStop?: () => void
  onRestart?: () => void
}) {
  const scanning =
    !changing && status?.source.kind === "live" && status.status === "scanning"
  const awaitingScan = !changing && status?.awaitingScan
  const incomplete =
    !!error ||
    (!changing &&
      status &&
      status.status !== "complete" &&
      !scanning &&
      !awaitingScan)
  const title = error
    ? "Couldn’t open disk explorer"
    : changing
      ? "Opening…"
      : !status
        ? "Opening…"
        : awaitingScan
          ? "Ready to scan"
          : scanning
            ? status.root === status.homeDirectory
              ? "Home"
              : (status.root.split("/").filter(Boolean).at(-1) ?? "Drive")
            : incomplete
              ? status.snapshotMode
                ? "This snapshot is incomplete"
                : status.status === "cancelled"
                  ? "Scan stopped"
                  : "The scan couldn’t finish"
              : "Preparing results…"
  return (
    <div className="disk-workspace">
      <header className="flex min-h-12 shrink-0 items-center gap-3 border-b px-3 py-2">
        {controls ?? <HardDrive className="size-4 text-muted-foreground" />}
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {changing ? "Opening…" : (status?.root ?? "Local disk explorer")}
        </span>
      </header>
      <main className="grid min-h-[28rem] flex-1 place-items-center px-6 py-12">
        <div
          className={`w-full max-w-md ${scanning ? "text-left" : "text-center"}`}
        >
          {incomplete && (
            <div className="mx-auto mb-4 grid size-10 place-items-center rounded-xl border bg-muted/40">
              <CircleAlert className="size-5 text-muted-foreground" />
            </div>
          )}
          <div role="status" aria-live="polite">
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            {(error || incomplete) && (
              <p className="mt-3 text-sm text-muted-foreground">
                {error ?? "Incomplete results. Scan again to update sizes."}
              </p>
            )}
          </div>
          {scanning && (
            <div className="mt-4">
              <ScanActivity
                progress={status.progress}
                usedBytes={status.volume?.used}
                lastUpdatedAt={lastUpdatedAt}
                busy={busy}
                onStop={onStop}
              />
            </div>
          )}
          {(incomplete || awaitingScan) && onRestart && (
            <Button className="mt-6" disabled={busy} onClick={onRestart}>
              <RefreshCw />
              {error
                ? "Try again"
                : status?.snapshotMode
                  ? "Scan this folder"
                  : awaitingScan
                    ? "Start scan"
                    : "Scan again"}
            </Button>
          )}
        </div>
      </main>
    </div>
  )
}
