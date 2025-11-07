# CLAUDE.md - IntegrAuth Website

> **Last Updated**: 2025-11-06
> **Project**: IntegrAuth Official Website
> **Repository**: github.com/integrauth/website
> **Contact**: akhil@integrauth.com

---

## Overview

Enterprise-grade IAM and API Security company website. Static single-page application deployed on **integrauth.com** via GitHub Pages.

**Core Services**: Enterprise IAM, API Security Gateway, Cloud Integration (AWS/Azure/GCP), Enterprise SSO

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

1. **Navbar** - Fixed top, smooth scroll, theme toggle, responsive menu
2. **Hero** - Animated gradient background (15s), logo, feature cards
3. **Solutions** - Cloud-Native IAM, API Security Gateway, Enterprise SSO
4. **Tech Stack** - IAM platforms, API gateways, languages, IaC, testing tools
5. **Clients** - Enkrypt AI, Cequence AI, I'Curity Solutions
6. **Contact** - Email and social links
7. **Footer** - Legal pages links

### Design System (css/styles.css)

**Colors**: Primary `#6366f1`, Gradient `#667eea → #764ba2`, Dark mode `#0f172a`

**Typography**: Inter font, fluid sizing with `clamp()`

**Spacing**: xs (4px) to 4xl (96px)

**Features**: Glassmorphism, gradient animations, dark mode, responsive

**Key Animations**: `gradientShift` (15s), `float` (20s), `textGlow` (3s)

### JavaScript (js/functions.js)

**Theme Management**: `toggleAndSaveTheme()`, localStorage persistence, system preference support

**Navigation**: Smooth scroll with custom easing, active link highlighting

**Bootstrap**: Tooltips, popovers initialization

---

## Supported Technologies

**IAM**: Auth0, Keycloak, Oracle IDM, Supabase

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

**After Minification**: Update cache version in index.html (e.g., `?v=1.7` → `?v=1.8`) for both CSS and JS references to ensure browsers load the new versions. Also update it in all other files like privacy.html, terms.html, support.html, cancellation.html, etc.

**Cache Busting**: Increment version number in:
- `<link rel="stylesheet" href="css/styles.min.css?v=X.X">`
- `<link rel="preload" href="css/styles.min.css?v=X.X">`
- `<script src="js/functions.min.js?v=X.X">`

---

## Quick Reference

**Key Functions**: `toggleAndSaveTheme()`, `initSmoothScrolling()`, `initBootstrapComponents()`

**Sections**: #navbar, #home, #solutions, #technologies, #clients, #contact

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
