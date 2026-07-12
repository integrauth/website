# CLAUDE.md - IntegrAuth Website

> **Last Updated**: 2026-07-11
> **Project**: IntegrAuth Official Website
> **Repository**: github.com/integrauth/website
> **Contact**: akhil@integrauth.com

---

## Overview

Enterprise-grade IAM, API Security, and AI Security company website. Static single-page application deployed on **integrauth.com** via GitHub Pages.

**Core Services**: AI & Agent Security (agent authentication, non-human identities, MCP security & secure MCP libraries, FGA/ReBAC, AI integrations), Enterprise IAM, API Security Gateway, Cloud Integration (AWS/Azure/GCP), Enterprise SSO

**Brand line**: "Identity & Security for Humans, Machines & AI Agents" (AI-first rebrand, 2026-07)

**Tech Stack**: HTML5, CSS3, JavaScript ES6+, jQuery 3.7.1, Bootstrap 5.3.3, Font Awesome 6.4.0

**Deployment**: GitHub Pages (no build process, static files only)

**URL style**: ALL internal links are extensionless (`/academy`, `/privacy`, `/#contact`, `/` for home) — GitHub Pages resolves `/academy` → `academy.html`. Never link `*.html` directly; canonicals and sitemap.xml are extensionless too.

---

## Project Structure

```
website/
├── index.html, academy.html, privacy.html, terms.html, support.html, cancellation.html
├── css/styles.css (~126KB, 5550 lines)
├── js/functions.js (~27KB, 735 lines)
├── js/academy-labs.js (~400KB — labs framework + flow-player engine (12 canonical flow definitions) + final-exam/certificate engine + 88 simulated labs; loaded ONLY by academy.html)
├── images/
│   ├── social-icons/ (11 icons)
│   └── websites/ (43 tech logos, 568KB)
└── IntegrAuth.svg, site.webmanifest, CNAME
```

---

## Key Architecture

### Page Sections (index.html)

1. **Navbar** - Fixed top, smooth scroll, theme picker dropdown (Light / Dark / High Contrast / Midnight Cyber), responsive menu. Order: Home, Services, Tools, Academy (/academy), Products, Stack, Clients, Contact. Scroll-spy matches nav links by `href="#id"` (not index), so non-section links like Academy are safe anywhere in the nav
2. **Hero** - Animated gradient background (15s), logo, tagline "Identity & Security for Humans, Machines & AI Agents", subtitle listing core services (no feature cards — they duplicated the Services marquee and were removed 2026-07)
3. **Academy promo banner** (`#academy-promo`, a `<div>` not a `<section>`, placed right after the Hero, pulled up with negative margin) - animated-gradient `.acad-banner` split layout: eyebrow pill + title + copy + `.acad-stat` chips on the left, white CTA button to /academy on the right, and a full-width `.acad-banner-tracks` grid of 11 mini track cards (num pill + name + one-line summary, each linking to `/academy#<track>0-start`) below
4. **Solutions** - Single auto-scrolling marquee row (`.services-marquee > .services-track > .service-slide`) with all 12 service cards; each card carries a `.service-tag` category pill ("AI & Agent Security" on the first 5: AI Integration Services, Agent Auth & Non-Human Identity, MCP Security & Secure Libraries, Fine-Grained Authorization, Securing AI Applications; "Identity, API & Engineering" on the last 7: Cloud-Native IAM, API Security Consulting, Enterprise SSO, Custom Software Development, Architecture & Design, Customer Identity & Advanced Authentication, Identity Threat Detection & Response). Marquee pauses on hover/focus/touch, supports mouse drag + native touch scroll, loops seamlessly via cloned slides, and respects `prefers-reduced-motion`
5. **Free Security Tools** (`#tools`) - 27 micro-tool cards linking to `*.integrauth.com` subdomains, split into two Bootstrap-collapse groups (`#tools-ai` 5 tools, `#tools-iam` 22 tools), both collapsed by default; each group header is a full-width `<button class="tools-group-header">` bar (icon + title + subtitle + "N tools" count pill + chevron flip), themed for all 4 themes
6. **Products** - 5 products (Smartable, Wrenchub, oidcscan, hallbook, waterflow — the last three live at `<name>.integrauth.com`, logos `images/<name>-logo.svg`) as an auto-scrolling marquee (reuses the `.services-marquee` framework, `data-direction="rtl"`, slides are `.service-slide.product-slide`) with a detail modal per product (`openProductModal(id)` → `#<id>-modal`); the marquee captures the pointer only after a 6px drag so card clicks still open modals, and the post-drag click is swallowed. hallbook/waterflow modals carry a sales-led "contact us" onboarding CTA (their public signups are disabled behind `PUBLIC_SIGNUPS_ENABLED`, off by default, in their own repos). Followed by a "We Also Build Websites" sub-block (inside `#products` so the scroll-spy section↔nav-link index mapping stays intact): 3 demo cards reusing `.tool-card` styling (with `.demo-icon` accent) linking to restaurant-demo / hospitals-demo / schools-demo `.integrauth.com` — each demo showcases switchable design variants (24 / 15 / 12) — plus a `.tools-cta` line linking to `#contact`
7. **Tech Stack** - 17 collapsible categories, all collapsed by default (headers ship `aria-expanded="false"` + `collapsed-card` class, grids without `.show`), incl. Authorization & Policy (OpenFGA, OPA), Agent Identity & NHI (OAuth 2.1, Token Exchange, mTLS, service accounts, JWT), AI Tools, AI Agent Frameworks, AI Model Providers, AI Security & Guardrails (MCP Gateways, Enkrypt AI Guardrails, LiteLLM)
8. **Clients** - Enkrypt AI, Cequence AI, I'Curity Solutions
9. **Contact** - Email and social links, plus closing hero
10. **Footer** - Legal pages links

