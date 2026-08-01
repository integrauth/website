# IntegrAuth Official Website

Official public-facing website for IntegrAuth - Enterprise-grade Identity and Access Management (IAM) and API Security solutions.

**Live Site**: [integrauth.com](https://integrauth.com)

---

## About

IntegrAuth provides:
- Enterprise-grade Identity and Access Management
- API Security solutions
- Cloud integration (AWS, Azure, GCP)
- Enterprise SSO (SAML, OAuth, OpenID Connect)

---

## Tech Stack

- **HTML5** - Semantic markup
- **CSS3** - Modern styling with custom properties
- **JavaScript (ES6+)** - Interactive functionality
- **jQuery 3.7.1** - DOM manipulation
- **Bootstrap 5.3.3** - Responsive framework
- **Font Awesome 6.4.0** - Icons
- **Google Fonts** - Inter font family

---

## Development Setup

### Prerequisites
- Node.js (for local development server)
- Git

### Getting Started

1. **Clone the repository**
   ```bash
   git clone https://github.com/integrauth/website.git
   cd website
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start development server**
   ```bash
   npm run dev
   # or
   npm start
   ```

   This will:
   - Start a local server at `http://localhost:3000`
   - Auto-open your browser
   - Enable hot reload on file changes
   - Watch all HTML, CSS, and JS files

4. **Make changes**
   - Edit files in your code editor
   - Save changes to see them instantly in the browser
   - No manual refresh needed!

### Project Structure

```
website/
├── index.html, academy.html, privacy.html, terms.html, support.html,
│   cancellation.html, verify.html, 404.html
├── mcp-security.html, ai-agent-security.html, api-security.html   # service landing pages
├── css/styles.css                  # main stylesheet
├── js/functions.js                 # site-wide JS
├── js/academy-auth.js              # accounts / sign-in, loaded on every page
├── js/academy-labs.js              # Academy labs framework, academy.html only
├── src/worker.ts + src/lib/server/ # Cloudflare Worker: static assets + /api/academy/* + /auth/*
├── images/
│   ├── social-icons/               # Social media icons
│   └── websites/                   # Tech stack logos
├── IntegrAuth.svg                  # Brand logo
├── wrangler.toml                   # Worker config
└── CLAUDE.md                       # Project memory for AI assistant
```

See `CLAUDE.md` for current file sizes and the full architecture — they drift with every change, so that file re-measures rather than this one hardcoding them.

### Available Scripts

- `npm run dev` - Start local dev server with hot reload (static preview only, no Worker)
- `npm start` - Alias for `npm run dev`
- `npm run worker:dev` - Local Worker dev (static assets + `/api/academy/*` + `/auth/*`) — see the gotcha comment in `wrangler.toml` before running this instead of a bare `wrangler dev`
- `npm run worker:deploy` - Deploy the Worker directly (CI does this automatically on push to `main`)
- `npm run build` - Minify CSS/JS/HTML (see `CLAUDE.md`'s Asset Minification section for the full cache-busting workflow)

---

## Features

- ✅ Responsive design (mobile-first)
- ✅ Dark/Light theme toggle with localStorage persistence
- ✅ Smooth scrolling navigation
- ✅ Animated gradient backgrounds
- ✅ Glassmorphism effects
- ✅ Interactive hover animations
- ✅ PWA-ready (web manifest included)
- ✅ Cross-browser compatible

---

## Deployment

The site is automatically deployed to a **Cloudflare Worker** (`wrangler.toml` + `src/worker.ts`) when changes are pushed to the `main` branch — see `.github/workflows/deploy.yml`. The Worker serves the static site directly and also runs the Academy API (`/api/academy/*`) and the OIDC Relying Party (`/auth/*`); see `CLAUDE.md` for the full architecture.

**Custom Domain**: integrauth.com and www.integrauth.com, via a Cloudflare Workers custom domain route (`routes` in `wrangler.toml`). Previously served by GitHub Pages (with `CNAME`); retired at the 2026-08 cutover.

---

## Contributing

1. Create a feature branch
2. Make your changes
3. Test locally with `npm run dev`
4. Submit a pull request to `main`

---

## Contact

- **Email**: akhil@integrauth.com
- **LinkedIn**: [View profile](https://linkedin.com)
- **GitHub**: [View organization](https://github.com/integrauth)

---

## License

Copyright © IntegrAuth. All rights reserved.
