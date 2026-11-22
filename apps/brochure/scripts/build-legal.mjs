// Generates legal/index.html from the repository's EULA.md, LICENSE,
// PRIVACY.md and TRADEMARKS.md. The Markdown is the single source of truth;
// the generated page is committed because it is a Vite input.
//
//   node scripts/build-legal.mjs          write legal/index.html
//   node scripts/build-legal.mjs --check  fail if legal/index.html is stale
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import * as prettier from "prettier"

const defaultRoot = fileURLToPath(new URL("../../../", import.meta.url))
export const outputPath = fileURLToPath(
  new URL("../legal/index.html", import.meta.url)
)

// A placeholder is an uppercase token in square brackets, such as
// [CONTACT EMAIL] or [LEGAL ENTITY / ADDRESS]. "[BRACKETS]" is how LICENSE
// refers to placeholders in general, so it is not one itself.
const placeholderPattern = /\[[A-Z][A-Z0-9 /&.,_-]*\](?!\()/g
const ignoredPlaceholders = new Set(["[BRACKETS]"])

/** @param {string} text */
export function findPlaceholders(text) {
  return [...new Set(text.match(placeholderPattern) ?? [])].filter(
    (token) => !ignoredPlaceholders.has(token)
  )
}

/** @param {string} text */
function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** @param {string} text */
function escapeAttribute(text) {
  return escapeHtml(text).replace(/"/g, "&quot;")
}

/** @param {string} text */
export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/** @param {string} url */
function renderUrl(url) {
  const own = /^https:\/\/whyfull\.app(\/[^\s]*)$/.exec(url)
  if (own)
    return `<a href="${escapeAttribute(own[1])}">whyfull.app${escapeHtml(own[1])}</a>`
  return `<a href="${escapeAttribute(url)}">${escapeHtml(url)}</a>`
}

/**
 * Inline Markdown: `code`, **bold**, _italic_ / *italic*, [links](url) and
 * bare URLs. Links to https://whyfull.app become site-relative.
 * @param {string} text
 */
export function renderInline(text) {
  return text
    .split(/(`[^`]+`)/)
    .map((part) => {
      if (part.startsWith("`") && part.endsWith("`") && part.length > 1)
        return `<code>${escapeHtml(part.slice(1, -1))}</code>`
      /** @type {string[]} */
      const links = []
      const stash = (/** @type {string} */ html) => {
        links.push(html)
        return `\u0000${links.length - 1}\u0000`
      }
      let html = part
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) =>
          stash(`<a href="${escapeAttribute(url)}">${renderInline(label)}</a>`)
        )
        .replace(/https?:\/\/[^\s<>)]+/g, (match) => {
          const url = match.replace(/[.,;:!?]+$/, "")
          return stash(renderUrl(url)) + match.slice(url.length)
        })
      html = escapeHtml(html)
        .replace(/(\w)'(\w)/g, "$1’$2")
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[^\w*])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<em>$2</em>")
        .replace(/(^|[^\w])_([^_\s][^_]*?)_(?!\w)/g, "$1<em>$2</em>")
      return html.replace(/\u0000(\d+)\u0000/g, (_, index) => links[index])
    })
    .join("")
}

/**
 * Splits Markdown into blocks: headings, paragraphs, lists, tables and
 * blockquotes. Only the subset used by the legal documents is supported.
 * @param {string} markdown
 */
export function parseBlocks(markdown) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n")
  /** @type {Array<Record<string, any>>} */
  const blocks = []
  let index = 0
  const isBlank = (/** @type {string} */ line) => line.trim() === ""
  const listItem = /^(\s*)([-*]|\d+\.)\s+(.*)$/
  while (index < lines.length) {
    const line = lines[index]
    if (isBlank(line)) {
      index++
      continue
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*$/.exec(line)
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length,
        text: heading[2],
      })
      index++
      continue
    }
    if (line.startsWith(">")) {
      const quoted = []
      while (index < lines.length && lines[index].startsWith(">"))
        quoted.push(lines[index++].replace(/^>\s?/, ""))
      blocks.push({
        type: "blockquote",
        blocks: parseBlocks(quoted.join("\n")),
      })
      continue
    }
    if (line.trimStart().startsWith("|")) {
      const rows = []
      while (index < lines.length && lines[index].trimStart().startsWith("|"))
        rows.push(lines[index++])
      const cells = (/** @type {string} */ row) =>
        row
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((cell) => cell.trim())
      const [head, separator, ...body] = rows
      if (!separator || !/^[\s|:-]+$/.test(separator))
        throw new Error(`Unsupported table near: ${head}`)
      blocks.push({ type: "table", head: cells(head), rows: body.map(cells) })
      continue
    }
    const firstItem = listItem.exec(line)
    if (firstItem) {
      const ordered = /\d/.test(firstItem[2])
      const items = []
      while (index < lines.length) {
        const item = listItem.exec(lines[index])
        if (item && item[1] === "") {
          if (/\d/.test(item[2]) !== ordered) break
          items.push([item[3]])
          index++
        } else if (!isBlank(lines[index]) && /^\s+\S/.test(lines[index])) {
          if (listItem.exec(lines[index]))
            throw new Error(`Nested lists are not supported: ${lines[index]}`)
          items[items.length - 1].push(lines[index++].trim())
        } else break
      }
      blocks.push({
        type: "list",
        ordered,
        items: items.map((i) => i.join(" ")),
      })
      continue
    }
    const paragraph = []
    while (
      index < lines.length &&
      !isBlank(lines[index]) &&
      !/^(#{1,6}\s|>|\s*\|)/.test(lines[index]) &&
      !listItem.test(lines[index])
    )
      paragraph.push(lines[index++].trim())
    blocks.push({ type: "paragraph", text: paragraph.join(" ") })
  }
  return blocks
}

/**
 * Renders a Markdown document as the body of a legal section. Its "# Title",
 * "Version …" line and "**Draft…**" blockquote are returned separately: the
 * page shows them in the section header and the draft banner instead.
 * @param {string} markdown
 * @param {string} prefix heading id prefix, such as "eula"
 */
export function renderDocument(markdown, prefix) {
  let title = ""
  let version = ""
  const html = []
  /** @type {Set<string>} */
  const ids = new Set()
  /** @param {Record<string, any>} block */
  const render = (block) => {
    switch (block.type) {
      case "heading": {
        const base = `${prefix}-${slugify(block.text)}`
        let id = base
        for (let n = 2; ids.has(id); n++) id = `${base}-${n}`
        ids.add(id)
        // Section 1 headings become <h3>, subsections <h4>.
        const level = Math.min(block.level + 1, 6)
        const anchor =
          prefix === "eula" && /^\d+\.\s+Contact$/.test(block.text)
            ? '<span id="contact"></span>'
            : ""
        return `<h${level} id="${id}">${anchor}${renderInline(block.text)}</h${level}>`
      }
      case "paragraph":
        return `<p>${renderInline(block.text)}</p>`
      case "list": {
        const tag = block.ordered ? "ol" : "ul"
        const items = block.items
          .map((/** @type {string} */ item) => `<li>${renderInline(item)}</li>`)
          .join("\n")
        return `<${tag}>\n${items}\n</${tag}>`
      }
      case "table": {
        const row = (
          /** @type {string[]} */ cells,
          /** @type {string} */ tag
        ) =>
          `<tr>${cells.map((cell) => `<${tag}>${renderInline(cell)}</${tag}>`).join("")}</tr>`
        return [
          "<table>",
          `<thead>${row(block.head, "th")}</thead>`,
          `<tbody>${block.rows.map((/** @type {string[]} */ r) => row(r, "td")).join("\n")}</tbody>`,
          "</table>",
        ].join("\n")
      }
      case "blockquote":
        return `<blockquote>\n${block.blocks.map(render).join("\n")}\n</blockquote>`
      default:
        throw new Error(`Unknown block type ${block.type}`)
    }
  }
  for (const block of parseBlocks(markdown)) {
    if (block.type === "heading" && block.level === 1 && !title) {
      title = block.text.replace(/^Whyfull\s+/, "")
      continue
    }
    if (
      block.type === "paragraph" &&
      /^Version\s/.test(block.text) &&
      !version
    ) {
      version = block.text
      continue
    }
    if (
      block.type === "blockquote" &&
      block.blocks[0]?.type === "paragraph" &&
      block.blocks[0].text.startsWith("**Draft")
    )
      continue
    html.push(render(block))
  }
  return { title, version, html: html.join("\n"), ids: [...ids] }
}

const description =
  "Whyfull's end user license agreement, source-available license, privacy notice and trademark policy. The CLI is free; the desktop app is $19 once after a 30-day evaluation."
const pageTitle = "Legal — Whyfull EULA, source license, privacy and trademarks"

/**
 * @param {string} id
 * @param {{ title: string, version: string, html: string }} doc
 */
function section(id, doc) {
  const eyebrow = doc.version
    ? `<p class="wf-legal-eyebrow">${renderInline(doc.version)}</p>`
    : ""
  return `<section id="${id}" class="wf-home-section wf-legal-doc" aria-labelledby="${id}-title">
${eyebrow}
<h2 id="${id}-title">${escapeHtml(doc.title)}</h2>
${doc.html}
</section>`
}

/**
 * Builds the formatted page from the four documents under `root`.
 * @param {{ root?: string }} [options]
 */
export async function buildLegalPage({ root = defaultRoot } = {}) {
  const read = (/** @type {string} */ name) =>
    readFile(join(root, name), "utf8")
  const [eulaMd, license, privacyMd, trademarksMd] = await Promise.all(
    ["EULA.md", "LICENSE", "PRIVACY.md", "TRADEMARKS.md"].map(read)
  )
  const eula = renderDocument(eulaMd, "eula")
  const privacy = renderDocument(privacyMd, "privacy")
  const trademarks = renderDocument(trademarksMd, "trademarks")
  const licenseVersion = /^Version\s+\S+/m.exec(license)?.[0] ?? "Version 1.0"
  const placeholders = findPlaceholders(
    [eulaMd, license, privacyMd, trademarksMd].join("\n")
  )
  const banner = placeholders.length
    ? `<p class="wf-legal-callout"><strong>Draft.</strong> These documents are awaiting review by a lawyer before launch; text in [BRACKETS] will be filled in then.</p>`
    : ""

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="theme-color" content="#faf9f2" />
<title>${pageTitle}</title>
<meta name="description" content="${escapeAttribute(description)}" />
<link rel="canonical" href="https://whyfull.app/legal/" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<meta property="og:title" content="${pageTitle}" />
<meta property="og:type" content="website" />
<meta property="og:url" content="https://whyfull.app/legal/" />
<meta property="og:description" content="${escapeAttribute(description)}" />
<meta property="og:site_name" content="Whyfull" />
<meta property="og:locale" content="en_US" />
<meta name="robots" content="index, follow" />
<meta name="twitter:card" content="summary" />
<meta name="twitter:title" content="${pageTitle}" />
<meta name="twitter:description" content="${escapeAttribute(description)}" />
<link rel="stylesheet" href="/src/style.css" />
<link rel="stylesheet" href="/src/legal.css" />
</head>
<body>
<!-- Generated by scripts/build-legal.mjs from EULA.md, LICENSE, PRIVACY.md and TRADEMARKS.md. Do not edit by hand. -->
<div class="wf-home wf-legal">
<a class="wf-home-skip" href="#main">Skip to content</a>
<header class="wf-home-nav">
<a class="wf-home-wordmark" href="/" aria-label="Whyfull home">whyfull<span class="wf-home-dot">.</span></a>
<nav aria-label="Main navigation"><a href="https://github.com/iplanwebsites/whyfull">Source</a><a href="https://github.com/iplanwebsites/whyfull#readme">Docs</a><a href="/download/">Download</a></nav>
</header>
<main id="main">
<section class="wf-legal-hero" aria-labelledby="legal-title">
<p class="wf-legal-eyebrow">Legal</p>
<h1 id="legal-title">The fine print.<br /><em>Plainly put.</em></h1>
<p class="wf-home-summary">The command line is free for personal and commercial use. The desktop app is free to evaluate for 30 days of use, then $19 once. Whyfull's source is public so you can see exactly what it does.</p>
${banner}
<nav class="wf-legal-toc" aria-label="On this page"><a href="#eula">End user license</a><a href="#source-license">Source license</a><a href="#privacy">Privacy</a><a href="#trademarks">Trademarks</a></nav>
</section>
${section("eula", eula)}
<section id="source-license" class="wf-home-section wf-legal-doc" aria-labelledby="source-license-title">
<p class="wf-legal-eyebrow">${escapeHtml(licenseVersion)} · The <code>LICENSE</code> file</p>
<h2 id="source-license-title">Source-Available License</h2>
<p>Whyfull's source is public for transparency and auditing. It is <strong>not open source</strong>, and it will not become open source later. In short:</p>
<ul>
<li><strong>You may</strong> read the code, review it for security and privacy, quote it in bug reports, and contribute under the <a href="https://github.com/iplanwebsites/whyfull/blob/main/CONTRIBUTING.md">Contributor License Agreement</a>.</li>
<li><strong>You may not</strong> copy, modify, redistribute or sublicense it, create derivative works, or reuse its code, location catalog or documentation in other products.</li>
<li><strong>Using Whyfull</strong> is covered by the <a href="#eula">End User License Agreement</a>, not by the source license.</li>
<li><strong>Earlier releases</strong> (npm <code>whyfull</code> 0.0.1 and 0.0.2, desktop 0.0.1 and the git history before the relicensing commit) remain under the Apache License 2.0, as they were published.</li>
</ul>
<details class="wf-legal-full">
<summary>Read the full license text</summary>
<pre class="wf-legal-code">
${escapeHtml(license.replace(/\r\n?/g, "\n").trimEnd())}</pre>
</details>
</section>
${section("privacy", privacy)}
${section("trademarks", trademarks)}
</main>
<footer class="wf-home-footer">
<a class="wf-home-wordmark" href="/">whyfull.</a>
<p>Source available · © 2026 Felix Menard · Make room for what’s next.</p>
<nav aria-label="Footer navigation"><a href="https://github.com/iplanwebsites/whyfull">GitHub ↗</a><a href="https://www.npmjs.com/package/whyfull">npm ↗</a></nav>
</footer>
</div>
</body>
</html>
`
  const config = (await prettier.resolveConfig(outputPath)) ?? {}
  return prettier.format(html, { ...config, parser: "html" })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check")
  const generated = await buildLegalPage()
  if (check) {
    const current = await readFile(outputPath, "utf8").catch(() => "")
    if (current !== generated) {
      console.error(
        "legal/index.html is out of date with EULA.md, LICENSE, PRIVACY.md or TRADEMARKS.md.\n" +
          "Run `pnpm --filter @whyfull/brochure legal` and commit the result."
      )
      process.exit(1)
    }
    console.log("legal/index.html is up to date.")
  } else {
    await writeFile(outputPath, generated)
    console.log(`Wrote ${outputPath}`)
  }
}
