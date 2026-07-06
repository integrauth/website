---
name: verify
description: Verify IntegrAuth website changes by serving the static site locally and driving it with Playwright screenshots across themes and viewports.
---

# Verify IntegrAuth Website

Static site — no build step. Verification = serve + drive in a real browser.

## Serve

Any static server on the repo root works. `npm run dev` opens browser-sync (interactive);
for headless verification use a plain server, e.g. a tiny Node http server or:

```
npx -y serve -l 8171 .
```

## Drive (Playwright)

Playwright is NOT a project dep — install it in the session scratchpad, not the repo:

```
cd <scratchpad> && npm i playwright && npx playwright install chromium
```

Checks that matter for this site:

1. **Console errors + failed requests** — attach `console`/`pageerror`/`response>=400`
   listeners; catches broken logo paths in `images/websites/`.
2. **Font Awesome glyphs** — for each `fa-*` class used, assert
   `getComputedStyle(el, '::before').content` is a real glyph (CDN is FA 6.4.0;
   icons newer than 6.4 silently render blank squares).
3. **All four themes** — default is `cyber` for first-time visitors. Switch via the real
   dropdown (`.theme-btn` then `.theme-option[data-theme=light|dark|contrast|cyber]`)
   or `localStorage.setItem('theme', ...)` + reload. High Contrast must stay pure
   black/white; cyber overrides `--primary-color` to cyan.
4. **Tech-stack collapse** — `window.collapseAllTech()` / `expandAllTech()` must toggle
   every `.tech-grid` (count `.tech-grid.show`); new categories need the same
   `tech-category-header` + `collapse` markup to participate.
5. **Viewports** — 1440 (hero cards 3-across), 900 (2-across), 390 (mobile).
6. **Services marquee** — the single `.services-marquee` row (10 cards, each with a
   `.service-tag` pill) must auto-scroll (~30px/s: sample `scrollLeft` 1.5s apart),
   stop dead on hover, track mouse drag 1:1, wrap seamlessly (set
   `scrollLeft = setWidth + N` while hovered → normalizes to ~N), and stand still
   under `reducedMotion: 'reduce'`.

## Gotchas

- `index.html` is minified single-line HTML; closing `</p>` tags are omitted on purpose.
- Dark/black SVG logos (e.g. `mcp.svg`) need a light chip on dark themes — see
  `.tech-logo[alt="MCP"]` rules in styles.css.
- After editing `css/styles.css` run `npm run build:css` and bump `?v=X.X` on
  `styles.min.css`/`functions.min.js` refs in ALL five HTML files (index, privacy,
  terms, support, cancellation) — the site serves only the `.min` assets.
- Card color variants rely on column position (`.row > :nth-child(...)`) because each
  card is the sole child of its Bootstrap column; theme overrides use `:nth-child(n)`
  with `!important`, so keep base variants scoped to `body.bg-light`.
