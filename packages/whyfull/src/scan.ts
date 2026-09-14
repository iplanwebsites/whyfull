/**
 * Scanning. READ-ONLY BY CONSTRUCTION: this module imports nothing from
 * node:fs that can write, and spawns no child processes.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import type { Dirent } from "node:fs"
import { join } from "node:path"
import { measure, volume } from "./size"
import { sharedStore, storeVersions } from "./pnpm"
import { forPlatform, TIERS } from "./targets"
import type {
  Report,
  ScannedTarget,
  ChildEntry,
  TierGroup,
  ScanOptions,
  MeasureResult,
} from "./types"

/** First candidate path that exists, or null. */
function resolve(candidates: Array<string | null>): string | null {
  for (const p of candidates) {
    if (p && existsSync(p)) return p
  }
  return null
}

/**
 * Largest immediate entries of a directory, for drill-down.
 * This is what turns "165 GB in ~/.cache/huggingface" into an actionable
 * "34.8 GB is DeepFloyd, and you have not touched it in 3 months".
 */
function children(
  dir: string,
  limit: number,
  seen: Set<string>,
  budget = Infinity
): {
  entries: ChildEntry[]
  bytes: number
  denied: boolean
  partial: boolean
} {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return { entries: [], bytes: 0, denied: true, partial: false }
  }

  const out: ChildEntry[] = []
  let bytes = 0
  let denied = false
  let partial = false
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const full = join(dir, entry.name)
    // Inherit the parent's budget: without it, drilling into a 630k-file pnpm
    // store re-walks everything the budgeted parent scan deliberately skipped.
    const measured = measure(full, { seen, budget })
    bytes += measured.bytes
    denied ||= measured.denied
    partial ||= measured.partial
    let atimeMs = -1
    try {
      atimeMs = statSync(full).atimeMs
    } catch {
      /* atime is a nicety, not required */
    }
    const child: ChildEntry = {
      name: entry.name,
      path: full,
      bytes: measured.bytes,
      atimeMs,
    }

    // On macOS pnpm clones rather than hard-links, so every node_modules whyfull
    // drills into reports its full apparent size while costing near zero on
    // disk. measure() cannot see that (clones have distinct inodes), so annotate
    // the child instead of silently overstating what deleting it would free.
    if (entry.isDirectory() && sharedStore(full)) {
      child.sharedBytes = measured.bytes
    }

    out.push(child)
  }

  return {
    entries: out.sort((a, b) => b.bytes - a.bytes).slice(0, limit),
    bytes,
    denied,
    partial,
  }
}

/**
 * Simulator runtimes are mounted read-only disk images. The mounted filesystem
 * reports its expanded capacity, not the host bytes occupied by its backing
 * image, so counting the mount can overstate reclaimable storage by 2x or more.
 * Measure the MobileAsset bundles that actually occupy the host filesystem,
 * plus the ordinary dyld cache. Never walk or count the mounted volumes.
 */
