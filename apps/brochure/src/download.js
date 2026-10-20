const releaseStatus = document.getElementById("wf-release-status")
const releasesUrl = "https://github.com/iplanwebsites/whyfull/releases"

// Only highlight the OS; never guess a Mac's chip or hide other downloads.
const platformHint =
  navigator.userAgentData?.platform || navigator.platform || ""
const platform = /mac/i.test(platformHint)
  ? "macos"
  : /win/i.test(platformHint)
    ? "windows"
    : /linux/i.test(platformHint) && !/android/i.test(navigator.userAgent)
      ? "linux"
      : null
if (platform) {
  const section = document.querySelector(`[data-platform="${platform}"]`)
  section?.setAttribute("data-matched", "")
  const label = section?.querySelector(".wf-download-match")
  if (label) label.hidden = false
  if (section instanceof HTMLDetailsElement) section.open = true
}

try {
  const response = await fetch("/api/downloads", {
    signal: AbortSignal.timeout(18000),
  })
  if (!response.ok) throw new Error("Release lookup failed")
  const { release } = await response.json()
  if (!release) {
    releaseStatus.textContent =
      "Desktop and standalone CLI downloads will appear here after the first release is published."
    document.getElementById("wf-npm-fallback").hidden = false
  } else {
    const date = new Date(release.publishedAt).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
    releaseStatus.textContent = `Version ${release.version} · ${release.channel === "preview" ? "Preview — early build for testing" : "Stable release"} · ${date}`
    const notes = document.getElementById("wf-release-notes")
    notes.href = release.notesUrl
    notes.textContent = "Release notes ↗"
    const checksums = document.getElementById("wf-checksums")
    checksums.href = release.checksumsUrl
    checksums.hidden = false
    for (const link of document.querySelectorAll("[data-download]")) {
      const download = release.downloads.find(
        (entry) => entry.id === link.dataset.download
      )
      if (!download) continue
      link.href = download.url
      link.removeAttribute("aria-disabled")
      link
        .querySelector("span")
        .append(` · ${(download.size / 1024 ** 2).toFixed(1)} MB`)
      link.title = `${download.name}\nSHA-256: ${download.sha256}`
    }
    const unsignedMac = release.macosSigning === "unsigned"
    document.getElementById("wf-macos-signing").textContent = unsignedMac
      ? "Unsigned preview · Not notarized by Apple."
      : "Signed with Apple Developer ID and notarized."
    document.getElementById("wf-macos-warning").hidden = !unsignedMac
    if (unsignedMac) document.getElementById("wf-macos-help").open = true
    document.getElementById("wf-windows-signing").textContent =
      release.windowsSigning === "unsigned"
        ? "Installer not code-signed. Windows may show an unknown-publisher warning."
        : "Code-signed installer."
    document.getElementById("wf-updates-status").textContent = release.updater
      ? "This desktop release checks for signed updates on launch and from Whyfull → Check for updates…. You choose when to install and restart. Use AppImage for this update path on Linux; DEB installations update by installing a newer package."
      : "This preview does not check for automatic updates. Download a newer preview here and replace your installed copy. Stable releases will offer signed desktop updates."
  }
} catch {
  document.getElementById("wf-npm-fallback").hidden = false
  releaseStatus.replaceChildren(
    document.createTextNode("Download availability couldn’t be checked. ")
  )
  const link = document.createElement("a")
  link.href = releasesUrl
  link.textContent = "Browse GitHub Releases ↗"
  releaseStatus.append(link)
}
