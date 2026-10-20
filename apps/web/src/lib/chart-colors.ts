/** Shared branch colors for the map, rings, and ranked list. */
interface ColorNode {
  id: string
  name: string
  value: number
  kind: string
  children?: ColorNode[]
}
export interface TilePaint {
  fill: string
  stroke: string
  text: string
}
export type ChartColors = ReadonlyMap<string, TilePaint>
const hues = [216, 164, 272, 38, 338, 190, 87, 246, 18, 145, 303, 61]
type RGB = [number, number, number]
function hsl(h: number, s: number, l: number): RGB {
  const a = s * Math.min(l, 1 - l)
  const channel = (n: number) => {
    const k = (n + h / 30) % 12
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
  }
  return [channel(0), channel(8), channel(4)]
}
function hex(rgb: RGB) {
  return "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("")
}
function luminance(rgb: RGB) {
  return rgb
    .map((v) => {
      const c = v / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
}
function paint(
  hue: number,
  depth: number,
  index: number,
  dark: boolean,
  neutral: boolean
): TilePaint {
  const lightness = dark
    ? Math.min(0.69, 0.3 + depth * 0.13 + (depth ? (index % 5) * 0.025 : 0))
    : Math.min(0.82, 0.4 + depth * 0.2 + (depth ? (index % 5) * 0.025 : 0))
  const rgb = hsl(
    hue,
    neutral ? 0.08 : Math.max(0.36, 0.57 - depth * 0.065),
    lightness
  )
  const whiteContrast = 1.05 / (luminance(rgb) + 0.05)
  const ink: RGB = [16, 24, 40]
  const inkContrast = (luminance(rgb) + 0.05) / (luminance(ink) + 0.05)
  const stroke = rgb.map((c) =>
    Math.round(dark ? c + (255 - c) * 0.2 : c * 0.74)
  ) as RGB
  return {
    fill: hex(rgb),
    stroke: hex(stroke),
    text:
      whiteContrast >= inkContrast && whiteContrast >= 4.5
        ? "#ffffff"
        : inkContrast >= 4.5
          ? hex(ink)
          : "#000000",
  }
}
function rank(nodes: ColorNode[]) {
  return [...nodes].sort(
    (a, b) =>
      b.value - a.value ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id)
  )
}
export function chartColors(
  root: ColorNode | undefined,
  dark = false
): ChartColors {
  const colors = new Map<string, TilePaint>()
  function branch(node: ColorNode, hue: number, depth: number, index: number) {
    const neutral = node.kind === "group" || node.kind === "remainder"
    colors.set(node.id, paint(hue, depth, index, dark, neutral))
    rank(node.children ?? []).forEach((child, i) =>
      branch(child, hue, depth + 1, i)
    )
  }
  rank(root?.children ?? []).forEach((node, index) =>
    branch(
      node,
      index < hues.length ? hues[index] : (216 + index * 137.508) % 360,
      0,
      0
    )
  )
  return colors
}
export function colorFor(
  colors: ChartColors,
  node: ColorNode,
  dark = false
): TilePaint {
  const existing = colors.get(node.id)
  if (existing) return existing
  let hash = 0
  for (const char of node.name) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return paint(
    hues[(hash >>> 0) % hues.length],
    0,
    0,
    dark,
    node.kind === "group" || node.kind === "remainder"
  )
}
