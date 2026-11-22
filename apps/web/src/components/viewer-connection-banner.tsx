import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Loader2, Unplug } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { api, type ViewerStatus } from "@/lib/api"
import { takeUnsavedTheme } from "@/lib/theme"
import {
  subscribeViewerConnection,
  viewerIsOffline,
} from "@/lib/viewer-connection"

/** Retry quietly this long before asking the user to act. */
const GRACE_MS = 15_000
const retryDelay = (attempt: number) => Math.min(2_000 * 2 ** attempt, 15_000)

function time(at: number) {
  return new Date(at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  })
}

export function ViewerConnectionBanner() {
  const offline = useSyncExternalStore(
    subscribeViewerConnection,
    viewerIsOffline,
    () => false
  )
  const client = useQueryClient()
  const desktop = !!client.getQueryData<ViewerStatus>(["status"])?.desktop
  const [lostAt, setLostAt] = useState<number | null>(null)
  const [checkedAt, setCheckedAt] = useState<number | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [checking, setChecking] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const wasOffline = useRef(offline)

  useEffect(() => {
    if (wasOffline.current && !offline) {
      const theme = takeUnsavedTheme()
      const saved = theme
        ? api("preferences", { theme }).catch(() => {})
        : Promise.resolve()
      void saved.then(() => client.invalidateQueries())
    }
    if (offline && !wasOffline.current) {
      setLostAt(Date.now())
      setNow(Date.now())
      setAttempt(0)
    }
    wasOffline.current = offline
  }, [offline, client])

  async function check() {
    setChecking(true)
    try {
      await api("status")
    } catch {
      // Still offline; the store keeps the banner up.
    } finally {
      setChecking(false)
      setCheckedAt(Date.now())
      setNow(Date.now())
    }
  }

  useEffect(() => {
    if (!offline || lostAt === null) return
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, lostAt + GRACE_MS - Date.now())
    )
    return () => clearTimeout(timer)
  }, [offline, lostAt])

  // Self-heal: keep probing with backoff while offline.
  useEffect(() => {
    if (!offline) return
    const timer = setTimeout(async () => {
      await check()
      setAttempt((value) => value + 1)
    }, retryDelay(attempt))
    return () => clearTimeout(timer)
  }, [offline, attempt])

  if (!offline) return null
  const waiting = lostAt === null || now - lostAt < GRACE_MS
  const title = waiting
    ? "Reconnecting…"
    : desktop
      ? "Can’t reach the Whyfull engine."
      : "Can’t reach the viewer."
  const next = waiting ? null : desktop ? (
    "Quit and reopen Whyfull."
  ) : (
    <>
      Run <code>whyfull --view</code> again.
    </>
  )

  return (
    <div
      role="status"
      aria-live="polite"
      className="relative flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-caution/30 bg-caution/10 px-4 py-2 text-sm text-foreground"
    >
      {waiting || checking ? (
        <Loader2
          className="size-4 shrink-0 animate-spin text-caution"
          aria-hidden="true"
        />
      ) : (
        <Unplug className="size-4 shrink-0 text-caution" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1">
        <strong className="font-medium">{title}</strong>
        {next && <span> {next}</span>}
      </div>
      <details className="group">
        <summary className="cursor-pointer list-none rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-caution/15 hover:text-foreground">
          Details
        </summary>
        <div className="absolute top-full right-4 z-50 mt-1 w-80 max-w-[calc(100vw-2rem)] space-y-3 rounded-lg border bg-popover p-4 text-sm text-popover-foreground shadow-lg">
          <p>
            Scan updates are paused and changes can’t be saved until the
            connection returns.
          </p>
          <p className="text-muted-foreground">
            {desktop
              ? "Whyfull restarts its engine automatically and returns to this folder. If it doesn’t, quit and reopen the app."
              : "The viewer runs in the terminal where you started it. If that terminal closed, run whyfull --view again and open the new URL."}
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Address</dt>
            <dd className="truncate font-mono">{location.host}</dd>
            {lostAt && (
              <>
                <dt className="text-muted-foreground">Lost</dt>
                <dd>{time(lostAt)}</dd>
              </>
            )}
            {checkedAt && (
              <>
                <dt className="text-muted-foreground">Last check</dt>
                <dd>{time(checkedAt)}</dd>
              </>
            )}
          </dl>
        </div>
      </details>
      <Button
        variant="ghost"
        size="sm"
        disabled={checking}
        onClick={() => void check()}
      >
        Retry
      </Button>
    </div>
  )
}
