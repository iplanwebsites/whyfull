import type { DirectoryView, ViewEntry } from "./api"

/** Summarize unremarkable files without letting the retained filename limit shape the chart. */
export function fileSummaryChart(directory: DirectoryView): ViewEntry {
  if (
    directory.ownFiles <= directory.retainedFiles ||
    directory.ownBytes <= 0 ||
    directory.ownBytes < directory.node.value * 0.9 ||
    directory.largestFileBytes >= directory.ownBytes * 0.01 ||
    directory.chart.children?.some(
      (entry) => entry.kind === "group" && entry.files === undefined
    )
  )
    return directory.chart
  const others = (directory.chart.children ?? []).filter(
    (entry) =>
      entry.kind === "directory" ||
      (entry.kind === "group" && entry.files === undefined)
  )
  return {
    ...directory.chart,
    children: [
      ...others,
      {
        id: `files-${directory.node.id}`,
        kind: "group",
        name: "Files",
        files: directory.ownFiles,
        value: directory.ownBytes,
        colorPath: directory.chart.colorPath,
      },
    ],
  }
}
