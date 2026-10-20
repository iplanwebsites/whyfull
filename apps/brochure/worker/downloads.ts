const repository = "https://github.com/iplanwebsites/whyfull"
const api = "https://api.github.com/repos/iplanwebsites/whyfull/releases"
const ids = new Set([
  "desktop-macos-arm64",
  "desktop-macos-x64",
  "desktop-windows-x64",
  "desktop-linux-x64-appimage",
  "desktop-linux-x64-deb",
  "cli-macos-arm64",
  "cli-macos-x64",
  "cli-windows-x64",
  "cli-linux-x64",
])

interface Asset {
  name: string
  size: number
  browser_download_url: string
}
interface Release {
  tag_name: string
  draft: boolean
  prerelease: boolean
  published_at: string
  html_url: string
  assets: Asset[]
}
interface Manifest {
  schemaVersion: number
  version: string
  channel: "stable" | "preview"
  macosSigning: "notarized" | "unsigned"
  windowsSigning: "unsigned"
  updater: boolean
  downloads: { id: string; name: string; size: number; sha256: string }[]
}

function trustedAsset(asset: Asset, tag: string): boolean {
  return (
    !/[\/\\]/.test(asset.name) &&
    asset.browser_download_url ===
      `${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset.name)}`
  )
}

function publishedDesktopRelease(release: Release): boolean {
  return (
    !!release &&
    !release.draft &&
    !!release.published_at &&
    /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(release.tag_name) &&
    Array.isArray(release.assets) &&
    release.assets.some((asset) => asset.name === "downloads.json")
  )
}

export async function loadDownloads(fetcher: typeof fetch = fetch) {
  const options = {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "whyfull-downloads",
    },
    signal: AbortSignal.timeout(14000),
  }
  // Honor GitHub's stable/latest pointer even after many newer previews.
  const latestResponse = await fetcher(`${api}/latest`, options)
  let release: Release | undefined
  if (latestResponse.ok) {
    const latest = (await latestResponse.json()) as Release
    if (publishedDesktopRelease(latest) && !latest.prerelease) release = latest
  } else if (latestResponse.status !== 404) {
    throw new Error(`Release service returned ${latestResponse.status}`)
  }
  if (!release) {
    const response = await fetcher(`${api}?per_page=30`, options)
    if (!response.ok)
      throw new Error(`Release service returned ${response.status}`)
    const releases = (await response.json()) as Release[]
    if (!Array.isArray(releases)) throw new Error("Invalid releases response")
    const available = releases.filter(publishedDesktopRelease)
    release = available.find((entry) => !entry.prerelease)
    // With an incomplete history, don't replace an older stable download with
    // a preview. The page falls back to GitHub for manual selection instead.
    if (!release && releases.length >= 30)
      throw new Error("Stable download not found in recent release history")
    release ||= available.find((entry) => entry.prerelease)
  }
  if (!release) return { release: null }
  const metadata = release.assets.find(
    (asset) => asset.name === "downloads.json"
  )!
  if (!trustedAsset(metadata, release.tag_name) || metadata.size > 100_000)
    throw new Error("Invalid download metadata asset")
  const manifestResponse = await fetcher(metadata.browser_download_url, {
    headers: { "User-Agent": "whyfull-downloads" },
    signal: options.signal,
  })
  if (!manifestResponse.ok) throw new Error("Download metadata unavailable")
  const raw = await manifestResponse.text()
  if (raw.length > 100_000) throw new Error("Download metadata too large")
  const manifest = JSON.parse(raw) as Manifest
  const channel = release.prerelease ? "preview" : "stable"
  if (
    manifest.schemaVersion !== 1 ||
    `v${manifest.version}` !== release.tag_name ||
    manifest.channel !== channel ||
    typeof manifest.updater !== "boolean" ||
    !["notarized", "unsigned"].includes(manifest.macosSigning) ||
    manifest.windowsSigning !== "unsigned" ||
    (channel === "preview") !== manifest.version.includes("-") ||
    (channel === "stable" &&
      (manifest.macosSigning !== "notarized" || !manifest.updater)) ||
    (channel === "preview" && manifest.updater) ||
    !Array.isArray(manifest.downloads) ||
    manifest.downloads.length !== ids.size
  )
    throw new Error("Inconsistent release metadata")
  const seen = new Set<string>()
  const downloads = manifest.downloads.map((download) => {
    const asset = release.assets.find((entry) => entry.name === download.name)
    if (
      !ids.has(download.id) ||
      seen.has(download.id) ||
      !asset ||
      !trustedAsset(asset, release.tag_name) ||
      asset.size !== download.size ||
      !Number.isSafeInteger(download.size) ||
      download.size <= 0 ||
      !/^[a-f0-9]{64}$/.test(download.sha256)
    )
      throw new Error("Invalid download entry")
    seen.add(download.id)
    return { ...download, url: asset.browser_download_url }
  })
  const checksums = release.assets.find(
    (asset) => asset.name === "SHA256SUMS.txt"
  )
  if (!checksums || !trustedAsset(checksums, release.tag_name))
    throw new Error("Missing checksums")
  return {
    release: {
      version: manifest.version,
      channel,
      publishedAt: release.published_at,
      notesUrl: `${repository}/releases/tag/${encodeURIComponent(release.tag_name)}`,
      macosSigning: manifest.macosSigning,
      windowsSigning: manifest.windowsSigning,
      updater: manifest.updater,
      checksumsUrl: checksums.browser_download_url,
      downloads,
    },
  }
}
