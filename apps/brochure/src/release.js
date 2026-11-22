// Shared by the home and download pages: visitor platform and release data.
export const releasesUrl = "https://github.com/iplanwebsites/whyfull/releases"

const desktopIds = {
  macos: { arm64: "desktop-macos-arm64", x64: "desktop-macos-x64" },
  windows: { x64: "desktop-windows-x64" },
  linux: { x64: "desktop-linux-x64-appimage" },
}
const archLabels = { arm64: "Apple Silicon", x64: "Intel" }

/** Best-effort OS/chip detection. Unknown values stay null; never guess. */
export async function detectPlatform() {
  const agent = navigator.userAgent
  const hint = navigator.userAgentData?.platform || navigator.platform || ""
  const touchMac = /mac/i.test(hint) && navigator.maxTouchPoints > 1
  const mobile =
    navigator.userAgentData?.mobile === true ||
    /android|iphone|ipad|ipod/i.test(agent) ||
    touchMac
  const os = mobile
    ? null
    : /mac/i.test(hint)
      ? "macos"
      : /win/i.test(hint)
        ? "windows"
        : /linux/i.test(hint)
          ? "linux"
          : null
  let arch = null
  try {
    // Chromium only. Safari and Firefox don't expose a Mac's chip.
    const { architecture } =
      (await navigator.userAgentData?.getHighEntropyValues?.([
        "architecture",
      ])) || {}
    if (architecture === "arm") arch = "arm64"
    if (architecture === "x86") arch = "x64"
  } catch {}
  return { os, arch, mobile }
}

let releaseRequest
/** The validated /api/downloads payload; rejects when it can't be checked. */
export function loadRelease() {
  releaseRequest ||= fetch("/api/downloads", {
    signal: AbortSignal.timeout(18000),
  }).then(async (response) => {
    if (!response.ok) throw new Error("Release lookup failed")
    return (await response.json()).release
  })
  return releaseRequest
}

export function formatSize(bytes) {
  const megabytes = bytes / 1024 ** 2
  return `${megabytes >= 10 ? Math.round(megabytes) : megabytes.toFixed(1)} MB`
}

/**
 * The desktop download that best matches the visitor, or null. On a Mac with
 * an unknown chip, prefer Apple Silicon; the page keeps the other choice.
 */
export function primaryDownload(release, { os, arch }) {
  if (!release || !os) return null
  const ids = desktopIds[os]
  const order =
    os === "macos"
      ? arch === "x64"
        ? ["x64"]
        : arch === "arm64"
          ? ["arm64"]
          : ["arm64", "x64"]
      : ["x64"]
  for (const key of order) {
    const download = release.downloads.find((entry) => entry.id === ids[key])
    if (!download) continue
    const name =
      os === "macos"
        ? `Mac (${archLabels[key]})`
        : os === "windows"
          ? "Windows"
          : "Linux"
    return {
      download,
      label: `Download for ${name}`,
      size: formatSize(download.size),
      chip: os === "macos" ? archLabels[key] : null,
    }
  }
  return null
}
