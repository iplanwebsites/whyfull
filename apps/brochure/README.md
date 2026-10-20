# Whyfull brochure

The public marketing site for https://whyfull.app. This is a separate workspace
from `apps/web`, the bundled local disk viewer. It is static HTML/CSS with a small
clipboard enhancement, built with Vite; no backend or disk access is involved.
The site explains the CLI and viewer and offers a copyable agent prompt.

From the repository root:

```sh
pnpm install
pnpm --filter @whyfull/brochure dev
pnpm --filter @whyfull/brochure build
pnpm --filter @whyfull/brochure preview
```

Development and preview use http://127.0.0.1:3001. Build output is
`apps/brochure/dist`; any static host can serve it. For a monorepo deployment,
install from the repository root and build with
`pnpm --filter @whyfull/brochure build`, then publish that output directory.
Set the custom domain to `whyfull.app` in your hosting provider and configure the
DNS records it supplies. Hosting and DNS are not configured by these files.

Content and the agent prompt live in `index.html`; styles are in `src/style.css`.
The prompt textarea is the single source for the displayed and copied prompt.
The page remains readable without JavaScript; failed clipboard access selects
the content for manual copying.

## Template source

Adapted at the owner's request from `iplanwebsites/slidepig`, specifically
`apps/demo/src/home.tsx`, `apps/demo/public/brand.css`, and the clipboard pattern
in `apps/demo/public/start.js`. The layout, typography, poster, responsive rules,
and section structure are retained; content and palette are adapted to Whyfull.
Slidepig is not a runtime dependency. Its source license is retained in
`LICENSE.slidepig.txt` for the adapted template styles.