### IntegrAuth Academy (academy.html, added 2026-07-11)

Standalone free-learning page: 11 tracks / 111 byte-sized lessons (Foundations ×14, Modern Authentication ×13, Token Security ×10, AI & Agent Security ×12, Identity Operations ×9, Authorization & API Security ×9, Protocols & Federation ×9, Identity Attacks & Defenses ×10, Customer Identity CIAM ×9, Cloud & Workload Identity ×8, Identity Architecture ×8 — 8 gap lessons added 2026-07-12: authn a11-magic/a12-idv, tokens t8-validation/t9-opaque, ai ai9-injection/ai10-a2a/ai11-audit, ops o8-recon; each inserted before its track quiz which was renumbered), originally ported (genericized, standards-based) from a client sample app's learning modules and since extended (2026-07-12: Track 6 "authz" az0–az8; gap lessons t7-birth, a10-sessions, o6-reviews, o7-breakglass). Every track opens with a ★ "Start here" intro lesson (`*0-start`, data-num="0" — chip/TOC render ★ — chnum "<TRACK> · START HERE", `.acad-arc` roadmap list, one journey-line SVG, NO lab and NO `.acad-try`; intros are exempt from the every-lesson-has-a-lab rule). Track keys/labels live in `TRACK_LABELS` inside `initAcademy()` (functions.js) — adding a track means a new entry there + a hub card. DOM order of `.acad-lesson` sections = pager order and defines display numbering (data-num is display-only; lesson ids are stable localStorage/hash keys and never renumbered — e.g. t7-birth displays as Token Security lesson 1). Every track ends with a "Cheat sheet & pop quiz" recap lesson (f12/a9/t6/ai8/o5/az8/p8/atk9/c8/w7/r7-quiz): distilled-ideas table + track-specific quick-reference table + 5 scenario questions using the static `.acad-quiz` reveal pattern (no JS needed to add one; also bump the hub TOC, `.acad-track-done` count, and the "N lessons" stat chips on academy + index promo). Structure:

