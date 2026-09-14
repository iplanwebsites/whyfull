import { test } from "node:test"
import assert from "node:assert/strict"
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  utimesSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  findWorktrees,
  storeVersions,
  readModulesStoreDir,
  sharedStore,
} from "../dist/index.mjs"

const DAY = 86400

/**
 * A git worktree cluster built from plain files. No `git` binary is involved:
 * everything whyfull reads is a flat file, so the fixture is exactly the bytes
 * git would have written, and the suite stays hermetic and fast.
 */
function worktreeFixture() {
  // Keep a space in the path so every suggested command has to quote safely.
  const root = mkdtempSync(join(tmpdir(), "whyfull wt-"))
  const main = join(root, "main")
  const admin = join(main, ".git", "worktrees")
  mkdirSync(admin, { recursive: true })
  writeFileSync(join(main, ".git", "HEAD"), "ref: refs/heads/main\n")

  const now = Date.now() / 1000

  // Registers an admin dir and (unless `skipDir`) the worktree it points at.
  const register = (name, opts = {}) => {
    const {
      wtDir = join(root, "wt", name),
      branch = `worktree-${name}`,
      detached = false,
      locked = false,
      skipDir = false,
      skipAdmin = false,
      gitFileTarget = null,
      indexNewer = false,
      ageDays = 1,
    } = opts

    const a = join(admin, name)
    if (!skipAdmin) {
      mkdirSync(a, { recursive: true })
      writeFileSync(join(a, "gitdir"), `${join(wtDir, ".git")}\n`)
      writeFileSync(
        join(a, "HEAD"),
        detached
          ? "0123456789abcdef0123456789abcdef01234567\n"
          : `ref: refs/heads/${branch}\n`
      )
      writeFileSync(join(a, "index"), Buffer.alloc(512))
      if (locked) writeFileSync(join(a, "locked"), "session live\n")

      const headT = now - ageDays * DAY
      utimesSync(join(a, "HEAD"), headT, headT)
      // A real checkout writes HEAD, index and gitdir within the same second;
      // `indexNewer` simulates the rarer case where the index is genuinely
      // touched much later (well past the 60s threshold), not that ordinary
      // write-ordering jitter.
      utimesSync(
        join(a, "index"),
        headT + (indexNewer ? 300 : -60),
        headT + (indexNewer ? 300 : -60)
      )
      utimesSync(join(a, "gitdir"), headT, headT)
    }

    if (!skipDir) {
      mkdirSync(join(wtDir, "src"), { recursive: true })
      writeFileSync(join(wtDir, "src", "big.bin"), Buffer.alloc(65536, 7))
      writeFileSync(join(wtDir, ".git"), `gitdir: ${gitFileTarget ?? a}\n`)
    }
    return wtDir
  }

  register("normal")
  register("locked-one", { locked: true })
  register("detached-one", { detached: true, branch: null })
  register("dirty-one", { indexNewer: true, ageDays: 40 })
  // stale: registered, but the checkout is gone.
  register("stale-one", { skipDir: true })
  // orphan: the directory's .git file names an admin dir that does not exist
  // (the "copied repo" case — git commands inside it operate on nothing).
  register("orphan-one", {
    gitFileTarget: join(root, "elsewhere", ".git", "worktrees", "orphan-one"),
  })

  // A submodule, not a worktree: its .git file says `.git/modules/`. Must be
  // ignored entirely or every submodule on the machine reads as a worktree.
  const sub = join(root, "submodule")
  mkdirSync(join(sub, "src"), { recursive: true })
  writeFileSync(
    join(sub, ".git"),
    `gitdir: ${join(main, ".git", "modules", "submodule")}\n`
  )

  // One worktree whose node_modules names a storeDir inside the fixture, on
  // the same device: the APFS-clone case, where apparent size is not real cost.
  const shared = register("shared-one")
  const store = join(root, "store", "v11")
  mkdirSync(store, { recursive: true })
  writeFileSync(join(store, "blob.bin"), Buffer.alloc(65536, 9))
  const nm = join(shared, "node_modules")
  mkdirSync(join(nm, "pkg"), { recursive: true })
  writeFileSync(join(nm, "pkg", "index.js"), Buffer.alloc(65536, 3))
  writeFileSync(
    join(nm, ".modules.yaml"),
    `hoistPattern:\n  - '*'\nstoreDir: ${store}\nvirtualStoreDir: .pnpm\n`
  )

  return { root, main, store }
}

