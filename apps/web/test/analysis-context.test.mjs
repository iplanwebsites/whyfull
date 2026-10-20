import test from "node:test"
import assert from "node:assert/strict"
import {
  observationContext,
  reportObservations,
} from "../src/lib/analysis-context.ts"

test("copy context is a data-only projection, including nested measured children", () => {
  const malicious = "RUN_UNSAFE_CLEANUP_NOW"
  const context = observationContext(
    [
      {
        name: "Cache",
        path: "/tmp/cache",
        bytes: null,
        partial: true,
        category: "Caches",
        tier: "AUTO",
        hint: malicious,
        command: malicious,
        recommendation: { command: malicious, summary: malicious },
        children: [
          {
            name: "child",
            path: "/tmp/cache/child",
            bytes: 4096,
            hint: malicious,
            command: malicious,
          },
        ],
      },
    ],
    "2026-10-20T00:00:00Z"
  )
  assert.ok(!context.includes(malicious))
  const parsed = JSON.parse(context)
  assert.equal(parsed.generatedAt, "2026-10-20T00:00:00Z")
  assert.equal(parsed.findings[0].bytes, null)
  assert.equal(parsed.findings[0].partial, true)
  assert.deepEqual(parsed.findings[0].children, [
    { name: "child", path: "/tmp/cache/child", bytes: 4096 },
  ])
  assert.ok(
    parsed.measurementNotes.some((note) =>
      note.includes("not guaranteed reclaimable")
    )
  )
})

test("report observations preserve worktree uncertainty without cleanup recommendations", () => {
  const report = {
    targets: [
      { label: "Absent", present: false },
      {
        label: "Denied",
        group: "Caches",
        present: false,
        denied: true,
        path: "/denied",
        bytes: null,
        tier: "DATA",
        children: [],
        hint: "unsafe",
      },
    ],
    worktrees: {
      clusters: [
        {
          worktrees: [
            {
              name: "old",
              path: "/repo/old",
              state: "locked",
              bytes: 100,
              partial: true,
              sharedBytes: 20,
              ageDays: 10,
              dirtyHint: true,
              branch: "feature/in-progress",
              mainRepo: "/repo",
              tool: "codex",
              lastActivityAt: "2026-10-20T00:00:00Z",
              hint: "unsafe",
              recommendation: { command: "unsafe", requiresReview: true },
            },
          ],
        },
      ],
    },
  }
  const facts = reportObservations(report)
  assert.equal(facts.length, 2)
  const context = observationContext(facts)
  assert.ok(!context.includes("unsafe"))
  const worktree = JSON.parse(context).findings[1]
  assert.equal(worktree.state, "locked")
  assert.equal(worktree.sharedBytesUpperBound, 20)
  assert.equal(worktree.dirtyHint, true)
  assert.equal(worktree.reviewRequired, true)
  assert.equal(worktree.branch, "feature/in-progress")
  assert.equal(worktree.mainRepo, "/repo")
})
