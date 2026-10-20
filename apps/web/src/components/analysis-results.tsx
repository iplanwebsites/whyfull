import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Copy, Search } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import { toast } from "@workspace/ui/components/sonner"
import { api, formatSize } from "@/lib/api"
import type { WhyfullJsonReport } from "@/lib/api"
import { observationContext, reportObservations } from "@/lib/analysis-context"
import type { Observation } from "@/lib/analysis-context"
export interface AnalysisData {
  definitions: Array<{
    id: string
    label: string
    group: string
    tier: string
    classification: string
    paths: string[]
  }>
  report: WhyfullJsonReport | null
  source: string | null
}
export function AnalysisResults({ mode }: { mode: "checks" | "findings" }) {
  const [query, setQuery] = useState("")
  const [limit, setLimit] = useState(50)
  const result = useQuery({
    queryKey: ["analysis"],
    queryFn: ({ signal }) => api<AnalysisData>("analysis", undefined, signal),
  })
  useEffect(() => {
    if (result.error) toast.error(result.error.message)
  }, [result.error])
  const data = result.data
  const report = data?.report
  const matches = (value: string) =>
    value.toLocaleLowerCase().includes(query.toLocaleLowerCase())
  const findings = report
    ? reportObservations(report).filter((item) =>
        matches(
          `${item.name} ${item.path} ${item.category} ${item.tier ?? ""} ${item.state ?? ""}`
        )
      )
    : []
  const definitions =
    data?.definitions.filter((item) =>
      matches(
        `${item.label} ${item.group} ${item.paths.join(" ")} ${item.tier}`
      )
    ) ?? []
  function referenceNote(item: Observation) {
    return (
      report?.targets.find((target) => target.path === item.path)?.hint ??
      report?.worktrees?.clusters
        .flatMap((cluster) => cluster.worktrees)
        .find((worktree) => worktree.path === item.path)?.recommendation
        ?.summary
    )
  }
  async function copy(items: Observation[]) {
    try {
      await navigator.clipboard.writeText(
        observationContext(items, report?.generatedAt)
      )
      toast.success("Context copied · observations only")
    } catch {
      toast.error("Could not copy context")
    }
  }
  return (
    <div className="space-y-3">
      {mode === "checks" && (
        <>
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            {[
              [
                "Known locations",
                report ? `${report.targets.length} checked` : "Not run",
              ],
              [
                "Untracked caches",
                report
                  ? report.options?.cacheScan
                    ? `${report.cacheHogs?.dirs.length ?? 0} findings`
                    : "Not included"
                  : "Not run",
              ],
              [
                "Large folders",
                report
                  ? report.options?.discover
                    ? `${report.discovered?.dirs.length ?? 0} findings`
                    : "Not included"
                  : "Not run",
              ],
              [
                "Git worktrees",
                report
                  ? report.options?.worktrees
                    ? `${report.worktrees?.clusters.reduce((sum, item) => sum + item.worktrees.length, 0) ?? 0} found`
                    : "Not included"
                  : "Not run",
              ],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border p-2">
                <div className="font-medium">{label}</div>
                <div className="mt-1 text-muted-foreground">{value}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Known-location checks come from the CLI’s definition table,
            including custom targets. Select a check above and run it; optional
            scans are controlled by the checkboxes.
          </p>
        </>
      )}
      {report && (
        <p className="text-xs text-muted-foreground">
          {data?.source} · {new Date(report.generatedAt).toLocaleString()} ·{" "}
          {report.platform}. Sizes may overlap; partial sizes are lower bounds.
        </p>
      )}
      <div className="flex items-center gap-2">
        <InputGroup className="flex-1">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label={
              mode === "checks" ? "Search check definitions" : "Search findings"
            }
            placeholder={
              mode === "checks" ? "Search checks…" : "Search findings…"
            }
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setLimit(50)
            }}
          />
        </InputGroup>
        {mode === "findings" && (
          <Button
            size="sm"
            variant="outline"
            disabled={!findings.length}
            onClick={() => void copy(findings)}
          >
            <Copy />
            Copy results ({findings.length})
          </Button>
        )}
      </div>
      {mode === "checks" ? (
        <div className="max-h-72 overflow-auto divide-y rounded-lg border">
          {definitions.slice(0, limit).map((definition) => {
            const measured = report?.targets.find(
              (item) => item.id === definition.id
            )
            const status = !measured
              ? report
                ? "Not reported"
                : "Not run"
              : measured.denied
                ? "Access denied"
                : !measured.present
                  ? "Not found"
                  : measured.partial || measured.detailMeasurementsPartial
                    ? "Partial"
                    : "Measured"
            return (
              <div key={definition.id} className="space-y-1 p-3 text-xs">
                <div className="flex items-center gap-2">
                  <span className="flex-1 font-medium">{definition.label}</span>
                  <Badge variant="outline">{status}</Badge>
                </div>
                <div className="text-muted-foreground">
                  {definition.group} · {definition.classification}
                </div>
                <div className="break-all text-muted-foreground">
                  {measured?.path ?? definition.paths.join(" · ")}
                </div>
                {measured?.bytes !== null && measured?.bytes !== undefined && (
                  <div className="tabular-nums">
                    {measured.partial || measured.detailMeasurementsPartial
                      ? "≥ "
                      : ""}
                    {formatSize(measured.bytes)}
                  </div>
                )}
              </div>
            )
          })}
          {!data && (
            <p className="p-3 text-xs text-muted-foreground">Loading checks…</p>
          )}
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Copy context includes measured facts and caveats, without cleanup
            commands or recommendation instructions.
          </p>
          {!report ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Run a storage analysis to see findings here. Your folder chart
              stays open.
            </p>
          ) : !findings.length ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No matching findings in this report.
            </p>
          ) : (
            <div className="max-h-80 overflow-auto divide-y rounded-lg border">
              {findings.slice(0, limit).map((item, index) => (
                <div
                  key={`${item.category}:${item.path}:${index}`}
                  className="p-3 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {item.name}
                    </span>
                    <span className="tabular-nums">
                      {item.bytes === null
                        ? "Unknown size"
                        : `${item.partial ? "≥ " : ""}${formatSize(item.bytes)}`}
                    </span>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Copy context for ${item.name}`}
                      title="Copy context"
                      onClick={() => void copy([item])}
                    >
                      <Copy />
                    </Button>
                  </div>
                  <div className="break-all text-muted-foreground">
                    {item.path ?? "Path unavailable"}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 text-muted-foreground">
                    <span>{item.category}</span>
                    {item.tier && <span>{item.tier}</span>}
                    {item.state && <span>{item.state}</span>}
                    {item.branch && <span>{item.branch}</span>}
                    {item.reviewRequired && <span>Review required</span>}
                    {item.denied && <span>Access denied</span>}
                    {item.partial && <span>Partial measurement</span>}
                    {item.dirtyHint && <span>Index activity detected</span>}
                  </div>
                  {referenceNote(item) && (
                    <details className="mt-2">
                      <summary className="cursor-pointer">
                        Reference recommendation
                      </summary>
                      <p className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">
                        {referenceNote(item)}
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        Reference only. Excluded from copied context.
                      </p>
                    </details>
                  )}
                  {!!item.children?.length && (
                    <details className="mt-2">
                      <summary className="cursor-pointer">
                        {item.children.length} measured children
                      </summary>
                      <div className="mt-2 space-y-1">
                        {item.children.map((child) => (
                          <div
                            key={child.path}
                            className="flex items-center gap-2"
                          >
                            <span
                              className="min-w-0 flex-1 truncate"
                              title={child.path}
                            >
                              {child.name}
                            </span>
                            <span>{formatSize(child.bytes)}</span>
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              aria-label={`Copy context for ${child.name}`}
                              onClick={() =>
                                void copy([
                                  {
                                    name: child.name,
                                    path: child.path,
                                    bytes: child.bytes,
                                    partial: child.partial ?? item.partial,
                                    category: item.category,
                                  },
                                ])
                              }
                            >
                              <Copy />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {(mode === "checks" ? definitions.length : findings.length) > limit && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setLimit(limit + 50)}
        >
          Show more
        </Button>
      )}
    </div>
  )
}
