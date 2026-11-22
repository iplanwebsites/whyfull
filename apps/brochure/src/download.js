import {
  detectPlatform,
  formatSize,
  loadRelease,
  primaryDownload,
  releasesUrl,
} from "./release.js"

const $ = (id) => document.getElementById(id)
const releaseStatus = $("wf-release-status")
const platform = await detectPlatform()

if (platform.mobile) $("wf-mobile-hint").hidden = false
if (platform.os) {
  const section = document.querySelector(`[data-platform="${platform.os}"]`)
  section?.setAttribute("data-matched", "")
  const label = section?.querySelector(".wf-download-match")
  if (label) label.hidden = false
  if (section instanceof HTMLDetailsElement) section.open = true
}

function copyButton(text, label) {
  const button = document.createElement("button")
  button.type = "button"
  button.className = "wf-download-copy"
  button.textContent = "Copy"
  button.setAttribute("aria-label", label)
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text)
      button.textContent = "Copied"
      setTimeout(() => (button.textContent = "Copy"), 2000)
    } catch {
      const code = button.previousElementSibling
      if (code) window.getSelection()?.selectAllChildren(code)
    }
  })
  return button
}

function showRelease(release) {
  const date = new Date(release.publishedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
  releaseStatus.textContent = `Version ${release.version} · ${release.channel === "preview" ? "Preview" : "Stable release"} · ${date}`
  const notes = $("wf-release-notes")
  if (release.notesUrl) {
    notes.href = release.notesUrl
    notes.textContent = "Release notes ↗"
  }
  const checksums = $("wf-checksums")
  checksums.href = release.checksumsUrl
  checksums.hidden = false

  // Show only files this release has; the rest fill in automatically later.
  const available = new Set(release.downloads.map((entry) => entry.id))
  let missing = release.limited === true
  for (const link of document.querySelectorAll("[data-download]")) {
    const download = release.downloads.find(
      (entry) => entry.id === link.dataset.download
    )
    if (!download) {
      link.hidden = true
      missing = true
      continue
    }
    link.href = download.url
    link.removeAttribute("aria-disabled")
    link.querySelector("span").append(` · ${formatSize(download.size)}`)
  }
  for (const group of document.querySelectorAll(
    "[data-platform], #wf-cli-archives"
  )) {
    group.hidden = !group.querySelector("[data-download]:not([hidden])")
  }
  const platforms = $("wf-platforms")
  platforms.dataset.count = String(
    platforms.querySelectorAll(":scope > :not([hidden])").length
  )
  $("wf-coming-soon").hidden = !missing

  const macBuilds = ["desktop-macos-arm64", "desktop-macos-x64"].filter((id) =>
    available.has(id)
  )
  $("wf-macos-chip-tip").hidden = macBuilds.length < 2
  if (macBuilds.length === 1)
    $("wf-macos-requirements").textContent =
      macBuilds[0] === "desktop-macos-arm64"
        ? "macOS 11 or later, on a Mac with Apple Silicon (M1 or newer)."
        : "macOS 11 or later, on an Intel Mac."

  const list = $("wf-checksum-list")
  list.replaceChildren(
    ...release.downloads.map((download) => {
      const row = document.createElement("div")
      const name = document.createElement("dt")
      name.textContent = download.name
      const value = document.createElement("dd")
      const code = document.createElement("code")
      code.textContent = download.sha256
      value.append(
        code,
        copyButton(download.sha256, `Copy SHA-256 for ${download.name}`)
      )
      row.append(name, value)
      return row
    })
  )
  $("wf-checksum-details").hidden = release.downloads.length === 0

  const unsignedMac = release.macosSigning === "unsigned"
  const macSigning = $("wf-macos-signing")
  macSigning.textContent = unsignedMac
    ? "Unsigned preview · Not notarized by Apple."
    : "Signed with Apple Developer ID and notarized."
  macSigning.hidden = false
  $("wf-macos-warning").hidden = !unsignedMac
  $("wf-macos-help").hidden = !unsignedMac
  const windowsSigning = $("wf-windows-signing")
  windowsSigning.textContent =
    release.windowsSigning === "unsigned"
      ? "Installer not code-signed. Windows may show an unknown-publisher warning."
      : "Code-signed installer."
  windowsSigning.hidden = false

  $("wf-updates-status").textContent = release.limited
    ? "No automatic updates. Download newer versions here."
    : release.updater
      ? "Signed updates: Whyfull → Check for updates…. You choose when to install."
      : "No automatic updates in this preview. Download a newer version here."

  const primary = primaryDownload(release, platform)
  const button = $("wf-primary-download")
  if (primary && !platform.mobile) {
    button.href = primary.download.url
    button.textContent = `${primary.label} · ${primary.size}`
    $("wf-primary-note").hidden = false
  }
}

try {
  const release = await loadRelease()
  if (release) showRelease(release)
  else {
    releaseStatus.textContent = "No releases published yet."
    $("wf-platforms").hidden = true
    $("linux-downloads").hidden = true
    $("wf-cli-archives").hidden = true
    $("wf-npm-fallback").hidden = false
  }
} catch {
  $("wf-npm-fallback").hidden = false
  $("wf-macos-help").hidden = false
  releaseStatus.replaceChildren(
    document.createTextNode("Download availability couldn’t be checked. ")
  )
  const link = document.createElement("a")
  link.href = releasesUrl
  link.textContent = "Browse GitHub Releases ↗"
  releaseStatus.append(link)
}
