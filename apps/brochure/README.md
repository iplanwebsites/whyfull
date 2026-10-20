# Whyfull brochure

The public marketing site for https://whyfull.app. This is a separate workspace
from `apps/web`, the bundled local disk viewer. It is an informational HTML/CSS
brochure built with Vite. Its Worker reads public GitHub release metadata for
downloads; it never accesses a visitor's disk.
The site lists supported tool groups and explains the CLI workflow, with agent-skill
installation and a copyable prompt as getting-started paths.

From the repository root:

```sh
pnpm install
pnpm --filter @whyfull/brochure dev
pnpm --filter @whyfull/brochure build
pnpm --filter @whyfull/brochure preview
```

Development and preview use http://127.0.0.1:3001. `dev` uses Vite for fast
frontend edits. `preview` builds the site and runs the actual Worker and static
assets locally through Wrangler. Build output is `apps/brochure/dist`.

## Cloudflare Workers deployment

The brochure is generated as static HTML/CSS/JS. Wrangler deploys both the Worker
entry point (`worker/index.ts`) and the static folder (`dist`), following the same
Worker-plus-assets structure as Slidepig. No server-side rendering is performed.

```sh
# Log in once to the Cloudflare account that owns the whyfull.app zone
pnpm --filter @whyfull/brochure exec wrangler login

# Validate and package without publishing
pnpm --filter @whyfull/brochure run deploy:dry-run

# Build and publish the Worker with its generated static assets
pnpm --filter @whyfull/brochure run deploy
```

`wrangler.jsonc` names the Worker `whyfull-brochure` and configures `whyfull.app`
as its custom domain. The domain must be an active zone in your Cloudflare
account; Wrangler configures the custom-domain routing on deployment. In CI, use
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` supplied as secrets. These files
prepare deployment; adding the configuration does not publish the site.

Every request enters the Worker (`run_worker_first: true`). `/api/downloads`
reads public releases from `iplanwebsites/whyfull` and caches validated download
metadata for five minutes at the edge. Other requests use `env.ASSETS.fetch`.
Vite builds both `dist/index.html` and `dist/download/index.html`; unknown URLs
return a real 404 rather than the home page. The Vite dev server exposes the
same download lookup for local development; Wrangler preview exercises the
production Worker and cache.

## Downloads and release metadata

`/download/` is the canonical download page. Desktop installers come first,
followed by the app-owned CLI and standalone archives, then npm. OS detection
only highlights the matching platform; Mac chip selection stays explicit.
Every platform remains visible. With no public desktop release yet, the page
explains that state and offers npm; it never invents asset URLs. Without
JavaScript or during an upstream failure, GitHub Releases is the fallback.

The desktop release workflow uploads `downloads.json` and `SHA256SUMS.txt` only
after all native builds, runtime tests, and artifact validation pass. The
Worker ignores drafts and releases without this metadata (including npm-only
releases). It prefers the newest published stable release; before the first
stable release it can offer a clearly labeled published preview. Once a stable
release exists, previews remain accessible through the release-history link.

The metadata declares version, channel, signing status, update support, and
nine artifact names/sizes/checksums. The Worker matches every entry against
GitHub's actual release assets and only exposes URLs in this repository.
Stable Mac releases require notarization; unsigned previews display a warning
beside the Mac download and expand Apple's first-launch instructions. Preview
updates are manual. Never replace these instructions with commands that disable
Gatekeeper globally.

The metadata is public and needs no GitHub token. Draft publication remains a
release-owner action after downloaded installer testing. Publishing a release
refreshes downloads within five minutes without rebuilding the site. See
[`apps/desktop/README.md`](../desktop/README.md#release-process) for the release
process, signing setup, and update ownership.

## Secrets and public source

The brochure currently needs no application secrets. The Worker name, domain,
and binding names in `wrangler.jsonc` are public deployment configuration.
Never put tokens, passwords, or private keys in that file, including under `vars`.

- Keep deployment credentials in your shell or CI secret store as
  `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; never commit their values.
- If future Worker routes need runtime secrets, use
  `pnpm --filter @whyfull/brochure exec wrangler secret put SECRET_NAME`.
  Supply the value interactively, rather than embedding it in a command.
- For local runtime secrets, use `apps/brochure/.dev.vars`. All `.dev.vars*`,
  `.env*` (except `.env.example`), and `.wrangler/` files are ignored. Examples
  must contain placeholders only.
- Treat everything in `public/`, `dist/`, and the client bundle as public.
  Never use `VITE_*` variables for secrets; those values are exposed to visitors.
- Run secret scans locally before publishing changes. If a credential is ever
  committed, revoke or rotate it immediately; adding it to `.gitignore` does not
  remove it from history.

See [Cloudflare's secret configuration guidance](https://developers.cloudflare.com/workers/configuration/secrets/).

Content and the agent prompt live in `index.html`; styles are in `src/style.css`.
The prompt textarea is the single source for the displayed and copied prompt.
The page remains readable without JavaScript; failed clipboard access selects
the content for manual copying.

## Informational page

The landing page explains the real CLI and agent workflow. It does not embed a
simulated disk explorer or publish a fictional snapshot. The generated donut
image is the hero visual; JavaScript only supports copying commands and prompts.
The actual disk viewer remains in `apps/web` and is opened with `whyfull --view`.

## Template source

Adapted at the owner's request from `iplanwebsites/slidepig`, specifically
`apps/demo/src/home.tsx`, `apps/demo/public/brand.css`, and the clipboard pattern
in `apps/demo/public/start.js`. Typography and responsive layout retain the template’s foundation; the product
graph, information hierarchy, content, and palette are adapted to Whyfull.
Slidepig is not a runtime dependency. Its source license is retained in
`LICENSE.slidepig.txt` for the adapted template styles.

## Agent skill

The canonical skill is `skills/whyfull/SKILL.md` at the repository root.
The dev/build preparation script copies it to `/skills/whyfull/SKILL.md` for
manual download; do not edit the generated public copy. The landing page also
uses the standard Skills CLI installer:

```sh
npx skills add iplanwebsites/whyfull --skill whyfull
```

This repository-based command requires the skill to be pushed to the public
repository before the updated page is deployed. To try the unpublished skill
from the repository root, use `npx skills add ./skills/whyfull` and select the
agent and scope. Installation is separate from running Whyfull or authorizing
cleanup. The skill can be selected for explicit storage requests and confirmed
disk-full failures; it does not run background scans.
