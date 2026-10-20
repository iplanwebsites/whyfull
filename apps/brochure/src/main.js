// The visible content is also the clipboard source, including without JS.
const status = document.getElementById("wf-copy-status")

for (const button of document.querySelectorAll("[data-copy]")) {
  const originalLabel = button.innerHTML
  let resetTimer
  button.addEventListener("click", async () => {
    const source = document.getElementById(button.dataset.copy)
    if (!source || !status) return
    const text =
      source instanceof HTMLTextAreaElement ? source.value : source.textContent
    const isPrompt = source instanceof HTMLTextAreaElement
    try {
      await navigator.clipboard.writeText(text)
      button.textContent = isPrompt ? "Prompt copied" : "Command copied"
      status.textContent = isPrompt
        ? "Paste the prompt into your coding agent on the computer you want to inspect."
        : "Command copied. Paste it into your terminal to open the local viewer."
      clearTimeout(resetTimer)
      resetTimer = setTimeout(() => {
        button.innerHTML = originalLabel
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
