import { useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Heart, KeyRound } from "lucide-react"
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
import { api, formatSize } from "@/lib/api"
import type { ViewerStatus } from "@/lib/api"
import { listenForLicense, SUCCESS_MESSAGE } from "@/lib/license-events"
import { toast } from "@/lib/notifications"
import { reportFindings } from "@/lib/report-actions"
import type { LicenseView } from "../../../../packages/whyfull/src/viewer-types"
import type { AnalysisData } from "./analysis-results"

type EnabledLicense = Extract<LicenseView, { enabled: true }>

// Module-level so the explorer's loading and map screens share one record.
const observedScans = new Set<string>()

// Only one mounted useLicense() reacts to activation links.
let linkListeners = 0

/** Desktop only. npx and CLI viewers report `{ enabled: false }`. */
export function useLicense() {
  const client = useQueryClient()
  useEffect(() => {
    if (linkListeners++ > 0)
      return () => {
        linkListeners--
      }
    const stop = listenForLicense(window, (detail) => {
      void client.invalidateQueries({ queryKey: ["license"] })
      if (detail.ok)
        toast.success(SUCCESS_MESSAGE, {
          description:
            detail.message === SUCCESS_MESSAGE ? undefined : detail.message,
        })
      else toast.error(detail.message)
    })
    return () => {
      linkListeners--
      stop()
    }
  }, [client])
  return useQuery({
    queryKey: ["license"],
    queryFn: ({ signal }) => api<LicenseView>("license", undefined, signal),
    staleTime: Infinity,
  })
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

export function trialLabel(license: EnabledLicense) {
  if (license.licensed)
    return license.holder ? `Licensed to ${license.holder}` : "Licensed"
  return license.trialRemaining > 0
    ? `Trial · ${license.trialRemaining} ${license.trialRemaining === 1 ? "day" : "days"} left`
    : "Unlicensed"
}

/** Bytes in known locations, caches and worktrees. Excludes generic large folders. */
export function reviewableBytes(report: AnalysisData["report"] | undefined) {
  if (!report) return 0
  return reportFindings(report)
    .filter((item) => item.category !== "Large folders")
    .reduce((total, item) => total + (item.bytes ?? 0), 0)
}

export function LicenseDialog({
  open,
  onOpenChange,
  license,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  license: EnabledLicense
}) {
  const [key, setKey] = useState("")
  const [working, setWorking] = useState(false)
  const action = useLicenseAction()
  const openPage = useOpenPage()
  useEffect(() => {
    if (!open) setKey("")
  }, [open])
  const activate = async () => {
    setWorking(true)
    try {
      const next = await action({ action: "activate", key })
      if ("enabled" in next && next.enabled && next.licensed) {
        toast.success(SUCCESS_MESSAGE)
        onOpenChange(false)
      }
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setWorking(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Heart className="size-4" />
            {license.licensed ? "License" : "Support Whyfull"}
          </DialogTitle>
          <DialogDescription>
            {license.licensed
              ? trialLabel(license)
              : license.trialRemaining > 0
                ? `${license.trialRemaining} trial ${license.trialRemaining === 1 ? "day" : "days"} left. ${license.price} once for all your computers, updates included.`
                : `Trial ended. The desktop app needs a license: ${license.price} once for all your computers. Features stay unlocked.`}
          </DialogDescription>
        </DialogHeader>
        {!license.licensed && (
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void activate()
            }}
          >
            <Input
              aria-label="License key"
              placeholder="License key or purchase link"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <Button type="submit" variant="outline" disabled={!key || working}>
              <KeyRound />
              Activate
            </Button>
          </form>
        )}
        {!license.licensed && (
          <p className="text-xs text-muted-foreground">
            Offline activation · 30-day refunds · CLI stays free
          </p>
        )}
        <p className="flex gap-4 text-xs">
          <button
            type="button"
            className="underline underline-offset-4 hover:text-foreground text-muted-foreground"
            onClick={() => openPage("recover")}
          >
            Lost your key?
          </button>
          <button
            type="button"
            className="underline underline-offset-4 hover:text-foreground text-muted-foreground"
            onClick={() => openPage("legal")}
          >
            Terms
          </button>
        </p>
        <DialogFooter>
          {license.licensed ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                void action({ action: "deactivate" }).catch((error) =>
                  toast.error(error.message)
                )
              }
            >
              Remove license from this computer
            </Button>
          ) : (
            <Button onClick={() => openPage("buy")}>
              Buy Whyfull · {license.price}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
