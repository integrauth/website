# CLAUDE.md - IntegrAuth Website

> **Last Updated**: 2026-07-13
> **Project**: IntegrAuth Official Website
> **Repository**: github.com/integrauth/website
> **Contact**: akhil@integrauth.com

---

## Overview

Enterprise-grade IAM, API Security, and AI Security company website. Static single-page application deployed on **integrauth.com** via GitHub Pages.

**Core Services**: AI & Agent Security (agent authentication, non-human identities, MCP security & secure MCP libraries, FGA/ReBAC, AI integrations), Enterprise IAM, API Security Gateway, Cloud Integration (AWS/Azure/GCP), Enterprise SSO

**Brand line**: "Identity & Security for All — Humans, Machines, RPA bots & AI Agents" (two-line hero tagline; updated 2026-07-13, was "...for Humans, Machines & AI Agents" from the AI-first rebrand, 2026-07)

**Tech Stack**: HTML5, CSS3, JavaScript ES6+, jQuery 3.7.1, Bootstrap 5.3.3, Font Awesome 6.4.0

**Deployment**: GitHub Pages (no build process, static files only)

**URL style**: ALL internal links are extensionless (`/academy`, `/privacy`, `/#contact`, `/` for home) — GitHub Pages resolves `/academy` → `academy.html`. Never link `*.html` directly; canonicals and sitemap.xml are extensionless too.

---

## Project Structure

```
website/
├── index.html, academy.html, privacy.html, terms.html, support.html, cancellation.html, verify.html
├── mcp-security.html, ai-agent-security.html, api-security.html (service landing pages, added 2026-07-17)
├── 404.html (custom GitHub Pages 404 — noindex, ABSOLUTE asset paths since it serves at any depth)
├── .well-known/security.txt (RFC 9116; expiry 2027-07-17 — renew yearly) + .nojekyll (required so Pages serves dot-dirs)
├── css/styles.css (~126KB, 5550 lines)
├── js/functions.js (~27KB, 735 lines)
├── js/academy-labs.js (~400KB — labs framework + flow-player engine (12 canonical flow definitions) + final-exam/certificate engine + 96 simulated labs; loaded ONLY by academy.html)
├── images/
│   ├── og-banner.png (1200×630 social-share card, og:image/twitter:image on index+academy+3 service pages; the Organization JSON-LD logo stays IntegrAuth.svg — regenerate the banner from an HTML mock via Playwright screenshot if the brand changes)
│   ├── social-icons/ (11 icons)
│   └── websites/ (43 tech logos, ~700KB after 2026-07-17 sharp recompression)
└── IntegrAuth.svg, site.webmanifest, CNAME
```

---

## Key Architecture

### Page Sections (index.html)

