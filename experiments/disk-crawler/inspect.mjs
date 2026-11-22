// Paginated directory inspection. Recursive totals stay in SQLite, never in a
// full JS tree. A production viewer would cache aggregates for repeated reads.
import { DatabaseSync } from "node:sqlite"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

export function inspectDatabase(file, id = 0, limit = 100) {
  if (
    !Number.isSafeInteger(id) ||
    id < 0 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 1000
  )
    throw new Error("Invalid directory id or limit (1..1000)")
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    db.exec("PRAGMA cache_size=-8192; PRAGMA temp_store=FILE")
    const metadata = JSON.parse(
      db.prepare("SELECT metadata FROM scan WHERE id=1").get().metadata
    )
    const directory = db.prepare("SELECT * FROM directories WHERE id=?").get(id)
    if (directory) directory.topFiles = JSON.parse(directory.topFiles)
    const children = db
      .prepare(
        `
      WITH RECURSIVE subtree(id, branch) AS (
        SELECT id, id FROM directories WHERE parent = ?
        UNION ALL
        SELECT d.id, subtree.branch FROM directories d JOIN subtree ON d.parent = subtree.id
      )
      SELECT child.id, child.name, child.state,
        SUM(d.ownBytes) AS bytes, SUM(d.ownApparentBytes) AS apparentBytes,
        SUM(d.ownFiles) AS files, COUNT(*) - 1 AS directories,
        SUM(d.issues) AS issues
      FROM subtree JOIN directories d ON d.id = subtree.id
        JOIN directories child ON child.id = subtree.branch
      GROUP BY subtree.branch ORDER BY bytes DESC, child.id LIMIT ?
    `
      )
      .all(id, limit)
    return {
      metadata,
      directory: directory ?? null,
      children,
      partial: metadata.status !== "complete",
    }
  } finally {
    db.close()
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (!process.argv[2])
    throw new Error(
      "Usage: node experiments/disk-crawler/inspect.mjs DATABASE [DIRECTORY_ID=0] [LIMIT=100]"
    )
  console.log(
    JSON.stringify(
      inspectDatabase(
        process.argv[2],
        Number(process.argv[3] ?? 0),
        Number(process.argv[4] ?? 100)
      ),
      null,
      2
    )
  )
}
