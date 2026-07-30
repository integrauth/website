# Academy accounts, the SSO redesign, and the Cloudflare Workers migration

> Updated 2026-07-30. Everything below reflects verified repo state, not intent.
> `docs/` and `*.md` are excluded from asset publishing (`.assetsignore`), so this file is never served.

---

## 1. What this work is

The Academy was anonymous. It now has optional accounts, sharing one user record with the sister
product at **lab.integrauth.com** (`integrauth/lab`) in one physical D1 database (`lab-db`). Only the
final exam and the certificate are gated behind sign-in — lessons, labs, Flow Explorer and Challenge
mode stay free and account-free. The site also moves from GitHub Pages to a Cloudflare Worker.

**The one thing to understand before touching auth**: sign-in is **OIDC**, not a shared cookie.

The original design shared one session cookie between both apps — `__Secure-ia_session` with
`Domain=.integrauth.com`. That was rejected on security grounds and reverted before it ever
deployed. Cookie identity is `(name, domain, path)`, and the `__Secure-` prefix only requires TLS —
it does **not** restrict who may *set* the cookie. (`__Host-` does, which is exactly why `__Host-`
forbids a `Domain` attribute.) So any of the ~30 sibling `*.integrauth.com` hosts — 27 free-tool
subdomains, the product apps, 3 demo sites — could have replied
`Set-Cookie: __Secure-ia_session=<attacker token>; Domain=.integrauth.com` and **overwritten a
visitor's session**: session fixation, where the victim's progress, real name and certificates land
in the attacker's account, plus an unclearable forced logout. It also meant the browser transmitted
the session token to all ~30 of those hosts on every request.

**Never reintroduce a cross-subdomain session cookie.** Each app now holds its own host-locked
`__Host-` cookie, and integrauth.com is an OIDC Relying Party against the Lab's OpenID Provider
(Authorization Code + PKCE S256).

Two consequences that surprise people:

1. **Being signed in at the Lab does not sign you in here automatically.** The provider implements no
   `prompt=none`, and its `frame-ancestors 'none'` rules out the hidden-iframe trick. It costs one
   click; with an existing grant the popup approves itself and closes without any typing.
2. **The login popup cannot `postMessage` its opener.** Both apps send
   `Cross-Origin-Opener-Policy: same-origin`, so the browser moves the popup into a separate
   browsing-context group and severs `window.opener` permanently — returning to our own origin does
   not restore it. `popup.closed` is equally useless (a severed handle reports `true` at once). The
   callback page hands its result back through a **localStorage write** (`acad_auth_event_v1`, a
   constant duplicated in `src/lib/server/auth.ts` and `js/academy-auth.js` — keep them equal),
   backed up by a slow `/auth/session` poll for private-mode browsers.

---

## 2. Repo state

### `integrauth/lab` — branch `claude/academy-sso-shared-progress`

| Commit | What |
|---|---|
| `848c55c` | Academy schema (migrations 0045–0050) + erasure cascade |
| `697ad18` | CORS allowlist extension — **later reverted** |
| `aeb5334` | Emails rebranded generic "IntegrAuth" + shared logo |
| `e8c2aec` | **SSO redesign**: host-lock the cookie again, seed a first-party OIDC client |
| `e0fd207` | `website_sessions` (migration 0052) for the RP's own sessions |
| latest | `academy_progress_epoch` (migration 0053) + its RTBF wiring |

`main` still carries `__Host-lab_session`, which is why the revert cost nothing: the shared-cookie
version was never merged or deployed, so there were no live sessions to migrate and no wide-domain
cookie stranded in browsers for ~400 days.

Verified independently at each step: `npm run typecheck` clean, `npm test` at 93 files / 1583 tests
before migration 0053's additions.

### `integrauth/website` — branch `claude/academy-login-otp-sync-scxtmc`

| Commit | What |
|---|---|
| `f2f2c04` | Cross-device progress sync + prior-pass carryover |
| `78607f0` | Asset/deploy fixes — `.git` leak, custom 404, per-asset Worker cost |
| `f054c5a` | WIP checkpoint (superseded; its contents were audited and are all present) |
| `bfc22aa` | Merge of `origin/main` |
| `b92040f` | **OIDC Relying Party + this site's own session store** |
| `fe5ffe8` | **Sign-in client rewrite, account-scoped progress, reset channel** |

Asset versions: `styles.min.css?v=5.56`, `functions.min.js?v=5.53`, `academy-auth.min.js?v=1.2`,
`academy-labs.min.js?v=5.52`, `acad-build` = `academy-version.txt` = `5.54`. All four minified
assets are current against their sources.

---

## 3. The `/auth/*` surface

`src/lib/server/auth.ts` + `oidc-rp.ts`, routed through the Worker by `run_worker_first`:

