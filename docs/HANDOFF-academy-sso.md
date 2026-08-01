# Academy accounts, the SSO redesign, and the Cloudflare Workers migration

> Updated 2026-07-30. Everything below reflects verified repo state, not intent.
> `docs/` and `*.md` are excluded from asset publishing (`.assetsignore`), so this file is never served.
>
> **Read §8, §9, §10 and §11 first.** FOUR separate adversarial passes over code this document had
> already called verified each found real defects: §8 a total sign-in outage, an open redirect and a
> security control that never ran; §9 two silent data-loss paths, a logout that could fail to revoke,
> and a sign-in error that hung the popup for five minutes; §10 an incomplete §8 fix (the login-kill
> DoS was still reachable), a residual instance of the §9 reset race, a destroyed-passing-exam path,
> a CI guard that could not detect the very byte it was written for, and a documented staging flag
> that was dead code; §11 a cross-account progress leak through an in-flight sync, three separate
> holes in §10's own exam-stash fix, a provisioner that would regenerate never-rotate secrets, and a
> "sign out everywhere" that failed silently. What was missed, and why, is more useful to you than
> the parts that were right — and the pattern itself is the warning: every round of "this is
> verified" has so far been followed by a round that found more. Treat "nothing pending" as true as
> of the last audit, never as a property of the code.

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
| `8b1887f` | `academy_progress_epoch` (migration 0053) + RTBF wiring; derive the workers.dev callback |
| `7bacd5b` | **Percent-decode the Basic client credential** — see §8, this was a total sign-in outage |
| `7502afd` | "Sign out everywhere" now reaches this site; refuse to invent the shared secret |
| `c1960dd` | Revoke FIRST, then fan out; bound the fan-out (§9 items 1 and 8) |
| `2b28903` | Logout token `exp` — the §9 owner decision |
| `e71b634` | Round-3 fixes (§10): wire the dead `IA_WEBSITE_PRECUTOVER` flag, truncation-bound test, exact-`exp` assertion, comment corrections |
| *(HEAD)* | Round-4 fixes (§11): fail closed when the secret list is unreadable, fan out to every active sid, order the truncation, refuse a blind D1 create |

`main` still carries `__Host-lab_session`, which is why the revert cost nothing: the shared-cookie
version was never merged or deployed, so there were no live sessions to migrate and no wide-domain
cookie stranded in browsers for ~400 days.

Verified independently at each step. Final state: `npm run typecheck` clean (1011 files, 0 errors),
`npm test` at **93 files / 1602 tests, 0 failures** (count grows with each round's regression
tests — re-run rather than trust this line), `npm run dryrun` clean.

### `integrauth/website` — branch `claude/academy-login-otp-sync-scxtmc`

| Commit | What |
|---|---|
| `f2f2c04` | Cross-device progress sync + prior-pass carryover |
| `78607f0` | Asset/deploy fixes — `.git` leak, custom 404, per-asset Worker cost |
| `f054c5a` | WIP checkpoint (superseded; its contents were audited and are all present) |
| `bfc22aa` | Merge of `origin/main` |
| `b92040f` | **OIDC Relying Party + this site's own session store** |
| `fe5ffe8` | **Sign-in client rewrite, account-scoped progress, reset channel** |
| `ab43e26` | Callback summary reframed as a cross-check (the Lab derives it) |
| `44850d6` | Open redirect closed + Worker surface hardened (§8) |
| `12a0ebb` | The account-scoping control that never ran + client sync races (§8) |
| `c164cbb` | Stop losing learner progress; make sign-in failures visible (§9) |
| `2306dd5` | The four owner decisions (§9) |
| `1779edf` | Round-3 fixes (§10): tx-cookie DoS residue, bump-before-delete, exam-pass stash, CI guard `-a`, and the rest of the §10 table |
| *(HEAD)* | Round-4 fixes (§11): the cross-account sync leak, three exam-stash holes, the name-lock race, in-statement row ceiling, and the rest of the §11 tables |

Asset versions (as of round 4): `styles.min.css?v=5.56`, `functions.min.js?v=5.57`,
`academy-auth.min.js?v=1.6`, `academy-labs.min.js?v=5.54`, `acad-build` = `academy-version.txt` =
`5.59`. All four minified assets are current against their sources — but these numbers go stale
with every deploy, so verify against the HTML rather than trusting this line.

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

Scope is **exactly** `openid email` — keep it equal to the Lab's `WEBSITE_CLIENT_SCOPE`. The Lab
seeds no grant for this client, so the **first** login per learner shows a one-time consent screen;
keeping the scope equal is what lets every login **after** the first self-close. Ask for one scope
more and even returning users get re-prompted. No access token is retained and no
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

1. **Lab first.** Merge + deploy. Lands migrations 0045–0054 in the shared D1 and restores the
   `__Host-` cookie. The website Worker cannot function before the `academy_*` tables exist. 0054 is
   the easiest of these to under-count: it adds `academy_exam_attempts.ip_hash`, which every recorded
   attempt writes unconditionally, so without it the exam 500s at the final INSERT — after the
   sitting has been graded.
