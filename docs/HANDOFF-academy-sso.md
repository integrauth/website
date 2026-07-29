# Handoff — Academy accounts, SSO redesign, and the Cloudflare Workers migration

> Written 2026-07-29 as a resume point. Everything below reflects verified repo state, not intent.
> `docs/` and `*.md` are excluded from asset publishing (`.assetsignore`), so this file is never served.

---

## 1. Where the two repos stand

### `integrauth/lab` — **COMPLETE, pushed, not merged**

Branch `claude/academy-sso-shared-progress`, 5 commits ahead of `main`, working tree clean.

| Commit | What |
|---|---|
| `848c55c` | Original shared-cookie SSO + Academy schema (migrations 0045–0050) + erasure cascade |
| `697ad18` | CORS allowlist extension (later reverted) |
| `aeb5334` | Email rebranded generic "IntegrAuth" + shared logo (kept) |
| `e8c2aec` | **SSO redesign**: host-lock the cookie again, seed a first-party OIDC client |
| `e0fd207` | `website_sessions` table (migration 0052) for the RP's own sessions |

**`main` still has `__Host-lab_session`** — the shared-cookie version was never merged or deployed, which is why the revert cost nothing (no live sessions to migrate, no wide-domain cookie stuck in browsers for a year).

Verified independently at each step, not taken on agent report: `npm run typecheck` clean (1011 files, 0 errors), `npm test` → **93 files / 1583 tests passing**, `npm run build` succeeds.

### `integrauth/website` — **~2/3 done**

Branch `claude/academy-login-otp-sync-scxtmc`, in sync with origin.

| Commit | State |
|---|---|
| `f2f2c04` | Cross-device progress sync + prior-pass carryover wiring |
| `78607f0` | **Verified.** Asset/deploy fixes (see §3) |
| `f054c5a` | **WIP, explicitly not deployable.** Three concurrent workstreams, unverified |

---

## 2. The architectural decision (this is the important part)

### What was wrong
The original design shared ONE session cookie between both apps: `__Secure-ia_session` with
`Domain=.integrauth.com`. Cookie identity is `(name, domain, path)`, and the `__Secure-` prefix only
requires TLS — it does **not** restrict who may *set* the cookie (`__Host-` does, which is exactly why
`__Host-` forbids a `Domain` attribute).

So any of the ~30 sibling `*.integrauth.com` hosts — 27 free-tool subdomains, the product subdomains
(sunnahfast / hallbook / waterflow / oidcscan / smartable), 3 demo sites — could send
`Set-Cookie: __Secure-ia_session=<attacker token>; Domain=.integrauth.com` and **overwrite the
victim's session**. That is session fixation (victim's progress, name and certificates land in the
attacker's account) plus an unclearable forced-logout DoS. It also meant the browser transmitted the
session token to all ~30 of those hosts on every request.

### What replaced it — decided by the owner ("option a")
**Each app holds its own host-locked `__Host-` cookie. `integrauth.com` becomes an OIDC Relying
Party against the Lab's existing OpenID Provider.**

Research confirmed the Lab's OP is production-grade, **not** a teaching mock:
- PKCE S256 **mandatory** (`plain` rejected, no non-PKCE path)
- Exact-match `redirect_uri`, validated *before* any error can become a redirect
- 60-second, SHA-256-hashed, atomically single-use codes; replay revokes derived tokens
- ES256 + public CORS-open JWKS at `/.well-known/jwks.json`, RFC 7638 `kid`
- ~190 adversarial tests across 13 OIDC spec files
- The Lab's deliberately-weak teaching modules (`consent.ts`, `session-hijack.ts`) explicitly
  disclaim touching it

### The one conflict, and how it was resolved
The OP has **no `prompt=none` silent authentication**, and `frame-ancestors: none` +
`X-Frame-Options: DENY` make the hidden-iframe workaround structurally impossible. That collides with
the original requirement that login "stay in the same page, just overlays."

**Resolution: run the OIDC flow in a popup window, not a top-level redirect.** Popups are unaffected
by `frame-ancestors`; the main page never navigates. If the user is already signed in at the Lab, the
prior grant auto-approves and the popup closes near-instantly — one click, no typing. Fall back to a
full redirect if the popup is blocked.

**Accepted behavioral change:** you are no longer *automatically* signed in at integrauth.com just
because you're signed in at the Lab. It takes that one click.

**Sign-out-everywhere** now uses the Lab's existing back-channel logout (it already supports it, with
a `sid` claim) instead of the cross-origin call.

---

## 3. What is done and verified

### Lab (`e8c2aec`, `e0fd207`)
- Cookie reverted to `__Host-lab_session`, `Domain=` deleted from both cookie builders. Widened
  lifetimes **kept** (`IDLE_MS` 400d, `ABSOLUTE_MS` 10y) — that product decision stands.
