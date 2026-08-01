# Blueprint: a free learning platform with optional SSO accounts, cross-device progress, a proctorless exam, and verifiable certificates

> **What this is.** A reusable, app-agnostic pattern extracted from IntegrAuth Academy
> (`integrauth/website` — 12 tracks, 133 lessons, 99 interactive labs, a 50-question exam and
> publicly verifiable certificates, authenticating via OIDC against a sister product's IdP).
>
> **Who it's for.** Someone starting a new app from zero who wants to arrive at the same place:
> content that works with no account at all, accounts that are optional and shared with an existing
> product, progress that follows the learner across devices, and a credential a stranger can check.
>
> **How to read it.** Part 0 is the shape and the build order. Parts A–G are the seven subsystems,
> each written as *decision → implementation → the trap*. Part H is reference material (schema, API
> surface, storage keys, adoption checklist). Part I is the mistake list — the shortest part and the
> most valuable, because every entry is something that shipped, broke, and was fixed.
>
> Naming here is generic: **`{app}`** is the thing you're building, **`{idp}`** is the existing
> product that owns accounts. In the reference implementation `{app}` = integrauth.com and
> `{idp}` = lab.integrauth.com.

---

## Table of contents

- [Part 0 — The shape, and the order to build it in](#part-0--the-shape-and-the-order-to-build-it-in)
- [Part A — Identity: OIDC RP against an existing product](#part-a--identity-oidc-rp-against-an-existing-product)
- [Part B — Cross-device progress sync](#part-b--cross-device-progress-sync)
- [Part C — Curriculum & content design](#part-c--curriculum--content-design)
- [Part D — Interactive labs framework](#part-d--interactive-labs-framework)
- [Part E — The exam](#part-e--the-exam)
- [Part F — Certificates & public verification](#part-f--certificates--public-verification)
- [Part G — Ops: deploy, secrets, cache-busting, headers](#part-g--ops-deploy-secrets-cache-busting-headers)
- [Part H — Reference](#part-h--reference)
- [Part I — The mistake list](#part-i--the-mistake-list)

---

# Part 0 — The shape, and the order to build it in

## 0.1 The one-paragraph version

Content is **static and public**. Accounts are **optional** and come from an **existing IdP over
OIDC** — `{app}` never collects a credential. Progress lives in **localStorage first**, and syncs to
a server only for signed-in learners, merging by **union** so an offline device can never delete
another device's work. Exactly **one** feature is gated behind sign-in — the exam — because it mints
a durable, publicly verifiable artifact and therefore needs a real identity behind it. Grading is
**server-authoritative**. Certificates are verified by **DB lookup on an unguessable serial**, with a
signed JWT as a secondary offline artifact.

## 0.2 Architecture

```
                        ┌─────────────────────────────────────────┐
   learner's browser    │  {app}  (one Worker / one origin)       │
  ┌──────────────────┐  │                                         │
  │ static HTML/CSS/ │◄─┼── static assets  (content: free, no JS  │
  │ JS  (content)    │  │                   account required)     │
  │                  │  │                                         │
  │ localStorage     │  │  /auth/*        ── OIDC Relying Party   │───► {idp}
  │  progress cache  │◄─┼─►/api/{app}/*   ── JSON API             │     (OpenID
  │  session cache   │  │       │                                 │      Provider)
  └──────────────────┘  └───────┼─────────────────────────────────┘        │
                                │                                          │
                                ▼                                          ▼
                        ┌───────────────────────────────────┐   ┌──────────────────┐
                        │ DB — {app}-owned tables           │   │ {idp}-owned      │
                        │  sessions, profiles, progress,    │   │  users, sessions │
                        │  quiz, position, epoch,           │◄──┤  (READ-ONLY from │
                        │  exam_attempts, certificates      │   │   {app})         │
                        └───────────────────────────────────┘   └──────────────────┘
```

**Three rules this diagram encodes, and all three are load-bearing:**

1. **One origin.** Static assets, the auth surface and the API are the same host. No CORS anywhere
   except the one public JWKS route (Part F). If you split them you inherit a CORS + cookie problem
   you did not need.
2. **`{app}` never writes an `{idp}`-owned table.** It reads `users` for account status and display
   email, nothing else. Schema for shared tables is owned by exactly one repo.
3. **Content is reachable with JS disabled and with no account.** Everything account-shaped is an
   enhancement layered on top of a working static site.

## 0.3 Build order

Each phase is independently shippable. That matters: phases 1–2 are a complete, useful product on
their own, and the reference implementation ran that way for weeks before accounts existed.

| Phase | Build | Ship criterion |
|---|---|---|
| **1** | Static content shell: tracks, lessons, hash routing, localStorage progress | Works with no server, no account. This is a real product |
| **2** | Interactive labs framework + first ~10 labs | A lesson can teach by simulation, not just prose |
| **3** | OIDC RP: `/auth/*`, own session cookie, navbar sign-in | Sign in and out. Nothing gated yet |
| **4** | `/api/{app}/progress` + union sync + reset epoch | Progress follows the learner across devices |
| **5** | Exam: client pool, server answer key, server grading, rate limit | Sign-in-gated. Attempts stored |
| **6** | Certificates: serial, DB verify, JWT + JWKS, name lock | A stranger can verify a credential |
| **7** | Ops hardening: CI secrets policy, signing-key continuity, headers | Safe to leave alone for a year |

**Do not reorder 3 before 1–2.** Building auth first pushes you toward "everything needs an account",
which is the wrong product and a much larger attack surface. Building content first forces the
account to justify itself, and it turns out only one feature can.

## 0.4 The two principles that decided almost everything

**Principle 1 — the account is optional and earns its place.**
Ask of each feature: *does this need to know who you are?* Lessons don't. Labs don't. The flow
explorer doesn't. A certificate with your name on it, that a third party will check, does. So one
feature is gated and the rest are not. Every argument to gate more ("we'd get better analytics",
"engagement") is an argument for your convenience, not the learner's.

**Principle 2 — the client owns the curriculum, the server owns the claims.**
The server holds no copy of the lesson list, no lesson text, no track membership. It stores opaque
ids. This is why adding a lesson is a front-end-only change with no migration. The inverse: anything
that becomes a *claim about the learner* — a score, a pass, a certificate — is computed and stored
server-side and the client cannot assert it. Where the boundary sits is the whole design.

---

# Part A — Identity: OIDC RP against an existing product

## A.1 The decision: OIDC, never a shared cookie

You have an existing product with accounts. The obvious shortcut is one cookie on the parent domain
that both apps trust:

```
Set-Cookie: __Secure-session=...; Domain=.example.com    ← DO NOT
```

**This is a session fixation hole and it is not fixable by hardening the cookie.** Cookie identity is
`(name, domain, path)`. The `__Secure-` prefix only demands TLS — it does **not** restrict *who may
set* the cookie. So *any* host under `example.com` — every marketing subdomain, every micro-tool,
every demo, every third-party thing someone parked there — can reply with that header and overwrite a
visitor's session. Consequences, in order of severity:

- **Fixation:** the victim's progress, real name and certificates land in an attacker-controlled
  account.
- **Unclearable forced logout:** an attacker can keep resetting it.
- **Token spray:** the browser sends the session token to *every* sibling host on *every* request.

`__Host-` fixes the *setting* problem (it forbids `Domain=` outright), but a `__Host-` cookie by
definition can't be shared across hosts — so it isn't the shortcut, it's the correct design:

> **Each app holds its own `__Host-` cookie. `{app}` is an OIDC Relying Party against `{idp}`'s
> OpenID Provider. Authorization Code + PKCE (S256).**

**Corollary that surprises people, and it is the one that gets deleted by a well-meaning cleanup:**
sibling subdomains are still **same-site** with you, because "site" means the registrable domain.
`__Host-` stops a sibling *writing* your cookie; it does nothing to stop a sibling *spending* it, and
`SameSite=Lax` withholds nothing between same-site origins. **Your Origin allowlist + JSON
content-type requirement is therefore load-bearing CSRF defence, not belt-and-braces.** Write that in
a comment above the guard or someone will remove it as redundant.

## A.2 The RP surface

Seven routes. Put them all under one prefix and route that prefix to your server before the static
asset handler.

| Route | Does |
|---|---|
| `GET /auth/start` | Mint PKCE verifier + `state` + `nonce` into a short-lived `__Host-` transaction cookie; redirect to `{idp}`'s `/authorize` |
| `GET /auth/callback` | Validate `state`, exchange the code, verify the ID token (incl. `nonce`), mint **your** session |
| `GET /auth/session` | Who-am-I. The **only** route that re-issues the session cookie |
| `POST /auth/logout` | This device |
| `POST /auth/logout-all` | Every session **this app** holds for the account, on every device |
| `POST /auth/sessions/revoke` | One named session (device list UI) |
| `POST /auth/backchannel-logout` | Receiver for OIDC Back-Channel Logout 1.0 — `{idp}` pushes here on sign-out |

**Scope: request exactly what you need and no more.** The reference uses `openid email`. Keep it
**byte-equal to the scope the IdP seeded for your client** — a mismatch means returning users get a
consent screen instead of a silent re-approval, which turns a self-closing popup into a confusing
interruption.

**Retain no tokens.** No access token, no refresh token. `{app}` never calls `{idp}`'s API after
login, and the ID token already carries `sub` + `email`. Anything you keep is something that can
leak; keeping nothing is a design property worth defending.

## A.3 The popup handshake — the part everyone gets wrong

You want sign-in to be a popup that closes itself, not a full-page redirect that loses the learner's
place. Two browser behaviours make the obvious implementation impossible:

1. **`Cross-Origin-Opener-Policy: same-origin`** (which you want, and `{idp}` probably also sends)
   makes the browser **sever `window.opener` permanently** once the popup goes cross-origin. The
   popup cannot `postMessage` its opener. Ever.
2. **`popup.closed` misreports `true` immediately** under the same policy, so polling it is worse
   than useless — it fires a spurious "user cancelled".

**The pattern that works:**

```
popup: /auth/callback  ──► renders a closing HTML page whose inline script does:
                              localStorage.setItem(AUTH_EVENT_KEY, JSON.stringify({ok, ret, t}))
                              window.close()
opener: listens for `storage` events on AUTH_EVENT_KEY
        + a slow /auth/session poll as backup
        + a hard timeout (~5 min) that clears the overlay with a real message
```

The `storage` event fires cross-window, same-origin — which is exactly the channel that survives
COOP. Keep `AUTH_EVENT_KEY` as a single named constant duplicated in the server template and the
client, with a comment on each saying "keep equal to the other".

**Every failure path must render that closing page.** Register an error handler on the whole `/auth/*`
app that renders the closing page — *not* JSON. The closing page's inline script is the only thing
that writes the handshake; any other response body leaves the opener spinning until its full timeout
and then failing with nothing to show the user. This includes the "sign-in is not configured" 503.

**Always provide a redirect fallback.** `GET /auth/start?mode=redirect` doing a plain top-level
navigation, and make the navbar sign-in control a real `<a href>` to it, upgraded to a popup by JS.
That's your no-JS path *and* your popup-blocked path in one.

## A.4 Session cookie rules

Five rules, each of which was a bug first.

**1. Two cookie names, chosen by hostname — never by scheme.**

```js
// CORRECT
const isDevHost = hostname === 'localhost' || hostname === '127.0.0.1';
return isDevHost ? 'app_session' : '__Host-app_session';

// WRONG — this served the unprefixed name to a plaintext http://prod-domain request,
// and an unprefixed cookie is one any sibling can set with Domain=
return url.protocol !== 'https:' ? 'app_session' : '__Host-app_session';
```
`__Host-` requires `Secure`, which plain-HTTP localhost can't satisfy, so dev needs a second name.
Key it on an **exact dev-host allowlist**. If nothing forces HTTPS at your edge and your HSTS lacks
`preload`, first-ever contact is genuinely plaintext and the scheme-keyed version is exploitable.

**2. Re-issue on cookie AGE, not on idle gap.**
The tempting condition — "refresh if we haven't seen this session for a while" — is exactly backwards.
It measures the gap since the last request, so a daily visitor *never* qualifies and gets silently
logged out when the browser hits its ~400-day cookie cap, while someone who visits twice a year
refreshes forever. Store `cookie_issued_at` and re-issue when *that* is older than ~30 days.

**3. Only one route re-issues.** Have `validateSession` return a `shouldReissueCookie` flag and an
explicit `canIssueCookie` option that **defaults to false**. Otherwise a route that merely *reads* the
session burns the re-issue window without acting on it, and the browser's copy ages out anyway.

**4. Throttle the `last_seen_at` write.** Writing on every request turns every authenticated read
into a DB write, and a page load fans out several. Coarsen to ~1 hour. This makes idle expiry lag by
up to an hour, which is a 0.01% error against a 400-day window and changes no security property — but
it *would* be indefensible against a 15-minute idle window, so tie the two constants together with a
comment.

**5. Join the IdP's `users` table for status on every validation.** One read, and it means a disabled
or erased account stops working in `{app}` on its very next request rather than whenever its session
happens to expire. This is the entire reason to keep reading a table you don't own.

## A.5 The CSRF guard

```
For POST/PUT/PATCH/DELETE:
  1. Require an Origin header, and require it to be in an allowlist
     (your own origin — computed from the request URL, not hardcoded — plus any
      explicitly-permitted host)
  2. Require Content-Type: application/json
  Fail either → 403, before any handler runs.
```

Requirement 2 does real work: a cross-origin `<form>` POST can only send
`application/x-www-form-urlencoded`, `multipart/form-data`, or `text/plain`. Demanding JSON forces any
cross-origin attempt through `fetch`/XHR, which triggers a CORS preflight, which you don't answer.

**Exempt exactly one route: back-channel logout.** It's a server-to-server call carrying a signed
`logout+jwt`, which is strictly stronger authentication than an Origin header. Everything else,
including anything you add later, goes through the guard by default — apply it as `use('*', guard)`
so it's opt-out, not opt-in.

## A.6 Sign-out, in three scopes

Be explicit about which one a button means, because users assume the broadest and you'll ship the
narrowest.

| Scope | Mechanism | Reaches |
|---|---|---|
| **This device** | `POST /auth/logout` → delete this session row + clear cookie | One browser |
| **All `{app}` sessions** | `POST /auth/logout-all` → delete all rows for `user_id` | Every device, `{app}` only |
| **`{idp}` session in *this* browser** | Client-side top-level navigation to `{idp}`'s `end_session_endpoint` | This browser only |

The third **cannot be a server-to-server call** — no backend can touch a cookie scoped to a different
origin. So "sign out everywhere" is `POST /auth/logout-all`, *then* a real browser navigation to
`{idp}`'s RP-Initiated Logout endpoint with `client_id` and a `post_logout_redirect_uri`. That URI
must **exact-match** an entry the IdP has registered, or the browser lands on the IdP's confirmation
page instead of returning (still signed out — just not auto-returned; expect exactly this in local
dev).

A `{idp}` session on some *other* device is out of scope and needs no credential you hold. Say so in
the UI rather than implying otherwise.

**The reverse direction is free and you should implement it:** register a back-channel logout URI, and
when `{idp}` signs someone out it pushes you a signed `logout+jwt`; you revoke by `oidc_sid`. Store
the `sid` from the ID token on the session row at login so you can.

## A.7 Configuration and the shared secret

| Value | Where | Secret? |
|---|---|---|
| Issuer URL, client id | Committed config vars | No |
| Client secret | Worker/env secret, **same raw value on both sides** | Yes |
| Redirect URIs, post-logout URIs | Committed on the **IdP** side | No |

**Provision the client secret as ONE organisation-level secret shared to both repos, and have each
repo's CI mirror it into its own runtime on every deploy.** Rotation becomes "change it in one place,
redeploy both."

**Neither side may ever generate it.** A value one CI invents is one the other doesn't know — and
since a generated secret is masked out of the log and unreadable afterwards, nobody can tell the
other side what to match. Make both sides *refuse* to generate and warn instead. (The reference
implementation hit exactly this: the IdP's provisioning script generated one as a "last resort",
which seeded a live confidential client with an unknowable secret. Sign-in 401s `invalid_client`
until a human sets the shared secret and redeploys both.)

**Fail soft when it's absent.** Unset ⇒ RP config resolves to null ⇒ `/auth/*` answers 503
`sign_in_unavailable` (as the **closing page**, per A.3) ⇒ the account-free product keeps working. This
lets you deploy before provisioning.

---

# Part B — Cross-device progress sync

## B.1 The decision: local-first, union merge

Progress lives in localStorage and works with no account. When signed in, a **debounced** sync
(~800 ms) posts a snapshot and receives merged truth.

**Merge semantics, per data type:**

| Data | Merge rule | Why |
|---|---|---|
| Lessons read | **Set union** (`INSERT OR IGNORE`) | "Read" is a one-way flag |
| Quiz reveals | **Bitwise OR** per track mask | Reveal is one-way; two devices revealing different questions both count |
| Last position | **Last-write-wins by caller timestamp** | Only one "where am I" can be true |

The union is what makes it safe for a device that's been offline for a month to reconnect: it can
add, never remove. That's the whole property.

## B.2 The reset epoch — because a union cannot express a deletion

**This is the single subtlest thing in the whole design. Budget real time for it.**

"Reset my progress" is a deletion, and a union-shaped protocol has no way to say that. Naively it
fails twice over:

- **Locally:** clear the marks → debounced sync fires 800 ms later → server unions every id straight
  back → **the checkmarks reappear in front of the learner.**
- **Server-side deletion alone is still not enough:** any *other* device holding the old progress
  re-uploads its stale copy on its next sync, and the reset **silently un-happens** on a machine the
  learner isn't looking at.

**The fix:** a per-learner **epoch counter**, bumped by `POST /progress/reset`.

```
Client stores the epoch and echoes it on every sync.
  epoch  <  server's  →  payload IGNORED. Client is handed canonical post-reset truth
                          + the new epoch, and REPLACES its local state (not unions it).
  epoch missing        →  treated as current  (older cached JS keeps working)
  epoch  >  server's   →  treated as stale    (a client can't opt out by asserting a big number)
```

Four details that are each individually load-bearing:

1. **On a rejected sync the client must REPLACE, not union.** Unioning an empty server set into a full
   local one changes nothing — that's the whole trap, and it looks like the code is working.
2. **Re-check the epoch INSIDE each merge write's own SQL statement**, not just in the route's
   pre-check. The pre-check is a read followed by several awaited round trips; a concurrent reset can
   land in that gap, and then the union writes resurrect the deleted rows **stamped at the new
   epoch**, where no later sync can ever detect or correct it. The reset is permanently, silently
   partial.

   ```sql
   INSERT OR IGNORE INTO lesson_progress (user_id, lesson_id, read_at)
   SELECT ?, ?, ?
    WHERE (SELECT COALESCE((SELECT epoch FROM progress_epoch WHERE user_id = ?), 0)) = ?
   ```
   `COALESCE` because a missing row means "never reset" = epoch 0.

3. **Increment in SQL** (`epoch = epoch + 1`), never read-then-write, or two devices resetting at once
   both read 3 and both write 4.
4. **Cancel the pending debounced sync BEFORE posting the reset.** Ordering is load-bearing.

**Clear the last-position row as part of a reset too.** It's the one field merged last-write-wins
rather than by union, so leaving it behind means the next sync cheerfully restores the learner to the
lesson they just reset out of.

## B.3 Sync generation — invalidating in-flight responses

An in-flight sync response can arrive *after* an event that makes it not merely stale but harmful.
Keep a monotonic `syncGeneration` counter; capture it when a request goes out; **drop the response if
it no longer matches.**

Bump it on **two** events:

- **A reset.** Otherwise the pre-reset response lands and is applied as authoritative — visibly
  undoing the reset, then flickering.
- **An ownership wipe (sign-out or account switch).** This is the one people miss, and it's the
  serious one. Learner A finishes a lesson → debounced sync goes out → A signs out mid-flight → the
  response (A's full progress *and* A's epoch, computed before the session ended) lands *after* the
  wipe and writes all of it back into a signed-out browser. The restored epoch then makes
  "do I have unsynced local progress?" answer **false**, so learner B's sign-in skips the claim path
  and plain-syncs **A's lessons into B's account**, where the union makes them permanent. That is
  exactly the cross-account contamination the owner-scoping exists to prevent, arriving through the
  one door it wasn't watching.

## B.4 Owner scoping — shared machines

Store the owning `userId` alongside local progress (`{app}_owner`). On sign-in with a **different**
userId, and on sign-out, **wipe** local progress before any sync runs.

Without this, on a shared machine: learner A's progress syncs into B's account on B's next login, and
A's passing exam record survives so B is offered "claim your prior pass" for a score they never
earned — one click from a real, publicly verifiable certificate in B's name.

**If the owner key is absent, treat local progress as claimable.** That's the intended "carry over my
anonymous progress" path.

**The one carve-out: stash a passing exam.** The wipe also fires when a session dies server-side
between grading and recording (revoke-all elsewhere, back-channel logout), which otherwise destroys a
full sitting with no recovery. So move a *passing* record to a stash — and get all three of these
right, because the first version got all three wrong:

- The stash is a **LIST keyed by owner**, not one slot. Otherwise the second learner to sign out on a
  shared machine destroys the first learner's still-unclaimed pass.
- The entry is **consumed only when actually restored** (or when what's already stored is itself a
  pass). Deleting it unconditionally meant a worthless anonymous *failing* record blocked the restore
  and then discarded the pass anyway.
- The **account-switch branch stashes too**, not just the signed-out branch. A direct A→B transition
  with no confirmed signed-out state in between is reachable (a sign-in relayed by a `storage` event,
  or a deep link), and it was destroying A's pass outright.

## B.5 First-sync-after-sign-in has TWO entry points

Adopting the account's epoch *before* merging ("claim my anonymous progress") must happen on **both**:

1. The `auth-changed` event listener — fires on an identity transition seen while the learning page
   is open.
2. **The boot path** — because the auth client loads on *every* page, a learner can sign in from the
   home-page navbar and *then* open the learning page. The session is already signed in: no
   transition, no event, listener never runs.

If boot calls the plain sync unconditionally it posts epoch 0 — and **any account that has ever been
reset rejects that as stale** and answers with post-reset truth, which the client applies
authoritatively, **destroying the anonymous progress it was supposed to carry over.**

Two more rules in the same area:

- **The auth-changed event needs a `confirmed` flag.** Listeners that *render* may use the cached
  session; listeners that **write** must act only on a **server-confirmed** one. Fire the boot event
  with `confirmed: false`.
- **Reconcile ownership only against a server-confirmed session, never the cache.** On a fresh browser
  profile the cache reads as signed-out, so reconciling against it wipes a *legitimate* learner's
  progress — including a passing exam record — on page load.
- **Put reconciliation in the always-loaded auth client, not the page-specific init.** In the
  reference implementation it lived in the learning-page init and therefore *never ran at all*: the
  auth client fires its forced boot event synchronously while its deferred script executes, whereas
  the page init registers listeners from an asynchronously-resolved ready callback — so the boot
  event had always already fired. Deterministically, not as a race.
- **Cache the session in `localStorage`, not `sessionStorage`.** `sessionStorage` is per-tab, so every
  new tab starts out looking logged-out and shows the sign-in wall to a signed-in learner. Propagate
  across tabs with `storage` events, and fire the change event **only on a real identity transition**,
  not on every tab focus.

## B.6 "Where was I" — resume, and the timestamp trap

**Do not auto-open the saved lesson on boot.** It silently drops a returning visitor inside a lesson
they never chose to reopen — new tab, old bookmark, three days later, all indistinguishable.

**Do** render an explicit **resume banner** on the hub: track + title + a relative "Last visited 2
days ago", with Continue and dismiss. Only clicking Continue is a deliberate navigation. Dismissing
hides it for that view and touches no storage, so it's back next time.

**The timestamp trap, which is what makes this more than a UI preference.** Position merges
last-write-wins by a **caller-supplied** timestamp. So:

- If merely *opening* the app restamps the position, then device A (last at lesson L) stamps L at
  *now*, which beats the M the learner actually reached on device B — and the next sync **drags every
  device back to L.** This is precisely why passive resume had to go: with no passive open, every
  remaining call site (chip click, pager, search, deep link, Continue) is a real deliberate move, so
  restamping unconditionally becomes correct.
- **Backing out to the hub must write a fresh timestamp tombstone, not clear it.** The merge adopts
  the server's position when `!localAt || serverAt > localAt` — and `!localAt` is the *first* clause,
  so clearing the timestamp makes adoption **unconditional** and the next visit dumps the learner
  back into the lesson they just left.
- **Validate the timestamp server-side as canonical ISO-8601 and reject far-future values.** The merge
  compares **strings**, so a merely-`Date.parse`-able value like `"Sat Jan 01 2050"` sorts above every
  real timestamp and **wedges the saved position forever.**

## B.7 Bounding growth

You cannot validate lesson ids against a curriculum the server doesn't hold, so an authenticated
caller could loop the sync with junk ids forever. Bound it two ways:

- **Per-request caps** (max ids per payload) → 400.
- **Total-row ceilings per learner**, re-checked **inside each insert statement** — same reasoning as
  the epoch: N concurrent syncs each read a count near zero, each pass the route's pre-check, and each
  writes up to the per-request max. Keep the route-level check too; it earns its place by answering
  409 for a bulk payload instead of silently dropping rows.
- **`LIMIT` every list query** that feeds a JSON response. And once a list is truncated, **never
  compute an aggregate over it** — a max or count over a truncated list is simply wrong. Aggregate in
  SQL over the complete set.
- **Use a null-prototype object** when building a `Record<string, number>` from caller-chosen keys. A
  stored key of `__proto__` on a plain object hits the `Object.prototype` accessor and **silently
  vanishes from every response** — a write-only row.

---

# Part C — Curriculum & content design

## C.1 Structure

```
Track  (a subject area, ~9–15 lessons)
 ├─ ★ intro lesson        "Start here" — roadmap, one journey diagram, NO lab
 ├─ body lessons          the actual teaching, each with ONE interactive lab
 ├─ summary lesson        "The big picture" — narrative retelling, every lesson
 │                         linked once, ONE unifying figure, NO lab
 └─ quiz lesson           cheat sheet + 5 scenario questions, hands off to the next track
```

**Ids are stable keys; numbers are display-only.** `data-num` renders; the id is the localStorage
key, the URL hash and the server's row key. **Never renumber an id.** Insert a lesson mid-track and
the displayed numbers shift — the ids don't. In the reference implementation a lesson added later
displays as "lesson 1" of its track while keeping an id that encodes its original position, and
that's fine.

**DOM order = pager order = display numbering.** One source of truth. Reordering tracks is a DOM move
plus a label-map edit, never a data migration.

**A hand-off chain.** Each track's quiz ends by naming the next track. The very last lesson overall
hands into the hub-level widgets ("All tracks complete 🎉 → Flow Explorer, Challenge mode & Final
Exam") rather than dumping the learner back at the track grid.

## C.2 Lesson anatomy

A fixed vocabulary of content blocks, so 133 lessons look like one product:

| Block | Purpose |
|---|---|
| lead | One paragraph: what this is and why you care |
| card grid | 2–4 parallel concepts |
| **analogy** callout | The real-world comparison |
| **story** callout | The fictional cast doing the thing |
| **why** callout | Why it matters in production |
| **watch** callout | The trap / what goes wrong |
| table | Comparisons, status codes, decision matrices |
| figure | Hand-authored inline SVG |
| lab | The interactive simulation (Part D) |
| try-it | Links to real free tools |
| quiz | Static reveal-answer pattern |

## C.3 Diagrams: theme them with classes, never hardcode colour

**Rule: lesson SVGs carry only semantic classes, and every colour comes from a CSS variable themed
per theme.**

```html
<!-- CORRECT -->
<rect class="ax-actor"/><text class="ax-atext">Maya</text>

<!-- WRONG — invisible in 2 of your 4 themes, and you will not find all of them later -->
<rect fill="#6366f1"/><text fill="#fff">Maya</text>
```

Define ~12 semantic tokens (actor, human, adversary, lifeline, message, return, note, emphasis,
blocked, ring, arrowhead, text-on-actor) and back each with a variable. **Pair a fill token with its
own text token** — the readable text colour *on* a filled shape is a different question from the fill
itself, and conflating them is how you get illegible labels in exactly one theme.

**Corollary that bit us:** never use a diagram accent token as standalone text colour on ordinary
page chrome. A token tuned as an SVG fill (paired with its own on-top text colour) is frequently
near-illegible as text against a themed background. Use the token actually tuned for readable body
text.

## C.4 Consistency rules that scale to 100+ lessons

- **A fixed fictional cast**, reused everywhere: a customer, a partner, an employee, an automation
  bot, an AI agent, a security operator. Six names, never expanded. Learners build a mental model of
  each and you stop re-explaining who's who.
- **A neutrality rule, written down.** The reference cites standards (RFCs, W3C, NIST) and open source
  only — no vendor or client names. Whatever yours is, state it once and enforce it in review; it's
  the rule most likely to erode silently.
- **Every lesson gets a lab** — with three explicit exemptions (intros, summaries, the glossary,
  which has a live filter instead). Exemptions must be *listed*, or "this one doesn't need one"
  becomes the norm.
- **Any stat you display is a real count.** "133 lessons", "99 labs", "0/133 read" — these appear in
  several places and drift. Keep a checklist of every location in your contributor docs.

## C.5 Read-marking: gate it by lesson type

Naively marking read on open means a learner who scrolls past gets full credit. Gate it by what the
lesson contains:

| Lesson type | Marks read when |
|---|---|
| Has a lab | **The lab is interacted with** (any pointerdown/keydown inside it) |
| Quiz lesson | **All answers revealed** (tracked per question) |
| Intro / summary / glossary | On open |

**Interaction, not completion.** Labs are open-ended simulations with no uniform end state, so there's
nothing else to key on. Implement it as **one delegated listener** on the lab container, not a
framework hook — the labs code stays untouched.

Add a visible gate line above the lab: *"Try the hands-on lab below…"* → *"✓ Lesson marked read."*
Otherwise the rule is invisible and reads as broken progress tracking.

## C.6 Discovery features worth the effort

Ranked by value-per-line, all injected by JS so the static markup stays no-JS-safe and
SEO-crawlable:

1. **Lesson search** — filters all lessons by title + lead. Cheapest thing here, most used.
2. **Persona paths** — 3–5 role cards (Developer / Architect / Analyst / PM), each an ordered
   cross-track playlist. Make unknown ids **auto-skip** so a curriculum edit can't break a path.
3. **Glossary tooltips** — harvest definitions from the glossary lesson's own markup; hover/focus
   popovers everywhere else. Zero duplicate content by construction.
4. **A guided tour** — dependency-free, ~8 steps. The CSS-only spotlight trick is worth knowing:
   ```css
   .tour-spot { position: relative; z-index: 9999;
                box-shadow: 0 0 0 9999px rgba(0,0,0,.6); }   /* no overlay element, no rect math */
   ```
   Offer it **once**, ~900 ms after boot, only on a genuinely fresh landing (no hash, no saved
   position), gated on a `tour_seen` flag — and **re-check that the URL hash is still empty when the
   timer fires**, or it yanks a learner who navigated during the delay. Make it replayable from a
   button. Always end the tour when the learner navigates into real content.
5. **A print stylesheet** — `@media print` showing the active lesson and hiding all chrome. Two dozen
   lines; learners genuinely print cheat sheets.

## C.7 Hub-level widgets vs. lessons

Some things aren't lessons — a flow explorer, a challenge mode, an exam. Put them as **always-visible
stacked sections on the hub**, not in the pager. Then "continue" between them is a **scroll +
highlight pulse**, not a page change. Chain them with a trailing next-button each, and use sentinel
route values (`__flows__`, `__exam__`) so the same delegated click handler drives both lessons and
widgets.

---

# Part D — Interactive labs framework

## D.1 The decision: simulate everything, client-side, no network

**Never call a real API from a lab.** Not your own, not anyone's. Simulation gives you: works offline,
works on a static host, no rate limits, no secrets, no per-learner cost, deterministic and
demonstrable failure modes, and no lab breaking because an upstream changed. The cost — it isn't
"real" — is a cost learners do not perceive, because the *responses* are real: correct status codes,
correct RFC error codes, correct headers.

## D.2 Framework shape

~200 lines of core, then N independent modules.

```js
window.Labs = {
  register(id, { title, blurb, render(root, helpers) }),
  defineFlow(id, { title, tag, intro, outro, actors, steps }),
  remountAll(),            // for "reset all progress"
  remountWithin(root),     // for "reset this track"
};
```

Placeholders in the content: `<div class="lab" data-lab="lab-jwt"></div>`. Mount on load, tear down
and re-render on reset. Adding a lab = one placeholder + one `register()` call. No build step, no
imports, no bundler.

**A helper API is what makes 96 labs feasible.** Without it each lab is 300 lines of DOM plumbing;
with it, 40 lines of actual teaching. The reference set:

| Group | Helpers |
|---|---|
| Layout | `el`, `row`, `col`, `panel`, `field`, `stage`, `note` |
| Controls | `button`, `chip`, `select`, `input`, `badge` |
| Domain | `fakeJwt`, `verifyJwt`, `decodeJwt`, `tokenView`, `jsonView`, `httpCard` |
| Feedback | `logPanel`, `meter`, `flash` |
| Lifecycle | `interval` (**auto-cleaned on reset** — this one is not optional) |
| Composition | `flowPlayer(ref)` — embed any registered sequence diagram |

## D.3 Use real cryptography exactly where it teaches

Simulate the protocol; **do the maths for real** when the maths *is* the lesson. WebCrypto is in every
target browser:

- TOTP → real HMAC-SHA1 per RFC 6238 (the learner watches the code change with the clock)
- Password breach check → real SHA-1 + real k-anonymity prefix logic
- Signing → real ECDSA P-256 sign/verify (tamper the payload, watch verification actually fail)
- Password storage → real salted SHA-256 (two identical passwords, two different hashes)

Everything else — token exchange, SCIM, CIBA, device flow — is deterministic simulation. The learner
can't tell where the line is, and the labs that *are* real are unfakeable.

## D.4 The flow player: one engine, N diagrams

Animated sequence diagrams are the highest-value component and the most expensive to hand-author.
Build **one** engine and feed it declarative definitions:

```js
Labs.defineFlow('oidc-code', {
  title: 'OIDC Authorization Code + PKCE',
  actors: [...],
  steps: [{ from, to, label, narration, http }, ...]
});
```

Engine gives you: step-by-step reveal, plain-English narration per step, an optional HTTP
request/response snippet, Back / Next / Auto-play, and full theming. Then a hub-level **Flow
Explorer** is a picker over the registry, and *any lesson can embed any flow* with one helper call.
The reference ships 12 flows this way (OIDC code, WebAuthn, refresh rotation, DPoP, back-channel
logout, SAML SP/IdP, client credentials, device, token exchange, CIBA, SCIM).

## D.5 Challenge mode

5–8 cross-cutting "here's a broken system — spot the flaw, then choose the fix" scenarios, each
linking the lesson that covers it. Cheap to build on the existing framework, and it's the only
component that tests *synthesis* across tracks rather than recall within one.

---

# Part E — The exam

## E.1 Pool and draw

- **N questions per track**, ids stable and namespaced (`track-01`, `track-02`, …).
- **Stratified draw**: guarantee `GUAR` per track, then fill randomly to the sitting size. With 12
  tracks, `GUAR=4` and `N=50`, every sitting covers every track and 2 questions in 5 are the
  luck of the draw. Guarantee-then-fill in a few lines beats any weighting scheme.
- **Shuffle option order for display**, but **submit the original pre-shuffle index**. The server's
  key is position-independent, so shuffling costs nothing.
- **Mix difficulty deliberately.** The reference's second round of authoring is explicitly harder and
  scenario-based rather than recall.

## E.2 Grading is server-authoritative — this is not optional

If the client posts `{score, passed}` and the server stores it, then any signed-in learner can POST
`{score: 100, passed: true}` and mint a real, publicly verifiable certificate **without answering a
single question.**

```
Client submits:  [{id, choice}, ...]          ← choices only, never a score
Server:          grades against ANSWER_KEY, computes score + passed, stores the attempt
```

**Keep the answer key on the server, keyed by the same stable question ids.** Position-independent, so
adding or retiring questions doesn't shift anything. A genuine drift between key and pool surfaces as
an explicit `unknown_question` rejection — **never as a silently mis-scored attempt**. Assert the key's
shape in your test suite.

**State the residual risk honestly, in a comment and in the docs.** The question text and correct
index still ship in the public bundle for the local "review answers" screen, so the exam is
unproctored and a determined reader can look answers up. That was *already* true of a client-only
exam. What server grading closes is specifically that a passing **score** can be fabricated with **no
exam at all** — the number a third party reads off your verification page is now one your server
computed. Don't oversell it; do ship it.

## E.3 Rate limiting: two halves, and one alone is worthless

```
MAX_ATTEMPTS_PER_ACCOUNT_PER_DAY = 3
MAX_ATTEMPTS_PER_NETWORK_PER_DAY = 3
window = rolling 24h
```

**The per-account half caps nothing on its own — accounts are free.** The network half is what makes
the number mean anything. The cost is real and you must own it in the UI: one NAT (household, office,
campus) shares one bucket. So the 429 carries `scope` (`account` | `network`), `nextAttemptAt`, and
`Retry-After`, and the UI says **which** limit was hit in plain words.

**Answer "when can I try again?" honestly.** With a rolling window a slot frees exactly one window
after the **oldest attempt still inside it** — `MIN(taken_at)` over the window, plus the window
length. "Try again tomorrow" is wrong for most of the day.

**The network key: hash the IP, and be precise about what that does and doesn't buy.**

```js
// Domain-separated so this hash can never collide with one computed for another purpose.
// HMAC when a pepper is configured; plain SHA-256 otherwise.
hash = pepper ? HMAC_SHA256(pepper, `${DOMAIN}:${ip}`)
              : SHA256(`${DOMAIN}:${ip}`)
```

- **Read the edge-set header only** (`CF-Connecting-IP` or your platform's equivalent). Your edge
  overwrites it on every request, so it can't be forged. **Never `X-Forwarded-For`** — it's
  client-controlled at the first hop, which lets anyone pick their own bucket. That's *worse* than no
  limit, because it looks like one.
- **This is not anonymisation and must not be described as such.** IPv4 has 2^32 addresses; an
  unpeppered SHA-256 of one is reversible by exhaustive search in seconds. Unpeppered, the hash buys
  "not readable off a row or log line at a glance". The pepper upgrades it to genuinely unrecoverable.
  Keep the pepper **optional in code** (a missing pepper must not take the exam offline; local dev has
  no secret store) and **always set in deployment**.
- **Fail closed on a missing IP**: bucket all address-less requests together rather than skipping the
  check. Over-limiting is annoying, visible and recoverable; silently removing the limit is not. It
  can't be used as a bypass since a caller can't make the header disappear.
- **Scrub the hash from rows older than the window**, off the write path (`waitUntil`) so a scrub
  failure can never fail an exam submission that already graded. Keep the attempt forever — score,
  pass and date are the learner's own history. **The scrub must use the same window start the counts
  use**, or it erases keys still being counted and you silently under-count.

## E.4 Attempts history

Return `{attempts, limits}` — **not a bare array**. The network half can't be derived from the
learner's own history, so the server has to state it. Report only *whether* the network is exhausted
and when it frees up — **never a running count of other people's attempts.**

Render a collapsed list: date, pass/fail, score, correct/total, plus "N of 3 used in the last 24
hours". Disable the start button with the **reason** and the **local time** the limit lifts.

## E.5 Gate exactly this, and nothing else

The exam is sign-in-gated. Lessons, labs, flows and challenges stay fully public and account-free.
Logged-out visitors get a "🔐 Sign in to take the final exam" panel in place of the quiz — not a
redirect, not a modal over the whole page.

---

# Part F — Certificates & public verification

## F.1 Two verification paths, deliberately different in kind

| | Primary | Secondary |
|---|---|---|
| **What** | `GET /certificates/verify/:serial` | Signed ES256 JWT |
| **Who uses it** | A human typing a serial into your verify page | A machine verifying offline |
| **Crypto** | **None.** A DB lookup | Public key from your JWKS |
| **Returns** | Holder name, score, issue date — or "no match" | Whatever's in the claims |

Build the primary first. Most verification is a person typing a code off a PDF, and a DB lookup can't
have a crypto bug.

## F.2 Serial design

**Requirements:** human-transcribable, and **unguessable** — because the verify endpoint is public, so
a guessable serial is an **enumeration oracle for holder names.**

```
Format:    IA-XXXX-XXXX-XXXX
Alphabet:  Crockford base32 (base32 minus I, L, O, U)
Entropy:   12 chars × 5 bits = 60 bits of CSPRNG output
```

- **I/L/O dropped** because they're confusable with 1/1/0 on a printed page. **U dropped** because
  excluding it makes accidental profanity in a random string far less likely.
- **60 bits**: at 10,000 guesses/second an attacker needs ~1.8 million years for one expected hit.
- **`byte & 31` is unbiased** precisely because 256 is a whole multiple of 32 — no modulo correction.
- **Normalise on input, store one canonical form.** Accept lowercase, missing/extra hyphens,
  whitespace, and apply Crockford's decoding leniency (I/L → 1, O → 0 — safe because those are never
  *emitted*). Cap the input length and return "no match" for anything malformed **without touching the
  database.**
- **Don't use a UUID.** The reference started there: *more* entropy, far worse ergonomics. Nobody
  transcribes 32 hex digits and 4 hyphens off a printed certificate correctly.

## F.3 JWT claims: minimalism is the design

```jsonc
{
  "iss": "https://{app}",                  // you are the only issuer
  "aud": "https://{app}/verify",           // so a JWT minted for another purpose can't be replayed
  "sub": "IA-XXXX-XXXX-XXXX",              // THE SERIAL — see below
  "jti": "IA-XXXX-XXXX-XXXX",              // same value
  "name": "Maya Patel",
  "score": 92,
  "iat": ..., "exp": ...
}
```

**No email.** A JWT payload is base64url, not encrypted — anyone the learner forwards it to reads
every claim. Name + score + serial *are* the credential; the email has no role in proving it.

**`sub` is the serial, not a user id.** The subject of this credential is **the certificate, not the
person.** A learner forwards this to employers, so any account identifier in it becomes a stable
cross-application handle for that learner **held by arbitrary third parties**. An earlier version put
the internal user id here. **Enforce it structurally**: leave the field out of your claims *type* so a
future caller can't reintroduce it without deliberately editing the signing function.

**Publish the public key** at a JWKS route with a `kid` in every JWT header. Until you do, the
signature is decorative — signed, with nothing to check it against. This is the **only** route that
sends CORS, because the whole point is that a third party's browser-based verifier can fetch it.
It's also the only route that may set its own `Cache-Control` (a never-rotated key doesn't need
re-fetching); make your header wrapper preserve a route-chosen value and default everything else to
`no-store`.

## F.4 The signing key: generate once, never rotate — and *enforce* it

Rotating invalidates every issued certificate's signature. And **the loss is silent**: your verify
page keeps working (it's a DB lookup), so only the forwarded JWTs quietly stop verifying, with no
error on any side.

**Fail closed if the key is missing.** No fallback. The reference's original unconditional
ephemeral-key fallback failed open in the worst possible way: it silently signed **real** certificates
with a key that dies with the isolate, and published a **different** public key per isolate — every
stored JWT permanently unverifiable, no error anywhere. Keep a dev fallback if you like, but make it
**opt-in via a flag that only exists in a gitignored local file** so it cannot reach production.

**Generate-if-absent cannot distinguish "first deploy" from "the key was lost."** So record the key's
**RFC 7638 thumbprint** in a committed file (it's public by construction — you serve it in the JWKS)
and enforce two checks in CI:

1. **Refuse to generate** when the secret is absent *but a thumbprint is recorded*. Covers dashboard
   deletion, CLI deletion, and a service rename (which silently means a *different* service with no
   secrets).
2. **Post-deploy continuity check**: compare the **live JWKS** thumbprint against the recorded one.
   This catches what a name-only secret listing cannot — a secret that was **overwritten** rather than
   deleted still lists as present. An unreachable JWKS **fails** the check rather than passing it.

**Do not auto-commit on drift.** Recording whatever is live documents every accidental rotation as
intended and the guard never fires again. Accepting a rotation should cost a reviewed commit.

Also: **fail closed on an unreadable secret listing.** An errored listing reads as "no secrets" and
would silently rotate the key.

## F.5 Issuance flow

```
pass → POST /exam/attempts        (server grades, stores attempt)
     → GET/PUT /profile           (collect first+last name if absent)
     → POST /certificates/issue   (mint serial, sign JWT, store row, LOCK the name)
     → client RENDERS what the server returned
```

**The client renders; it never computes.** The canvas PNG is drawn from the server's holder name,
score, issued-at and serial. The JWT is fetched separately. **Never** a browser-computed certificate
id — the reference had one (`IA-YYYYMMDD-<score>-<8 hex>` from a hashed canonical name) and it is
gone; anything derived client-side is forgeable by definition.

**Lock the name at first issuance**, and *pin the name that was actually printed*:

> Issuance reads the profile, signs a JWT, and inserts a row — several awaited round trips — and
> `PUT /profile` is accepted throughout that window, because the lock doesn't exist yet. Locking
> *without* re-pinning freezes whatever the name happened to be at the **end** of that race: the
> learner's locked profile says "Bob Jones" while a public, permanently verifiable certificate says
> "Alice Smith", and the next passing attempt mints a *second* live certificate under the new name.
> One learner, two certificates, two holders. **The certificate wins** — it's the durable artifact a
> third party may already have checked — so the profile is corrected to match it.

Also on this path:

- **Reject empty/whitespace names**, and strip control/bidi/zero-width characters. No "Anonymous
  Learner" placeholder default — if you have one, someone ships a certificate with it on.
- **Idempotency via `UNIQUE(attempt_id)`.** Check for an existing certificate **first** so a repeat
  issue returns the stored row without re-signing. An ES256 sign plus a key import is the most
  expensive thing that endpoint does, and on the re-issue path it was pure waste.
- **Recompute "best certificate" from the table, never from the caller's opinion.** A
  `markOthersNotBest(winnerId)` helper is wrong for anything concurrent: two different attempts
  certified at the same moment each read the same current-best score, each conclude they won, and
  each demote the other — leaving the learner with **no** certificate flagged best. Deciding from the
  table is idempotent and self-correcting. Order by `score DESC, issued_at DESC, id DESC` so the
  result is total and deterministic, and do it as two statements so there's no gap where two rows are
  both best.
- **Certificates are durable.** List a learner's previous certificates and let them re-download any.
- **Cap issuance per day** as an abuse backstop.

## F.6 The verify page

A plain form. Serial in, result out. No auth, no cookies, no CORS. Model it on your simplest existing
page.

One UI note worth stealing: if your design system's outline-button style renders with artifacts,
use a bespoke solid button here rather than fighting it. This page is the one a stranger sees first.

---

# Part G — Ops: deploy, secrets, cache-busting, headers

## G.1 One Worker, static + API

- Point static assets at the repo root; list what must **never** publish in an ignore file — starting
  with `.git` (otherwise the entire repository history is downloadable from your live site), then
  local secret files (`.dev.vars`, `.env` — a developer deploying from their laptop would otherwise
  publish their live client secret), then build tooling, docs and notes.
- **Every path prefix your Worker dispatches on must also be listed in the "run worker first"
  config.** A prefix handled in code but missing there is answered by the asset server and **404s on a
  route that looks correctly implemented.** Put a "keep in sync" comment on both sides.
- **Security headers in two places** — one file for static asset responses, one module for API
  responses. Keep them in sync; note the split in both.
- **Verify the ignore list actually works** after changing it:
  `WRANGLER_LOG=debug npx wrangler deploy --dry-run 2>&1 | grep 'Ignoring asset'`

## G.2 Secrets: three policies, and confusing them breaks something

Provision **all** secrets from CI so nothing is set by hand.

| Policy | Example | Rule |
|---|---|---|
| **Mirror only, never generate** | Shared OIDC client secret | Both sides must hold the same raw value — see A.7 |
| **Generate once, never rotate, guarded** | Certificate signing key | Not overridable from a CI secret at all: the only reason to supply one by hand is to change it, and changing it is the prohibited operation |
| **Mirror if present, else generate; freely rotatable** | Exam IP pepper | Nothing durable derives from it |

## G.3 Cache-busting and the live-update toast

A single-page reader never notices a new deploy. So: poll a version file against a `<meta>` build
number on the page, and show a dismissible "New lessons & fixes are available — Reload" toast on
mismatch. Safe precisely because progress lives in localStorage, so a reload loses nothing.

Poll **cheaply**: on `visibilitychange` → visible, and on crossing into a new track. **Not** on every
lesson turn, and **no standing interval** — a page that's typically closed within the hour doesn't
need a background timer.

**The trap, and it is the single easiest thing in this whole document to forget:** your learning page
loads the shared CSS and JS bundles, so **any** commit that bumps *either* version — a nav fix, a
colour tweak, anything — is a real deploy from an open reader's point of view. The build meta and the
version file must move in **that same commit**. Forgetting produces **no visible error** (the toast
just silently never fires), which is exactly why it gets forgotten. It bit the reference
implementation three commits in a row.

Bump them **only** with a real deploy — bumping without one falsely prompts everyone to reload.

## G.4 Two CI checks worth copying

**1. Ban raw control bytes in source.** Fail the build on control characters in `.ts/.js/.json/.html/
.css/.yml/.toml` (excluding minified files; allow CR if you have CRLF files). They make a file
**binary** to grep and ripgrep, which then skip it **in silence**. The reference shipped an
open-redirect guard containing literal NUL/US/DEL bytes instead of `\x` escapes — behaving
identically, typechecking cleanly, and invisible to every text search run over the Worker.

**2. A post-deploy smoke probe.** And know that a bot-protection product on your zone will challenge
your own CI runner. If that happens, the fix is not to weaken the zone: enable your platform's
non-zone hostname (a `*.workers.dev`-style URL) purely as a probe target, keep it out of every
redirect/callback allowlist, link nothing to it, and probe *that*.

---

# Part H — Reference

## H.1 Schema sketch

```sql
-- Owned by {app}. Foreign keys reference the IdP-owned users table; if the DB is
-- shared, migrations still land in exactly ONE repo.

CREATE TABLE app_sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,        -- store the HASH, never the token
  oidc_sid TEXT,                          -- for back-channel logout
  ua_summary TEXT,                        -- device list display only, length-capped
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,             -- throttled write, see A.4
  cookie_issued_at TEXT NOT NULL          -- re-issue keys off THIS, see A.4
);

CREATE TABLE profiles (
  user_id TEXT PRIMARY KEY,
  first_name TEXT, last_name TEXT,
  name_locked_at TEXT,                    -- set at first certificate issuance
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE lesson_progress (
  user_id TEXT NOT NULL, lesson_id TEXT NOT NULL, read_at TEXT NOT NULL,
  PRIMARY KEY (user_id, lesson_id)        -- makes INSERT OR IGNORE the union
);

CREATE TABLE quiz_progress (
  user_id TEXT NOT NULL, track_id TEXT NOT NULL,
  revealed_mask INTEGER NOT NULL,         -- bitwise OR on merge
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, track_id)
);

CREATE TABLE last_position (
  user_id TEXT PRIMARY KEY, lesson_id TEXT NOT NULL,
  updated_at TEXT NOT NULL                -- LWW by caller timestamp; validate it
);

CREATE TABLE progress_epoch (
  user_id TEXT PRIMARY KEY,
  epoch INTEGER NOT NULL DEFAULT 0,       -- absent row == 0 == never reset
  reset_at TEXT
);

CREATE TABLE exam_attempts (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  score INTEGER NOT NULL, passed INTEGER NOT NULL,
  taken_at TEXT NOT NULL, question_ids_json TEXT NOT NULL,
  ip_hash TEXT                            -- scrubbed to NULL past the window
);
CREATE INDEX idx_attempts_ip ON exam_attempts (ip_hash, taken_at);

CREATE TABLE certificates (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL UNIQUE,        -- UNIQUE == issuance idempotency
  serial TEXT NOT NULL UNIQUE,
  holder_name TEXT NOT NULL, score INTEGER NOT NULL,
  jwt TEXT NOT NULL, is_best INTEGER NOT NULL DEFAULT 0,
  issued_at TEXT NOT NULL
);
```

## H.2 API surface

| Method | Route | Auth | Notes |
|---|---|---|---|
| GET | `/api/{app}/.well-known/jwks.json` | none | **Only** CORS route. Only route with its own `Cache-Control` |
| GET | `/api/{app}/certificates/verify/:serial` | none | Public verification. No cookies |
| GET/PUT | `/api/{app}/profile` | session | PUT 409s once the name is locked |
| GET | `/api/{app}/progress` | session | |
| POST | `/api/{app}/progress/sync` | session | Union merge + epoch check |
| POST | `/api/{app}/progress/reset` | session | Bumps the epoch |
| POST | `/api/{app}/exam/attempts` | session | Server grades. Rate-limited, 2 scopes |
| GET | `/api/{app}/exam/attempts` | session | Returns `{attempts, limits}` |
| POST | `/api/{app}/certificates/issue` | session | Idempotent per attempt. Locks the name |
| GET | `/api/{app}/certificates` | session | Capped list |
| GET | `/api/{app}/certificates/:serial/jwt` | session | The JWT artifact |

## H.3 Client storage keys

| Key | Holds | Wiped on |
|---|---|---|
| `{app}_read` | Set of read lesson ids | Owner change, reset |
| `{app}_quiz` | Per-track reveal masks | Owner change, reset |
| `{app}_pos` | Last lesson id | Owner change, reset, explicit back-out |
| `{app}_pos_at` | Timestamp for LWW merge | Owner change, reset — **tombstoned, not cleared**, on back-out |
| `{app}_epoch` | Last-seen reset epoch | Owner change |
| `{app}_owner` | Owning user id | — (this *is* the guard) |
| `{app}_exam` | Local display hint only | Owner change (**stashed if passing**) |
| `{app}_exam_stash_v1` | **List** of passing records, keyed by owner | Consumed only on real restore |
| `{app}_auth_session_v1` | Cached session (**localStorage**, not session-) | Sign-out |
| `{app}_auth_event_v1` | Popup→opener handshake channel | Read-and-clear |
| `{app}_tour_seen` | Tour offered already | Never |

## H.4 Adoption checklist

**Keep as-is (these are the answers, not preferences):**
- OIDC RP with your own `__Host-` cookie. Never a cross-subdomain session cookie.
- Origin + JSON content-type CSRF guard, applied as opt-out.
- Union merge + a reset epoch re-checked inside each write statement.
- Owner-scoped local progress with a keyed, list-shaped stash for a passing exam.
- Server-authoritative grading. The client never asserts a score.
- Unguessable serial + DB-lookup verification as the primary path.
- No email and no account id in the certificate JWT; `sub` = serial, enforced by the type.
- Generate-once signing key, failing closed, with a committed thumbprint and a CI continuity check.
- Semantic-class SVG theming.

**Tune to your domain:**
- Track count, lesson count, pass mark, sitting size, `GUAR`.
- Attempt limits (3/day/account + 3/day/network is deliberately tight for a certificate; a practice
  quiz wants something looser).
- The fictional cast and the neutrality rule.
- Certificate serial prefix and validity period.
- Theme count. Four is a lot; two is plenty. The *token* discipline matters far more than the number.

**Decide fresh:**
- Whether you have an existing IdP at all. If not, you're building `{idp}` too — that's a separate,
  larger piece of work (email OTP, passkeys, TOTP, recovery, erasure), and the honest advice is to
  buy it rather than build it unless identity *is* your product.
- Whether the exam is the only gated feature. It should be, unless you have a specific reason.
- Whether certificates need to exist. They're the most expensive subsystem here by a wide margin.
  Progress sync alone (Parts A–C) is a complete product.

## H.5 Where account deletion lives

**One canonical erasure path, in the repo that owns the user record**, cascading to every table
including yours. `{app}` offers **no** delete button — it **links out**. A second deletion path is a
second thing to keep correct, and it will diverge.

---

# Part I — The mistake list

Every entry shipped, broke, and was fixed. This is the highest-value section in the document.

**Identity**
1. **Shared cross-subdomain session cookie.** Session fixation from any sibling host. Not hardenable —
   redesign to OIDC. (§A.1)
2. **Cookie name keyed on URL scheme instead of hostname.** Served the unprefixed dev name to a
   plaintext production request, reopening #1. (§A.4)
3. **"Lax makes the CSRF guard redundant."** It does not — siblings are same-site. Nearly deleted a
   load-bearing control. (§A.1)
4. **Handling the provider's `?error=` before validating `state`.** The failure path clears the
   `SameSite=Lax` transaction cookie, so any third-party page could kill a victim's in-flight login by
   navigating them to `/auth/callback?error=access_denied`. **Validate `state` first.**
5. **Returning JSON from an auth error path.** Only the closing page writes the popup handshake, so
   the opener waited out its full five-minute timeout and cleared with no message. (§A.3)
6. **Re-issuing the cookie on idle gap rather than cookie age.** Daily visitors silently logged out at
   the browser's cookie cap; twice-a-year visitors refreshed forever. (§A.4)
7. **CI generating a shared secret as a "last resort".** Seeded a live confidential client with a
   secret nobody could read. Both sides must refuse. (§A.7)

**Progress**
8. **Reset undoing itself.** Local clear → debounced sync → server unions it all back, in front of
   the learner. Needs the epoch. (§B.2)
9. **Server-side deletion without an epoch.** Another device re-uploads its stale copy; the reset
   silently un-happens elsewhere. (§B.2)
10. **Epoch checked only in the route, not in the write statement.** A concurrent reset in the gap
    resurrects rows *at the new epoch*, permanently undetectable. (§B.2)
11. **Unioning post-reset truth instead of replacing.** Unioning an empty set into a full one changes
    nothing — and it looks like it's working. (§B.2)
12. **Not bumping the sync generation on the ownership wipe.** An in-flight response restored learner
    A's progress into a signed-out browser, which then made B's sign-in skip the claim path and
    permanently merge A's progress into B's account. (§B.3)
13. **Reconciling ownership against the cached session.** On a fresh browser profile the cache reads
    signed-out, so it wiped a legitimate learner's progress — including a passing exam — on load.
    (§B.5)
14. **Reconciliation registered from an async ready callback.** The forced boot event fires
    synchronously during the deferred script — so the listener **never ran at all**, deterministically.
    (§B.5)
15. **Only one entry point taking the claim path.** Signing in from another page's navbar then opening
    the learning page skipped it and destroyed anonymous progress on any reset account. (§B.5)
16. **Caching the session in `sessionStorage`.** Every new tab looked logged-out and showed the
    sign-in wall to a signed-in learner. (§B.5)
17. **Passive resume restamping the position timestamp.** Opening the app on a stale device dragged
    every device back to that device's old lesson. (§B.6)
18. **Clearing the position timestamp on back-out instead of tombstoning it.** `!localAt` is the first
    clause of the adoption test, so clearing it made adoption unconditional. (§B.6)
19. **Accepting any `Date.parse`-able position timestamp.** The merge compares strings, so
    `"Sat Jan 01 2050"` wedged the saved position forever. (§B.6)
20. **A single-slot exam stash, unconditionally consumed, not stashing on account switch.** Three
    separate ways to destroy a learner's passing sitting. (§B.4)

**Exam & certificates**
21. **Trusting a client-sent score.** `{score:100,passed:true}` → a real verifiable certificate with
    no exam. (§E.2)
22. **A per-account rate limit with no network half.** Accounts are free; it capped nothing. (§E.3)
23. **Reading `X-Forwarded-For` for the rate-limit key.** Client-controlled — lets anyone pick their
    bucket. Worse than no limit, because it looks like one. (§E.3)
24. **Scrubbing IP hashes with a different window start than the counts use.** Erases keys still being
    counted; silent under-count. (§E.3)
25. **A browser-computed certificate id.** Forgeable by construction. (§F.5)
26. **A guessable serial on a public verify endpoint.** An enumeration oracle for holder names. (§F.2)
27. **A user id in the certificate JWT's `sub`.** A stable cross-app handle for the learner, held by
    every employer they forward it to. (§F.3)
28. **An unconditional ephemeral signing-key fallback.** Silently signed real certificates with a key
    that dies with the isolate, publishing a different public key per isolate. Every JWT permanently
    unverifiable, no error anywhere. (§F.4)
29. **Locking the profile name without pinning the printed name.** One learner, two live certificates,
    two different holder names. (§F.5)
30. **A caller-decides "mark others not best".** Two concurrent issuances each demote the other;
    learner ends up with no best certificate. (§F.5)
31. **Re-signing a JWT on an idempotent re-issue.** The most expensive operation on the endpoint,
    discarded. (§F.5)
32. **Aggregating over a `LIMIT`-ed list.** A max or count over a truncated list is simply wrong.
    (§B.7)

**Content & ops**
33. **Marking a lesson read on open.** Scrolling past earned full credit. Gate by lesson type. (§C.5)
34. **Hardcoded colours in lesson SVGs.** Invisible in two of four themes, and unfindable later.
    (§C.3)
35. **Using a diagram accent token as standalone text colour.** Near-illegible on the themes where
    that token is dark. (§C.3)
36. **Forgetting the build-version bump on an unrelated CSS/JS change.** No visible error — the
    update toast just silently never fires. Bit us three commits in a row. (§G.3)
37. **A Worker path prefix missing from the run-first config.** 404s on a route that looks correctly
    implemented. (§G.1)
38. **Raw control bytes in source.** Makes the file binary to grep; ripgrep skips it in silence.
    (§G.4)
39. **A tour timer that fires after the learner navigated away.** Re-check the URL hash when it fires.
    (§C.6)
40. **A plain object for caller-keyed maps.** A `__proto__` key silently vanishes from every response.
    (§B.7)

---

## Sizing

For calibration, the reference implementation at the point this was written:

| Piece | Size |
|---|---|
| Server (auth, API, store, certs, exam, session, security) | ~3,300 lines TypeScript |
| Auth client (all pages) | ~1,400 lines JS |
| Labs framework + 96 labs + 12 flows + exam engine | ~11,800 lines JS |
| Site JS incl. reader, sync, tour | ~2,100 lines JS |
| Content | 12 tracks / 133 lessons / ~120 diagrams, hand-authored HTML |

The labs are the bulk, and they're the part that scales linearly with how much you want to teach.
Parts A + B — the whole identity and sync story, which is where all the subtlety lives — are about
2,000 lines of server and 1,000 of client. **Budget your review time by subtlety, not by line count:
Part B is 10% of the code and produced 40% of the bugs.**

---

> **Provenance.** Extracted from IntegrAuth Academy (`integrauth/website`), 2026-08. The repo-specific
> companions are [`ACCOUNTS-ARCHITECTURE.md`](./ACCOUNTS-ARCHITECTURE.md) (ownership, secrets, deploy
> order) and [`HANDOFF-academy-sso.md`](./HANDOFF-academy-sso.md) (the full build history and four
> adversarial re-audit rounds — every entry in Part I traces back to it). This file is the
> app-agnostic distillation; it is not kept in lockstep with the implementation, so re-read the source
> before relying on an exact constant.
