import test from "node:test"
import assert from "node:assert/strict"
import { fileSummaryChart } from "../src/lib/file-summary-chart.ts"

function directory() {
  const chart = {
    id: "d1",
    name: "Photos",
    kind: "directory",
    value: 1010,
    children: [
      { id: "d2", kind: "directory", name: "Notes", value: 10 },
      { id: "f1", kind: "file", value: 2 },
      { id: "f2", kind: "file", value: 2 },
      { id: "r1", kind: "remainder", files: 998, value: 996 },
    ],
  }
  return {
    node: chart,
    chart,
    ownFiles: 1000,
    retainedFiles: 2,
    ownBytes: 1000,
    largestFileBytes: 2,
  }
}

test("file-heavy charts group all measured files and preserve directory totals", () => {
  const input = directory()
  const chart = fileSummaryChart(input)
  assert.equal(chart.children.length, 2)
  assert.equal(chart.children[0].id, "d2")
  assert.equal(chart.children[1].files, 1000)
  assert.equal(chart.children[1].value, 1000)
  assert.equal(
    chart.children.reduce((sum, entry) => sum + entry.value, 0),
    chart.value
  )
  assert.equal(
    input.chart.children.length,
    4,
    "the inventory chart stays unchanged"
  )
})

test("one folder of files becomes a full donut with one group", () => {
  const input = directory()
  input.chart.children.shift()
  input.node.value = 1000
  assert.equal(fileSummaryChart(input).children.length, 1)
  assert.equal(fileSummaryChart(input).children[0].files, 1000)
})

test("large outliers and mixed directory groups retain the original chart", () => {
  const input = directory()
  input.largestFileBytes = 10
  assert.equal(fileSummaryChart(input), input.chart)
  input.largestFileBytes = 2
  input.chart.children.push({ id: "g1", kind: "group", value: 10 })
  assert.equal(fileSummaryChart(input), input.chart)
})
