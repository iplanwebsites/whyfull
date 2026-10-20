import { copyFile, mkdir } from "node:fs/promises"
// Serve the installable skill from the repository's canonical source.
const skillDirectory = new URL("../public/skills/whyfull/", import.meta.url)
await mkdir(skillDirectory, { recursive: true })
await copyFile(
  new URL("../../../skills/whyfull/SKILL.md", import.meta.url),
  new URL("SKILL.md", skillDirectory)
)
