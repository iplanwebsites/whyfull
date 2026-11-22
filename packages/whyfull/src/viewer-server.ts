import { isSmallEntry } from "./viewer-noise"
import { measureFileDistribution } from "./file-distribution"
import { pipeline } from "node:stream/promises"
import { analyzeSnapshot } from "./snapshot-analysis"
import { DiagnosticRunner, reportArguments } from "./diagnostics"
import { tmpdir, homedir } from "node:os"
import { listScanDrives } from "./drives"
import type { ScanDrive } from "./drives"
import {
  emptyViewerSnapshot,
  loadViewerFile,
  validateViewerReport,
} from "./viewer-document"
import type { WhyfullJsonReport } from "./types"
import { createServer } from "node:http"
import type { IncomingMessage, ServerResponse } from "node:http"
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto"
import { createWriteStream, readFileSync, statSync } from "node:fs"
import { Readable, Transform } from "node:stream"
import { lstat, stat, readdir, realpath, mkdtemp, rm } from "node:fs/promises"
import { basename, isAbsolute, join } from "node:path"
import { execFile, spawn } from "node:child_process"
import { DiskScanner } from "./filesystem"
import { RustScanner } from "./rust-scanner"
import {
  sqliteInventory,
  inventoryWorkingDirectory,
  rustScannerAvailability,
} from "./sqlite-inventory"
import {
  loadDirectoryMarks,
  clearDirectoryMark,
  saveDirectoryMark,
  policyPath,
  defaultPolicyPath,
  loadDiskPolicy,
  normalizePolicyPath,
  pathWithin,
  saveDiskPolicy,
  loadViewerPreferences,
  saveViewerPreferences,
} from "./disk-policy"
import { forPlatform, TIERS } from "./targets"
import { privacyPromptPaths } from "./privacy"
import { volume } from "./size"
import type {
  DiskDirectory,
  DiskPolicy,
  DiskScanOptions,
  DiskSnapshot,
} from "./filesystem-types"
import {
  diskSnapshotChunks,
  saveDiskSnapshot,
  loadDiskSnapshot,
} from "./disk-snapshot"
export { loadDiskSnapshot, saveDiskSnapshot } from "./disk-snapshot"
import { TrashController } from "./trash"
import { ScanCompletionEstimate } from "./scan-progress"
import { ScanCache } from "./scan-cache"
import { DesktopLicense, licensePageUrl } from "./license"
import { openExternalUrl } from "./open-url"
import {
  loadKnowledge,
  updateKnowledge,
  locationProposal,
  knowledgeContext,
} from "./knowledge"

export interface ViewerOptions extends DiskScanOptions {
  open?: boolean
  /** Open the viewer without starting a filesystem scan. */
  scanOnStart?: boolean
  /** Keep folder inventories in the selected root's .whyfull directory. */
  directoryMode?: boolean
  /** Disable persistent scan cache reads and writes when false. */
  cache?: boolean
  policyFile?: string
  snapshot?: DiskSnapshot
  report?: WhyfullJsonReport
  sourceName?: string
  drives?: () => ScanDrive[]
  saveTo?: string
  finder?: (path: string) => Promise<void>
  allowTrash?: boolean
  /** Desktop app only: enable the honor-system license reminder. */
  license?: { publicKey?: string; openUrl?: (url: string) => Promise<void> }
}

