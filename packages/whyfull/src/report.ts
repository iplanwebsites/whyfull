/** Terminal rendering. Colour is opt-out via NO_COLOR / non-TTY. */

import { createColors } from "picocolors"
import { human } from "./size"
import { byTier } from "./scan"
import { REPO_URL } from "./targets"
import type { Report, RenderOptions, Tier, WorktreeResult } from "./types"

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
        `  ${red("Critically full.")} ${dim("Reclaim space before builds, containers, or virtual-memory growth fill the remainder.")}`
      )
    }
  }

  // ------------------------------------------------------- ranked by tier ---
  const tiers = byTier(report)
  const reclaimCandidates = tiers
    .filter((t) => t.rank <= 3)
    .reduce((sum, t) => sum + t.bytes, 0)

  out.push("")
  out.push(
    `  ${bold("Found")} ${bold(human(report.total))} across ${
      report.targets.filter((t) => t.present && t.bytes).length
    } known locations · ${green(human(reclaimCandidates))} in reclaim tiers 1–3`
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

      // pnpm's storeVersions is the richer view of the same immediate v*
      // children. Never print both representations of the same bytes.
      for (const child of item.storeVersions ? [] : item.children || []) {
        if (child.bytes < 1e8) continue
        const when =
          child.atimeMs >= 0 ? dim(` · used ${age(child.atimeMs)}`) : ""
        const shared = child.sharedBytes
          ? dim(` · ${human(child.sharedBytes)} shared with pnpm store`)
          : ""
        out.push(
          `    ${lpad(human(child.bytes), 10)}    ${dim("↳")} ${child.name}${when}${shared}`
        )
      }

      // The store's own version folders: v3 is dead weight no pnpm can read,
      // and `pnpm store prune` will never remove it.
      for (const v of item.storeVersions || []) {
        const size = v.partial ? `≥${human(v.bytes)}` : human(v.bytes)
        const note = v.stale
          ? cyan(` stale — inspect and move to Trash: ${v.path}`)
          : dim(` · written ${age(v.mtimeMs)}`)
        out.push(`    ${lpad(size, 10)}    ${dim("↳")} ${v.name}${note}`)
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

  // ---------------------------------------------------- discovered dirs ----
  const { discovered } = opts
  if (discovered && discovered.dirs.length > 0) {
    out.push("")
    out.push(
      `  ${bold(yellow("UNKNOWN HOGS"))}  ${dim(
        `>${human(discovered.threshold)} — not in our database yet`
      )}`
    )
    for (const d of discovered.dirs) {
      out.push(
        `    ${lpad(human(d.bytes), 10)}  ${pad(d.name, 30)} ${dim(d.root)}`
      )
      // Show top children so users can see what's inside
      for (const child of d.children || []) {
        out.push(
          `    ${lpad(human(child.bytes), 10)}    ${dim("↳")} ${child.name}`
        )
      }
    }
    out.push("")
    out.push(
      `  ${dim("Know what these are? Help others by opening an issue:")}`
    )
    out.push(`  ${cyan(`${REPO_URL}/issues/new`)}`)
  }

  // ----------------------------------------------- unknown cache growth ----
  const { cacheHogs } = opts
  if (cacheHogs && cacheHogs.dirs.length > 0) {
    out.push("")
    out.push(
      `  ${bold(yellow("UNTRACKED CACHES"))}  ${dim(
        `>${human(cacheHogs.threshold)} — large cache-root entries not in the database`
      )}`
    )
    for (const d of cacheHogs.dirs) {
      out.push(
        `    ${lpad(human(d.bytes), 10)}  ${pad(d.name, 30)} ${dim(d.root)}`
      )
      for (const child of d.children || []) {
        out.push(
          `    ${lpad(human(child.bytes), 10)}    ${dim("↳")} ${child.name}`
        )
      }
    }
    out.push("")
    out.push(
      `  ${dim("These are cache locations, but quit the owning app and inspect unfamiliar names before removal.")}`
    )
  }

  // ------------------------------------------------------- git worktrees ----
  const { worktrees } = opts
  if (worktrees) out.push(...renderWorktrees(worktrees))

  out.push("")
  out.push(
    `  ${dim(
      report.platform === "darwin"
        ? "For direct filesystem cleanup, prefer /usr/bin/trash <path> so files remain recoverable; use owning-app cleanup where available."
        : "For direct filesystem cleanup, prefer the OS Trash/Recycle Bin so files remain recoverable; use owning-app cleanup where available."
    )}`
  )
  out.push("")
  out.push(`  ${dim("Read-only report. whyfull never deletes anything.")}`)
  out.push("")

  return out.join("\n")
}

/**
 * Worktrees are reported per main repo, not as one flat list: the actionable
 * unit is "this repo has 34 abandoned checkouts", and the reclaim command needs
 * the main repo path anyway. "Real" subtracts the pnpm-store clones, which are
 * the difference between a scary number and a true one.
 */
function renderWorktrees(result: WorktreeResult): string[] {
  const out: string[] = []
  const lpad = (s: string | number, n: number) => String(s).padStart(n)

  const plural = (n: number, word: string) =>
    `${n} ${word}${n === 1 ? "" : "s"}`
  const toolCounts = (
    worktrees: WorktreeResult["clusters"][number]["worktrees"]
  ) => {
    const counts = new Map<string, number>()
    for (const worktree of worktrees) {
      counts.set(worktree.tool, (counts.get(worktree.tool) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tool, count]) => `${count} ${tool}`)
      .join(", ")
  }
  const total = result.clusters.reduce((sum, c) => sum + c.worktrees.length, 0)
  out.push("")
  if (total === 0) {
    out.push(`  ${bold("GIT WORKTREES")}  ${dim("none found")}`)
    return out
  }

  const bytes = result.clusters.reduce((sum, c) => sum + c.bytes, 0)
  const real = result.clusters.reduce((sum, c) => sum + c.realBytes, 0)
  const partial = result.clusters.some((c) =>
    c.worktrees.some((w) => w.partial)
  )
  const bound = partial ? "≥" : ""
  const allWorktrees = result.clusters.flatMap((c) => c.worktrees)
  out.push(
    `  ${bold(yellow("GIT WORKTREES"))}  ${dim(
      `${plural(total, "worktree")} (${toolCounts(allWorktrees)}) across ${plural(result.clusters.length, "repo")} · ${bound}${human(bytes)} apparent · ${bound}${human(real)} non-shared observed`
    )}`
  )
  if (result.truncated) {
    out.push(
      `  ${dim("(list truncated — more worktrees exist than the budget allows)")}`
    )
  }

  for (const cluster of result.clusters) {
    const clusterBound = cluster.worktrees.some((w) => w.partial) ? "≥" : ""
    out.push("")
    out.push(
      `    ${bold(cluster.mainRepo)}  ${dim(
        `${plural(cluster.worktrees.length, "worktree")} (${toolCounts(cluster.worktrees)}) · ${clusterBound}${human(cluster.bytes)} apparent · ${clusterBound}${human(cluster.realBytes)} non-shared observed`
      )}`
    )

    for (const w of cluster.worktrees) {
      const size = w.partial ? `≥${human(w.bytes)}` : human(w.bytes)
      const shared = w.sharedBytes
        ? dim(` (${human(w.sharedBytes)} shared with pnpm store)`)
        : ""
      const where = w.branch ? w.branch : w.detached ? "detached" : "—"
      const activityDate = w.lastActivityAt?.slice(0, 10)
      const activitySource = w.lastActivitySource
        ? `Git ${w.lastActivitySource.toUpperCase()}`
        : null
      const when =
        w.ageDays >= 0
          ? `${w.ageDays}d idle${activityDate ? ` · ${activityDate}` : ""}${activitySource ? ` · ${activitySource}` : ""}`
          : "activity unknown"
      const state = w.state === "linked" ? dim(w.state) : yellow(w.state)
      out.push(`    ${lpad(size, 10)}  ${w.name}${shared}`)
      out.push(
        `                ${dim(`${w.tool} · `)}${state}${dim(` · ${where} · ${when}${w.dirtyHint ? " · index touched after last commit" : ""}`)}`
      )
      out.push(`                ${cyan(w.hint)}`)
    }
  }

  out.push("")
  out.push(
    `  ${dim(
      "Worktree advice is Trash-first: inspect before running it, keep the branch, then prune only the stale Git registration."
    )}`
  )
  out.push(`  ${dim(`Idle age: ${result.activityBasis}`)}`)

  return out
}
