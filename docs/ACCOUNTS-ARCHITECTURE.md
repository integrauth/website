# Academy accounts & SSO — where things live, and where to change them

> Quick-reference companion to [`HANDOFF-academy-sso.md`](./HANDOFF-academy-sso.md), which is the
> full build/audit history (four adversarial re-audit rounds, what each one found, why every
> decision was made). Read that one for "why is it built this way" and "what was already tried and
> rejected." Read THIS one for "which repo, which file, do I touch for X" — it is meant to stay
> short and current, not to accumulate history.
>
> `docs/` and `*.md` are excluded from asset publishing (`.assetsignore`), so this file is never
> served.

---

## The one-paragraph version

The Academy has optional accounts. The account is **shared** with the sister product at
lab.integrauth.com (`integrauth/lab`) — same user, same physical D1 database (`lab-db`) — but
**sign-in is OIDC, not a shared cookie**. The Lab is the OpenID Provider; this site is a Relying
Party (Authorization Code + PKCE S256). Each app mints and reads its own `__Host-` session cookie.
A cross-subdomain cookie was built once, found to be a session-fixation hole (any of the ~30
`*.integrauth.com` hosts could set it), and reverted before it ever deployed. **Never bring it
back** — see `HANDOFF-academy-sso.md` §1 for exactly why.

---

## Who owns what

| | `integrauth/website` (this repo) | `integrauth/lab` |
|---|---|---|
| **Role** | OIDC Relying Party | OpenID Provider |
| **Login UI / credentials** | None. No OTP form, no Turnstile widget here. | Owns email-OTP signup/login, passkeys, TOTP step-up |
| **Session it mints** | `__Host-ia_web_session` → `website_sessions` table | `__Host-lab_session` → `sessions` table |
| **Tables it OWNS** (read/write) | `profiles`, `academy_lesson_progress`, `academy_quiz_progress`, `academy_last_position`, `academy_exam_attempts`, `academy_certificates`, `academy_progress_epoch`, `website_sessions` | `users`, `sessions`, everything else in `lab-db` — including account lifecycle, erasure, OIDC client/grant/token tables |
| **Tables it may READ, never write** | `users` (for `status` + `email` only, inside `validateSession`) | — |
| **Migrations** | Never writes one against `lab-db`. All schema owned by the Lab. | Owns every migration (`migrations/0045`–`0054` are the Academy-relevant ones) |
| **Account deletion** | No delete button. Links out to `lab.integrauth.com/account`. | `erasure.ts` — the ONE canonical RTBF path, cascades to every Academy table too |
| **Certificate signing** | Owns it — `ACADEMY_PRIVATE_JWK`, `src/lib/server/certs.ts` | Not involved |
| **Exam grading** | Owns it — server-authoritative, `src/lib/server/exam.ts` | Not involved |

**Rule of thumb:** if the feature is "sign in", "who is this user", or "what has this learner
done in the Academy", it's this repo. If it's "create/delete the account", "prove I own this
email", "manage passkeys/TOTP", or "the shared `users`/`sessions` tables", it's the Lab.

---

## Where do I make a change?

