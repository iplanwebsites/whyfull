/**
 * pnpm-specific reads. Pure node:fs, no child processes — `pnpm store path`
 * would be the obvious way to find the store and is exactly what we cannot do.
 *
 * Two independent jobs live here because they share the same parsing:
 *  - storeVersions(): the store keeps one folder per store FORMAT version and
 *    never deletes the old ones, so a 44 GB "pnpm store" is really v3 + v10 +
 *    v11 where only the newest is live. `pnpm store prune` will not touch v3.
 *  - sharedStore(): on macOS pnpm's default import method is clonefile(2), so a
 *    worktree's node_modules has its own inodes and reports full size to any
 *    walker while costing almost nothing on disk. We cannot read clone IDs from
 *    Node, so the heuristic is "this node_modules names a storeDir on the same
 *    device" and the label says it is a heuristic.
 */

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { measure } from "./size"
import type { StoreVersion, SharedStoreInfo } from "./types"

/** 90 days: the same "nobody has touched this" window the report uses. */
const STALE_MS = 90 * 86400000

/**
 * `storeDir` out of a `.modules.yaml` without a YAML (or JSON) parser.
 *
 * The file is pnpm's own writer output, not hand-edited, but the format is
 * NOT stable across pnpm versions: pnpm <=11 (and most `.modules.yaml` docs)
 * write bare YAML with the key at column 0 — `storeDir: /path` — while pnpm
 * 12 writes the same file as JSON — `  "storeDir": "/path",` — indented,
 * quoted key, `": "` separator, trailing comma. Both are matched here rather
 * than assuming one; a real parser would have to load the whole
 * hoistedDependencies map, which is megabytes on a big monorepo.
 */
export function readModulesStoreDir(modulesYaml: string): string | null {
  let text
  try {
    text = readFileSync(modulesYaml, "utf8")
  } catch {
    return null
  }
  // Matches both shapes: an optional leading quote around the key, optional
  // indentation, `:` then optional space, then a quoted-or-bare value with an
  // optional trailing comma (JSON) before end of line.
  const m = /^[ \t]*['"]?storeDir['"]?:[ \t]*(.+?)[ \t]*,?[ \t]*$/m.exec(text)
  if (!m) return null
  // pnpm quotes the value only when it needs to (YAML) or always (JSON);
  // strip either quote style.
  return m[1].replace(/^['"]|['"]$/g, "") || null
}

/**
 * Does `dir/node_modules` (or `dir` itself, for a virtual store) hold files
 * that are clones/links of a pnpm store on the same device?
 *
 * Same-device is the load-bearing check: a store on another volume cannot be
 * hard-linked or cloned from, so those bytes are genuinely duplicated.
 */
export function sharedStore(dir: string): SharedStoreInfo | null {
  // A `.pnpm` virtual store dir IS the link farm; its parent holds the yaml.
  const base = dir.endsWith("/.pnpm") ? dir.slice(0, -6) : dir
  const yaml = base.endsWith("/node_modules")
    ? join(base, ".modules.yaml")
    : join(base, "node_modules", ".modules.yaml")

  const storeDir = readModulesStoreDir(yaml)
  if (!storeDir) return null

  try {
    const here = statSync(dir)
    const there = statSync(storeDir)
    if (here.dev !== there.dev) return null
    return { storeDir, sameDevice: true }
  } catch {
    // A storeDir that no longer exists means the links are already broken
    // copies, so the bytes are real. Treat it as not shared.
    return null
  }
}

/** Numeric part of a `v<N>` store folder, or -1 for anything else. */
function versionNumber(name: string): number {
  const m = /^v(\d+)$/.exec(name)
  return m ? Number(m[1]) : -1
}

/**
 * List the `v*` folders inside a pnpm store root, newest first, flagging the
 * ones no current pnpm can read.
 *
 * Deliberately cheap: no scan of every project's `.modules.yaml` to prove
 * nothing references an old version. mtime against the newest version's
 * birthtime is enough to say "written by a pnpm nobody runs any more", and the
 * report phrases the suggestion as a judgement call rather than a fact.
 */
export function storeVersions(
  storeDir: string,
  opts: { budget?: number } = {}
): StoreVersion[] {
  // 20000 files per version, not the target's budget. The staleness verdict —
  // the actionable part — comes from mtime and birthtime, which are two stat
  // calls; the sizes are only there to rank the folders. A store version is
  // 300k+ tiny files and saturates any budget, so a bigger one buys a slightly
  // less-truncated "≥" and costs seconds per version.
  const { budget = 20000 } = opts

  let entries
  try {
    entries = readdirSync(storeDir, { withFileTypes: true })
  } catch {
    return []
  }

  const versions: StoreVersion[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    const n = versionNumber(entry.name)
    if (n < 0) continue

    const full = join(storeDir, entry.name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }

    // Each version gets its own `seen` set: they share no inodes with each
    // other, and a shared set would attribute v3's blobs to whichever ran first.
    const { bytes, files, partial } = measure(full, {
      seen: new Set(),
      budget,
    })

    versions.push({
      name: entry.name,
      path: full,
      version: n,
      bytes,
      files,
      partial,
      mtimeMs: st.mtimeMs,
      birthtimeMs: st.birthtimeMs,
      stale: false,
    })
  }

  versions.sort((a, b) => b.version - a.version)
  const newest = versions[0]
  if (!newest) return versions

  const now = Date.now()
  for (const v of versions) {
    if (v === newest) continue
    // birthtime of the newest version is when the current pnpm took over. A
    // version not written since then is one nothing links from any more.
    v.stale = v.mtimeMs < newest.birthtimeMs || now - v.mtimeMs > STALE_MS
  }

  return versions
}
