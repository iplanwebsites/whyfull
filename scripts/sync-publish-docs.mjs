#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const write = process.argv.includes("--write")
const documents = ["README.md", "LICENSE", "NOTICE"]

let drifted = false

for (const document of documents) {
  const sourcePath = resolve(root, document)
  const packagePath = resolve(root, "packages/whyfull", document)
  const source = await readFile(sourcePath)

  if (write) {
    await writeFile(packagePath, source)
    process.stdout.write(`synced packages/whyfull/${document}\n`)
    continue
  }

  let packaged
  try {
    packaged = await readFile(packagePath)
  } catch {
    drifted = true
    process.stderr.write(`missing packages/whyfull/${document}\n`)
    continue
  }

  if (!source.equals(packaged)) {
    drifted = true
    process.stderr.write(
      `packages/whyfull/${document} differs from the root ${document}\n`
    )
  }
}

if (drifted) {
  process.stderr.write("Run `pnpm docs:sync` and commit the mirrored files.\n")
  process.exitCode = 1
} else if (!write) {
  process.stdout.write("publish docs are in sync\n")
}
