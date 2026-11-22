import { test } from "node:test"
import assert from "node:assert/strict"
import { loadDownloads } from "../worker/downloads.ts"
import { artifactSpecs } from "../../desktop/scripts/release-manifest.mjs"
import { downloadsFor } from "../../desktop/scripts/release-platforms.mjs"
import { primaryDownload } from "../src/release.js"
import worker from "../worker/index.ts"
import { firstReleaseFiles } from "../worker/first-release.ts"

const repository = "https://github.com/iplanwebsites/whyfull"
function fixture({
  version = "1.2.3",
  preview = false,
  specs = artifactSpecs,
} = {}) {
  const downloads = specs.map(([id, name]) => ({
    id,
    name: name(version),
    size: 1024,
    sha256: "a".repeat(64),
  }))
  const tag = `v${version}`
  const assets = [
    ...downloads,
    { name: "downloads.json", size: 4000 },
    { name: "SHA256SUMS.txt", size: 2000 },
  ].map((entry) => ({
    name: entry.name,
    size: entry.size,
    browser_download_url: `${repository}/releases/download/${tag}/${entry.name}`,
  }))
  return {
    release: {
      tag_name: tag,
      draft: false,
      prerelease: preview,
      published_at: "2026-10-20T12:00:00Z",
      html_url: `${repository}/releases/tag/${tag}`,
      assets,
    },
    manifest: {
      schemaVersion: 1,
      version,
      channel: preview ? "preview" : "stable",
      macosSigning: preview ? "unsigned" : "notarized",
      windowsSigning: "unsigned",
      updater: !preview,
      downloads,
    },
  }
}
function upstream(fixtures) {
  return async (input) => {
    if (String(input).endsWith("/latest")) {
      const stable = fixtures.find(
        ({ release }) => !release.draft && !release.prerelease
      )
      return stable
        ? Response.json(stable.release)
        : new Response(null, { status: 404 })
    }
    if (String(input).startsWith("https://api.github.com/"))
      return Response.json(fixtures.map(({ release }) => release))
    const entry = fixtures.find(
      ({ release }) =>
        input ===
        release.assets.find((asset) => asset.name === "downloads.json")
          ?.browser_download_url
    )
    assert.ok(entry, `Unexpected upstream request: ${input}`)
    return Response.json(entry.manifest)
  }
}

test("prefers a stable release over a newer preview, ignoring drafts and npm-only releases", async () => {
  const stable = fixture()
  const preview = fixture({ version: "1.2.4-preview.1", preview: true })
  const draft = fixture({ version: "2.0.0" })
  draft.release.draft = true
  const npm = fixture({ version: "1.3.0" })
  npm.release.assets = []
  const data = await loadDownloads(upstream([draft, npm, preview, stable]))
  assert.equal(data.release.version, "1.2.3")
  assert.equal(data.release.channel, "stable")
  assert.equal(data.release.downloads.length, 9)
  assert.ok(
    data.release.downloads.every((entry) =>
      entry.url.startsWith(`${repository}/releases/download/v1.2.3/`)
    )
  )
})

test("only a published preview is explicitly offered before the first stable release", async () => {
  const preview = fixture({ version: "1.2.4-preview.1", preview: true })
  const data = await loadDownloads(upstream([preview]))
  assert.equal(data.release.channel, "preview")
  assert.equal(data.release.macosSigning, "unsigned")
  assert.equal(data.release.updater, false)
  preview.release.draft = true
  assert.deepEqual(await loadDownloads(upstream([preview])), { release: null })
})

test("refuses mismatched metadata, missing assets, and download URLs outside the repository", async () => {
  for (const mutate of [
    ({ manifest }) => {
      manifest.version = "9.9.9"
    },
    ({ manifest }) => {
      manifest.macosSigning = "unsigned"
    },
    ({ manifest }) => {
      manifest.downloads = []
    },
    ({ release }) => {
      // Listed in downloads.json but not attached to the release.
      release.assets.shift()
    },
    ({ manifest }) => {
      manifest.downloads[0].id = "desktop-linux-arm64"
    },
    ({ manifest }) => {
      manifest.downloads[0].sha256 = "invalid"
    },
    ({ release }) => {
      release.assets[0].browser_download_url = "https://example.com/app.dmg"
    },
    ({ manifest }) => {
      manifest.downloads[0].size = 3
    },
    ({ manifest }) => {
      manifest.downloads[0].id = manifest.downloads[1].id
    },
  ]) {
    const data = fixture()
    mutate(data)
    await assert.rejects(() => loadDownloads(upstream([data])))
  }
})

test("release API failures propagate so the page can fall back to GitHub", async () => {
  await assert.rejects(
    () => loadDownloads(async () => new Response(null, { status: 403 })),
    /403/
  )
})

test("GitHub latest keeps stable available even after a long sequence of previews", async () => {
  const previews = Array.from({ length: 30 }, (_, index) =>
    fixture({ version: `1.2.4-preview.${index + 1}`, preview: true })
  )
  const stable = fixture()
  const data = await loadDownloads(upstream([...previews, stable]))
  assert.equal(data.release.channel, "stable")
  assert.equal(data.release.version, "1.2.3")
  await assert.rejects(
    () => loadDownloads(upstream(previews)),
    /recent release history/
  )
})

const macs = ["macos-arm64", "macos-x64"]

test("a Mac-first stable release lists only its own platforms", async () => {
  const data = await loadDownloads(
    upstream([fixture({ specs: downloadsFor(macs) })])
  )
  assert.equal(data.release.channel, "stable")
  assert.deepEqual(data.release.downloads.map(({ id }) => id).sort(), [
    "cli-macos-arm64",
    "cli-macos-x64",
    "desktop-macos-arm64",
    "desktop-macos-x64",
  ])
  // The page's primary button only offers files the release has.
  assert.equal(
    primaryDownload(data.release, { os: "macos", arch: "x64" }).label,
    "Download for Mac (Intel)"
  )
  assert.equal(primaryDownload(data.release, { os: "windows" }), null)
  assert.equal(primaryDownload(data.release, { os: "linux" }), null)
})

async function apiDownloads(fixtures) {
  const realFetch = globalThis.fetch
  const realCaches = globalThis.caches
  globalThis.fetch = upstream(fixtures)
  globalThis.caches = {
    open: async () => ({ match: async () => undefined, put: async () => {} }),
  }
  try {
    const sizes = new Map(
      firstReleaseFiles.map(({ name, size }) => [`v0.0.1/${name}`, size])
    )
    const response = await worker.fetch(
      new Request("https://whyfull.app/api/downloads"),
      {
        ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
        DOWNLOADS: {
          head: async (key) =>
            key.endsWith("SHA256SUMS.txt")
              ? { size: 100 }
              : sizes.has(key)
                ? { size: sizes.get(key) }
                : null,
          get: async () => null,
        },
      },
      { waitUntil() {} }
    )
    return (await response.json()).release
  } finally {
    globalThis.fetch = realFetch
    globalThis.caches = realCaches
  }
}

test("the R2 0.0.1 listing is used only until a GitHub release exists", async () => {
  const fallback = await apiDownloads([])
  assert.equal(fallback.version, "0.0.1")
  assert.equal(fallback.limited, true)
  const release = await apiDownloads([fixture({ specs: downloadsFor(macs) })])
  assert.equal(release.version, "1.2.3")
  assert.equal(release.limited, undefined)
  assert.ok(release.downloads.every(({ url }) => url.startsWith(repository)))
})
