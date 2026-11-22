import { tmpdir } from "node:os"
import { createRequire } from "node:module"
import {
  accessSync,
  constants,
  mkdirSync,
  openSync,
  closeSync,
  statSync,
  unlinkSync,
  readFileSync,
} from "node:fs"
import { dirname, basename, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash, randomUUID } from "node:crypto"
import { copyFile, link, mkdir, rename, rm, writeFile } from "node:fs/promises"
import { setImmediate } from "node:timers/promises"
import type { DatabaseSync, StatementSync } from "node:sqlite"
import type {
  DiskDirectory,
  DiskFile,
  DiskScanOptions,
  DiskSnapshot,
} from "./filesystem-types"
import {
  normalizePolicyPath,
  policyPath,
  defaultPolicyPath,
  pathWithin,
} from "./disk-policy"

const require = createRequire(import.meta.url)
const stores = new WeakMap<DiskSnapshot, SqliteInventory>()
export const sqliteInventory = (snapshot: DiskSnapshot) => stores.get(snapshot)
/** Release a programmatic scan result; viewers manage this automatically. */
export const releaseDiskSnapshot = (snapshot: DiskSnapshot) =>
  sqliteInventory(snapshot)?.dispose()

export function rustScannerAvailability(override?: string) {
  if (!["darwin", "linux"].includes(process.platform))
    return {
      available: false,
      reason: "The experimental Rust scanner is available on macOS and Linux.",
      binary: null,
    }
  const [major, minor] = process.versions.node.split(".").map(Number)
  if (major < 22 || (major === 22 && minor < 18))
    return {
      available: false,
      reason: "The experimental Rust scanner requires Node 22.18 or newer.",
      binary: null,
    }
  const configured = override ?? process.env.WHYFULL_RUST_CRAWLER
  const paths = configured
    ? [resolve(configured)]
    : [
        fileURLToPath(new URL("./native/whyfull-crawler", import.meta.url)),
        fileURLToPath(
          new URL(
            "../../../experiments/disk-crawler/target/release/whyfull-crawler-spike",
            import.meta.url
          )
        ),
      ]
  for (const binary of paths) {
    try {
      if (!configured && binary.includes(`${sep}native${sep}`)) {
        const manifest = JSON.parse(
          readFileSync(join(dirname(binary), "platform.json"), "utf8")
        ) as { platform: string; arch: string }
        if (
          manifest.platform !== process.platform ||
          manifest.arch !== process.arch
        )
          continue
      }
      accessSync(binary, constants.X_OK)
      if (statSync(binary).isFile())
        return { available: true, reason: null, binary }
    } catch {
      /* This build may ship only the Node scanner. */
    }
  }
  return {
    available: false,
    reason: "The experimental Rust scanner is not included in this build.",
    binary: null,
  }
}

export function inventoryWorkingDirectory(policyFile = defaultPolicyPath()) {
  return join(dirname(policyFile), ".whyfull", "inventories")
}

export function inventoryIdentity(root: string, options: DiskScanOptions) {
  const info = statSync(root)
  return JSON.stringify({
    version: 2,
    scanner: options.scanner ?? "node",
    root,
    device: info.dev,
    inode: info.ino,
    topFiles: options.topFiles ?? 32,
    keep: (options.policy?.keep ?? [])
      .map((p) => policyPath(normalizePolicyPath(p)))
      .sort(),
    exclude: (options.policy?.exclude ?? [])
      .map((p) => policyPath(normalizePolicyPath(p)))
      .sort(),
  })
}

interface Row {
  id: number
  parent: number | null
  name: string
  ownBytes: number
  ownApparentBytes: number
  ownFiles: number
  skippedLinks: number
  issues: number
  state: DiskDirectory["state"]
  reason: string | null
  topFiles: string
  bytes: number
  apparentBytes: number
  files: number
  directories: number
  excluded: number
  totalIssues: number
}
export interface InventoryDirectoryRecord {
  id: number
  parent: number | null
  name: string
  ownBytes: number
  ownApparentBytes: number
  ownFiles: number
  skippedLinks: number
  issues: number
  state: DiskDirectory["state"]
  reason: string | null
  topFiles: DiskFile[]
}
export interface InventoryLinkedRecord extends DiskFile {
  directory: number
  inode: string
}

