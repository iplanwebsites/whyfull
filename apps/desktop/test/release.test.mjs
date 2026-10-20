import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { releaseInfo } from "../scripts/release-info.mjs"
import { artifactSpecs, createManifest } from "../scripts/release-manifest.mjs"

test("stable releases require notarization; previews need distinct prerelease versions", () => {
  assert.equal(releaseInfo({ version: "1.2.3" }).updater, true)
  assert.deepEqual(releaseInfo({ version: "1.2.4-preview.1" }), {
    version: "1.2.4-preview.1",
    tag: "v1.2.4-preview.1",
    channel: "preview",
    preview: true,
    macosSigning: "unsigned",
    updater: false,
  })
  assert.throws(
    () => releaseInfo({ version: "1.2.3", channel: "preview" }),
    /prerelease version/
  )
  assert.throws(
    () => releaseInfo({ version: "1.2.3", macosSigning: "unsigned" }),
    /notarized/
  )
  assert.throws(
    () => releaseInfo({ version: "1.2.4-preview.1", channel: "stable" }),
    /plain version/
  )
})

async function fixture(t, version) {
  const directory = await mkdtemp(join(tmpdir(), "whyfull-release-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  for (const [, name] of artifactSpecs)
    await writeFile(join(directory, name(version)), "release fixture")
  return directory
}

test("preview metadata requires all nine real artifacts and records their checksums", async (t) => {
  const version = "1.2.4-preview.1"
  const directory = await fixture(t, version)
  const manifest = await createManifest({ directory, version })
  assert.equal(manifest.macosSigning, "unsigned")
  assert.equal(manifest.updater, false)
  assert.equal(manifest.downloads.length, 9)
  assert.ok(
    manifest.downloads.every(
      (entry) =>
        entry.sha256 ===
        createHash("sha256").update("release fixture").digest("hex")
    )
  )
  await rm(join(directory, artifactSpecs[0][1](version)))
  await assert.rejects(
    () => createManifest({ directory, version }),
    /Missing release artifact/
  )
})

test("stable metadata requires complete signed update platforms and matching release assets", async (t) => {
  const version = "1.2.3"
  const directory = await fixture(t, version)
  const platforms = Object.fromEntries(
    ["darwin-aarch64", "darwin-x86_64", "windows-x86_64", "linux-x86_64"].map(
      (target) => [
        target,
        {
          signature: "fixture-signature",
          url: `https://github.com/iplanwebsites/whyfull/releases/download/v${version}/${target}.bin`,
        },
      ]
    )
  )
  for (const target of Object.keys(platforms))
    await writeFile(join(directory, `${target}.bin`), "update fixture")
  const update = { version, platforms }
  await writeFile(join(directory, "latest.json"), JSON.stringify(update))
  assert.equal((await createManifest({ directory, version })).updater, true)
  delete update.platforms["windows-x86_64"]
  await writeFile(join(directory, "latest.json"), JSON.stringify(update))
  await assert.rejects(
    () => createManifest({ directory, version }),
    /windows-x86_64/
  )
  update.version = "1.2.2"
  await writeFile(join(directory, "latest.json"), JSON.stringify(update))
  await assert.rejects(
    () => createManifest({ directory, version }),
    /version mismatch/
  )
})
