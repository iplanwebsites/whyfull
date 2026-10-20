/** Perceptual branch colors, anchored to inventory ancestry rather than the viewport. */
interface ColorNode {
  id: string
  name: string
  value: number
  kind: string
  colorPath?: number[]
  children?: ColorNode[]
}
export interface TilePaint {
  fill: string
  stroke: string
  text: string
}
export type ChartColors = ReadonlyMap<string, TilePaint>
export interface BranchColor {
  l: number
  c: number
  h: number
}
type RGB = [number, number, number]
const anchor: BranchColor = { l: 0.64, c: 0.16, h: 250 }
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))
/** Largest child stays close; other siblings alternate hue-led and tone-led forks. */
export function childColor(
  parent: BranchColor,
  rank: number,
  depth: number
): BranchColor {
  const fade = Math.max(0.55, 1 / (1 + depth * 0.065))
  const direction = rank % 2 ? -1 : 1
  const hueLed = depth % 2 === 1
  const step = Math.ceil(rank / 2)
  const hueStep =
    step <= 3
      ? step * (hueLed ? 48 : 26)
      : 24 + ((step * 137.508) % (hueLed ? 132 : 100))
  const lightnessStep =
    rank === 0
      ? hueLed
        ? 0.025
        : -0.025
      : direction * (hueLed ? 0.045 : 0.09 + (step % 3) * 0.012) * fade
  const target = parent.l + lightnessStep
  // Bounce at the bounds rather than flattening sibling lightness into one color.
  const lightness =
    rank && (target < 0.43 || target > 0.83) ? parent.l - lightnessStep : target
  return {
    l: clamp(lightness, 0.43, 0.83),
    c: clamp(
      parent.c * (rank === 0 ? 0.98 : hueLed ? 0.96 : 0.88) +
        (rank ? direction * 0.014 * fade : 0),
      0.065,
      0.19
    ),
    h:
      (parent.h +
        (rank === 0 ? (hueLed ? 3 : -3) : direction * hueStep * fade) +
        360) %
      360,
  }
}
export function branchColor(path: number[]): BranchColor {
  return path.reduce(
    (parent, rank, index) => childColor(parent, rank, index + 1),
    anchor
  )
}
/** OKLCH -> linear sRGB, per CSS Color 4's OKLab conversion matrices. */
function linear(color: BranchColor): RGB {
  const radians = (color.h * Math.PI) / 180,
    a = color.c * Math.cos(radians),
    b = color.c * Math.sin(radians)
  const l = (color.l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (color.l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (color.l - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}
function rgb(color: BranchColor): RGB {
  let candidate = linear(color)
  const inside = (channels: RGB) =>
    channels.every((value) => value >= 0 && value <= 1)
  // Preserve perceptual lightness/hue; reduce chroma to fit sRGB instead of clipping.
  if (!inside(candidate)) {
    let low = 0,
      high = color.c
    for (let i = 0; i < 18; i++) {
      const c = (low + high) / 2,
        next = linear({ ...color, c })
      if (inside(next)) {
        low = c
        candidate = next
      } else high = c
    }
  }
  return candidate.map((value) =>
    Math.round(
      255 *
        clamp(
          value <= 0.0031308
            ? value * 12.92
            : 1.055 * value ** (1 / 2.4) - 0.055,
          0,
          1
        )
    )
  ) as RGB
}
function hex(color: RGB) {
  return (
    "#" + color.map((value) => value.toString(16).padStart(2, "0")).join("")
  )
}
function luminance(color: RGB) {
  return color
    .map((value) => {
      const c = value / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    .reduce(
      (sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!,
      0
    )
}
function paint(color: BranchColor, dark: boolean, grouped: boolean): TilePaint {
  const adjusted = {
    ...color,
    l: dark ? clamp(color.l - 0.16, 0.3, 0.7) : color.l,
    c: color.c * (grouped ? 0.65 : 1),
  }
  const fill = rgb(adjusted),
    ink: RGB = [16, 24, 40]
  const light = luminance(fill),
    inkContrast = (light + 0.05) / (luminance(ink) + 0.05),
    whiteContrast = 1.05 / (light + 0.05)
  return {
    fill: hex(fill),
    stroke: hex(
      rgb({
        ...adjusted,
        l: clamp(adjusted.l + (dark ? 0.09 : -0.09), 0.15, 0.95),
      })
    ),
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
  if (!root) return colors
  function visit(node: ColorNode, color: BranchColor, depth: number) {
    const own = node.colorPath ? branchColor(node.colorPath) : color
    colors.set(
      node.id,
      paint(own, dark, node.kind === "group" || node.kind === "remainder")
    )
    rank(node.children ?? []).forEach((child, index) =>
      visit(child, childColor(own, index, depth + 1), depth + 1)
    )
  }
  visit(root, branchColor(root.colorPath ?? []), root.colorPath?.length ?? 0)
  return colors
}
export function colorFor(
  colors: ChartColors,
  node: ColorNode,
  dark = false
): TilePaint {
  return (
    colors.get(node.id) ??
    paint(
      branchColor(
        node.colorPath ?? [
          Math.abs(
            [...node.name].reduce(
              (hash, char) => (hash * 31 + char.charCodeAt(0)) | 0,
              0
            )
          ) % 12,
        ]
      ),
      dark,
      node.kind === "group" || node.kind === "remainder"
    )
  )
}
