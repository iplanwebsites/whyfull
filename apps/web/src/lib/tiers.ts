/**
 * Display names for report tiers. Machine identifiers (AUTO, JUDGEMENT, …)
 * stay unchanged in JSON; only what the viewer shows is normalized here.
 */
export const TIER_ORDER = ["AUTO", "REBUILD", "APP", "JUDGEMENT", "DATA"]

const TIERS: Record<string, { label: string; note: string }> = {
  AUTO: {
    label: "Regenerates automatically",
    note: "Safe to remove. Rebuilt on next use, at the cost of a re-download.",
  },
  REBUILD: {
    label: "Rebuildable",
    note: "Safe to remove. Costs CPU time to regenerate; no data is lost.",
  },
  APP: {
    label: "App-managed",
    note: "Quit the owning app first, or it rewrites the cache immediately.",
  },
  JUDGEMENT: {
    label: "Needs judgment",
    note: "Removable, but potentially slow or expensive to restore. Decide per item.",
  },
  DATA: {
    label: "Real data",
    note: "May be the only copy. Do not bulk-delete; prune from inside the app after a backup.",
  },
}

export function tierLabel(tier: string | null | undefined): string {
  if (!tier) return ""
  return TIERS[tier]?.label ?? tier
}

export function tierNote(tier: string | null | undefined): string | undefined {
  return tier ? TIERS[tier]?.note : undefined
}