2. **Provision the shared secret — before step 1's deploy.** Add ONE GitHub Secret named
   `IA_WEBSITE_OIDC_SECRET` and both Workers converge on it; no `wrangler secret put` by hand.

   ```
   openssl rand -base64 32     # once, then paste into the GitHub Secret
   ```

   **Make it an organisation-level secret shared to both `integrauth/lab` and `integrauth/website`.**
   A repository secret works but has to be added to each repo separately, and two different values is
   exactly the failure this is avoiding — the Lab stores only the SHA-256, so a mismatch surfaces as
   `invalid_client` with no way to compare the two.

   Both CI workflows now mirror it into their Worker on every deploy, so rotating is "change the
   GitHub Secret, redeploy both". Neither side ever generates it — **including the Lab's
   `provision-cf.sh`, which REFUSES rather than falling back**: when the GitHub Secret is absent it
   warns loudly and leaves the secret unset (sign-in answers 503 until it exists), because a
   generated value is masked out of the log and unreadable from Wrangler afterwards, so nobody could
   ever tell the website what to match — a seeded client with an unknowable secret 401s
   `invalid_client` forever. (An earlier version of this document described a generate-as-last-resort
   path; that path was removed, and the refusal is the load-bearing behavior.)

   The website Worker's other two secrets are ours alone and both auto-provision, but with opposite
   rotation policies — the distinction matters more than the similarity:

   | Secret | Set it yourself? | Rotating it |
   | --- | --- | --- |
   | `ACADEMY_PRIVATE_JWK` | No — deliberately not overridable from a GitHub Secret | **Never.** It signs certificates; a new key invalidates the signature on every one already issued |
   | `EXAM_IP_HASH_PEPPER` | Optional — set a GitHub Secret of that name to control the value; CI generates 32 random bytes if you don't | Safe. Re-buckets the exam rate limit, resetting in-flight 24-hour counts once; nothing durable derives from it |

   The JWK's step fails **closed**: if `wrangler secret list` errors or returns anything that is not a
   JSON array, the deploy stops rather than reading "I can't tell" as "no secret exists" and
   generating a replacement.

   **Key continuity is enforced by `.github/cert-signing-key.kid`.** After the first deploy, commit
   the thumbprint the `Certificate signing key continuity` step prints into that file — the guard is
   inactive (and says so, loudly) until you do. Once recorded:

   - the secrets step **refuses to generate** a replacement when the secret is absent, since with a
     kid on record that is a rotation and not a first deploy;
   - the post-deploy step compares the **live** JWKS kid against it, catching the case a secret
     listing cannot see — a secret *overwritten* rather than deleted still lists as present.

   This matters because losing the key is invisible without it: `/verify` is a database lookup and
   keeps working, so nothing appears broken while every forwarded certificate JWT silently stops
   verifying. Three ways it goes missing, all covered: deletion in the Cloudflare dashboard, and a
   change to `name` or `account_id` in `wrangler.toml` — either of which means a *different* Worker
   with no secrets at all. To rotate deliberately, edit that file in a reviewed commit; nothing
   auto-updates it, on purpose.
3. **Redirect URIs — the two production ones are already committed** to the Lab's `wrangler.toml`:

   ```toml
   IA_WEBSITE_REDIRECT_URIS = "https://integrauth.com/auth/callback,https://www.integrauth.com/auth/callback"
   IA_WEBSITE_BACKCHANNEL_LOGOUT_URI = "https://integrauth.com/auth/backchannel-logout"
   ```

   Verified against the Lab's own `validRedirectUri` + comma-split parser: both accepted, none
   dropped. Comma-separated, **max 5**, matched by **exact string equality** at request time — no
   host/port/scheme laxity and **no trailing slash** (`/auth/callback/` passes registration
   validation but never matches, since the RP sends the no-slash form; it fails as a generic
   `invalid_client_or_redirect`).

   **The `*.workers.dev` callback needed for staging is registered automatically.** The Lab's
   `provision-cf.sh prepare` derives the account's workers.dev subdomain from the Cloudflare API
   (using the `CF_TOKEN` it already has) and appends
   `https://integrauth-website.<subdomain>.workers.dev/auth/callback` to the list at deploy time —
   the same "derive it, write it into `[vars]`, never commit it" idiom the script already uses for the
   Turnstile sitekey. It is idempotent, refuses to append if the list already holds 5 entries (which
   would silently displace a production URI), and needs no second Lab deploy after the website's
   first.

   It is deliberately **best-effort**: a `CF_TOKEN` scoped without Workers Scripts:Read, or an account
   with no workers.dev subdomain, makes it skip with a `::warning::` rather than fail the deploy — the
   committed production URIs are unaffected either way. The website's own deploy prints its actual
   callback into its run summary ("OIDC callback URL (cross-check against the Lab)") so there is
   always a manual path and something to compare against.

   Both vars are inert until `IA_WEBSITE_OIDC_SECRET` exists: without it
   `websiteClientConfigFromEnv` returns null and the client is simply never seeded.
4. **Deploy the website Worker to `*.workers.dev` only** (no `routes` block yet).
5. **Exercise it there against real data**: sign in → progress sync across two browser profiles →
   reset a track and confirm it stays reset on the other profile → exam → certificate → `/verify` →
   sign out everywhere → delete the account at the Lab and confirm the Academy rows are gone.
   Production is untouched throughout. **Do a manual sign-in click-through here** — see §6.

   **To test Lab-side logout reaching the Academy during this window, set `IA_WEBSITE_PRECUTOVER=1`
   on the LAB deploy** (a repo Variable/env for its workflow). Back-channel logout takes exactly ONE
   URI per client, and the committed one points at `https://integrauth.com/...` — which is served by
   GitHub Pages until DNS cutover, so every logout token would be delivered into a host that cannot
   receive it and "sign out at the Lab ends the Academy session" would silently fail on staging. The
   flag makes the Lab's provisioner repoint that URI at the website's workers.dev origin for that
   deploy only. **Unset it at DNS cutover** — the script's own comment explains why forgetting to
   unset is the worse failure, which is also why it defaults off.
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
4. **Add the `IA_WEBSITE_OIDC_SECRET` GitHub Secret** (organisation-level, shared to both repos) —
   see §4 step 2. CI does the rest; nothing to set by hand in Cloudflare. Neither repo will invent one
   any more: the Lab's provisioner now warns and leaves it unset instead of generating a value that
   could never be matched (Lab `7502afd`). Until it is set, sign-in answers 503 and everything else
   works.
