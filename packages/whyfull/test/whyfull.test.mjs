import { test } from "node:test"
import assert from "node:assert/strict"
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  symlinkSync,
  linkSync,
  rmSync,
} from "node:fs"
import { tmpdir, homedir } from "node:os"
import { join } from "node:path"

// tsdown bundles the package into a single entry point; the public API is
// re-exported from index.mjs, so tests import from there rather than per-module
// paths (which don't exist in the built output).
import {
  measure,
  human,
  volume,
  forPlatform,
  TARGETS,
  TIERS,
  scan,
  byTier,
  render,
  discoverCaches,
  measureSimulatorRuntimes,
  buildJsonReport,
  saveJsonReport,
  JSON_SCHEMA_VERSION,
} from "../dist/index.mjs"

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "whyfull-test-"))
  mkdirSync(join(root, "a"))
  mkdirSync(join(root, "a", "nested"))
  mkdirSync(join(root, "b"))
  // 64 KiB each so block-rounding does not dominate the assertion.
  writeFileSync(join(root, "a", "one.bin"), Buffer.alloc(65536, 1))
  writeFileSync(join(root, "a", "nested", "two.bin"), Buffer.alloc(65536, 2))
  writeFileSync(join(root, "b", "three.bin"), Buffer.alloc(65536, 3))
  return root
}

