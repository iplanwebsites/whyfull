// Writes a synthetic, privacy-safe disk snapshot of a typical developer home,
// used to capture website screenshots without exposing real folders.
//
//   node scripts/demo-snapshot.mjs <home-root> <output.json>
//   pnpm whyfull --ui --snapshot <output.json> --no-open
import { writeFileSync } from "node:fs"
import { isAbsolute, join, normalize, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const GB = 1024 ** 3
const MB = 1024 ** 2

// Leaf sizes in bytes; nested objects are folders.
const tree = {
  Library: {
    Containers: { "com.docker.docker": { Data: { vms: 61.4 * GB } } },
    Developer: {
      Xcode: {
        DerivedData: {
          "Acme-ios": 9.8 * GB,
          Widgets: 6.1 * GB,
          Notes: 3.4 * GB,
        },
      },
      CoreSimulator: {
        Devices: {
          "iPhone 17": 8.2 * GB,
          "iPad Air": 5.9 * GB,
          "iPhone SE": 3.1 * GB,
        },
      },
    },
    Caches: {
      "com.spotify.client": 4.6 * GB,
      Google: 2.9 * GB,
      "ms-playwright": 1.8 * GB,
      Homebrew: 2.2 * GB,
    },
    "Application Support": {
      Code: 3.1 * GB,
      Slack: 1.4 * GB,
      "LM Studio": { models: 21.7 * GB },
    },
  },
  ".ollama": { models: { blobs: 38.6 * GB } },
  ".cache": {
    huggingface: { hub: 24.3 * GB },
    uv: 4.1 * GB,
    pip: 1.6 * GB,
    torch: 2.7 * GB,
  },
  ".npm": { _cacache: 6.2 * GB },
  ".cargo": { registry: 3.8 * GB },
  ".claude": { projects: 1.2 * GB },
  Code: {
    "acme-web": { node_modules: 2.6 * GB, ".next": 1.1 * GB, src: 140 * MB },
    "acme-api": { target: 7.4 * GB, src: 90 * MB },
    "ml-playground": { ".venv": 5.3 * GB, data: 9.2 * GB },
    "design-system": { node_modules: 1.9 * GB, src: 60 * MB },
    "acme-web-worktrees": {
      "fix-login": { node_modules: 2.4 * GB },
      "agent-refactor": { node_modules: 2.5 * GB },
    },
  },
  Pictures: { "Photos Library.photoslibrary": 48.2 * GB },
  Movies: { "Screen recordings": 18.4 * GB, Exports: 11.7 * GB },
  Music: 7.3 * GB,
  Documents: { Invoices: 0.6 * GB, Design: 6.8 * GB, Notes: 0.3 * GB },
  Downloads: { installers: 9.4 * GB, datasets: 12.1 * GB, misc: 2.2 * GB },
  Desktop: 1.7 * GB,
}

export function createDemoSnapshot(root) {
  if (!isAbsolute(root)) throw new Error("Demo root must be an absolute path")
  root = normalize(root)
  const directories = []
  function add(path, name, parent, value) {
    const id = directories.length
    const node = {
      id,
      parent,
      path,
      name,
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
    }
    directories.push(node)
    if (typeof value === "number") {
      const bytes = Math.round(value)
      const files = Math.max(1, Math.round(bytes / (3 * MB)))
      Object.assign(node, {
        ownBytes: bytes,
        ownApparentBytes: bytes,
        ownFiles: files,
        topFiles: [
          {
            name: `${name}.bin`,
            bytes: Math.round(bytes / 5),
            apparentBytes: Math.round(bytes / 5),
          },
        ],
      })
    } else {
      for (const [childName, childValue] of Object.entries(value)) {
        const child = add(join(path, childName), childName, id, childValue)
        node.children.push(child.id)
      }
    }
    node.bytes = node.ownBytes
    node.apparentBytes = node.ownApparentBytes
    node.files = node.ownFiles
    for (const childId of node.children) {
      const child = directories[childId]
      node.bytes += child.bytes
      node.apparentBytes += child.apparentBytes
      node.files += child.files
      node.directories += child.directories + 1
    }
    return node
  }

  // The display name never includes the capturing machine's account name.
  // Children must have higher ids than their parent: depth-first insertion does that.
  add(root, "Home", null, tree)
  return {
    format: "whyfull-disk",
    schemaVersion: 1,
    root,
    startedAt: "2026-11-01T11:59:12.000Z",
    completedAt: "2026-11-01T12:00:00.000Z",
    durationMs: 48_000,
    status: "complete",
    workers: 8,
    engine: "async",
    scanner: "node",
    files: directories[0].files,
    skippedLinks: 0,
    issues: 0,
    policy: { keep: [], exclude: [] },
    directories,
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [root, output, extra] = process.argv.slice(2)
  if (!root || !output || extra)
    throw new Error(
      "Usage: node scripts/demo-snapshot.mjs <home-root> <output>"
    )
  const snapshot = createDemoSnapshot(root)
  writeFileSync(output, JSON.stringify(snapshot))
  console.log(
    `Wrote ${snapshot.directories.length} folders, ${(snapshot.directories[0].bytes / GB).toFixed(1)} GiB → ${output}`
  )
}
