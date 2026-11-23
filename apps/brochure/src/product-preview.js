export function initializeProductPreview() {
  const preview = document.querySelector("[data-product-preview]")
  if (!preview) return

  const links = [...preview.querySelectorAll("[data-preview]")]
  const panels = [...preview.querySelectorAll("[data-preview-panel]")]
  const views = new Set(panels.map((panel) => panel.dataset.previewPanel))

  const render = () => {
    const url = new URL(window.location.href)
    const requested = url.searchParams.get("preview")
    const hashView = url.hash.replace("#preview-", "")
    const selected = views.has(requested)
      ? requested
      : views.has(hashView)
        ? hashView
        : "overview"

    for (const panel of panels)
      panel.hidden = panel.dataset.previewPanel !== selected

    for (const link of links) {
      const destination = new URL(url)
      destination.searchParams.set("preview", link.dataset.preview)
      destination.hash = "product-preview"
      link.href = destination.pathname + destination.search + destination.hash
      if (link.dataset.preview === selected)
        link.setAttribute("aria-current", "true")
      else link.removeAttribute("aria-current")
    }
  }

  for (const link of links)
    link.addEventListener("click", (event) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return

      event.preventDefault()
      if (link.getAttribute("aria-current") === "true") return
      window.history.pushState(window.history.state, "", link.href)
      render()
    })

  window.addEventListener("popstate", render)
  window.addEventListener("hashchange", render)
  render()
}
