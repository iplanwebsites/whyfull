import test from "node:test"
import assert from "node:assert/strict"
import {
  parseViewerPanel,
  parseReportSection,
  viewerPanels,
  reportSections,
} from "../src/lib/panel-navigation.ts"

test("direct panel and report links preserve their folder and document", () => {
  for (const [key, values, parse] of [
    ["panel", viewerPanels, parseViewerPanel],
    ["reportSection", reportSections, parseReportSection],
  ]) {
    for (const value of values) {
      const url = new URL("http://localhost/?path=%2FProjects&document=fixture")
      url.searchParams.set(key, value)
      const reloaded = new URL(url.href)
      assert.equal(parse(reloaded.searchParams.get(key)), value)
      assert.equal(reloaded.searchParams.get("path"), "/Projects")
      assert.equal(reloaded.searchParams.get("document"), "fixture")
    }
  }
})

test("unknown panel and report sections are ignored", () => {
  for (const value of [
    undefined,
    null,
    "",
    "unknown",
    "scan/../settings",
    [],
    {},
    true,
  ]) {
    assert.equal(parseViewerPanel(value), undefined)
    assert.equal(parseReportSection(value), undefined)
  }
})