| Route | Purpose |
|---|---|
| `GET /auth/start` | PKCE verifier + `state` + `nonce` into a short-lived `__Host-ia_oidc_tx` cookie, then redirect to the Lab's `/authorize` |
| `GET /auth/callback` | Exchange at `POST /oidc/token` (`client_secret_basic`), verify the ID token against the Lab's JWKS incl. `nonce`, mint our session |
| `GET /auth/session` | Who-am-I. Also the **only** route that re-issues the session cookie |
| `POST /auth/logout` | This device |
| `POST /auth/logout-all` | Every session this site holds for the account |
| `POST /auth/sessions/revoke` | One named session, ownership-checked |
| `POST /auth/backchannel-logout` | OIDC Back-Channel Logout 1.0 receiver; revokes by `oidc_sid` |

Scope is **exactly** `openid email` — keep it equal to the Lab's seeded grant scope or returning
users get a consent screen instead of a self-closing popup. No access token is retained and no
refresh token is requested: nothing here calls the Lab's API after login, and the ID token already
carries `sub` and `email`.

`/auth/backchannel-logout` is deliberately exempt from the CSRF Origin guard. It is a server-to-server
call with no `Origin` and a form-encoded body, and what authenticates it is strictly stronger: an
ES256-signed `logout+jwt` verified against the provider's published JWKS, with `aud` pinned to our
client_id and a 5-minute age bound.

`validateSession` joins the Lab-owned `users` table (read-only, which wrangler.toml permits) for
`status` and `email`. That join is load-bearing: our session is independent of the Lab's, so without
it a disabled or erased account would stay signed in here indefinitely.

**Sign-out-everywhere here means every device *for the Academy*.** It does not reach
lab.integrauth.com — this site holds no credential permitting that, and that boundary is intended,
not a gap. The reverse direction does work, via back-channel logout. Deleting an account and all
account-wide settings live at `lab.integrauth.com/account`; this site links out rather than
reimplementing them.

---

## 4. Deploy order — must be followed

1. **Lab first.** Merge + deploy. Lands migrations 0045–0053 in the shared D1 and restores the
   `__Host-` cookie. The website Worker cannot function before the `academy_*` tables exist.
2. **Provision the shared secret — BEFORE step 1's deploy, not after.** `IA_WEBSITE_OIDC_SECRET` must
   hold the **same raw value** in both Workers:

   ```
   openssl rand -base64 32          # once — use the SAME output for both commands
   wrangler secret put IA_WEBSITE_OIDC_SECRET     # in integrauth/lab
   wrangler secret put IA_WEBSITE_OIDC_SECRET     # in integrauth/website
   ```

   Why the ordering matters: the Lab's deploy workflow runs `provision-cf.sh secrets` on every push
   to main, and that script generates this secret if absent. The generated value is `::add-mask::`ed
   out of the CI log and a Wrangler secret cannot be read back, so if CI mints it first, **nobody can
   discover what it is** and sign-in fails `invalid_client` until it is overwritten on both sides
   anyway. Recovery is clean (the Lab re-syncs its stored SHA-256 on the next request naming the
   client), so this is an annoyance rather than a lockout — but pre-setting it is strictly less work.

   This repo's CI deliberately never generates it, for the same reason: a value we invented would be
   one the provider does not know.

   `ACADEMY_PRIVATE_JWK` is different — it is ours alone, auto-generates on first deploy, and is
   **never rotated** (rotating it invalidates the signature on every certificate ever issued).
3. **Register redirect URIs on the Lab**, in its `wrangler.toml` `[vars]`:

   ```toml
   IA_WEBSITE_REDIRECT_URIS = "https://integrauth.com/auth/callback,https://www.integrauth.com/auth/callback,https://<worker>.<subdomain>.workers.dev/auth/callback"
   IA_WEBSITE_BACKCHANNEL_LOGOUT_URI = "https://integrauth.com/auth/backchannel-logout"
   ```

   Comma-separated, **max 5** entries, matched by **exact string equality** at request time — no
   host, port or scheme laxity, and **no trailing slash**. `https://integrauth.com/auth/callback/`
   passes the Lab's registration-time validation but would never match, because the RP sends the
   no-slash form. Take the workers.dev hostname from the website Worker's own deploy output.

   Registering both production and workers.dev now means the DNS cutover is a DNS change rather than
   a Lab redeploy.
4. **Deploy the website Worker to `*.workers.dev` only** (no `routes` block yet).
5. **Exercise it there against real data**: sign in → progress sync across two browser profiles →
   reset a track and confirm it stays reset on the other profile → exam → certificate → `/verify` →
   sign out everywhere → delete the account at the Lab and confirm the Academy rows are gone.
   Production is untouched throughout. **Do a manual sign-in click-through here** — see §6.
