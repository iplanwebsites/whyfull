// Private parent/child protocol. Never emit the bearer URL to application logs.
import { homedir } from "node:os"
import { startViewer } from "./engine/index.mjs"
const viewer = await startViewer({ root: homedir(), open: false })
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
