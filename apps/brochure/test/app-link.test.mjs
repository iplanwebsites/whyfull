import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import {
  appLink as emailAppLink,
  purchaseEmail,
  recoveryEmail,
} from "../worker/email.ts"
import { appLink, licenseText } from "../src/commerce.js"

const key = `WHYFULL-eyJ2IjoxfQ.${"A".repeat(43)}_-`
const license = {
  id: "WF-TEST",
  email: "ada@example.com",
  name: "Ada <Lovelace>",
  key,
  stripe_session_id: "cs_test_x",
  stripe_customer_id: null,
  payment_intent: null,
  amount: 1900,
  currency: "usd",
  created_at: "2026-11-22T10:00:00Z",
  refunded_at: null,
  emailed_at: null,
}
const link = `whyfull://activate?key=${encodeURIComponent(key)}`

test("app links carry the URI-encoded key for the desktop app", () => {
  assert.equal(appLink(key), link)
  assert.equal(emailAppLink(key), link)
  assert.equal(appLink("a+b/c"), "whyfull://activate?key=a%2Bb%2Fc")
  assert.ok(licenseText(key).includes(link))
})

test("purchase email offers the app link above the license page", () => {
  const message = purchaseEmail(license)
  const app = message.text.indexOf(link)
  const page = message.text.indexOf(`https://whyfull.app/activate#key=${key}`)
  assert.ok(app > 0 && page > app, message.text)
  assert.ok(message.html.includes(`href="${link}"`))
  assert.ok(
    message.html.indexOf(`href="${link}"`) <
      message.html.indexOf(`href="https://whyfull.app/activate#key=`)
  )
  assert.ok(message.html.includes("Open in Whyfull"))
  assert.ok(!message.html.includes("<Lovelace>"))
})

test("recovery email includes the app link for each license", () => {
  const message = recoveryEmail(license.email, [
    license,
    { ...license, id: "WF-TWO" },
  ])
  assert.equal(message.text.split(link).length - 1, 2)
  assert.equal(message.html.split(`href="${link}"`).length - 1, 2)
})

for (const page of ["thanks", "activate"])
  test(`/${page}/ has an Open in Whyfull button beside Copy key`, () => {
    const html = readFileSync(
      new URL(`../${page}/index.html`, import.meta.url),
      "utf8"
    )
    const open = html.indexOf('id="wf-license-open"')
    assert.ok(open > 0)
    assert.ok(open < html.indexOf('id="wf-license-copy"'))
    assert.match(html, /class="wf-home-button" id="wf-license-open"/)
    assert.match(html, /Open in Whyfull/)
  })