/** SQLite and a small LRU own the inventory. The array facade is compatibility
 * for targeted node access and streamed JSON exports, never eager hydration. */
export class SqliteInventory {
  private connection?: DatabaseSync
  private statements = new Map<string, StatementSync>()
  private nodes = new Map<number, DiskDirectory>()
  private paths = new Map<number, string>()
  private exports = 0
  private disposed = false
  private pendingDispose = false
  private writable = false
  readonly snapshot: DiskSnapshot
  count = 1
  complete = false
  linkedBytes = 0
  linkedApparentBytes = 0
  committedFiles = 0
  committedBytes = 0
  committedApparentBytes = 0
  committedLinks = 0
  committedIssues = 0
  committedExcluded = 0
  directoryCount = 1
  error: string | null = null
  cacheIdentity: string

  constructor(
    readonly file: string,
    metadata: Omit<DiskSnapshot, "directories">,
    identity = ""
  ) {
    this.cacheIdentity = identity
    this.snapshot = { ...metadata, directories: [] }
    const target: DiskDirectory[] = []
    this.snapshot.directories = new Proxy(target, {
      get: (array, key) => {
        if (key === "length") return this.complete ? this.count : 1
        if (key === Symbol.iterator)
          return function* (this: SqliteInventory) {
            for (let id = 0; id < (this.complete ? this.count : 1); id++)
              yield this.get(id)!
          }.bind(this)
        if (typeof key === "string" && /^(0|[1-9]\d*)$/.test(key))
          return this.get(Number(key))
        return Reflect.get(array, key)
      },
      has: (array, key) =>
        typeof key === "string" && /^(0|[1-9]\d*)$/.test(key)
          ? Number(key) < (this.complete ? this.count : 1)
          : Reflect.has(array, key),
    })
    stores.set(this.snapshot, this)
  }

