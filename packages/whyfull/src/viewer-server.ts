import { isSmallEntry } from "./viewer-noise"
import { measureFileDistribution } from "./file-distribution"
import { pipeline } from "node:stream/promises"
import { DiagnosticRunner } from "./diagnostics"
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
import { createWriteStream, readFileSync } from "node:fs"
import { Readable, Transform } from "node:stream"
import { lstat, stat, readdir, realpath, mkdtemp, rm } from "node:fs/promises"
import { basename, isAbsolute, join } from "node:path"
import { execFile, spawn } from "node:child_process"
import { DiskScanner } from "./filesystem"
import {
  loadDirectoryMarks,
  clearDirectoryMark,
  saveDirectoryMark,
  policyPath,
  defaultPolicyPath,
  loadDiskPolicy,
  pathWithin,
  saveDiskPolicy,
  loadViewerPreferences,
  saveViewerPreferences,
} from "./disk-policy"
import { forPlatform } from "./targets"
import { volume } from "./size"
import type {
  DiskDirectory,
  DiskPolicy,
  DiskScanOptions,
  DiskSnapshot,
} from "./filesystem-types"
import { diskSnapshotChunks, saveDiskSnapshot } from "./disk-snapshot"
export { loadDiskSnapshot, saveDiskSnapshot } from "./disk-snapshot"
import { TrashController } from "./trash"

export interface ViewerOptions extends DiskScanOptions {
  open?: boolean
  policyFile?: string
  snapshot?: DiskSnapshot
  report?: WhyfullJsonReport
  sourceName?: string
  drives?: () => ScanDrive[]
  saveTo?: string
  finder?: (path: string) => Promise<void>
  allowTrash?: boolean
}

