import { homedir } from "node:os"
import { join } from "node:path"
import { pathWithin, policyPath } from "./disk-policy"

/**
 * macOS asks the user before an app reads these folders (Photos, Apple Music,
 * Contacts, Calendars, Reminders). A disk scan must never trigger those
 * dialogs, so scans skip them unless the user picks one as the scan root.
 */
export function privacyPromptPaths(
  platform: NodeJS.Platform = process.platform,
  home = homedir()
): string[] {
  if (platform !== "darwin") return []
  return [
    "Pictures/Photos Library.photoslibrary",
    "Library/Photos",
    "Music/Music",
    "Music/iTunes",
    "Movies/TV",
    "Library/Application Support/AddressBook",
    "Library/Calendars",
    "Library/Reminders",
    "Library/Group Containers/group.com.apple.reminders",
  ].map((path) => join(home, path))
}

/** Prompting folders below the scan root; a root inside one scans normally. */
export function privacyExclusions(
  root: string,
  platform: NodeJS.Platform = process.platform,
  home = homedir()
): string[] {
  const scanRoot = policyPath(root)
  return privacyPromptPaths(platform, home).filter(
    (path) => !pathWithin(scanRoot, path)
  )
}

export const PRIVACY_REASON = "Private macOS data; not scanned"
