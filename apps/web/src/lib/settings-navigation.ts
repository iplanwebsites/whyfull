export const settingsSections = [
  "general",
  "places",
  "instructions",
  "rules",
  "advanced",
] as const

export type SettingsSection = (typeof settingsSections)[number]

export function parseSettingsSection(
  value: unknown
): SettingsSection | undefined {
  return settingsSections.find((section) => section === value)
}
