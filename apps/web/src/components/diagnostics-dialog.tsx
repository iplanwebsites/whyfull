import { AnalysisResults } from "./analysis-results"
import type { AnalysisData } from "./analysis-results"
import { observationContext, reportObservations } from "@/lib/analysis-context"
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@workspace/ui/components/tabs"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"
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
  initialCommand = "whyfull",
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
    discover?: boolean
  }
}) {
  const client = useQueryClient()
  const [selected, setSelected] = useState(initialCommand)
  const [options, setOptions] = useState({
    top: 5,
    exact: false,
    caches: true,
    worktrees: true,
    discover: false,
  })
  useEffect(() => {
    if (open) setSelected(initialCommand)
  }, [open, initialCommand])
  useEffect(() => {
    if (open && initialOptions)
      setOptions({
        ...initialOptions,
        discover: initialOptions.discover ?? false,
      })
  }, [
    open,
    initialOptions?.top,
    initialOptions?.exact,
    initialOptions?.caches,
    initialOptions?.worktrees,
    initialOptions?.discover,
  ])
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<string>("checks")
  const notified = useRef(new Set<string>())
  const result = useQuery({
    queryKey: ["diagnostics"],
    queryFn: ({ signal }) =>
      api<DiagnosticsStatus>("diagnostics", undefined, signal),
    enabled: open,
    refetchInterval: open ? 1000 : false,
  })
  useEffect(() => {
    if (result.error) toast.error(result.error.message)
  }, [result.error])
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
  useEffect(() => {
    void client.invalidateQueries({ queryKey: ["analysis"] })
  }, [client, run?.startedAt, run?.status])
  async function action(action: "run" | "cancel", id = command?.id) {
    setBusy(true)
    try {
      client.setQueryData(
        ["diagnostics"],
        await api<DiagnosticsStatus>("diagnostics", {
          action,
          id,
          ...(action === "run" && id === "whyfull" ? { options } : {}),
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
      if (command?.id === "whyfull") {
        const analysis = await api<AnalysisData>("analysis")
        if (!analysis.report || run?.status !== "complete")
          throw new Error(
            "Complete the storage analysis before copying findings"
          )
        await navigator.clipboard.writeText(
          observationContext(
            reportObservations(analysis.report),
            analysis.report.generatedAt
          )
        )
      } else {
        await navigator.clipboard.writeText(
          JSON.stringify(
            {
              format: "whyfull-diagnostic-observation",
              check: command?.label,
              status: run?.status,
              startedAt: run?.startedAt,
              finishedAt: run?.finishedAt,
              exitCode: run?.exitCode,
              output: run?.trace,
              outputTruncated: run?.truncated,
            },
            null,
            2
          )
        )
      }
      toast.success("Context copied · observations only")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not copy context"
      )
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Analysis</DialogTitle>
          <DialogDescription>
            Read-only checks. Copy findings as context for your agent.
          </DialogDescription>
        </DialogHeader>
        {tab !== "findings" && (
          <>
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
                {command?.id === "whyfull"
                  ? "Run storage analysis"
                  : "Run check"}
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
                title="Copy context"
                aria-label="Copy context"
                disabled={
                  !run ||
                  (command?.id === "whyfull" && run.status !== "complete")
                }
                onClick={() => void copy()}
              >
                <Copy />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {command?.id === "whyfull"
                ? "Measures known locations from the CLI definitions. Optional scans find other caches, large folders, and Git worktrees on this machine."
                : "System checks run on this machine’s home volume. See the Trace tab for the exact command and output."}
            </p>
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
                    ["discover", "Find large folders"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-1.5">
                    <Checkbox
                      checked={options[key]}
                      onCheckedChange={(checked) =>
                        setOptions({ ...options, [key]: checked === true })
                      }
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
            )}
          </>
        )}
        {run?.reportAvailable && onReport && (
          <Button
            size="sm"
            variant="outline"
            className="w-fit"
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
            Open full report
          </Button>
        )}
        <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
          <TabsList>
            <TabsTrigger value="checks">Checks & coverage</TabsTrigger>
            <TabsTrigger value="findings">Findings</TabsTrigger>
            <TabsTrigger value="trace">Trace</TabsTrigger>
          </TabsList>
          <TabsContent value="checks">
            <div className="mb-3 divide-y rounded-lg border">
              {data?.commands
                .filter((item) => item.id !== "whyfull")
                .map((item) => {
                  const previous = data.runs.find((run) => run.id === item.id)
                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 p-2 text-xs"
                    >
                      <div className="flex-1">
                        <div className="font-medium">{item.label}</div>
                        <div className="text-muted-foreground">
                          {previous
                            ? `${previous.status} · ${new Date(previous.startedAt).toLocaleTimeString()}`
                            : "Not run"}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Run ${item.label}`}
                        disabled={busy || data.running}
                        onClick={() => {
                          setSelected(item.id)
                          setTab("trace")
                          void action("run", item.id)
                        }}
                      >
                        <Play />
                        Run
                      </Button>
                    </div>
                  )
                })}
            </div>
            <AnalysisResults mode="checks" />
          </TabsContent>
          <TabsContent value="findings">
            <AnalysisResults mode="findings" />
          </TabsContent>
          <TabsContent value="trace">
            <Textarea
              aria-label="Diagnostic trace"
              readOnly
              value={trace}
              spellCheck={false}
              className="h-80 font-mono text-xs leading-relaxed"
            />
          </TabsContent>
        </Tabs>
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
    <Input
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