| I want to… | Repo | File(s) |
|---|---|---|
| Change what the Academy shows for a signed-in learner | website | `js/academy-auth.js`, `academy.html` |
| Change the sign-in popup / redirect flow itself | website | `src/lib/server/auth.ts`, `src/lib/server/oidc-rp.ts` |
| Change progress sync / reset-epoch merge logic | website | `src/lib/server/api.ts`, `src/lib/server/store.ts` |
| Change the exam limit, grading, or answer key | website | `src/lib/server/api.ts`, `src/lib/server/exam.ts`, `js/academy-labs.js` (`ACAD_EXAM_POOL` must stay in sync) |
| Change certificate claims, signing, or verification | website | `src/lib/server/certs.ts` |
| Add/change an Academy-owned table's shape | **lab** (this repo just reads/writes through `store.ts`'s helpers) | `integrauth/lab` `migrations/` — then update `src/lib/server/store.ts` here |
| Change signup, login, passkeys, TOTP, or recovery | lab | `src/lib/server/{signup,login,passkeys,totp,recovery}.ts` (see lab's own CLAUDE.md) |
| Change what scope/claims the website's OIDC client gets | lab | `src/lib/server/oidc.ts` — `WEBSITE_CLIENT_SCOPE`, `websiteClientConfigFromEnv` |
| Change account deletion / RTBF behavior | lab | `src/lib/server/erasure.ts` — **never reimplement this in website** |
| Add a redirect URI or change the back-channel logout target | lab | `wrangler.toml` `IA_WEBSITE_REDIRECT_URIS` / `IA_WEBSITE_BACKCHANNEL_LOGOUT_URI` (committed, not secret) |
| Rotate the shared OIDC client secret | **both** — one GitHub Secret, both CI workflows mirror it | see Secrets table below |

---

## The `/auth/*` surface (this repo)

| Route | Purpose |
|---|---|
| `GET /auth/start` | Begin login: PKCE + `state` + `nonce`, redirect to the Lab's `/authorize` |
| `GET /auth/callback` | Exchange code at the Lab's `/oidc/token`, verify ID token, mint our session |
| `GET /auth/session` | Who-am-I. Only route that re-issues the session cookie |
| `POST /auth/logout` | This device |
| `POST /auth/logout-all` | Every session **this site** holds, on every device, PLUS (client-driven, see below) the Lab session live in the calling browser — not a Lab session on some OTHER device |
| `POST /auth/sessions/revoke` | One named session |
| `POST /auth/backchannel-logout` | Receiver for the Lab's OIDC Back-Channel Logout 1.0 push |

Scope is **exactly** `openid email` and must match the Lab's `WEBSITE_CLIENT_SCOPE` — a mismatch
either breaks the silent-reapproval on returning logins or asks for something the Lab won't grant.

`/auth/logout-all` only ever ends sessions THIS site holds. Ending the calling browser's Lab session
too is a CLIENT-side follow-up, not part of this route: `academy-auth.js`'s `navigateToLabLogout()`
does a real top-level navigation to the Lab's `/oidc/logout` after a successful call here — no
server-to-server call can touch a cookie on a different origin, which is also why this can only ever
cover the browser doing the clicking, never some other device.

---

## Secrets — who sets what, and how risky rotating each one is

| Secret | Lives in | Set by | Rotation |
|---|---|---|---|
| `IA_WEBSITE_OIDC_SECRET` | Both Workers (shared value) | One **organisation-level GitHub Secret**, mirrored into both by CI on every deploy. Neither side ever generates it. | Safe, but must happen on **both** sides together — "change it in one place, redeploy both" |
| `ACADEMY_PRIVATE_JWK` | website Worker only | CI generates once, if absent | **Never.** Invalidates every issued certificate JWT's signature. Enforced by `.github/cert-signing-key.kid` — see that file and `deploy.yml`'s "Sync Worker secrets" / "Certificate signing key continuity" steps |
| `EXAM_IP_HASH_PEPPER` | website Worker only | Optional GitHub Secret; CI generates if absent | Safe — re-buckets the exam rate limit once, nothing durable depends on it |
| `LAB_ENC_KEY`, `LAB_PRIVATE_JWK` | lab Worker only | lab's `provision-cf.sh` generates once, if absent | **Never** — same class of risk as `ACADEMY_PRIVATE_JWK` (strands enrolled TOTP secrets / invalidates issued JWTs). Lab's own script fails closed the same way |
| `IA_WEBSITE_REDIRECT_URIS`, `IA_WEBSITE_BACKCHANNEL_LOGOUT_URI` | lab `wrangler.toml` (committed, **not** secret) | Committed for production; `provision-cf.sh` appends the workers.dev staging callback automatically | Edit directly in the Lab repo |

---

## Deploy order

**Lab first, always.** It owns every migration the website's Academy tables depend on, and it's
the OpenID Provider — the website can't authenticate anyone until the Lab is live. Full sequenced
checklist (secrets, redirect URIs, verification steps) is in `HANDOFF-academy-sso.md` §4 — this
is the one place that detail belongs, since it's genuinely a step-by-step procedure, not a fact
that goes stale.

---

## Gotchas that will bite (short list — full list in `HANDOFF-academy-sso.md` §7)

- **`acad-build` + `academy-version.txt`** must move with any `styles.min.css`/`functions.min.js`
  bump, even for unrelated changes — `academy.html` always loads both.
- **`run_worker_first`** in `wrangler.toml` must list every prefix `src/worker.ts` dispatches on,
  or that route 404s at the asset server before the Worker ever sees it.
- **No cross-repo migration coordination and no FK enforcement.** All migrations land in the Lab
  first. This repo's `store.ts` helpers are the only thing keeping the two in sync.
- **Never reintroduce a cross-subdomain session cookie, a browser-computed certificate ID, or
  account deletion in this repo.** All three were tried, or would reopen something already fixed.
