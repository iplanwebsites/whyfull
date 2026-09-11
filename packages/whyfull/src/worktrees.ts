/**
 * Git worktree discovery. READ-ONLY, pure node:fs, no `git` binary.
 *
 * Agent tools create a worktree per task in six different places and most never
 * clean up; a worktree is a full checkout plus its own node_modules and build
 * output, so they are usually the largest untracked thing on a dev machine.
 *
 * The scan does not crawl the disk. It cannot afford to, and does not need to:
 * every linked worktree's `.git` file names its main repo, and every main repo's
 * admin dir names every one of its worktrees. One hit anywhere in a cluster
 * reveals the whole cluster, so shallow seeds plus metadata expansion finds
 * worktrees in locations no seed would ever have looked at — that is how
 * `~/.codex/worktrees/*` turns up from a seed in `~/web/git`.
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs"
import { homedir } from "node:os"
import { dirname, join, basename } from "node:path"
import { measure } from "./size"
import { sharedStore } from "./pnpm"
import type {
  WorktreeCluster,
  WorktreeEntry,
  WorktreeOptions,
  WorktreeResult,
  WorktreeState,
  WorktreeTool,
} from "./types"

const DAY_MS = 86400000

// A checkout writes HEAD, index and the admin `gitdir` file all within the
// same operation, so index mtime being a second or two after HEAD's is just
// filesystem write ordering, not evidence of later activity. Only a gap wider
// than this is worth calling out, and even then only as a weak hint.
const DIRTY_THRESHOLD_MS = 60000

/** In-repo folders a tool puts worktrees in. Checked at every seed level. */
const TOOL_DIRS = [
  ".claude/worktrees",
  ".gemini/worktrees",
  ".cursor/worktrees",
  ".opencode/worktrees",
  ".worktrees",
  "worktrees",
  ".conductor",
  ".bare",
]

/** Never descend into these while looking for repos — they are never repos. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "target",
  ".next",
  "Library",
  "vendor",
  "venv",
  ".venv",
])

/** Home-level roots a tool owns outright. The glob depth each one needs. */
function homeSeedRoots(home: string): Array<{ root: string; depth: number }> {
  return [
    // `<id>/<repo>` layouts: the worktree is two levels down.
    { root: join(home, ".codex", "worktrees"), depth: 2 },
    { root: join(home, ".windsurf", "worktrees"), depth: 2 },
    { root: join(home, ".vibe-kanban", "workspaces"), depth: 2 },
    { root: join(home, "conductor", "workspaces"), depth: 2 },
    // Flat layouts.
    { root: join(home, "worktrees"), depth: 1 },
    { root: join(home, ".worktrees"), depth: 1 },
    { root: join(home, ".cursor", "worktrees"), depth: 1 },
  ]
}

/** Where people keep checkouts. Walked shallowly, looking only for repos. */
function codeSeedRoots(home: string): string[] {
  return [
    "code",
    "dev",
    "src",
    "projects",
    "repos",
    "work",
    "git",
    "web",
    "Developer",
    "Documents/GitHub",
    "GitHub",
    "Sites",
    "workspace",
    "go/src",
  ].map((p) => join(home, p))
}

function toolFor(path: string): WorktreeTool {
  if (path.includes("/.claude/worktrees/")) return "claude"
  if (path.includes("/.codex/worktrees/")) return "codex"
  if (path.includes("/.gemini/worktrees/")) return "gemini"
  if (path.includes("/.windsurf/worktrees/")) return "windsurf"
  if (path.includes("/.cursor/worktrees/")) return "cursor"
  if (path.includes("/.opencode/worktrees/")) return "opencode"
  if (path.includes("/.vibe-kanban/")) return "vibe-kanban"
  if (path.includes("/conductor/workspaces/") || path.includes("/.conductor/"))
    return "conductor"
  if (path.includes("/copilot-worktree")) return "copilot"
  if (/-junie-wt-\d+$/.test(path)) return "junie"
  if (path.includes("/worktrees/") || path.includes("/.worktrees/"))
    return "zed"
  return "manual"
}

