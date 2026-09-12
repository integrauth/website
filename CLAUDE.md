# CLAUDE.md - IntegrAuth Website

> **Last Updated**: 2026-09-11
> **Project**: IntegrAuth Official Website — github.com/integrauth/website — akhil@integrauth.com
> Keep this file lean: record decisions and gotchas that would otherwise be re-learned the hard way, not change history. `docs/` holds the long-form records.

---

## Overview

Company site for IAM, API security and AI-agent security engineering, plus the free **IntegrAuth Academy** (`/academy`). Hand-written HTML/CSS/JS with no front-end build step (only minify scripts); the Worker is TypeScript bundled by Wrangler.

**Brand line**: "Identity & Security for All — Humans, Machines, RPA bots & AI Agents".

**Stack**: HTML5, CSS3, ES6+, jQuery 3.7.1, Bootstrap 5.3.3, Font Awesome 6.4.0, Inter.

**Deployment**: **Cloudflare Worker** (`wrangler.toml` + `src/worker.ts`) serving the repo root as static assets (`[assets] directory="."`, `not_found_handling="404-page"`, `html_handling="auto-trailing-slash"`) and running `/api/academy/*`, `/api/contact` and `/auth/*`. **`run_worker_first` must list every prefix the Worker dispatches on** — a missing prefix is answered by the asset server and 404s on a route that looks correctly implemented. Custom-domain `routes` for integrauth.com + www. `workers_dev = true` exists ONLY so CI's smoke probe / signing-key check have a URL outside Bot Fight Mode; nothing links to it and it is deliberately not a registered OIDC redirect. Every push to `main` deploys to production (`.github/workflows/deploy.yml`; `CF_TOKEN` needs Workers Scripts:Edit, Workers Routes:Edit, DNS:Edit, Zone:Read, D1:Read). Local: `npm run worker:dev`, never bare `wrangler dev` (the assets dir is the repo root, so wrangler's own `.wrangler/` state retriggers its watcher — see wrangler.toml). GitHub Pages is retired. Security headers: `_headers` for static responses, `src/lib/server/security.ts` for API responses — keep them in sync. `.assetsignore` lists what must never be published (`.github`, `docs/`, `*.md`, `.dev.vars`, …).

**Analytics**: Cloudflare Web Analytics beacon on every page (pageviews/Core Web Vitals only; no custom events by decision, 2026-07-18). support/privacy/cancellation have no closing `</body>` (minifier), so the snippet sits at EOF there.

**URL style**: every internal link is extensionless (`/academy`, `/#contact`, `/`); canonicals and sitemap.xml too. Never link `*.html`.

---

## Project Structure

```
index.html, academy.html, products.html, privacy.html, terms.html, support.html, cancellation.html, verify.html, 404.html
mcp-security.html, ai-agent-security.html, api-security.html   # SEO service landing pages
.well-known/security.txt      # RFC 9116; Expires auto-renewed monthly by security-txt-renew.yml
src/worker.ts + src/lib/server/{api,auth,oidc-rp,session,store,certs,exam,ip,sweep,contact,contact-validate,security,env}.ts
wrangler.toml, _headers, .assetsignore, tests/*.test.mjs (`npm test`)
css/styles.css (~270KB, ~10.4k lines)   js/functions.js (~145KB)   js/academy-auth.js (~70KB, every page)
js/academy-labs.js (~700KB: labs + flow player + exam + drill; academy.html only)
images/og-banner.png (1200×630 share card), images/websites/ (tech logos), images/social-icons/
IntegrAuth.svg, site.webmanifest, academy-version.txt
```

12 HTML pages. All carry the full favicon set, the manifest link, the shared `.site-footer` (byte-identical markup — edit with a script across all pages), the navbar with the Services ▾ / Learn ▾ dropdowns and the `#acadAuthNav` sign-in control. 404.html uses ABSOLUTE asset paths (it serves at any depth). `index.html` and `academy.html` are minified single-line files — edit them with a script that asserts each target string occurs exactly once.