  private db() {
    if (this.disposed) throw new Error("This SQLite inventory is closed")
    if (!this.connection) {
      const { DatabaseSync } =
        require("node:sqlite") as typeof import("node:sqlite")
      this.connection = new DatabaseSync(this.file, {
        readOnly: !this.writable,
      })
      this.connection.exec("PRAGMA cache_size=-8192; PRAGMA temp_store=FILE")
    }
    return this.connection
  }
  private statement(sql: string) {
    let statement = this.statements.get(sql)
    if (!statement) {
      statement = this.db().prepare(sql)
      this.statements.set(sql, statement)
    }
    return statement
  }
  initialize() {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
    closeSync(openSync(this.file, "wx", 0o600))
    this.writable = true
    this.db().exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
      CREATE TABLE scan (id INTEGER PRIMARY KEY CHECK(id=1), metadata TEXT NOT NULL);
      CREATE TABLE directories (
        id INTEGER PRIMARY KEY, parent INTEGER, name TEXT NOT NULL,
        ownBytes INTEGER NOT NULL, ownApparentBytes INTEGER NOT NULL, ownFiles INTEGER NOT NULL,
        skippedLinks INTEGER NOT NULL, issues INTEGER NOT NULL, state TEXT NOT NULL,
        reason TEXT, topFiles TEXT NOT NULL,
        bytes INTEGER NOT NULL DEFAULT 0, apparentBytes INTEGER NOT NULL DEFAULT 0,
        files INTEGER NOT NULL DEFAULT 0, directories INTEGER NOT NULL DEFAULT 0,
        excluded INTEGER NOT NULL DEFAULT 0, totalIssues INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX directory_parent ON directories(parent);
      CREATE INDEX directory_pending ON directories(id) WHERE state='pending';
      CREATE TABLE hardlinks (inode TEXT PRIMARY KEY, directory INTEGER NOT NULL, name TEXT NOT NULL,
        bytes INTEGER NOT NULL, apparentBytes INTEGER NOT NULL) WITHOUT ROWID;
      CREATE INDEX hardlink_directory ON hardlinks(directory, bytes DESC);`)
    this.persist()
    this.db().exec("BEGIN")
  }
  persist() {
    const { directories: _directories, ...metadata } = this.snapshot
    this.statement("INSERT OR REPLACE INTO scan VALUES (1, ?)").run(
      JSON.stringify({
        ...metadata,
        format: "whyfull-sqlite-inventory",
        schemaVersion: 1,
        directoryCount: this.directoryCount,
        cacheIdentity: this.cacheIdentity,
        error: this.error,
      })
    )
  }
  checkpoint() {
    this.persist()
    this.db().exec("COMMIT; BEGIN")
  }
  acceptLinked(record: InventoryLinkedRecord) {
    const result = this.statement(
      "INSERT OR IGNORE INTO hardlinks VALUES (?,?,?,?,?)"
    ).run(
      record.inode,
      record.directory,
      record.name,
      record.bytes,
      record.apparentBytes
    )
    if (result.changes) {
      this.linkedBytes += record.bytes
      this.linkedApparentBytes += record.apparentBytes
    }
  }
  acceptDirectory(record: InventoryDirectoryRecord, limit: number) {
    if (
      !Number.isSafeInteger(record.id) ||
      record.id < 0 ||
      (record.id === 0
        ? record.parent !== null
        : !Number.isSafeInteger(record.parent) ||
          record.parent! >= record.id ||
          record.parent! < 0) ||
      !["scanned", "unreadable", "excluded"].includes(record.state) ||
      typeof record.name !== "string" ||
      record.name.includes("\0") ||
      (record.id > 0 && /[\\/]/.test(record.name)) ||
      !Array.isArray(record.topFiles) ||
      record.topFiles.length > limit
    )
      throw new Error("Invalid directory from scanner")
    const linked = this.statement(
      "SELECT COALESCE(SUM(bytes),0) AS bytes, COALESCE(SUM(apparentBytes),0) AS apparentBytes FROM hardlinks WHERE directory=?"
    ).get(record.id) as { bytes: number; apparentBytes: number }
    const top = this.statement(
      "SELECT name,bytes,apparentBytes FROM hardlinks WHERE directory=? ORDER BY bytes DESC,name LIMIT ?"
    ).all(record.id, limit) as unknown as DiskFile[]
    record.topFiles = [...record.topFiles, ...top]
      .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name))
      .slice(0, limit)
    record.ownBytes += linked.bytes
    record.ownApparentBytes += linked.apparentBytes
    this.statement(
      "INSERT INTO directories (id,parent,name,ownBytes,ownApparentBytes,ownFiles,skippedLinks,issues,state,reason,topFiles) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET ownBytes=excluded.ownBytes,ownApparentBytes=excluded.ownApparentBytes,ownFiles=excluded.ownFiles,skippedLinks=excluded.skippedLinks,issues=excluded.issues,state=excluded.state,reason=excluded.reason,topFiles=excluded.topFiles"
    ).run(
      record.id,
      record.parent,
      record.name,
      record.ownBytes,
      record.ownApparentBytes,
      record.ownFiles,
      record.skippedLinks,
      record.issues,
      record.state,
      record.reason,
      JSON.stringify(record.topFiles)
    )
    this.committedFiles += record.ownFiles
    this.committedBytes += record.ownBytes
    this.committedApparentBytes += record.ownApparentBytes
    this.committedLinks += record.skippedLinks
    this.committedIssues += record.issues
    this.committedExcluded += Number(record.state === "excluded")
  }
  /** The Node frontier lives on disk too; each worker holds only one task. */
  enqueue(id: number, parent: number | null, name: string) {
    this.statement(
      "INSERT INTO directories (id,parent,name,ownBytes,ownApparentBytes,ownFiles,skippedLinks,issues,state,topFiles) VALUES (?,?,?,0,0,0,0,0,'pending','[]')"
    ).run(id, parent, name)
  }
  takePending() {
    const row = this.statement(
      "SELECT id,parent,name FROM directories WHERE state='pending' ORDER BY id LIMIT 1"
    ).get() as { id: number; parent: number | null; name: string } | undefined
    if (!row) return null
    this.statement("UPDATE directories SET state='working' WHERE id=?").run(
      row.id
    )
    return {
      ...row,
      path:
        row.parent === null
          ? this.snapshot.root
          : join(this.path(row.parent), row.name),
    }
  }
  async aggregate(signal: AbortSignal, progress: () => void) {
    const started = performance.now()
    const unfinished = this.statement(
      "SELECT id FROM directories WHERE state IN ('pending','working') LIMIT 1"
    ).get()
    if (unfinished) throw new Error("Scanner returned unfinished directories")
    const counts = this.statement(
      "SELECT COUNT(*) AS n, MAX(id) AS maximum FROM directories"
    ).get() as { n: number; maximum: number }
    if (!counts.n || counts.maximum + 1 !== counts.n)
      throw new Error("Scanner returned an incomplete directory inventory")
    this.count = this.directoryCount = counts.n
    this.db().exec(
      "UPDATE directories SET bytes=ownBytes,apparentBytes=ownApparentBytes,files=ownFiles,directories=0,excluded=(state='excluded'),totalIssues=issues"
    )
    const add = this.statement(`UPDATE directories AS parent SET
      bytes=parent.bytes+child.bytes, apparentBytes=parent.apparentBytes+child.apparentBytes,
      files=parent.files+child.files, directories=parent.directories+child.directories+1,
      excluded=parent.excluded+child.excluded,totalIssues=parent.totalIssues+child.totalIssues
      FROM directories AS child WHERE child.id=? AND parent.id=child.parent`)
    for (let id = this.count - 1; id > 0; id--) {
      if (signal.aborted) throw new Error("Scan cancelled")
      add.run(id)
      if (id % 512 === 0) {
        progress()
        await setImmediate()
      }
    }
    if (signal.aborted) throw new Error("Scan cancelled")
    const aggregationMs = performance.now() - started
    const indexingStarted = performance.now()
    this.db().exec("DROP INDEX directory_pending")
    this.db().exec(
      "CREATE INDEX directory_size ON directories(bytes DESC); CREATE INDEX directory_children_size ON directories(parent,bytes DESC,name)"
    )
    this.complete = true
    this.nodes.clear()
    return { aggregationMs, indexingMs: performance.now() - indexingStarted }
  }
  finish(onCheckpoint?: () => void) {
    this.persist()
    this.db().exec("COMMIT; PRAGMA wal_checkpoint(TRUNCATE)")
    if (onCheckpoint) {
      onCheckpoint()
      this.persist()
      this.db().exec("PRAGMA wal_checkpoint(TRUNCATE)")
    }
    this.suspend()
    this.writable = false
  }
  private raw(id: number) {
    return this.statement("SELECT * FROM directories WHERE id=?").get(
      id
    ) as unknown as Row | undefined
  }
  private path(id: number) {
    const cached = this.paths.get(id)
    if (cached) return cached
    let current: Row | undefined = this.raw(id)
    const names: string[] = []
    while (current && current.parent !== null) {
      names.unshift(current.name)
      const prefix = this.paths.get(current.parent)
      if (prefix) {
        const value = join(prefix, ...names)
        this.remember(this.paths, id, value, 256)
        return value
      }
      current = this.raw(current.parent)
    }
    const value = join(this.snapshot.root, ...names)
    this.remember(this.paths, id, value, 256)
    return value
  }
  private remember<T>(
    cache: Map<number, T>,
    id: number,
    value: T,
    limit = 128
  ) {
    if (cache.size >= limit) cache.delete(cache.keys().next().value!)
    cache.set(id, value)
  }
  get(id: number, children = true): DiskDirectory | undefined {
    if (!Number.isSafeInteger(id) || id < 0 || (!this.complete && id !== 0))
      return undefined
    if (!this.complete)
      return {
        id: 0,
        parent: null,
        path: this.snapshot.root,
        name: basename(this.snapshot.root) || this.snapshot.root,
        children: [],
        topFiles: [],
        ownBytes: 0,
        ownApparentBytes: 0,
        ownFiles: 0,
        bytes: this.committedBytes,
        apparentBytes: this.committedApparentBytes,
        files: this.snapshot.files,
        directories: Math.max(0, this.directoryCount - 1),
        issues: this.snapshot.issues,
        excluded: this.committedExcluded,
        state: this.snapshot.status === "scanning" ? "pending" : "unreadable",
        reason: this.error ?? "Complete the Rust scan to browse its inventory.",
      }
    const cached = children && this.nodes.get(id)
    if (cached) return cached
    const row = this.raw(id)
    if (!row) return undefined
    const node: DiskDirectory = {
      ...row,
      path: this.path(id),
      topFiles: JSON.parse(row.topFiles),
      reason: row.reason ?? undefined,
      children: children
        ? this.statement(
            "SELECT id FROM directories WHERE parent=? ORDER BY id"
          )
            .all(id)
            .map((row) => Number(row.id))
        : [],
    }
    if (children) this.remember(this.nodes, id, node)
    return node
  }
  findPath(path: string) {
    if (!this.complete)
      return policyPath(path) === policyPath(this.snapshot.root) ? 0 : -1
    const root = policyPath(this.snapshot.root),
      value = policyPath(path)
    if (!pathWithin(value, root)) return -1
    let id = 0
    for (const name of relative(root, value).split(sep).filter(Boolean)) {
      const row = this.statement(
        "SELECT id FROM directories WHERE parent=? AND name=?"
      ).get(id, name)
      if (!row) return -1
      id = Number(row.id)
    }
    return id
  }
  children(id: number, limit: number) {
    if (!this.complete) return []
    return this.statement(
      "SELECT id FROM directories WHERE parent=? ORDER BY bytes DESC,name,id LIMIT ?"
    )
      .all(id, limit)
      .map((row) => this.get(Number(row.id), false)!)
  }
  childCount(id: number) {
    return this.complete
      ? Number(
          this.statement(
            "SELECT COUNT(*) AS n FROM directories WHERE parent=?"
          ).get(id)!.n
        )
      : 0
  }
  rank(node: DiskDirectory) {
    if (node.parent === null || !this.complete) return 0
    return Number(
      this.statement(
        "SELECT COUNT(*) AS n FROM directories WHERE parent=? AND (bytes>? OR (bytes=? AND (name<? OR (name=? AND id<?))))"
      ).get(node.parent, node.bytes, node.bytes, node.name, node.name, node.id)!
        .n
    )
  }
  page(
    id: number,
    options: {
      q: string
      sort: "name" | "size"
      offset: number
      minBytes: number
      trashIds: number[]
    }
  ) {
    const node = this.get(id, false)!
    const cte = `WITH entries AS (
      SELECT 'd'||id AS id,id AS directoryId,name,bytes AS value,apparentBytes,'directory' AS kind,
        (id IN (SELECT value FROM json_each(?))) AS marked FROM directories WHERE parent=?
      UNION ALL SELECT 'f'||?||'-'||key,NULL,json_extract(value,'$.name'),json_extract(value,'$.bytes'),
        json_extract(value,'$.apparentBytes'),'file',0 FROM json_each(?)
        WHERE ?!='' OR json_extract(value,'$.bytes')>=?
    )`
    const args = [
      JSON.stringify(options.trashIds),
      id,
      id,
      JSON.stringify(node.topFiles),
      options.q,
      options.minBytes,
      options.q,
    ]
    const where = " WHERE instr(lower(name),lower(?))>0"
    const total = Number(
      this.statement(cte + " SELECT COUNT(*) AS n FROM entries" + where).get(
        ...args
      )!.n
    )
    const offset = Math.min(total, options.offset)
    const rows = this.statement(
      cte +
        " SELECT * FROM entries" +
        where +
        ` ORDER BY marked DESC,${options.sort === "size" ? "value DESC," : ""}name COLLATE NOCASE,id LIMIT 100 OFFSET ?`
    ).all(...args, offset)
    return {
      total,
      offset,
      entries: rows.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        value: Number(row.value),
        apparentBytes: Number(row.apparentBytes),
        kind: String(row.kind),
        directoryId: row.directoryId === null ? null : Number(row.directoryId),
        path:
          row.directoryId === null
            ? join(node.path, String(row.name))
            : this.path(Number(row.directoryId)),
      })),
    }
  }
  projection(paths: string[]) {
    const ids = new Set<number>([0])
    const add = (id: number) => {
      while (id >= 0 && !ids.has(id)) {
        ids.add(id)
        id = this.raw(id)?.parent ?? -1
      }
    }
    for (const path of paths) {
      const id = this.findPath(path)
      if (id >= 0) {
        add(id)
        for (const child of this.children(id, 8)) add(child.id)
      }
    }
    for (const row of this.statement(
      "SELECT id FROM directories WHERE state='scanned' ORDER BY bytes DESC LIMIT 100"
    ).all())
      add(Number(row.id))
    const ordered = [...ids].sort((a, b) => a - b),
      remap = new Map(ordered.map((id, index) => [id, index]))
    const directories = ordered.map((id) => {
      const node = this.get(id, false)!,
        row = this.raw(id)!
      return {
        ...node,
        id: remap.get(id)!,
        parent: node.parent === null ? null : remap.get(node.parent)!,
        issues: row.totalIssues,
        children: [] as number[],
      }
    })
    for (const node of directories)
      if (node.parent !== null) directories[node.parent].children.push(node.id)
    return { ...this.snapshot, directories }
  }
  *chunks(policy = this.snapshot.policy): Generator<string> {
    this.exports++
    try {
      const { directories: _directories, ...meta } = this.snapshot
      yield JSON.stringify({ ...meta, policy }).slice(0, -1) +
        ',"directories":[\n'
      let buffer = ""
      for (let id = 0; id < (this.complete ? this.count : 1); id++) {
        buffer += (id ? ",\n" : "") + JSON.stringify(this.get(id))
        if (buffer.length >= 65536) {
          yield buffer
          buffer = ""
        }
      }
      if (buffer) yield buffer
      yield "\n]}\n"
    } finally {
      this.exports--
      if (this.pendingDispose && !this.exports) {
        this.disposed = true
        this.remove()
      }
    }
  }
  suspend() {
    this.nodes.clear()
    this.paths.clear()
    this.statements.clear()
    this.connection?.close()
    this.connection = undefined
  }
  dispose() {
    this.pendingDispose = true
    if (!this.exports) {
      this.disposed = true
      this.remove()
    }
  }
  private remove() {
    this.suspend()
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        unlinkSync(this.file + suffix)
      } catch {
        /* No database is created for an idle scanner. */
      }
    }
  }
  static open(file: string) {
    const { DatabaseSync } =
      require("node:sqlite") as typeof import("node:sqlite")
    const db = new DatabaseSync(file, { readOnly: true })
    let meta: Omit<DiskSnapshot, "directories" | "format"> & {
      directoryCount: number
      cacheIdentity: string
      format: string
    }
    try {
      meta = JSON.parse(
        String(
          db.prepare("SELECT metadata FROM scan WHERE id=1").get()!.metadata
        )
      )
    } finally {
      db.close()
    }
    if (
      meta.format !== "whyfull-sqlite-inventory" ||
      meta.schemaVersion !== 1 ||
      meta.status !== "complete" ||
      !["node", "rust"].includes(meta.scanner ?? "") ||
      !Number.isSafeInteger(meta.directoryCount) ||
      meta.directoryCount < 1
    )
      throw new Error("Not a completed SQLite inventory")
    const { directoryCount, cacheIdentity, format: _format, ...snapshot } = meta
    const inventory = new SqliteInventory(
      file,
      { ...snapshot, format: "whyfull-disk" },
      cacheIdentity
    )
    inventory.count = inventory.directoryCount = directoryCount
    inventory.complete = true
    return inventory
  }
}

const inventoryCacheDirectory = (directory: string) =>
  basename(directory) === ".whyfull"
    ? join(directory, "inventories")
    : join(directory, ".whyfull", "inventories")
export const inventoryCachePath = (
  directory: string,
  root: string,
  scanner = "node"
) =>
  join(
    inventoryCacheDirectory(directory),
    createHash("sha256").update(root).digest("hex") + `.${scanner}.sqlite`
  )
async function clone(source: string, target: string) {
  try {
    await link(source, target)
  } catch (error) {
    if (
      !["EXDEV", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EPERM"].includes(
        (error as NodeJS.ErrnoException).code ?? ""
      )
    )
      throw error
    await copyFile(
      source,
      target,
      constants.COPYFILE_FICLONE | constants.COPYFILE_EXCL
    )
  }
}
export async function loadInventoryCache(
  directory: string,
  root: string,
  options: DiskScanOptions
) {
  const slot = inventoryCachePath(directory, root, options.scanner)
  try {
    statSync(slot)
  } catch {
    return null
  }
  const working = inventoryWorkingDirectory(join(directory, "config.json"))
  await mkdir(working, { recursive: true, mode: 0o700 })
  const file = join(working, randomUUID() + ".sqlite")
  try {
    await clone(slot, file)
    const inventory = SqliteInventory.open(file)
    if (
      inventory.snapshot.root !== root ||
      inventory.cacheIdentity !== inventoryIdentity(root, options)
    ) {
      inventory.dispose()
      return null
    }
    return inventory.snapshot
  } catch {
    await rm(file, { force: true })
    return null
  }
}
export async function saveInventoryCache(
  directory: string,
  snapshot: DiskSnapshot
) {
  const inventory = sqliteInventory(snapshot)
  if (!inventory?.complete || snapshot.status !== "complete") return null
  inventory.suspend()
  const slot = inventoryCachePath(directory, snapshot.root, snapshot.scanner)
  await mkdir(dirname(slot), { recursive: true, mode: 0o700 })
  const temporary = slot + "." + randomUUID() + ".tmp"
  try {
    await clone(inventory.file, temporary)
    await rename(temporary, slot)
  } finally {
    await rm(temporary, { force: true })
  }
  const pointer = join(directory, randomUUID() + ".tmp")
  try {
    await writeFile(
      pointer,
      JSON.stringify({
        root: snapshot.root,
        path: slot,
        completedAt: snapshot.completedAt,
        scanner: snapshot.scanner,
      }),
      { mode: 0o600, flag: "wx" }
    )
    await rename(pointer, join(directory, "latest.json"))
  } finally {
    await rm(pointer, { force: true })
  }
  return slot
}

/** Open a private link; releasing it never deletes an imported/cache file. */
export async function loadSqliteSnapshot(source: string) {
  const working = join(tmpdir(), ".whyfull", "inventories")
  await mkdir(working, { recursive: true, mode: 0o700 })
  const file = join(working, randomUUID() + ".sqlite")
  try {
    await clone(source, file)
    return SqliteInventory.open(file).snapshot
  } catch (error) {
    await rm(file, { force: true })
    throw error
  }
}
