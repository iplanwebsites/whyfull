import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Search } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import { api, formatSize } from "@/lib/api"
import type { WhyfullJsonReport } from "@/lib/api"
import { tierLabel } from "@/lib/tiers"
import { coverageSummary } from "@/lib/analysis-context"
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
  pending?: boolean
  root?: string
  source: string | null
}

/** Coverage of the known-location rules for the open inventory or report. */
export function CoverageChecks() {
  const [query, setQuery] = useState("")
  const [limit, setLimit] = useState(50)
  const [showMissing, setShowMissing] = useState(false)
  const result = useQuery({
    queryKey: ["analysis"],
    queryFn: ({ signal }) => api<AnalysisData>("analysis", undefined, signal),
  })
  const data = result.data
  const report = data?.report
  const matches = (value: string) =>
    value.toLocaleLowerCase().includes(query.toLocaleLowerCase())
  const rows =
    data?.definitions.map((definition) => {
      const measured = report?.targets.find((item) => item.id === definition.id)
      const missing = !measured || (!measured.present && !measured.denied)
      const status = !measured
        ? report
          ? "Outside this scan"
          : "Not checked"
        : measured.denied
          ? "Access denied"
          : !measured.present
            ? report?.inventory
              ? "Outside this scan"
              : "Not found"
            : measured.partial || measured.detailMeasurementsPartial
              ? "Partial"
              : "Measured"
      return { definition, measured, missing, status }
    }) ?? []
  const missingCount = rows.filter((row) => row.missing).length
  const visible = rows.filter(
    ({ definition, missing }) =>
      (showMissing || !missing) &&
      matches(
        `${definition.label} ${definition.group} ${definition.paths.join(" ")} ${tierLabel(definition.tier)}`
      )
  )
  return (
    <div className="space-y-3">
      {report && (
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          {coverageSummary(report).map(([label, value]) => (
            <div key={label} className="rounded-lg border p-2">
              <div className="font-medium">{label}</div>
              <div className="mt-1 text-muted-foreground">{value}</div>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="min-w-40 flex-1">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label="Search known locations"
            placeholder="Search known locations…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setLimit(50)
            }}
          />
        </InputGroup>
        {missingCount > 0 && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showMissing}
              onChange={(event) => {
                setShowMissing(event.target.checked)
                setLimit(50)
              }}
            />
            Show {missingCount} not found in this scan
          </label>
        )}
      </div>
      <div className="max-h-72 divide-y overflow-auto rounded-lg border">
        {visible.slice(0, limit).map(({ definition, measured, status }) => (
          <div key={definition.id} className="space-y-1 p-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="flex-1 font-medium">{definition.label}</span>
              <Badge variant="outline">{status}</Badge>
            </div>
            <div className="text-muted-foreground">
              {definition.group} · {tierLabel(definition.tier)}
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
        ))}
        {!data && (
          <p className="p-3 text-xs text-muted-foreground">
            Loading known locations…
          </p>
        )}
        {data && !visible.length && (
          <p className="p-3 text-xs text-muted-foreground">
            No known locations were found in this scan.
          </p>
        )}
      </div>
      {visible.length > limit && (
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
