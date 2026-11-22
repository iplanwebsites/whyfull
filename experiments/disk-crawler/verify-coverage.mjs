// Compare totals and error-directory coverage without loading the Node tree.
// Detailed paths are private output; callers should publish only the summary.
import { createReadStream, writeFileSync } from "node:fs"
import { createInterface } from "node:readline"
import { DatabaseSync } from "node:sqlite"

const [nodeFile, rustFile, output] = process.argv.slice(2)
if (!output)
  throw new Error(
    "Usage: node experiments/disk-crawler/verify-coverage.mjs NODE_JSON RUST_SQLITE NEW_OUTPUT_JSON"
  )
const db = new DatabaseSync(rustFile, { readOnly: true })
db.exec("PRAGMA cache_size=-4096")
try {
  const rust = JSON.parse(
    db.prepare("SELECT metadata FROM scan WHERE id=1").get().metadata
  )
  const byId = db.prepare("SELECT id, parent, name FROM directories WHERE id=?")
  const child = db.prepare(
    "SELECT id, name, state, ownFiles, reason FROM directories WHERE parent=? AND name=?"
  )
  const errors = db
    .prepare(
      "SELECT id, parent, name, state, ownFiles, issues, reason FROM directories WHERE issues>0"
    )
    .all()
  const byPath = new Map()
  for (const node of errors) {
    let ancestor = node
    const parts = []
    while (ancestor.parent !== null) {
      parts.push(ancestor.name)
      ancestor = byId.get(ancestor.parent)
    }
    byPath.set(rust.root + "/" + parts.reverse().join("/"), node)
  }
  let nodeMeta,
    first = true
  const differences = [],
    onlyNodeUnreadable = []
  let matched = 0,
    unreadableBoth = 0
  const lines = createInterface({
    input: createReadStream(nodeFile, { highWaterMark: 1024 * 1024 }),
    crlfDelay: Infinity,
  })
  for await (const raw of lines) {
    const line = raw.trim()
    if (first) {
      first = false
      const suffix = ',"directories":['
      if (!line.endsWith(suffix))
        throw new Error("Expected line-oriented whyfull snapshot")
      nodeMeta = JSON.parse(line.slice(0, -suffix.length) + "}")
      if (nodeMeta.root !== rust.root) throw new Error("Roots differ")
      continue
    }
    if (!line || line === "]}") continue
    const node = JSON.parse(line.endsWith(",") ? line.slice(0, -1) : line)
    const record = byPath.get(node.path)
    if (record) {
      matched++
      if (record.state === "unreadable" && node.state === "unreadable")
        unreadableBoth++
      if (record.state !== node.state || record.ownFiles !== node.ownFiles)
        differences.push({
          path: node.path,
          rust: record,
          node: {
            state: node.state,
            ownFiles: node.ownFiles,
            files: node.files,
            issues: node.issues,
            reason: node.reason,
          },
        })
      byPath.delete(node.path)
    } else if (node.state === "unreadable") onlyNodeUnreadable.push(node)
  }
  let nodeOnlyUnreadableFilesSeenByRust = 0
  for (const node of onlyNodeUnreadable) {
    let current = { id: 0, state: "scanned", ownFiles: 0 }
    for (const component of node.path
      .slice(rust.root.length)
      .split("/")
      .filter(Boolean)) {
      current = child.get(current.id, component)
      if (!current) break
    }
    if (current?.state === "scanned") {
      nodeOnlyUnreadableFilesSeenByRust += current.ownFiles
      differences.push({
        path: node.path,
        rust: current,
        node: {
          state: node.state,
          ownFiles: node.ownFiles,
          files: node.files,
          issues: node.issues,
          reason: node.reason,
        },
      })
    }
  }
  const summary = {
    root: rust.root,
    nodeFiles: nodeMeta.files,
    rustFiles: rust.files,
    fileDifference: rust.files - nodeMeta.files,
    fileDifferenceFraction: (rust.files - nodeMeta.files) / nodeMeta.files,
    nodeIssues: nodeMeta.issues,
    rustIssues: rust.issues,
    rustErrorDirectories: errors.length,
    matchedErrorDirectories: matched,
    unreadableInBoth: unreadableBoth,
    unmatchedRustErrorDirectories: byPath.size,
    rustOnlyUnreadableFilesSeenByNode: differences
      .filter(
        (d) => d.rust.state === "unreadable" && d.node.state === "scanned"
      )
      .reduce((s, d) => s + d.node.files, 0),
    nodeOnlyUnreadableDirectFilesSeenByRust: nodeOnlyUnreadableFilesSeenByRust,
  }
  writeFileSync(
    output,
    JSON.stringify(
      { summary, differences, unmatched: [...byPath.entries()] },
      null,
      2
    ) + "\n",
    { flag: "wx", mode: 0o600 }
  )
  console.log(JSON.stringify(summary))
} finally {
  db.close()
}
