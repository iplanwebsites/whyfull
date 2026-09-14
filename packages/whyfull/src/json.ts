/** Versioned JSON report construction and explicit, non-overwriting saves. */

import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { byTier } from "./scan"
import { TIERS } from "./targets"
import type {
  BuildJsonReportOptions,
  WhyfullJsonReport,
  WorktreeTool,
} from "./types"

export const JSON_SCHEMA_VERSION = 1 as const

export function buildJsonReport({
  report,
  options,
  durationMs,
  discovered = null,
  cacheHogs = null,
  worktrees = null,
}: BuildJsonReportOptions): WhyfullJsonReport {
  const allWorktrees = worktrees?.clusters.flatMap((c) => c.worktrees) ?? []
  const worktreeCountsByTool: Partial<Record<WorktreeTool, number>> = {}
  for (const worktree of allWorktrees) {
    worktreeCountsByTool[worktree.tool] =
      (worktreeCountsByTool[worktree.tool] ?? 0) + 1
  }

  const reclaimCandidateBytesLowerBound = byTier(report)
    .filter((tier) => tier.rank <= 3)
    .reduce((sum, tier) => sum + tier.bytes, 0)

  return {
    ...report,
    format: "whyfull-report",
    schemaVersion: JSON_SCHEMA_VERSION,
    completedAt: new Date().toISOString(),
    durationMs,
    runtime: {
      nodeVersion: process.version,
      arch: process.arch,
    },
    options,
    tierDefinitions: TIERS,
    summary: {
      knownBytesLowerBound: report.total,
      reclaimCandidateBytesLowerBound,
      knownMeasurementsPartial: report.partial > 0,
      presentTargetCount: report.targets.filter((target) => target.present)
        .length,
      deniedTargetCount: report.denied,
      untrackedCacheBytesLowerBound:
        cacheHogs?.dirs.reduce((sum, entry) => sum + entry.bytes, 0) ?? 0,
      discoveredBytesLowerBound:
        discovered?.dirs.reduce((sum, entry) => sum + entry.bytes, 0) ?? 0,
      worktreeCount: allWorktrees.length,
      worktreeApparentBytesLowerBound:
        worktrees?.clusters.reduce((sum, cluster) => sum + cluster.bytes, 0) ??
        0,
      worktreeNonSharedBytesLowerBound:
        worktrees?.clusters.reduce(
          (sum, cluster) => sum + cluster.realBytes,
          0
        ) ?? 0,
      worktreeMeasurementsPartial: allWorktrees.some(
        (worktree) => worktree.partial
      ),
      worktreeCountsByTool,
      totalsMayOverlap: true,
    },
    ...(discovered ? { discovered } : {}),
    ...(cacheHogs ? { cacheHogs } : {}),
    ...(worktrees ? { worktrees } : {}),
  }
}

/**
 * Save a private report without replacing an existing file. Reports contain
 * absolute local paths, so owner-only permissions are intentional.
 */
export function saveJsonReport(
  path: string,
  report: WhyfullJsonReport
): string {
  const full = resolve(path)
  writeFileSync(full, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  })
  return full
}