export async function startViewer(options: ViewerOptions) {
  const diagnostics = new DiagnosticRunner()
  const homeDirectory = await realpath(homedir())
  const homeDevice = statSync(homeDirectory).dev
  const token = randomBytes(32).toString("hex")
  const policyFile = options.policyFile ?? defaultPolicyPath()
  const policy = loadDiskPolicy(policyFile)
  let viewerPreferences = loadViewerPreferences(policyFile)
  const license = options.license
    ? new DesktopLicense({
        policyFile,
        publicKey: options.license.publicKey,
      })
    : null
  license?.recordUse()
  const rustAvailability = rustScannerAvailability(options.rustBinary)
  let selectedScanner =
    options.scanner ??
    (rustAvailability.available ? viewerPreferences.scanner : "node")
  const createScanner = (
    scanOptions: DiskScanOptions
  ): DiskScanner | RustScanner =>
    selectedScanner === "rust"
      ? new RustScanner({
          ...scanOptions,
          includePrivate: viewerPreferences.scanPrivateFolders,
          scanner: "rust",
          inventoryDirectory:
            options.inventoryDirectory ??
            options.rustDirectory ??
            inventoryWorkingDirectory(policyFile),
        })
      : new DiskScanner({
          ...scanOptions,
          includePrivate: viewerPreferences.scanPrivateFolders,
          scanner: "node",
          inventoryDirectory:
            options.inventoryDirectory ??
            options.rustDirectory ??
            inventoryWorkingDirectory(policyFile),
        })
  const scanPolicy: DiskPolicy = {
    keep: [...policy.keep, ...(options.policy?.keep ?? [])],
    exclude: [...policy.exclude, ...(options.policy?.exclude ?? [])],
  }
  if (options.report && options.snapshot)
    throw new Error("Choose a report or a snapshot")
  let report = options.report ? validateViewerReport(options.report) : null
  let snapshotMode = !!options.snapshot || !!report
  let sourceName = options.sourceName ?? null
  let documentId: string = randomUUID()
  const drives = options.drives ?? listScanDrives
  let switching = false
  let scanner = snapshotMode
    ? null
    : createScanner({ ...options, policy: scanPolicy })
  const scanCache = ScanCache.forConfig(policyFile, options.cache !== false)
  const exportRoot = normalizePolicyPath(options.root)
  let exportPending = !!options.saveTo
  const directoryRoot = options.directoryMode
    ? normalizePolicyPath(options.root)
    : null
  const directoryDevice = directoryRoot ? statSync(directoryRoot).dev : null
  const cacheFor = (root: string) =>
    directoryRoot && pathWithin(policyPath(root), policyPath(directoryRoot))
      ? ScanCache.forDirectory(root, options.cache !== false)
      : scanCache
  let initialCache = scanner
    ? await cacheFor(scanner.snapshot.root).load(scanner.snapshot.root, {
        ...options,
        scanner: selectedScanner,
        policy: scanner.snapshot.policy,
        includePrivate: viewerPreferences.scanPrivateFolders,
      })
    : null
  let snapshot =
    options.snapshot ??
    (report ? emptyViewerSnapshot() : (initialCache ?? scanner!.snapshot))
  let awaitingScan =
    options.scanOnStart === false && !snapshotMode && !initialCache
  if (options.scanOnStart === false) {
    scanner?.cancel()
    scanner = null
  }
  // Avoid retaining a multi-gigabyte initial inventory after switching documents.
  options = { ...options, snapshot: undefined, report: undefined }
  let savedPolicy = policy
  let saveError: string | null = null
  let savedPath: string | null = initialCache
    ? (sqliteInventory(snapshot)?.file ??
      cacheFor(snapshot.root).path(snapshot.root))
    : null
  type ScanSession = {
    root: string
    documentId: string
    scanner: DiskScanner | RustScanner | null
    snapshot: DiskSnapshot | null
    file: string | null
    writing?: Promise<void>
    moved: string[]
    saveError: string | null
    savedPath: string | null
    device: number | null
    snapshotMode: boolean
    sourceName: string | null
    state: DiskSnapshot["status"]
    revision: number
    cached: boolean
    refreshing: boolean
    running?: Promise<void>
    lastCompletedAt: string | null
    lastDurationMs: number | null
    completionEstimate: ScanCompletionEstimate
  }
  const sessions = new Map<string, ScanSession>()
  const documents = new Map<string, ScanSession>()
  const archiveWrites = new Set<Promise<void>>()
  const scanRuns = new Set<Promise<void>>()
  let sessionFolder: Promise<string> | undefined
  let closed = false
  let activeSession: ScanSession | null = report ? null : rememberScan()
  if (activeSession) activeSession.cached = !!initialCache
  initialCache = null
  function rememberScan(): ScanSession {
    let device: number | null = null
    try {
      device = statSync(snapshot.root).dev
    } catch {
      /* Offline snapshots remain navigable. */
    }
    const session: ScanSession = {
      root: snapshot.root,
      documentId,
      scanner,
      snapshot,
      file: null,
      moved: [],
      saveError,
      savedPath,
      device,
      snapshotMode,
      sourceName,
      state: snapshot.status,
      lastCompletedAt:
        snapshot.status === "complete" ? snapshot.completedAt : null,
      lastDurationMs:
        snapshot.status === "complete" ? snapshot.durationMs : null,
      revision: 0,
      cached: false,
      refreshing: !!scanner && snapshot !== scanner.snapshot,
      completionEstimate: new ScanCompletionEstimate(
        scanner && snapshot !== scanner.snapshot
          ? snapshot.directories.length - snapshot.directories[0].excluded
          : null
      ),
    }
    documents.set(session.documentId, session)
    if (!snapshotMode || !sessions.has(session.root))
      sessions.set(session.root, session)
    return session
  }
  // Only active/running inventories stay in memory. Completed scans remain
  // available for this viewer session in owner-only temporary snapshot files.
  async function archiveSession(session: ScanSession) {
    if (session.writing) return session.writing
    if (
      !session.snapshot ||
      session.snapshot.status === "scanning" ||
      session.refreshing
    )
      return
    const native = sqliteInventory(session.snapshot)
    if (native) {
      native.suspend()
      if (activeSession !== session) session.scanner = null
      return
    }
    session.state = session.snapshot.status
    session.writing = (async () => {
      if (!session.file) {
        sessionFolder ??= mkdtemp(join(tmpdir(), "whyfull-scans-"))
        const file = join(await sessionFolder, `${session.documentId}.json`)
        try {
          await saveDiskSnapshot(session.snapshot!, file)
          session.file = file
        } catch (error) {
          await rm(file, { force: true })
          throw error
        }
      }
      if (activeSession !== session) {
        session.snapshot = null
        session.scanner = null
      }
    })()
    const writing = session.writing
    archiveWrites.add(writing)
    try {
      await writing
    } finally {
      archiveWrites.delete(writing)
      session.writing = undefined
    }
  }
  async function leaveScan(discardRoot?: string) {
    const previous = activeSession
    if (!previous) return
    previous.moved = [...trash.moved]
    previous.saveError = saveError
    previous.savedPath = savedPath
    activeSession = null
    if (previous.root === discardRoot) {
      await forgetScan(previous)
      return
    }
    try {
      await archiveSession(previous)
    } catch (error) {
      activeSession = previous
      throw error
    }
  }
  async function forgetScan(session: ScanSession) {
    documents.delete(session.documentId)
    if (sessions.get(session.root) === session) sessions.delete(session.root)
    session.scanner?.cancel()
    await session.writing
    if (session.file) await rm(session.file, { force: true }).catch(() => {})
    if (session.snapshot) sqliteInventory(session.snapshot)?.dispose()
    session.snapshot = null
    session.scanner = null
  }
  let marks = loadDirectoryMarks(policyFile)
  const trash = new TrashController({
    snapshot: () => snapshot,
    policy: () => ({
      keep: [...savedPolicy.keep, ...(options.policy?.keep ?? [])],
      exclude: [...savedPolicy.exclude, ...snapshot.policy.exclude],
    }),
    allowTrash: options.allowTrash,
    snapshotMode: () =>
      snapshotMode || !!activeSession?.cached || !!activeSession?.refreshing,
  })
  const assets = JSON.parse(
    readFileSync(new URL("./viewer/assets.json", import.meta.url), "utf8")
  ) as Record<string, { file: string; type: string }>
  const shell = readFileSync(
    new URL("./viewer/index.html", import.meta.url),
    "utf8"
  )
  // Keep running viewers consistent when a local rebuild replaces dist files.
  const assetContents = new Map(
    Object.values(assets).map((asset) => [
      asset.file,
      readFileSync(new URL(`./viewer/${asset.file}`, import.meta.url)),
    ])
  )
  const scriptHashes = [
    ...shell.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi),
  ]
    .filter((match) => match[1].trim())
    .map(
      (match) =>
        `'sha256-${createHash("sha256").update(match[1]).digest("base64")}'`
    )
    .join(" ")
  let knowledge = loadKnowledge(policyFile)
  let resolvedTargets = forPlatform(process.platform, policyFile)
  const targetPaths = () =>
    resolvedTargets
      .flatMap((target) =>
        target.candidates
          .filter((p): p is string => !!p)
          .map((path) => ({ path, target }))
      )
      .sort((a, b) => b.path.length - a.path.length)
  let targets = targetPaths()
  function refreshKnowledge() {
    const next = loadKnowledge(policyFile)
    if (next.revision !== knowledge.revision) {
      knowledge = next
      resolvedTargets = forPlatform(process.platform, policyFile)
      targets = targetPaths()
      inventoryReports = new WeakMap()
    }
  }
  const canonical = (path: string) =>
    process.platform === "darwin" &&
    (path === "/System/Volumes/Data" ||
      path.startsWith("/System/Volumes/Data/"))
      ? path.slice("/System/Volumes/Data".length) || "/"
      : path
  function describe(path: string) {
    const kept = savedPolicy.keep.some((p) =>
      pathWithin(canonical(path), canonical(p))
    )
    const directKeep = savedPolicy.keep.some(
      (p) => canonical(path) === canonical(p)
    )
    const match = targets.find((t) =>
      pathWithin(canonical(path), canonical(t.path))
    )?.target
    return {
      mark: marks[policyPath(path)] ?? null,
      kept,
      directKeep,
      trashed: [...trash.moved].some((p) => pathWithin(path, p)),
      ...(match
        ? {
            tier: match.tier,
            tool: match.label,
            advice: kept ? "Kept by your preference" : match.hint,
          }
        : {
            advice: kept
              ? "Kept by your preference"
              : "Inspect before removing. This location has no cleanup recommendation.",
          }),
    }
  }
  let colorDocument = ""
  let colorState = ""
  const colorPaths = new Map<number, number[]>()
  const siblingRanks = new Map<number, Map<number, number>>()
  function resetColors() {
    colorDocument = documentId
    colorState = snapshot.status
    colorPaths.clear()
    siblingRanks.clear()
  }
  function colorPath(node: DiskDirectory): number[] {
    if (colorDocument !== documentId || colorState !== snapshot.status)
      resetColors()
    const cached = colorPaths.get(node.id)
    if (cached) return cached
    if (node.parent === null) {
      colorPaths.set(node.id, [])
      return []
    }
    const native = sqliteInventory(snapshot)
    if (native) {
      const path = [
        ...colorPath(native.get(node.parent, false)!),
        native.rank(node),
      ]
      if (colorPaths.size > 2048) colorPaths.clear()
      colorPaths.set(node.id, path)
      return path
    }
    const parent = snapshot.directories[node.parent]!
    let ranks = siblingRanks.get(parent.id)
    if (!ranks) {
      ranks = new Map(
        [...parent.children]
          .sort(
            (a, b) =>
              snapshot.directories[b]!.bytes - snapshot.directories[a]!.bytes ||
              snapshot.directories[a]!.path.localeCompare(
                snapshot.directories[b]!.path
              )
          )
          .map((id, rank) => [id, rank])
      )
      siblingRanks.set(parent.id, ranks)
    }
    const path = [...colorPath(parent), ranks.get(node.id) ?? 0]
    colorPaths.set(node.id, path)
    return path
  }
  function tree(node: DiskDirectory, depth: number): Record<string, unknown> {
    const out: Record<string, unknown> = {
      id: `d${node.id}`,
      name: node.name,
      path: node.path,
      colorPath: colorPath(node),
      value: node.bytes,
      apparentBytes: node.apparentBytes,
      kind: "directory",
      state: node.state,
      files: node.files,
      issues: node.issues,
      excluded: node.excluded,
      reason: node.reason,
      ...describe(node.path),
    }
    if (depth <= 0 || node.state === "excluded") return out
    const native = sqliteInventory(snapshot)
    const limit = depth === 3 ? 48 : depth === 2 ? 16 : 8
    const childNodes = native
      ? native.children(node.id, limit)
      : node.children.map((id) => snapshot.directories[id])
    const children: Record<string, unknown>[] = childNodes.map((child) => ({
      id: `d${child.id}`,
      name: child.name,
      value: child.bytes,
      kind: "directory",
    }))
    const visibleFiles = node.topFiles
      .map((file, i) => ({ file, i }))
      .filter(
        ({ file }) => !isSmallEntry(file.bytes, viewerPreferences.minFileBytes)
      )
    children.push(
      ...visibleFiles.map(({ file, i }) => ({
        id: `f${node.id}-${i}`,
        name: file.name,
        path: join(node.path, file.name),
        kind: "file",
        value: file.bytes,
        apparentBytes: file.apparentBytes,
      }))
    )
    const remainder = Math.max(
      0,
      node.ownBytes -
        visibleFiles.reduce((sum, { file }) => sum + file.bytes, 0)
    )
    const remainingCount = Math.max(0, node.ownFiles - visibleFiles.length)
    if (remainingCount)
      children.push({
        id: `r${node.id}`,
        name: `${remainingCount.toLocaleString()} ${remainingCount === 1 ? "file" : "files"}`,
        files: remainingCount,
        value: remainder,
        kind: "remainder",
        path: node.path,
        advice:
          "All files were measured. Use “All direct files” in the list to inspect files outside the retained largest files.",
      })
    children.sort((a, b) => Number(b.value) - Number(a.value))
    const visible = children
      .slice(0, limit)
      .map((child) =>
        child.kind === "directory"
          ? tree(
              native?.get(Number(String(child.id).slice(1)), false) ??
                snapshot.directories[Number(String(child.id).slice(1))],
              depth - 1
            )
          : { ...child, ...(child.path ? describe(String(child.path)) : {}) }
      )
    const missingDirectories = native
      ? native.childCount(node.id) - childNodes.length
      : 0
    if (children.length > limit || missingDirectories > 0) {
      const hidden = children.slice(limit)
      const filesOnly =
        !missingDirectories &&
        hidden.every(
          (child) => child.kind === "file" || child.kind === "remainder"
        )
      const files = filesOnly
        ? hidden.reduce(
            (count, child) =>
              count + (child.kind === "file" ? 1 : Number(child.files)),
            0
          )
        : undefined
      visible.push({
        id: `g${node.id}`,
        name:
          files !== undefined
            ? `${files.toLocaleString()} ${files === 1 ? "file" : "files"}`
            : `${hidden.length + missingDirectories} smaller entries`,
        files,
        value:
          hidden.reduce((s, n) => s + Number(n.value), 0) +
          (native
            ? Math.max(
                0,
                node.bytes -
                  node.ownBytes -
                  childNodes.reduce((sum, child) => sum + child.bytes, 0)
              )
            : 0),
        kind: "group",
        advice: "Use the searchable list to browse every folder.",
      })
    }
    out.children = visible
    return out
  }
  let inventoryReports = new WeakMap<DiskSnapshot, WhyfullJsonReport>()
  function analysisInventory(source: DiskSnapshot) {
    return (
      sqliteInventory(source)?.projection(
        targets.map((target) => target.path)
      ) ?? source
    )
  }
  function inventoryReport(tree: DiskSnapshot) {
    if (tree.status !== "complete") return null
    let generated = inventoryReports.get(tree)
    if (!generated) {
      generated = analyzeSnapshot(analysisInventory(tree), resolvedTargets)
      if (sqliteInventory(tree))
        generated.inventory?.limitations.push(
          "Disk inventory suggestions use known locations and a bounded selection of the largest folders. Browse the inventory for all other folders."
        )
      generated.localContext = knowledgeContext(knowledge)
      inventoryReports.set(tree, generated)
    }
    return generated
  }
  function analysisReport() {
    return report ?? inventoryReport(snapshot)
  }
  function diagnosticStatus() {
    const status = diagnostics.status()
    return {
      ...status,
      commands: status.commands.map((command) =>
        command.id === "whyfull"
          ? {
              ...command,
              label: "Inventory suggestions",
              command: "Analyze completed disk inventory",
            }
          : command
      ),
    }
  }
  function reportLocations(source = report) {
    const locations = new Map<
      string,
      { path: string; bytes: number | null; partial: boolean }
    >()
    const add = (
      path: string | null,
      bytes: number | null,
      partial = false
    ) => {
      if (path && isAbsolute(path))
        locations.set(path, { path, bytes, partial })
    }
    for (const target of source?.targets ?? []) {
      if (target.present || target.denied)
        add(
          target.path,
          target.bytes,
          !!target.partial ||
            !!target.detailMeasurementsPartial ||
            !!target.denied
        )
      for (const child of target.children)
        add(child.path, child.bytes, !!target.detailMeasurementsPartial)
      for (const version of target.storeVersions ?? [])
        add(version.path, version.bytes, !!version.partial)
    }
    for (const section of [source?.cacheHogs, source?.discovered])
      for (const item of section?.dirs ?? []) {
        add(item.path, item.bytes)
        for (const child of item.children) add(child.path, child.bytes)
      }
    for (const cluster of source?.worktrees?.clusters ?? [])
      for (const item of cluster.worktrees)
        add(item.path, item.bytes, item.partial)
    return locations
  }
  let shortlistCache: {
    documentId: string
    marks: typeof marks
    indexed: Map<string, DiskDirectory>
    count: number
  } | null = null
  function shortlistDirectories() {
    const native = sqliteInventory(snapshot)
    if (native) {
      const indexed = new Map<string, DiskDirectory>()
      for (const path of Object.keys(marks)) {
        const id = native.findPath(path),
          node = native.get(id, false)
        if (node) indexed.set(path, node)
      }
      return indexed
    }
    if (
      !shortlistCache ||
      shortlistCache.documentId !== documentId ||
      shortlistCache.marks !== marks
    )
      shortlistCache = {
        documentId,
        marks,
        indexed: new Map(),
        count: 0,
      }
    if (Object.keys(marks).length) {
      for (let i = shortlistCache.count; i < snapshot.directories.length; i++) {
        const node = snapshot.directories[i]!
        const key = policyPath(node.path)
        if (Object.hasOwn(marks, key)) shortlistCache.indexed.set(key, node)
      }
    }
    shortlistCache.count = snapshot.directories.length
    return shortlistCache.indexed
  }
  /** Opens a fixed https URL from this module in the default browser. */
  const openUrl = openExternalUrl
  async function openFinder(path: string) {
    if (!options.finder && process.platform !== "darwin")
      throw new Error("Finder is available on macOS only")
    let canonical: string
    try {
      if (!isAbsolute(path) || !(await stat(path)).isDirectory())
        throw new Error("Not a directory")
      canonical = await realpath(path)
    } catch {
      throw new Error(
        `Cannot show “${path}” in Finder. The folder is missing or inaccessible; check permissions or rescan.`
      )
    }
    if (options.finder) await options.finder(canonical)
    else
      await new Promise<void>((resolve, reject) =>
        execFile(
          "/usr/bin/open",
          ["-R", canonical],
          { timeout: 15000 },
          (error, _stdout, stderr) => {
            if (!error) return resolve()
            const reason = error.killed
              ? "The request timed out"
              : stderr.trim() || error.message
            reject(new Error(`Finder could not reveal this folder: ${reason}`))
          }
        )
      )
  }

  function sessionProgress(session: ScanSession | null) {
    if (!session?.scanner) return null
    const progress = session.scanner.scanProgress
    if (progress.phase === "finalizing") return progress
    return { ...progress, ...session.completionEstimate.update(progress) }
  }
  function cachedDestination(root: string, device: number | null) {
    const covers = (session: ScanSession) =>
      session.root === root ||
      (device !== null &&
        session.device === device &&
        pathWithin(canonical(root), canonical(session.root)))
    // Home and Data share the active disk inventory even if an older, separate
    // Home scan exists. Switching between them keeps that inventory in memory.
    const session =
      root === directoryRoot && sessions.has(root)
        ? sessions.get(root)!
        : activeSession && covers(activeSession)
          ? activeSession
          : (sessions.get(root) ?? [...sessions.values()].find(covers))
    return session
      ? {
          documentId: session.documentId,
          canCancel: session.scanner?.snapshot.status === "scanning",
          lastCompletedAt: session.lastCompletedAt,
          lastDurationMs: session.lastDurationMs,
          status: session.refreshing
            ? "scanning"
            : (session.snapshot?.status ?? session.state),
          progress: session.scanner
            ? (() => {
                const progress = sessionProgress(session)!
                return {
                  percent: progress.percent,
                  estimateBasis: progress.estimateBasis,
                  elapsedMs: progress.elapsedMs,
                  files: progress.files,
                  bytes: progress.bytes,
                  usedBytes: volume(session.root)?.used ?? null,
                  phase: progress.phase,
                  remainingMs: progress.remainingMs,
                }
              })()
            : null,
          path:
            process.platform === "darwin" &&
            session.root.startsWith("/System/Volumes/Data") &&
            !root.startsWith("/System/Volumes/Data")
              ? `/System/Volumes/Data${canonical(root)}`
              : root,
        }
      : null
  }
  function summary() {
    const { directories, ...rest } = snapshot
    const progress = sessionProgress(activeSession)
    return {
      ...rest,
      awaitingScan,
      desktop: !!options.license,
      directories:
        sqliteInventory(snapshot)?.directoryCount ?? directories.length,
      bytes: directories[0].bytes,
      pending:
        progress?.pendingDirectories ??
        (snapshot.status === "complete"
          ? 0
          : directories.filter((d) => d.state === "pending").length),
      progress,
      excluded: directories[0].excluded,
      volume: volume(snapshot.root),
      policy: savedPolicy,
      policyFile,
      saveError,
      savedPath,
      snapshotMode,
      documentId,
      revision: activeSession?.revision ?? 0,
      cache:
        !snapshotMode && activeSession
          ? {
              restored: activeSession.cached,
              completedAt: snapshot.completedAt,
              refreshing: activeSession.refreshing,
            }
          : null,
      source: {
        kind: report ? "report" : snapshotMode ? "snapshot" : "live",
        name: sourceName,
      },
      viewer: viewerPreferences,
      cleanup: trash.status(),
      homeDirectory,
      directoryDestination: directoryRoot
        ? {
            id: directoryRoot,
            name: basename(directoryRoot) || directoryRoot,
            kind: "directory" as const,
            default: true,
            volume: null,
            scan: cachedDestination(directoryRoot, directoryDevice),
          }
        : null,
      homeDestination: {
        id: homeDirectory,
        name: "Home",
        default: false,
        volume: volume(homeDirectory),
        scan: cachedDestination(homeDirectory, homeDevice),
      },
      finderAvailable: !!options.finder || process.platform === "darwin",
      needsRescan: trash.moved.size > 0,
      scanners: {
        selected: selectedScanner,
        active:
          activeSession?.scanner?.snapshot.status === "scanning"
            ? (activeSession.scanner.snapshot.scanner ?? "node")
            : (snapshot.scanner ?? "node"),
        rust: {
          available: rustAvailability.available,
          reason: rustAvailability.reason,
        },
      },
      privateFolders: privacyPromptPaths(),
    }
  }
  const json = (res: ServerResponse, value: unknown, status = 200) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    })
    res.end(JSON.stringify(value))
  }
  async function body(
    req: IncomingMessage,
    maximum = 16384
  ): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = []
    let bytes = 0
    for await (const chunk of req) {
      bytes += chunk.length
      if (bytes > maximum) throw new Error("Request too large")
      chunks.push(chunk)
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Expected a JSON object")
    return value as Record<string, unknown>
  }

  let base = ""
  const server = createServer((req, res) => {
    void (async () => {
      res.setHeader("X-Content-Type-Options", "nosniff")
      res.setHeader("Referrer-Policy", "no-referrer")
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin")
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin")
      res.setHeader(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=()"
      )
      res.setHeader(
        "Content-Security-Policy",
        `default-src 'self'; script-src 'self' ${scriptHashes}; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`
      )
      if (
        req.headers.host !== new URL(base).host ||
        (req.headers.origin && req.headers.origin !== base)
      ) {
        json(res, { error: "Forbidden" }, 403)
        return
      }
      const url = new URL(req.url ?? "/", base)
      if (!url.pathname.startsWith("/api/")) {
        const asset = Object.hasOwn(assets, url.pathname)
          ? assets[url.pathname]
          : !url.pathname.includes(".") && !url.pathname.startsWith("/assets/")
            ? assets["/"]
            : undefined
        if (req.method !== "GET" || !asset) {
          res.writeHead(404)
          res.end()
          return
        }
        res.writeHead(200, {
          "Content-Type": asset.type,
          "Cache-Control": asset.type.startsWith("text/html")
            ? "no-store"
            : "public, max-age=3600",
        })
        res.end(assetContents.get(asset.file))
        return
      }
      // Browsers set Fetch Metadata; reject other sites/ports even if Origin is absent.
      // Native clients can omit browser headers, but still need the session capability.
      const site = req.headers["sec-fetch-site"]
      if (
        (site !== undefined && site !== "same-origin") ||
        (req.headers["sec-fetch-mode"] !== undefined &&
          !["cors", "same-origin"].includes(
            String(req.headers["sec-fetch-mode"])
          )) ||
        (req.headers["sec-fetch-dest"] !== undefined &&
          req.headers["sec-fetch-dest"] !== "empty")
      ) {
        json(res, { error: "Forbidden" }, 403)
        return
      }
      const bearer = /^Bearer ([a-f0-9]{64})$/i.exec(
        req.headers.authorization ?? ""
      )
      const auth = Buffer.from(bearer?.[1] ?? "")
      if (
        auth.length !== token.length ||
        !timingSafeEqual(auth, Buffer.from(token))
      ) {
        json(res, { error: "Unauthorized" }, 401)
        return
      }
      if (req.method !== "GET" && req.method !== "POST") {
        json(res, { error: "Method not allowed" }, 405)
        return
      }
      refreshKnowledge()
      if (req.method === "GET" && url.pathname === "/api/license") {
        json(res, license ? license.status() : { enabled: false })
        return
      }
      if (req.method === "GET" && url.pathname === "/api/knowledge") {
        json(res, knowledge)
        return
      }
      if (
        req.method === "POST" &&
        req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !==
          "application/json"
      ) {
        json(res, { error: "Expected application/json" }, 415)
        return
      }
      if (req.method === "GET" && url.pathname === "/api/status") {
        json(res, summary())
        return
      }
      if (req.method === "GET" && url.pathname === "/api/export") {
        if (report) {
          res.setHeader(
            "Content-Disposition",
            'attachment; filename="whyfull-report.json"'
          )
          json(res, report)
          return
        }
        if (snapshot.status === "scanning") {
          json(
            res,
            { error: "Pause or complete the scan before exporting" },
            409
          )
          return
        }
        if (sqliteInventory(snapshot) && !sqliteInventory(snapshot)!.complete) {
          json(
            res,
            {
              error: "Complete the scan before exporting its inventory",
            },
            409
          )
          return
        }
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="whyfull-disk.json"'
        )
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        })
        const stream = Readable.from(
          sqliteInventory(snapshot)?.chunks(savedPolicy) ??
            diskSnapshotChunks({ ...snapshot, policy: savedPolicy })
        )
        stream.on("error", () => res.destroy())
        res.once("close", () => stream.destroy())
        stream.pipe(res)
        return
      }
      if (req.method === "GET" && url.pathname === "/api/directory") {
        if (snapshot.status === "scanning") resetColors()
        let id = Number(url.searchParams.get("id") ?? 0)
        const requestedPath = url.searchParams.get("path")
        if (
          requestedPath &&
          canonical(snapshot.directories[id]?.path ?? "") !==
            canonical(requestedPath)
        )
          id =
            sqliteInventory(snapshot)?.findPath(requestedPath) ??
            snapshot.directories.findIndex(
              (node) => canonical(node.path) === canonical(requestedPath)
            )
        const native = sqliteInventory(snapshot)
        const node =
          native?.get(id, url.searchParams.get("files") === "all") ??
          snapshot.directories[id]
        if (!Number.isInteger(id) || !node) {
          json(res, { error: "Unknown directory" }, 404)
          return
        }
        const crumbs = []
        let current: DiskDirectory | undefined = node
        while (current) {
          crumbs.unshift({
            id: current.id,
            name: current.name,
            path: current.path,
          })
          current =
            current.parent === null
              ? undefined
              : (native?.get(current.parent, false) ??
                snapshot.directories[current.parent])
        }
        const chart = tree(node, 3)
        if (native && url.searchParams.get("files") !== "all") {
          if (!native.complete) {
            json(res, {
              node: tree(node, 0),
              chart,
              crumbs,
              entries: [],
              total: 0,
              offset: 0,
              ownFiles: 0,
              retainedFiles: 0,
              ownBytes: 0,
              largestFileBytes: 0,
              fileScope: "largest",
            })
            return
          }
          const trashIds = [...shortlistDirectories().values()]
            .filter(
              (n) => n.parent === id && marks[policyPath(n.path)] === "trash"
            )
            .map((n) => n.id)
          const page = native.page(id, {
            q: url.searchParams.get("q") ?? "",
            sort: url.searchParams.get("sort") === "name" ? "name" : "size",
            offset: Math.max(
              0,
              Math.trunc(Number(url.searchParams.get("offset")) || 0)
            ),
            minBytes: viewerPreferences.minFileBytes,
            trashIds,
          })
          json(res, {
            node: tree(node, 0),
            chart,
            crumbs,
            ...page,
            entries: page.entries.map((entry) =>
              entry.directoryId !== null
                ? tree(native.get(entry.directoryId, false)!, 0)
                : { ...entry, ...describe(entry.path) }
            ),
            ownFiles: node.ownFiles,
            retainedFiles: node.topFiles.length,
            ownBytes: node.ownBytes,
            largestFileBytes: Math.max(
              0,
              ...node.topFiles.map((file) => file.bytes)
            ),
            fileScope: "largest",
          })
          return
        }
        let entries: Record<string, unknown>[] = node.children.map((id) => ({
          id: `d${id}`,
          name: snapshot.directories[id].name,
          path: snapshot.directories[id].path,
          kind: "directory",
          value: snapshot.directories[id].bytes,
        }))
        entries.push(
          ...node.topFiles.map((f, i) => ({
            id: `f${node.id}-${i}`,
            name: f.name,
            path: join(node.path, f.name),
            kind: "file",
            value: f.bytes,
            apparentBytes: f.apparentBytes,
          }))
        )
        if (url.searchParams.get("files") === "all") {
          if (snapshotMode) {
            json(
              res,
              {
                error:
                  "A snapshot retains the largest direct files; rescan locally to list all direct files",
              },
              409
            )
            return
          }
          if (node.state === "excluded") {
            json(res, { error: "Directory is excluded" }, 409)
            return
          }
          if ((await realpath(node.path)) !== node.path) {
            json(res, { error: "Directory changed since the scan" }, 409)
            return
          }
          const children = await readdir(node.path, { withFileTypes: true })
          const fileEntries: Record<string, unknown>[] = []
          let cursor = 0
          await Promise.all(
            Array.from({ length: 8 }, async () => {
              while (cursor < children.length) {
                const file = children[cursor++]
                if (!file.isFile()) continue
                try {
                  const st = await lstat(join(node.path, file.name))
                  if (st.isFile())
                    fileEntries.push({
                      id: `live-${file.name}`,
                      name: file.name,
                      path: join(node.path, file.name),
                      kind: "file",
                      value: st.blocks * 512,
                      apparentBytes: st.size,
                      ...describe(join(node.path, file.name)),
                    })
                } catch {
                  /* changed since scan */
                }
              }
            })
          )
          entries = [
            ...entries.filter((e) => e.kind === "directory"),
            ...fileEntries,
          ]
        }
        const search = (url.searchParams.get("q") ?? "").toLowerCase()
        const sort = url.searchParams.get("sort") === "name" ? "name" : "size"
        entries = entries
          .map((entry): Record<string, unknown> => ({
            ...entry,
            mark: marks[policyPath(String(entry.path))] ?? null,
          }))
          .filter(
            (entry) =>
              search ||
              entry.mark === "trash" ||
              url.searchParams.get("files") === "all" ||
              entry.kind !== "file" ||
              !isSmallEntry(Number(entry.value), viewerPreferences.minFileBytes)
          )
          .filter((e) => String(e.name).toLowerCase().includes(search))
          .sort(
            (a, b) =>
              Number(b.mark === "trash") - Number(a.mark === "trash") ||
              (sort === "size" ? Number(b.value) - Number(a.value) : 0) ||
              String(a.name).localeCompare(String(b.name))
          )
        const offset = Math.max(
          0,
          Math.min(entries.length, Number(url.searchParams.get("offset")) || 0)
        )
        const page = entries
          .slice(offset, offset + 100)
          .map((entry) =>
            entry.kind === "directory"
              ? tree(snapshot.directories[Number(String(entry.id).slice(1))], 0)
              : { ...entry, ...describe(String(entry.path)) }
          )
        json(res, {
          node: tree(node, 0),
          chart,
          crumbs,
          entries: page,
          total: entries.length,
          offset,
          ownFiles: node.ownFiles,
          retainedFiles: node.topFiles.length,
          ownBytes: node.ownBytes,
          largestFileBytes: Math.max(
            0,
            ...node.topFiles.map((file) => file.bytes)
          ),
          fileScope:
            url.searchParams.get("files") === "all" ? "all" : "largest",
        })
        return
      }
      if (req.method === "POST" && url.pathname === "/api/file-distribution") {
        const input = await body(req)
        if (typeof input.id !== "string" || !/^d\d+$/.test(input.id))
          throw new Error("Select a directory from this inventory")
        const node = snapshot.directories[Number(input.id.slice(1))]
        if (!node || !pathWithin(node.path, snapshot.root))
          throw new Error("Unknown directory")
        if (node.state === "excluded") throw new Error("Directory is excluded")
        const controller = new AbortController()
        res.once("close", () => controller.abort())
        json(res, await measureFileDistribution(node.path, controller.signal))
        return
      }
      if (req.method === "GET" && url.pathname === "/api/analysis") {
        const current = analysisReport()
        json(res, {
          definitions: resolvedTargets.map((target) => ({
            id: target.id,
            label: target.label,
            group: target.group,
            tier: target.tier,
            classification: TIERS[target.tier].label,
            paths: target.candidates.filter((path): path is string => !!path),
          })),
          report: current,
          source: report
            ? "Loaded report"
            : current
              ? "Completed disk inventory"
              : null,
          pending:
            !report &&
            (snapshot.status === "scanning" || !!activeSession?.refreshing),
          root: snapshot.root,
        })
        return
      }
      if (req.method === "POST" && url.pathname === "/api/analysis/location") {
        const input = await body(req)
        const current = analysisReport()
        if (!current || input.generatedAt !== current.generatedAt)
          throw new Error(
            "Suggestions changed. Reopen them and select the folder again."
          )
        if (input.action !== "finder" && input.action !== "scan")
          throw new Error("Choose Finder or disk exploration")
        const item =
          typeof input.path === "string"
            ? [...reportLocations(current).values()].find(
                (location) =>
                  policyPath(location.path) === policyPath(input.path as string)
              )
            : undefined
        if (!item) throw new Error("Select a location from the suggestions")
        if (input.action === "finder") {
          await openFinder(item.path)
          json(res, { opened: true })
        } else {
          const path = await realpath(item.path)
          if (!(await lstat(path)).isDirectory())
            throw new Error("Choose a folder to inspect")
          const navigation = await openRoot(path)
          json(res, { ...summary(), navigation })
        }
        return
      }
      if (req.method === "GET" && url.pathname === "/api/diagnostics") {
        json(res, diagnosticStatus())
        return
      }
      if (req.method === "POST" && url.pathname === "/api/diagnostics") {
        const input = await body(req)
        if (
          Object.keys(input).some(
            (key) => !["action", "id", "options"].includes(key)
          ) ||
          (input.action === "cancel" && input.options !== undefined)
        )
          throw new Error("Unsupported diagnostic fields")
        if (input.action === "run" && input.id === "whyfull") {
          if (input.options !== undefined) reportArguments(input.options)
          if (
            !report &&
            (snapshot.status !== "complete" || activeSession?.refreshing)
          )
            throw new Error(
              "Complete the disk scan before generating suggestions"
            )
          const current =
            report ??
            (input.options
              ? analyzeSnapshot(analysisInventory(snapshot), resolvedTargets, {
                  top: (input.options as { top: number }).top,
                })
              : inventoryReport(snapshot))
          if (!current)
            throw new Error(
              "Complete the disk scan before generating suggestions"
            )
          if (!report) current.localContext = knowledgeContext(knowledge)
          if (!report) inventoryReports.set(snapshot, current)
          diagnostics.acceptReport(current)
          json(res, diagnosticStatus())
        } else if (input.action === "run")
          json(res, diagnostics.run(input.id, input.options))
        else if (input.action === "cancel") json(res, diagnostics.cancel())
        else throw new Error("Unknown diagnostic action")
        return
      }
      if (req.method === "GET" && url.pathname === "/api/shortlist") {
        const indexed = shortlistDirectories()
        const reportItems = new Map(
          [...reportLocations().values()].map((item) => [
            policyPath(item.path),
            item,
          ])
        )
        json(
          res,
          Object.entries(marks)
            .map(([path, mark]) => {
              const node = indexed.get(path)
              const reportItem = reportItems.get(path)
              return {
                path,
                mark,
                name: basename(path),
                id: node
                  ? `d${node.id}`
                  : reportItem
                    ? `report:${reportItem.path}`
                    : null,
                bytes: node?.bytes ?? reportItem?.bytes ?? null,
                partial: node
                  ? snapshot.status !== "complete" ||
                    node.state !== "scanned" ||
                    node.issues > 0 ||
                    node.excluded > 0
                  : (reportItem?.partial ?? false),
                kept: describe(path).kept,
              }
            })
            .sort(
              (a, b) =>
                (b.bytes ?? -1) - (a.bytes ?? -1) ||
                a.path.localeCompare(b.path)
            )
        )
        return
      }
      if (req.method === "POST" && url.pathname === "/api/shortlist") {
        const input = await body(req)
        if (typeof input.path !== "string" || !Object.hasOwn(marks, input.path))
          throw new Error("Select a saved shortlisted folder")
        if (input.action === "clear")
          marks = clearDirectoryMark(input.path, policyFile)
        else if (input.action === "finder") await openFinder(input.path)
        else throw new Error("Unknown shortlist action")
        json(res, { ok: true })
        return
      }
      if (
        req.method === "POST" &&
        ["/api/finder", "/api/mark"].includes(url.pathname)
      ) {
        const input = await body(req)
        if (typeof input.id !== "string" || !/^d\d+$/.test(input.id))
          throw new Error("Select a directory from this inventory")
        const node = snapshot.directories[Number(input.id.slice(1))]
        if (!node || !pathWithin(node.path, snapshot.root))
          throw new Error("Unknown directory")
        if (url.pathname === "/api/mark") {
          if (
            input.mark !== null &&
            input.mark !== "trash" &&
            input.mark !== "useless"
          )
            throw new Error("Invalid directory mark")
          if (input.mark && node.parent === null)
            throw new Error("The scan root cannot be marked for cleanup")
          if (input.mark && describe(node.path).kept)
            throw new Error(
              "Remove the keep rule before marking this folder for cleanup"
            )
          marks = saveDirectoryMark(node.path, input.mark, policyFile)
          json(res, { mark: marks[policyPath(node.path)] ?? null })
        } else {
          await openFinder(node.path)
          json(res, { opened: true })
        }
        return
      }
      if (req.method === "POST" && url.pathname === "/api/preferences") {
        const input = await body(req)
        if (input.scanner === "rust" && !rustAvailability.available)
          throw new Error(rustAvailability.reason!)
        if (
          input.lastPath !== undefined &&
          input.lastPath !== null &&
          (sqliteInventory(snapshot)
            ? sqliteInventory(snapshot)!.findPath(String(input.lastPath)) < 0
            : !snapshot.directories.some(
                (node) => node.path === input.lastPath
              ))
        )
          throw new Error("Saved folder must belong to this inventory")
        viewerPreferences = saveViewerPreferences(input, policyFile)
        if (input.scanner !== undefined)
          selectedScanner = viewerPreferences.scanner
        json(res, viewerPreferences)
        return
      }
      if (req.method === "POST" && url.pathname === "/api/license") {
        if (!license) {
          json(res, { error: "Licenses apply to the desktop app only" }, 404)
          return
        }
        const input = await body(req)
        if (input.action === "activate")
          json(res, license.activate(String(input.key ?? "")))
        else if (input.action === "deactivate") json(res, license.deactivate())
        else if (input.action === "reminded") json(res, license.reminded())
        else if (input.action === "checkout" || input.action === "open") {
          // Only fixed whyfull.app pages; `checkout` is kept as an alias for buy.
          const target = licensePageUrl(
            input.action === "checkout" ? "buy" : input.page
          )
          if (!target) throw new Error("Unknown page")
          await (options.license!.openUrl ?? openUrl)(target)
          json(res, { opened: true })
        } else throw new Error("Unknown license action")
        return
      }
      if (req.method === "POST" && url.pathname === "/api/knowledge") {
        const next = updateKnowledge(await body(req, 128 * 1024), policyFile)
        refreshKnowledge()
        json(res, next)
        return
      }
      if (req.method === "POST" && url.pathname === "/api/knowledge/proposal") {
        json(res, locationProposal(await body(req), policyFile))
        return
      }
      if (req.method === "POST" && url.pathname === "/api/cleanup-mode") {
        json(res, trash.setMode((await body(req)).mode))
        return
      }
      if (req.method === "POST" && url.pathname === "/api/trash/preview") {
        const input = await body(req)
        json(res, await trash.prepare(input.id, input.parentId))
        return
      }
      if (req.method === "POST" && url.pathname === "/api/trash/execute") {
        json(res, await trash.execute((await body(req)).planId))
        return
      }
      if (req.method === "POST" && url.pathname === "/api/policy") {
        const input = await body(req)
        const id = Number(input.id),
          action = input.action
        const node = snapshot.directories[id]
        const path =
          input.path &&
          action === "clear" &&
          [...savedPolicy.keep, ...savedPolicy.exclude].includes(
            String(input.path)
          )
            ? String(input.path)
            : Number.isInteger(id) && node
              ? node.path
              : null
        if (!path || !["keep", "exclude", "clear"].includes(String(action))) {
          json(res, { error: "Invalid policy change" }, 400)
          return
        }
        const next = {
          keep: savedPolicy.keep.filter((p) => p !== path),
          exclude: savedPolicy.exclude.filter((p) => p !== path),
        }
        if (action === "keep") next.keep.push(path)
        if (action === "exclude") next.exclude.push(path)
        saveDiskPolicy(next, policyFile)
        savedPolicy = next
        json(res, { policy: savedPolicy, rescanRequired: action !== "keep" })
        return
      }
      if (req.method === "POST" && url.pathname === "/api/cancel") {
        const input = await body(req)
        const target =
          input.documentId === undefined
            ? activeSession
            : typeof input.documentId === "string"
              ? documents.get(input.documentId)
              : null
        if (input.documentId !== undefined && !target)
          throw new Error("This scan is no longer available in this session")
        target?.scanner?.cancel()
        await target?.running
        json(res, summary())
        return
      }
      if (req.method === "POST" && url.pathname === "/api/diagnostics/report") {
        if (switching) throw new Error("Wait for the report to finish opening")
        const generated = diagnostics.report((await body(req)).startedAt)
        switching = true
        try {
          await leaveScan()
          scanner = null
          trash.setMode("demo")
          trash.moved.clear()
          activeSession = null
          report = generated
          snapshot = emptyViewerSnapshot()
          snapshotMode = true
          awaitingScan = false
          sourceName = "Local diagnostic report"
          documentId = randomUUID()
          json(res, summary())
        } finally {
          switching = false
        }
        return
      }
      if (req.method === "GET" && url.pathname === "/api/report/locations") {
        if (!report) throw new Error("No CLI report is open")
        json(
          res,
          [...reportLocations().values()].map((item) => ({
            ...item,
            ...describe(item.path),
          }))
        )
        return
      }
      if (
        req.method === "POST" &&
        ["/api/report/finder", "/api/report/action"].includes(url.pathname)
      ) {
        const input = await body(req)
        const item =
          typeof input.path === "string"
            ? [...reportLocations().values()].find(
                (location) =>
                  policyPath(location.path) === policyPath(input.path as string)
              )
            : undefined
        if (!item || !isAbsolute(item.path))
          throw new Error("Select a location from the open report")
        const action = url.pathname.endsWith("/finder")
          ? "finder"
          : input.action
        if (action === "finder") await openFinder(item.path)
        else if (action === "scan") {
          const path = await realpath(item.path)
          if (!(await lstat(path)).isDirectory())
            throw new Error("Choose a folder to inspect")
          await startScan(path)
          json(res, summary())
          return
        } else if (["trash", "useless", "clear"].includes(String(action))) {
          if (action !== "clear" && describe(item.path).kept)
            throw new Error("Remove the keep rule before marking this location")
          marks = saveDirectoryMark(
            item.path,
            action === "clear" ? null : (action as "trash" | "useless"),
            policyFile
          )
        } else if (action === "keep" || action === "unkeep") {
          const next = {
            ...savedPolicy,
            keep: savedPolicy.keep.filter(
              (path) => policyPath(path) !== policyPath(item.path)
            ),
          }
          if (action === "keep") next.keep.push(item.path)
          saveDiskPolicy(next, policyFile)
          savedPolicy = next
          if (action === "keep")
            marks = saveDirectoryMark(item.path, null, policyFile)
        } else throw new Error("Choose a supported report action")
        json(res, action === "finder" ? { opened: true } : { ok: true })
        return
      }
      if (req.method === "GET" && url.pathname === "/api/drives") {
        json(
          res,
          drives().map((drive) => {
            let device: number | null = null
            try {
              device = statSync(drive.id).dev
            } catch {
              /* Detached drive. */
            }
            return { ...drive, scan: cachedDestination(drive.id, device) }
          })
        )
        return
      }
      if (req.method === "GET" && url.pathname === "/api/report") {
        if (!report) throw new Error("No CLI report is open")
        json(res, report)
        return
      }
      if (req.method === "POST" && url.pathname === "/api/import") {
        if (switching) throw new Error("Another report is being opened")
        const maximum = 8 * 1024 ** 3
        if (Number(req.headers["content-length"]) > maximum)
          throw new Error("Report exceeds the 8 GiB import limit")
        switching = true
        let folder: string | undefined
        try {
          folder = await mkdtemp(join(tmpdir(), "whyfull-viewer-"))
          const file = join(folder, "report.json")
          let bytes = 0
          const limit = new Transform({
            transform(chunk, _encoding, done) {
              bytes += chunk.length
              done(
                bytes > maximum
                  ? new Error("Report exceeds the 8 GiB import limit")
                  : null,
                chunk
              )
            },
          })
          await pipeline(
            req,
            limit,
            createWriteStream(file, { flags: "wx", mode: 0o600 })
          )
          const loaded = await loadViewerFile(file)
          const name = basename(
            decodeURIComponent(
              String(req.headers["x-whyfull-name"] ?? "report.json")
            )
          ).slice(0, 255)
          await leaveScan()
          scanner = null
          trash.setMode("demo")
          trash.moved.clear()
          snapshot = loaded.snapshot ?? emptyViewerSnapshot()
          report = loaded.report ?? null
          snapshotMode = true
          awaitingScan = false
          sourceName = name
          documentId = randomUUID()
          saveError = null
          savedPath = null
          activeSession = report ? null : rememberScan()
          json(res, summary())
        } finally {
          switching = false
          if (folder) await rm(folder, { recursive: true, force: true })
        }
        return
      }
      if (req.method === "POST" && url.pathname === "/api/scan-folder") {
        const input = await body(req)
        if (typeof input.id !== "string" || !/^d\d+$/.test(input.id))
          throw new Error("Select a directory from this inventory")
        const node = snapshot.directories[Number(input.id.slice(1))]
        if (!node || !pathWithin(node.path, snapshot.root))
          throw new Error("Unknown directory")
        await startScan(node.path)
        json(res, summary())
        return
      }
      if (req.method === "POST" && url.pathname === "/api/scan-root") {
        if (switching) throw new Error("Wait for the report to finish opening")
        const input = await body(req),
          drive =
            input.root === directoryRoot
              ? { id: directoryRoot! }
              : input.root === homeDirectory
                ? { id: homeDirectory }
                : (drives().find((d) => d.id === input.root) ??
                  knowledge.locations.find(
                    (item) => item.enabled && item.resolvedPath === input.root
                  ))
        if (!drive)
          throw new Error(
            "Select Home, an available drive, or a saved location"
          )
        const path = await realpath(
          "resolvedPath" in drive ? drive.resolvedPath : drive.id
        )
        if (!(await stat(path)).isDirectory())
          throw new Error("Choose an available folder to scan")
        const navigation = await openRoot(path)
        json(res, { ...summary(), navigation })
        return
      }
      if (req.method === "POST" && url.pathname === "/api/scan-path") {
        if (switching) throw new Error("Wait for the report to finish opening")
        const input = await body(req)
        if (
          typeof input.root !== "string" ||
          !input.root.trim() ||
          input.root.length > 4096 ||
          /[\x00-\x1f]/.test(input.root) ||
          (!isAbsolute(input.root) &&
            input.root !== "~" &&
            !input.root.startsWith("~/"))
        )
          throw new Error("Use an absolute folder path or ~/path")
        const path = await realpath(normalizePolicyPath(input.root))
        if (!(await stat(path)).isDirectory())
          throw new Error("Choose a folder to scan")
        const navigation = await openRoot(path)
        json(res, { ...summary(), navigation })
        return
      }
      if (req.method === "POST" && url.pathname === "/api/open-scan") {
        const input = await body(req)
        const existing =
          typeof input.documentId === "string"
            ? documents.get(input.documentId)
            : undefined
        if (!existing)
          throw new Error("This scan is no longer available in this session")
        await restoreSession(existing)
        json(res, summary())
        return
      }
      if (req.method === "POST" && url.pathname === "/api/rescan") {
        if (snapshotMode) throw new Error("Select a drive to start a live scan")
        if (snapshot.status === "scanning" || activeSession?.refreshing)
          throw new Error("A scan is already running")
        if (snapshot.status === "complete" && activeSession)
          await refreshScan(activeSession)
        else await startScan(snapshot.root)
        json(res, summary())
        return
      }
      json(res, { error: "Not found" }, 404)
    })().catch((error) => {
      if (res.headersSent) res.destroy()
      else
        json(
          res,
          { error: error instanceof Error ? error.message : String(error) },
          400
        )
    })
  })
  async function openRoot(root: string) {
    if (awaitingScan && root === snapshot.root) {
      await startScan(root)
      return { path: snapshot.root }
    }
    if (!report && root === snapshot.root) return { path: root }
    // Prefer navigation within the current inventory to restoring a second
    // inventory of a folder already covered by this disk scan.
    const device = (await stat(root)).dev
    const cached = cachedDestination(root, device)
    if (cached?.documentId === documentId) return { path: cached.path }
    const exact = sessions.get(root)
    if (exact) {
      await restoreSession(exact)
      return { path: root }
    }
    // A parent inventory never covers another mounted filesystem.
    if (
      !report &&
      activeSession?.device === device &&
      pathWithin(canonical(root), canonical(snapshot.root))
    )
      return { path: root }
    const existing = [...sessions.values()].find(
      (session) =>
        session.device === device &&
        pathWithin(canonical(root), canonical(session.root))
    )
    if (!existing) {
      await startScan(root)
      return { path: snapshot.root }
    }
    await restoreSession(existing)
    return { path: root }
  }
  async function restoreSession(existing: ScanSession) {
    if (switching) throw new Error("Wait for the current destination to open")
    if (activeSession === existing) return
    switching = true
    try {
      // Load before leaving the current inventory, so an I/O error never
      // replaces useful results or silently starts another expensive scan.
      await existing.writing
      const restored =
        existing.snapshot ?? (await loadDiskSnapshot(existing.file!))
      await leaveScan()
      activeSession = existing
      existing.snapshot = restored
      scanner = existing.scanner
      snapshot = restored
      resetColors()
      shortlistCache = null
      documentId = existing.documentId
      report = null
      snapshotMode = existing.snapshotMode
      awaitingScan = false
      sourceName = existing.sourceName
      saveError = existing.saveError
      savedPath = existing.savedPath
      trash.setMode("demo")
      trash.moved.clear()
      for (const path of existing.moved) trash.moved.add(path)
    } finally {
      switching = false
    }
  }
  async function startScan(root: string) {
    if (switching) throw new Error("Wait for the report to finish opening")
    switching = true
    try {
      const next = createScanner({
        ...options,
        root,
        policy: {
          keep: savedPolicy.keep,
          exclude: [...savedPolicy.exclude, ...(options.policy?.exclude ?? [])],
        },
      })
      await leaveScan(next.snapshot.root)
      // Explicit rescans replace just this root's saved inventory.
      for (const previous of documents.values())
        if (previous.root === next.snapshot.root) await forgetScan(previous)
      trash.setMode("demo")
      trash.moved.clear()
      const cached = await cacheFor(next.snapshot.root).load(
        next.snapshot.root,
        {
          ...options,
          scanner: selectedScanner,
          policy: next.snapshot.policy,
          includePrivate: viewerPreferences.scanPrivateFolders,
        }
      )
      scanner = next
      snapshot = cached ?? next.snapshot
      report = null
      snapshotMode = false
      sourceName = null
      documentId = randomUUID()
      saveError = null
      savedPath = cached
        ? (sqliteInventory(snapshot)?.file ??
          cacheFor(snapshot.root).path(snapshot.root))
        : null
      activeSession = rememberScan()
      activeSession.cached = !!cached
      activeSession.refreshing = !!cached
      run()
    } finally {
      switching = false
    }
  }
  async function refreshScan(session: ScanSession) {
    switching = true
    try {
      // Finish saving the prior report before another refresh can overwrite it.
      await session.running
      const next = createScanner({
        ...options,
        root: session.root,
        policy: {
          keep: savedPolicy.keep,
          exclude: [...savedPolicy.exclude, ...(options.policy?.exclude ?? [])],
        },
      })
      session.scanner = next
      session.completionEstimate = new ScanCompletionEstimate(
        session.snapshot!.directories.length -
          session.snapshot!.directories[0].excluded
      )
      session.refreshing = true
      session.saveError = null
      scanner = next
      saveError = null
      trash.setMode("demo")
      run()
    } finally {
      switching = false
    }
  }
  function run() {
    awaitingScan = false
    const current = scanner!
    const session = activeSession!
    const operation = (async () => {
      try {
        const running = current.run()
        const result = await running
        if (closed || documents.get(session.documentId) !== session) return
        if (session.refreshing) {
          session.refreshing = false
          if (result.status === "complete") {
            // Replace the displayed inventory in one step, keeping its history
            // identity and using a revision to invalidate directory queries.
            const oldFile = session.file
            const oldSnapshot = session.snapshot
            session.file = null
            session.snapshot = result
            session.savedPath = null
            session.revision++
            session.cached = false
            session.moved = []
            if (activeSession === session) {
              snapshot = result
              savedPath = null
              resetColors()
              shortlistCache = null
              trash.setMode("demo")
              trash.moved.clear()
            }
            if (oldFile) await rm(oldFile, { force: true }).catch(() => {})
            if (oldSnapshot) sqliteInventory(oldSnapshot)?.dispose()
          } else {
            if (result.status === "failed")
              session.saveError =
                "Background refresh failed. Showing the last completed scan."
            // A cancelled refresh must release its partial replacement tree.
            session.scanner = null
            if (scanner === current) scanner = null
            sqliteInventory(result)?.dispose()
          }
        }
        session.state = session.snapshot?.status ?? session.state
        if (result.status === "complete") {
          try {
            inventoryReport(result)
          } catch {
            // Suggestion failures must not change a successful disk scan. The
            // analysis endpoint retries and reports its own error to the UI.
          }
          session.lastCompletedAt = result.completedAt
          session.lastDurationMs = result.durationMs
          try {
            const file = await cacheFor(result.root).save(result, {
              ...options,
              scanner: result.scanner,
              policy: result.policy,
            })
            session.savedPath = file
          } catch (error) {
            session.saveError = `Could not save the scan cache: ${error instanceof Error ? error.message : String(error)}`
          }
          if (exportPending && result.root === exportRoot && options.saveTo) {
            exportPending = false
            try {
              await saveDiskSnapshot(result, options.saveTo)
              session.savedPath = options.saveTo
            } catch (error) {
              session.saveError =
                error instanceof Error ? error.message : String(error)
            }
          }
        }
        if (activeSession === session) {
          savedPath = session.savedPath
          saveError = session.saveError
        } else if (!closed) {
          await archiveSession(session)
        }
      } catch (error) {
        session.refreshing = false
        if (session.snapshot === current.snapshot) {
          session.snapshot.status = "failed"
          session.state = "failed"
        } else {
          session.scanner = null
          if (scanner === current) scanner = null
          sqliteInventory(current.snapshot)?.dispose()
        }
        session.saveError =
          error instanceof Error ? error.message : String(error)
        if (activeSession === session) saveError = session.saveError
      }
    })()
    session.running = operation
    scanRuns.add(operation)
    void operation.finally(() => scanRuns.delete(operation))
  }
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string")
    throw new Error("Unable to start viewer")
  base = `http://127.0.0.1:${address.port}`
  const url = `${base}/#${token}`
  if (scanner && options.scanOnStart !== false) run()
  if (options.open !== false) {
    const command =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "explorer.exe"
          : "xdg-open"
    const child = spawn(command, [url], { stdio: "ignore" })
    child.on("error", () =>
      process.stderr.write(
        "Could not open a browser automatically; use the printed viewer URL.\n"
      )
    )
    child.unref()
  }
  return {
    url,
    server,
    get snapshot() {
      return snapshot
    },
    close: async () => {
      closed = true
      for (const session of documents.values()) session.scanner?.cancel()
      diagnostics.cancel()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await Promise.allSettled(scanRuns)
      await Promise.allSettled(archiveWrites)
      for (const session of documents.values())
        if (session.snapshot) sqliteInventory(session.snapshot)?.dispose()
      if (sessionFolder)
        await rm(await sessionFolder, { recursive: true, force: true })
    },
  }
}
