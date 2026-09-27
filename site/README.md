# AhemUI marketing site

Static site, no build step: `index.html`, `styles.css`, `main.js`, `favicon.svg`.

## Preview locally

```bash
npx vite site --port 5190
```

Any static file server works; `npx vite` is used because Vite is already in the repo.

## Deploy to Cloudflare Pages

In the Cloudflare dashboard, go to **Workers & Pages → Create → Pages → Connect to Git**, pick this repo, then set:

- **Framework preset:** None
- **Build command:** *(empty)*
- **Build output directory:** `site`

Or deploy straight from your machine:

```bash
npx wrangler pages deploy site --project-name ahemui
```

`_headers` sets security headers (a strict CSP: the page loads nothing from other origins) and cache lifetimes.

## Before launch

- Links point to `https://github.com/ahemui/ahemui`. Reserve that GitHub org or change the links.
- The install commands assume the marketplace lives at `ahemui/ahemui` on GitHub.
- Add a 1200×630 `og-image.png` and a `<meta property="og:image">` tag for nicer link previews.
