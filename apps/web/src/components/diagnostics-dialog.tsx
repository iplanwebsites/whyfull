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
import type { DiagnosticsStatus } from "@/lib/api"

export function DiagnosticsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (value: boolean) => void
}) {
  const client = useQueryClient()
  const [selected, setSelected] = useState("space")
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
        await api<DiagnosticsStatus>("diagnostics", { action, id: command?.id })
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  const trace = command
    ? `$ ${command.command}\n${run ? `${run.trace}\n[${run.status}${run.exitCode !== null ? ` · exit ${run.exitCode}` : ""}]${run.truncated ? "\n[Output limited to 256 KiB]" : ""}` : ""}`
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
            Read-only system commands. Choose one to run locally.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Diagnostic command"
            className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs"
            value={command?.id ?? ""}
            onChange={(event) => setSelected(event.target.value)}
          >
            {data?.commands.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
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
