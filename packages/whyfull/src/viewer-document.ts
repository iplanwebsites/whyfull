import { open, readFile, stat } from "node:fs/promises"
import type { WhyfullJsonReport } from "./types"
import type { DiskSnapshot } from "./filesystem-types"
import { loadDiskSnapshot } from "./disk-snapshot"
import { defaultScanRoot } from "./drives"
export function emptyViewerSnapshot(): DiskSnapshot {
  const root = defaultScanRoot()
  return {
    format: "whyfull-disk",
    schemaVersion: 1,
    root,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 0,
    status: "complete",
    workers: 1,
    engine: "sync",
    files: 0,
    skippedLinks: 0,
    issues: 0,
    policy: { keep: [], exclude: [] },
    directories: [
      {
        id: 0,
        parent: null,
        path: root,
        name: root,
        children: [],
        topFiles: [],
        ownBytes: 0,
        ownApparentBytes: 0,
        ownFiles: 0,
        bytes: 0,
        apparentBytes: 0,
        files: 0,
        directories: 0,
        issues: 0,
        excluded: 0,
        state: "scanned",
      },
    ],
  }
}
export function validateViewerReport(value: unknown): WhyfullJsonReport {
  const report = value as WhyfullJsonReport
  const number = (n: unknown) =>
    typeof n === "number" && Number.isFinite(n) && n >= 0
  const location = (item: Record<string, unknown>) =>
    item &&
    typeof item.path === "string" &&
    typeof item.name === "string" &&
    number(item.bytes)
  if (
    !report ||
    report.format !== "whyfull-report" ||
    report.schemaVersion !== 1 ||
    !Array.isArray(report.targets) ||
    !number(report.total) ||
    typeof report.generatedAt !== "string" ||
    typeof report.completedAt !== "string" ||
    !Number.isFinite(Date.parse(report.generatedAt)) ||
    !Number.isFinite(Date.parse(report.completedAt)) ||
    !report.summary ||
    report.summary.totalsMayOverlap !== true
  )
    throw new Error("Not a supported whyfull JSON report")
  for (const target of report.targets) {
    if (
      !target ||
      typeof target.id !== "string" ||
      typeof target.label !== "string" ||
      typeof target.hint !== "string" ||
      !["AUTO", "REBUILD", "JUDGEMENT", "APP", "DATA"].includes(target.tier) ||
      (target.path !== null && typeof target.path !== "string") ||
      (target.bytes !== null && !number(target.bytes)) ||
      !Array.isArray(target.children) ||
      target.children.some(
        (child) => !location(child as unknown as Record<string, unknown>)
      )
    )
      throw new Error("Invalid report target")
  }
  for (const section of [report.discovered, report.cacheHogs])
    if (
      section &&
      (!Array.isArray(section.dirs) ||
        section.dirs.some(
          (item) =>
            !location(item as unknown as Record<string, unknown>) ||
            !Array.isArray(item.children) ||
            item.children.some(
              (child) => !location(child as unknown as Record<string, unknown>)
            )
        ))
    )
      throw new Error("Invalid report locations")
  if (
    report.worktrees &&
    (!Array.isArray(report.worktrees.clusters) ||
      report.worktrees.clusters.some(
        (cluster) =>
          !cluster ||
          typeof cluster.mainRepo !== "string" ||
          !Array.isArray(cluster.worktrees) ||
          cluster.worktrees.some(
            (item) =>
              !item ||
              typeof item.state !== "string" ||
              typeof item.path !== "string" ||
              typeof item.name !== "string" ||
              typeof item.hint !== "string" ||
              !number(item.bytes)
          )
      ))
  )
    throw new Error("Invalid worktree report")
  return report
}
export async function loadViewerFile(
  path: string
): Promise<{ snapshot?: DiskSnapshot; report?: WhyfullJsonReport }> {
  const handle = await open(path, "r"),
    buffer = Buffer.alloc(65536)
  let prefix = ""
  try {
    const result = await handle.read(buffer, 0, buffer.length, 0)
    prefix = buffer.subarray(0, result.bytesRead).toString("utf8")
  } finally {
    await handle.close()
  }
  if (
    /"format"\s*:\s*"whyfull-disk"/.test(prefix) ||
    (await stat(path)).size > 64 * 1024 * 1024
  )
    return { snapshot: await loadDiskSnapshot(path) }
  let value
  try {
    value = JSON.parse(await readFile(path, "utf8"))
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error("Choose a valid whyfull JSON report or disk snapshot")
    throw error
  }
  if (value.format === "whyfull-disk")
    return { snapshot: await loadDiskSnapshot(path) }
  return { report: validateViewerReport(value) }
}
