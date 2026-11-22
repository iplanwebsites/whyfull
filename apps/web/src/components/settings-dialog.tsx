import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  BookOpen,
  Code,
  MapPin,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react"
import { useIsMobile } from "@workspace/ui/hooks/use-mobile"
import { Button } from "@workspace/ui/components/button"
import { Switch } from "@workspace/ui/components/switch"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { api, type ViewerStatus } from "@/lib/api"
import { markThemeUnsaved, setTheme, useTheme, type Theme } from "@/lib/theme"
import { viewerIsOffline } from "@/lib/viewer-connection"
import type { SettingsSection } from "@/lib/settings-navigation"
import { KnowledgeSettings } from "./places-dialog"
import { CleanupModeSetting } from "./cleanup-mode-setting"

const sections = [
  {
    id: "general",
    label: "General",
    icon: SlidersHorizontal,
  },
  {
    id: "places",
    label: "Saved places",
    icon: MapPin,
  },
  {
    id: "instructions",
    label: "Instructions",
    icon: BookOpen,
  },
  {
    id: "rules",
    label: "Keep & exclude",
    icon: ShieldCheck,
  },
  {
    id: "advanced",
    label: "Advanced",
    icon: Code,
  },
] as const
const selectClass =
  "h-9 w-full rounded-lg border border-input bg-background px-2 text-sm focus-visible:outline-ring"

export function SettingsDialog({
  open,
  onOpenChange,
  status,
  currentPath,
  section,
  onSectionChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  status: ViewerStatus
  currentPath: string
  section: SettingsSection
  onSectionChange: (section: SettingsSection) => void
}) {
  const isMobile = useIsMobile()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const client = useQueryClient()
  const { theme } = useTheme()
  async function update(path: string, patch: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      await api(path, patch)
      await client.invalidateQueries()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="flex h-[min(640px,90svh)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl"
      >
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            <Settings className="size-4 text-muted-foreground" />
            Settings
          </DialogTitle>
        </DialogHeader>
        <Tabs
          orientation={isMobile ? "horizontal" : "vertical"}
          value={section}
          onValueChange={(value) => {
            onSectionChange(value as SettingsSection)
            setError(null)
          }}
          className="min-h-0 flex-1 flex-col gap-0 md:flex-row"
        >
          <TabsList
            aria-label="Settings sections"
            className="w-full shrink-0 flex-row! justify-start! gap-1 overflow-x-auto rounded-none border-b bg-muted/30 p-2 md:h-full! md:w-48 md:flex-col! md:border-r md:border-b-0 md:p-3"
          >
            {sections.map(({ id, label, icon: Icon }) => (
              <TabsTrigger
                key={id}
                value={id}
                disabled={busy}
                className="h-9 flex-none justify-start px-3 md:w-full"
              >
                <Icon />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-5 sm:p-6">
            {error && (
              <p
                role="alert"
                className="mb-4 rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
              >
                {error}
              </p>
            )}
            {sections.map(({ id }) => (
              <TabsContent
                key={id}
                value={id}
                keepMounted
                className="space-y-5"
              >
                {id === "general" ? (
                  <div className="space-y-6">
                    <label className="block space-y-2 text-sm font-medium">
                      Appearance
                      <select
                        className={selectClass}
                        value={theme}
                        onChange={(e) => {
                          const next = e.target.value as Theme
                          setTheme(next)
                          if (viewerIsOffline()) markThemeUnsaved()
                          else void update("preferences", { theme: next })
                        }}
                      >
                        <option value="system">System</option>
                        <option value="light">Light</option>
                        <option value="dark">Dark</option>
                      </select>
                    </label>
                    <div className="space-y-2 border-t pt-5">
                      <label className="block space-y-2 text-sm font-medium">
                        Scanner for new scans
                        <select
                          className={selectClass}
                          value={status.scanners?.selected ?? "node"}
                          disabled={busy}
                          onChange={(e) =>
                            void update("preferences", {
                              scanner: e.target.value,
                            })
                          }
                        >
                          <option value="node">Node</option>
                          <option
                            value="rust"
                            disabled={!status.scanners?.rust.available}
                          >
                            Rust (experimental)
                          </option>
                        </select>
                      </label>
                      {!status.scanners?.rust.available && (
                        <p className="text-xs text-muted-foreground">
                          {status.scanners?.rust.reason ??
                            "Rust is unavailable in this build."}
                        </p>
                      )}
                    </div>
                    {status.privateFolders?.length > 0 && (
                      <div className="flex items-start justify-between gap-4 border-t pt-5">
                        <div className="space-y-1">
                          <label
                            htmlFor="scan-private-folders"
                            className="block text-sm font-medium"
                          >
                            Scan private folders
                          </label>
                          <p
                            id="scan-private-folders-detail"
                            className="text-xs text-muted-foreground"
                          >
                            Photos, Music, TV, Contacts, Calendars and
                            Reminders. macOS asks permission for each. Applies
                            to new scans.
                          </p>
                        </div>
                        <Switch
                          id="scan-private-folders"
                          aria-describedby="scan-private-folders-detail"
                          checked={status.viewer.scanPrivateFolders}
                          disabled={busy}
                          onCheckedChange={(checked) =>
                            void update("preferences", {
                              scanPrivateFolders: checked,
                            })
                          }
                        />
                      </div>
                    )}
                    {status.source.kind !== "report" && (
                      <CleanupModeSetting
                        status={status}
                        className={selectClass}
                      />
                    )}
                  </div>
                ) : id === "rules" ? (
                  <div className="space-y-6">
                    {(["keep", "exclude"] as const).map((kind) => (
                      <section key={kind} className="space-y-2">
                        <h3 className="text-sm font-medium">
                          {kind === "keep"
                            ? "Protected folders"
                            : "Excluded folders"}
                        </h3>
                        {status.policy[kind].length === 0 && (
                          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                            {kind === "keep"
                              ? "None. Select a folder and choose Keep."
                              : "None. Select a folder and choose Exclude."}
                          </p>
                        )}
                        {status.policy[kind].map((path) => (
                          <div
                            key={path}
                            className="flex items-center gap-3 border-b py-2"
                          >
                            <span className="min-w-0 flex-1 break-all font-mono text-xs">
                              {path}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              aria-label={`Remove ${kind} rule for ${path}`}
                              onClick={() =>
                                void update("policy", { path, action: "clear" })
                              }
                            >
                              Remove
                            </Button>
                          </div>
                        ))}
                      </section>
                    ))}
                    <p className="text-xs text-muted-foreground">
                      Rescan to apply exclusion changes.
                    </p>
                  </div>
                ) : (
                  <KnowledgeSettings section={id} currentPath={currentPath} />
                )}
              </TabsContent>
            ))}
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
