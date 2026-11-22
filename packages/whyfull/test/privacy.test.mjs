import { test } from "node:test"
import assert from "node:assert/strict"
import { privacyPromptPaths, privacyExclusions } from "../dist/index.mjs"

test("macOS scans skip folders that trigger privacy dialogs", () => {
  const home = "/Users/a"
  const paths = privacyPromptPaths("darwin", home)
  assert.ok(paths.includes("/Users/a/Pictures/Photos Library.photoslibrary"))
  assert.ok(paths.includes("/Users/a/Music/Music"))
  assert.deepEqual(privacyPromptPaths("linux", home), [])
  assert.deepEqual(privacyExclusions("/", "darwin", home), paths)
  // Choosing a protected folder as the root is an explicit request to read it.
  assert.ok(
    !privacyExclusions("/Users/a/Music/Music/Media", "darwin", home).includes(
      "/Users/a/Music/Music"
    )
  )
})
