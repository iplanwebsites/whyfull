// Generates legal/index.html from the repository's EULA.md, LICENSE,
// PRIVACY.md and TRADEMARKS.md, and the French page legal/fr/index.html from
// EULA.fr.md and PRIVACY.fr.md. The Markdown is the single source of truth;
// the generated pages are committed because they are Vite inputs.
//
//   node scripts/build-legal.mjs          write both pages
//   node scripts/build-legal.mjs --check  fail if either page is stale
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import * as prettier from "prettier"

const defaultRoot = fileURLToPath(new URL("../../../", import.meta.url))
export const outputPath = fileURLToPath(
  new URL("../legal/index.html", import.meta.url)
)
export const frenchOutputPath = fileURLToPath(
  new URL("../legal/fr/index.html", import.meta.url)
)
/** Every source document; a placeholder in any of them keeps both banners. */
export const sourceDocuments = [
  "EULA.md",
  "LICENSE",
  "PRIVACY.md",
  "TRADEMARKS.md",
  "EULA.fr.md",
  "PRIVACY.fr.md",
]

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
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
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
 * French typography: a non-breaking space before a colon and inside « ».
 * @param {string} html rendered inline HTML
 */
function frenchSpacing(html) {
  return html.replace(/ ([:»])/g, "&nbsp;$1").replace(/« /g, "«&nbsp;")
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
 * page shows them in the section header and the draft banner instead (the
 * French documents use "**Ébauche…**").
 * @param {string} markdown
 * @param {string} prefix heading id prefix, such as "eula"
 * @param {{ contactHeading?: RegExp, french?: boolean }} [options] the
 *   heading that also gets the page's #contact anchor, and whether to apply
 *   French typography
 */
export function renderDocument(markdown, prefix, options = {}) {
  const { contactHeading, french = false } = options
  const inline = (/** @type {string} */ text) =>
    french ? frenchSpacing(renderInline(text)) : renderInline(text)
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
        const anchor = contactHeading?.test(block.text)
          ? '<span id="contact"></span>'
          : ""
        return `<h${level} id="${id}">${anchor}${inline(block.text)}</h${level}>`
      }
      case "paragraph":
        return `<p>${inline(block.text)}</p>`
      case "list": {
        const tag = block.ordered ? "ol" : "ul"
        const items = block.items
          .map((/** @type {string} */ item) => `<li>${inline(item)}</li>`)
          .join("\n")
        return `<${tag}>\n${items}\n</${tag}>`
      }
      case "table": {
        const row = (
          /** @type {string[]} */ cells,
          /** @type {string} */ tag
        ) =>
          `<tr>${cells.map((cell) => `<${tag}>${inline(cell)}</${tag}>`).join("")}</tr>`
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
      /^\*\*(Draft|Ébauche)/.test(block.blocks[0].text)
    )
      continue
    html.push(render(block))
  }
  return { title, version, html: html.join("\n"), ids: [...ids] }
}

const description =
  "Whyfull's end user license agreement, source-available license, privacy notice and trademark policy. The CLI is free; the desktop app is $19 once after a 30-day evaluation."
const pageTitle = "Legal — Whyfull EULA, source license, privacy and trademarks"
const frenchDescription =
  "Contrat de licence d’utilisateur final, licence du code source, avis de confidentialité et marques de commerce de Whyfull. La CLI est gratuite; l’application de bureau coûte 19 $ US, une seule fois, après 30 jours d’évaluation."
const frenchPageTitle =
  "Mentions légales — Contrat de licence et confidentialité de Whyfull"
const repository = "https://github.com/iplanwebsites/whyfull"

/**
 * @param {string} id
 * @param {{ title: string, version: string, html: string }} doc
 * @param {boolean} [french]
 */
function section(id, doc, french = false) {
  const version = french
    ? frenchSpacing(renderInline(doc.version))
    : renderInline(doc.version)
  const eyebrow = doc.version
    ? `<p class="wf-legal-eyebrow">${version}</p>`
    : ""
  return `<section id="${id}" class="wf-home-section wf-legal-doc" aria-labelledby="${id}-title">
${eyebrow}
<h2 id="${id}-title">${escapeHtml(doc.title)}</h2>
${doc.html}
</section>`
}

