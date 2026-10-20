import { colorFor } from "@/lib/chart-colors"
import type { ChartColors } from "@/lib/chart-colors"
import { useEffect, useRef } from "react"
import * as echarts from "echarts/core"
import { SunburstChart } from "echarts/charts"
import { CanvasRenderer } from "echarts/renderers"
import { formatSize } from "@/lib/api"
import type { ViewEntry } from "@/lib/api"
echarts.use([SunburstChart, CanvasRenderer])
export default function Sunburst({
  root,
  colors,
  dark,
  onOpen,
  onSelect,
  onHover,
  onUp,
}: {
  colors: ChartColors
  dark: boolean
  root: ViewEntry
  onOpen: (node: ViewEntry) => void
  onSelect: (node: ViewEntry) => void
  onHover: (node: ViewEntry | null) => void
  onUp: () => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.EChartsType | null>(null)
  const callbacks = useRef({ onOpen, onSelect, onHover })
  callbacks.current = { onOpen, onSelect, onHover }
  useEffect(() => {
    const instance = echarts.init(container.current!)
    chart.current = instance
    instance.on("click", (event) => {
      const node = event.data as unknown as ViewEntry
      if (node.kind === "directory") callbacks.current.onOpen(node)
      else callbacks.current.onSelect(node)
    })
    instance.on("mouseover", (event) =>
      callbacks.current.onHover(event.data as unknown as ViewEntry)
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
  useEffect(() => {
    const prepare = (node: ViewEntry): Record<string, unknown> => {
      const paint = colorFor(colors, node, dark)
      return {
        ...node,
        itemStyle: {
          color: paint.fill,
          borderColor: paint.stroke,
          borderWidth: 1,
        },
        label: { color: paint.text },
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
            radius: ["23%", "94%"],
            sort: "desc",
            label: {
              color: "#fff",
              fontSize: 11,
              rotate: "radial",
              minAngle: 9,
            },
            levels: [
              {},
              { r0: "23%", r: "49%" },
              {
                r0: "49%",
                r: "74%",
                label: { fontSize: 9 },
              },
              {
                r0: "74%",
                r: "94%",
                label: { show: false },
              },
            ],
            emphasis: { focus: "none", itemStyle: { borderWidth: 2 } },
          },
        ],
      },
      true
    )
  }, [root, colors, dark])
  return (
    <div className="relative h-full min-h-0">
      <div
        ref={container}
        role="img"
        aria-label="Concentric directory rings; use the folder list for keyboard navigation"
        className="absolute inset-0"
      />
      <button
        onClick={onUp}
        aria-label="Go to parent folder"
        className="absolute left-1/2 top-1/2 flex aspect-square w-[20%] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full bg-background text-center"
      >
        <span className="text-xl font-medium tracking-tight">
          {formatSize(root.value)}
        </span>
        <span className="mt-1 max-w-[80%] truncate text-xs text-muted-foreground">
          {root.name}
        </span>
      </button>
    </div>
  )
}
