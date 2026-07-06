# CLAUDE.md - IntegrAuth Website

> **Last Updated**: 2026-07-06
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

---

## Project Structure

```
website/
├── index.html, privacy.html, terms.html, support.html, cancellation.html
├── css/styles.css (31KB, 1353 lines)
├── js/functions.js (6KB, 192 lines)
├── images/
│   ├── social-icons/ (11 icons)
│   └── websites/ (43 tech logos, 568KB)
└── IntegrAuth.svg, site.webmanifest, CNAME
```

---

## Key Architecture

### Page Sections (index.html)

1. **Navbar** - Fixed top, smooth scroll, theme picker dropdown (Light / Dark / High Contrast / Midnight Cyber), responsive menu
2. **Hero** - Animated gradient background (15s), logo, tagline "Identity & Security for Humans, Machines & AI Agents", 6 feature cards (3×2 desktop, 2-across tablet)
3. **Solutions** - Single auto-scrolling marquee row (`.services-marquee > .services-track > .service-slide`) with all 10 service cards; each card carries a `.service-tag` category pill ("AI & Agent Security" on the first 5: AI Integration Services, Agent Auth & Non-Human Identity, MCP Security & Secure Libraries, Fine-Grained Authorization, Securing AI Applications; "Identity, API & Engineering" on the last 5: Cloud-Native IAM, API Security Consulting, Enterprise SSO, Custom Software Development, Architecture & Design). Marquee pauses on hover/focus/touch, supports mouse drag + native touch scroll, loops seamlessly via cloned slides, and respects `prefers-reduced-motion`
4. **Products** - Smartable, Wrenchub (cards + detail modals)
5. **Tech Stack** - 17 collapsible categories, incl. Authorization & Policy (OpenFGA, OPA), Agent Identity & NHI (OAuth 2.1, Token Exchange, mTLS, service accounts, JWT), AI Tools, AI Agent Frameworks, AI Model Providers, AI Security & Guardrails (MCP Gateways, Enkrypt AI Guardrails, LiteLLM)
6. **Clients** - Enkrypt AI, Cequence AI, I'Curity Solutions
7. **Contact** - Email and social links, plus closing hero
8. **Footer** - Legal pages links

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

---

## Quick Reference

**Key Functions**: `toggleAndSaveTheme()`, `initSmoothScrolling()`, `initBootstrapComponents()`

**Sections**: #navbar, #home, #solutions, #products, #technologies, #clients, #contact

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