/** Stable identity for dedup. realpath resolves `/tmp` -> `/private/tmp` etc. */
function realOrRaw(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return null
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function mtimeOf(path: string): number {
  try {
    return statSync(path).mtimeMs
  } catch {
    return -1
  }
}

/**
 * A `.git` FILE holds `gitdir: <admin dir>`. The admin dir tells us which
 * layout we are in:
 *   `<main>/.git/worktrees/<name>`  — ordinary linked worktree
 *   `<main>/.bare/worktrees/<name>` — bare-repo layout
 *   `<main>/.git/modules/<name>`    — a SUBMODULE, not a worktree. Skipped.
 */
function parseGitFile(gitFile: string): {
  adminDir: string
  mainRepo: string
  gitRoot: string
  name: string
} | null {
  const text = readText(gitFile)
  if (!text) return null
  const m = /^gitdir:[ \t]*(.+?)[ \t]*$/m.exec(text)
  if (!m) return null
  const adminDir = m[1]

  for (const marker of ["/.git/worktrees/", "/.bare/worktrees/"]) {
    const at = adminDir.lastIndexOf(marker)
    if (at < 0) continue
    return {
      adminDir,
      mainRepo: adminDir.slice(0, at),
      gitRoot: adminDir.slice(0, at + marker.length - "worktrees/".length - 1),
      name: basename(adminDir),
    }
  }
  return null
}

/** Decode `~/.claude/projects/<encoded>` back to a repo path, best effort. */
function decodeClaudeProject(encoded: string): string | null {
  // The encoding replaces every `/` with `-`, which is lossy: a repo with a `-`
  // in its name is indistinguishable from a path separator. Rather than guess,
  // try each way of splitting from the right and take the first that exists.
  if (!encoded.startsWith("-")) return null
  const parts = encoded.slice(1).split("-")
  for (let split = parts.length; split > 0; split -= 1) {
    // Re-join the tail with "-" (a literal dash in the final segment) and the
    // head with "/". Most paths have no dashes and resolve on the first try.
    const candidate = `/${parts.slice(0, split).join("/")}`
    if (isDir(candidate)) return candidate
    const merged = `/${[...parts.slice(0, split - 1), parts.slice(split - 1).join("-")].join("/")}`
    if (isDir(merged)) return merged
  }
  return null
}

/**
 * Collect `.git` files and main-repo git roots from a directory tree, at most
 * `maxDepth` levels down. Only looks for `.git` entries and the tool folders —
 * this is a directory-name scan, never a file walk.
 */
function seedWalk(
  root: string,
  maxDepth: number,
  gitFiles: Set<string>,
  gitRoots: Set<string>
): void {
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]

  while (stack.length > 0) {
    const { dir, depth } = stack.pop()!

    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      const full = join(dir, entry.name)

      if (entry.name === ".git") {
        // A `.git` dir is a main repo; a `.git` file is a linked worktree.
        if (entry.isDirectory()) gitRoots.add(full)
        else if (entry.isFile()) gitFiles.add(full)
        continue
      }
      if (entry.name === ".bare" && entry.isDirectory()) {
        gitRoots.add(full)
        continue
      }
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      if (SKIP_DIRS.has(entry.name)) continue
      if (depth >= maxDepth) continue

      // Hidden dirs are skipped unless a tool is known to put worktrees there.
      const hidden = entry.name.startsWith(".")
      const toolDir = TOOL_DIRS.some(
        (t) => t === entry.name || t.startsWith(`${entry.name}/`)
      )
      if (hidden && !toolDir) continue

      stack.push({ dir: full, depth: depth + 1 })
    }
  }
}

