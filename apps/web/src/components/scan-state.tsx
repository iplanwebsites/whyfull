import { useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import { HardDrive, LoaderCircle, RefreshCw, CircleAlert } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Progress, ProgressLabel } from "@workspace/ui/components/progress"
import { formatCount, formatSize } from "@/lib/format-size"
import {
  elapsedLabel,
  remainingLabel,
  scanUpdatesAreLate,
  steadyPercent,
} from "@/lib/scan-progress"
import type { SteadyPercent } from "@/lib/scan-progress"
import { DriveCapacity } from "./drive-capacity"
import { useDrives } from "./runner-controls"
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
  const drives = useDrives()
  const folder =
    status?.directoryDestination?.id === status?.root
      ? status?.directoryDestination
      : undefined
  const drive =
    folder ??
    drives.data
      ?.filter(
        (d) =>
          status?.root === d.id ||
          status?.root.startsWith(d.id.endsWith("/") ? d.id : `${d.id}/`)
      )
      .sort((a, b) => b.id.length - a.id.length)[0]
  const home = !folder && status?.root === status?.homeDirectory
  const driveName = home
    ? "Home"
    : (drive?.name ?? status?.root.split("/").filter(Boolean).at(-1) ?? "Drive")
  const scanning =
    !changing && status?.source.kind === "live" && status.status === "scanning"
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!scanning || lastUpdatedAt === undefined) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [scanning, lastUpdatedAt])
  const updatesLate = scanning && scanUpdatesAreLate(lastUpdatedAt, now)
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
      ? "Opening your disk view"
      : !status
        ? "Opening disk explorer"
        : awaitingScan
          ? folder
            ? "Ready to explore this folder"
            : "Ready to explore your disk"
          : scanning
            ? folder
              ? "Scanning your folder"
              : "Getting to know your drive"
            : incomplete
              ? status.snapshotMode
                ? "This snapshot is incomplete"
                : status.status === "cancelled"
                  ? "Scan stopped"
                  : "The scan couldn’t finish"
              : "Preparing your disk map"
  const progress = status?.progress
  const elapsedMs =
    (progress?.elapsedMs ?? status?.durationMs ?? 0) +
    (scanning && lastUpdatedAt !== undefined
      ? Math.max(0, now - lastUpdatedAt)
      : 0)
  const estimate = useRef<SteadyPercent | null>(null)
  estimate.current = steadyPercent(
    estimate.current,
    `${status?.documentId ?? ""}:${status?.startedAt ?? ""}`,
    scanning ? progress?.percent : null
  )
  const estimateUnreliable = estimate.current.unreliable
  const percent =
    updatesLate || progress?.percent == null ? null : estimate.current.shown
  const phase = progress?.phase
  const progressLabel = updatesLate
    ? "Waiting for scan updates"
    : phase === "finalizing"
      ? "Preparing results"
      : "Estimated scan progress"
  return (
    <div className="disk-workspace">
      <header className="flex min-h-12 shrink-0 items-center gap-3 border-b px-3 py-2">
        {controls ?? <HardDrive className="size-4 text-muted-foreground" />}
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {changing ? "Opening…" : (status?.root ?? "Local disk explorer")}
        </span>
      </header>
      <main className="grid min-h-[28rem] flex-1 place-items-center px-6 py-12">
        <div className="w-full max-w-lg text-center">
          <div className="mb-8 text-sm font-semibold tracking-tight">
            whyfull<span className="text-muted-foreground">.</span>
          </div>
          {incomplete && (
            <div className="mx-auto mb-4 grid size-10 place-items-center rounded-xl border bg-muted/40">
              <CircleAlert className="size-5 text-muted-foreground" />
            </div>
          )}
          <div role="status" aria-live="polite">
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {error
                ? error
                : awaitingScan
                  ? "Start with this folder, choose a drive, or add a saved place. You can also open a report from the location menu."
                  : incomplete
                    ? "Folder sizes are incomplete. Run a new scan to see the full map and compare folders."
                    : scanning
                      ? "Mapping your folders to find where the space goes."
                      : "Your map and folder list will be ready in a moment."}
            </p>
          </div>
          {scanning && (
            <>
              <div className="mt-7">
                <DriveCapacity
                  name={driveName}
                  home={home}
                  directory={!!folder}
                  volume={folder ? null : status.volume}
                />
              </div>
              <div
                className="scan-progress mt-8 text-left"
                data-indeterminate={percent === null || undefined}
              >
                <Progress
                  value={percent}
                  aria-label={progressLabel}
                  aria-valuetext={
                    percent === null
                      ? progressLabel
                      : `Approximately ${Math.round(percent)} percent scanned`
                  }
                >
                  <ProgressLabel className="flex items-center gap-2 text-sm font-medium">
                    <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
                    {updatesLate
                      ? "Waiting for scan updates"
                      : phase === "finalizing"
                        ? "Preparing results"
                        : "Scanning folders"}
                  </ProgressLabel>
                  {percent !== null && (
                    <span
                      className="ml-auto text-sm text-muted-foreground tabular-nums"
                      aria-hidden="true"
                    >
                      ~{Math.round(percent)}%
                    </span>
                  )}
                </Progress>
                <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground tabular-nums">
                  <span>
                    {elapsedLabel(elapsedMs)} elapsed ·{" "}
                    {formatCount(progress?.files ?? status.files)} files checked
                  </span>
                  {progress?.remainingMs &&
                    !updatesLate &&
                    !estimateUnreliable && (
                      <span>{remainingLabel(progress.remainingMs)}</span>
                    )}
                </div>
                {(updatesLate || phase === "waiting") && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {updatesLate
                      ? "Waiting for fresh scan updates."
                      : "Waiting for a folder to respond."}
                  </p>
                )}
              </div>
              <details className="mt-3 text-left text-[11px] text-muted-foreground">
                <summary className="mx-auto w-fit cursor-pointer">
                  Scan details
                </summary>
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg border p-3 tabular-nums">
                  <dt>Space found</dt>
                  <dd className="text-right">
                    {formatSize(progress?.bytes ?? status.bytes)}
                  </dd>
                  <dt>Known folders left</dt>
                  <dd className="text-right">
                    {formatCount(
                      progress?.pendingDirectories ?? status.pending
                    )}
                  </dd>
                  <dt>Scan speed</dt>
                  <dd className="text-right">
                    {updatesLate || progress?.filesPerSecond == null
                      ? "Unavailable"
                      : `${formatCount(Math.round(progress.filesPerSecond))} files/sec`}
                  </dd>
                </dl>
              </details>
            </>
          )}
          {scanning && onStop && (
            <Button
              className="mt-6"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={onStop}
            >
              Stop scan
            </Button>
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
