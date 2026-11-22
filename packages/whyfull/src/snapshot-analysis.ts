/** Classify an existing inventory. No filesystem reads or subprocesses. */
import { posix, win32 } from "node:path"
import { buildJsonReport } from "./json"
import type { DiskDirectory, DiskSnapshot } from "./filesystem-types"
import type { ResolvedTarget, ScannedTarget, WhyfullJsonReport } from "./types"

export function analyzeSnapshot(
  snapshot: DiskSnapshot,
  definitions: ResolvedTarget[],
  {
    platform = process.platform,
    top = 5,
  }: { platform?: NodeJS.Platform; top?: number } = {}
): WhyfullJsonReport {
  if (snapshot.status !== "complete")
    throw new Error("Complete the disk scan before generating suggestions")
  const paths = platform === "win32" ? win32 : posix
  const normalize = (path: string) => {
    const normalized = paths.normalize(path).replace(/[\\/]+$/, "") || "/"
    if (platform === "win32") return normalized.toLowerCase()
    return platform === "darwin"
      ? normalized.replace(/^\/System\/Volumes\/Data(?=\/|$)/, "") || "/"
      : normalized
  }
  const partial = new Uint8Array(snapshot.directories.length)
  for (let i = snapshot.directories.length - 1; i >= 0; i--) {
    const node = snapshot.directories[i]!
    partial[i] ||= Number(
      node.state !== "scanned" || node.issues > 0 || node.excluded > 0
    )
    if (node.parent !== null) partial[node.parent] ||= partial[i]!
  }
  const children = (node: DiskDirectory) =>
    node.children
      .map((id) => snapshot.directories[id]!)
      .filter((child) => child.state !== "excluded")
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, top)
      .map((child) => ({
        name: child.name,
        path: child.path,
        bytes: child.bytes,
        atimeMs: -1,
        partial: !!partial[child.id],
      }))
  const candidates = new Map<
    string,
    Array<{ index: number; priority: number }>
  >()
  definitions.forEach((target, index) =>
    target.candidates.forEach((path, priority) => {
      if (!path) return
      const key = normalize(path)
      candidates.set(key, [...(candidates.get(key) ?? []), { index, priority }])
    })
  )
  const matches = new Map<number, { node: DiskDirectory; priority: number }>()
  for (const node of snapshot.directories) {
    if (node.state === "excluded") continue
    for (const match of candidates.get(normalize(node.path)) ?? []) {
      if (
        !matches.has(match.index) ||
        match.priority < matches.get(match.index)!.priority
      )
        matches.set(match.index, { node, priority: match.priority })
    }
  }
  const targets: ScannedTarget[] = definitions.map((target, index) => {
    const node = matches.get(index)?.node
    return {
      ...target,
      path: node?.path ?? null,
      bytes: node
        ? node.state === "unreadable" && node.bytes === 0
          ? null
          : node.bytes
        : null,
      files: node?.files,
      present: !!node,
      denied: node?.state === "unreadable",
      partial: node ? !!partial[node.id] : false,
      detailMeasurementsPartial: node ? !!partial[node.id] : false,
      children: node ? children(node) : [],
    }
  })
  const matchedPaths = new Set(
    [...matches.values()].map(({ node }) => normalize(node.path))
  )
  // Track known descendants in one pass instead of testing every folder against
  // every known path. Candidates outside this inventory are never inspected.
  const covered = new Uint8Array(snapshot.directories.length)
  const additional: Array<{
    node: DiskDirectory
    group: string
    hint: string
  }> = []
  for (const node of snapshot.directories) {
    covered[node.id] = Number(
      matchedPaths.has(normalize(node.path)) ||
        (node.parent !== null && !!covered[node.parent])
    )
    if (node.state !== "scanned" || node.bytes === 0) continue
    const parent =
      node.parent === null ? undefined : snapshot.directories[node.parent]
    const parentPath = parent?.path.replaceAll("\\", "/") ?? ""
    if (
      parent &&
      /(?:^|\/)(?:\.worktrees|worktrees)$/.test(parentPath) &&
      !/\/(?:\.git|\.bare)\/worktrees$/.test(parentPath)
    ) {
      additional.push({
        node,
        group: "Worktrees",
        hint: "Possible worktree folder. Verify Git registration, uncommitted changes, and current use before cleanup; the size tree does not contain Git status.",
      })
      continue
    }
    if (covered[node.id]) continue
    if (
      node.name === "cache" &&
      parent?.name === ".turbo" &&
      node.bytes >= 250e6 &&
      !/(?:^|\/)node_modules(?:\/|$)/.test(node.path.replaceAll("\\", "/"))
    ) {
      additional.push({
        node,
        group: "Build caches",
        hint: "Turbo build cache. Its archived build outputs can be regenerated; review recent use, then move this cache folder to Trash if the rebuild cost is acceptable.",
      })
      continue
    }
    if (
      parent &&
      /(?:^|\/)(?:\.cache|Library\/Caches|AppData\/Local\/Temp)$/i.test(
        parentPath
      )
    )
      additional.push({
        node,
        group: "Untracked caches",
        hint: "Inspect this cache and quit its owning app before considering cleanup. Its size comes from the disk inventory.",
      })
    else if (
      node.bytes >= 1024 ** 3 &&
      parent &&
      (parent.parent === null ||
        /(?:^|\/)(?:Downloads|Desktop|Documents|Applications|Application Support)$/.test(
          parentPath
        ))
    )
      additional.push({
        node,
        group: "Large folders",
        hint: "Inspect this folder and confirm what owns it before deciding what to keep. Size alone does not establish that it is disposable.",
      })
  }
  if (!targets.some((item) => item.present) && !additional.length) {
    const node = snapshot.directories[0]
    if (node && node.state !== "excluded")
      additional.push({
        node,
        group: "Scanned folder",
        hint: "Review the measured subfolders to identify what uses this space. No known cleanup rule matched this inventory.",
      })
  }
  for (const { node, group, hint } of additional
    .sort((a, b) => b.node.bytes - a.node.bytes)
    .slice(0, 100)) {
    targets.push({
      id: `inventory:${node.id}`,
      label: node.name,
      group,
      tier:
        group === "Build caches"
          ? "REBUILD"
          : group === "Untracked caches" || group === "Worktrees"
            ? "JUDGEMENT"
            : "DATA",
      hint,
      path: node.path,
      candidates: [node.path],
      paths: { darwin: [], linux: [], win32: [] },
      bytes:
        node.state === "unreadable" && node.bytes === 0 ? null : node.bytes,
      present: true,
      denied: node.state === "unreadable",
      partial: !!partial[node.id],
      detailMeasurementsPartial: !!partial[node.id],
      files: node.files,
      children: children(node),
    })
  }
  const report = buildJsonReport({
    report: {
      platform,
      volume: null,
      targets,
      denied: targets.filter((target) => target.denied).length,
      partial: targets.filter((target) => target.partial).length,
      exact: !partial[0],
      total: targets.reduce((sum, target) => sum + (target.bytes ?? 0), 0),
      generatedAt: snapshot.completedAt ?? snapshot.startedAt,
    },
    options: {
      top,
      showAll: false,
      exact: !partial[0],
      discover: true,
      cacheScan: true,
      worktrees: false,
      worktreeRoots: [],
      worktreeAge: 0,
    },
    durationMs: 0,
  })
  report.completedAt = snapshot.completedAt ?? snapshot.startedAt
  report.inventory = {
    root: snapshot.root,
    startedAt: snapshot.startedAt,
    completedAt: snapshot.completedAt ?? snapshot.startedAt,
    basis: "allocated-bytes",
    limitations: [
      "Derived from the completed disk inventory; no additional filesystem scan or command was run.",
      "Locations outside this inventory are not checked. Missing matches do not establish that a location is absent.",
      "Allocated bytes and partial measurements are reused as recorded; totals may overlap.",
      "Git registration, branch, activity, dirty status, pnpm sharing, and simulator metadata are not verified by the size tree.",
    ],
  }
  return report
}
