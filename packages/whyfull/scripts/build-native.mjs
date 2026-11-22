// Optional prebuilt helper. Building the Node package never requires Cargo.
import { access, chmod, copyFile, mkdir, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { join, resolve } from "node:path"
if (["darwin", "linux"].includes(process.platform)) {
  const helper = process.env.WHYFULL_RUST_CRAWLER
    ? resolve(process.env.WHYFULL_RUST_CRAWLER)
    : fileURLToPath(
        new URL(
          "../../../experiments/disk-crawler/target/release/whyfull-crawler-spike",
          import.meta.url
        )
      )
  let available = true
  try {
    await access(helper)
  } catch {
    available = false
  }
  if (available) {
    const directory = fileURLToPath(new URL("../dist/native/", import.meta.url))
    await mkdir(directory, { recursive: true })
    await copyFile(helper, join(directory, "whyfull-crawler"))
    await chmod(join(directory, "whyfull-crawler"), 0o755)
    await writeFile(
      join(directory, "platform.json"),
      JSON.stringify({ platform: process.platform, arch: process.arch })
    )
    console.log("Packaged the optional experimental Rust scanner.")
  }
}
