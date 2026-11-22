// Shared by /thanks/, /activate/ and /recover/. Keys are rendered with
// textContent only and never leave the browser from these helpers.
import {
  detectPlatform,
  formatSize,
  loadRelease,
  primaryDownload,
} from "./release.js"

export const $ = (id) => document.getElementById(id)
export const KEY_PATTERN =
  /WHYFULL-[A-Za-z0-9_-]{8,2048}\.[A-Za-z0-9_-]{40,200}/
export const site = "https://whyfull.app"

/** The first license key inside any pasted text, or null. */
export function extractKey(text) {
  return KEY_PATTERN.exec(String(text || "").replace(/\s+/g, ""))?.[0] ?? null
}

/** Opens the installed desktop app, which activates the key itself. */
export function appLink(key) {
  return `whyfull://activate?key=${encodeURIComponent(key)}`
}

/** Unverified payload for display; the app verifies the signature. */
export function describeKey(key) {
  try {
    const body = key.slice("WHYFULL-".length).split(".")[0]
    const base64 = body.replace(/-/g, "+").replace(/_/g, "/")
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    const payload = JSON.parse(new TextDecoder().decode(bytes))
    if (payload?.product !== "whyfull-desktop") return null
    return {
      id: typeof payload.id === "string" ? payload.id : null,
      name: typeof payload.name === "string" ? payload.name : null,
      issued: typeof payload.issued === "string" ? payload.issued : null,
    }
  } catch {
    return null
  }
}

export function licenseText(key, { id, name } = {}) {
  return [
    "Whyfull desktop license",
    "=======================",
    ...(name ? [`Licensed to: ${name}`] : []),
    ...(id ? [`License ID: ${id}`] : []),
    "",
    "License key:",
    key,
    "",
    "How to activate:",
    `With Whyfull installed, open this link to activate it in one step: ${appLink(key)}`,
    "",
    "Or by hand:",
    "1. Open Whyfull on your computer.",
    "2. Choose Whyfull menu → Support Whyfull…",
    "3. Paste the key above (or the activation link below) and choose Activate.",
    "",
    `Activation link: ${site}/activate#key=${key}`,
    `Download Whyfull: ${site}/download/`,
    `Lost this file? ${site}/recover/`,
    "",
    "One license covers every computer you use. Keep this key to yourself.",
    "",
  ].join("\n")
}

/** Wire the copy and download buttons for a key shown on the page. */
export function showKey(key, details = {}) {
  $("wf-license-key").textContent = key
  const holder = $("wf-license-holder")
  const parts = []
  if (details.name) parts.push(`Licensed to ${details.name}`)
  if (details.id) parts.push(`License ID ${details.id}`)
  holder.textContent = parts.join(" · ")
  holder.hidden = parts.length === 0

  const open = $("wf-license-open")
  if (open) {
    open.href = appLink(key)
    open.hidden = false
  }
  const copy = $("wf-license-copy")
  const status = $("wf-license-copy-status")
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(key)
      copy.textContent = "Copied"
      status.textContent = "License key copied."
      setTimeout(() => (copy.textContent = "Copy key"), 2000)
    } catch {
      window.getSelection()?.selectAllChildren($("wf-license-key"))
      status.textContent = "Press Command-C or Ctrl-C to copy the selected key."
    }
  })
  $("wf-license-file").addEventListener("click", () => {
    const blob = new Blob([licenseText(key, details)], {
      type: "text/plain;charset=utf-8",
    })
    const link = document.createElement("a")
    link.href = URL.createObjectURL(blob)
    link.download = `whyfull-license${details.id ? `-${details.id}` : ""}.txt`
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  })
  $("wf-license").hidden = false
}

const labels = {
  "desktop-macos-arm64": ["macOS", "Apple Silicon", "DMG"],
  "desktop-macos-x64": ["macOS", "Intel", "DMG"],
  "desktop-windows-x64": ["Windows", "64-bit", "EXE"],
  "desktop-linux-x64-appimage": ["Linux", "x64", "AppImage"],
  "desktop-linux-x64-deb": ["Debian / Ubuntu", "x64", "DEB"],
}

/** Desktop installer links from /api/downloads, best match first. */
export async function showInstallers() {
  const list = $("wf-installers")
  const status = $("wf-installers-status")
  try {
    const [release, platform] = await Promise.all([
      loadRelease(),
      detectPlatform(),
    ])
    const downloads = (release?.downloads ?? []).filter((entry) =>
      Object.hasOwn(labels, entry.id)
    )
    if (!downloads.length) throw new Error("No desktop downloads")
    const primary = primaryDownload(release, platform)?.download
    downloads.sort((a, b) => (b === primary) - (a === primary))
    list.replaceChildren(
      ...downloads.map((download) => {
        const [os, chip, kind] = labels[download.id]
        const link = document.createElement("a")
        link.className = "wf-download-button"
        link.href = download.url
        link.textContent = `${os} · ${chip}`
        const meta = document.createElement("span")
        meta.textContent = `${kind} · ${formatSize(download.size)}`
        link.append(meta)
        if (download === primary) link.dataset.primary = ""
        return link
      })
    )
    status.textContent = `Version ${release.version}`
  } catch {
    status.replaceChildren(
      document.createTextNode("Get the installer from the "),
      Object.assign(document.createElement("a"), {
        href: "/download/",
        textContent: "download page",
      }),
      document.createTextNode(".")
    )
  }
}