---

## index.html

**Order (2026-09-12, social-proof-first)**: `#home` hero → `#testimonials` → `#academy-promo` → `#who` (Who We Work With) → `#clients` → `#solutions` → `#process` → `.lab-showcase-wrap` → `#tools` → `#technologies` → `#faq` → `#contact` → `.trust-ticker` → footer. Reordering is safe: scroll-spy matches by id, print CSS targets ids. Products (6 modals + "We Also Build Websites") live on `/products`.

- **Navbar**: Home, Services ▾, Clients, Tools, Learn ▾ (Academy, The Lab ↗, Verify a Certificate), Products, Stack, Contact, then the theme picker (Light / Dark / High Contrast / Midnight Cyber). Services/Learn are Bootstrap-native dropdowns; the THEME picker is a manual JS dropdown detached to `<body>` — don't unify them; it gets hover-open via `themeHoverOpen/Close` in functions.js, and its click handler treats the first click after a hover-open as confirming the open menu (else clicking is a no-op on desktop). `.navbar { z-index: 1030 }` is load-bearing (the hero's stacking context otherwise paints over open menus). `.acad-auth-item { display:flex }` must stay inside `@media (min-width: 992px)` — below that Bootstrap collapses `.dropdown-menu` to static flow and a flex `<li>` floats the menu beside the avatar; the account menu's `:hover`-open rule must set `position:absolute; top:100%; right:0; left:auto` itself because Bootstrap's popper attributes are only set by its JS `show()`.
- **Hero**: animated gradient + `initHeroConstellation()` canvas, positioning subtitle, `.hero-actions` (`.hero-cta-alt` needs `.hero-section .hero-actions` specificity to beat `body.bg-dark .btn-outline-light`), `.hero-logos` client strip, `.hero-scroll-cue` (z-index 6, above the pulled-up promo card).
- **Academy promo** (`#academy-promo`; `.acad-banner-wrap` is pulled up by `-3rem` over whatever precedes it — `.testi-section + .acad-banner-wrap` zeroes that while testimonials sit above it): `.acad-banner` with `.acad-stat` chips + a collapsed `#acadBannerTracks` grid of 12 mini track cards linking `/academy#<track>0-start`.
- **Who** (`#who`): 3 `.process-step.who-card`s for the three client types (security/AI product vendors, data/AI platforms, enterprises/integrators).
- **Clients** + **Testimonials**: both `.services-marquee` instances (`.client-slide`, `.testi-slide`). Only real quotes (Cequence AI, CloudRaft/Covara, Enkrypt AI) — never a placeholder or invented quote; every card opens with a `.testi-stars` 5-star row (`role="img"`, amber, black in High Contrast). The I'Curity card's MTN mark needs the dark `.partner-logo` chip in all themes.
- **Solutions**: one marquee of 16 `.service-slide` cards with `.service-tag` pills (5 "AI & Agent Security", 11 "Identity, API & Engineering"; corporate training deliberately omitted). Plus a "Deep dives" `.tools-cta` line to the 3 service pages.
- **Process** (`#process`): 4 phases + a full-width step 5 (retainers). Not in the navbar.
- **Lab showcase**: one compact card, a handful of highlights only — the Lab repo's README is the source of truth (59 practicals as of 2026-07-27).
- **Tools** (`#tools`): 27 tool cards in two collapsed groups (`#tools-ai` 5, `#tools-iam` 22) + the `.scan-teaser` oidcscan GET form (`?issuer=` deep link verified against oidcscan's bundle).
- **Tech Stack**: 17 collapsed categories (`tech-category-header` + `collapse`).
- **FAQ**: 10 `.faq-item`s mirrored by a FAQPage JSON-LD block. Keep them in sync in substance; four answers intentionally differ in phrasing so the JSON-LD reads standalone (Q1/Q3 "We're"→"IntegrAuth is" + no sales line, Q2 drops the engage link, Q6 drops the MCP link) — don't "fix" those.
- **Contact**: `#contactForm` → `POST /api/contact` (Hono, Origin+JSON CSRF guard, Turnstile siteverify, Resend relay, no storage; `contact-validate.ts` is pure and tested). Secrets `RESEND_API_KEY` + `TURNSTILE_SECRET_KEY` come from GitHub Secrets via deploy.yml; unset ⇒ 503 and the form falls back to a prefilled mailto. `CONTACT_FROM`/`CONTACT_TO` are `[vars]`; the sender domain must be verified in Resend. `#contact .social-icons-grid` is left-aligned ≥992px to match the heading.
- **Trust ticker** (`.trust-ticker`, dark in every theme): chip numbers must track real counts (135 lessons / 102 labs / 27 tools / 59 Lab practicals / 16 flows / 12 tracks), like every `.acad-stat` chip and the FAQ.

### Products page (products.html, 2026-09-11 revamp)

support.html chrome + `.svc-hero.prod-hero` (h1 "We also build products" — the page must read as build-and-run, never resell; `.prod-nav` jump chips) → `#security` (`.prod-feature` oidcscan card embedding the same `.scan-teaser` GET form as index) → `#business` (`.prod-grid` of 4 `.prod-card`s) → `#free` (sunnahfast) → `#websites` (3 `.tool-card` demos) → CTA band. Cards are `<article onclick=openProductModal()>` plus a real `Details` button; the 6 detail modals (`#<id>-modal`, demo-loop SVGs) are unchanged. CSS lives in the "Products page revamp" block at the END of styles.css, themed via `--acad-*` tokens; `.product-badges` is shared with the modals, everything else `.product-*` was deleted. GOTCHA: `body.theme-contrast a` blanks white-on-black links — `.prod-nav a`/`.svc-crumb a` pin `color:#fff !important`.

### Service landing pages (mcp-security / ai-agent-security / api-security)

support.html chrome (blocking CSS, no boot loader) + `.svc-hero` → `.svc-list` → "What We Deliver" `.tool-card`s → "Learn It Free First" (`#mcp-learn`/`#agent-learn`/`#api-learn`, links to `/academy#<lesson>`) → free-tools grid → CTA band. Service + BreadcrumbList JSON-LD, in sitemap at 0.8. mcp-security.html is the exemplar to clone (then add to sitemap, footers, FAQ). GOTCHA: `.svc-hero .btn-outline-light` must pin `color`/`border-color` to `#fff` — `body.bg-dark .btn-outline-light` and `body.theme-contrast a` otherwise win the cascade and the buttons vanish.

---

## IntegrAuth Academy (academy.html)

12 tracks / 135 lessons / 102 labs (98 in-lesson + drill, flows, challenge, exam) / 130 diagrams. Track order and keys: basics 0, foundations 1, authn 2, tokens 3, authz 4, proto 5, ai 6, ops 7, atk 8, ciam 9, cloud 10, arch 11 — the same order must hold in `TRACK_LABELS` (functions.js), hub card DOM order, lesson-section DOM order and the index promo grid. Lesson ids are stable localStorage/hash keys and are never renumbered; `data-num` is display-only and DOM order defines the pager. Every track: a ★ `*0-start` intro (no lab, no `.acad-try`), lessons each with a `.acad-lab` placeholder, a `*-summary` "big picture" lesson (no lab) and a `*-quiz` cheat-sheet lesson whose "Track complete" box hands off to the NEXT track (keep those handoffs in sync if tracks move — the 2026-08-20 audit found four broken). Adding a lesson: bump the hub TOC, `.acad-track-done` count, the `0/135` initial text, and every "N lessons" chip (academy hero, index promo, index FAQ + JSON-LD, trust ticker). `ACAD_EXAM_POOL` grows per TRACK (8 each), not per lesson.

Rules: vendor-neutral (standards + open source only); fictional cast Maya (customer), Sam (partner), Priya (employee), Bot A (RPA bot), Kai (AI agent), Zara (security ops); diagrams are inline SVG `<figure class="acad-fig">` coloured ONLY via `ax-*` classes backed by `--acad-*` theme variables; labs never make network calls (real WebCrypto only where it teaches).

**Hub** (`#acadHub`): 12 `.acad-track-card`s with static `.acad-track-toc`s (SEO/no-JS), then Daily drill `#acadDrill` (Leitner boxes in localStorage `acad_drill_v1` only — deliberately local, not wiped by the account-ownership wipe), Flow Explorer `#acadFlows` (16 flows from the `AcadLabs.defineFlow` registry, enumerated via `flowIds()`), Challenge mode `#acadChallenge` (10 scenarios), Final exam `#acadExam`, then `#acadAccount`. `initAcademy()` injects (no-JS-safe): lesson search, persona paths (`PERSONA_PATHS`), glossary tooltips (from f11-glossary), the Resume banner (first child; boot never opens a saved lesson passively — the banner is the explicit way back), and the `#acadTourBtn`. Widgets chain via `.acad-flowx-next-btn` `data-goto="__drill__|__flows__|__challenge__|__exam__|__hub__"` → `showHub(id)` scroll + `.acad-hub-pulse`. `HUB_ANCHORS` routes `#acadDrill` etc. hashes to `showHub(id)`.

**Reader** (`#acadReader`): hash routing, chips, pager, ←/→ keys (not inside inputs/labs), `~N min read` chip, lesson-scoped scroll-progress bar. Progress keys `acad_pos`/`acad_pos_at`/`acad_read`/`acad_quiz` (+ `acad_epoch`, `acad_owner`, `acad_exam`). **Read-marking**: lessons with a lab mark read on first interaction inside the lab (`.acad-lab-gate` line); lab-less lessons on open; quizzes after all 5 reveals. **Position rules** (load-bearing for multi-device sync): `showLesson()` always restamps `acad_pos_at` (every caller is a deliberate move); only the explicit "All tracks" back-out (`__hub__`) and a track reset drop the position, and they write a fresh `acad_pos_at` TOMBSTONE rather than clearing it — the merge adopts the server position when `!localAt || serverAt > localAt`, so a cleared timestamp makes adoption unconditional and dumps the learner back into the lesson they just left. Deep links, widget chaining, the tour, Back and boot all keep it. Last lesson overall → pager offers the hub widgets (`__drill__`), not the track grid.

**Exam & certificates** (the ONLY sign-in-gated part): lab-exam gates on all-lessons-read first, then sign-in. Grading is server-authoritative (`exam.ts`, client sends choices; `EXAM_ANSWER_KEY` must match `ACAD_EXAM_POOL` `a` values — drift surfaces as `invalid_answers`). 3 attempts per rolling 24h per ACCOUNT and per NETWORK (`ip_hash`, peppered SHA-256 of CF-Connecting-IP, scrubbed after the window; 429 carries `scope` + `nextAttemptAt`). `GET /exam/attempts` returns `{attempts, limits}`. Certificates: server mints an unguessable `IA-XXXX-XXXX-XXXX` serial (public `/certificates/verify/:serial` must not become an enumeration oracle); the ES256 JWT is a secondary artifact with `sub` = `jti` = serial and NO email/account claim; profile name is locked at first issuance. The browser only renders what the server returns — **never reintroduce a browser-computed certificate id**. `/verify` is a D1 serial lookup, not a signature check. Copy that must stay true when any of this changes: privacy.html, terms.html §4+§8, index FAQ + JSON-LD, academy exam subtitle, the `lab-exam` blurb + `ATTEMPTS_PER_DAY` in academy-labs.js.

**Tour**: `ACAD_TOUR` steps + `.acad-tour-spot` CSS spotlight (giant same-element box-shadow). Auto-offered once on a fresh hub landing (no hash, no saved position, `acad_tour_seen`). `showLesson()` ends a running tour.

**Live-update toast**: `initAcademy()` polls `academy-version.txt` against `<meta name="acad-build">` on tab-visible and on track change; mismatch → reload prompt. See Cache Busting.

**Print**: `@media print` prints the active lesson clean; theme body rules are two-class `!important`, so print overrides repeat those selectors to win on specificity.

**Page revamp (2026-09-11, visual-only)**: CSS in the "Academy page revamp" block at the END of styles.css, scoped to `.acad-hero`/`#acadHub` because `.acad-stat`/`.acad-box` are shared with index. Hero: eyebrow, `.acad-hero-word` shimmer, CTAs (`#b0-start` via the `a[href^="#"]` delegate; `#acadTracks` is a plain anchor on the "Pick a track" row), orbs, CSS ticker. **The hero collapses to a slim band while the reader is open** (`main:has(#acadReader:not([hidden])) .acad-hero`) because `showLesson()` scrolls to top on every turn. Hub: `.acad-hub-top` dock (ids unchanged), `.acad-kicker` + `.acad-cast` chips, `.acad-aurora` blobs (absolute wrapper with its own overflow — never put `overflow` on `.acad-shell`, it breaks the sticky toolbar). Track cards: `--tk` accent per `data-track` (black in High Contrast), `.acad-track-bar` driven by `--track-pct` + `.is-complete` (set in `updateProgress()`), `.acad-track-start` → `*0-start`, TOC inside a closed `<details class="acad-track-more">` (still in the DOM; read-marking untouched). Lab CTA sits BELOW the grid, then `.acad-path-nav` (plain `#acadDrill`… hash links). Widgets are `#acadHub .acad-flowx` cards with `.acad-widget-eyebrow`. Reader: glass `.acad-toolbar` sticky at `top:72px` ≥768px, chips snap-scroll under 768px, pager capped to 860px and stacked under 576px. Everything animated stops under `prefers-reduced-motion`.

---

## Accounts, shared SSO & the Academy API

> `docs/ACCOUNTS-ARCHITECTURE.md` = ownership table, where-to-change lookup, secrets table, deploy order (keep current). `docs/HANDOFF-academy-sso.md` = full build/audit history. `docs/LEARNING-PLATFORM-BLUEPRINT.md` = the reusable pattern, deliberately NOT kept in lockstep with this repo.

Optional accounts, **shared with lab.integrauth.com** (same `users` row, same D1 `lab-db` bound as `DB`). **Sign-in is OIDC (Authorization Code + PKCE S256) against the Lab's OP, never a shared cookie**: a `Domain=.integrauth.com` session cookie was built, found to be a session-fixation hole (any of ~30 sibling hosts could set it — `__Secure-` only demands TLS, `__Host-` forbids `Domain`), and reverted before deploying. Never reintroduce it. Two corollaries: siblings are still SAME-SITE, so `SameSite=Lax` protects nothing between them — the Origin allowlist + `application/json` requirement in `guardStateChanging` (api.ts) is load-bearing CSRF defence; and `sessionCookieName` keys the unprefixed dev cookie name on HOSTNAME (`localhost`/`127.0.0.1`), never on URL scheme (a plaintext `http://integrauth.com` request would otherwise get an unprefixed cookie a sibling can overwrite).

- **Ownership**: the Lab owns `users`, `sessions`, the whole account lifecycle (OTP, TOTP, revoke-all, erase — `erasure.ts` cascades to every Academy table; **this repo never implements deletion**, it links to lab.integrauth.com/account) and is the OP. This repo owns `website_sessions` (cookie `__Host-ia_web_session`, minted only by the OIDC callback), `profiles`, `academy_lesson_progress`, `academy_quiz_progress`, `academy_last_position`, `academy_exam_attempts`, `academy_certificates`, `academy_progress_epoch` — all via `store.ts`. It reads `users` (status + email) and never writes a Lab-owned table or runs migrations against `lab-db`.
- **RP surface** (`auth.ts` + `oidc-rp.ts`): `GET /auth/start` (PKCE + state + nonce in `__Host-ia_oidc_tx`), `GET /auth/callback` (validates `state` BEFORE honouring `?error=` — `fail()` clears the tx cookie, so a third-party page could otherwise kill an in-flight login), `GET /auth/session` (the only route that re-issues the cookie), `POST /auth/logout`, `/logout-all`, `/sessions/revoke`, `POST /auth/backchannel-logout` (signed `logout+jwt`, exempt from the Origin guard). Client id `integrauth-website`, scope EXACTLY `openid email` (must equal the Lab's seeded grant or returning users see a consent screen). No access/refresh token retained. `/auth/*` has its own `onError` rendering the closing/redirect page, not JSON.
- **Sign-in UX**: full-page redirect (`signIn()` → `/auth/start?mode=redirect`; `#acadAuthSignIn` is a real link that works with JS off). The server still supports `mode=popup` + the `acad_auth_event_v1` localStorage handshake (constant duplicated in auth.ts and academy-auth.js — keep equal). Being signed in at the Lab does not auto-sign-in here (no `prompt=none`, `frame-ancestors 'none'`) — it costs one click. "Sign out everywhere" = `POST /auth/logout-all` + a top-level navigation to the Lab's `/oidc/logout` (`navigateToLabLogout()`, auto-return only when the URI matches the Lab's `IA_WEBSITE_POST_LOGOUT_REDIRECT_URIS`).
- **Secrets** (all provisioned by deploy.yml "Sync Worker secrets", never by hand): `IA_WEBSITE_OIDC_SECRET` — one org-level GitHub Secret shared with the Lab, mirrored only, NEVER generated by either side (a generated value is unknowable to the other side ⇒ `invalid_client`). `ACADEMY_PRIVATE_JWK` — generated once, **never rotated**, not overridable: this repo has a single-key JWKS, so replacing the key is indistinguishable from deleting it (forwarded certificate JWTs silently stop verifying; `/verify` keeps working). Enforced by `.github/cert-signing-key.kid` (RFC 7638 thumbprint): the secrets step refuses to generate when a kid is recorded but the secret is absent, and a post-deploy step compares the LIVE JWKS kid (unreachable JWKS = fail). Accepting a rotation costs a reviewed commit to that file. If rotation is ever needed, grow the Lab's multi-key lifecycle instead. Fails CLOSED when unset (issuance + JWKS 500); the ephemeral dev key needs `ALLOW_EPHEMERAL_CERT_KEY=1` in `.dev.vars` only. `EXAM_IP_HASH_PEPPER` — mirrored if present, else generated; freely rotatable. Non-secret `[vars]`: `LAB_ISSUER`, `OIDC_CLIENT_ID`. The Lab's `IA_WEBSITE_REDIRECT_URIS` must list each production origin + `/auth/callback` (exact match, no trailing slash); the workers.dev host is intentionally unregistered.
- **API** (`api.ts`, Hono, `/api/academy`): `GET/PUT /profile`, `GET /progress`, `POST /progress/sync`, `POST /progress/reset`, `POST|GET /exam/attempts`, `POST /certificates/issue`, `GET /certificates`, `GET /certificates/:serial/jwt`; public: `GET /certificates/verify/:serial`, `GET /.well-known/jwks.json` (the only CORS route). Merge = UNION (read lessons `INSERT OR IGNORE`, quiz masks OR-ed, last position last-write-wins by caller ISO timestamp compared as a STRING — a far-future or non-canonical value wedges the position forever). Row growth bounded by daily caps + `MAX_STORED_LESSON_ROWS`/`MAX_STORED_TRACK_ROWS`. No general per-IP rate limiting (needs DO/KV; parked).
- **Reset epoch**: a union cannot express deletion, so `POST /progress/reset` bumps `academy_progress_epoch`; clients echo `acad_epoch` and a stale client's payload is ignored and replaced with post-reset truth (`applyServerProgress` REPLACES, not unions). Missing epoch = current (old JS keeps working); higher-than-server = stale. The epoch is re-checked inside each merge write's SQL, not just the route pre-check. `pushResetToServer()` cancels the pending debounced sync FIRST; `acadSyncGeneration` invalidates in-flight responses after a reset AND after the ownership wipe; a failed reset shows a retry toast.
- **Client** (`academy-auth.js`, `window.AcademyAuth`, every page): no cross-origin calls; session cached in `localStorage` `acad_auth_session_v1` (not sessionStorage — new tabs looked logged-out) and propagated via `storage` events; `academy-auth-changed` fires only on a real identity transition and carries `confirmed` (renderers may use the cache; WRITERS must wait for a server-confirmed session / `AcademyAuth.ready()`). `isApiAvailable()` probes `/auth/session` so static-only hosts degrade to account-free mode.
- **Local progress is owner-scoped** (`acad_owner`): sign-out or sign-in as a different user wipes `acad_read/quiz/pos/pos_at/exam/epoch` BEFORE any sync (else learner A's progress and passing exam landed in B's account). A passing `acad_exam` is stashed in `acad_exam_stash_v1` as a LIST keyed by owner, consumed only when actually restored, stashed on the account-switch branch too. `reconcileProgressOwner` lives in academy-auth.js (not `initAcademy()` — the boot event has always already fired by the time jQuery-ready listeners register, and other pages have no `initAcademy`) and runs only on a server-confirmed session (the fresh-profile cache reads as signed-out and would wipe a real learner). Both first-sync entry points (identity-transition listener AND boot with an already-signed-in session) must go through `claimAnonymousProgress()` — adopt the account's epoch, then merge — or an ever-reset account destroys the anonymous progress it should claim.

---

## Boot loader & async CDN CSS (index + academy)

Four pieces, keep in sync: (1) inline head script reads `localStorage.theme` (default `cyber`), stamps `data-boot-theme` + `html.site-boot`, arms a 5s failsafe; (2) inline critical CSS styles the loader and hides every other body child while `.site-boot`; (3) inline post-`<body>` script sets `body.className` for the theme synchronously; (4) `dismissBootLoader()` removes `.site-boot` after ≥700ms and once Bootstrap's CSS is in `document.styleSheets` (capped +4s). Fonts/Bootstrap/FA load async (`preload` + rel-swap + `<noscript>`). functions.js also raises the loader on same-site cross-page clicks and drops it on bfcache `pageshow`. Legal pages have none of this. Bootstrap's CSS loads AFTER styles.css, so a same-specificity override of a Bootstrap rule needs `!important` (e.g. `.popover-header`).

---

## Design system & CSS gotchas

Tokens in `:root` (`--primary-color #6366f1`, `--primary-gradient`, radii, shadows, `--transition`); Midnight Cyber overrides `--primary-color` to cyan. Academy tokens `--acad-*` per body class (`body`, `body.bg-dark`, `body.theme-contrast`, `body.theme-cyber`). Four themes must always be checked; High Contrast is pure black/white with no animation. Use `--acad-ink` for text, not `--acad-actor` (a diagram accent that is illegible as text on dark themes).

- Every `.btn` has an infinite `btnShine` sweep; `.theme-btn` opts out via the doubled-class trick, `.hero-cta` swaps it for a one-shot hover sweep.
- `.tool-card::before` is taken; card spotlight uses `::after`.
- Print blocks (Academy lesson, index one-pager) pin overrides with ids + `body[class][class]` twins; gradient text needs `-webkit-text-fill-color`; `.sr-item` must be forced visible in print.
- `.sr-item`/`.sr-in` are applied ONLY by JS (never in markup) so no-JS/reduced-motion visitors get static content.

---

## JavaScript (js/functions.js)

`applyTheme()`, `initServicesMarquee()` (rAF `scrollLeft` auto-scroll, pause on hover/focus/pointer, drag-to-scroll, seamless wrap; only HORIZONTAL wheel intent is hijacked; a delegated `dragstart` preventDefault stops native image/link drag from cancelling the custom drag), `initAcademy()` (academy only; also owns the debounced progress sync `localSyncSnapshot()` → `AcademyAuth.syncProgress()` → `applyServerProgress()`), `dismissBootLoader()`, `initContactForm()`.

Micro-interactions (2026-08-27/28): `initScrollProgress()` (lesson-scoped in the reader), `initScrollReveal()` (IO fade-and-rise, 70ms stagger, classes removed after reveal; skips elements above a `#hash` landing point; fast-scroll `.sr-fast` fallback; waits for `.site-boot` removal), `initStatCounters()` (`.acad-stat`/`.ticker-num` count-up — screenshots mid-animation show wrong numbers, markup is the truth), `initCardSpotlight()` (spot + ±3° tilt, mouse-only, off in contrast), `initHeroConstellation()` (canvas on `.hero-section/.err-hero/.acad-hero/.svc-hero`, node cap 76, DPR cap 2, runs only while visible, broken mode on 404, scroll dissolve, `window.__heroNetBurst()`), `initTrustTicker()`, `initSectionAuras()`, `initEasterEgg()` (type `whoami`), product modal `hideProductModal()` exit beat, `.demo-loop` SVG scenes in product modals (`.pd-tr` transients hidden under reduced motion — a scene's final frame must never depend on one). Smooth scroll is CSS; there is no Bootstrap tooltip/popover init beyond the `#acadBenefitsInfo` popover in academy-auth.js.

---

## Development

- CSS: custom properties, BEM-like names; one stylesheet. JS: ES6+, jQuery for DOM. HTML: semantic, Bootstrap 5.
- No raw control bytes in source (CI fails on them; they make files invisible to grep) — use `\x`/`\u` escapes.
- Verification: `.claude/skills/verify/SKILL.md` — serve locally + Playwright across 4 themes × 3 viewports, check FA glyphs and no 404s. Both min pages hide below-the-fold content until scrolled (scroll-reveal), and the sandbox blocks the CDNs (the skill explains the local-fallback route).

### Minification & cache busting

```bash
npm run build:css            # css/styles.min.css
npm run build:js:functions   # js/functions.min.js   (build:js:auth / build:js:labs likewise)
```
The site serves only `.min` assets. After rebuilding, bump `?v=` on `styles.min.css` (index has two refs: preload + stylesheet) and `functions.min.js` across ALL 12 HTML files (`grep -l 'styles.min.css?v=' *.html`), and `academy-labs.min.js`/`academy-auth.min.js` when those change.

> **EASY TO MISS**: any commit that bumps `styles.min.css` or `functions.min.js` is a deploy from an open Academy tab's point of view. Bump `<meta name="acad-build">` in academy.html AND `academy-version.txt` to the same next number in that same commit, or the live-update toast never fires (silently). Bumping them without a real deploy falsely prompts everyone to reload.

---

## Future / TODO

- Parked pending Akhil's input: blog/"Field notes", About page, more testimonials (never fabricate quotes).
- Performance: terms.html size. Features: per-IP rate limiting on `/api/academy/*` (DO/KV), custom-event analytics (first-party Worker + Analytics Engine). Accessibility: focus-state audit across the 4 themes.
- `security.txt` `Expires` is auto-renewed by `.github/workflows/security-txt-renew.yml`; only matters if the repo goes dormant >60 days.

> Update this file when architecture, structure or a load-bearing decision changes — as a rule, not a diary.
