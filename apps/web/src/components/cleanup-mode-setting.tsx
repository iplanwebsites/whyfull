import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@workspace/ui/components/button"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { api, type ViewerStatus } from "@/lib/api"
import { toast } from "@/lib/notifications"

/** The one home for choosing whether cleanup is simulated or uses the Trash. */
export function CleanupModeSetting({
  status,
  className,
}: {
  status: ViewerStatus
  className: string
}) {
  const client = useQueryClient()
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const cleanup = status.cleanup
  async function setMode(mode: "demo" | "trash") {
    setBusy(true)
    try {
      await api("cleanup-mode", { mode })
      await client.invalidateQueries()
      setConfirm(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-2 border-t pt-5">
      <label className="block space-y-2 text-sm font-medium">
        Cleanup
        <select
          className={className}
          value={cleanup.mode}
          disabled={busy}
          onChange={(event) =>
            event.target.value === "trash"
              ? setConfirm(true)
              : void setMode("demo")
          }
        >
          <option value="demo">Simulate (files stay in place)</option>
          <option value="trash" disabled={!cleanup.enabled}>
            Move to Trash
          </option>
        </select>
      </label>
      <p className="text-xs text-muted-foreground">
        {!cleanup.enabled && cleanup.reason
          ? cleanup.reason
          : "New sessions start in simulation."}
      </p>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Use the real Trash?</AlertDialogTitle>
            <AlertDialogDescription>
              Items you confirm will move to the Trash. Restore them from the
              Trash in Finder.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Keep simulating
            </Button>
            <Button
              disabled={!cleanup.enabled || busy}
              onClick={() => void setMode("trash")}
            >
              Use Trash
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