1. **Navbar** - Fixed top, smooth scroll, theme picker dropdown (Light / Dark / High Contrast / Midnight Cyber), responsive menu. Order (2026-07-17): Home, Services ▾, Tools, Learn ▾, Products, Stack, Clients, Contact. The two nav dropdowns (also on ALL sub-pages): Services ▾ = All Services (#solutions) + divider + the 3 service landing pages; Learn ▾ = Academy + Verify a Certificate (a future blog slots in here). They are Bootstrap-native (`<button class="nav-link dropdown-toggle" data-bs-toggle="dropdown">` + `ul.dropdown-menu.nav-dd`, themed for all 4 themes like .theme-menu) — the THEME picker stays a manual JS dropdown (no data-bs-toggle); don't unify them. Scroll-spy matches nav links by `href="#id"` (not index) and ALSO matches `.nav-dd .dropdown-item[href="#id"]`, highlighting the parent toggle (so Services lights up inside #solutions). GOTCHA: `.navbar { z-index: 1030 }` in styles.css is load-bearing — the navbar's backdrop-filter and the hero's will-change:transform each create level-0 stacking contexts, and the later-in-DOM hero paints over open dropdown menus without it
2. **Hero** - Animated gradient background (15s), logo, tagline "Identity & Security for Humans, Machines & AI Agents", subtitle listing core services (no feature cards — they duplicated the Services marquee and were removed 2026-07)
3. **Academy promo banner** (`#academy-promo`, a `<div>` not a `<section>`, placed right after the Hero, pulled up with negative margin) - animated-gradient `.acad-banner` split layout: eyebrow pill + title + copy + `.acad-stat` chips on the left, white CTA button to /academy on the right, and a full-width `.acad-banner-tracks` grid of 12 mini track cards (num pill + name + one-line summary, each linking to `/academy#<track>0-start`) below — the grid sits inside Bootstrap collapse `#acadBannerTracks`, collapsed by default, opened by a `.tools-group-header.acad-banner-tracks-toggle` bar (same component as the tools-section headers: "Browse all tracks" + "12 tracks" count pill; `.collapse-icon` chevron rotates 90° via CSS `:not(.collapsed)`, no JS)
4. **Solutions** - Single auto-scrolling marquee row (`.services-marquee > .services-track > .service-slide`) with all 16 service cards; each card carries a `.service-tag` category pill ("AI & Agent Security" on the first 5: AI Integration Services, Agent Auth & Non-Human Identity, MCP Security & Secure Libraries, Fine-Grained Authorization, Securing AI Applications; "Identity, API & Engineering" on the last 11: Cloud-Native IAM, API Security Consulting, Enterprise SSO, Custom Software Development, Architecture & Design, Customer Identity & Advanced Authentication, Identity Threat Detection & Response, plus 4 added 2026-07-17: App Development (Android/iOS/Windows/Linux/web), IAM Migration & Modernization, Identity & API Security Assessment, Managed IAM & Support Retainers — corporate training deliberately skipped per Akhil). Marquee pauses on hover/focus/touch, supports mouse drag + native touch scroll, loops seamlessly via cloned slides, and respects `prefers-reduced-motion`
5. **Free Security Tools** (`#tools`) - 27 micro-tool cards linking to `*.integrauth.com` subdomains, split into two Bootstrap-collapse groups (`#tools-ai` 5 tools, `#tools-iam` 22 tools), both collapsed by default; each group header is a full-width `<button class="tools-group-header">` bar (icon + title + subtitle + "N tools" count pill + chevron flip), themed for all 4 themes
6. **Products** - 6 products (Smartable, Wrenchub, oidcscan, hallbook, waterflow, sunnahfast — the last four live at `<name>.integrauth.com`, logos `images/<name>-logo.svg`; sunnahfast is free Islamic sunnah-fasting reminder emails + a weekly Jumuah email + Hijri↔Gregorian converter & subscribable .ics Islamic-dates feed, no accounts, sales-free CTA straight to sunnahfast.integrauth.com) as an auto-scrolling marquee (reuses the `.services-marquee` framework, `data-direction="rtl"`, slides are `.service-slide.product-slide`) with a detail modal per product (`openProductModal(id)` → `#<id>-modal`); the marquee captures the pointer only after a 6px drag so card clicks still open modals, and the post-drag click is swallowed. hallbook/waterflow modals carry a sales-led "contact us" onboarding CTA (their public signups are disabled behind `PUBLIC_SIGNUPS_ENABLED`, off by default, in their own repos). Followed by a "We Also Build Websites" sub-block (inside `#products` so the scroll-spy section↔nav-link index mapping stays intact): 3 demo cards reusing `.tool-card` styling (with `.demo-icon` accent) linking to restaurant-demo / hospitals-demo / schools-demo `.integrauth.com` — each demo showcases switchable design variants (24 / 15 / 12) — plus a `.tools-cta` line linking to `#contact`
7. **Tech Stack** - 17 collapsible categories, all collapsed by default (headers ship `aria-expanded="false"` + `collapsed-card` class, grids without `.show`), incl. Authorization & Policy (OpenFGA, OPA), Agent Identity & NHI (OAuth 2.1, Token Exchange, mTLS, service accounts, JWT), AI Tools, AI Agent Frameworks, AI Model Providers, AI Security & Guardrails (MCP Gateways, Enkrypt AI Guardrails, LiteLLM)
8. **Clients** - Enkrypt AI, Cequence AI, I'Curity Solutions
9. **How We Engage** (`#process`, added 2026-07-17) - `.process-grid` of `.process-step` cards (num pill + icon title + desc): 4 project phases Assess → Architect → Build & Integrate → Enable & Hand Over, plus step 5 "Support & Evolve" (retainers) as a full-width `.process-step-wide` card spanning the grid with an `.process-optional` pill; not in the navbar (scroll-spy skips sections with no matching nav link — the previous link just stays active)
10. **FAQ** (`#faq`, added 2026-07-17) - 10 `.faq-item`s (`.faq-q` collapse button + `.faq-a` panel, Bootstrap collapse, chevron rotates via `:not(.collapsed)` like tools-group-header); mirrored 1:1 by a FAQPage JSON-LD block in `<head>` next to the Organization schema — KEEP THE TWO IN SYNC when editing questions
11. **Contact** - Email and social links, plus closing hero
12. **Footer** - shared `.site-footer` sitemap footer (2026-07-17): IDENTICAL absolute-link markup on ALL 11 pages (index, academy, 3 service pages, 404, support/privacy/terms/cancellation/verify — the legal pages previously had no footer at all). Brand + tagline + 4 round social buttons, then 4 link columns — Services / Learn / Company / Support & Legal (incl. a /.well-known/security.txt link) — and a bottom bar. Stays dark (`bg-dark`) in all 4 themes by design; `.site-footer-*` CSS at the end of styles.css. When editing footer links, update every page together (script a replace across all 11 files — the markup is byte-identical). Solutions section also carries a "Deep dives" `.tools-cta` line linking the 3 service pages

### Service landing pages (mcp-security / ai-agent-security / api-security, added 2026-07-17)

SEO deep-dive pages for the three highest-intent services, in sitemap.xml (priority 0.8). Template = support.html chrome (blocking CSS, no boot loader, jQuery+functions.min.js in head, navbar with Home / Services ▾ / Learn ▾ / Contact + theme picker, skip-link, shared .site-footer; section header rows use `mb-4` — not mb-5, which reads as too much gap under the subtitles) + shared section skeleton: `.svc-hero` (gradient band: `.svc-crumb` breadcrumb, `.svc-kicker`, h1, lead, `.svc-chip` standards pills, mailto CTA + anchor to the page's tools grid) → "why it breaks" `.svc-list` (6 icon items) → "What We Deliver" 6 non-anchor `.tool-card`s → "Learn It Free First" 4 `.tool-card` links to `/academy#<lesson-id>` → "Scan … — Free" 6 `.tool-card` links to the relevant `*.integrauth.com` tools + related-deep-dives `.tools-cta` → `bg-primary` CTA band. Each page ships Service + BreadcrumbList JSON-LD, extensionless canonical/og:url, and never nav-links itself. `.svc-*` CSS lives at the end of styles.css, themed for all 4 themes; everything else reuses existing components (`.tools-grid`/`.tool-card` theme globally, not just inside #tools). mcp-security.html is the canonical exemplar — clone it for any new service page, then add the page to sitemap.xml, both footers' service links, and the FAQ if relevant.

### IntegrAuth Academy (academy.html, added 2026-07-11)

Standalone free-learning page: 12 tracks / 133 byte-sized lessons (The Absolute Basics ×11 — "Track 0", key `basics`, ids b0-start/b1-web/b2-http/b3-state/b4-apis/b5-encoding/b6-keys/b7-jwt/b8-passwords/b9-quiz, added 2026-07-16 for complete beginners to software: how the web works, HTTP, cookies & sessions, APIs & JSON, encoding-vs-encryption-vs-hashing, keys & signatures, what is a JWT, password storage; sits FIRST in hub/DOM/pager order without renumbering the other tracks, its quiz hands off to Foundations — Foundations ×15, Modern Authentication ×14, Token Security ×11, Authorization & API Security ×10, Protocols & Federation ×10, AI & Agent Security ×13, Identity Operations ×10, Identity Attacks & Defenses ×11, Customer Identity CIAM ×10, Cloud & Workload Identity ×9, Identity Architecture ×9 — tracks reordered 2026-07-13 for learner progression (was ...tokens, ai 4, ops 5, authz 6, proto 7...): theory-before-practice, AuthZ/Proto now precede the AI track that applies them — 8 gap lessons added 2026-07-12: authn a11-magic/a12-idv, tokens t8-validation/t9-opaque, ai ai9-injection/ai10-a2a/ai11-audit, ops o8-recon; each inserted before its track quiz which was renumbered), originally ported (genericized, standards-based) from a client sample app's learning modules and since extended (2026-07-12: Track 6 "authz" az0–az8; gap lessons t7-birth, a10-sessions, o6-reviews, o7-breakglass). Every track opens with a ★ "Start here" intro lesson (`*0-start`, data-num="0" — chip/TOC render ★ — chnum "<TRACK> · START HERE", `.acad-arc` roadmap list, one journey-line SVG, NO lab and NO `.acad-try`; intros are exempt from the every-lesson-has-a-lab rule). Track keys/labels live in `TRACK_LABELS` inside `initAcademy()` (functions.js) — adding a track means a new entry there + a hub card. DOM order of `.acad-lesson` sections = pager order and defines display numbering (data-num is display-only; lesson ids are stable localStorage/hash keys and never renumbered — e.g. t7-birth displays as Token Security lesson 1). Every track ends with a "The big picture" explanatory summary lesson (`*-summary`, added 2026-07-16: narrative retelling of the whole track with every lesson linked once, ONE unifying figure, a 4-card "threads" grid, why-it-matters box and where-next links; NO lab, NO .acad-try — exempt like intros) followed by a "Cheat sheet & pop quiz" recap lesson (b9/f12/a9/t6/az8/p8/ai8/o5/atk9/c8/w7/r7-quiz; quiz chnum/data-num/TOC numbers were all +1-renumbered when the summaries were inserted — each quiz's "Track complete 🎉" box hands off to the NEXT track in the new order; keep these handoffs in sync if tracks move again): distilled-ideas table + track-specific quick-reference table + 5 scenario questions using the static `.acad-quiz` reveal pattern (no JS needed to add one; also bump the hub TOC, `.acad-track-done` count, and the "N lessons" stat chips on academy + index promo). Structure:

- **Hub** (`#acadHub`): 12 `.acad-track-card`s with static lesson TOCs (SEO/noscript-friendly); each card carries a `.acad-track-num` "Track N" pill (order: basics 0, foundations 1, authn 2, tokens 3, authz 4, proto 5, ai 6, ops 7, atk 8, ciam 9, cloud 10, arch 11 — reader label mirrors it as "Track N · Name"; the same order must hold in TRACK_LABELS numbering, hub card DOM order, lesson-section DOM order, and the index promo mini-card grid). The hub also injects (via initAcademy, no-JS-safe): a **lesson search** box (`.acad-hub-search`, filters all lessons by title+lead), **persona learning paths** (`.acad-paths`: 4 role cards Developer/Architect/Security-analyst/PM, each an ordered cross-track playlist from PERSONA_PATHS in functions.js — unknown ids auto-skip), and **glossary tooltips** (`.acad-term` spans hover/focus → `.acad-tip` popover, definitions harvested from f11-glossary dt/dd); below the cards sits the **Flow Explorer** panel (`#acadFlows`, a hub-level `.acad-lab` `data-lab="lab-flows"`): a 12-flow picker rendering animated SVG sequence diagrams via the flow-player engine — `AcadLabs.defineFlow(id, {title,tag,intro,outro,actors,steps})` registry + `h.flowPlayer(refOrDef)` helper in academy-labs.js (step-by-step reveal, plain-English narration + optional HTTP snippet, Back/Next/Auto-play, ax-*/--acad-* theming, `.acad-seq-*` CSS block in styles.css); flows: oidc-code, webauthn, refresh-rotation, dpop, backchannel-logout, saml-sp, saml-idp, client-creds, device, token-exchange, ciba, scim-provision — lesson labs may embed any via h.flowPlayer. Below that sits **Challenge mode** (`#acadChallenge`, see the Interactive labs bullet below), then a **Final Exam** panel (`#acadExam`, `data-lab="lab-exam"`): 25 questions randomized from `ACAD_EXAM_POOL` (50 Qs across all tracks) in academy-labs.js, 80% to pass, ≥80% unlocks a canvas-rendered certificate PNG (learner types name; brand tagline; client-side only; localStorage `acad_exam`). Each download is gated by a `confirm()` echoing the exact name that will be printed (flags empty-name → "Identity Learner" default); no download limit. Every certificate carries a **verifiable ID** `IA-YYYYMMDD-<score>-<8 hex>` where the hex is the first 4 bytes of SHA-256 of `integrauth-academy-cert-v1|<CANONICAL NAME>|<YYYYMMDD>|<score>` (canonical name = collapse whitespace, trim, uppercase) — printed in the cert footer with an "Issued" date and "Verify authenticity at integrauth.com/verify" line, shown under the canvas with a `/verify` link. **verify.html** (`/verify`, in sitemap) recomputes the same hash fully client-side (Bootstrap form modeled on support.html, uses solid `btn-primary` — the site's `.btn-outline-primary` masked-border style renders with artifacts, avoid it); the salt string + canonicalisation MUST stay in sync between `certId()` in academy-labs.js and verify.html's inline script. It's a consistency check, not an unforgeable credential (anyone can read the JS) — real issuance would need a server (Cloudflare Worker). `.acad-exam-*`/`.acad-cert-canvas` CSS in styles.css. Grow ACAD_EXAM_POOL with each new track; `#acadResetAll` in `.acad-hub-foot` clears ALL progress behind a confirm()
- **Reader** (`#acadReader`): one-lesson-at-a-time via `initAcademy()` in functions.js — hash routing (`#lesson-id`), chip nav per track, prev/next pager, localStorage progress (`acad_pos`/`acad_read`/`acad_quiz`), quiz reveal buttons, glossary live filter (input injected by JS). **Read-marking is gated by lesson type** (since v5.39): lessons WITH a `.acad-lab` only mark read once the lab is interacted with (any pointerdown/keydown inside the lab — delegated in functions.js, `academy-labs.js` untouched; a JS-injected `.acad-lab-gate` line above the lab says "Try the hands-on lab below…" → "✓ Lesson marked read.", reusing `.acad-quiz-progress` styling incl. `.done`); labs are open-ended sims with no uniform end state, so interaction — not completion — is the signal. Lessons WITHOUT a lab (★ intros, `*-summary`, f11-glossary) mark read on open as before, and `*-quiz` lessons keep their all-5-reveals gate. Hub-level labs (`#acadFlows`/`#acadChallenge`/`#acadExam`) sit outside `.acad-lesson` and never mark anything. Reset buttons are track-scoped: `.acad-reset-track` (top toolbar `#acadReset` + `.acad-reader-foot` bottom bar, which also has an "All tracks" `data-goto="__hub__"` button) clears only the active track's read marks + quiz reveals via `resetTrack()`, then returns to the hub. `*-quiz` recap lessons don't mark read on open: per-question reveals are tracked in `acad_quiz` with a JS-injected `.acad-quiz-progress` line + per-question ✓, and the lesson counts as read only after all 5 answers are revealed. The pager's next-button (`buildPager()`) only shows "Back to all tracks" when there is truly nowhere to go; on the very last lesson overall (last track's recap quiz) it instead reads "All tracks complete 🎉 / Flow Explorer, Challenge mode & Final Exam →" (`data-goto="__flows__"`), so finishing every lesson hands the learner straight into the hub-level widgets instead of dumping them back at the track grid
- **Guided path through the hub widgets** (added 2026-07-13): Flow Explorer, Challenge mode and Final Exam (`#acadFlows`/`#acadChallenge`/`#acadExam`) are always-visible sections stacked on the hub, not paginated lessons — so "continuing" between them is a scroll+highlight, not a page change. `showHub(focusId)` in functions.js optionally scrolls to and pulses (`.acad-hub-pulse`, a 2-rep box-shadow ring keyed off `--acad-actor`) a target section; the delegated click handler maps sentinel `data-goto` values `__flows__`/`__challenge__`/`__exam__` to `showHub('acadFlows'|'acadChallenge'|'acadExam')`. Each of the three widgets carries a trailing `.acad-flowx-next` nav button (`.acad-page-btn.acad-flowx-next-btn`, inserted directly in academy.html before that widget's closing div) chaining to the next: Flow Explorer → Challenge mode → Final Exam → "🎉 All done — back to all tracks ↺" (`__hub__`)
- **Academy tour** (added 2026-07-13): a lightweight, dependency-free onboarding walkthrough in `initAcademy()` (functions.js) — `ACAD_TOUR` array of `{selector?, title, text}` steps rendered one at a time via a fixed-bottom `.acad-tour-card` (Back/Next/Skip, step counter) plus a CSS-only spotlight on the referenced element (`.acad-tour-spot`: `position:relative; z-index` above a giant same-element `box-shadow: 0 0 0 9999px rgba(0,0,0,.6)` — the classic no-overlay-element spotlight trick, so no separate dimming div or rect-math positioning is needed). Steps without a `selector` render as a plain centered card (used for the "move between lessons" step, since chips/pager only exist inside a lesson). Walks: pick a track → move through lessons → Flow Explorer → Challenge mode → Final Exam & certificate → your progress (hub-foot). Auto-offered once, 900ms after boot, ONLY on a genuinely fresh hub landing (no hash, no saved `acad_pos` — gated additionally on `location.hash` still being empty when the timer fires, so it can't yank a learner who already navigated away mid-delay); gated by localStorage `acad_tour_seen` so it never repeats uninvited. Replayable anytime via the `🧭 Take the tour` button (`#acadTourBtn`, JS-injected next to `#acadResetAllTop` inside a new `.acad-progress-actions` wrapper — JS-only UI, kept out of the no-JS-safe static markup like the search box and persona paths). `showLesson()` calls `endTour()` if a tour is mid-flight, so navigating into a real lesson (chip click, search hit, etc.) always cleans up the card + spotlight rather than leaving them stale over the reader
- **Lessons**: `<section class="acad-lesson" data-track data-num data-short data-title>`; content blocks: `.acad-chnum`, `.acad-lead`, `.acad-grid`/`.acad-card`, callouts `.acad-box.acad-{analogy,story,why,watch}`, `.acad-table`, `.acad-try` (links to the free tools), `.acad-quiz`, `.acad-glossary`
- **Diagrams**: hand-authored inline SVG `<figure class="acad-fig">`, colored ONLY via `ax-*` classes (`ax-actor/ax-human/ax-bad/ax-atext/ax-life/ax-msg/ax-ret/ax-note/ax-em/ax-block/ax-ring/ax-arrowhead`) backed by `--acad-*` CSS variables themed per body class — never hardcode colors in lesson SVGs
- **Fictional cast** (keep consistent): Maya (customer), Sam (partner agent), Priya (employee), Bot A (RPA bot), Kai (AI agent), Zara (security operator)
- Vendor-neutral rule: lessons cite standards (RFCs, OpenID, W3C/FIDO, NIST) and open source (OpenFGA/OPA/SPIFFE) only — no IdP vendor or client names
- **Interactive labs** (added 2026-07-12): 96 fully simulated, client-side labs + a **Challenge mode** (`#acadChallenge`, `lab-challenge`): 5 cross-cutting "break it, then fix it" scenarios (spot the flaw → choose the fix, each linking the relevant lesson) — `<div class="acad-lab" data-lab="lab-*">` placeholders inside EVERY lesson except the ★ intro lessons, the quiz recaps, and f11-glossary (which has its live filter instead), placed at the end of the lesson right before its `.acad-try` box, rendered by `js/academy-labs.js`: an IIFE framework (`AcadLabs.register(id, {title, blurb, render(root, h)})` + helper API `h.el/button/badge/panel/chip/fakeJwt/verifyJwt/tokenView/jsonView/httpCard/logPanel/meter/interval` — timers auto-clean on the built-in Reset). Real WebCrypto where it teaches (TOTP RFC 6238 HMAC-SHA1, SHA-1 k-anonymity, ECDSA P-256 sign/verify in lab-sign, salted SHA-256 in lab-pwstore/lab-encoding); everything else deterministic simulation with correct RFC status/error codes; **no network calls ever**. Styled by the `.acad-lab-*` block at the end of styles.css (built on `--acad-*` tokens, all 4 themes). Adding a lab = placeholder div in the lesson + `AcadLabs.register` module appended to academy-labs.js + re-minify. The "99 hands-on labs" / "133 lessons" / "12 tracks" / "120+ diagrams" `.acad-stat` chips (academy hero + index promo) must track the real counts, as must the `0/133 lessons read` initial progress text (the "hands-on labs" count includes the three hub widgets lab-flows + lab-exam + lab-challenge). Hub-foot also has a **print stylesheet** (`@media print` in styles.css → the active lesson prints clean, chrome hidden — good for cheat sheets). A **live-update toast** (added 2026-07-13, see Asset Minification below for the versioning workflow) polls `academy-version.txt` against the page's `<meta name="acad-build">` and prompts a reload when they diverge, since the SPA-like single-page reader would otherwise never notice a new deploy without a manual refresh
- ai3-rag also carries a "Beyond retrieval: what's replacing standard RAG" section: OKF (Open Knowledge Format, open vendor-neutral spec v0.1 mid-2026 — markdown + YAML frontmatter knowledge wiki), GraphRAG, agentic RAG, hierarchical chunking, hybrid retrieval + re-ranking, talk-to-data — each with an "identity checkpoint"

### Boot loader & async CDN CSS (index.html + academy.html, 2026-07-14)

Both pages ship a full-screen boot loader (IntegrAuth-logo shield + pulse ring) that covers first paint through JS init, killing every flash class (unthemed light content, wrong-theme loader, old page lingering on nav). Four cooperating pieces — **keep them in sync**:

1. **Inline `<head>` script** (first thing in head, both pages): reads `localStorage.theme` (try/catch, defaults `cyber`), stamps `data-boot-theme` + `.site-boot` on `<html>` before body parses, sets `window.__siteBootT0`, and arms a 5s failsafe class-removal in case JS never loads
2. **Inline `<head>` critical CSS** (right after the script): styles `.boot-loader`/`.acad-boot-loader` + shield/scan + per-`data-boot-theme` backgrounds WITHOUT needing styles.min.css, and hides all other body children via `html.site-boot body>:not(...) {visibility:hidden!important}` — so nothing can ever paint ahead of the loader
3. **Inline post-`<body>` script**: rewrites `body.className` to the chosen theme's classes synchronously (applyTheme() re-does it at ready) — no unthemed frame even if the loader lifts early
4. **`dismissBootLoader()` in functions.js**: removes `.site-boot` after ≥700ms AND once Bootstrap's stylesheet is in `document.styleSheets` (capped +4s so a dead CDN can't strand the loader); called from the DOM-ready handler (index, gated on `#siteBootLoader`) and the end of `initAcademy()` (academy)

The 3 CDN stylesheets (Google Fonts, Bootstrap, Font Awesome) load **async** on these two pages (`rel="preload" as="style"` + `onload` rel-swap + `<noscript>` fallbacks) so first paint only blocks on same-origin styles.min.css — the loader paints in the right theme within ~100-300ms while the loader hides the un-Bootstrapped layout. Also in functions.js: a delegated click handler raises the loader over the OLD page on same-site cross-page link clicks (browser paint-holding otherwise shows the old page until the new one's first paint), with same-pathname/hash/new-tab/external clicks excluded and a `pageshow` handler dropping a stale loader on bfcache restores. Legal pages (privacy/terms/support/cancellation) have none of this — blocking CSS, no loader.

### Design System (css/styles.css)

**Colors**: Primary `#6366f1`, Gradient `#667eea → #764ba2`, Dark mode `#0f172a`

**Typography**: Inter font, fluid sizing with `clamp()`

**Spacing**: xs (4px) to 4xl (96px)

**Features**: Glassmorphism, gradient animations, dark mode, responsive

**Key Animations**: `gradientShift` (15s), `float` (20s), `textGlow` (3s)

### JavaScript (js/functions.js)

**Theme Management**: `toggleAndSaveTheme()`, localStorage persistence, system preference support

**Navigation**: Smooth scroll with custom easing, active link highlighting

**Services Marquee**: `initServicesMarquee()` — rAF-driven `scrollLeft` auto-scroll (30px/s, direction via `data-direction`), pause on hover/focus/pointerdown, mouse drag-to-scroll, seamless wrap by normalizing `scrollLeft` into the first card set's range

**Academy**: `initAcademy()` — no-ops unless `#acadReader` exists (academy.html only)

**Bootstrap**: Tooltips, popovers initialization

---

## Supported Technologies

**IAM**: Auth0, Keycloak, Oracle IDM, Supabase, AWS Cognito, Entra ID, Okta, Firebase Auth

**Authorization & Policy**: OpenFGA, Open Policy Agent (OPA), ReBAC/FGA modeling, policy as code

**Agent Identity & NHI**: OAuth 2.1, Token Exchange (RFC 8693), mTLS, service accounts & workload identity, JWT

**AI Security & Guardrails**: MCP Gateways, Enkrypt AI Guardrails, LiteLLM, secure MCP libraries, prompt injection defense

**API Gateways**: AWS, Azure, GCP, Kong, MuleSoft, WSO2, IBM DataPower, KrakenD, Cloudflare

**Languages**: Go, Rust, Python, Java, JavaScript/Node.js, Bash, PowerShell, Lua

**IaC**: Terraform, CloudFormation, Bicep, GitHub Actions, GitLab, Jenkins

**Testing**: k6, Postman Newman, Pytest, Playwright

---

## Development Guidelines

### Code Style

- CSS: Custom properties for theming, BEM-like naming
- JavaScript: ES6+ features, jQuery for DOM
- HTML: Semantic markup, Bootstrap 5 components
- One CSS file, one JS file, no build step

### Adding Features

1. Update [index.html](index.html) structure
2. Style in [css/styles.css](css/styles.css) using design tokens
3. Add interactivity in [js/functions.js](js/functions.js)
4. Images go in `images/` subdirectories
5. Test mobile/desktop and dark mode

### Common Tasks

**Add Tech Logo**: Place in `images/websites/`, update Tech Stack section in index.html

**Add Client**: Place logo in `images/websites/`, update Clients section with name/description/badges

**Modify Theme**: Update CSS custom properties in styles.css, test both light/dark modes

### Asset Minification

**Required Tools**: `clean-css-cli`, `terser`, `html-minifier-terser` (already in package.json)

**Minify CSS**:
```bash
npx clean-css-cli -o css/styles.min.css css/styles.css
```

**Minify JavaScript**:
```bash
npx terser js/functions.js -o js/functions.min.js -c -m
```

**Minify HTML**:
```bash
npx html-minifier-terser --input-dir . --output-dir . --file-ext html \
  --collapse-whitespace --remove-comments --minify-css --minify-js
```

**After Minification**: Update cache version in index.html (e.g., `?v=1.7` → `?v=1.8`) for both CSS and JS references to ensure browsers load the new versions. And also update other html files like cancellation, privacy, support, terms, verify, mcp-security, ai-agent-security, api-security and 404 (404 references assets with absolute paths).

**Cache Busting**: Increment version number in:
- `<link rel="stylesheet" href="css/styles.min.css?v=X.X">`
- `<link rel="preload" href="css/styles.min.css?v=X.X">`
- `<script src="js/functions.min.js?v=X.X">`
- `<script src="js/academy-labs.min.js?v=X.X">` (academy.html only)
- `<meta name="acad-build" content="X.X">` in academy.html's `<head>`, AND `academy-version.txt` at repo root — both must match the new version, or the live-update toast (see below) fires spuriously on every visit.

**Minify labs JS**: `npx terser js/academy-labs.js -o js/academy-labs.min.js -c -m`

**Academy live-update toast** (added 2026-07-13): since GitHub Pages is static (no push channel), `initAcademy()` in functions.js polls `academy-version.txt` and compares it to the page's own `<meta name="acad-build">`, light on the server by design: once every 24h, on tab `visibilitychange`→visible, and whenever `showLesson()` crosses into a new track (not on every lesson turn). On mismatch it shows a dismissible `.acad-update-toast` ("New lessons & fixes are available." + Reload button) — safe because all progress lives in localStorage, so a reload loses nothing. Forgetting to bump `academy-version.txt`/the meta tag on a deploy just means the toast won't fire for that deploy (not harmful); bumping them without a real deploy would falsely prompt everyone to reload, so always bump together with the real `?v=` cache-bust, from the same commit that ships.

---

## Quick Reference

**Key Functions**: `toggleAndSaveTheme()`, `initSmoothScrolling()`, `initBootstrapComponents()`

**Sections**: #navbar, #home, #solutions, #tools, #academy-promo, #products, #technologies, #clients, #process, #faq, #contact; academy.html: #acadHub, #acadReader; landing pages: /mcp-security, /ai-agent-security, /api-security

**Verification**: See [.claude/skills/verify/SKILL.md](.claude/skills/verify/SKILL.md) — serve locally + Playwright across all 4 themes and 3 viewports; check FA glyphs render (CDN is FA 6.4.0) and no 404s

**File Sizes**: index.html (19KB), styles.css (31KB), functions.js (6KB), images (568KB), terms.html (226KB)

**Browser Support**: Modern browsers only (ES6+, CSS Grid, Flexbox), no IE11

---

## Future Improvements / TODO

**Parked 2026-07-17 — needs Akhil's input before building**:
- **Blog / "Field notes"** — only when Akhil commits to feeding it with content; seed with 2–3 vendor-neutral articles distilled from Academy material
- **About page** — needs founder story / mission input from Akhil
- **Client testimonials / mini case studies** — Akhil is collecting real quotes from Enkrypt AI / Cequence / I'Curity; never fabricate quotes or outcomes

**Performance**: Image lazy-loading below the fold; optimize terms.html size (226KB)

**Features**: Analytics; contact form (needs a backend — Cloudflare Worker + Turnstile is the natural fit)

**Accessibility**: Focus-state audit across the 4 themes

**Recurring**: `Expires:` in `.well-known/security.txt` is auto-renewed by `.github/workflows/security-txt-renew.yml` (monthly check, bumps +1 year when <60 days remain, commits directly). No manual action unless the repo goes dormant >60 days and GitHub disables the schedule.

---

> Update this file when significant architecture, design, or structure changes occur.