- `TRUSTED_CROSS_ORIGINS`, `academyCorsHeaders`, `academyCorsPreflight`, `ACADEMY_CORS_ROUTES` all
  removed. These had widened the CSRF Origin check across the **whole** `/api/*` surface while CORS
  headers were on only 7 routes — a page on integrauth.com could POST to `/api/account/erase`,
  `/api/passkey/delete`, `/api/totp/*` riding the cookie.
- **First-party confidential OIDC client** `integrauth-website` seeded following the `ensureDemoClient`
  pattern: system-owned, outside `MAX_ACTIVE_CLIENTS`, invisible in "Your apps". Fully env-driven
  (`IA_WEBSITE_OIDC_SECRET`, `IA_WEBSITE_REDIRECT_URIS`, `IA_WEBSITE_BACKCHANNEL_LOGOUT_URI`) so the
  DNS cutover is a config change, not a redeploy. 13 tests in `tests/oidc-website-client.spec.ts`.
- **Cookie-refresh inversion fixed.** The old condition measured the gap *since the last request*, so
  a daily visitor never got a refreshed cookie and would be silently logged out at the browser's
  ~400-day cap, while infrequent visitors refreshed forever — exactly backwards. Now measures the age
  of the issued cookie via new `sessions.cookie_issued_at` (**migration 0051**), re-issuing after 30d.
  Only callers that can actually set a cookie consume the window.
- **Session cleanup was dead code.** It deleted on `expires_at`, which the 10-year backstop pushed out
  of reach, so no session row was ever removed again — including revoked ones. Now sweeps on absolute
  expiry, idle, and revocation, deriving its window from `IDLE_MS` so it can't drift.
  `listActiveSessionsByUser` applies the same liveness rules (the device list was showing sessions
  `validateSession` would reject).
- **Two pre-existing races fixed** (both made likelier by a second consumer of the database):
  `consumeCode` had no `AND consumed_at IS NULL` guard, so two concurrent verifications of one OTP
  could each mint a session; first-ever user creation was a bare `INSERT` racing into a UNIQUE
  violation → unhandled 500.
- **Academy store reference implementation fixed** (the website mirrors these): `setLastPosition` was
  documented last-write-wins-by-timestamp but overwrote unconditionally; certificate minting couldn't
  distinguish an idempotent retry from a real insert and could leave a user with *no* best
  certificate; a worse retake could demote a better one. `MemoryStore`/`D1Store` reconciled — they
  disagreed on dedupe keys and ordering, which mattered because tests only exercised `MemoryStore`.
- **`website_sessions`** (migration 0052) with `oidc_sid` for back-channel logout fan-out, wired into
  `erasure.ts` (RTBF) and `cleanup.ts`.

Note: `setLastPosition` uses `>=` not `>`, deliberately — an identical-timestamp re-sync should be a
no-op write, not a silent drop. Both repos now agree.

### Website (`78607f0`)
- **`.git` was going to be published.** `.assetsignore` covered `node_modules` but not `.git`, so
  `.git/config`, refs, and `objects/pack/*.pack` — the full repo history — would have been downloadable
  from the live site. CI checkouts create `.git` too. Also excluded `.claude/` and `docs/`.
  Verified against the real manifest: **182 assets published, was 372.**
- **Custom 404 was silently broken.** `not_found_handling` defaults to `"none"` → bodyless 404. Pinned
  to `"404-page"`. Confirmed by local probe: `/nope` now returns the real 9162-byte `404.html`.
- **Per-asset Worker cost.** `run_worker_first` was `true`, so every image/stylesheet cost a Worker
  invocation. Scoped to `["/api/academy/*"]`; static security headers moved to a new `_headers` file
  (**keep it in sync with `BASE_SECURITY_HEADERS` in `src/lib/server/security.ts`**).
- **`wrangler dev` never served a request.** Wrangler's `.wrangler/` state dir sits *inside* the
  watched asset tree, so its own writes retriggered its watcher — 250+ reloads/min, forever. Use
  `npm run worker:dev` (passes `--persist-to ../.wrangler-state`). Verified: 1 reload.
- **CI signing-key footgun.** A failed `wrangler secret list` fell through to generating a *new*
  `ACADEMY_PRIVATE_JWK`, invalidating every certificate ever issued. Now fails the deploy. Added a
  concurrency group.
- Dropped `preload` from HSTS — `includeSubDomains` already covers the subdomains, but advertising
  `preload` invites a browser-preload-list submission that is very hard to reverse.

Verified: `html_handling` default `"auto-trailing-slash"` **does** serve extensionless URLs
correctly (`/academy` → 200, `/academy.html` → 307 → `/academy`), so the URL convention survives the
cutover.

---

## 4. What is in `f054c5a` but NOT verified

