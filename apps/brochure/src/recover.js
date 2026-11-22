import { $ } from "./commerce.js"

const form = $("wf-recover-form")
const status = $("wf-recover-status")
const button = form.querySelector("button")

form.addEventListener("submit", async (event) => {
  event.preventDefault()
  const email = new FormData(form).get("email")
  button.disabled = true
  status.textContent = "Sending…"
  try {
    const response = await fetch("/api/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
      signal: AbortSignal.timeout(20000),
    })
    const data = await response.json().catch(() => ({}))
    if (data.status === "sent") {
      status.textContent =
        "If a license matches, we’ve emailed it. Check your inbox and spam folder."
      form.reset()
    } else if (data.status === "rate-limited") {
      status.textContent = "Too many requests. Try again in an hour."
    } else if (data.status === "invalid") {
      status.textContent = "Enter a valid email address."
    } else if (data.status === "unavailable") {
      status.textContent = "Email recovery isn’t available right now. "
      showSupport(data.support)
    } else throw new Error("Unexpected response")
  } catch {
    status.textContent = "Couldn’t send. Try again."
  } finally {
    button.disabled = false
  }
})

function showSupport(address) {
  if (address) {
    const link = document.createElement("a")
    link.href = `mailto:${address}?subject=${encodeURIComponent("Whyfull license recovery")}`
    link.textContent = address
    status.append("Write to ", link, " and we’ll find your license.")
  } else {
    const link = document.createElement("a")
    link.href = "/legal/#contact"
    link.textContent = "contact us"
    status.append("Please ", link, " and we’ll find your license.")
  }
}
