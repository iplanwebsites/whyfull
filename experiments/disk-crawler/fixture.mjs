// Reproducible directory-heavy + wide-directory workload, mostly empty files
// to exercise metadata without consuming hundreds of MiB of fixture contents.
import {
  mkdirSync,
  writeFileSync,
  linkSync,
  symlinkSync,
  truncateSync,
} from "node:fs"
import { join, resolve } from "node:path"
const root = resolve(process.argv[2] ?? "")
const directories = Number(process.argv[3] ?? 20000)
if (!process.argv[2] || !Number.isInteger(directories) || directories < 1)
  throw new Error(
    "Usage: node experiments/disk-crawler/fixture.mjs NEW_ROOT [DIRECTORIES=20000]"
  )
mkdirSync(root, { mode: 0o700 })
for (let i = 0; i < directories; i++) {
  const dir = join(root, `d-${i}`)
  mkdirSync(dir)
  for (let j = 0; j < 8; j++)
    writeFileSync(
      join(dir, `f-${j}`),
      i % 256 === 0 && j === 0 ? "allocated" : ""
    )
}
mkdirSync(join(root, "wide"))
for (let i = 0; i < directories; i++) {
  writeFileSync(join(root, "wide", `f-${i}`), "")
  if (i % 2 === 0)
    linkSync(join(root, "d-0/f-0"), join(root, "wide", `link-${i}`))
}
writeFileSync(join(root, "sparse"), "sparse")
truncateSync(join(root, "sparse"), 1024 ** 3)
symlinkSync(root, join(root, "cycle"))
console.log(
  JSON.stringify({
    root,
    directories: directories + 2,
    files: directories * 9 + Math.ceil(directories / 2) + 1,
  })
)