/** @param {string} root */
async function readDocuments(root) {
  const texts = await Promise.all(
    sourceDocuments.map((name) => readFile(join(root, name), "utf8"))
  )
  const docs = Object.fromEntries(
    sourceDocuments.map((name, index) => [name, texts[index]])
  )
  return { docs, placeholders: findPlaceholders(texts.join("\n")) }
}

/**
 * The shared page shell. Only the language-specific strings differ.
 * @param {{ lang: string, locale: string, title: string, description: string,
 *   path: string, nav: string, body: string, footer: string, sources: string }} page
 */
async function renderPage(page) {
  const url = `https://whyfull.app${page.path}`
  const html = `<!doctype html>
<html lang="${page.lang}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="theme-color" content="#faf9f2" />
<title>${page.title}</title>
<meta name="description" content="${escapeAttribute(page.description)}" />
<link rel="canonical" href="${url}" />
<link rel="alternate" hreflang="en" href="https://whyfull.app/legal/" />
<link rel="alternate" hreflang="fr-CA" href="https://whyfull.app/legal/fr/" />
<link rel="alternate" hreflang="x-default" href="https://whyfull.app/legal/" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<meta property="og:title" content="${page.title}" />
<meta property="og:type" content="website" />
<meta property="og:url" content="${url}" />
<meta property="og:description" content="${escapeAttribute(page.description)}" />
<meta property="og:site_name" content="Whyfull" />
<meta property="og:locale" content="${page.locale}" />
<meta name="robots" content="index, follow" />
<meta name="twitter:card" content="summary" />
<meta name="twitter:title" content="${page.title}" />
<meta name="twitter:description" content="${escapeAttribute(page.description)}" />
<link rel="stylesheet" href="/src/style.css" />
<link rel="stylesheet" href="/src/legal.css" />
</head>
<body>
<!-- Generated by scripts/build-legal.mjs from ${page.sources}. Do not edit by hand. -->
<div class="wf-home wf-legal">
${page.nav}
<main id="main">
${page.body}
</main>
${page.footer}
</div>
</body>
</html>
`
  const config = (await prettier.resolveConfig(outputPath)) ?? {}
  return prettier.format(html, { ...config, parser: "html" })
}

/**
 * Builds the English page from the documents under `root`.
 * @param {{ root?: string }} [options]
 */
export async function buildLegalPage({ root = defaultRoot } = {}) {
  const { docs, placeholders } = await readDocuments(root)
  const license = docs["LICENSE"]
  const eula = renderDocument(docs["EULA.md"], "eula", {
    contactHeading: /^\d+\.\s+Contact$/,
  })
  const privacy = renderDocument(docs["PRIVACY.md"], "privacy")
  const trademarks = renderDocument(docs["TRADEMARKS.md"], "trademarks")
  const licenseVersion = /^Version\s+\S+/m.exec(license)?.[0] ?? "Version 1.0"
  const banner = placeholders.length
    ? `<p class="wf-legal-callout"><strong>Draft.</strong> These documents are awaiting review by a lawyer before launch; text in [BRACKETS] will be filled in then.</p>`
    : ""

  return renderPage({
    lang: "en",
    locale: "en_US",
    title: pageTitle,
    description,
    path: "/legal/",
    sources:
      "EULA.md, LICENSE, PRIVACY.md and TRADEMARKS.md (French: EULA.fr.md and PRIVACY.fr.md)",
    nav: `<a class="wf-home-skip" href="#main">Skip to content</a>
<header class="wf-home-nav">
<a class="wf-home-wordmark" href="/" aria-label="Whyfull home">whyfull<span class="wf-home-dot">.</span></a>
<nav aria-label="Main navigation"><a href="${repository}">Source</a><a href="${repository}#readme">Docs</a><a href="/download/">Download</a><a href="/legal/fr/" hreflang="fr-CA" lang="fr-CA">Français</a></nav>
</header>`,
    body: `<section class="wf-legal-hero" aria-labelledby="legal-title">
<p class="wf-legal-eyebrow">Legal</p>
<h1 id="legal-title">The fine print.<br /><em>Plainly put.</em></h1>
<p class="wf-home-summary">The command line is free for personal and commercial use. The desktop app is free to evaluate for 30 days of use, then $19 once. Whyfull's source is public so you can see exactly what it does.</p>
<p lang="fr-CA">Ces documents sont aussi offerts <a href="/legal/fr/" hreflang="fr-CA">en français</a>.</p>
${banner}
<nav class="wf-legal-toc" aria-label="On this page"><a href="#eula">End user license</a><a href="#source-license">Source license</a><a href="#privacy">Privacy</a><a href="#trademarks">Trademarks</a></nav>
</section>
${section("eula", eula)}
<section id="source-license" class="wf-home-section wf-legal-doc" aria-labelledby="source-license-title">
<p class="wf-legal-eyebrow">${escapeHtml(licenseVersion)} · The <code>LICENSE</code> file</p>
<h2 id="source-license-title">Source-Available License</h2>
<p>Whyfull's source is public for transparency and auditing. It is <strong>not open source</strong>, and it will not become open source later. In short:</p>
<ul>
<li><strong>You may</strong> read the code, review it for security and privacy, quote it in bug reports, and contribute under the <a href="${repository}/blob/main/CONTRIBUTING.md">Contributor License Agreement</a>.</li>
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
${section("trademarks", trademarks)}`,
    footer: `<footer class="wf-home-footer">
<a class="wf-home-wordmark" href="/">whyfull.</a>
<p>Source available · © 2026 Felix Menard · Make room for what’s next.</p>
<nav aria-label="Footer navigation"><a href="${repository}">GitHub ↗</a><a href="https://www.npmjs.com/package/whyfull">npm ↗</a></nav>
</footer>`,
  })
}

