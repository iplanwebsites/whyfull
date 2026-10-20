import { isHoveredEntry } from "@/lib/chart-hover"
import { colorFor } from "@/lib/chart-colors"
import type { ChartColors } from "@/lib/chart-colors"
import { useLayoutEffect, useRef } from "react"
import * as echarts from "echarts/core"
import { SunburstChart } from "echarts/charts"
import { CanvasRenderer } from "echarts/renderers"
import { formatSize, formatCount } from "@/lib/api"
import type { ViewEntry } from "@/lib/api"
echarts.use([SunburstChart, CanvasRenderer])
export default function Sunburst({
  root,
  colors,
  dark,
  onOpen,
  onSelect,
  onHover,
  hovered,
  onContext,
  onUp,
}: {
  colors: ChartColors
  dark: boolean
  root: ViewEntry
  onOpen: (node: ViewEntry) => void
  onSelect: (node: ViewEntry) => void
  onHover: (node: ViewEntry | null) => void
  hovered: ViewEntry | null
  onContext: (node: ViewEntry) => void
  onUp: () => void
}) {
  const original = (data: unknown) => (data as { entry: ViewEntry }).entry
  const container = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.EChartsType | null>(null)
  const callbacks = useRef({ onOpen, onSelect, onHover, onContext })
  callbacks.current = { onOpen, onSelect, onHover, onContext }
  useLayoutEffect(() => {
    const instance = echarts.init(container.current!)
    chart.current = instance
    instance.on("click", (event) => {
      const node = original(event.data)
      if (node.kind === "directory") callbacks.current.onOpen(node)
      else callbacks.current.onSelect(node)
    })
    instance.on("contextmenu", (event) =>
      callbacks.current.onContext(original(event.data))
    )
    instance.on("mouseover", (event) =>
      callbacks.current.onHover(original(event.data))
    )
    instance.on("mouseout", () => callbacks.current.onHover(null))
    const observer = new ResizeObserver(() => instance.resize())
    observer.observe(container.current!)
    return () => {
      observer.disconnect()
      instance.dispose()
      chart.current = null
    }
  }, [])
  useLayoutEffect(() => {
    const prepare = (node: ViewEntry): Record<string, unknown> => {
      const paint = colorFor(colors, node, dark)
      return {
        ...node,
        name: node.id,
        entry: node,
        itemStyle: {
          color: paint.fill,
          borderColor:
            node.mark === "trash"
              ? "#ef4444"
              : node.mark === "useless"
                ? "#d69e2e"
                : paint.stroke,
          borderType: node.mark ? "dashed" : "solid",
          borderWidth: 1,
        },
        label: {
          color: paint.text,
          formatter: () =>
            `${node.mark ? "⚑ " : ""}${(node.kind === "remainder" || node.kind === "group") && node.files !== undefined ? `${formatCount(node.files)} ${node.files === 1 ? "file" : "files"}` : node.name}`,
        },
        children: node.children
          ?.filter((n) => n.value > 0)
          .map((n) => prepare(n)),
      }
    }
    chart.current?.setOption(
      {
        series: [
          {
            type: "sunburst",
            data: (root.children ?? [])
              .filter((n) => n.value > 0)
              .map((n) => prepare(n)),
            animation: false,
            nodeClick: false,
            radius: ["35%", "94%"],
            sort: "desc",
            label: {
              color: "#fff",
              fontSize: 11,
              rotate: "radial",
              minAngle: 9,
            },
            levels: [
              {},
              { r0: "35%", r: "58%" },
              {
                r0: "58%",
                r: "78%",
                label: { fontSize: 9 },
              },
              {
                r0: "78%",
                r: "94%",
                label: { show: false },
              },
            ],
            emphasis: {
              focus: "none",
              itemStyle: {
                borderWidth: 3,
                borderColor: dark ? "#f8fafc" : "#0f172a",
              },
              label: { fontWeight: 600 },
            },
          },
        ],
      },
      true
    )
  }, [root, colors, dark])
  useLayoutEffect(() => {
    const instance = chart.current
    if (!instance) return
    instance.dispatchAction({ type: "downplay", seriesIndex: 0 })
    if (!hovered) return
    const names: string[] = []
    const visit = (node: ViewEntry) => {
      if (isHoveredEntry(node, hovered)) names.push(node.id)
      node.children?.forEach(visit)
    }
    root.children?.forEach(visit)
    if (names.length)
      instance.dispatchAction({
        type: "highlight",
        seriesIndex: 0,
        name: names,
      })
  }, [hovered, root, colors, dark])
  const label = hovered ?? root
  return (
    <div className="relative h-full min-h-0" style={{ containerType: "size" }}>
      <div
        className="pointer-events-none absolute left-3 top-3 z-10 max-w-[60%] truncate text-base font-semibold"
        title={root.path ?? root.name}
      >
        {root.name}
      </div>
      <div
        ref={container}
        role="img"
        aria-label="Concentric directory rings; use the folder list for keyboard navigation"
        className="absolute inset-0"
      />
      <button
        onClick={onUp}
        aria-label="Go to parent folder"
        title={label.path ?? label.name}
        style={{ width: "32cqmin" }}
        className="absolute left-1/2 top-1/2 flex aspect-square -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-2 rounded-full bg-background px-4 text-center"
      >
        <span className="line-clamp-3 w-full break-words text-[clamp(16px,2.8cqmin,28px)] font-semibold leading-tight tracking-tight">
          {label.name}
        </span>
        <span className="text-[clamp(11px,1.8cqmin,16px)] text-muted-foreground tabular-nums">
          {formatSize(label.value, root.value)}
        </span>
      </button>
    </div>
  )
}
