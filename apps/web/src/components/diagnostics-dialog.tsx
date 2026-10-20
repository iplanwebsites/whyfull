import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@workspace/ui/components/select"
import { useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Play, Square, Copy } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@workspace/ui/components/dialog"
import { toast } from "@workspace/ui/components/sonner"
import { api } from "@/lib/api"
import type { DiagnosticsStatus, ViewerStatus } from "@/lib/api"

export function DiagnosticsDialog({
  open,
  onOpenChange,
  onReport,
  initialCommand = "space",
  initialOptions,
}: {
  open: boolean
  onOpenChange: (value: boolean) => void
  onReport?: (status: ViewerStatus) => Promise<void>
  initialCommand?: string
  initialOptions?: {
    top: number
    exact: boolean
    caches: boolean
    worktrees: boolean
  }
}) {
  const client = useQueryClient()
  const [selected, setSelected] = useState(initialCommand)
  const [options, setOptions] = useState({
    top: 5,
    exact: false,
    caches: true,
    worktrees: false,
  })
  useEffect(() => {
    if (open) setSelected(initialCommand)
  }, [open, initialCommand])
  useEffect(() => {
    if (open && initialOptions) setOptions(initialOptions)
  }, [
    open,
    initialOptions?.top,
    initialOptions?.exact,
    initialOptions?.caches,
    initialOptions?.worktrees,
  ])
  const [busy, setBusy] = useState(false)
  const notified = useRef(new Set<string>())
  const result = useQuery({
    queryKey: ["diagnostics"],
    queryFn: ({ signal }) =>
      api<DiagnosticsStatus>("diagnostics", undefined, signal),
    enabled: open,
    refetchInterval: open ? 1000 : false,
  })
  const data = result.data
  const command =
    data?.commands.find((item) => item.id === selected) ?? data?.commands[0]
  const run = data?.runs.find((item) => item.id === command?.id)
  useEffect(() => {
    for (const run of data?.runs ?? []) {
      const key = `${run.id}:${run.startedAt}`
      if (run.status === "failed" && !notified.current.has(key)) {
        notified.current.add(key)
        toast.error("Diagnostic failed. See the trace for details.")
      }
    }
  }, [data])
  async function action(action: "run" | "cancel") {
    setBusy(true)
    try {
      client.setQueryData(
        ["diagnostics"],
        await api<DiagnosticsStatus>("diagnostics", {
          action,
          id: command?.id,
          ...(action === "run" && command?.id === "whyfull" ? { options } : {}),
        })
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  const trace = command
    ? `$ ${run?.command ?? command.command}\n${run ? `${run.trace}\n[${run.status}${run.exitCode !== null ? ` · exit ${run.exitCode}` : ""}]${run.truncated ? "\n[Output limited to 256 KiB]" : ""}` : ""}`
    : ""
  async function copy() {
    try {
      await navigator.clipboard.writeText(trace)
      toast.success("Trace copied")
    } catch {
      toast.error(
        "Could not copy the trace. Select the output and copy it manually."
      )
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Diagnostics</DialogTitle>
          <DialogDescription>
            Read-only commands. Adjust a report scan, then open its locations
            and recommendations.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={command?.id ?? ""}
            onValueChange={(value) => {
              if (value !== null) setSelected(value)
            }}
            items={
              data?.commands.map((item) => ({
                value: item.id,
                label: item.label,
              })) ?? []
            }
          >
            <SelectTrigger
              aria-label="Diagnostic command"
              className="min-w-0 max-w-full flex-1 text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {data?.commands.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={busy || !command || data?.running}
            onClick={() => void action("run")}
          >
            <Play />
            Run
          </Button>
          {data?.running && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void action("cancel")}
            >
              <Square />
              Stop
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            title="Copy trace"
            aria-label="Copy trace"
            disabled={!run}
            onClick={() => void copy()}
          >
            <Copy />
          </Button>
        </div>
        {command?.id === "whyfull" && (
          <fieldset
            disabled={busy || data?.running}
            className="flex flex-wrap items-center gap-3 text-xs"
          >
            <label className="flex items-center gap-2">
              Children per location
              <InputNumber
                value={options.top}
                onChange={(top) => setOptions({ ...options, top })}
              />
            </label>
            {(
              [
                ["exact", "Exact sizes"],
                ["caches", "Find caches"],
                ["worktrees", "Find worktrees"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={options[key]}
                  onChange={(event) =>
                    setOptions({ ...options, [key]: event.target.checked })
                  }
                />
                {label}
              </label>
            ))}
          </fieldset>
        )}
        {run?.reportAvailable && onReport && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void (async () => {
                setBusy(true)
                try {
                  const next = await api<ViewerStatus>("diagnostics/report", {
                    startedAt: run.startedAt,
                  })
                  await onReport(next)
                  onOpenChange(false)
                } catch (error) {
                  toast.error(
                    error instanceof Error ? error.message : String(error)
                  )
                } finally {
                  setBusy(false)
                }
              })()
            }
          >
            Open report
          </Button>
        )}
        <textarea
          aria-label="Diagnostic trace"
          readOnly
          value={trace}
          spellCheck={false}
          className="h-80 w-full resize-y rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed"
        />
      </DialogContent>
    </Dialog>
  )
}

function InputNumber({
  value,
  onChange,
}: {
  value: number
  onChange: (value: number) => void
}) {
  return (
    <input
      type="number"
      min={0}
      max={100}
      aria-label="Children per location"
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      className="h-8 w-16 rounded-md border bg-background px-2"
    />
  )
}
