import { execFile } from "node:child_process"

/** Opens a fixed https URL in the default browser. */
export async function openExternalUrl(target: string): Promise<void> {
  if (!/^https:\/\/[\w./-]+$/.test(target)) throw new Error("Invalid URL")
  const [command, args] =
    process.platform === "darwin"
      ? ["/usr/bin/open", [target]]
      : process.platform === "win32"
        ? ["rundll32.exe", ["url.dll,FileProtocolHandler", target]]
        : ["xdg-open", [target]]
  await new Promise<void>((resolve, reject) =>
    execFile(command, args, { timeout: 15000 }, (error) =>
      error ? reject(new Error("Could not open your browser")) : resolve()
    )
  )
}
