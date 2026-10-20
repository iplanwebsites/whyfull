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
        ? "Paste the prompt into your coding agent on the computer you want to inspect."
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
