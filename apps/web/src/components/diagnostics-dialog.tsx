import { useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Play, Square, Copy } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Textarea } from "@workspace/ui/components/textarea"
import { toast } from "@/lib/notifications"
import { api } from "@/lib/api"
import type { DiagnosticsStatus } from "@/lib/api"

const runStatus = {
  running: "Running",
  complete: "Done",
  failed: "Failed",
  cancelled: "Stopped",
} as const

/**
 * Optional read-only system checks. Suggestions come from the completed disk
 * inventory; these checks only add context, so they live behind "Advanced".
 */
export function SystemChecks({ enabled }: { enabled: boolean }) {
  const client = useQueryClient()
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const notified = useRef(new Set<string>())
  const result = useQuery({
    queryKey: ["diagnostics"],
    queryFn: ({ signal }) =>
      api<DiagnosticsStatus>("diagnostics", undefined, signal),
    enabled,
    refetchInterval: (query) =>
      enabled && query.state.data?.running ? 1000 : false,
  })
  const data = result.data
  // The inventory analysis is shown above; only list the system commands.
  const commands = data?.commands.filter((item) => item.id !== "whyfull") ?? []
  const runs = data?.runs.filter((item) => item.id !== "whyfull") ?? []
  const run =
    runs.find((item) => item.id === selected) ??
    (selected ? undefined : runs.at(-1))
  const command = commands.find((item) => item.id === run?.id)
  useEffect(() => {
    for (const run of data?.runs ?? []) {
      const key = `${run.id}:${run.startedAt}`
      if (run.status === "failed" && !notified.current.has(key)) {
        notified.current.add(key)
        toast.error("System check failed. Open its output for details.")
      }
    }
  }, [data])
  async function action(action: "run" | "cancel", id?: string) {
    setBusy(true)
    try {
      client.setQueryData(
        ["diagnostics"],
        await api<DiagnosticsStatus>("diagnostics", { action, id })
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  async function copy() {
    if (!run) return
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(
          {
            format: "whyfull-diagnostic-observation",
            check: command?.label,
            status: run.status,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
            exitCode: run.exitCode,
            output: run.trace,
            outputTruncated: run.truncated,
          },
          null,
          2
        )
      )
      toast.success("Output copied")
    } catch {
      toast.error("Could not copy. Check clipboard permissions.")
    }
  }
  if (!data)
    return result.error ? (
      <div role="alert" className="space-y-2 text-xs">
        <p>Couldn’t load system checks. {result.error.message}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void result.refetch()}
        >
          Try again
        </Button>
      </div>
    ) : (
      <p className="text-xs text-muted-foreground">Loading system checks…</p>
    )
  if (!commands.length)
    return (
      <p className="text-xs text-muted-foreground">
        No system checks available.
      </p>
    )
  return (
    <div className="space-y-2">
      <div className="divide-y rounded-lg border">
        {commands.map((item) => {
          const previous = runs.find((run) => run.id === item.id)
          return (
            <div key={item.id} className="flex items-center gap-3 p-2 text-xs">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{item.label}</div>
                {previous && (
                  <div className="text-muted-foreground">
                    {runStatus[previous.status]} ·{" "}
                    {new Date(previous.startedAt).toLocaleTimeString()}
                  </div>
                )}
              </div>
              {previous && previous.status !== "running" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelected(item.id)}
                  aria-pressed={run?.id === item.id}
                >
                  Output
                </Button>
              )}
              {previous?.status === "running" ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void action("cancel")}
                >
                  <Square />
                  Stop
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Run ${item.label}`}
                  disabled={busy || data.running}
                  onClick={() => {
                    setSelected(item.id)
                    void action("run", item.id)
                  }}
                >
                  <Play />
                  Run
                </Button>
              )}
            </div>
          )
        })}
      </div>
      {run && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="min-w-0 flex-1 truncate">
              {command?.label ?? "Output"}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={run.status === "running"}
              onClick={() => void copy()}
            >
              <Copy />
              Copy
            </Button>
          </div>
          <Textarea
            aria-label="System check output"
            readOnly
            value={`$ ${run.command}\n${run.trace}\n[${runStatus[run.status]}${run.exitCode !== null ? ` · exit ${run.exitCode}` : ""}]${run.truncated ? "\n[Output limited to 256 KiB]" : ""}`}
            spellCheck={false}
            className="h-56 font-mono text-xs leading-relaxed"
          />
        </div>
      )}
    </div>
  )
}
