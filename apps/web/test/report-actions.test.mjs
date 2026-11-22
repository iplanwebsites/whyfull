import test from "node:test"
import assert from "node:assert/strict"
import { reportFindings, reportContext } from "../src/lib/report-actions.ts"

function fixture() {
  return {
    platform: "darwin",
    generatedAt: "2026-10-24T12:00:00Z",
    targets: [
      {
        id: "npm",
        label: "npm",
        group: "Packages",
        tier: "AUTO",
        path: "/cache/npm",
        present: true,
        bytes: 4096,
        partial: true,
        hint: "Review npm cache",
        children: [],
      },
      {
        id: "custom",
        label: "Custom",
        group: "Custom",
        tier: "DATA",
        path: "/data",
        present: true,
        bytes: null,
        denied: true,
        hint: "echo 'this is imported prose'",
        children: [],
      },
      { id: "missing", label: "Absent", present: false, children: [] },
    ],
    cacheHogs: {
      dirs: [
        {
          name: "Other cache",
          path: "/cache/other",
          bytes: 8000,
          children: [],
        },
      ],
    },
    worktrees: {
      clusters: [
        {
          worktrees: [
            {
              name: "Locked",
              path: "/repo/locked",
              bytes: 200,
              state: "locked",
              recommendation: {
                requiresReview: true,
                summary: "Review lock",
                command: null,
              },
            },
            {
              name: "Old",
              path: "/repo/old",
              bytes: 100,
              state: "linked",
              recommendation: {
                requiresReview: false,
                summary: "Review changes first",
                command: "git -C '/repo/old' status --short",
              },
            },
          ],
        },
      ],
    },
  }
}

test("AI review includes scoped personal guidance without converting it into commands", () => {
  const report = fixture()
  report.localContext = {
    userInstructions: "Prefer app cleanup",
    computerInstructions: "Keep offline models",
  }
  const context = JSON.parse(reportContext(report, reportFindings(report)))
  assert.deepEqual(context.personalGuidance, report.localContext)
  assert.ok(
    context.suggestedActions.every((action) => action.requiresValidation)
  )
})

test("report actions retain recommendations and structured commands without interpreting hints", () => {
  const findings = reportFindings(fixture())
  assert.equal(findings.length, 5)
  assert.equal(findings[0].name, "Other cache")
  assert.match(findings[0].recommendation, /owning app/)
  const npm = findings.find((item) => item.name === "npm")
  assert.equal(npm.partial, true)
  assert.equal(npm.recommendation, "Review npm cache")
  assert.equal(npm.commands[0].command, "npm cache clean --force")
  const custom = findings.find((item) => item.name === "Custom")
  assert.equal(custom.bytes, null)
  assert.deepEqual(custom.commands, [])
  assert.deepEqual(findings.find((item) => item.name === "Locked").commands, [])
  assert.equal(
    findings.find((item) => item.name === "Old").commands[0].command,
    "git -C '/repo/old' status --short"
  )
})

test("AI report copies selected findings with facts, action references, and measurement caveats", () => {
  const report = fixture()
  const selected = reportFindings(report).filter((item) => item.name === "npm")
  const copied = JSON.parse(reportContext(report, selected))
  assert.equal(copied.format, "whyfull-review-report")
  assert.equal(copied.generatedAt, report.generatedAt)
  assert.equal(copied.platform, "darwin")
  assert.equal(copied.findings.length, 1)
  assert.equal(copied.findings[0].partial, true)
  assert.equal(copied.findings[0].recommendation, undefined)
  assert.equal(copied.suggestedActions[0].recommendation, "Review npm cache")
  assert.equal(copied.suggestedActions[0].requiresValidation, true)
  assert.match(copied.reviewRequest, /validate/)
  assert.ok(copied.measurementNotes.some((note) => note.includes("overlap")))
})

test("AI report preserves inventory scope and limitations", () => {
  const report = fixture()
  report.inventory = {
    root: "/recorded/root",
    startedAt: "2026-10-24T11:00:00Z",
    completedAt: report.generatedAt,
    basis: "allocated-bytes",
    limitations: ["No additional scan", "Git status was not verified"],
  }
  const copied = JSON.parse(reportContext(report, reportFindings(report)))
  assert.deepEqual(copied.inventory, report.inventory)
})

test("suggestion groups put rebuildable items before real data and state shared hints once", async () => {
  const { suggestionGroups } = await import("../src/lib/report-actions.ts")
  const finding = (name, category, tier, recommendation) => ({
    name,
    path: `/x/${name}`,
    category,
    tier,
    bytes: 1,
    recommendation,
    commands: [],
  })
  const boiler = "Inspect this folder and confirm what owns it."
  const groups = suggestionGroups([
    finding("Movies", "Large folders", "DATA", boiler),
    finding("Photos", "Large folders", "DATA", boiler),
    finding("Mail", "Mail", "DATA", "Prune in Mail"),
    finding("turbo", "Build caches", "REBUILD", "Turbo cache"),
    finding("npm", "Packages", "AUTO", "npm cache clean"),
  ])
  assert.deepEqual(
    groups.map((group) => group.key),
    ["AUTO", "REBUILD", "DATA", "Large folders"]
  )
  const large = groups.at(-1)
  assert.equal(large.shared, boiler)
  assert.deepEqual(large.notes, [boiler])
  assert.equal(groups[0].label, "Regenerates automatically")
  assert.equal(groups[0].shared, null)
  assert.equal(groups[2].label, "Real data")
})
