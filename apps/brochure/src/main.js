import { detectPlatform, loadRelease, primaryDownload } from "./release.js"

// The visible content is also the clipboard source, including without JS.
for (const button of document.querySelectorAll("[data-copy]")) {
  const originalLabel = button.innerHTML
  const originalTitle = button.title
  const originalAriaLabel = button.getAttribute("aria-label")
  let resetTimer
  button.addEventListener("click", async () => {
    const status = document.getElementById(
      button.dataset.copyStatus || "wf-copy-status"
    )
    const source = document.getElementById(button.dataset.copy)
    if (!source || !status) return
    const text =
      source instanceof HTMLTextAreaElement ? source.value : source.textContent
    const isPrompt = source instanceof HTMLTextAreaElement
    try {
      await navigator.clipboard.writeText(text)
      if (isPrompt) {
        button.textContent = "Prompt copied"
      } else {
        button.innerHTML =
          '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>'
        button.dataset.copied = "true"
        button.title = "Copied"
        button.setAttribute("aria-label", "Command copied")
      }
      status.textContent = isPrompt
        ? "Copied. Paste it into your coding agent on the computer you want to clean up."
        : button.dataset.copy === "wf-skill-command"
          ? "Install command copied. Paste it into your terminal and choose your agent."
          : "Command copied. Paste it into your terminal to run Whyfull."
      clearTimeout(resetTimer)
      resetTimer = setTimeout(() => {
        button.innerHTML = originalLabel
        delete button.dataset.copied
        button.title = originalTitle
        if (originalAriaLabel)
          button.setAttribute("aria-label", originalAriaLabel)
      }, 3000)
    } catch {
      if (isPrompt) {
        source.closest("details").open = true
        source.focus()
        source.select()
      } else {
        const range = document.createRange()
        range.selectNodeContents(source)
        const selection = window.getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
      }
      status.textContent = isPrompt
        ? "Copy the selected prompt, then paste it into your coding agent."
        : "Copy the selected command, then paste it into your terminal."
    }
  })
}

// Drop a screenshot's frame if its image fails to load.
for (const appShot of document.querySelectorAll("[data-app-shot]")) {
  const image = appShot.querySelector("img")
  if (!image) continue
  const hide = () => (appShot.hidden = true)
  if (image.complete && !image.naturalWidth) hide()
  else image.addEventListener("error", hide, { once: true })
}

// Show the star count only once it says something.
async function loadStarButton(button) {
  try {
    const response = await fetch(
      "https://api.github.com/repos/iplanwebsites/whyfull",
      { signal: AbortSignal.timeout(4000) }
    )
    const { stargazers_count: stars } = response.ok ? await response.json() : {}
    if (stars >= 50) button.dataset.showCount = "true"
  } catch {}
  const script = document.createElement("script")
  script.src = "https://buttons.github.io/buttons.js"
  script.async = true
  document.head.append(script)
}
const starButton = document.querySelector(".github-button")
if (starButton) loadStarButton(starButton)

// Home hero: link straight to the matching file; otherwise /download/.
async function loadHeroDownload(button) {
  const note = document.querySelector("[data-primary-download-note]")
  try {
    const [platform, release] = await Promise.all([
      detectPlatform(),
      loadRelease(),
    ])
    const primary = primaryDownload(release, platform)
    if (!primary) return
    button.href = primary.download.url
    button.textContent = primary.label.replace(/ \(.*\)$/, "")
    const other = document.createElement("a")
    other.href = "/download/"
    other.textContent = "Other downloads"
    note?.replaceChildren(
      `${[primary.chip, primary.size].filter(Boolean).join(" · ")} · CLI included. `,
      other
    )
  } catch {}
}
const heroDownload = document.querySelector("[data-primary-download]")
if (heroDownload) loadHeroDownload(heroDownload)
