import { test } from "node:test"
import assert from "node:assert/strict"
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  linkSync,
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

test("measure sums nested files", () => {
  const root = fixture()
  const { bytes, files } = measure(root)
  assert.equal(files, 3)
  assert.ok(bytes >= 3 * 65536, `expected >=196608, got ${bytes}`)
})

test("measure does not follow symlinks", () => {
  const root = fixture()
  const before = measure(root).bytes
  // A symlink pointing back at a sibling dir would double-count, or loop
  // forever if the walker followed it. This is the HF snapshots->blobs shape.
  symlinkSync(join(root, "a"), join(root, "b", "link-to-a"))
  const after = measure(root)
  assert.equal(after.bytes, before, "symlinked dir must not be recounted")
  assert.equal(after.files, 3)
})

test("measure counts a hard-linked inode once", () => {
  const root = fixture()
  const before = measure(root).bytes
  // pnpm stores and HF blobs are mostly hard links; counting both names
  // inflates the total. Same inode, two paths, one contribution.
  linkSync(join(root, "a", "one.bin"), join(root, "b", "hardlink.bin"))
  const after = measure(root).bytes
  assert.equal(after, before, "hard link must not add bytes")
})

test("measure reports maxDepth truncation without throwing", () => {
  const root = fixture()
  const shallow = measure(root, { maxDepth: 1 })
  const deep = measure(root)
  assert.ok(shallow.bytes < deep.bytes, "depth limit should reduce the total")
})

test("measure flags a partial walk instead of guessing", () => {
  const root = fixture()
  const capped = measure(root, { budget: 1 })
  assert.equal(capped.partial, true)
  // The contract is "at least this much" — never an extrapolated total.
  assert.ok(capped.bytes <= measure(root).bytes)
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

// A real scan walks the whole machine and took ~55s per call, which made this
// suite unusable. Synthesize a report with the same shape instead; the walking
// itself is covered by the measure() tests above.
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
  const report = scan({ top: 0, platform: process.platform })
  assert.ok(Array.isArray(report.targets))
  assert.ok(report.total >= 0)
  assert.equal(typeof report.generatedAt, "string")
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

test("cli rejects a bad --top and unknown flags", async () => {
  const { execFileSync } = await import("node:child_process")
  const cwd = new URL("..", import.meta.url).pathname
  for (const args of [["--top", "abc"], ["--nope"]]) {
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
