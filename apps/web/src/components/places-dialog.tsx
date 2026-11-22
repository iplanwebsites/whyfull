import { useState } from "react"
import { tierLabel } from "@/lib/tiers"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Check,
  Copy,
  FolderOpen,
  GitPullRequest,
  LoaderCircle,
  MapPin,
  Monitor,
  Pencil,
  Plus,
  Search,
  User,
  X,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { api, hasToken } from "@/lib/api"
import type { ViewerStatus } from "@/lib/api"
import type {
  KnowledgeScope,
  KnowledgeView,
  SavedLocation,
} from "../../../../packages/whyfull/src/knowledge-types"
import { toast } from "@/lib/notifications"

export function useKnowledge() {
  return useQuery({
    queryKey: ["knowledge"],
    queryFn: ({ signal }) => api<KnowledgeView>("knowledge", undefined, signal),
    enabled: hasToken(),
    refetchInterval: 5000,
  })
}
const scopeName = (scope: KnowledgeScope) =>
  scope === "computer" ? "This computer" : "My user profile"
const selectClass =
  "h-9 w-full rounded-lg border border-input bg-background px-2 text-sm focus-visible:outline-ring"
type Editing = {
  scope: KnowledgeScope
  revision: number
  location?: SavedLocation
}

export function PlacesDialog({
  open,
  onOpenChange,
  currentPath,
  onChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentPath: string
  onChanged: (status: ViewerStatus) => Promise<void>
}) {
  const query = useKnowledge()
  const client = useQueryClient()
  const [tab, setTab] = useState<"places" | "instructions">("places")
  const [filter, setFilter] = useState("")
  const [editing, setEditing] = useState<Editing | null>(null)
  const [proposal, setProposal] = useState<SavedLocation | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draftVersion, setDraftVersion] = useState(0)
  const knowledge = query.data
  async function save(patch: Record<string, unknown>) {
    const next = await api<KnowledgeView>("knowledge", patch)
    client.setQueryData(["knowledge"], next)
    await client.invalidateQueries({
      predicate: (query) => query.queryKey[0] !== "knowledge",
    })
    return next
  }
  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  const entries = knowledge
    ? [
        ...knowledge.computerSettings.locations.map((location) => ({
          location,
          scope: "computer" as const,
        })),
        ...knowledge.user.locations.map((location) => ({
          location,
          scope: "user" as const,
        })),
      ].filter(({ location }) =>
        `${location.name} ${location.path} ${location.kind}`
          .toLowerCase()
          .includes(filter.toLowerCase())
      )
    : []
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="size-4 text-muted-foreground" />
            Places & instructions
          </DialogTitle>
          <DialogDescription>
            Teach Whyfull where you work and what to keep in mind. Saved locally
            for you and your agents.
          </DialogDescription>
        </DialogHeader>
        {!knowledge ? (
          <div role="status" className="py-8 text-sm text-muted-foreground">
            {query.error ? (
              <>
                <p>{query.error.message}</p>
                <Button variant="outline" onClick={() => void query.refetch()}>
                  Try again
                </Button>
              </>
            ) : (
              "Loading your places…"
            )}
          </div>
        ) : (
          <>
            {!editing && !proposal && (
              <div
                className="flex gap-1 rounded-xl bg-muted p-1"
                aria-label="Personalization sections"
              >
                <Button
                  className="flex-1"
                  variant={tab === "places" ? "secondary" : "ghost"}
                  aria-pressed={tab === "places"}
                  disabled={busy}
                  onClick={() => {
                    setTab("places")
                    setError(null)
                  }}
                >
                  <MapPin />
                  Saved places{" "}
                  <span className="text-muted-foreground">
                    {knowledge.locations.length}
                  </span>
                </Button>
                <Button
                  className="flex-1"
                  variant={tab === "instructions" ? "secondary" : "ghost"}
                  aria-pressed={tab === "instructions"}
                  disabled={busy}
                  onClick={() => {
                    setTab("instructions")
                    setError(null)
                  }}
                >
                  <BookOpen />
                  Instructions
                </Button>
              </div>
            )}
            {error && (
              <div
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              >
                {error}
                {error.includes("changed elsewhere") && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 block"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await query.refetch({ throwOnError: true })
                        setEditing(null)
                        setProposal(null)
                        setDraftVersion((version) => version + 1)
                      })
                    }
                  >
                    Discard draft & reload saved version
                  </Button>
                )}
              </div>
            )}
            {editing ? (
              <LocationEditor
                key={`${editing.scope}:${editing.location?.id ?? "new"}`}
                editing={editing}
                currentPath={currentPath}
                busy={busy}
                onCancel={() => {
                  setEditing(null)
                  setError(null)
                }}
                onSave={(scope, location) =>
                  void run(async () => {
                    await save({
                      action: "save-location",
                      scope,
                      location,
                      createOnly: !editing.location,
                      revision: editing.revision,
                    })
                    setEditing(null)
                    toast.success(
                      "Place saved. Future scans will include its guidance."
                    )
                  })
                }
              />
            ) : proposal ? (
              <ProposalEditor
                location={proposal}
                busy={busy}
                onBack={() => {
                  setProposal(null)
                  setError(null)
                }}
                onRun={run}
              />
            ) : tab === "instructions" ? (
              <InstructionsEditor
                key={draftVersion}
                knowledge={knowledge}
                busy={busy}
                save={save}
                run={run}
              />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-40 flex-1">
                    <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" />
                    <Input
                      aria-label="Search saved places"
                      placeholder="Find a place…"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      className="pl-8"
                    />
                  </div>
                  <Button
                    disabled={busy}
                    onClick={() => {
                      setEditing({
                        scope: "computer",
                        revision: knowledge.revision,
                      })
                      setError(null)
                    }}
                  >
                    <Plus />
                    Add place
                  </Button>
                </div>
                {entries.length === 0 ? (
                  <div className="rounded-xl border border-dashed px-6 py-10 text-center">
                    <FolderOpen className="mx-auto mb-3 size-7 text-muted-foreground" />
                    <h3 className="font-medium">
                      {filter
                        ? "No places match your search"
                        : "Your regular places, one click away"}
                    </h3>
                    <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                      {filter
                        ? "Try a folder name or path."
                        : "Save a project folder, model library, or cache. Add context once, then use it in the app, terminal, and your agent’s reports."}
                    </p>
                    {!filter && (
                      <Button
                        variant="outline"
                        className="mt-5"
                        onClick={() =>
                          setEditing({
                            scope: "computer",
                            revision: knowledge.revision,
                          })
                        }
                      >
                        <Plus />
                        Save current folder
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {entries.map(({ location, scope }) => {
                      const effective = knowledge.locations.find(
                        (item) => item.id === location.id
                      )
                      const overridden = effective?.scope !== scope
                      return (
                        <article
                          key={`${scope}:${location.id}`}
                          className="rounded-xl border p-4"
                        >
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 rounded-lg bg-muted p-2">
                              <FolderOpen className="size-4 text-muted-foreground" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <h3 className="font-medium">{location.name}</h3>
                              <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                                {location.path}
                              </p>
                            </div>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`Edit ${location.name}`}
                              disabled={busy}
                              onClick={() => {
                                setEditing({
                                  location,
                                  scope,
                                  revision: knowledge.revision,
                                })
                                setError(null)
                              }}
                            >
                              <Pencil />
                            </Button>
                          </div>
                          {location.instructions && (
                            <p className="mt-3 line-clamp-2 whitespace-pre-wrap text-sm text-muted-foreground">
                              {location.instructions}
                            </p>
                          )}
                          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              {scope === "computer" ? (
                                <Monitor className="size-3" />
                              ) : (
                                <User className="size-3" />
                              )}
                              {scopeName(scope)}
                            </span>
                            <span className="capitalize">{location.kind}</span>
                            <span>{location.tier}</span>
                            {location.source === "agent" && (
                              <span>Added by agent</span>
                            )}
                            {(!location.enabled || overridden) && (
                              <span>
                                {overridden
                                  ? "Overridden or for another OS"
                                  : "Paused"}
                              </span>
                            )}
                            <div className="ml-auto flex gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={busy || overridden}
                                onClick={() => {
                                  setProposal(location)
                                  setError(null)
                                }}
                                title="Prepare a public contribution"
                              >
                                <GitPullRequest />
                                Contribute
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={
                                  busy || !location.enabled || overridden
                                }
                                onClick={() =>
                                  void run(async () => {
                                    const status = await api<ViewerStatus>(
                                      "scan-root",
                                      { root: effective!.resolvedPath }
                                    )
                                    await onChanged(status)
                                    onOpenChange(false)
                                  })
                                }
                              >
                                {busy ? (
                                  <LoaderCircle className="animate-spin" />
                                ) : (
                                  <ArrowUpRight />
                                )}
                                Open / scan
                              </Button>
                            </div>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                )}
                <div className="rounded-xl bg-muted/50 p-4 text-xs leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">
                    Agents can add to this too.
                  </span>{" "}
                  Use <code>whyfull locations --help</code> for stable IDs,
                  source labels, and JSON output. Computer entries take priority
                  over user entries with the same ID.
                </div>
              </>
            )}
            {editing?.location && (
              <Button
                variant="ghost"
                className="mr-auto text-destructive"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await save({
                      action: "remove-location",
                      scope: editing.scope,
                      id: editing.location!.id,
                      revision: editing.revision,
                    })
                    setEditing(null)
                    toast.success("Place removed. Its files are unchanged.")
                  })
                }
              >
                <X />
                Remove saved place
              </Button>
            )}
            <p className="break-all text-[11px] text-muted-foreground">
              {knowledge.computer} · {knowledge.file}
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function LocationEditor({
  editing,
  currentPath,
  busy,
  onCancel,
  onSave,
}: {
  editing: Editing
  currentPath: string
  busy: boolean
  onCancel: () => void
  onSave: (scope: KnowledgeScope, value: Record<string, unknown>) => void
}) {
  const initial = editing.location
  const [scope, setScope] = useState(editing.scope)
  const [name, setName] = useState(initial?.name ?? "")
  const [id, setId] = useState(initial?.id ?? "")
  const [path, setPath] = useState(initial?.path ?? currentPath)
  const [kind, setKind] = useState(initial?.kind ?? "folder")
  const [tier, setTier] = useState(initial?.tier ?? "DATA")
  const [instructions, setInstructions] = useState(initial?.instructions ?? "")
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        onSave(scope, {
          id,
          name,
          path,
          kind,
          tier,
          instructions,
          enabled,
          source: initial?.source ?? "user",
        })
      }}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onCancel}
        disabled={busy}
      >
        <ArrowLeft />
        Saved places
      </Button>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5 text-sm font-medium">
          Name
          <Input
            required
            maxLength={160}
            placeholder="Model library"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (
                !initial &&
                (!id ||
                  id ===
                    name
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, "-")
                      .replace(/^-|-$/g, ""))
              )
                setId(
                  e.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-|-$/g, "")
                )
            }}
          />
        </label>
        <label className="space-y-1.5 text-sm font-medium">
          Save for
          <select
            className={selectClass}
            value={scope}
            disabled={!!initial}
            onChange={(e) => setScope(e.target.value as KnowledgeScope)}
          >
            <option value="computer">This computer</option>
            <option value="user">My user profile</option>
          </select>
        </label>
      </div>
      <label className="block space-y-1.5 text-sm font-medium">
        Folder path
        <Input
          required
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="~/Projects"
          maxLength={4096}
          className="font-mono"
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5 text-sm font-medium">
          Kind
          <select
            className={selectClass}
            value={kind}
            onChange={(e) => setKind(e.target.value as SavedLocation["kind"])}
          >
            <option value="folder">Folder</option>
            <option value="project">Projects / worktrees</option>
            <option value="cache">Cache</option>
            <option value="data">Personal data / models</option>
          </select>
        </label>
        <label className="space-y-1.5 text-sm font-medium">
          Cleanup guidance
          <select
            className={selectClass}
            value={tier}
            onChange={(e) => setTier(e.target.value as SavedLocation["tier"])}
          >
            {["DATA", "JUDGEMENT", "REBUILD", "APP", "AUTO"].map((value) => (
              <option key={value} value={value}>
                {tierLabel(value)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block space-y-1.5 text-sm font-medium">
        Instructions for this place
        <Textarea
          rows={4}
          maxLength={12000}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Keep active models. Check the owning app before removing downloads."
        />
      </label>
      <p className="text-xs text-muted-foreground">
        Guidance appears in scan suggestions. To protect files from cleanup or
        skip scanning them, use Keep & exclude rules.
      </p>
      <label className="block space-y-1.5 text-sm font-medium">
        Stable ID
        <Input
          required
          pattern="[a-z0-9][a-z0-9-]*"
          maxLength={80}
          disabled={!!initial}
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="model-library"
        />
        <span className="text-xs font-normal text-muted-foreground">
          Agents use this ID to update the same place.
        </span>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Include in scans and the location menu
      </label>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button disabled={busy}>
          {busy ? <LoaderCircle className="animate-spin" /> : <Check />}Save
          place
        </Button>
      </div>
    </form>
  )
}

function InstructionsEditor({
  knowledge,
  busy,
  save,
  run,
}: {
  knowledge: KnowledgeView
  busy: boolean
  save: (patch: Record<string, unknown>) => Promise<KnowledgeView>
  run: (action: () => Promise<unknown>) => Promise<void>
}) {
  const [scope, setScope] = useState<KnowledgeScope>("computer")
  const [drafts, setDrafts] = useState({
    user: knowledge.user.instructions,
    computer: knowledge.computerSettings.instructions,
  })
  const [revision, setRevision] = useState(knowledge.revision)
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        void run(async () => {
          const next = await save({
            action: "instructions",
            scope,
            instructions: drafts[scope],
            revision,
          })
          setRevision(next.revision)
          toast.success("Instructions saved")
        })
      }}
    >
      <label className="block space-y-1.5 text-sm font-medium">
        Instructions for
        <select
          className={selectClass}
          value={scope}
          onChange={(e) => setScope(e.target.value as KnowledgeScope)}
        >
          <option value="computer">This computer · {knowledge.computer}</option>
          <option value="user">My user profile</option>
        </select>
      </label>
      <label className="block space-y-2 text-sm font-medium">
        What should Whyfull and your agent know?
        <Textarea
          rows={7}
          maxLength={24000}
          value={drafts[scope]}
          onChange={(e) => setDrafts({ ...drafts, [scope]: e.target.value })}
          placeholder={
            scope === "computer"
              ? "This is my work laptop. Keep models needed offline. Check for active builds before clearing project caches."
              : "Prefer the owning app’s cleanup commands. Explain download and rebuild costs before suggesting cleanup."
          }
        />
      </label>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Both scopes are included in local opportunity reports. Use computer
        instructions for exceptions to your general preferences. These notes
        guide review; they do not execute commands or change Keep & exclude
        rules.
      </p>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          Private by default · never included in contribution drafts
        </span>
        <Button disabled={busy}>
          {busy ? <LoaderCircle className="animate-spin" /> : <Check />}Save
          instructions
        </Button>
      </div>
    </form>
  )
}