function withFixture(run) {
  const root = fixture()
  try {
    return run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("measure sums nested files", () => {
  withFixture((root) => {
    const { bytes, files } = measure(root)
    assert.equal(files, 3)
    assert.ok(bytes >= 3 * 65536, `expected >=196608, got ${bytes}`)
  })
})

test("measure supports an individual file target", () => {
  const root = mkdtempSync(join(tmpdir(), "whyfull-file-test-"))
  try {
    const file = join(root, "history.sqlite")
    writeFileSync(file, Buffer.alloc(65536, 1))
    const result = measure(file)
    assert.equal(result.files, 1)
    assert.ok(result.bytes > 0)
    assert.equal(result.partial, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("measure does not follow symlinks", () => {
  withFixture((root) => {
    const before = measure(root).bytes
    // A symlink pointing back at a sibling dir would double-count, or loop
    // forever if the walker followed it. This is the HF snapshots->blobs shape.
    symlinkSync(join(root, "a"), join(root, "b", "link-to-a"))
    const after = measure(root)
    assert.equal(after.bytes, before, "symlinked dir must not be recounted")
    assert.equal(after.files, 3)
  })
})

test("measure counts a hard-linked inode once", () => {
  withFixture((root) => {
    const before = measure(root).bytes
    // pnpm stores and HF blobs are mostly hard links; counting both names
    // inflates the total. Same inode, two paths, one contribution.
    linkSync(join(root, "a", "one.bin"), join(root, "b", "hardlink.bin"))
    const after = measure(root).bytes
    assert.equal(after, before, "hard link must not add bytes")
  })
})

test("measure reports maxDepth truncation without throwing", () => {
  withFixture((root) => {
    const shallow = measure(root, { maxDepth: 1 })
    const deep = measure(root)
    assert.ok(shallow.bytes < deep.bytes, "depth limit should reduce the total")
  })
})

test("measure flags partial when maxDepth cuts off a real subtree", () => {
  // The ~/.codex regression this guards: `depth: 2` under-reported an 85 GB
  // tree as 9.8 GB because `worktrees/<id>/<repo>/…` sits three levels down,
  // and the truncated walk was not flagged partial — it read as a complete,
  // confidently wrong number. A fixture nested deeper than maxDepth must come
  // back marked "≥", exactly like a budget cutoff does.
  const root = mkdtempSync(join(tmpdir(), "whyfull-depth-"))
  try {
    // depth 0 = root, 1 = "a", 2 = "a/deep" (visited at maxDepth: 2), 3 =
    // "a/deep/deeper" (never visited — beyond the limit).
    mkdirSync(join(root, "a", "deep", "deeper"), { recursive: true })
    writeFileSync(join(root, "a", "shallow.bin"), Buffer.alloc(65536, 1))
    writeFileSync(
      join(root, "a", "deep", "deeper", "hidden.bin"),
      Buffer.alloc(65536, 2)
    )

    const limited = measure(root, { maxDepth: 2 })
    assert.equal(
      limited.partial,
      true,
      "a depth-limited walk that skips a real subtree must be marked partial"
    )

    const full = measure(root)
    assert.equal(
      full.partial,
      false,
      "an unlimited walk of the same tree is not partial"
    )
    assert.ok(
      limited.bytes < full.bytes,
      "the skipped subtree's bytes must be missing from the depth-limited total"
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("measure flags a partial walk instead of guessing", () => {
  withFixture((root) => {
    const capped = measure(root, { budget: 1 })
    assert.equal(capped.partial, true)
    // The contract is "at least this much" — never an extrapolated total.
    assert.ok(capped.bytes <= measure(root).bytes)
  })
})

test("measure survives a missing path", () => {
  const r = measure(join(tmpdir(), "whyfull-does-not-exist-xyz"))
  assert.equal(r.bytes, 0)
  assert.equal(r.files, 0)
})

test("human formats binary units", () => {
  assert.equal(human(0), "0 B")
  assert.equal(human(1024), "1 KB")
  assert.equal(human(1536), "2 KB")
  assert.equal(human(1024 ** 3), "1.00 GB")
  assert.equal(human(null), "—")
})

test("volume returns plausible capacity", () => {
  const v = volume(process.cwd())
  assert.ok(v, "expected volume stats")
  assert.ok(v.total > 0)
  assert.ok(v.free >= 0)
  assert.ok(v.free <= v.total)
})

test("every target declares a known tier and a hint", () => {
  for (const t of TARGETS) {
    assert.ok(TIERS[t.tier], `${t.id} has unknown tier ${t.tier}`)
    assert.ok(t.hint && t.hint.length > 0, `${t.id} is missing a hint`)
    assert.ok(t.group, `${t.id} is missing a group`)
    assert.ok(
      t.paths.darwin && t.paths.linux && t.paths.win32,
      `${t.id} missing a platform key`
    )
    assert.ok(
      !t.hint.includes("rm -rf"),
      `${t.id} must not recommend an unrecoverable raw deletion`
    )
  }
})

test("target ids are unique", () => {
  const ids = TARGETS.map((t) => t.id)
  assert.equal(new Set(ids).size, ids.length)
})

test("forPlatform yields targets for all three platforms", () => {
  for (const p of ["darwin", "linux", "win32"]) {
    const list = forPlatform(p)
    assert.ok(list.length > 5, `${p} resolved only ${list.length} targets`)
    for (const t of list) assert.ok(t.candidates.some(Boolean))
  }
})

test("windows targets never hardcode unix system prefixes", () => {
  // homedir() is C:\Users\x on Windows, so a ${home}-derived path is fine and
  // only looks unix-y when this suite runs on macOS. What must never appear is
  // an absolute unix SYSTEM path, which cannot exist on Windows at all.
  const home = homedir()
  for (const t of forPlatform("win32")) {
    for (const p of t.candidates.filter(Boolean)) {
      if (p.startsWith(home)) continue
      assert.ok(
        !/^\/(var|usr|opt|etc|System|Library)\//.test(p),
        `${t.id} hardcodes a unix system path on win32: ${p}`
      )
    }
  }
})

test("macOS-only targets are absent on other platforms", () => {
  // Xcode and Photos have no Windows/Linux equivalent; listing them there
  // would print permanent "not found" noise.
  const winIds = new Set(forPlatform("win32").map((t) => t.id))
  for (const id of ["xcode-derived", "coresimulator", "photos", "mail"]) {
    assert.ok(!winIds.has(id), `${id} should not be offered on win32`)
  }
})

// The walking itself is covered by the measure() tests above. The report tests
// use synthesized data so the suite never scans the developer's real machine.
function fakeReport() {
  return {
    platform: "darwin",
    volume: { total: 1000e9, free: 50e9, used: 950e9 },
    denied: 1,
    partial: 1,
    exact: false,
    generatedAt: new Date().toISOString(),
    total: 180e9,
    targets: [
      {
        id: "huggingface",
        label: "HuggingFace hub cache",
        group: "AI models",
        tier: "JUDGEMENT",
        hint: "hf cache scan",
        present: true,
        bytes: 90e9,
        children: [{ name: "models--x--y", bytes: 30e9, atimeMs: 0 }],
      },
      {
        id: "npm",
        label: "npm cache",
        group: "Package managers",
        tier: "AUTO",
        hint: "npm cache clean --force",
        present: true,
        bytes: 8e9,
        partial: true,
        children: [],
      },
      {
        id: "pnpm-store",
        label: "pnpm store",
        group: "Package managers",
        tier: "AUTO",
        hint: "pnpm store prune",
        present: true,
        bytes: 22e9,
        children: [
          {
            name: "v11",
            bytes: 9e9,
            atimeMs: 0,
            sharedBytes: 4e9,
          },
        ],
        storeVersions: [
          {
            name: "v11",
            path: "/store/v11",
            version: 11,
            bytes: 9e9,
            files: 10,
            partial: false,
            mtimeMs: Date.now(),
            birthtimeMs: Date.now(),
            stale: false,
          },
          {
            name: "v3",
            path: "/store/v3",
            version: 3,
            bytes: 4e9,
            files: 10,
            partial: false,
            mtimeMs: 0,
            birthtimeMs: 0,
            stale: true,
          },
        ],
      },
      {
        id: "photos",
        label: "Photos library",
        group: "User data",
        tier: "DATA",
        hint: "not a cache",
        present: true,
        bytes: 60e9,
        children: [],
      },
      {
        id: "gone",
        label: "Absent thing",
        tier: "AUTO",
        present: false,
        bytes: null,
      },
    ],
  }
}

test("scan returns a renderable report", () => {
  // AIX has no built-in targets, which exercises report construction without
  // walking the machine running the test suite.
  const report = scan({ top: 0, platform: "aix" })
  assert.ok(Array.isArray(report.targets))
  assert.equal(report.targets.length, 0)
  assert.ok(report.total >= 0)
  assert.equal(typeof report.generatedAt, "string")
})

test("simulator storage counts backing assets, not expanded mounted volumes", () => {
  const root = mkdtempSync(join(tmpdir(), "whyfull-simulator-"))
  try {
    const core = join(root, "CoreSimulator")
    const assets = join(root, "MobileAssets")
    const asset = join(assets, "abc.asset")
    mkdirSync(join(asset, "AssetData"), { recursive: true })
    mkdirSync(join(core, "Caches", "dyld", "build"), { recursive: true })
    mkdirSync(join(core, "Volumes", "iOS_EXPANDED"), { recursive: true })
    writeFileSync(
      join(asset, "Info.plist"),
      "<plist><dict><key>Build</key><string>22A1</string><key>SimulatorVersion</key><string>18.0</string></dict></plist>"
    )
    writeFileSync(
      join(asset, "AssetData", "runtime.dmg"),
      Buffer.alloc(65536, 1)
    )
    writeFileSync(
      join(core, "Caches", "dyld", "build", "cache.bin"),
      Buffer.alloc(65536, 2)
    )
    // This represents the expanded read-only mount. It must not be counted in
    // addition to the host-side backing image.
    writeFileSync(
      join(core, "Volumes", "iOS_EXPANDED", "system.bin"),
      Buffer.alloc(2 * 1024 * 1024, 3)
    )

    const result = measureSimulatorRuntimes(core, assets)
    assert.ok(
      result.children.some((child) => /iOS 18\.0 · build 22A1/.test(child.name))
    )
    assert.ok(result.children.some((child) => child.name === "dyld caches"))
    assert.ok(result.measurement.bytes >= 2 * 65536)
    assert.ok(
      result.measurement.bytes < 1024 * 1024,
      "expanded mount bytes must not inflate the reclaimable total"
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("render includes the read-only guarantee and tier ordering", () => {
  const text = render(fakeReport(), { showAll: true })
  assert.match(text, /never deletes anything/)
  // AUTO (rank 1) must be presented before DATA (rank 5).
  assert.ok(
    text.indexOf("REGENERATES AUTOMATICALLY") < text.indexOf("REAL DATA"),
    "safest tier should come first"
  )
  assert.match(text, /Absent thing/, "--all should list missing targets")
})

test("render marks a partial measurement with >=", () => {
  const text = render(fakeReport())
  assert.match(
    text,
    /≥/,
    "partial targets must be flagged, never shown as exact"
  )
  assert.match(text, /--exact/, "should tell the user how to get real numbers")
})

test("render surfaces unreadable locations as an undercount", () => {
  const text = render(fakeReport())
  assert.match(text, /could not be read/)
  assert.match(text, /undercount/)
})

test("byTier orders groups by safety rank", () => {
  const tiers = byTier(fakeReport())
  const ranks = tiers.map((t) => t.rank)
  assert.deepEqual(
    ranks,
    [...ranks].sort((a, b) => a - b)
  )
  // Absent targets must not appear in any tier.
  assert.ok(!tiers.some((t) => t.items.some((i) => i.id === "gone")))
})

test("discoverCaches finds large children in explicit cache roots", () => {
  const root = mkdtempSync(join(tmpdir(), "whyfull-cache-test-"))
  try {
    mkdirSync(join(root, "new-tool-cache"))
    writeFileSync(
      join(root, "new-tool-cache", "artifact.bin"),
      Buffer.alloc(65536, 1)
    )
    const result = discoverCaches({
      roots: [{ path: root, label: "Test cache" }],
      threshold: 1,
      drill: 1,
    })
    assert.equal(result.dirs.length, 1)
    assert.equal(result.dirs[0].name, "new-tool-cache")
    assert.equal(result.dirs[0].root, "Test cache")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("discoverCaches finds a large file directly in a cache root", () => {
  const root = mkdtempSync(join(tmpdir(), "whyfull-cache-file-test-"))
  try {
    writeFileSync(join(root, "runaway.cache"), Buffer.alloc(65536, 1))
    const result = discoverCaches({
      roots: [{ path: root, label: "Test cache" }],
      threshold: 1,
      drill: 0,
    })
    assert.equal(result.dirs.length, 1)
    assert.equal(result.dirs[0].name, "runaway.cache")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("discoverCaches finds shallow project-local caches", () => {
  const root = mkdtempSync(join(tmpdir(), "whyfull-project-cache-test-"))
  try {
    const cache = join(root, "group", "app", ".cache", "release-checks")
    mkdirSync(cache, { recursive: true })
    writeFileSync(join(cache, "checkout.bin"), Buffer.alloc(65536, 1))
    const result = discoverCaches({
      roots: [],
      projectRoots: [{ path: root, label: "Project cache" }],
      threshold: 1,
      drill: 0,
    })
    assert.equal(result.dirs.length, 1)
    assert.equal(result.dirs[0].name, "release-checks")
    assert.equal(result.dirs[0].root, "Project cache (app)")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("render lists untracked cache hogs separately", () => {
  const cacheHogs = {
    threshold: 250e6,
    dirs: [
      {
        name: "new-tool-cache",
        path: "/Users/x/Library/Caches/new-tool-cache",
        bytes: 3e9,
        root: "Library cache",
        children: [],
      },
    ],
  }
  const text = render(fakeReport(), { cacheHogs })
  assert.match(text, /UNTRACKED CACHES/)
  assert.match(text, /new-tool-cache/)
})

test("cli emits no ansi codes when NO_COLOR is set", async () => {
  // useColor is decided at import time, so this must be asserted in a child.
  // Piping stdout already makes isTTY false; NO_COLOR must hold even so.
  const { execFileSync } = await import("node:child_process")
  const out = execFileSync(process.execPath, ["dist/cli.mjs", "--help"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, NO_COLOR: "1" },
    encoding: "utf8",
  })
  // eslint-disable-next-line no-control-regex
  assert.ok(
    !/\x1b\[/.test(out),
    "NO_COLOR output must contain no escape sequences"
  )
})

test("cli rejects invalid --top values and unknown flags", async () => {
  const { execFileSync } = await import("node:child_process")
  const cwd = new URL("..", import.meta.url).pathname
  for (const args of [
    ["--top", "abc"],
    ["--top", "12oops"],
    ["--top", "-1"],
    ["--top", "1.5"],
    ["--json-file"],
    ["--nope"],
  ]) {
    assert.throws(
      () =>
        execFileSync(process.execPath, ["dist/cli.mjs", ...args], {
          cwd,
          stdio: "pipe",
        }),
      `expected non-zero exit for ${args.join(" ")}`
    )
  }
})

function fakeWorktrees() {
  return {
    scannedAt: new Date().toISOString(),
    truncated: false,
    activityBasis:
      "Maximum mtime of the Git worktree admin HEAD and index files.",
    seeds: ["/Users/x/web"],
    clusters: [
      {
        mainRepo: "/Users/x/web/kick-mono",
        adminDir: "/Users/x/web/kick-mono/.git/worktrees",
        bytes: 22e9,
        realBytes: 8e9,
        worktrees: [
          {
            path: "/Users/x/web/kick-mono/.claude/worktrees/agent-a",
            name: "agent-a",
            mainRepo: "/Users/x/web/kick-mono",
            tool: "claude",
            state: "linked",
            branch: "worktree-agent-a",
            detached: false,
            lastActivityMs: Date.now() - 38 * 86400000,
            dirtyHint: false,
            bytes: 20e9,
            files: 1000,
            partial: true,
            sharedBytes: 14e9,
            ageDays: 38,
            hint: "Inspect first. Then: /usr/bin/trash '/Users/x/web/kick-mono/.claude/worktrees/agent-a' && git -C '/Users/x/web/kick-mono' worktree prune",
          },
          {
            path: "/Users/x/web/kick-mono/.git/worktrees/gone",
            name: "gone",
            mainRepo: "/Users/x/web/kick-mono",
            tool: "manual",
            state: "stale",
            branch: null,
            detached: true,
            lastActivityMs: -1,
            dirtyHint: false,
            bytes: 0,
            files: 0,
            partial: false,
            sharedBytes: 0,
            ageDays: -1,
            hint: "git -C /Users/x/web/kick-mono worktree prune",
          },
        ],
      },
    ],
  }
}

test("render shows pnpm store versions and names the dead one", () => {
  const text = render(fakeReport())
  assert.match(text, /v3/)
  assert.equal(text.match(/↳ v3\b/g)?.length, 1, "store versions print once")
  // The whole point of the routine: v3 is unreachable and prune will not go
  // near it, so the report must say so explicitly.
  assert.match(text, /stale — inspect and move to Trash: \/store\/v3/)
})

test("buildJsonReport emits a versioned renderer-independent data contract", () => {
  const cacheHogs = {
    threshold: 250e6,
    dirs: [
      {
        name: "new-tool-cache",
        path: "/Users/x/Library/Caches/new-tool-cache",
        bytes: 3e9,
        root: "Library cache",
        children: [],
      },
    ],
  }
  const source = fakeReport()
  const json = buildJsonReport({
    report: source,
    cacheHogs,
    worktrees: fakeWorktrees(),
    durationMs: 1234,
    options: {
      top: 5,
      showAll: false,
      exact: false,
      discover: false,
      cacheScan: true,
      worktrees: true,
      worktreeRoots: [],
      worktreeAge: 0,
    },
  })

  assert.equal(json.format, "whyfull-report")
  assert.equal(json.schemaVersion, JSON_SCHEMA_VERSION)
  assert.equal(json.durationMs, 1234)
  assert.match(json.completedAt, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal(json.options.cacheScan, true)
  assert.equal(json.summary.worktreeCount, 2)
  assert.deepEqual(json.summary.worktreeCountsByTool, {
    claude: 1,
    manual: 1,
  })
  assert.equal(json.summary.untrackedCacheBytesLowerBound, 3e9)
  assert.equal(json.summary.totalsMayOverlap, true)
  assert.match(json.worktrees.activityBasis, /HEAD and index/)
  assert.deepEqual(json.targets, source.targets)
})

test("saveJsonReport creates a private file and refuses to overwrite it", () => {
  const root = mkdtempSync(join(tmpdir(), "whyfull-json-save-"))
  try {
    const path = join(root, "report.json")
    const json = buildJsonReport({
      report: fakeReport(),
      durationMs: 1,
      options: {
        top: 5,
        showAll: false,
        exact: false,
        discover: false,
        cacheScan: false,
        worktrees: false,
        worktreeRoots: [],
        worktreeAge: 0,
      },
    })

    assert.equal(saveJsonReport(path, json), path)
    assert.equal(JSON.parse(readFileSync(path, "utf8")).schemaVersion, 1)
    assert.equal(statSync(path).mode & 0o777, 0o600)
    assert.throws(() => saveJsonReport(path, json), { code: "EEXIST" })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("render annotates pnpm-store-shared child bytes", () => {
  const report = fakeReport()
  report.targets.find((target) => target.id === "npm").children = [
    {
      name: "node_modules",
      path: "/project/node_modules",
      bytes: 4e9,
      atimeMs: Date.now(),
      sharedBytes: 3e9,
    },
  ]
  const text = render(report)
  assert.match(text, /shared with pnpm store/)
})

test("render lists worktrees per cluster with real vs apparent size", () => {
  const text = render(fakeReport(), { worktrees: fakeWorktrees() })
  assert.match(text, /GIT WORKTREES/)
  assert.match(text, /kick-mono/)
  assert.match(text, /2 worktrees \(1 claude, 1 manual\)/)
  assert.match(text, /≥20\.5 GB apparent/)
  assert.match(text, /≥7\.45 GB non-shared observed/)
  assert.match(text, /agent-a/)
  assert.match(text, /38d idle/)
  assert.match(text, /shared with pnpm store/)
  assert.match(text, /\/usr\/bin\/trash/)
  assert.doesNotMatch(text, /worktree remove/)
  assert.match(text, /worktree prune/)
})

test("render omits the worktree section unless asked", () => {
  assert.ok(!/GIT WORKTREES/.test(render(fakeReport())))
})

test("cli accepts the worktree flags and rejects a bad age", async () => {
  const { execFileSync } = await import("node:child_process")
  const cwd = new URL("..", import.meta.url).pathname
  const help = execFileSync(process.execPath, ["dist/cli.mjs", "--help"], {
    cwd,
    encoding: "utf8",
  })
  assert.match(help, /--worktrees/)
  assert.match(help, /--no-worktrees/)
  assert.match(help, /--no-cache-scan/)
  assert.match(help, /--worktree-root/)
  assert.match(help, /--worktree-age/)
  assert.match(help, /--json-file/)

  for (const args of [
    ["--worktree-age", "abc"],
    ["--worktree-age", "-3"],
  ]) {
    assert.throws(
      () =>
        execFileSync(process.execPath, ["dist/cli.mjs", ...args], {
          cwd,
          stdio: "pipe",
        }),
      `expected non-zero exit for ${args.join(" ")}`
    )
  }
})
