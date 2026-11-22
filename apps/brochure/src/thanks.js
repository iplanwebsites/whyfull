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
      ? "Your license is ready. We’ve also emailed it to you."
      : "Your license is ready. A copy is on its way to your inbox."
    showKey(data.key, { id: data.licenseId, name: data.name })
    $("wf-license-steps").hidden = false
    return
  }
  if (data.status === "pending")
    return retry(
      "Your payment is processing. Some payment methods take a few minutes; your key appears here and arrives by email as soon as it clears."
    )
  if (data.status === "open")
    return fail(
      "This checkout isn’t finished yet. Return to the checkout tab to complete it, or start again from the Whyfull app."
    )
  if (data.status === "refunded")
    return fail(
      "This purchase was refunded, so its license is no longer active."
    )
  if (data.status === "invalid")
    return fail("We couldn’t find a purchase for this link.")
  return retry("We’re preparing your license…")
}

function retry(message) {
  status.textContent = message
  // Poll for up to ten minutes, gently backing off.
  const elapsed = Date.now() - started
  if (elapsed > 600_000)
    return fail(
      "This is taking longer than usual. Your key will arrive by email once the payment clears."
    )
  setTimeout(lookup, elapsed < 60_000 ? 3000 : 15000)
}

if (/^cs_(?:test|live)_[A-Za-z0-9]{8,240}$/.test(sessionId)) lookup()
else fail("This page needs the link you were sent to after checkout.")
showInstallers()
