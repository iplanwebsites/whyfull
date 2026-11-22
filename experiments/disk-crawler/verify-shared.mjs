// Error-directory coverage audit for two application SQLite inventories.
// Detailed paths stay in private output; publish only the summary.
import { DatabaseSync } from "node:sqlite"
import { writeFileSync } from "node:fs"
const [nodeFile, rustFile, output] = process.argv.slice(2)
if (!output)
  throw new Error(
    "Usage: node verify-shared.mjs NODE_SQLITE RUST_SQLITE PRIVATE_OUTPUT_JSON"
  )
const open = (file) => {
  const db = new DatabaseSync(file, { readOnly: true })
  db.exec("PRAGMA cache_size=-4096")
  const metadata = JSON.parse(
    db.prepare("SELECT metadata FROM scan WHERE id=1").get().metadata
  )
  const byId = db.prepare(
    "SELECT id,parent,name,state,ownFiles,files,issues,reason FROM directories WHERE id=?"
  )
  const child = db.prepare(
    "SELECT id,parent,name,state,ownFiles,files,issues,reason FROM directories WHERE parent=? AND name=?"
  )
  const path = (row) => {
    const parts = []
    while (row.parent !== null) {
      parts.push(row.name)
      row = byId.get(row.parent)
    }
    return parts.reverse().join("/")
  }
  const find = (path) => {
    let row = byId.get(0)
    for (const part of path.split("/").filter(Boolean)) {
      row = child.get(row.id, part)
      if (!row) return null
    }
    return row
  }
  return {
    db,
    metadata,
    path,
    find,
    errors: db
      .prepare(
        "SELECT id,parent,name,state,ownFiles,files,issues,reason FROM directories WHERE issues>0"
      )
      .all(),
  }
}
const node = open(nodeFile),
  rust = open(rustFile)
try {
  if (node.metadata.root !== rust.metadata.root)
    throw new Error("Different scan roots")
  const differences = []
  let matched = 0,
    unreadableBoth = 0,
    unmatchedRustErrors = 0,
    rustOnlyUnreadableFilesSeenByNode = 0,
    nodeOnlyUnreadableFilesSeenByRust = 0
  const paths = new Set()
  for (const row of rust.errors) {
    const path = rust.path(row)
    paths.add(path)
    const other = node.find(path)
    if (other) {
      matched++
      if (row.state === "unreadable" && other.state === "unreadable")
        unreadableBoth++
    } else unmatchedRustErrors++
    if (
      !other ||
      row.state !== other.state ||
      row.ownFiles !== other.ownFiles
    ) {
      differences.push({ path, node: other, rust: row })
      if (row.state === "unreadable" && other?.state === "scanned")
        rustOnlyUnreadableFilesSeenByNode += other.files
    }
  }
  for (const row of node.errors) {
    const path = node.path(row)
    if (paths.has(path)) continue
    const other = rust.find(path)
    differences.push({ path, node: row, rust: other })
    if (row.state === "unreadable" && other?.state === "scanned")
      nodeOnlyUnreadableFilesSeenByRust += other.files
  }
  const summary = {
    nodeFiles: node.metadata.files,
    rustFiles: rust.metadata.files,
    fileDifference: rust.metadata.files - node.metadata.files,
    nodeIssues: node.metadata.issues,
    rustIssues: rust.metadata.issues,
    nodeErrorDirectories: node.errors.length,
    rustErrorDirectories: rust.errors.length,
    matchedRustErrorDirectories: matched,
    unreadableInBoth: unreadableBoth,
    unmatchedRustErrorDirectories: unmatchedRustErrors,
    rustOnlyUnreadableFilesSeenByNode,
    nodeOnlyUnreadableFilesSeenByRust,
    differenceCount: differences.length,
  }
  writeFileSync(
    output,
    JSON.stringify({ summary, differences }, null, 2) + "\n",
    { flag: "wx", mode: 0o600 }
  )
  console.log(JSON.stringify(summary))
} finally {
  node.db.close()
  rust.db.close()
}