- **Hub** (`#acadHub`): 11 `.acad-track-card`s with static lesson TOCs (SEO/noscript-friendly); each card carries a `.acad-track-num` "Track N" pill (order: foundations 1, authn 2, tokens 3, ai 4, ops 5, authz 6, proto 7, atk 8, ciam 9, cloud 10, arch 11 — reader label mirrors it as "Track N · Name"). The hub also injects (via initAcademy, no-JS-safe): a **lesson search** box (`.acad-hub-search`, filters all lessons by title+lead), **persona learning paths** (`.acad-paths`: 4 role cards Developer/Architect/Security-analyst/PM, each an ordered cross-track playlist from PERSONA_PATHS in functions.js — unknown ids auto-skip), and **glossary tooltips** (`.acad-term` spans hover/focus → `.acad-tip` popover, definitions harvested from f11-glossary dt/dd); below the cards sits the **Flow Explorer** panel (`#acadFlows`, a hub-level `.acad-lab` `data-lab="lab-flows"`): a 12-flow picker rendering animated SVG sequence diagrams via the flow-player engine — `AcadLabs.defineFlow(id, {title,tag,intro,outro,actors,steps})` registry + `h.flowPlayer(refOrDef)` helper in academy-labs.js (step-by-step reveal, plain-English narration + optional HTTP snippet, Back/Next/Auto-play, ax-*/--acad-* theming, `.acad-seq-*` CSS block in styles.css); flows: oidc-code, webauthn, refresh-rotation, dpop, backchannel-logout, saml-sp, saml-idp, client-creds, device, token-exchange, ciba, scim-provision — lesson labs may embed any via h.flowPlayer. Also a **Final Exam** panel (`#acadExam`, `data-lab="lab-exam"`): 25 questions randomized from `ACAD_EXAM_POOL` (46 Qs across all tracks) in academy-labs.js, 80% to pass, ≥80% unlocks a canvas-rendered certificate PNG (learner types name; brand tagline; client-side only; localStorage `acad_exam`). `.acad-exam-*`/`.acad-cert-canvas` CSS in styles.css. Grow ACAD_EXAM_POOL with each new track; `#acadResetAll` in `.acad-hub-foot` clears ALL progress behind a confirm()
- **Reader** (`#acadReader`): one-lesson-at-a-time via `initAcademy()` in functions.js — hash routing (`#lesson-id`), chip nav per track, prev/next pager, localStorage progress (`acad_pos`/`acad_read`/`acad_quiz`), quiz reveal buttons, glossary live filter (input injected by JS). Reset buttons are track-scoped: `.acad-reset-track` (top toolbar `#acadReset` + `.acad-reader-foot` bottom bar, which also has an "All tracks" `data-goto="__hub__"` button) clears only the active track's read marks + quiz reveals via `resetTrack()`, then returns to the hub. `*-quiz` recap lessons don't mark read on open: per-question reveals are tracked in `acad_quiz` with a JS-injected `.acad-quiz-progress` line + per-question ✓, and the lesson counts as read only after all 5 answers are revealed
- **Lessons**: `<section class="acad-lesson" data-track data-num data-short data-title>`; content blocks: `.acad-chnum`, `.acad-lead`, `.acad-grid`/`.acad-card`, callouts `.acad-box.acad-{analogy,story,why,watch}`, `.acad-table`, `.acad-try` (links to the free tools), `.acad-quiz`, `.acad-glossary`
- **Diagrams**: hand-authored inline SVG `<figure class="acad-fig">`, colored ONLY via `ax-*` classes (`ax-actor/ax-human/ax-bad/ax-atext/ax-life/ax-msg/ax-ret/ax-note/ax-em/ax-block/ax-ring/ax-arrowhead`) backed by `--acad-*` CSS variables themed per body class — never hardcode colors in lesson SVGs
- **Fictional cast** (keep consistent): Maya (customer), Sam (partner agent), Priya (employee), Bot A (RPA bot), Kai (AI agent), Zara (security operator)
- Vendor-neutral rule: lessons cite standards (RFCs, OpenID, W3C/FIDO, NIST) and open source (OpenFGA/OPA/SPIFFE) only — no IdP vendor or client names
- **Interactive labs** (added 2026-07-12): 88 fully simulated, client-side labs — `<div class="acad-lab" data-lab="lab-*">` placeholders inside EVERY lesson except the ★ intro lessons, the quiz recaps, and f11-glossary (which has its live filter instead), placed at the end of the lesson right before its `.acad-try` box, rendered by `js/academy-labs.js`: an IIFE framework (`AcadLabs.register(id, {title, blurb, render(root, h)})` + helper API `h.el/button/badge/panel/chip/fakeJwt/verifyJwt/tokenView/jsonView/httpCard/logPanel/meter/interval` — timers auto-clean on the built-in Reset). Real WebCrypto where it teaches (TOTP RFC 6238 HMAC-SHA1, SHA-1 k-anonymity); everything else deterministic simulation with correct RFC status/error codes; **no network calls ever**. Styled by the `.acad-lab-*` block at the end of styles.css (built on `--acad-*` tokens, all 4 themes). Adding a lab = placeholder div in the lesson + `AcadLabs.register` module appended to academy-labs.js + re-minify. The "90 hands-on labs" / "111 lessons" / "11 tracks" / "105+ diagrams" `.acad-stat` chips (academy hero + index promo) must track the real counts, as must the `0/111 lessons read` initial progress text (the "hands-on labs" count includes the two hub widgets lab-flows + lab-exam)
- ai3-rag also carries a "Beyond retrieval: what's replacing standard RAG" section: OKF (Open Knowledge Format, open vendor-neutral spec v0.1 mid-2026 — markdown + YAML frontmatter knowledge wiki), GraphRAG, agentic RAG, hierarchical chunking, hybrid retrieval + re-ranking, talk-to-data — each with an "identity checkpoint"

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