export function measureSimulatorRuntimes(
  path: string,
  assetsRoot = "/System/Library/AssetsV2/com_apple_MobileAsset_iOSSimulatorRuntime"
): {
  measurement: MeasureResult
  children: ChildEntry[]
} {
  const out: ChildEntry[] = []
  let denied = false
  let partial = false
  const seen = new Set<string>()

  let assets: Dirent[] = []
  try {
    assets = readdirSync(assetsRoot, { withFileTypes: true })
  } catch {
    if (existsSync(assetsRoot)) denied = true
  }
  for (const asset of assets) {
    if (
      !asset.isDirectory() ||
      asset.isSymbolicLink() ||
      !asset.name.endsWith(".asset")
    ) {
      continue
    }
    const full = join(assetsRoot, asset.name)
    const measured = measure(full, { seen })
    denied ||= measured.denied
    partial ||= measured.partial

    let version: string | null = null
    let build: string | null = null
    try {
      const info = readFileSync(join(full, "Info.plist"), "utf8")
      version =
        /<key>SimulatorVersion<\/key>\s*<string>([^<]+)<\/string>/.exec(
          info
        )?.[1] ?? null
      build =
        /<key>Build<\/key>\s*<string>([^<]+)<\/string>/.exec(info)?.[1] ?? null
    } catch {
      /* A readable size is still useful when metadata is unavailable. */
    }

    let atimeMs = -1
    try {
      atimeMs = statSync(full).atimeMs
    } catch {
      /* atime is optional */
    }
    const identity = [version && `iOS ${version}`, build && `build ${build}`]
      .filter(Boolean)
      .join(" · ")
    out.push({
      name: identity ? `${identity} runtime asset` : asset.name,
      path: full,
      bytes: measured.bytes,
      atimeMs,
    })
  }

  const dyld = join(path, "Caches", "dyld")
  if (existsSync(dyld)) {
    const measured = measure(dyld, { seen })
    denied ||= measured.denied
    partial ||= measured.partial
    let atimeMs = -1
    try {
      atimeMs = statSync(dyld).atimeMs
    } catch {
      /* atime is optional */
    }
    out.push({
      name: "dyld caches",
      path: dyld,
      bytes: measured.bytes,
      atimeMs,
    })
  }

  return {
    measurement: {
      bytes: out.reduce((sum, child) => sum + child.bytes, 0),
      files: out.length,
      denied,
      partial,
      pending: 0,
    },
    children: out.sort((a, b) => b.bytes - a.bytes),
  }
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

    const runtimeResult =
      target.id === "coresimulator-runtimes"
        ? measureSimulatorRuntimes(path)
        : null
    const {
      bytes,
      files,
      denied: wasDenied,
      partial: wasPartial,
    } = runtimeResult?.measurement ??
    measure(path, {
      maxDepth: target.depth ?? Infinity,
      budget: exact ? Infinity : (target.budget ?? Infinity),
      seen,
    })
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

    if (runtimeResult && top > 0) {
      entry.children = runtimeResult.children.slice(0, top)
      entry.detailBytesLowerBound = runtimeResult.measurement.bytes
      entry.detailMeasurementsPartial = runtimeResult.measurement.partial
    }

    // The pnpm store keeps one folder per store FORMAT version and never
    // deletes the old ones, so this single number is really v3 + v10 + v11 with
    // only the newest live. Matched on the path suffix rather than the target id
    // so it works whether or not the target map has been split yet. Gated on
    // `top` like every other drill-down: --no-drill promises "fastest", and
    // sizing three store versions is seconds.
    if (top > 0 && path.endsWith("/pnpm/store")) {
      const versions = storeVersions(path, {
        budget: exact ? Infinity : undefined,
      })
      if (versions.length > 0) {
        entry.storeVersions = versions
        entry.detailBytesLowerBound = versions.reduce(
          (sum, version) => sum + version.bytes,
          0
        )
        entry.detailMeasurementsPartial = versions.some(
          (version) => version.partial
        )
        // A second, disjoint per-version walk may observe more of a budgeted
        // store than the first pass. Keep the strongest honest lower bound.
        if (entry.partial) {
          entry.bytes = Math.max(entry.bytes ?? 0, entry.detailBytesLowerBound)
        }
      }
    }

    // Drill into the big ones only — child measurement re-walks subtrees.
    if (!runtimeResult && !entry.storeVersions && top > 0 && bytes > 1e9) {
      const base = target.childrenDir ? join(path, target.childrenDir) : path
      if (existsSync(base)) {
        const details = children(
          base,
          top,
          new Set(),
          exact ? Infinity : (target.budget ?? Infinity)
        )
        entry.children = details.entries
        entry.detailBytesLowerBound = details.bytes
        entry.detailMeasurementsPartial = details.partial
        entry.denied ||= details.denied
        // The immediate entries are disjoint and share one inode set. If that
        // pass observed more than a truncated parent pass, it is a stronger
        // lower bound—not an estimate.
        if (entry.partial) {
          entry.bytes = Math.max(entry.bytes ?? 0, details.bytes)
        }
      }
    }

    if (entry.denied) denied += 1
    if (entry.partial) partial += 1

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
