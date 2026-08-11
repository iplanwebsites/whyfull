/**
 * Scanning. READ-ONLY BY CONSTRUCTION: this module imports nothing from
 * node:fs that can write, and spawns no child processes.
 */

import { existsSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { measure, volume } from "./size"
import { forPlatform, TIERS } from "./targets"
import type {
  Report,
  ScannedTarget,
  ChildEntry,
  TierGroup,
  ScanOptions,
} from "./types"

/** First candidate path that exists, or null. */
function resolve(candidates: Array<string | null>): string | null {
  for (const p of candidates) {
    if (p && existsSync(p)) return p
  }
  return null
}

/**
 * Largest immediate children of a directory, for drill-down.
 * This is what turns "165 GB in ~/.cache/huggingface" into an actionable
 * "34.8 GB is DeepFloyd, and you have not touched it in 3 months".
 */
function children(
  dir: string,
  limit: number,
  seen: Set<string>,
  budget = Infinity
): ChildEntry[] {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const out: ChildEntry[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    const full = join(dir, entry.name)
    // Inherit the parent's budget: without it, drilling into a 630k-file pnpm
    // store re-walks everything the budgeted parent scan deliberately skipped.
    const { bytes } = measure(full, { seen, budget })
    let atimeMs = -1
    try {
      atimeMs = statSync(full).atimeMs
    } catch {
      /* atime is a nicety, not required */
    }
    out.push({ name: entry.name, path: full, bytes, atimeMs })
  }

  return out.sort((a, b) => b.bytes - a.bytes).slice(0, limit)
}

/**
 * Scan every applicable target.
 *
 * A single `seen` inode set spans the whole scan, so a blob hard-linked into
 * both the pnpm store and a project's node_modules is attributed once — to
 * whichever target is measured first. That makes the grand total honest, at the
 * cost of making per-target order slightly significant. `du` has the same
 * property and does not tell you about it.
 */
export function scan(opts: ScanOptions = {}): Report {
  const {
    platform = process.platform,
    top = 0,
    onProgress = null,
    exact = false,
  } = opts

  const targets = forPlatform(platform)
  const seen = new Set<string>()
  const results: ScannedTarget[] = []
  let denied = 0
  let partial = 0

  for (const target of targets) {
    const path = resolve(target.candidates)
    if (!path) {
      results.push({
        ...target,
        path: null,
        bytes: null,
        present: false,
        children: [],
      })
      continue
    }

    if (onProgress) onProgress(target.label)

    const {
      bytes,
      files,
      denied: wasDenied,
      partial: wasPartial,
    } = measure(path, {
      maxDepth: target.depth ?? Infinity,
      budget: exact ? Infinity : (target.budget ?? Infinity),
      seen,
    })
    if (wasDenied) denied += 1
    if (wasPartial) partial += 1

    const entry: ScannedTarget = {
      ...target,
      path,
      bytes,
      files,
      present: true,
      denied: wasDenied,
      partial: wasPartial,
      children: [],
    }

    // Drill into the big ones only — child measurement re-walks subtrees.
    if (top > 0 && bytes > 1e9) {
      const base = target.childrenDir ? join(path, target.childrenDir) : path
      if (existsSync(base)) {
        entry.children = children(
          base,
          top,
          new Set(),
          exact ? Infinity : (target.budget ?? Infinity)
        )
      }
    }

    results.push(entry)
  }

  const home = platform === "win32" ? process.env.SystemDrive || "C:" : "/"

  return {
    platform,
    volume: volume(home),
    targets: results,
    denied,
    partial,
    exact,
    total: results.reduce((sum, r) => sum + (r.bytes || 0), 0),
    generatedAt: new Date().toISOString(),
  }
}

/** Group by tier, ranked by reclaimable bytes — the "what first" ordering. */
export function byTier(report: Report): TierGroup[] {
  const groups = new Map<string, TierGroup>()
  for (const t of report.targets) {
    if (!t.present || !t.bytes) continue
    const tier = t.tier
    if (!groups.has(tier)) {
      groups.set(tier, { tier, ...TIERS[tier], items: [], bytes: 0 })
    }
    const g = groups.get(tier)!
    g.items.push(t)
    g.bytes += t.bytes
  }
  for (const g of groups.values())
    g.items.sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0))
  return [...groups.values()].sort((a, b) => a.rank - b.rank)
}
