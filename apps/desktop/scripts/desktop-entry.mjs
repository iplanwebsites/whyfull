// Private parent/child protocol. Never emit the bearer URL to application logs.
import { homedir } from "node:os"
import { ScanCache, startViewer } from "./engine/index.mjs"
const latestRoot = await ScanCache.forConfig().latestRoot()
const viewer = await startViewer({
  root: latestRoot ?? homedir(),
  scanOnStart: true,
  open: false,
  // Honor-system reminder after the trial. npx and the CLI never enable it.
  license: {},
})
process.stdout.write(JSON.stringify({ url: viewer.url }) + "\n")
let closing = false
async function close() {
  if (closing) return
  closing = true
  await viewer.close()
  process.exit(0)
}
// A pipe owned by the Rust parent gives us cleanup even if the parent crashes.
process.stdin.resume()
process.stdin.on("end", () => void close())
process.once("SIGINT", () => void close())
process.once("SIGTERM", () => void close())
