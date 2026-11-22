import { useEffect, useMemo, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { KeyRound } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { api, formatSize } from "@/lib/api"
import type { ViewerStatus } from "@/lib/api"
import { listenForLicense, SUCCESS_MESSAGE } from "@/lib/license-events"
import { licenseStatus, type EnabledLicense } from "@/lib/license-status"
import { toast } from "@/lib/notifications"
import { reportFindings } from "@/lib/report-actions"
import type { LicenseView } from "../../../../packages/whyfull/src/viewer-types"
import type { AnalysisData } from "./analysis-results"

export { trialLabel } from "@/lib/license-status"

// Module-level so the explorer's loading and map screens share one record.
const observedScans = new Set<string>()

/** Desktop only. npx and CLI viewers report `{ enabled: false }`. */
export function useLicense() {
  return useQuery({
    queryKey: ["license"],
    queryFn: ({ signal }) => api<LicenseView>("license", undefined, signal),
    staleTime: Infinity,
  })
}

/**
 * Activation links: refresh the license and toast once. While Settings ›
 * License is closed, the toast offers to open it. Mount once (Explorer).
 */
export function useLicenseLinks({
  showing,
  onView,
}: {
  showing: boolean
  onView: () => void
}) {
  const client = useQueryClient()
  const latest = useRef({ showing, onView })
  latest.current = { showing, onView }
  useEffect(
    () =>
      listenForLicense(window, (detail) => {
        void client.invalidateQueries({ queryKey: ["license"] })
        const action = latest.current.showing
          ? undefined
          : { label: "View", onClick: () => latest.current.onView() }
        if (detail.ok)
          toast.success(SUCCESS_MESSAGE, {
            description:
              detail.message === SUCCESS_MESSAGE ? undefined : detail.message,
            action,
          })
        else toast.error(detail.message, { action })
      }),
    [client]
  )
}

function useLicenseAction() {
  const client = useQueryClient()
  return async (body: Record<string, unknown>) => {
    const next = await api<LicenseView | { opened: true }>("license", body)
    if ("enabled" in next) client.setQueryData(["license"], next)
    return next
  }
}

/** Pages the local server may open in the browser (see LICENSE_PAGES). */
type LicensePage = "buy" | "recover" | "legal"

// The desktop webview can't navigate off-origin, so the server opens these.
function useOpenPage() {
  const action = useLicenseAction()
  return (page: LicensePage) =>
    void action({ action: "open", page }).catch((error) =>
      toast.error(error.message)
    )
}

/** Bytes in known locations, caches and worktrees. Excludes generic large folders. */
export function reviewableBytes(report: AnalysisData["report"] | undefined) {
  if (!report) return 0
  return reportFindings(report)
    .filter((item) => item.category !== "Large folders")
    .reduce((total, item) => total + (item.bytes ?? 0), 0)
}

const linkClass =
  "text-muted-foreground underline underline-offset-4 hover:text-foreground"

/** Settings › License: the one home for license status and actions. */
export function LicenseSettings({ license }: { license: EnabledLicense }) {
  const [key, setKey] = useState("")
  const [working, setWorking] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const action = useLicenseAction()
  const openPage = useOpenPage()
  const { title, detail } = licenseStatus(license)
  const run = async (body: Record<string, unknown>) => {
    setWorking(true)
    try {
      return await action(body)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setWorking(false)
    }
  }
  const activate = async () => {
    const next = await run({ action: "activate", key })
    if (next && "enabled" in next && next.enabled && next.licensed) {
      setKey("")
      toast.success(SUCCESS_MESSAGE)
    }
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1" role="status">
          <p className="text-sm font-medium">{title}</p>
          {detail && (
            <p className="break-all text-xs text-muted-foreground">{detail}</p>
          )}
        </div>
        {!license.licensed && (
          <Button onClick={() => openPage("buy")}>
            Buy Whyfull · {license.price}
          </Button>
        )}
      </div>
      {!license.licensed && (
        <form
          className="space-y-2 border-t pt-5"
          onSubmit={(event) => {
            event.preventDefault()
            void activate()
          }}
        >
          <label htmlFor="license-key" className="block text-sm font-medium">
            License key
          </label>
          <div className="flex gap-2">
            <Input
              id="license-key"
              placeholder="Key or activation link"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <Button type="submit" variant="outline" disabled={!key || working}>
              <KeyRound />
              Activate
            </Button>
          </div>
        </form>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-5 text-xs">
        <button
          type="button"
          className={linkClass}
          onClick={() => openPage("recover")}
        >
          Lost your key?
        </button>
        <button
          type="button"
          className={linkClass}
          onClick={() => openPage("legal")}
        >
          Terms
        </button>
        {license.licensed && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            disabled={working}
            onClick={() => setConfirmRemove(true)}
          >
            Remove license from this computer
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Verified offline; nothing is sent. 30-day refunds. The CLI stays free.
      </p>
      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove license from this computer?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Keep your key to activate again later. Your other computers stay
              licensed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setConfirmRemove(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={working}
              onClick={() =>
                void run({ action: "deactivate" }).then(() =>
                  setConfirmRemove(false)
                )
              }
            >
              Remove
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/**
 * After a completed live scan, at most once per day once the trial is over.
 * Never during a scan or refresh, and never in npx/CLI viewers.
 */
export function SupportReminder({
  status,
  analysis,
  onEnterKey,
}: {
  status: ViewerStatus
  analysis: AnalysisData | undefined
  onEnterKey: () => void
}) {
  const license = useLicense().data
  const action = useLicenseAction()
  const openPage = useOpenPage()
  const [open, setOpen] = useState(false)
  const bytes = useMemo(() => reviewableBytes(analysis?.report), [analysis])
  useEffect(() => {
    if (status.source.kind !== "live") return
    if (status.status === "scanning" || status.cache?.refreshing) {
      observedScans.add(status.documentId)
      return
    }
    if (
      status.status !== "complete" ||
      !analysis ||
      !observedScans.has(status.documentId) ||
      !license?.enabled ||
      !license.reminderDue
    )
      return
    // Let the suggestions toast and map settle before asking.
    const timer = setTimeout(() => {
      observedScans.delete(status.documentId)
      setOpen(true)
      void action({ action: "reminded" }).catch(() => {})
    }, 1500)
    return () => clearTimeout(timer)
  }, [
    status.status,
    status.documentId,
    status.source.kind,
    status.cache?.refreshing,
    analysis,
    license,
  ])
  if (!license?.enabled) return null
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {bytes >= 1024 ** 3
              ? `Whyfull found ${formatSize(bytes)} worth reviewing`
              : `Whyfull mapped ${formatSize(status.bytes)} of your disk`}
          </DialogTitle>
          <DialogDescription>
            Trial ended. The desktop app needs a license: {license.price} once
            for all your computers. Features stay unlocked; the CLI stays free.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Not now
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setOpen(false)
                onEnterKey()
              }}
            >
              I have a key
            </Button>
            <Button
              onClick={() => {
                openPage("buy")
                setOpen(false)
              }}
            >
              Buy · {license.price}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
