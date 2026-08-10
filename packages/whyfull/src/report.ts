/** Terminal rendering. Colour is opt-out via NO_COLOR / non-TTY. */

import { createColors } from "picocolors"
import { human } from "./size"
import { byTier } from "./scan"
import type { Report, RenderOptions, Tier } from "./types"

// picocolors' own auto-detection treats win32 and CI as always-color, which
// would leak escapes into piped/redirected output. Keep the narrower, explicit
// gate this tool has always used: a real TTY, and NO_COLOR unset.
const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR
const { bold, dim, red, yellow, green, cyan } = createColors(useColor)

// Exported so the CLI's own trailing lines honour NO_COLOR too, rather than
// hardcoding escapes that leak into piped and redirected output.
export { dim, bold }

const TIER_COLOR: Record<Tier, (s: string | number) => string> = {
  AUTO: green,
  REBUILD: green,
  JUDGEMENT: yellow,
  APP: yellow,
  DATA: red,
}

function bar(fraction: number, width = 28): string {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)))
  const glyph = "█".repeat(filled) + "░".repeat(width - filled)
  if (fraction > 0.95) return red(glyph)
  if (fraction > 0.85) return yellow(glyph)
  return green(glyph)
}

function age(atimeMs: number): string {
  if (atimeMs < 0) return ""
  const days = Math.floor((Date.now() - atimeMs) / 86400000)
  if (days < 1) return "today"
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

export function render(report: Report, opts: RenderOptions = {}): string {
  const { showAll = false } = opts
  const out: string[] = []
  const pad = (s: string | number, n: number) => String(s).padEnd(n)
  const lpad = (s: string | number, n: number) => String(s).padStart(n)

  // ------------------------------------------------------------ capacity ----
  const v = report.volume
  if (v) {
    const usedFrac = v.used / v.total
    out.push("")
    out.push(
      `  ${bar(usedFrac)}  ${bold(human(v.free))} free of ${human(v.total)}  ${dim(
        `(${(usedFrac * 100).toFixed(0)}% used)`
      )}`
    )
    if (usedFrac > 0.95) {
      out.push(
        `  ${red("Critically full.")} ${dim("Deleting real files is the only fix at this level.")}`
      )
    }
  }

  // ------------------------------------------------------- ranked by tier ---
  const tiers = byTier(report)
  const reclaimable = tiers
    .filter((t) => t.rank <= 3)
    .reduce((sum, t) => sum + t.bytes, 0)

  out.push("")
  out.push(
    `  ${bold("Found")} ${bold(human(report.total))} across ${
      report.targets.filter((t) => t.present && t.bytes).length
    } known locations · ${green(human(reclaimable))} safely reclaimable`
  )

  for (const tier of tiers) {
    const paint = TIER_COLOR[tier.tier] || dim
    out.push("")
    out.push(
      `  ${paint(bold(`${tier.rank}. ${tier.label.toUpperCase()}`))}  ${dim(
        `${human(tier.bytes)} — ${tier.note}`
      )}`
    )

    for (const item of tier.items) {
      // "≥" is load-bearing: a budgeted walk stopped early, so the true size is
      // larger. Never present a partial measurement as if it were complete.
      const size = item.partial ? `≥${human(item.bytes)}` : human(item.bytes)
      out.push(
        `    ${lpad(size, 10)}  ${pad(item.label, 30)} ${dim(item.group)}`
      )

      for (const child of item.children || []) {
        if (child.bytes < 1e8) continue
        const when =
          child.atimeMs >= 0 ? dim(` · used ${age(child.atimeMs)}`) : ""
        out.push(
          `    ${lpad(human(child.bytes), 10)}    ${dim("↳")} ${child.name}${when}`
        )
      }

      if (item.hint) out.push(`                ${cyan(item.hint)}`)
    }
  }

  // ------------------------------------------------------------- absences ---
  if (showAll) {
    const missing = report.targets.filter((t) => !t.present)
    if (missing.length) {
      out.push("")
      out.push(
        `  ${dim(`Not present: ${missing.map((m) => m.label).join(", ")}`)}`
      )
    }
  }

  if (report.partial > 0) {
    out.push("")
    out.push(
      `  ${dim(
        `${report.partial} location(s) have too many files to count quickly and are shown as "≥". Use --exact for full numbers.`
      )}`
    )
  }

  if (report.denied > 0) {
    out.push("")
    out.push(
      `  ${yellow(`${report.denied} location(s) could not be read.`)} ${dim(
        report.platform === "darwin"
          ? "Grant your terminal Full Disk Access to include them — totals are an undercount."
          : "Run with higher privileges to include them."
      )}`
    )
  }

  out.push("")
  out.push(`  ${dim("Read-only report. whyfull never deletes anything.")}`)
  out.push("")

  return out.join("\n")
}
