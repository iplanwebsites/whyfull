import { $, showInstallers, showKey } from "./commerce.js"

const status = $("wf-license-status")
const sessionId = new URLSearchParams(location.search).get("session_id") ?? ""
const started = Date.now()

function fail(message) {
  status.textContent = message
  $("wf-license-help").hidden = false
}

async function lookup() {
  let response
  try {
    response = await fetch(
      `/api/license?session_id=${encodeURIComponent(sessionId)}`,
      { cache: "no-store", signal: AbortSignal.timeout(20000) }
    )
  } catch {
    return retry("Still connecting…")
  }
  const data = await response.json().catch(() => ({}))
  if (data.status === "ready" && data.key) {
    status.textContent = data.emailed
      ? "License ready. Copy emailed."
      : "License ready. Email on its way."
    showKey(data.key, { id: data.licenseId, name: data.name })
    $("wf-license-steps").hidden = false
    return
  }
  if (data.status === "pending")
    return retry(
      "Payment processing. Your key will appear here and arrive by email once it clears."
    )
  if (data.status === "open")
    return fail(
      "Checkout incomplete. Return to checkout or start again in Whyfull."
    )
  if (data.status === "refunded")
    return fail("Purchase refunded. This license is inactive.")
  if (data.status === "invalid") return fail("No purchase found for this link.")
  return retry("Preparing your license…")
}

function retry(message) {
  status.textContent = message
  // Poll for up to ten minutes, gently backing off.
  const elapsed = Date.now() - started
  if (elapsed > 600_000)
    return fail(
      "Still processing. Your key will arrive by email when payment clears."
    )
  setTimeout(lookup, elapsed < 60_000 ? 3000 : 15000)
}

if (/^cs_(?:test|live)_[A-Za-z0-9]{8,240}$/.test(sessionId)) lookup()
else fail("Open the link from your purchase email.")
showInstallers()
