/**
 * Directory sizing. Zero dependencies, no child processes.
 *
 * Why not shell out to `du`: measuring an 86 GB HuggingFace cache took `du -sx`
 * 2m23s and this walker 0.08s. `du` forks a process, re-stats paths we already
 * hold dirents for, and on macOS silently reports nothing for TCC-protected
 * directories rather than failing loudly.
 */

import { readdirSync, lstatSync, statfsSync } from "node:fs"
import { join } from "node:path"
import type { MeasureResult, MeasureOptions, VolumeInfo } from "./types"

/**
 * Bytes actually allocated on disk, not apparent size.
 *
 * `st.blocks` counts 512-byte units the filesystem really reserved, so sparse
 * files (Docker's VM image is one) and compressed files report their true cost.
 * `st.size` would overstate a 63 GB sparse image dramatically.
 *
 * Hard links and symlinks are counted once, by inode: a pnpm store or HF cache
 * is mostly links into a blob dir, so naive counting inflates them several
 * times over. This is the same reason `du` sums are unreliable across sections.
 */
export function measure(
  path: string,
  opts: MeasureOptions = {}
): MeasureResult {
  const {
    maxDepth = Infinity,
    seen = new Set<string>(),
    budget = Infinity,
  } = opts

  let bytes = 0
  let files = 0
  let denied = false
  let truncated = false

  const stack: Array<{ dir: string; depth: number }> = [{ dir: path, depth: 0 }]

  // Iterative, not recursive: a deep node_modules or venv tree can exceed the
  // call stack, and this must never throw on a user's machine.
  while (stack.length > 0) {
    // Package stores are pathological: the pnpm store here is 28 GB spread
    // over 633k tiny files, and stat-ing each takes 80s while a 92 GB model
    // cache of 483 large files takes 0.04s. Cost tracks inode count, not size.
    // Past the budget we stop walking and extrapolate from what we sampled,
    // reporting the result as an estimate rather than a silent undercount.
    if (files >= budget) {
      truncated = true
      break
    }

    const item = stack.pop()!
    const { dir, depth } = item

    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (err) {
      // EACCES/EPERM is the TCC case (Mail, Photos). Report it rather than
      // letting a protected directory read as empty.
      if (
        err instanceof Error &&
        "code" in err &&
        (err.code === "EACCES" || err.code === "EPERM")
      ) {
        denied = true
      }
      continue
    }

    for (const entry of entries) {
      const full = join(dir, entry.name)

      // Never follow symlinks: HF snapshots symlink into ../../blobs, and
      // following them double-counts every blob. The link itself is ~0 bytes.
      if (entry.isSymbolicLink()) continue

      if (entry.isDirectory()) {
        if (depth < maxDepth) stack.push({ dir: full, depth: depth + 1 })
        continue
      }

      let st
      try {
        st = lstatSync(full)
      } catch {
        continue
      }

      // Count a multiply-linked inode once. Single-link files skip the Set
      // entirely — that is the common case and Set churn is measurable.
      if (st.nlink > 1) {
        const key = `${st.dev}:${st.ino}`
        if (seen.has(key)) continue
        seen.add(key)
      }

      bytes += st.blocks * 512
      files += 1
    }
  }

  // A truncated walk reports what it actually measured and says so. Guessing
  // the unvisited remainder was tried and removed: any extrapolation factor is
  // unjustifiable, and a confidently wrong "31.2 GB" is worse than "≥26 GB".
  return { bytes, files, denied, partial: truncated, pending: stack.length }
}

/** Volume capacity via statfs. No `df` parsing, works on Windows too. */
export function volume(path: string): VolumeInfo | null {
  try {
    const st = statfsSync(path)
    const total = st.blocks * st.bsize
    const free = st.bavail * st.bsize
    return { total, free, used: total - free }
  } catch {
    return null
  }
}

/** 1234567890 -> "1.15 GB". Binary units, matching what OS disk UIs report. */
export function human(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i += 1
  }
  return `${n < 10 && i > 1 ? n.toFixed(2) : n.toFixed(i > 1 ? 1 : 0)} ${units[i]}`
}