Three agents wrote concurrently with disjoint file ownership. **Their completion reports were never
received** — the work is in the tree but unvouched-for. Re-verify before trusting any of it.

| Files | Intended scope |
|---|---|
| `src/lib/server/{api,store,certs,session}.ts`, `src/worker.ts` | Batch quiz-mask writes; throttle `last_seen_at`; column projections instead of `SELECT *` on Lab-owned tables; `LIMIT` on list queries; short-circuit idempotent cert re-issue; cache the imported signing key; abuse caps on exam attempts + cert issuance; **CSRF Origin allowlist + Content-Type enforcement**; serial → `IA-XXXX-XXXX-XXXX` Crockford base32; drop `email` from the cert JWT, add `iss`/`aud`; **publish `/api/academy/.well-known/jwks.json`** so the JWT is actually verifiable |
| `privacy.html`, `terms.html`, `index.html`, `academy.html`, `CLAUDE.md` | Privacy policy now covers email/names/progress + the shared account DB; FAQ answer **and** its mirrored FAQPage JSON-LD corrected (was telling Google the exam needs no account); academy.html's "no sign-up" blurb; CLAUDE.md's stale `certId()`/client-side-verify sections |
| `js/academy-labs.js`, `verify.html`, `css/styles.css` | Detached cert-history node; logo-less certificate render; **stable non-positional exam question ids**; verify.html error-vs-not-found; honest `/verify` copy; **theme-aware verify page controls** (owner-reported: buttons looked identical in all 4 themes) |

---

## 5. What remains, in order

1. **Build the OIDC Relying Party** (biggest piece, nothing else can be finished first).
   Until it exists, `js/academy-auth.js` still makes credentialed cross-origin calls to
   `lab.integrauth.com` and `src/lib/server/session.ts` still validates the abandoned shared cookie —
   **both break the moment the Lab branch merges.**

   Contract to implement:
   - `GET /auth/start` — mint PKCE verifier + `state` + `nonce`, stash in a short-lived cookie,
     redirect to the Lab's `/authorize`
   - `GET /auth/callback` — exchange the code, validate `state`/`nonce`/`iss`, mint the site's own
     `__Host-` cookie backed by `website_sessions`, `postMessage` the opener, close the popup
   - `POST /auth/logout`
   - `POST /auth/backchannel-logout` — called by the Lab on sign-out-everywhere; match on `oidc_sid`
   - `GET /auth/session` — who-am-I, replacing the cross-origin `/api/account` call

2. **Task 10 — progress delete channel.** Reset buttons currently *undo themselves*: `resetTrack`
   calls `saveRead`/`saveQuizStore` → `scheduleSync` → the server unions the deleted lessons straight
   back ~800ms later and the checkmarks visibly reappear. There is **no delete channel in the protocol
   at all**. A plain server-side delete is insufficient — another device's next sync re-unions its
   stale copy. Needs a **reset epoch**: server holds a per-user counter, bumped on reset; a client
   syncing with an older epoch has its `readLessons`/`quizMasks` ignored and replaces local state with
   the canonical post-reset truth. Requires a new Lab migration.

3. **Task 11 — account-scope local progress.** Sign-out never clears `acad_read`/`acad_quiz`/
   `acad_exam` (the auth layer touches no `localStorage` at all). On a shared machine, user A's
   progress syncs into user B's account on B's next login, and — worse — `acad_exam.passed` survives,
   so the "claim your prior pass" banner offers B **A's passing score**, one click from a real,
   publicly-verifiable certificate in B's name. Clear on sign-out **and** stamp the owning account id,
   wiping on mismatch.

4. **Task 12 — persist sign-in across tabs/windows/restarts.** Session cache is `sessionStorage`
   (per-tab), so every new tab starts logged-out and the exam renders its sign-in wall to a
   signed-in user; nothing remounts `#acadExam` on `academy-auth-changed` (only the navbar, account
   panel and sync listen). Move to `localStorage` + `storage`-event propagation, and add the remount.

5. **Runtime capability probe** on the frontend, so if `/api/academy/*` isn't reachable the Academy
   degrades cleanly instead of erroring. This downgrades the step-5 deploy risk (§6) from "site
   breaks" to "new features quietly unavailable."

6. **Final pass:** re-minify `js/functions.js`, `js/academy-labs.js`, `js/academy-auth.js`,
   `css/styles.css`; bump `?v=` across **all 11 HTML pages**; bump `<meta name="acad-build">` in
   `academy.html` **and** `academy-version.txt` together; run the `verify` skill (Playwright, 4 themes
   × 3 viewports); supersede the WIP checkpoint.

---

## 6. Deploy order (must be followed)

1. **Lab first.** Merge + deploy. Lands migrations 0045–0052 in the shared D1 and restores the
   `__Host-` cookie. The website Worker cannot function before the `academy_*` tables exist.
