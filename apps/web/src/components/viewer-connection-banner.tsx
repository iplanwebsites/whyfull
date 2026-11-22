import { useEffect, useRef, useSyncExternalStore } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Unplug } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  subscribeViewerConnection,
  viewerIsOffline,
} from "@/lib/viewer-connection"

export function ViewerConnectionBanner() {
  const offline = useSyncExternalStore(
    subscribeViewerConnection,
    viewerIsOffline,
    () => false
  )
  const client = useQueryClient()
  const wasOffline = useRef(offline)
  useEffect(() => {
    if (wasOffline.current && !offline) void client.invalidateQueries()
    wasOffline.current = offline
  }, [offline, client])
  if (!offline) return null
  return (
    <div
      role="alert"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-caution/30 bg-caution/10 px-4 py-2 text-sm text-foreground"
    >
      <Unplug className="size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <strong className="font-medium">
          Viewer offline. Scan updates are paused.
        </strong>{" "}
        <span>
          Run <code>whyfull --view</code> and open the URL printed in your
          terminal.
        </span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void client.refetchQueries({ type: "active" })}
      >
        Check connection
      </Button>
    </div>
  )
}