/**
 * Builds the French page (legal/fr/) from EULA.fr.md and PRIVACY.fr.md. The
 * source license and the trademark policy exist in English only; the page
 * summarizes them in French and links to the English text.
 * @param {{ root?: string }} [options]
 */
export async function buildFrenchLegalPage({ root = defaultRoot } = {}) {
  const { docs, placeholders } = await readDocuments(root)
  const eula = renderDocument(docs["EULA.fr.md"], "clu", {
    contactHeading: /^\d+\.\s+Nous joindre$/,
    french: true,
  })
  const privacy = renderDocument(docs["PRIVACY.fr.md"], "confidentialite", {
    french: true,
  })
  const licenseVersion =
    /^Version\s+\S+/m.exec(docs["LICENSE"])?.[0] ?? "Version 1.0"
  const banner = placeholders.length
    ? `<p class="wf-legal-callout"><strong>Ébauche.</strong> Ces documents doivent être révisés par un avocat avant le lancement; le texte entre [CROCHETS] sera rempli à ce moment.</p>`
    : ""

  return renderPage({
    lang: "fr-CA",
    locale: "fr_CA",
    title: frenchPageTitle,
    description: frenchDescription,
    path: "/legal/fr/",
    sources: "EULA.fr.md and PRIVACY.fr.md",
    nav: `<a class="wf-home-skip" href="#main">Passer au contenu</a>
<header class="wf-home-nav">
<a class="wf-home-wordmark" href="/" aria-label="Accueil de Whyfull">whyfull<span class="wf-home-dot">.</span></a>
<nav aria-label="Navigation principale"><a href="${repository}">Code source</a><a href="${repository}#readme">Documentation</a><a href="/download/">Télécharger</a><a href="/legal/" hreflang="en" lang="en">English</a></nav>
</header>`,
    body: `<section class="wf-legal-hero" aria-labelledby="legal-title">
<p class="wf-legal-eyebrow">Mentions légales</p>
<h1 id="legal-title">Les petits caractères.<br /><em>En clair.</em></h1>
<p class="wf-home-summary">La ligne de commande est gratuite pour un usage personnel et commercial. L’application de bureau s’évalue gratuitement pendant 30&nbsp;jours d’utilisation, puis coûte 19&nbsp;$&nbsp;US, une seule fois. Le code source de Whyfull est public pour que vous puissiez voir exactement ce qu’il fait.</p>
<p lang="en">These documents are also available <a href="/legal/" hreflang="en">in English</a>.</p>
${banner}
<nav class="wf-legal-toc" aria-label="Sur cette page"><a href="#clu">Contrat de licence</a><a href="#licence-source">Licence du code source</a><a href="#confidentialite">Confidentialité</a><a href="#marques">Marques de commerce</a></nav>
</section>
${section("clu", eula, true)}
<section id="licence-source" class="wf-home-section wf-legal-doc" aria-labelledby="licence-source-title">
<p class="wf-legal-eyebrow">${escapeHtml(licenseVersion)} · Le fichier <code>LICENSE</code> (en anglais)</p>
<h2 id="licence-source-title">Licence à code source disponible</h2>
<p>Le code source de Whyfull est public par souci de transparence et pour permettre son examen. Il ne s’agit <strong>pas de logiciel libre</strong> (open source), et il ne le deviendra pas. En bref&nbsp;:</p>
<ul>
<li><strong>Vous pouvez</strong> lire le code, l’examiner sous l’angle de la sécurité et de la confidentialité, le citer dans des rapports de bogue et y contribuer selon le <a href="${repository}/blob/main/CONTRIBUTING.md">contrat de licence de contributeur</a> (en anglais).</li>
<li><strong>Vous ne pouvez pas</strong> le copier, le modifier, le redistribuer ni le sous-licencier, en créer des œuvres dérivées, ni réutiliser son code, son catalogue d’emplacements ou sa documentation dans d’autres produits.</li>
<li><strong>L’utilisation de Whyfull</strong> est régie par le <a href="#clu">Contrat de licence d’utilisateur final</a>, et non par la licence du code source.</li>
<li><strong>Les versions antérieures</strong> (npm <code>whyfull</code> 0.0.1 et 0.0.2, application de bureau 0.0.1 et l’historique git antérieur au changement de licence) demeurent sous la licence Apache 2.0, telles qu’elles ont été publiées.</li>
</ul>
<p>Le texte complet de la licence est offert <a href="/legal/#source-license" hreflang="en">en anglais</a>.</p>
</section>
${section("confidentialite", privacy, true)}
<section id="marques" class="wf-home-section wf-legal-doc" aria-labelledby="marques-title">
<h2 id="marques-title">Marques de commerce</h2>
<p>«&nbsp;Whyfull&nbsp;», le logo et l’icône de l’application Whyfull sont des marques de commerce de Felix Menard. Vous pouvez employer le nom «&nbsp;Whyfull&nbsp;» en texte simple pour parler honnêtement du logiciel officiel, par exemple dans des articles, des tutoriels ou des rapports de bogue, sans laisser entendre que nous vous parrainons ou vous appuyons. Sans notre autorisation écrite préalable, vous ne pouvez pas employer ces marques, ou un nom semblable, pour votre propre produit, paquet, domaine ou entreprise, ni publier sous ce nom des logiciels qui ne sont pas les versions officielles.</p>
<p>La politique complète est offerte <a href="/legal/#trademarks" hreflang="en">en anglais</a>. Pour toute demande d’autorisation, écrivez à support@whyfull.app.</p>
</section>`,
    footer: `<footer class="wf-home-footer">
<a class="wf-home-wordmark" href="/">whyfull.</a>
<p>Code source disponible · © 2026 Felix Menard · Faites de la place pour la suite.</p>
<nav aria-label="Navigation du pied de page"><a href="${repository}">GitHub ↗</a><a href="https://www.npmjs.com/package/whyfull">npm ↗</a></nav>
</footer>`,
  })
}

const pages = [
  { path: outputPath, name: "legal/index.html", build: buildLegalPage },
  {
    path: frenchOutputPath,
    name: "legal/fr/index.html",
    build: buildFrenchLegalPage,
  },
]

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check")
  let stale = false
  for (const page of pages) {
    const generated = await page.build()
    if (check) {
      const current = await readFile(page.path, "utf8").catch(() => "")
      if (current !== generated) {
        stale = true
        console.error(
          `${page.name} is out of date with ${sourceDocuments.join(", ")}.`
        )
      } else console.log(`${page.name} is up to date.`)
    } else {
      await mkdir(dirname(page.path), { recursive: true })
      await writeFile(page.path, generated)
      console.log(`Wrote ${page.path}`)
    }
  }
  if (stale) {
    console.error(
      "Run `pnpm --filter @whyfull/brochure legal` and commit the result."
    )
    process.exit(1)
  }
}