**After Minification**: Update cache version in index.html (e.g., `?v=1.7` → `?v=1.8`) for both CSS and JS references to ensure browsers load the new versions. And also update other html files like cancellation, privacy, support and terms.

**Cache Busting**: Increment version number in:
- `<link rel="stylesheet" href="css/styles.min.css?v=X.X">`
- `<link rel="preload" href="css/styles.min.css?v=X.X">`
- `<script src="js/functions.min.js?v=X.X">`
- `<script src="js/academy-labs.min.js?v=X.X">` (academy.html only)

**Minify labs JS**: `npx terser js/academy-labs.js -o js/academy-labs.min.js -c -m`

---

## Quick Reference

**Key Functions**: `toggleAndSaveTheme()`, `initSmoothScrolling()`, `initBootstrapComponents()`

**Sections**: #navbar, #home, #solutions, #tools, #academy-promo, #products, #technologies, #clients, #contact; academy.html: #acadHub, #acadReader

**Verification**: See [.claude/skills/verify/SKILL.md](.claude/skills/verify/SKILL.md) — serve locally + Playwright across all 4 themes and 3 viewports; check FA glyphs render (CDN is FA 6.4.0) and no 404s

**File Sizes**: index.html (19KB), styles.css (31KB), functions.js (6KB), images (568KB), terms.html (226KB)

**Browser Support**: Modern browsers only (ES6+, CSS Grid, Flexbox), no IE11

---

## Future Improvements

**Performance**: Image lazy-loading, CSS/JS minification, compress tech logos

**Features**: SEO meta tags, analytics, contact form, blog section, case studies

**Accessibility**: ARIA labels, keyboard navigation, prefers-reduced-motion

**Technical Debt**: Modularize CSS, optimize terms.html size (226KB)

---

> Update this file when significant architecture, design, or structure changes occur.
