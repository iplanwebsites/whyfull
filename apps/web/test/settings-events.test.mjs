import test from "node:test"
import assert from "node:assert/strict"
import {
  SETTINGS_EVENT,
  listenForSettings,
  settingsEventSection,
} from "../src/lib/settings-events.ts"

test("settings requests are validated", () => {
  assert.equal(settingsEventSection({ section: "license" }), "license")
  assert.equal(settingsEventSection({ section: "nope" }), undefined)
  assert.equal(settingsEventSection("license"), undefined)
  assert.equal(settingsEventSection(null), undefined)
})

test("listeners open sections, including one requested before mounting", () => {
  const target = new EventTarget()
  target.__whyfullSettings = { section: "license" }
  const seen = []
  const stop = listenForSettings(target, (section) => seen.push(section))
  assert.deepEqual(seen, ["license"])
  assert.equal(target.__whyfullSettings, undefined)
  target.dispatchEvent(
    new CustomEvent(SETTINGS_EVENT, { detail: { section: "general" } })
  )
  target.dispatchEvent(
    new CustomEvent(SETTINGS_EVENT, { detail: { section: "bogus" } })
  )
  assert.deepEqual(seen, ["license", "general"])
  stop()
  target.dispatchEvent(
    new CustomEvent(SETTINGS_EVENT, { detail: { section: "license" } })
  )
  assert.equal(seen.length, 2)
})