/** List `<root>/*` (depth 1) or `<root>/*​/*` (depth 2) and seed from each. */
function expandHomeRoot(
  root: string,
  depth: number,
  gitFiles: Set<string>,
  gitRoots: Set<string>
): void {
  // These roots contain nothing but worktrees, so the walk is a plain listing
  // at a fixed depth rather than the heuristic seedWalk.
  let dirs = [root]
  for (let level = 0; level < depth; level += 1) {
    const next: string[] = []
    for (const d of dirs) {
      let entries
      try {
        entries = readdirSync(d, { withFileTypes: true })
      } catch {
        continue
      }
      for (const e of entries) {
        if (!e.isDirectory() || e.isSymbolicLink()) continue
        next.push(join(d, e.name))
      }
    }
    dirs = next
  }
  for (const d of dirs) {
    const dotGit = join(d, ".git")
    try {
      const st = statSync(dotGit)
      if (st.isFile()) gitFiles.add(dotGit)
      else if (st.isDirectory()) gitRoots.add(dotGit)
    } catch {
      /* not a checkout; the listing is cheap enough to not care */
    }
  }
}

/** Admin dirs (`<gitRoot>/worktrees/<name>`) registered by one main repo. */
function registrations(gitRoot: string): string[] {
  const dir = join(gitRoot, "worktrees")
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.isSymbolicLink())
      .map((e) => join(dir, e.name))
  } catch {
    return []
  }
}

/**
 * `worktree remove` refuses a dirty checkout and `branch -d` refuses an
 * unmerged branch — that refusal is the safety net, which is exactly why
 * `--force` must never appear here: it is the one flag that switches off the
 * safety net this hint relies on.
 */
function hintFor(e: {
  state: WorktreeState
  mainRepo: string
  path: string
  branch: string | null
}): string {
  switch (e.state) {
    case "locked":
      return `a tool session may be live — git -C ${e.mainRepo} worktree unlock ${e.path} first`
    case "orphan":
      return `nothing in git references this — rm -rf ${e.path}`
    case "stale":
      return `git -C ${e.mainRepo} worktree prune`
    default: {
      const branch = e.branch
        ? ` && git -C ${e.mainRepo} branch -d ${e.branch}`
        : ""
      return `git -C ${e.mainRepo} worktree remove ${e.path}${branch}`
    }
  }
}

/**
 * Find every git worktree reachable from the seeds, classify and size it.
 *
 * Sizing is the expensive half and is bounded by the same `measure()` budget
 * the target scan uses; discovery itself is a few hundred directory reads.
 */