function ProposalEditor({
  location,
  busy,
  onBack,
  onRun,
}: {
  location: SavedLocation
  busy: boolean
  onBack: () => void
  onRun: (action: () => Promise<unknown>) => Promise<void>
}) {
  const [name, setName] = useState("")
  const [publicId, setPublicId] = useState("")
  const [path, setPath] = useState("")
  const [hint, setHint] = useState("")
  const [preview, setPreview] = useState("")
  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} disabled={busy}>
        <ArrowLeft />
        Saved places
      </Button>
      <div>
        <h3 className="font-medium">Share a useful location</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Prepare a draft for a public pull request. Enter general guidance and
          a portable path. Review the ID and every public field before sharing;
          names within a ~/ path can still be personal.
        </p>
      </div>
      <form
        className="space-y-4"
        onChange={() => setPreview("")}
        onSubmit={(e) => {
          e.preventDefault()
          void onRun(async () => {
            const result = await api("knowledge/proposal", {
              id: location.id,
              publicId,
              name,
              path,
              hint,
            })
            setPreview(JSON.stringify(result, null, 2))
          })
        }}
      >
        <label className="block space-y-1.5 text-sm font-medium">
          Public ID
          <Input
            required
            value={publicId}
            onChange={(e) => setPublicId(e.target.value)}
            placeholder="example-tool-cache"
            pattern="[a-z0-9][a-z0-9-]*"
            maxLength={80}
          />
          <span className="text-xs font-normal text-muted-foreground">
            Choose a general name. Your saved place’s ID stays private.
          </span>
        </label>
        <label className="block space-y-1.5 text-sm font-medium">
          Public name
          <Input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Example tool cache"
            maxLength={160}
          />
        </label>
        <label className="block space-y-1.5 text-sm font-medium">
          Portable path
          <Input
            required
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="~/.cache/example-tool"
            maxLength={1024}
            className="font-mono"
          />
        </label>
        <label className="block space-y-1.5 text-sm font-medium">
          Public cleanup guidance
          <Textarea
            required
            rows={4}
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            maxLength={4000}
            placeholder="Explain what creates this data, how to inspect it, and the cost of rebuilding it."
          />
        </label>
        <Button disabled={busy}>
          <GitPullRequest />
          Preview contribution
        </Button>
      </form>
      {preview && (
        <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
          <p className="text-xs text-muted-foreground">
            Draft only · {location.platform} · starts at “Needs judgment” · no
            private instructions
          </p>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all text-xs">
            {preview}
          </pre>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              onClick={() =>
                void onRun(async () => {
                  await navigator.clipboard.writeText(preview)
                  toast.success("Contribution draft copied")
                })
              }
            >
              <Copy />
              Copy JSON
            </Button>
            <a
              className="text-sm underline underline-offset-4"
              href="https://github.com/iplanwebsites/whyfull/blob/main/docs/personalization.md"
              target="_blank"
              rel="noreferrer"
            >
              Contribution guide ↗
            </a>
          </div>
          <p className="text-xs text-muted-foreground">
            Add the target to packages/whyfull/src/community-locations.json in
            your fork, then open a pull request.
          </p>
        </div>
      )}
    </div>
  )
}