5. **Set `IA_WEBSITE_PRECUTOVER=1` on the Lab's deploy for the staging window** if you want Lab-side
   sign-out to reach the Academy's workers.dev origin before DNS cutover (see §4 step 5) — and
   **unset it at cutover**.
*(The workers.dev redirect URI no longer needs adding by hand — the Lab derives it from the CF API at
deploy time. Only check for a `workers.dev subdomain` warning in its log if pre-cutover sign-in fails.)*

**One decision that is the owner's, not mine, and is deliberately left as it is:**

- **Exam grading is now server-authoritative** (`src/lib/server/exam.ts`, added after this doc's first
  draft). The client submits its per-question choices (each option's original index) and
  `POST /exam/attempts` grades them against `EXAM_ANSWER_KEY`; the caller no longer sends a score, and
  the `legacy-local-pass` shortcut is gone. RESIDUAL, inherent and unchanged: the question text and
  correct index still ship in the public `academy-labs.js` bundle (for the "Review answers" screen),
  so the exam stays unproctored and a determined reader can look answers up — what is closed is that a
  passing *score* can be fabricated with no exam at all. Keeping the answer key out of the client too
  would only raise the bar marginally (harvestable via the review screen within the daily cap) at a
  large refactor cost, so it is deliberately not done.
- **The exam is capped at 3 attempts per rolling 24 hours, per account AND per network** (added after
  this doc's draft, at the owner's request; it was a 20/day abuse backstop). The per-account half caps
  nothing on its own, since accounts are free, so the network half is what gives the number meaning.
  Its cost is inherent and was accepted knowingly: everyone behind one NAT — a household, an office, a
  campus — shares a single bucket, so a learner can be refused for attempts they did not make. That is
  why the 429 names the scope (`account` | `network`), carries `nextAttemptAt` + `Retry-After`, and the
  UI says in so many words that a shared connection can hit the limit even when the learner's own
  attempts are unspent. The counting key is a salted hash of `CF-Connecting-IP`
  (`academy_exam_attempts.ip_hash`, **Lab migration 0054**) — see `src/lib/server/ip.ts`, which is
  explicit that an unpeppered SHA-256 of an IPv4 is brute-forceable and that `EXAM_IP_HASH_PEPPER` is
  the setting that fixes it — and it is scrubbed from rows older than the window on the write path, so
  the network identifier lives 24 hours while the attempt itself is kept. That pepper is now
  provisioned by `deploy.yml`: it mirrors a GitHub Secret of the same name when one is set, and
  generates 32 random bytes when there is none, so a deployed Worker is never running unpeppered.
  Rotating it is safe (it resets the in-flight 24-hour counts once and nothing else) — the opposite of
  `ACADEMY_PRIVATE_JWK`, which the same step generates once and must never change.
- **The first sign-in per learner shows the Lab's consent screen** inside the popup, because nothing
  pre-seeds an `oauth_grants` row; later logins self-approve. Pre-consenting a first-party client is
  defensible and would make every sign-in a silent popup, but it is a product decision about consent,
  so it was not made unilaterally.

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

**Known accepted limitations**, documented in the code rather than hidden: the exam is **unproctored**
— grading is server-authoritative (`exam.ts`) so a passing score can no longer be fabricated, but the
questions and their correct indices still ship in the public `academy-labs.js` bundle, so a determined
reader can look answers up (`/verify` copy must not overstate what a certificate proves) — and there is
no general rate limiting on `/api/academy/*` (needs a Durable Object or KV; the total-row ceilings in
`api.ts` are abuse backstops, not rate limits). The one exception is the final exam, which now has a
real per-account **and per-IP** limit of 3 per 24 hours — enforced by counting rows in D1, so it is
check-then-insert and can be overshot by roughly the concurrency factor, which is bounded per window
and tolerable here.

**Re-verified on 2026-07-30, against the real Worker runtime and the real Lab schema.** The local D1
is now seeded by applying all 53 Lab migrations rather than a hand-written subset, so the Worker is
exercised against the actual production schema. Suite results at that point:

| Suite | Result |
|---|---|
| Reset-epoch semantics (`epoch-test.sh`) | 26/26 |
| Adversarial API probes (`adversarial.sh`) | 72/72 |
| Account-scoping in a real browser (`owner-test.js`) | 22/22 — and 8 failures against the pre-fix build |
| Open-redirect payloads (`srp-test.js`) | 29 payloads neutralised, 6 legitimate paths preserved |
| Lab `npm test` | 93 files / 1602 tests (as of round 3) |

The adversarial suite covers what the first pass did not: cross-user IDOR on every route, disabled and
erased accounts, the public verify oracle's leakage, oversized and malformed payloads, the total-row
ceilings, the epoch's narrowed back-compat, exam-attempt consistency, name-charset refusal, and
`no-store` on every `/auth/*` response. Kept in the session scratchpad, not the repo — this project has
no test runner for the front end, and adding one was out of scope.

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
- **`ALLOW_EPHEMERAL_CERT_KEY=1` must be in your `.dev.vars`** or certificate issuance and the JWKS
  route 500 locally. That is the fail-closed behaviour working, not a bug — see §8.

---

## 8. The 2026-07-30 re-audit — what the first pass missed

Everything above was believed complete and verified once already. A second, deliberately adversarial
pass over the same code found the following, which is worth reading before trusting any part of this
system on the basis that it "was checked".

**Two would have been outages or vulnerabilities in production:**

1. **Sign-in could never have worked at all.** RFC 6749 §2.3.1 requires a client to percent-encode
   the client id and secret before forming the HTTP Basic credential, and the RP does. The Lab's
   `parseBasicAuth` never decoded it, hashing the transmitted bytes verbatim. `openssl rand -base64 32`
   — the generator this project documents — emits 44 characters **always ending in `=`**, sent as
   `%3D`, so `POST /oidc/token` would have answered `401 invalid_client` on **every login, for every
   user, deterministically**. It survived the first pass because every existing website-client test
   authenticated with `client_secret_post`; the Basic path had zero coverage. Fixed in Lab `7bacd5b`
   with five regression tests covering `+`, `/` and `=`. Proven: the new tests fail on the old code.
2. **An open redirect on a first-party HTTPS origin.** `safeReturnPath` rejected `\n` and `\r` but not
   TAB, and the WHATWG URL parser strips all three *before* parsing — so `?return=/%09/evil.com` passed
   the single-slash check and resolved to `https://evil.com/`, reachable both as a `302 Location` and
   through the popup page's `location.replace`, including on a failure path that needs no login at all.
   The lesson is that enumerating the two separators everyone remembers is the wrong shape of check.

**One defeated a security control that was believed to be working:** the `acad_owner` account-scoping
wipe **never ran**. It was an `initAcademy()` listener, registered from jQuery's asynchronously-resolved
ready callback, while the event it needed fires synchronously during `academy-auth.js`'s deferred
execution — so it always missed it, deterministically. And `initAcademy()` no-ops off academy.html, so
a sign-in from any other page's navbar reconciled nothing. On a shared browser that meant learner A's
progress synced into learner B's account and A's passing exam record was offered to B as claimable.
Moving it into `academy-auth.js` fixed it; a browser test now asserts both directions, and fails 8/22
against the pre-fix build.

**Notable also-founds:** the certificate signing key failed *open* (an ephemeral per-isolate keypair
whenever `ACADEMY_PRIVATE_JWK` was unset, publishing a different public key per isolate);
`/auth/session` returned the caller's email and device list with no `Cache-Control`; `/progress/sync`
could grow the shared D1 without bound; the epoch's back-compat allowance re-admitted exactly the
resurrection it existed to prevent; a `mode=popup` sign-in failure returned raw JSON into a popup
window, leaving the opener to time out after five minutes; and "sign out everywhere" did not reach
this site at all, despite three separate places claiming it did — which mattered because the Lab's
400-day session names revoke-all as its safety valve.

**Also corrected: comments that asserted things the code did not do.** Two are worth calling out
because they would have caused harm rather than confusion — one claimed the session cookie was still
shared across `*.integrauth.com`, the other that `SameSite=Lax` had made the CSRF Origin check
redundant. Both false (siblings are same-site; `__Host-` prevents a sibling *writing* our cookie, not
*spending* it), and together they would have justified deleting a load-bearing control. Treat a
confident comment in this codebase as a claim to verify, not as evidence.

**A fix of mine was itself wrong first, and only a test caught it.** The first version of the
ownership reconciliation ran against the localStorage session cache, which on a fresh browser profile
reads as signed-out — so it wiped *legitimate* progress, including a passing exam record, on page
load. It now runs only on a server-confirmed session. This is the clearest argument in this document
for testing both directions of a destructive guard: the security assertion passed the whole time.

---

## 9. The second re-audit (also 2026-07-30) — what §8 still missed

§8 was written after one adversarial pass and read as though the work was finished. A second pass,
six independent audits across both repos, found more. That is the useful fact about this section:
**each round of "verified" has so far been followed by a round that found real defects**, so treat
any confident statement here — including this one — as a claim to re-check rather than a guarantee.

Two of these were silent data loss for a signed-in learner. One made logout able to fail.

### Fixed in this round

| # | Where | What was wrong |
|---|---|---|
| 1 | `lab` `api/index.ts` `/api/logout`, `/api/session/revoke` | Fanned out back-channel logout **before** revoking the session, and the fan-out's own D1 writes were unguarded (only its `fetch` was). One transient D1 error threw out of the handler and the session was **never revoked** — on the "I lost that device" button. A comment claimed the fan-out needed the session row intact; it does not (it reads `oidc_sessions`, the revoke writes `sessions`). Revoke now happens first, fan-out is wrapped. |
| 2 | `website` `js/functions.js` `showHub()` | Backing out to the hub cleared `acad_pos` **and** `acad_pos_at`. The merge adopts the server's position when `!localAt \|\| serverAt > localAt` — `!localAt` is the FIRST clause, so clearing the timestamp made adoption **unconditional**, and the next visit dumped the learner back into the lesson they had just left. The old comment asserted the exact opposite. Now writes a tombstone timestamp. |
| 3 | `website` `js/functions.js` boot sync | `claimAnonymousProgress()` was reachable only from the identity-transition listener. Signing in from another page's navbar and then opening `/academy` is not a transition, so the plain sync ran, posted epoch 0, was rejected as stale by any account that had ever been reset, and the authoritative reply **replaced** the anonymous progress it was supposed to claim. Boot now takes the same claim-vs-sync branch. |
| 4 | `website` `src/lib/server/auth.ts` | `/auth/*` had **no `onError`** — while `worker.ts` asserted it did. A throw in `/auth/callback` (e.g. D1 failing in `createSession`, after the code exchange succeeded) returned bare `text/plain`, which is not the closing page, which is the only thing that writes the localStorage handshake. The popup never closed and the opener sat on "Continue in the pop-up…" for five minutes, then cleared **with no error shown**. |
| 5 | `website` `src/lib/server/auth.ts` | `/auth/callback` handled the provider's `?error=` **before** validating `state`, and `fail()` clears the transaction cookie (`SameSite=Lax`, so it rides a top-level cross-site navigation). Any third-party page could kill a victim's in-flight login with `?error=access_denied`. `state` is now checked first. |
| 6 | `website` `src/lib/server/session.ts` | An unparseable `expires_at`/`last_seen_at` was treated as **never expiring / never idle** — `Number.isFinite(x) && …` fails open. Now rejects. |
| 7 | `website` `src/lib/server/oidc-rp.ts` | `safeReturnPath`'s open-redirect guard contained **raw NUL/US/DEL bytes** instead of `\x` escapes. Behaviour was identical and it typechecked — but the file was **binary to grep and ripgrep**, so every text search silently skipped it, including audits looking for exactly this. CI now fails on stray control bytes in source. |
| 8 | `lab` `oidc.ts` | `fanOutBackchannelLogoutForUser` walked an unbounded sid list sequentially, each dead RP burning a 5s timeout — minutes of wall time on "sign out everywhere", which Cloudflare kills, losing the audit event for an action that had already succeeded. Now bounded (40 sids, concurrency 8) with the audit written **first** and truncation recorded. |
| 9 | `lab` `oidc.ts` | The seeded website client held a `refresh_token` grant it can never use (the RP never requests `offline_access`). Narrowed to `authorization_code`. |
| 10 | `website` `src/lib/server/oidc-rp.ts` | No `azp` check. `jwtVerify`'s `audience` passes when our id is merely *contained* in a multi-valued `aud`; OIDC Core §3.1.3.7 requires `azp` in that case. Not currently reachable (the Lab mints single-audience tokens) — added so it stays that way. |
| 11 | `website` `.github/workflows/deploy.yml`, `wrangler.toml` | Comments under-counted the required migrations (`0045-0050`, actually **0045-0053**: 0052 is `website_sessions`, without which every sign-in 500s) and still described the withdrawn shared-cookie design. |
| 12 | `website` `src/lib/server/api.ts` | The name-filter docstring cited combining characters as its motivation; `\p{C}` contains no `\p{M}`. Homoglyph/combining-mark spoofing is **not** blocked — now stated plainly as an accepted risk, and the regex rewritten with explicit `\u` escapes. |
| 13 | `website` `js/academy-auth.js` | Double-clicking Sign in leaked a 2.5s poll and a stale `storage` listener for the page's life (the guard was checked synchronously but the sentinel assigned after an `await`); a sign-in timeout closed the overlay **silently**; a failed `/auth/session` probe was memoised, disabling accounts for the whole page after one transient blip; account-panel revoke/sign-out had no `.catch`. |

### Resolved by the owner, 2026-07-30

All four open items below were decided and implemented; none is outstanding.

| Item | Decision | What shipped |
|---|---|---|
| Certificate JWT `sub` | Use the serial | `sub` is now the `IA-XXXX-XXXX-XXXX` serial (same value as `jti`). No account identifier reaches the third parties a learner forwards a certificate to. The `sub` field was **removed from `CertificateClaims`** rather than merely documented, so it cannot be reintroduced without deliberately editing `signCertificateJwt`. Done before launch, which is the only time this was free — after launch it would invalidate issued certificates. |
| Back-channel logout replay | Add `exp` to the token | The Lab stamps a 120-second `exp` on every logout token, which `jwtVerify` enforces at the receiver. This fixes the issuer's own reasoning rather than patching one receiver: the old comment justified omitting `exp` by pointing at a `jti` cache that only the demo RP has. Our 5-minute `maxTokenAge` stays as the half we control. No migration, no new table. |
| Progress reset race | Guard inside the statement | The epoch check now rides in the `WHERE` of each merge write (`unionLessonProgress`, `unionQuizMasks`, `setLastPosition`), so a sync that passed the route's pre-check cannot land writes after a concurrent reset. No migration. In the quiz upsert the `WHERE` is load-bearing twice: it is also what makes SQLite able to parse `ON CONFLICT` after an `INSERT..SELECT`. |
| `terms.html` dead anchors | Remove them | All nine anchors pointing at `#products`/`#mobile`/`#ppno`/`#dmca` unwrapped. They were Termly leftovers wrapping only empty `<bdt>` markers, so the rendered text is byte-identical (verified: 51,710 chars before and after) and no in-page anchor in the file is dead any more. |

**On testing the reset-race guard.** The HTTP-level suite passes with or without it, because the route's pre-check already rejects a stale epoch — the guard exists for the race the pre-check cannot see, and a race is not reproducible from a shell. `epoch-guard-test.sh` therefore also drives the exact statements the store issues, against the real local D1, with an epoch the server has moved past: the write inserts nothing at a superseded epoch and inserts normally at the current one. Where a test does not discriminate, that is said out loud rather than counted.

### Still known and deliberately NOT fixed

- **No `jti` replay cache on `/auth/backchannel-logout`.** Now bounded by the token's own 120-second
  `exp` as well as our 5-minute `maxTokenAge`, and a replay only re-revokes an already-revoked
  session (idempotent). BCL 1.0 makes the cache a MAY; adding one would need a table in a database
  this repo does not own, for no behaviour change. (Since round 3 the receiver does REQUIRE a `jti`
  to be present — §2.6 makes the member itself REQUIRED — it just keeps no cache behind it.)
- **Exam panel's read-count is snapshotted at mount**, so after a partial cross-device pull the hub
  bar and the exam panel can disagree until a reload. Cosmetic.

### A note on how the tests were wrong twice

Both times, a test that "passed" was measuring its own fixture:

- The first fan-out regression test broke *all* audit writes, which fails the request for an unrelated
  reason (`logoutSession` audits after revoking) and hid the point. It had to break only
  `endOidcSessionsBySid`, the write that lives *inside* the fan-out.
- The progress test seeded `localStorage` from `ctx.addInitScript`, which re-runs on **every**
  navigation — so it re-planted `acad_pos` before the "next visit" booted, and reported a product
  failure that was pure harness. The seed is now one-shot.

Every fix in the table above was verified by reverting it and watching the test go red. Where a test
does **not** discriminate, that is stated rather than counted as coverage.

---

## 10. The third re-audit (2026-07-30, after the owner decisions) — what §9 still missed

Seven independent audit slices over both branches: website server, website client JS, HTML/copy/asset
consistency, config/CI, the lab delta, the cross-repo OIDC contract compared value-by-value, and
docs-vs-code truthfulness. **No criticals or highs.** The cross-repo contract passed all 12 points
character-for-character (client id, scope, redirect URIs, Basic-auth round-trip incl. `+ / = % é`,
ID-token claims vs verification, logout-token claims incl. the new `exp`, JWKS, duplicated
constants, D1 table ownership, issuer/endpoint paths, logout directionality). What follows is what
still needed fixing.

### Fixed in this round

| # | Where | What was wrong |
|---|---|---|
| 1 | `website` `deploy.yml` control-byte gate | The guard §8 item 7 added **could not detect NUL** — grep without `-a` classifies a NUL-containing file as binary and its PCRE matcher never reports it, so the one byte from the original incident most reliably sailed through CI while the others were caught. Verified empirically both ways; now `grep -laP`. |
| 2 | `website` `deploy.yml` smoke probes | The JWKS private-key-leak probe and the open-redirect probe printed OK when the **fetch itself failed** (empty response → grep finds nothing). An empty response now fails the step; "the probe did not run" is a failure, not a pass. |
| 3 | `website` `auth.ts` `/auth/callback` | §8 item 5's fix was **incomplete**: `state` was validated first, but `fail()` still cleared the transaction cookie unconditionally — so an unbound cross-site navigation reaching `state_mismatch` destroyed the victim's in-flight login anyway, the exact DoS the comment claimed was closed. Only failures that proved binding (state matched) may clear the cookie now. |
| 4 | `website` `api.ts` `/progress/reset` | Deleted **then** bumped the epoch. An old-epoch sync mid-flight through its own round trips could land its union writes in that gap (guard still sees the old epoch), and the bump then stamped the resurrected rows at the new epoch — the exact unrecoverable state the epoch machinery exists to prevent, §9's in-statement guard notwithstanding. Bump-first: late writes fail the guard, early ones are swept by the deletes. |
| 5 | `website` `academy-auth.js` + labs | **A passing exam was permanently destroyed** if the session died between grading and recording (revoke-all elsewhere, Lab-side sign-out): the 401 → confirmed-signed-out → security wipe took `acad_exam` with it, the remount destroyed the retry panel, and signing back in found nothing to claim. A passing record is now stashed **bound to the earning userId** (`acad_exam_stash_v1`) and restored only when that account returns; another account neither sees nor can claim it. |
| 6 | `website` `academy-auth.js` sign-out | A failed sign-out was silent (navbar `catch(noop)`), and the account-panel comment claimed cache-clear-first — which would be the *dangerous* behavior on the shared machine where sign-out matters most (looks signed out, cookie still valid). Now: clear on success only, loud themed retry dialog on failure, saying plainly "you are STILL SIGNED IN". |
| 7 | `website` `academy-auth.js` boot | `init()` wrote the cached session back to localStorage — a no-op except when the stored value was corrupt, where it broadcast `{loggedIn:false}` as a *confirmed* sign-out to every other tab, wiping progress while the cookie was still valid. Boot now renders without writing the store. |
| 8 | `website` `functions.js` sync | `claimAnonymousProgress()` ignored `acadSyncGeneration` (a reset clicked mid-claim let the stale response apply) and could run twice concurrently from its two entry points. Now generation-checked and single-flight. |
| 9 | `website` `functions.js` reset | The reset cancelled the pending debounced sync outright — which may have been carrying a <800ms-old read mark from a **different** track; the epoch-bumped reset response then replaced local state wholesale and the mark was gone for good. The pending payload is now flushed first (from the post-reset local snapshot, so the reset target cannot ride along), then the reset runs. |
| 10 | `website` `functions.js` `showHub` | The position tombstone (§8 item 2) fired on EVERY arrival at the hub — so the navbar's Certificates deep link, the profile nudge, hub-widget chaining, browser Back and a plain boot all destroyed "continue where you left off" (and a fresh boot's tombstone out-dated the server's position, blocking cross-device resume). Only the explicit back-out and a track reset drop it now (`showHub(focusId, dropPosition)`). |
| 11 | `website` `oidc-rp.ts` | Hardening: `requiredClaims: ['exp','iat','sub']` on ID-token verify (OIDC Core §2 makes `exp` REQUIRED; jose validates it only when present), `azp`-when-present must name us (§3.1.3.7 step 5), and logout tokens must carry the §2.6-REQUIRED `jti`. |
| 12 | `website` `academy-labs.js` | Certificate-history load failure blanked the panel — indistinguishable from "no certificates" for a learner who has some. Now shows the error and a retry. |
| 13 | `lab` `provision-cf.sh` | **`IA_WEBSITE_PRECUTOVER` was dead code** — `point_website_backchannel_at_workers_dev` was defined and never called from any dispatch path, so the documented staging flag silently did nothing and every staging logout token went to GitHub Pages. Now wired into `cmd_prepare`. The file's header comment also still *instructed* generating the shared secret; fixed to describe the refusal. |
| 14 | `lab` tests | The fan-out truncation bound had **zero coverage** (a regression dropping it passed CI); a new test seeds 46 live sids and asserts exactly 40 deliveries plus the truncation audit's real numbers. The `exp` test asserted `<= 300` — the TTL could have silently grown 2.5×; now asserts exactly 120. |
| 15 | both | Doc/comment rot: §4's phantom "generate-as-last-resort" path (above), the missing `IA_WEBSITE_PRECUTOVER` step, CLAUDE.md's stale `#acadResetAll` and "paste the workers.dev line" claims and `btn-primary` naming, the lab wrangler.toml "STILL TO ADD" block, `session.ts`'s "keyed off the request scheme" and phantom `markCookieIssued`, `api.ts`'s "shared SSO cookie", `oidc-rp.ts`'s "sends this without an `exp`", `auth.ts`'s "provider does not return `iss`" (it does), the overbroad "no CORS anywhere" claim in lab `security.ts`, stale tour copy ("all client-side, nothing to sign up for"), dead `markOthersNotBest` + the unroutable bare-`/auth` clause, the `__proto__` write-only quiz-row sink, the JWKS preflight that omitted `Access-Control-Allow-Headers`, the silent last-resort catch in `worker.ts`, and privacy.html never mentioning the downloadable certificate JWT. All fixed. |

### Round-3 verification

All prior suites re-run green against the fixed tree: epoch 26/26, epoch-guard 13/13, adversarial
72/72, smoke 54/54, owner-scoping 22/22, position/claim 8/8, auth-UI 35/35, dropdown 28/28, Lab
`npm test` 93 files / 1602. New discriminating coverage: an 11-assertion browser suite for the
exam-pass stash (`exam-stash-test.js`, scratchpad — including that a different account neither
receives nor consumes it), live HTTP probes showing the tx cookie SURVIVES unbound callback
failures and is CLEARED on bound ones, the lab truncation test (46 sids → exactly 40 deliveries +
the audit's real numbers), and the empirical `grep -lP`-misses-NUL / `-laP`-catches-it check. The
reset bump-before-delete ordering is NOT observable over HTTP (both orders answer identically) —
it is verified by code reading plus the raw-SQL epoch-guard section, and stated here rather than
counted as test coverage.

### Audited clean this round (so the next reader knows it was looked at)

PKCE/nonce/state handling, cookie attributes and `__Host-` usage, CSRF origin guards both sides,
`safeReturnPath`, certificate JWT claims and JWKS `d`-stripping, serial unbiased generation and
normalization, epoch-guard SQL parameter order, exam-attempt validation constants matching the
client, issuance idempotency + name-lock race handling, the public verify oracle, session-store
fail-closed paths, popup handshake on every error path, `_headers` vs `security.ts` (byte-identical
on all six shared headers incl. COOP), `.assetsignore` against the full 208-file tree, minified
assets byte-identical to fresh builds, navbar/footer byte-identical across all 11 pages, terms.html
zero dead anchors, stat-chip counts exact (133/12/99 verified against the DOM), migrations 0045–0053
matching the website store's expectations column-for-column, erasure cascading all 8 tables, and the
FAQ JSON-LD (whose four wording deltas are deliberate self-contained adaptations, now documented in
CLAUDE.md rather than "fixed").

---

## 11. The fourth re-audit (2026-07-30) — what §10 still missed

Six parallel adversarial slices, cut by failure DIMENSION this time (OIDC RP, API data plane, client
sync/state, migrations + cross-repo contract, lab server, concurrency/races) rather than by file, so
the same code was walked along different axes than in rounds 1–3. Two slices found nothing: the
**migrations and the OP↔RP contract are clean** (all 12 contract points still match
character-for-character), and the **OIDC RP has no high or medium defect**. Everything else below is
real, was verified against the code before being touched, and is fixed.

The headline is that round 3's own fixes were incomplete in three places. A fix is not a fact.

### Fixed — website

| # | Severity | What was wrong | Why it mattered |
|---|---|---|---|
| 1 | **High** | `acadSyncGeneration` was bumped by a reset but NOT by the ownership wipe, so an in-flight sync response landed after sign-out and rewrote the previous learner's progress — including `acad_epoch` | The restored epoch made `hasUnsyncedLocalProgress()` answer false, so the NEXT learner's sign-in skipped the claim path and plain-synced learner A's lessons into learner B's account, where the union made them permanent. The exact cross-account contamination the owner-scoping was built to stop |
| 2 | Medium | `restoreExamStash` deleted the stash even when it declined to restore | A worthless anonymous *failing* sitting in `acad_exam` blocked the restore, and the stash was dropped anyway — destroying the unrecorded 50-question PASS that §10 added the stash to protect |
| 3 | Medium | The stash was a single slot, unconditionally overwritten | On the shared machine the stash exists for, the second learner to sign out destroyed the first's still-unclaimed pass. Now a per-owner list (old single-object shape still read, so nobody loses a stash mid-upgrade) |
| 4 | Medium | The account-SWITCH branch wiped without stashing; only the signed-out branch stashed | A direct A→B transition with no confirmed signed-out step is reachable (a sign-in relayed by the `storage` listener, a `/auth/start` deep link), and destroyed A's pass outright |
| 5 | Medium | `refreshSession` trusted any 200 as the server's answer | A captive portal or proxy answering 200 with HTML parsed to `{}` → "signed out" → **confirmed** → wipe, while the session cookie was still valid. `isApiAvailable()` already required `typeof loggedIn === 'boolean'`; the destructive path was laxer than the probe |
| 6 | Medium | Boot resume restamped `acad_pos_at` | Merely OPENING the Academy on a stale device counted as "I just moved here" and beat the newer position from another device, dragging every device back. Resume is a read, not a move |
| 7 | Medium-high | `confirmSignOutEverywhere` swallowed failures (`catch(){}`) | The lost-laptop panic button appeared to do nothing: no reload, no message, every session everywhere still live. Single-device sign-out already shouted; the fleet-wide one was mute |
| 8 | Medium | Certificate issuance locked the profile name *without pinning the printed one* | A `PUT /profile` accepted during the several awaits of issuance left the locked profile permanently disagreeing with a public, verifiable certificate — and a later retake minted a second live certificate under a different holder name. The lock now pins exactly what was printed |
| 9 | Medium | Stored-row ceilings were check-then-insert only | N concurrent syncs each read a count near zero and each wrote up to 500 rows, so the one documented bound on unbounded growth into the SHARED D1 could be overshot by the concurrency factor. Now re-checked INSIDE each insert, like the epoch guard |
| 10 | Low | `SIGNIN_TIMEOUT_MS` (5 min) was shorter than the server's `TX_TTL_SECONDS` (15 min) | We declared failure while the transaction was still valid, then signed the learner in underneath the failure message. Now equal, and a confirmed sign-in retires any stale overlay |
| 11 | Low | A failed profile load rendered as "no name set" | Showed the editable name form to a name-locked learner, inviting a rename the server then 409s. Now an explicit error + retry |
| 12 | Low | `hasUnsyncedLocalProgress` ignored a position-only learner | Lab lessons are not auto-marked read, so an anonymous learner can be several lessons deep with an empty read set. They took the plain-sync path, and any previously-reset account discarded the position they were carrying in |
| 13 | Low | `txCookieName` keyed on scheme while `sessionCookieName` keys on host; comment claimed both keyed on scheme | Production was unaffected (they agree on every real host), but scheme-keying is the exact discarded rule §10 documented at length — and a comment pointing at a discarded rule is how it comes back |
| 14 | Nit | Back-channel `events` check accepted arrays and non-object values | BCL 1.0 requires a JSON object whose event member is itself an object |

### Fixed — lab

| # | Severity | What was wrong | Why it mattered |
|---|---|---|---|
| 15 | **High impact** | `load_secret_names` died if `wrangler secret list` FAILED, but a `jq` parse failure (npx banner, format change) silently yielded an empty list | Every `secret_present` then answered "absent" and `sync_generated_secret` **regenerated `LAB_ENC_KEY` and `LAB_PRIVATE_JWK`** — the two secrets the script's own header says must never rotate. Rotating them strands every enrolled TOTP secret and invalidates every issued JWT. The website's CI already failed closed here; this script did not |
| 16 | Low | `fanOutBackchannelLogoutForLabSession` used `rows.find(active)` — the FIRST active sid only | "One sid per lab_session_id" is intended, not enforced (`resolveOrMintSid` reads-then-mints with no unique constraint), so a raced double-authorize left an RP session both alive and un-ended — invisible to every later fan-out too |
| 17 | Low | `fanOutBackchannelLogoutForUser` truncated an UNORDERED list at 40 sids | Newest sids were dropped first — exactly the thief's session, and the sister site's (400-day, certificate-issuing) session. Now website-client sids first, then newest-first |
| 18 | Low | `wrangler d1 list` failure fell through to CREATE | Reported a D1:Edit permission problem that was never the issue, in the function that decides whether to create the database holding every user record. Now refuses |
| 19 | Doc | Comment claimed logout tokens never carry `exp`; they have since round 3 | — |
| 20 | Doc | `getCertificateBySerial` implemented in both stores but absent from the `Store` interface | It backs the enumeration-sensitive public `/verify`, and this interface is the contract the website mirrors |

### Verification

- **New discriminating tests.** The round-3 exam-stash suite passed against the *broken* code for
  cases 2–4, so it was extended to 19 assertions, 8 of them targeting exactly those holes (a failing
  local record must not consume the stash; B signing out must keep A's; a direct account switch must
  stash; the legacy single-object shape must still restore). All 19 pass.
- **The row ceiling was proven at the statement level**, not just through the route, the same way the
  epoch guard is: filled a user to exactly 400 rows, drove the exact statement the store issues at
  the CURRENT epoch (so only the new clause can refuse it) → 0 rows inserted; one row under the cap →
  inserts. Quiz variant checked both ways too: an EXISTING track still OR-merges at the cap
  (`1|4=5`), a new track is refused.
- **The name-lock fix was driven through the actual race**: renamed the still-unlocked profile to
  "Bob Jones" after issuance had printed "Alice Smith", ran the lock statement, and confirmed the
  profile is pinned back to "Alice Smith" — matching the certificate.
- Full end-to-end certificate flow over HTTP: name → attempt → issue → profile locked to the printed
  name → rename 409 → public verify returns the same name.
- Suites re-run green: lab **1602/1602** (93 files), adversarial 72/72, epoch 26/26, epoch-guard
  13/13, smoke 54/54, owner 22/22, position/claim 8/8, auth-UI 35/35, dropdown 28/28, exam-stash
  19/19. Both typechecks clean.
- **A harness trap worth knowing**: `epoch-guard-test.sh` and `adversarial.sh` must be run from the
  REPO ROOT (they use `--persist-to ../.wrangler-state-rv`) and `adversarial.sh` expects epoch 0.
  Run from elsewhere, the D1 CLI silently addresses a *different* database and 3 tests "fail"; run
  after the epoch suite, 4 more "fail" on a bumped epoch. Neither was a product defect — but both
  look exactly like one.
- Also confirmed clean this round, by hand: `run_worker_first` vs `worker.ts` dispatch, the JWKS CORS
  header surviving `withSecurityHeaders`, `verify.html`'s four distinct outcomes and escaping,
  `session.ts` vs migration 0052 column-for-column, privacy.html's Turnstile/OTP copy (accurate — the
  form lives at the Lab), and asset-version lockstep across all 11 pages.

### Knowingly NOT fixed (unchanged from §9/§10, plus two new)

- Exam grading is server-authoritative now, but the exam stays unproctored (answers ship in the public
  bundle); no `jti` replay cache; no per-IP rate limiting; first sign-in consent screen. Owner
  product decisions.
- **Daily caps (exam attempts, certificate issuance) remain check-then-insert.** Overshoot is bounded
  by the 24-hour window and certificates are idempotent per attempt, so the fix was not worth the
  churn — but the header comment claiming they are "exact" was corrected, because a false invariant
  in a comment is worse than a known-approximate one.
- **A read mark made during the reset round-trip can be lost** (it shares the reset's generation, so
  the counter cannot distinguish it). Narrow, and the learner can re-open the lesson.
- **An erasure racing an in-flight write** can leave an orphaned row from a request that was already
  past `requireSession`. Window is seconds; the user tombstone stops everything subsequent.
