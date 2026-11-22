# Comparable products and UX opportunities

This is a working comparison for Whyfull's disk explorer, storage report, and
cleanup flow. Product claims below come from the linked product sites; Whyfull
behavior comes from [the viewer design](viewer.md), the
[target catalog](../packages/whyfull/src/targets-data.ts), and the
[brochure](../apps/brochure/index.html). A site review does not verify how a
competitor's installed app behaves.

| Product                                                      | Relevant approach                                                                       | What to study                                                                              |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [Wombit](https://wombit.app/)                                | Mac disk maps, named storage categories, item explanations, and a reviewed cleanup flow | Turning a size scan into a confident decision; the public cache catalog and related guides |
| [Filelight](https://apps.kde.org/filelight/)                 | Concentric folder map                                                                   | Ring navigation and orientation                                                            |
| [GrandPerspective](https://grandperspectiv.sourceforge.net/) | Proportional rectangle map                                                              | Dense treemap navigation                                                                   |

## Wombit review — 2 November 2026

Wombit's site shows treemap, sunburst, and list views; highlights a **Safe to
Remove** set; explains what a selected item is, what removal costs, and how it
is removed; and shows the planned actions before cleanup. Its review distinguishes
items moved to Trash from cleanup commands that cannot be undone. These are
product-site demonstrations, not hands-on validation.

| Area                    | Whyfull today                                                                                                                                                                                                          | Gap and potential improvement                                                                                                                                                                                                                                                                                                                         | Priority |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Finding the next action | Whyfull has ranked storage suggestions, but they open from the top-right ellipsis menu and live in a modal separate from the map.                                                                                      | Put a visible **Review space** or **Suggestions** action beside the scan summary. Carry the selected map folder into its matching finding and return to the same place after review. Measure whether people reach an actionable finding without hunting through menus.                                                                                | High     |
| Explaining a candidate  | Whyfull's targets have safety tiers and short `hint` strings; details and rules live in dialogs, while charts show path and size in a footer.                                                                          | Give each known location a consistent item explanation in both explorer and report: what it is, who owns it, why it grows, what is lost or rebuilt, removal method, and evidence. Distinguish a verified catalog match from a generic cache guess. The explanation should be available before a cleanup control.                                      | High     |
| Cleanup plan            | Whyfull's Trash shortlist collects marks across scans. Real Trash requires an explicit launch capability, live scan, mode opt-in, and short-lived preview. It moves a selected item; the shortlist itself is metadata. | Add a read-only plan for all shortlisted items: measured versus unknown sizes, protected paths, stale-scan checks, and estimated size with overlap caveats. Separate Trash moves from tool commands. Keep actual execution gated by fresh validation. This would make the shortlist useful even for users who let an agent perform cleanup.           | High     |
| Safety semantics        | Whyfull uses `AUTO`, `REBUILD`, `JUDGEMENT`, `APP`, and `DATA`; target hints mix commands and cautions.                                                                                                                | Split structured catalog facts from prose: `recreates`, `removal consequence`, `method`, `preconditions`, and `source`. A one-word safety badge is insufficient for cases such as device symbols, offline package caches, shared pnpm stores, or user-owned worktrees. Preserve Whyfull's conservative treatment of partial scans and protected data. | High     |
| Outcome and recovery    | Whyfull uses macOS Trash for permitted moves, but the documented UI has no cleanup history or in-app restore workflow.                                                                                                 | After a move, show each item's outcome and a clear route to restore from Trash. Offer a rescan to measure free space afterward; the pre-move estimate is not the reclaimed amount. A full history can follow after the core review flow is sound.                                                                                                     | Medium   |
| Public education        | The brochure lists categories and links to source code; it has no public, browsable explanation page for each supported location.                                                                                      | Publish the same catalog facts used in the product as indexable pages for common questions such as npm cache, Xcode DerivedData, Docker data, and AI models. Each page should state what the files are, the consequences of removal, the recommended method, and cited upstream sources. Group pages into task-oriented guides.                       | High     |

### Content strategy worth adapting

Wombit has a [public catalog of 243 locations](https://wombit.app/safe-to-delete)
organized by category and safety level. An [npm cache entry](https://wombit.app/safe-to-delete/npm-cache)
answers the exact search question, then covers what it is, what happens if it is
removed, how the tool removes it, and its sources. A broader
[Xcode guide](https://wombit.app/guides/xcode-cleanup) connects multiple entries
around a user task. The site says its app and CLI use the same catalog wording.

Whyfull already has the raw ingredients: a target database, tiers, measured
reports, and specific advice for developer tools. The strongest first content
step is to enrich a small set of representative targets in one structured source,
render those facts in the UI, and publish pages from that source. This avoids
website advice drifting away from the product's actual safety rules. Source dates
and platform differences should be visible; a Mac-only cleanup instruction must
not silently appear on Windows or Linux.

### Suggested first slice

1. Choose five representative targets: npm cache, Xcode DerivedData, Docker
   data, Ollama models, and a Git worktree. Cover both low-risk caches and cases
   requiring user judgment.
2. Add structured explanation and consequence fields to their catalog entries,
   then show them in the existing report and explorer details. Do not infer
   reclaimable space or safety from folder size alone.
3. Make **Suggestions** visible after a completed scan and deep-link a selected
   folder to its finding. Check the flow with a first-time user task: “Find what
   filled my disk and decide what I can remove.”
4. Publish the five corresponding pages with upstream references and verify
   their guidance against the exact actions Whyfull offers on each platform.

The initial success measure should be whether a user can explain **what an item
is, why it is safe or risky, and what will happen next** before asking an agent
to act or enabling Trash.
