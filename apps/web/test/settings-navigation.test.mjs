import test from "node:test"
import assert from "node:assert/strict"
import {
  parseSettingsSection,
  settingsSections,
} from "../src/lib/settings-navigation.ts"

test("every settings section survives a direct URL round trip", () => {
  for (const section of settingsSections) {
    const url = new URL(`http://localhost/?settings=${section}`)
    assert.equal(
      parseSettingsSection(url.searchParams.get("settings")),
      section
    )
  }
})

test("invalid settings URLs do not open a panel", () => {
  for (const value of [
    undefined,
    null,
    "",
    "unknown",
    "GENERAL",
    [],
    {},
    true,
  ]) {
    assert.equal(parseSettingsSection(value), undefined)
  }
})

test("license is a settings section, not a panel", async () => {
  assert.ok(settingsSections.includes("license"))
  const { parseViewerPanel } = await import("../src/lib/panel-navigation.ts")
  assert.equal(parseViewerPanel("license"), undefined)
})
