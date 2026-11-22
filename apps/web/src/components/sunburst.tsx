import "./disk-charts.css"
import { isHoveredEntry } from "@/lib/chart-hover"
import { colorFor, isSafeTier, stateColors } from "@/lib/chart-colors"
import type { ChartColors } from "@/lib/chart-colors"
import { useLayoutEffect, useRef, useState } from "react"
import * as echarts from "echarts/core"
import { SunburstChart } from "echarts/charts"
import { CanvasRenderer } from "echarts/renderers"
import { formatSize, formatCount } from "@/lib/api"
import type { ViewEntry } from "@/lib/api"
echarts.use([SunburstChart, CanvasRenderer])

// Ring bounds as fractions of the chart radius, matching `levels` below.
const rings = [
  [0.35, 0.58],
  [0.58, 0.78],
]

/**
 * Labels run along the arc (tangential, kept upright by ECharts) and are
 * shown only where the arc is long enough for a few legible characters.
 * Small arcs stay unlabelled; hovering names them in the centre.
 */
export function arcLabel(
  angle: number,
  depth: number,
  radius: number,
  fontSize: number,
  singleRing = false
) {
  const [inner, outer] =
    singleRing && depth === 0 ? [0.35, 0.94] : (rings[depth] ?? [0, 0])
  const band = (outer - inner) * radius
  const arc = angle * ((inner + outer) / 2) * radius
  const width = Math.floor(arc - 8)
  if (band < fontSize + 6 || width < fontSize * 3) return { show: false }
  return {
    show: true,
    rotate: "tangential" as const,
    width,
    overflow: "truncate" as const,
    ellipsis: "…",
  }
}
export default function Sunburst({
  root,
  colors,
  dark,
  onOpen,
  onSelect,
  onHover,
  hovered = null,
  onContext,
  onUp,
}: {
  colors: ChartColors
  dark: boolean
  root: ViewEntry
  onOpen: (node: ViewEntry) => void
  onSelect: (node: ViewEntry) => void
  onHover: (node: ViewEntry | null) => void
  hovered?: ViewEntry | null
  onContext: (node: ViewEntry) => void
  onUp: () => void
}) {
  const original = (data: unknown) => (data as { entry: ViewEntry }).entry
  const container = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.EChartsType | null>(null)
  // Chart radius in pixels, coarsened to avoid re-rendering on every resize.
  const [radius, setRadius] = useState(0)
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
    const measure = () =>
      setRadius(
        Math.round(
          Math.min(instance.getWidth(), instance.getHeight()) / 2 / 16
        ) * 16
      )
    measure()
    const observer = new ResizeObserver(() => {
      instance.resize()
      measure()
    })
    observer.observe(container.current!)
    return () => {
      observer.disconnect()
      instance.dispose()
      chart.current = null
    }
  }, [])
  useLayoutEffect(() => {
    const singleRing = (root.children ?? []).every(
      (node) => !node.children?.some((child) => child.value > 0)
    )
    const total = (root.children ?? []).reduce(
      (sum, node) => sum + Math.max(0, node.value),
      0
    )
    const state = stateColors(dark)
    const prepare = (
      node: ViewEntry,
      depth: number
    ): Record<string, unknown> => {
      const paint = colorFor(colors, node, dark)
      const fontSize = singleRing ? 14 : depth === 0 ? 11 : 9
      return {
        ...node,
        name: node.id,
        entry: node,
        itemStyle: {
          color: paint.fill,
          borderColor:
            node.mark === "trash"
              ? state.trash
              : node.mark === "useless"
                ? state.useless
                : paint.stroke,
          borderType: node.mark ? "dashed" : "solid",
          borderWidth: node.mark ? 1.5 : 1,
        },
        label: {
          color: paint.text,
          fontSize,
          ...arcLabel(
            total > 0 ? (node.value / total) * Math.PI * 2 : 0,
            depth,
            radius,
            fontSize,
            singleRing
          ),
          formatter: () =>
            `${node.mark ? "⚑ " : isSafeTier(node.tier) && !node.kept ? "● " : ""}${(node.kind === "remainder" || node.kind === "group") && node.files !== undefined ? `${formatCount(node.files)} ${node.files === 1 ? "file" : "files"}` : node.name}`,
        },
        children: node.children
          ?.filter((n) => n.value > 0)
          .map((n) => prepare(n, depth + 1)),
      }
    }
    chart.current?.setOption(
      {
        series: [
          {
            type: "sunburst",
            data: (root.children ?? [])
              .filter((n) => n.value > 0)
              .map((n) => prepare(n, 0)),
            animation: false,
            nodeClick: false,
            radius: ["35%", "94%"],
            sort: "desc",
            label: {
              fontSize: 11,
            },
            levels: [
              {},
              { r0: "35%", r: singleRing ? "94%" : "58%" },
              { r0: "58%", r: "78%" },
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
                borderColor: state.focus,
              },
              label: { fontWeight: 600 },
            },
          },
        ],
      },
      true
    )
  }, [root, colors, dark, radius])
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
  }, [hovered, root, colors, dark, radius])
  const label = hovered ?? root
  return (
    <div className="whyfull-sunburst">
      <div
        ref={container}
        role="img"
        aria-label="Concentric directory rings; use the folder list for keyboard navigation"
        className="whyfull-sunburst-canvas"
      />
      <button
        onClick={onUp}
        aria-label="Go to parent folder"
        style={{ width: "32cqmin" }}
        className="whyfull-sunburst-center"
      >
        <span className="whyfull-sunburst-name">{label.name}</span>
        <span className="whyfull-sunburst-size">
          {formatSize(label.value, root.value)}
        </span>
      </button>
    </div>
  )
}