6. **Then, as ONE step**: merge the frontend to main, add the `routes` block, cut DNS. Splitting these
   is a failure mode: the frontend calls `/api/academy/*`, which does not exist until the Worker owns
   the domain. (The `isApiAvailable()` probe softens this from "site breaks" to "accounts quietly
   unavailable", but the sequencing is still the correct one.)
7. **After cutover**: drop the workers.dev redirect URI, retire GitHub Pages.

---

## 5. Open items needing the owner

1. **`CF_TOKEN` may be in the wrong place.** It was added as a GitHub **Variable**; the workflow reads
   `secrets.CF_TOKEN`. A Variable will not populate that and the deploy fails on an empty token.
2. **`ADMIN_SECRET` — purpose unknown.** Asked, never answered. Nothing in this repo reads it.
3. **`RESEND_APIKEY` is unnecessary here.** This Worker never sends email; all of it stays with the
   Lab, which is where the sign-in form now lives.
4. **Provision `IA_WEBSITE_OIDC_SECRET`** and populate `IA_WEBSITE_REDIRECT_URIS` — see §4.

---

## 6. Verification done, and its one real gap

**Server, against the real Worker runtime and real local D1**: the authorize redirect and PKCE
challenge; open-redirect rejection on `return=`; `state` mismatch; back-channel logout media-type and
token validation; per-session revoke IDOR (404 for another user's session id); the full session
lifecycle; that the static site and custom 404 still serve; and 25/25 assertions on the reset epoch,
including that a stale device cannot resurrect reset progress.

**Browser, 44/44 assertions** (Playwright against the real Worker): navbar state signed in and out;
the sign-in link works as a plain link with JS off; the popup URL and mode; the blocked-popup redirect
fallback; the exam wall behind **both** its gates (all-lessons-read, then sign-in); cross-tab sign-in
and sign-out via `storage`; the account-switch progress wipe; and overlay readability in all four
themes.

**The gap, stated plainly.** This sandbox blocks every CDN (`ERR_CONNECTION_RESET` for jQuery,
Bootstrap, Font Awesome, Google Fonts), so the harness serves jQuery/Bootstrap from `node_modules`.
Under that substitution the page was observed re-requesting its own document mid-test, and
Playwright's actionability hit-testing disagreed with the DOM's own `elementsFromPoint` about what
sits under the navbar. The suite therefore drives the sign-in control by dispatching the click on the
node — which exercises the handler, but **not** a genuine user click through the real, CDN-loaded
stylesheets. Do a manual sign-in click-through on the workers.dev URL at step 5 of §4.

One real finding did come out of chasing that: a closed Bootstrap dropdown was kept collapsed only by
Bootstrap's own async-loaded CSS, so it was briefly clickable and overlapping the navbar — a click
aimed at "Sign in" was observed landing on the account menu's "Sign out". Now pinned in
`css/styles.css`, which is render-blocking on all 11 pages.

**Known accepted limitations**, documented in the code rather than hidden: exam scores are
**client-asserted** (no server-side answer key exists, so anyone can mint a "verified" certificate
from the console — `/verify` copy must not overstate what a certificate proves), and there is no rate
limiting on `/api/academy/*` (needs a Durable Object or KV; the per-user daily caps in `api.ts` are
abuse backstops, not rate limits).

---

## 7. Gotchas that will bite

- **`acad-build` + `academy-version.txt` must be bumped together** with any `styles.min.css` or
  `functions.min.js` bump — even for changes that look unrelated to the Academy, because
  `academy.html` loads both. Skipping it fails **silently** (the live-update toast just never fires),
  which is why it has already been missed once in this project's history.
- **`run_worker_first` in wrangler.toml must list every prefix `src/worker.ts` dispatches on.** A
  prefix handled in the Worker but missing there is answered by the asset server first, and the
  symptom is a plain 404 on a route that looks correctly implemented.
- **`_headers` ↔ `src/lib/server/security.ts`** must stay in sync — static and API responses
  respectively.
- **`.dev.vars` and `.env` are in `.assetsignore` as well as `.gitignore`.** Gitignoring protects the
  repo, not the deploy: `wrangler deploy` uploads the working tree, so a local client secret would
  otherwise be published at `https://integrauth.com/.dev.vars`.
- **All migrations land in the Lab repo first and deploy first**, website second. There is no
  cross-repo migration coordination and no FK enforcement.
- **Never reimplement account deletion here.** `erasure.ts` in the Lab is the single canonical RTBF
  path and already cascades to every Academy table.
- **Never reintroduce a browser-computed certificate ID.** Serials are minted server-side and must
  stay unguessable — `/certificates/verify/:serial` is public, so a guessable serial would be an
  enumeration oracle for holder names.
- **The certificate JWT carries no email claim**, deliberately: learners forward it to third parties.
- **Local dev**: `npm run worker:dev`, never bare `wrangler dev`. The assets directory is the repo
  root, so wrangler's own `.wrangler/` state sits inside the tree it watches and it reload-loops
  forever (measured: 250+ reloads/minute before, 1 after).
