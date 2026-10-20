import { lazy, Suspense, useMemo, useState } from "react"
import { createRoot } from "react-dom/client"
import { Treemap } from "../../web/src/components/treemap"
import { chartColors, colorFor } from "../../web/src/lib/chart-colors"
import { formatSize } from "../../web/src/lib/format-size"
import type { ViewEntry } from "../../web/src/lib/api"
import snapshot from "./demo-snapshot.json"
import "./demo.css"

const Sunburst = lazy(() => import("../../web/src/components/sunburst"))
function entry(id: number, colorPath: number[] = []): ViewEntry {
  const node = snapshot.directories[id]
  return {
    id: String(id),
    name: node.name,
    path: node.path,
    value: node.bytes,
    kind: "directory",
    colorPath,
    children: node.children.map((child, rank) =>
      entry(child, [...colorPath, rank])
    ),
  }
}
const root = entry(0)
const colors = chartColors(root)
const flat = (node: ViewEntry): ViewEntry[] => [
  node,
  ...(node.children ?? []).flatMap(flat),
]
const inventory = flat(root)
const guidance: Record<
  string,
  { kind: string; advice: string; command?: string }
> = {
  Ollama: {
    kind: "Review models",
    advice:
      "Remove models you no longer use through Ollama. They must be downloaded again if needed.",
    command: "ollama list",
  },
  "Hugging Face": {
    kind: "Review models",
    advice:
      "Review cached model revisions with the Hugging Face cache tools. Other projects may still use them.",
    command: "hf cache ls",
  },
  "Model experiments": {
    kind: "Review files",
    advice:
      "Check your experiment outputs before removing them. Weights and training results may be irreplaceable.",
  },
  "Build cache": {
    kind: "Rebuildable cache",
    advice:
      "Review Docker build-cache usage first. Pruning can reclaim cache, but future builds may take longer.",
    command: "docker system df",
  },
  Images: {
    kind: "Review images",
    advice:
      "Inspect images and containers before using Docker's prune tools. Keep images required by your projects.",
    command: "docker image ls",
  },
  Volumes: {
    kind: "Keep / investigate",
    advice:
      "Volumes can contain databases and persistent application data. Back them up and check ownership before removal.",
    command: "docker volume ls",
  },
  "pnpm store": {
    kind: "Rebuildable cache",
    advice:
      "The store is shared by projects. pnpm store prune removes unreferenced packages; a future install may download them again.",
    command: "pnpm store status",
  },
  "Xcode DerivedData": {
    kind: "Rebuildable cache",
    advice:
      "Build intermediates can be regenerated. Close active builds and review the relevant project folders first.",
  },
  "Project builds": {
    kind: "Rebuildable output",
    advice:
      "Check the project's clean command and keep source files. Generated output may be needed for an offline release.",
  },
  "Video Editor.app": {
    kind: "Review application",
    advice:
      "An example of a large application, not an automatic unused-app diagnosis. If you no longer use it, follow the application's uninstall instructions.",
  },
  "Old IDE.app": {
    kind: "Review application",
    advice:
      "Confirm you no longer need this version. Size alone does not establish whether an application is unused.",
  },
  Installers: {
    kind: "Review downloads",
    advice:
      "Keep installers you need for offline use. Remove only downloads you recognize and can replace.",
  },
  Archives: {
    kind: "Review downloads",
    advice:
      "Check the contents and backups. Archives can contain unique work rather than disposable cache.",
  },
}
function Demo() {
  const [current, setCurrent] = useState(root)
  const [mode, setMode] = useState<"treemap" | "sunburst" | "report">("treemap")
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<ViewEntry | null>(null)
  const [hover, setHover] = useState<ViewEntry | null>(null)
  const [kept, setKept] = useState<string[]>([])
  const [shortlisted, setShortlisted] = useState<string[]>([])
  const [notice, setNotice] = useState(
    "Click a folder to explore the example inventory."
  )
  const matching = useMemo(
    () =>
      (current.children ?? []).filter((n) =>
        n.name.toLowerCase().includes(query.toLowerCase())
      ),
    [current, query]
  )
  const chartRoot = useMemo(
    () => ({ ...current, children: matching }),
    [current, matching]
  )
  const report = inventory
    .filter(
      (n) =>
        !n.children?.length &&
        (n.path ?? n.name).toLowerCase().includes(query.toLowerCase())
    )
    .sort((a, b) => b.value - a.value)
  const crumbs = inventory.filter(
    (n) => current.path === n.path || current.path?.startsWith(n.path + "/")
  )
  const open = (node: ViewEntry) => {
    setQuery("")
    if (node.children?.length) {
      setCurrent(node)
      setSelected(null)
    } else setSelected(node)
  }
  const up = () => {
    const parent = inventory.find((n) =>
      n.children?.some((c) => c.id === current.id)
    )
    if (parent) {
      setCurrent(parent)
      setSelected(null)
      setQuery("")
    }
  }
  const pick = selected ?? hover
  const info = pick ? guidance[pick.name] : undefined
  const toggle = (kind: "keep" | "shortlist") => {
    if (!selected) return
    if (kind === "keep") {
      setKept(
        kept.includes(selected.id)
          ? kept.filter((id) => id !== selected.id)
          : [...kept, selected.id]
      )
      setShortlisted(shortlisted.filter((id) => id !== selected.id))
      setNotice(
        "Example keep rule updated. Only this page's demo state changed."
      )
    } else {
      setShortlisted(
        shortlisted.includes(selected.id)
          ? shortlisted.filter((id) => id !== selected.id)
          : [...shortlisted, selected.id]
      )
      setNotice("Example shortlist updated. No files are accessed or removed.")
    }
  }
  return (
    <div className="demo-window">
      <header className="demo-topbar">
        <strong>
          <span className="demo-drive" aria-hidden="true">
            ▣
          </span>{" "}
          Example Mac
        </strong>
        <span className="demo-badge">Synthetic data · demo only</span>
        <a href="/demo-snapshot.json" download>
          Download snapshot ↓
        </a>
      </header>
      <div className="demo-summary">
        <div>
          <span>Example inventory</span>
          <strong>{formatSize(root.value)}</strong>
        </div>
        <p>
          AI models, Docker, caches, apps, and downloads.
          <br />
          All names and sizes are fictional.
        </p>
        <div className="demo-shortlist">
          <strong>{shortlisted.length}</strong>
          <span>in demo shortlist</span>
        </div>
      </div>
      <div className="demo-toolbar">
        <div className="demo-tabs" role="group" aria-label="Demo view">
          {(["treemap", "sunburst", "report"] as const).map((view) => (
            <button
              key={view}
              aria-pressed={mode === view}
              onClick={() => {
                setMode(view)
                setQuery("")
              }}
            >
              {view === "treemap"
                ? "▦ Treemap"
                : view === "sunburst"
                  ? "◉ Sunburst"
                  : "☷ Cache report"}
            </button>
          ))}
        </div>
        <label>
          <span className="demo-search-label">
            Search {mode === "report" ? "report" : "folder"}
          </span>
          <input
            aria-label="Search demo inventory"
            type="search"
            value={query}
            placeholder="Filter by name…"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      {mode !== "report" && (
        <nav className="demo-crumbs" aria-label="Demo folder breadcrumbs">
          <button
            onClick={up}
            disabled={current === root}
            aria-label="Parent demo folder"
          >
            ↑
          </button>
          {crumbs.map((n) => (
            <button
              key={n.id}
              onClick={() => {
                setCurrent(n)
                setSelected(null)
                setQuery("")
              }}
            >
              {n.name}
              <span aria-hidden="true"> /</span>
            </button>
          ))}
        </nav>
      )}
      <div className="demo-workspace">
        {mode === "report" ? (
          <div className="demo-report">
            <table>
              <thead>
                <tr>
                  <th>Location</th>
                  <th>Review</th>
                  <th>Size</th>
                </tr>
              </thead>
              <tbody>
                {report.map((n) => (
                  <tr key={n.id}>
                    <td>
                      <button
                        onClick={() => setSelected(n)}
                        aria-pressed={selected?.id === n.id}
                      >
                        {n.name}
                        <small>{n.path}</small>
                      </button>
                    </td>
                    <td>{guidance[n.name]?.kind}</td>
                    <td>{formatSize(n.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!report.length && (
              <p className="demo-empty">
                No matching locations. Try “Docker” in the explorer, or “Build”
                in the report.
              </p>
            )}
          </div>
        ) : (
          <div className="demo-chart">
            <Suspense fallback={<p>Loading the shared sunburst viewer…</p>}>
              {mode === "treemap" ? (
                <Treemap
                  root={chartRoot}
                  colors={colors}
                  dark={false}
                  onOpen={open}
                  onSelect={setSelected}
                  onHover={setHover}
                  hovered={hover}
                  onContext={setSelected}
                />
              ) : (
                <Sunburst
                  root={chartRoot}
                  colors={colors}
                  dark={false}
                  onOpen={open}
                  onSelect={setSelected}
                  onHover={setHover}
                  hovered={hover}
                  onContext={setSelected}
                  onUp={up}
                />
              )}
            </Suspense>
            {!matching.length && (
              <p className="demo-empty">No matching folders.</p>
            )}
          </div>
        )}
        <aside className="demo-sidebar" aria-label="Demo folder details">
          <div className="demo-list-heading">
            <strong>
              {mode === "report" ? "Review a location" : "Largest pieces"}
            </strong>
            <span>
              {formatSize(mode === "report" ? root.value : current.value)}
            </span>
          </div>
          {mode !== "report" && (
            <div className="demo-folder-list">
              {matching.map((n) => (
                <button
                  key={n.id}
                  onClick={() => open(n)}
                  aria-label={`Explore ${n.name}`}
                >
                  <span
                    className="demo-color"
                    style={{ background: colorFor(colors, n).fill }}
                  />
                  <span>{n.name}</span>
                  <strong>{formatSize(n.value)}</strong>
                  <span aria-hidden="true">›</span>
                </button>
              ))}
            </div>
          )}
          <div className="demo-detail">
            <span className="demo-eyebrow">
              {info?.kind ?? "Explore, then decide"}
            </span>
            <h3>{pick?.name ?? "What’s taking up space?"}</h3>
            {pick && (
              <strong className="demo-detail-size">
                {formatSize(pick.value)}
              </strong>
            )}
            <p>
              {info?.advice ??
                "Open a folder or choose a location in the report to see its size, context, and a sensible next step."}
            </p>
            {info?.command && (
              <>
                <span className="demo-command-label">Inspect locally</span>
                <code>{info.command}</code>
              </>
            )}
            {selected && info && (
              <div className="demo-detail-actions">
                <button onClick={() => toggle("keep")}>
                  {kept.includes(selected.id) ? "Remove keep rule" : "Keep"}
                </button>
                <button
                  disabled={kept.includes(selected.id)}
                  onClick={() => toggle("shortlist")}
                >
                  {shortlisted.includes(selected.id)
                    ? "Remove from shortlist"
                    : "Add to shortlist"}
                </button>
              </div>
            )}
          </div>
        </aside>
      </div>
      <footer className="demo-status" role="status">
        {notice}
      </footer>
    </div>
  )
}
function HeroChart() {
  const [hovered, setHovered] = useState<ViewEntry | null>(null)
  const explore = () =>
    document.getElementById("demo")?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    })
  return (
    <>
      <Treemap
        root={root}
        colors={colors}
        dark={false}
        onOpen={explore}
        onSelect={explore}
        onContext={explore}
        onHover={setHovered}
        hovered={hovered}
      />
    </>
  )
}
const hero = document.getElementById("hero-chart")
if (hero) createRoot(hero).render(<HeroChart />)
const mount = document.getElementById("viewer-demo")
if (mount) createRoot(mount).render(<Demo />)