2. **Provision secrets.** `ACADEMY_PRIVATE_JWK` auto-generates on the website's first deploy. The OIDC
   client secret must match on both sides — Lab stores only its SHA-256.
3. **Deploy the website Worker to `*.workers.dev` only** (no `routes` block). Register that callback
   as a second redirect URI on the OIDC client.
4. **Exercise everything on workers.dev against real data**: login → progress sync across two browser
   profiles → exam → certificate → `/verify` → sign out everywhere → delete account. Production
   untouched throughout.
5. **Then, as ONE step:** merge the frontend to main, add the `routes` block, cut DNS. Splitting these
   is the failure mode found in review — the frontend calls `/api/academy/*`, which doesn't exist until
   the Worker owns the domain, so merging first gives an Academy where the exam demands sign-in and
   then can't record the result, and `/verify` stops verifying anything.
6. **After cutover:** drop the workers.dev redirect URI, retire GitHub Pages.

---

## 7. Open items needing the owner

1. **`CF_TOKEN` may be in the wrong place.** It was added as a GitHub **Variable**; the workflow reads
   `secrets.CF_TOKEN`. A Variable will not populate that and the deploy fails with an empty token.
2. **`ADMIN_SECRET` — purpose unknown.** Asked, never answered. Nothing in the website repo reads it.
3. **`RESEND_APIKEY` is unnecessary in the website repo.** Under the OIDC design the website never
   sends email; all of it stays with the Lab.
4. **Provision `IA_WEBSITE_OIDC_SECRET`** (`provision-cf.sh secrets` generates if absent, never
   rotates) and put the **same raw value** in the website Worker.
5. **Populate `IA_WEBSITE_REDIRECT_URIS`** (and optionally `IA_WEBSITE_BACKCHANNEL_LOGOUT_URI`) —
   committed as `""`, so the client stays unseeded until then. Register **both** the workers.dev and
   `https://integrauth.com` callbacks now so the cutover needs no Lab redeploy.
6. **Privacy-policy blanks** — the copy agent was asked to flag anything needing a real figure
   (retention periods etc.) rather than invent one. Its report was not received; re-check
   `privacy.html` for placeholders before publishing.

---

## 8. Known-remaining defects not yet fixed

From the review, still open (beyond §5):

- Turnstile widget is never `remove()`d, so close-then-reopen can leave `widgetId === null` and login
  dies with an unfixable "couldn't verify you're human". *(May become moot — the OIDC popup replaces
  the in-page OTP overlay entirely.)*
- Resend cooldown is defeated by a trailing `.then` that re-enables the button immediately. *(Same
  caveat.)*
- **Every `/api/academy/*` 401 fails silently** — no caller triggers re-auth. A mid-exam session
  expiry loses the pass behind a "Try again" button that 401s forever.
- Debounced sync is dropped if the tab closes within 800ms — no `pagehide`/`visibilitychange` flush,
  no retry, no user-visible failure signal.
- Profile nudge's "Add name" navigates to a panel with **no name field**.
- `academy-auth.js` fires `academy-auth-changed` unconditionally on every tab focus → account fetch +
  full panel teardown/rebuild + another profile GET + a sync, per focus.
- `showHub()` clears `acad_pos` but not `acad_pos_at`, so the server resurrects the position the user
  just backed out of.
- Exam score/`passed` are **client-asserted** — no server-side answer key exists. Anyone can mint a
  "verified" certificate from the console. `/verify` copy must not overstate what it proves.
- `[hidden]` on `.acad-auth-*` works only because Bootstrap ships `[hidden]{display:none!important}`,
  and Bootstrap loads **async** on index/academy — there is a real pre-Bootstrap window currently
  masked by the boot loader. Add explicit `[hidden]` rules.
- `#acadAuthSignIn` is an `<a href="#">` visible by default on all 11 pages — a dead link with JS off.

---

## 9. Gotchas that will bite

- **Minified assets in `f054c5a` are STALE** against the sources. Do not deploy that commit.
- **`acad-build` + `academy-version.txt` must be bumped together** with any `styles.min.css` or
  `functions.min.js` version bump — even for changes that look unrelated to the Academy, because
  `academy.html` loads both. Skipping it fails silently (the live-update toast just never fires),
  which is exactly why it gets forgotten. It has already been missed once in this project's history.
- **`_headers` ↔ `src/lib/server/security.ts`** must stay in sync — they cover static and API
  responses respectively.
- **All migrations land in the Lab repo first and deploy first**, website second. There is no
  cross-repo migration coordination and no FK enforcement.
- **Never reimplement account deletion in the website.** `erasure.ts` in the Lab is the single
  canonical RTBF path and already cascades to every Academy table.
