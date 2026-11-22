import {
  $,
  describeKey,
  extractKey,
  showInstallers,
  showKey,
} from "./commerce.js"

// The key lives in the URL fragment, which browsers never send to a server.
const fragment = new URLSearchParams(location.hash.slice(1))
const key = extractKey(fragment.get("key") ?? "")
const status = $("wf-license-status")

if (key) {
  const details = describeKey(key) ?? {}
  status.textContent = "Here’s your Whyfull license key."
  showKey(key, details)
  $("wf-license-steps").hidden = false
} else {
  status.textContent =
    "No license key in this link. Open the link from your purchase email, or paste the key directly into Whyfull."
  $("wf-license-help").hidden = false
}
showInstallers()
