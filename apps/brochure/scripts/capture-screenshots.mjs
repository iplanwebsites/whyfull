import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { chromium } from "playwright"
import { startViewer } from "../../../packages/whyfull/dist/index.mjs"
import { createDemoSnapshot } from "../../../scripts/demo-snapshot.mjs"

const { values } = parseArgs({
  options: {
    output: { type: "string" },
    channel: { type: "string" },
    help: { type: "boolean" },
  },
})

if (values.help) {
  console.log(`Usage: pnpm --filter @whyfull/brochure screenshots [options]

  --output <directory>  Output directory (default: public/images)
  --channel <channel>   Use an installed browser, e.g. chrome

One-time browser setup:
  pnpm --filter @whyfull/brochure exec playwright install --only-shell chromium`)
} else {
  await capture()
}

async function capture() {
  const output = values.output
    ? resolve(values.output)
    : fileURLToPath(new URL("../public/images/", import.meta.url))
  const temporary = await mkdtemp(join(tmpdir(), "whyfull-screenshots-"))
  let viewer
  let browser
  try {
    // Match built-in tool locations to the current OS without scanning them.
    // A fresh policy and browser profile keep personal settings out of captures.
    const snapshot = createDemoSnapshot(homedir())
    viewer = await startViewer({
      root: snapshot.root,
      snapshot,
      sourceName: "Example data",
      policyFile: join(temporary, "policy.json"),
      cache: false,
      scanOnStart: false,
      open: false,
      drives: () => [],
    })
    browser = await chromium.launch({
      headless: true,
      ...(values.channel ? { channel: values.channel } : {}),
    })
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
      colorScheme: "light",
      reducedMotion: "reduce",
      locale: "en-US",
      timezoneId: "UTC",
    })
    const base = new URL(viewer.url)
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === base.origin
        ? route.continue()
        : route.abort()
    )
    const page = await context.newPage()
    page.setDefaultTimeout(15_000)
    const errors = []
    page.on("response", (response) => {
      if (!response.ok())
        errors.push(`${response.status()} ${new URL(response.url()).pathname}`)
    })

    async function open(path, view) {
      const url = new URL(base)
      url.searchParams.set("path", path)
      url.searchParams.set("view", view)
      await page.goto(url.href)
    }

    const captures = []
    async function screenshot(name) {
      await page.mouse.move(0, 0)
      await page.evaluate(async () => {
        await document.fonts.ready
        // Let layout effects and canvas resizing finish before capture.
        await new Promise(requestAnimationFrame)
        await new Promise(requestAnimationFrame)
      })
      if (errors.length) throw new Error(errors.join("\n"))
      await page.screenshot({
        path: join(temporary, name),
        type: "jpeg",
        quality: 90,
        fullPage: false,
        animations: "disabled",
        caret: "hide",
        scale: "css",
      })
      captures.push(name)
    }

    await open(snapshot.root, "sunburst")
    await page.getByRole("button", { name: "Code", exact: true }).waitFor()
    await page
      .getByRole("img", {
        name: "Concentric directory rings; use the folder list for keyboard navigation",
      })
      .locator("canvas")
      .waitFor()
    await screenshot("app-overview.jpg")

    await open(join(snapshot.root, "Code"), "treemap")
    await page
      .getByRole("button", { name: "ml-playground", exact: true })
      .waitFor()
    await page
      .getByRole("button", {
        name: /^ml-playground, .*, open folder$/,
      })
      .waitFor()
    await screenshot("app-folders.jpg")

    await page.getByRole("button", { name: "Suggestions", exact: true }).click()
    const report = page.getByRole("dialog")
    await report.getByRole("heading", { name: "Suggestions" }).waitFor()
    await report
      .getByRole("button", { name: "Details for Cargo registry", exact: true })
      .waitFor()
    await report
      .getByRole("button", { name: "Copy for agent", exact: true })
      .waitFor()
    await screenshot("app-cleanup.jpg")

    // A failed capture leaves the previous gallery intact.
    await mkdir(output, { recursive: true })
    for (const name of captures) {
      await copyFile(join(temporary, name), join(output, name))
      console.log(`Captured ${join(output, name)} (1280×720)`)
    }
  } finally {
    // Close the viewer even if the browser failed to launch or capture.
    try {
      await browser?.close()
    } finally {
      try {
        await viewer?.close()
      } finally {
        await rm(temporary, { recursive: true, force: true })
      }
    }
  }
}