function withWorktrees(run) {
  const fx = worktreeFixture()
  try {
    return run(fx)
  } finally {
    rmSync(fx.root, { recursive: true, force: true })
  }
}

/** `findWorktrees` against the fixture only — never the developer's home dir. */
function scanFixture(fx, extra = {}) {
  return findWorktrees({
    roots: [fx.root],
    includeDefaults: false,
    ...extra,
  })
}

function flat(result) {
  return result.clusters.flatMap((c) => c.worktrees)
}
function byName(result, name) {
  return flat(result).find((w) => w.name === name)
}

test("findWorktrees discovers a whole cluster from one seed", () => {
  withWorktrees((fx) => {
    const r = scanFixture(fx)
    assert.equal(r.clusters.length, 1, "all worktrees belong to one main repo")
    assert.equal(r.clusters[0].mainRepo, fx.main)
    // 7 registrations: normal, locked, detached, dirty, stale, orphan, shared.
    assert.equal(flat(r).length, 7)
    assert.equal(r.truncated, false)
    assert.ok(r.seeds.includes(fx.root))
    assert.equal(typeof r.scannedAt, "string")
  })
})

test("a .git-only backup's stale registry must not condemn live worktrees", () => {
  // The real-machine case this guards: `kick-mono-gitonly-11aug2026` is a
  // backup of `kick-mono`'s .git, so it carries a full copy of the worktree
  // registry and claims all 33 of the ORIGINAL repo's live checkouts. Reporting
  // those as orphans could produce unsafe direct-delete advice for healthy
  // worktrees — the worst possible false positive for a safety-first tool.
  const root = mkdtempSync(join(tmpdir(), "whyfull-backup-"))
  try {
    const live = join(root, "repo")
    const liveAdmin = join(live, ".git", "worktrees", "wt1")
    mkdirSync(liveAdmin, { recursive: true })
    const wt = join(root, "wt1")
    mkdirSync(wt, { recursive: true })
    writeFileSync(join(wt, ".git"), `gitdir: ${liveAdmin}\n`)
    for (const [a, target] of [[liveAdmin, join(wt, ".git")]]) {
      writeFileSync(join(a, "gitdir"), `${target}\n`)
      writeFileSync(join(a, "HEAD"), "ref: refs/heads/wt1\n")
      writeFileSync(join(a, "index"), Buffer.alloc(16))
    }

    // The backup: same registry, pointing at the live checkout it does not own.
    const backup = join(root, "repo-gitonly-backup")
    const backupAdmin = join(backup, ".git", "worktrees", "wt1")
    mkdirSync(backupAdmin, { recursive: true })
    writeFileSync(join(backupAdmin, "gitdir"), `${join(wt, ".git")}\n`)
    writeFileSync(join(backupAdmin, "HEAD"), "ref: refs/heads/wt1\n")
    writeFileSync(join(backupAdmin, "index"), Buffer.alloc(16))

    const r = findWorktrees({ roots: [root], includeDefaults: false })
    const all = flat(r)
    assert.equal(all.length, 1, "the checkout is reported once, by its owner")
    assert.equal(all[0].state, "linked")
    assert.equal(all[0].mainRepo, live)
    assert.ok(!all.some((w) => /rm -rf/.test(w.hint)))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("findWorktrees ignores a submodule .git file", () => {
  withWorktrees((fx) => {
    const r = scanFixture(fx)
    // `.git/modules/` is a submodule, not a worktree. If this leaks in, every
    // submodule on the machine gets suggested for deletion.
    assert.ok(!flat(r).some((w) => w.name === "submodule"))
    assert.ok(!flat(r).some((w) => w.path.includes("/submodule")))
  })
})

test("findWorktrees classifies each state", () => {
  withWorktrees((fx) => {
    const r = scanFixture(fx)
    assert.equal(byName(r, "normal").state, "linked")
    assert.equal(byName(r, "locked-one").state, "locked")
    assert.equal(byName(r, "stale-one").state, "stale")
    assert.equal(byName(r, "orphan-one").state, "orphan")
  })
})

test("findWorktrees reads branch, detached and dirty hints from the admin dir", () => {
  withWorktrees((fx) => {
    const r = scanFixture(fx)
    assert.equal(byName(r, "normal").branch, "worktree-normal")
    assert.equal(byName(r, "normal").detached, false)

    const det = byName(r, "detached-one")
    assert.equal(det.detached, true)
    assert.equal(det.branch, null)

    // index meaningfully newer (>60s) than both HEAD and gitdir == staged or
    // checked out well after the last commit. A weak hint, not proof.
    assert.equal(byName(r, "dirty-one").dirtyHint, true)
    // "normal" and every ordinary checkout write HEAD/index/gitdir within the
    // same second; that must never read as dirty, or the hint is pure noise.
    assert.equal(byName(r, "normal").dirtyHint, false)
  })
})

test("findWorktrees does not flag ordinary checkout write-ordering as dirty", () => {
  // The real-machine bug this guards: a checkout always writes the index
  // after HEAD, so `index mtime > HEAD mtime` alone is true almost universally
  // and was reporting nearly every worktree as "maybe dirty". Only a gap wider
  // than the same-operation write window (60s) against BOTH HEAD and gitdir
  // should count.
  const root = mkdtempSync(join(tmpdir(), "whyfull-jitter-"))
  try {
    const main = join(root, "repo")
    const admin = join(main, ".git", "worktrees", "wt1")
    mkdirSync(admin, { recursive: true })
    const wt = join(root, "wt1")
    mkdirSync(wt, { recursive: true })
    writeFileSync(join(wt, ".git"), `gitdir: ${admin}\n`)

    const now = Date.now() / 1000
    writeFileSync(join(admin, "gitdir"), `${join(wt, ".git")}\n`)
    writeFileSync(join(admin, "HEAD"), "ref: refs/heads/wt1\n")
    writeFileSync(join(admin, "index"), Buffer.alloc(16))
    // HEAD, index and gitdir all written within the same second, index last —
    // exactly what a real `git checkout` produces.
    utimesSync(join(admin, "HEAD"), now, now)
    utimesSync(join(admin, "gitdir"), now, now)
    utimesSync(join(admin, "index"), now + 1, now + 1)

    const r = findWorktrees({ roots: [root], includeDefaults: false })
    assert.equal(flat(r)[0].dirtyHint, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("findWorktrees ages from the admin HEAD, not the directory mtime", () => {
  withWorktrees((fx) => {
    const r = scanFixture(fx)
    // The worktree root was written seconds ago; only the admin HEAD carries
    // the honest last-activity date, which is the whole point of 2.2.
    assert.ok(byName(r, "dirty-one").ageDays >= 39)
    assert.ok(byName(r, "normal").ageDays <= 2)
    assert.match(byName(r, "normal").lastActivityAt, /^\d{4}-\d{2}-\d{2}T/)
    assert.equal(byName(r, "normal").lastActivitySource, "head")
    assert.match(r.activityBasis, /Git worktree admin HEAD and index/)
  })
})

test("findWorktrees sizes worktrees and skips stale ones", () => {
  withWorktrees((fx) => {
    const r = scanFixture(fx)
    assert.ok(byName(r, "normal").bytes >= 65536)
    // A stale registration has no directory, so it costs nothing to keep.
    assert.equal(byName(r, "stale-one").bytes, 0)
  })
})

test("findWorktrees reports pnpm-store-shared node_modules separately", () => {
  withWorktrees((fx) => {
    const w = byName(scanFixture(fx), "shared-one")
    assert.ok(w.sharedBytes > 0, "node_modules cloned from the store is shared")
    assert.ok(w.sharedBytes <= w.bytes, "shared can never exceed apparent")
  })
})

test("findWorktrees suggests the right command per state", () => {
  withWorktrees((fx) => {
    const r = scanFixture(fx)
    const normal = byName(r, "normal")
    assert.match(normal.hint, /move the checkout to Trash/i)
    assert.equal(normal.recommendation.action, "trash-worktree")
    assert.equal(normal.recommendation.requiresReview, true)
    assert.equal(normal.recommendation.gitGuarded, false)
    assert.ok(!normal.hint.includes("worktree remove"))
    if (process.platform === "darwin") {
      assert.match(normal.recommendation.command, /\/usr\/bin\/trash/)
      assert.match(normal.recommendation.command, /'\/.*whyfull wt-/)
      assert.match(normal.recommendation.command, /worktree prune/)
    } else {
      assert.equal(normal.recommendation.command, null)
    }

    const locked = byName(r, "locked-one")
    assert.match(locked.hint, /session may be live/i)
    assert.equal(locked.recommendation.action, "review-locked")
    assert.equal(locked.recommendation.command, null)
    assert.equal(locked.recommendation.requiresReview, true)

    const orphan = byName(r, "orphan-one")
    assert.match(orphan.hint, /Trash\/Recycle Bin/i)
    assert.equal(orphan.recommendation.action, "trash-orphan")
    if (process.platform === "darwin") {
      assert.match(orphan.recommendation.command, /\/usr\/bin\/trash/)
    } else {
      assert.equal(orphan.recommendation.command, null)
    }
    assert.ok(!orphan.hint.includes("rm -rf"))

    const stale = byName(r, "stale-one")
    assert.match(stale.hint, /worktree prune/)
    assert.equal(stale.recommendation.action, "prune-registration")
  })
})

test("findWorktrees never suggests --force, even for a dirty worktree", () => {
  // Worktree cleanup is recoverable and preserves branches. `--force` would be
  // an especially dangerous regression, so it can never appear in prose or in
  // the structured recommendation.
  withWorktrees((fx) => {
    const r = scanFixture(fx)
    for (const w of flat(r)) {
      assert.ok(
        !w.hint.includes("--force"),
        `hint for ${w.name} must never include --force: ${w.hint}`
      )
      assert.ok(
        !w.recommendation.command?.includes("--force"),
        `structured recommendation for ${w.name} must never include --force`
      )
    }
  })
})

test("findWorktrees filters by minimum idle age", () => {
  withWorktrees((fx) => {
    const r = scanFixture(fx, { minAgeDays: 30 })
    const names = flat(r).map((w) => w.name)
    assert.deepEqual(names, ["dirty-one"])
  })
})

test("findWorktrees ranks by real bytes and caps the total", () => {
  withWorktrees((fx) => {
    const r = scanFixture(fx)
    const wts = r.clusters[0].worktrees
    for (let i = 1; i < wts.length; i += 1) {
      const prev = wts[i - 1].bytes - wts[i - 1].sharedBytes
      const cur = wts[i].bytes - wts[i].sharedBytes
      assert.ok(prev >= cur, "sorted by bytes minus shared, descending")
    }
    assert.equal(
      r.clusters[0].realBytes,
      r.clusters[0].bytes - wts.reduce((sum, w) => sum + w.sharedBytes, 0)
    )

    const capped = scanFixture(fx, { maxWorktrees: 2 })
    assert.equal(capped.truncated, true)
    assert.ok(flat(capped).length <= 2)
  })
})

test("findWorktrees guesses the tool from the path", () => {
  const root = mkdtempSync(join(tmpdir(), "whyfull-tool-"))
  try {
    const main = join(root, "repo")
    const admin = join(main, ".git", "worktrees", "t1")
    mkdirSync(admin, { recursive: true })
    const wt = join(main, ".claude", "worktrees", "t1")
    mkdirSync(wt, { recursive: true })
    writeFileSync(join(wt, ".git"), `gitdir: ${admin}\n`)
    writeFileSync(join(admin, "gitdir"), `${join(wt, ".git")}\n`)
    writeFileSync(join(admin, "HEAD"), "ref: refs/heads/x\n")
    writeFileSync(join(admin, "index"), Buffer.alloc(16))

    const r = findWorktrees({ roots: [root], includeDefaults: false })
    assert.equal(flat(r)[0].tool, "claude")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("findWorktrees annotates shared bytes for a pnpm-12 JSON .modules.yaml", () => {
  // End-to-end regression for the hybrid-audio-engine case: a worktree whose
  // node_modules/.modules.yaml is pnpm 12's JSON format must still be
  // recognised as store-shared, the same as the bare-YAML (pnpm <=11) shape.
  const root = mkdtempSync(join(tmpdir(), "whyfull-json-shared-"))
  try {
    const main = join(root, "repo")
    const admin = join(main, ".git", "worktrees", "wt1")
    mkdirSync(admin, { recursive: true })
    const wt = join(root, "wt1")
    mkdirSync(wt, { recursive: true })
    writeFileSync(join(wt, ".git"), `gitdir: ${admin}\n`)
    writeFileSync(join(admin, "gitdir"), `${join(wt, ".git")}\n`)
    writeFileSync(join(admin, "HEAD"), "ref: refs/heads/wt1\n")
    writeFileSync(join(admin, "index"), Buffer.alloc(16))

    const store = join(root, "store", "v11")
    mkdirSync(store, { recursive: true })
    writeFileSync(join(store, "blob.bin"), Buffer.alloc(65536, 9))

    const nm = join(wt, "node_modules")
    mkdirSync(join(nm, "pkg"), { recursive: true })
    writeFileSync(join(nm, "pkg", "index.js"), Buffer.alloc(65536, 3))
    writeFileSync(
      join(nm, ".modules.yaml"),
      `{\n  "hoistedDependencies": {},\n  "storeDir": "${store}",\n  "virtualStoreDir": ".pnpm"\n}\n`
    )

    const r = findWorktrees({ roots: [root], includeDefaults: false })
    const w = flat(r)[0]
    assert.ok(
      w.sharedBytes > 0,
      "pnpm-12 JSON .modules.yaml must still be recognised as store-shared"
    )
    assert.ok(w.sharedBytes <= w.bytes)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("findWorktrees never throws on a missing or unreadable root", () => {
  const r = findWorktrees({
    roots: [join(tmpdir(), "whyfull-no-such-root-xyz")],
    includeDefaults: false,
  })
  assert.deepEqual(r.clusters, [])
  assert.equal(r.truncated, false)
})

// ----------------------------------------------------------------- pnpm ----

test("readModulesStoreDir pulls storeDir out without a YAML parser", () => {
  const root = mkdtempSync(join(tmpdir(), "whyfull-yaml-"))
  try {
    const f = join(root, ".modules.yaml")
    writeFileSync(
      f,
      "hoistPattern:\n  - '*'\nstoreDir: /Users/x/Library/pnpm/store/v3\nvirtualStoreDir: .pnpm\n"
    )
    assert.equal(readModulesStoreDir(f), "/Users/x/Library/pnpm/store/v3")

    writeFileSync(f, "storeDir: '/quoted/path/v11'\n")
    assert.equal(readModulesStoreDir(f), "/quoted/path/v11")

    writeFileSync(f, "hoistPattern:\n  - '*'\n")
    assert.equal(readModulesStoreDir(f), null)
    assert.equal(readModulesStoreDir(join(root, "nope.yaml")), null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("readModulesStoreDir also reads pnpm 12's JSON-formatted .modules.yaml", () => {
  // Root cause of the missing "(N GB shared with pnpm store)" annotation on
  // hybrid-audio-engine worktrees: pnpm 12 writes `.modules.yaml` as indented
  // JSON — quoted key, `": "` separator, trailing comma — not the bare YAML
  // `storeDir: /path` that pnpm 9 (kick-mono) writes. The old regex anchored
  // on column-0 `storeDir:` and never matched.
  const root = mkdtempSync(join(tmpdir(), "whyfull-json-yaml-"))
  try {
    const f = join(root, ".modules.yaml")
    writeFileSync(
      f,
      '{\n  "hoistedDependencies": {\n    "x@1.0.0": { "x": "private" }\n  },\n  "storeDir": "/Users/felix/Library/pnpm/store/v11",\n  "virtualStoreDir": ".pnpm"\n}\n'
    )
    assert.equal(readModulesStoreDir(f), "/Users/felix/Library/pnpm/store/v11")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("sharedStore fires only for a store on the same device", () => {
  withWorktrees((fx) => {
    const nm = join(fx.root, "wt", "shared-one", "node_modules")
    const info = sharedStore(nm)
    assert.ok(info, "same-device storeDir should be recognised")
    assert.equal(info.storeDir, fx.store)
    assert.equal(info.sameDevice, true)

    // A worktree with no .modules.yaml has no shared bytes.
    assert.equal(
      sharedStore(join(fx.root, "wt", "normal", "node_modules")),
      null
    )
  })
})

test("sharedStore ignores a storeDir that no longer exists", () => {
  const root = mkdtempSync(join(tmpdir(), "whyfull-gone-"))
  try {
    const nm = join(root, "node_modules")
    mkdirSync(nm, { recursive: true })
    // Broken links mean the bytes are real copies, not shared extents.
    writeFileSync(
      join(nm, ".modules.yaml"),
      `storeDir: ${join(root, "gone")}\n`
    )
    assert.equal(sharedStore(nm), null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("storeVersions lists v* folders newest first and flags dead ones", () => {
  const root = mkdtempSync(join(tmpdir(), "whyfull-store-"))
  try {
    for (const v of ["v3", "v11"]) {
      // Two nested dirs so a budget can actually stop the walk partway: the
      // budget is checked between directories, not between files.
      mkdirSync(join(root, v, "files", "aa"), { recursive: true })
      mkdirSync(join(root, v, "files", "bb"), { recursive: true })
      writeFileSync(
        join(root, v, "files", "aa", "blob.bin"),
        Buffer.alloc(65536, 1)
      )
      writeFileSync(
        join(root, v, "files", "bb", "blob.bin"),
        Buffer.alloc(65536, 2)
      )
    }
    // Anything that isn't a version folder must be ignored.
    mkdirSync(join(root, "tmp"))

    // v3 untouched since 2024: no pnpm in use can read it, and
    // `pnpm store prune` will never remove it.
    const old = new Date("2024-06-15T00:00:00Z").getTime() / 1000
    utimesSync(join(root, "v3"), old, old)

    const versions = storeVersions(root)
    assert.deepEqual(
      versions.map((v) => v.name),
      ["v11", "v3"],
      "sorted by version number, not lexically (v11 > v3)"
    )
    assert.equal(versions[0].stale, false, "the newest version is never stale")
    assert.equal(versions[1].stale, true)
    assert.ok(versions[1].bytes >= 131072)
    assert.equal(versions[1].version, 3)
    assert.ok(versions[1].files >= 1)
    assert.equal(versions[1].partial, false)
    assert.ok(versions[1].mtimeMs > 0 && versions[1].birthtimeMs > 0)

    // A budget of 1 must report a partial measurement, never a guess.
    assert.ok(storeVersions(root, { budget: 1 }).every((v) => v.partial))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("storeVersions survives a store that is not there", () => {
  assert.deepEqual(storeVersions(join(tmpdir(), "whyfull-no-store-xyz")), [])
})