export async function startViewer(options: ViewerOptions) {
  const diagnostics = new DiagnosticRunner()
  const homeDirectory = await realpath(homedir())
  const token = randomBytes(32).toString("hex")
  const policyFile = options.policyFile ?? defaultPolicyPath()
  const policy = loadDiskPolicy(policyFile)
  const scanPolicy: DiskPolicy = {
    keep: [...policy.keep, ...(options.policy?.keep ?? [])],
    exclude: [...policy.exclude, ...(options.policy?.exclude ?? [])],
  }
  if (options.report && options.snapshot)
    throw new Error("Choose a report or a snapshot")
  let report = options.report ? validateViewerReport(options.report) : null
  let snapshotMode = !!options.snapshot || !!report
  let sourceName = options.sourceName ?? null
  let documentId = randomUUID()
  const drives = options.drives ?? listScanDrives
  let switching = false
  let scanner = snapshotMode
    ? null
    : new DiskScanner({ ...options, policy: scanPolicy })
  let snapshot =
    options.snapshot ?? (report ? emptyViewerSnapshot() : scanner!.snapshot)
  // Avoid retaining a multi-gigabyte initial inventory after switching documents.
  options = { ...options, snapshot: undefined, report: undefined }
  let savedPolicy = policy
  let saveError: string | null = null
  let savedPath: string | null = null
  let marks = loadDirectoryMarks(policyFile)
  let viewerPreferences = loadViewerPreferences(policyFile)
  const trash = new TrashController({
    snapshot: () => snapshot,
    policy: () => ({
      keep: [...savedPolicy.keep, ...(options.policy?.keep ?? [])],
      exclude: [...savedPolicy.exclude, ...snapshot.policy.exclude],
    }),
    allowTrash: options.allowTrash,
    snapshotMode: () => snapshotMode,
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
  const targets = forPlatform()
    .flatMap((target) =>
      target.candidates
        .filter((p): p is string => !!p)
        .map((path) => ({ path, target }))
    )
    .sort((a, b) => b.path.length - a.path.length)
  const canonical = (path: string) =>
    process.platform === "darwin" && path.startsWith("/System/Volumes/Data/")
      ? path.slice("/System/Volumes/Data".length)
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
    const children: Record<string, unknown>[] = node.children.map((id) => ({
      id: `d${id}`,
      name: snapshot.directories[id].name,
      value: snapshot.directories[id].bytes,
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
    const limit = depth === 3 ? 48 : depth === 2 ? 16 : 8
    const visible = children
      .slice(0, limit)
      .map((child) =>
        child.kind === "directory"
          ? tree(
              snapshot.directories[Number(String(child.id).slice(1))],
              depth - 1
            )
          : { ...child, ...(child.path ? describe(String(child.path)) : {}) }
      )
    if (children.length > limit) {
      const hidden = children.slice(limit)
      const filesOnly = hidden.every(
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
            : `${hidden.length} smaller entries`,
        files,
        value: hidden.reduce((s, n) => s + Number(n.value), 0),
        kind: "group",
        advice: "Use the searchable list to browse every folder.",
      })
    }
    out.children = visible
    return out
  }
  function reportLocations() {
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
    for (const target of report?.targets ?? []) {
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
    for (const section of [report?.cacheHogs, report?.discovered])
      for (const item of section?.dirs ?? []) {
        add(item.path, item.bytes)
        for (const child of item.children) add(child.path, child.bytes)
      }
    for (const cluster of report?.worktrees?.clusters ?? [])
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

  function summary() {
    const { directories, ...rest } = snapshot
    return {
      ...rest,
      directories: directories.length,
      bytes: directories[0].bytes,
      pending: directories.filter((d) => d.state === "pending").length,
      excluded: directories[0].excluded,
      volume: volume(snapshot.root),
      policy: savedPolicy,
      policyFile,
      saveError,
      savedPath,
      snapshotMode,
      documentId,
      source: {
        kind: report ? "report" : snapshotMode ? "snapshot" : "live",
        name: sourceName,
      },
      viewer: viewerPreferences,
      cleanup: trash.status(),
      homeDirectory,
      finderAvailable: !!options.finder || process.platform === "darwin",
      needsRescan: trash.moved.size > 0,
    }
  }
  const json = (res: ServerResponse, value: unknown, status = 200) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    })
    res.end(JSON.stringify(value))
  }
  async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = []
    let bytes = 0
    for await (const chunk of req) {
      bytes += chunk.length
      if (bytes > 16384) throw new Error("Request too large")
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
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="whyfull-disk.json"'
        )
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        })
        const stream = Readable.from(
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
        if (requestedPath && snapshot.directories[id]?.path !== requestedPath)
          id = snapshot.directories.findIndex(
            (node) => node.path === requestedPath
          )
        const node = snapshot.directories[id]
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
              : snapshot.directories[current.parent]
        }
        const chart = tree(node, 3)
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
      if (req.method === "GET" && url.pathname === "/api/diagnostics") {
        json(res, diagnostics.status())
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
        if (input.action === "run")
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
        if (
          input.lastPath !== undefined &&
          input.lastPath !== null &&
          !snapshot.directories.some((node) => node.path === input.lastPath)
        )
          throw new Error("Saved folder must belong to this inventory")
        viewerPreferences = saveViewerPreferences(input, policyFile)
        json(res, viewerPreferences)
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
        scanner?.cancel()
        json(res, summary())
        return
      }
      if (req.method === "POST" && url.pathname === "/api/diagnostics/report") {
        if (switching) throw new Error("Wait for the report to finish opening")
        const generated = diagnostics.report((await body(req)).startedAt)
        scanner?.cancel()
        scanner = null
        trash.setMode("demo")
        trash.moved.clear()
        report = generated
        snapshot = emptyViewerSnapshot()
        snapshotMode = true
        sourceName = "Local diagnostic report"
        documentId = randomUUID()
        json(res, summary())
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
          startScan(path)
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
        json(res, drives())
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
          scanner?.cancel()
          scanner = null
          trash.setMode("demo")
          trash.moved.clear()
          snapshot = loaded.snapshot ?? emptyViewerSnapshot()
          report = loaded.report ?? null
          snapshotMode = true
          sourceName = name
          documentId = randomUUID()
          saveError = null
          savedPath = null
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
        startScan(node.path)
        json(res, summary())
        return
      }
      if (req.method === "POST" && url.pathname === "/api/scan-root") {
        if (switching) throw new Error("Wait for the report to finish opening")
        const input = await body(req),
          drive =
            input.root === homeDirectory
              ? { id: homeDirectory }
              : drives().find((d) => d.id === input.root)
        if (!drive) throw new Error("Select an available drive")
        startScan(drive.id)
        json(res, summary())
        return
      }
      if (req.method === "POST" && url.pathname === "/api/rescan") {
        if (snapshotMode) throw new Error("Select a drive to start a live scan")
        if (snapshot.status === "scanning")
          throw new Error("A scan is already running")
        startScan(snapshot.root)
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
  function startScan(root: string) {
    if (switching) throw new Error("Wait for the report to finish opening")
    const next = new DiskScanner({
      ...options,
      root,
      policy: {
        keep: savedPolicy.keep,
        exclude: [...savedPolicy.exclude, ...(options.policy?.exclude ?? [])],
      },
    })
    scanner?.cancel()
    trash.setMode("demo")
    trash.moved.clear()
    scanner = next
    snapshot = next.snapshot
    report = null
    snapshotMode = false
    sourceName = null
    documentId = randomUUID()
    saveError = null
    savedPath = null
    run(false)
  }
  function run(save = true) {
    const current = scanner!
    void current
      .run()
      .then(async (result) => {
        if (current !== scanner) return
        if (
          save &&
          options.saveTo &&
          result.status === "complete" &&
          !savedPath
        ) {
          try {
            await saveDiskSnapshot(result, options.saveTo)
            if (current === scanner) savedPath = options.saveTo
          } catch (error) {
            if (current === scanner)
              saveError = error instanceof Error ? error.message : String(error)
          }
        }
      })
      .catch((error) => {
        if (current === scanner) {
          snapshot.status = "failed"
          saveError = error instanceof Error ? error.message : String(error)
        }
      })
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
  if (scanner) run()
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
      scanner?.cancel()
      diagnostics.cancel()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