export function findWorktrees(opts: WorktreeOptions = {}): WorktreeResult {
  const {
    roots = [],
    includeDefaults = true,
    minAgeDays = 0,
    budget = 20000,
    exact = false,
    maxWorktrees = 500,
    onProgress = null,
  } = opts

  const home = homedir()
  const seeds: string[] = []
  const gitFiles = new Set<string>()
  const gitRoots = new Set<string>()

  // ------------------------------------------------------------- seeding ---
  for (const extra of roots) {
    if (!isDir(extra)) continue
    seeds.push(extra)
    seedWalk(extra, 3, gitFiles, gitRoots)
  }

  if (includeDefaults) {
    for (const { root, depth } of homeSeedRoots(home)) {
      if (!isDir(root)) continue
      seeds.push(root)
      expandHomeRoot(root, depth, gitFiles, gitRoots)
    }

    for (const root of [
      ...codeSeedRoots(home),
      process.cwd(),
      dirname(process.cwd()),
    ]) {
      if (!isDir(root)) continue
      seeds.push(root)
      seedWalk(root, 3, gitFiles, gitRoots)
    }

    // Claude Code's transcript dirs name every repo the user has worked in,
    // including ones under no common code root. Best effort, silent on failure.
    try {
      const projects = join(home, ".claude", "projects")
      for (const e of readdirSync(projects, { withFileTypes: true })) {
        if (!e.isDirectory()) continue
        const repo = decodeClaudeProject(e.name)
        if (!repo) continue
        seeds.push(repo)
        const dotGit = join(repo, ".git")
        try {
          const st = statSync(dotGit)
          if (st.isFile()) gitFiles.add(dotGit)
          else if (st.isDirectory()) gitRoots.add(dotGit)
        } catch {
          /* the decoded path exists but is not a checkout */
        }
        for (const t of TOOL_DIRS) {
          const tp = join(repo, t)
          if (isDir(tp)) expandHomeRoot(tp, 1, gitFiles, gitRoots)
        }
      }
    } catch {
      /* no Claude Code state on this machine */
    }
  }

  // ----------------------------------------------------------- expansion ---
  // Fixed point: every `.git` file names a main repo, every main repo names
  // every sibling worktree, and those siblings can live anywhere. Iterate until
  // nothing new appears.
  const seenRoots = new Set<string>()
  const adminDirs = new Map<string, { gitRoot: string; mainRepo: string }>()
  let changed = true
  let truncated = false

  while (changed) {
    changed = false

    for (const gitFile of [...gitFiles]) {
      const parsed = parseGitFile(gitFile)
      if (!parsed) continue
      if (!gitRoots.has(parsed.gitRoot)) {
        gitRoots.add(parsed.gitRoot)
        changed = true
      }
    }

    for (const gitRoot of [...gitRoots]) {
      const key = realOrRaw(gitRoot)
      if (seenRoots.has(key)) continue
      seenRoots.add(key)
      changed = true

      const mainRepo = dirname(gitRoot)
      for (const admin of registrations(gitRoot)) {
        if (adminDirs.size >= maxWorktrees) {
          truncated = true
          break
        }
        if (!adminDirs.has(admin)) adminDirs.set(admin, { gitRoot, mainRepo })
        // The registration names the worktree's `.git` file, which may itself
        // point at a *different* main repo (the "copied repo" orphan case).
        const target = readText(join(admin, "gitdir"))?.trim()
        if (target) gitFiles.add(target)
      }
      if (truncated) break
    }
    if (truncated) break
  }

  // ------------------------------------------------------- classification --
  const clusters = new Map<string, WorktreeCluster>()
  const seenWorktrees = new Set<string>()
  const now = Date.now()

  // One inode set across every worktree, the same contract scan() uses: a blob
  // hard-linked into two sibling worktrees is real disk once, and attributing
  // it twice would claim removing either frees bytes that removing both frees
  // once. It also makes the pass roughly linear instead of re-walking 26
  // near-identical checkouts in full.
  const seen = new Set<string>()

  for (const [admin, { mainRepo }] of adminDirs) {
    const name = basename(admin)
    const target = readText(join(admin, "gitdir"))?.trim() ?? null
    // The registration points at `<worktree>/.git`; the worktree is its parent.
    const wtPath = target ? dirname(target) : null

    // The worktree's own `.git` file is the authority on which repo owns it.
    // A registration is only evidence that SOME repo claims it.
    const back = wtPath ? parseGitFile(join(wtPath, ".git")) : null
    const ownedByThis =
      back !== null && realOrRaw(back.adminDir) === realOrRaw(admin)

    // A `.git`-only backup of a repo carries a full copy of the original's
    // worktree registry, so it claims every live checkout of the real repo.
    // Reporting those as orphans would print `rm -rf` for worktrees that are
    // perfectly healthy — the worst possible false positive for this tool. If
    // the checkout names a different admin dir that really exists, it belongs
    // to that repo and this registration is simply a stale copy.
    if (!ownedByThis && back !== null && isDir(back.adminDir)) continue

    let state: WorktreeState
    if (!wtPath || !existsSync(wtPath)) {
      state = "stale"
    } else if (existsSync(join(admin, "locked"))) {
      state = "locked"
    } else {
      // Orphan: the checkout exists but no live admin dir owns it. Its `.git`
      // points at something missing, so every git command inside it fails.
      state = ownedByThis ? "linked" : "orphan"
    }

    const key = wtPath ? realOrRaw(wtPath) : `stale:${admin}`
    if (seenWorktrees.has(key)) continue
    seenWorktrees.add(key)

    const headText = readText(join(admin, "HEAD"))?.trim() ?? ""
    const ref = /^ref:[ \t]*refs\/heads\/(.+)$/.exec(headText)
    const branch = ref ? ref[1] : null
    const detached = Boolean(headText) && !ref

    const headMtime = mtimeOf(join(admin, "HEAD"))
    const indexMtime = mtimeOf(join(admin, "index"))
    const gitdirMtime = mtimeOf(join(admin, "gitdir"))
    const lastActivityMs = Math.max(headMtime, indexMtime)
    const ageDays =
      lastActivityMs > 0 ? Math.floor((now - lastActivityMs) / DAY_MS) : -1

    // A checkout writes HEAD, index and gitdir within the same second, so
    // `index mtime > HEAD mtime` is true almost always and means nothing. Only
    // call it out when the index is meaningfully newer than BOTH other admin
    // files — still just "the index was touched after the last commit", never
    // proof of actual uncommitted changes (that needs diffing the tree).
    const dirtyHint =
      headMtime > 0 &&
      indexMtime > 0 &&
      indexMtime - headMtime > DIRTY_THRESHOLD_MS &&
      (gitdirMtime < 0 || indexMtime - gitdirMtime > DIRTY_THRESHOLD_MS)

    if (minAgeDays > 0 && ageDays < minAgeDays) continue

    let bytes = 0
    let files = 0
    let partial = false
    let sharedBytes = 0

    if (wtPath && state !== "stale") {
      if (onProgress) onProgress(`${basename(mainRepo)}/${name}`)
      const walkBudget = exact ? Infinity : budget

      // node_modules cloned from the store on the same device costs far less
      // than its apparent size, so the report subtracts it. Measure it FIRST
      // and let the rest of the worktree share the inode set: the alternative
      // is walking the same subtree twice, which is the single most expensive
      // thing this pass does — node_modules is most of the file count.
      //
      // Half the budget each, deliberately. node_modules would otherwise eat
      // the whole allowance (it is 90% of the files) and leave nothing to
      // measure the build products with — which are the bytes that actually
      // cost something, and the only ones the "real" total is about.
      const nm = join(wtPath, "node_modules")
      if (sharedStore(nm)) {
        const half =
          walkBudget === Infinity ? Infinity : Math.ceil(walkBudget / 2)
        const sm = measure(nm, { seen, budget: half })
        sharedBytes = sm.bytes
        bytes = sm.bytes
        files = sm.files
        partial = sm.partial
      }

      // The rest of the checkout: build products and source that are NOT
      // shared and DO cost every byte. The node_modules subtree is already in
      // `seen` for its measured part, so this does not double-count it.
      const m = measure(wtPath, {
        seen,
        budget: walkBudget,
      })
      bytes += m.bytes
      files += m.files
      partial = partial || m.partial
    }

    const entry: WorktreeEntry = {
      path: wtPath ?? admin,
      name,
      mainRepo,
      tool: toolFor(wtPath ?? admin),
      state,
      branch,
      detached,
      lastActivityMs,
      dirtyHint,
      bytes,
      files,
      partial,
      sharedBytes,
      ageDays,
      hint: "",
    }
    entry.hint = hintFor(entry)

    const clusterKey = realOrRaw(mainRepo)
    if (!clusters.has(clusterKey)) {
      clusters.set(clusterKey, {
        mainRepo,
        adminDir: dirname(admin),
        worktrees: [],
        bytes: 0,
        realBytes: 0,
      })
    }
    const cluster = clusters.get(clusterKey)!
    cluster.worktrees.push(entry)
    cluster.bytes += bytes
    cluster.realBytes += bytes - sharedBytes
  }

  const out = [...clusters.values()]
  for (const c of out) {
    c.worktrees.sort((a, b) => {
      const d = b.bytes - b.sharedBytes - (a.bytes - a.sharedBytes)
      return d !== 0 ? d : b.ageDays - a.ageDays
    })
  }
  out.sort((a, b) => b.bytes - a.bytes)

  return {
    clusters: out,
    seeds,
    truncated,
    scannedAt: new Date().toISOString(),
  }
}
