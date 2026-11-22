import { useState } from "react"
import { tierLabel } from "@/lib/tiers"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeft,
  Check,
  Copy,
  FolderOpen,
  GitPullRequest,
  LoaderCircle,
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
import { api, hasToken } from "@/lib/api"
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

export function KnowledgeSettings({
  section,
  currentPath,
}: {
  section: "places" | "instructions" | "advanced"
  currentPath: string
}) {
  const query = useKnowledge()
  const client = useQueryClient()
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
    <div className="space-y-4">
      {!knowledge ? (
        <div role="status" className="py-8 text-sm text-muted-foreground">
          {query.error ? (
            <>
              <p>Couldn’t load places. {query.error.message}</p>
              <Button
                variant="outline"
                className="mt-3"
                onClick={() => void query.refetch()}
              >
                Try again
              </Button>
            </>
          ) : (
            "Loading settings…"
          )}
        </div>
      ) : (
        <>
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
                  Discard draft and reload
                </Button>
              )}
            </div>
          )}
          {section === "advanced" ? (
            <div className="space-y-5 text-sm">
              <code className="block rounded-lg border bg-muted/40 p-3">
                whyfull locations --help
              </code>
              <dl className="space-y-4">
                <div>
                  <dt className="text-muted-foreground">Computer</dt>
                  <dd className="mt-1 break-all">{knowledge.computer}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Config file</dt>
                  <dd className="mt-1 break-all font-mono text-xs">
                    {knowledge.file}
                  </dd>
                </div>
              </dl>
            </div>
          ) : editing ? (
            <LocationEditor
              key={`${editing.scope}:${editing.location?.id ?? "new"}`}
              editing={editing}
              currentPath={currentPath}
              busy={busy}
              onContribute={
                editing.location &&
                knowledge.locations.some(
                  (item) =>
                    item.id === editing.location!.id &&
                    item.scope === editing.scope
                )
                  ? () => {
                      setProposal(editing.location!)
                      setEditing(null)
                      setError(null)
                    }
                  : undefined
              }
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
                  toast.success("Place saved")
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
          ) : section === "instructions" ? (
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
                    {filter ? "No matching places" : "No saved places"}
                  </h3>
                  {filter ? (
                    <Button
                      variant="outline"
                      className="mt-5"
                      onClick={() => setFilter("")}
                    >
                      Clear search
                    </Button>
                  ) : (
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
                          <span>{tierLabel(location.tier)}</span>
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
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}
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
        </>
      )}
    </div>
  )
}

function LocationEditor({
  editing,
  currentPath,
  busy,
  onCancel,
  onContribute,
  onSave,
}: {
  editing: Editing
  currentPath: string
  busy: boolean
  onCancel: () => void
  onContribute?: () => void
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
        Instructions
        <Textarea
          rows={4}
          maxLength={12000}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Keep active models."
        />
      </label>
      <details className="rounded-lg border p-3">
        <summary className="cursor-pointer text-sm font-medium">
          Advanced
        </summary>
        <label className="mt-3 block space-y-1.5 text-sm font-medium">
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
        </label>
        {onContribute && (
          <Button
            className="mt-3"
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onContribute}
          >
            <GitPullRequest />
            Contribute publicly…
          </Button>
        )}
      </details>
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
        Apply to
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
        Instructions
        <Textarea
          rows={7}
          maxLength={24000}
          value={drafts[scope]}
          onChange={(e) => setDrafts({ ...drafts, [scope]: e.target.value })}
          placeholder={
            scope === "computer"
              ? "Keep models needed offline."
              : "Explain rebuild costs before cleanup."
          }
        />
      </label>
      <div className="flex justify-end">
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
        <h3 className="font-medium">Public contribution</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Everything here becomes public. Remove personal details, including
          from paths.
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
            Your saved ID stays private.
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
            placeholder="What creates this data? What does rebuilding cost?"
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
            Draft · {location.platform} · Needs judgment
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
            Next: add it to community-locations.json in your fork and open a
            pull request.
          </p>
        </div>
      )}
    </div>
  )
}
