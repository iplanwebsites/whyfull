import type { Tier } from "./types"

export type KnowledgeScope = "user" | "computer"
export type LocationKind = "folder" | "project" | "cache" | "data"

export interface SavedLocation {
  id: string
  name: string
  path: string
  kind: LocationKind
  tier: Tier
  instructions: string
  enabled: boolean
  source: "user" | "agent"
  platform: "darwin" | "linux" | "win32"
  updatedAt: string
}

export interface KnowledgeLayer {
  instructions: string
  locations: SavedLocation[]
}

export interface LocalContext {
  userInstructions: string
  computerInstructions: string
}

export interface KnowledgeView {
  schemaVersion: 1
  revision: number
  file: string
  computer: string
  user: KnowledgeLayer
  computerSettings: KnowledgeLayer
  locations: Array<
    SavedLocation & { scope: KnowledgeScope; resolvedPath: string }
  >
}
